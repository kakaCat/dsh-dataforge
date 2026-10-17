/**
 * 调度器（IF-3）与运行留痕（FR-3.4）：真起本地 http server 打真网络，不 mock fetch。
 *
 * 验的是**调度与落盘的事实**：run.json 先于第一个请求、每节点一对 start/终态、
 * 跳过节点不发 step、并发真的并发、取消收敛 killed、dry-run 一个请求都不发。
 *
 * @module dsh-dataforge/test/execute/run
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChainDoc, InterfaceCardDoc } from '../../src/chains/schema.js'
import { buildPlan, type ExecutionPlan } from '../../src/execute/plan.js'
import {
  clampConcurrency,
  executeChainRun,
  prepareChainRun,
  previewText,
  runChain,
  type ChainRunDeps,
  type ChainRunConfig,
} from '../../src/execute/run.js'
import { foldSummary, loadRunEvents, readRunRecord } from '../../src/runs/store.js'
import type { CredentialProvider } from '../../src/execute/credentials.js'
import type { ReloginRunner, ReloginSpec } from '../../src/execute/run.js'

/* ================================================================== 假服务端 */

let server: Server
let base = ''

/** 服务端看到的请求（顺序即真实发出顺序）。 */
let seen: Array<{ method: string; url: string; body: string; headers: Record<string, string | string[] | undefined> }> = []

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? '/'
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      seen.push({
        method: req.method ?? '',
        url,
        body: Buffer.concat(chunks).toString('utf8'),
        headers: req.headers,
      })
      if (url.startsWith('/api/cookie')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ cookie: req.headers.cookie ?? '' }))
        return
      }
      if (url.startsWith('/api/auth-only')) {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end('{"error":"login required"}')
        return
      }
      if (url.startsWith('/api/protected')) {
        const cookie = req.headers.cookie ?? ''
        if (cookie.includes('sid=fresh')) {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end('{"ok":true}')
        } else {
          res.writeHead(401, { 'content-type': 'application/json' })
          res.end('{"error":"login required"}')
        }
        return
      }
      if (url.startsWith('/api/materials/detail')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ materialCode: 'CODE-9' }))
        return
      }
      if (url.startsWith('/api/materials')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ items: [{ internalId: 'M-1' }] }))
        return
      }
      if (url.startsWith('/api/orders')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ orderNo: 'PO-1' }))
        return
      }
      if (url.startsWith('/api/fail')) {
        res.writeHead(500, { 'content-type': 'text/plain' })
        res.end('boom')
        return
      }
      if (url.startsWith('/api/slow-a') || url.startsWith('/api/slow-b')) {
        setTimeout(() => {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        }, 250)
        return
      }
      if (url.startsWith('/api/hang')) {
        setTimeout(() => {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end('{"ok":true}')
        }, 400)
        return
      }
      if (url.startsWith('/api/big')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ items: [{ internalId: 'x'.repeat(4000) }] }))
        return
      }
      res.writeHead(404)
      res.end('nope')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

/* ================================================================== 夹具 */

function cardOf(
  cardId: string,
  method: string,
  urlTemplate: string,
  inputs: InterfaceCardDoc['inputs'],
  outputs: InterfaceCardDoc['outputs'] = [],
): InterfaceCardDoc {
  return {
    cardId,
    kind: 'interface-card',
    identity: { mergeKey: `${method} ${urlTemplate}`, method, urlTemplate },
    inputs,
    outputs,
    sources: [{ captureId: 'cap_1', pages: [`${base}/some/page`] }],
  }
}

const searchCard = cardOf('card_search', 'GET', '/api/materials?q={q}', [
  { path: 'query.q', type: 'string' },
  { path: 'query.orgId', type: 'string' },
], [{ path: 'body.items[*].internalId', type: 'string' }])

const createCard = cardOf('card_create', 'POST', '/api/orders', [
  { path: 'body.lines[0].materialId', type: 'string' },
  { path: 'body.lines[0].quantity', type: 'number' },
  { path: 'body.orgId', type: 'string' },
], [{ path: 'body.orderNo', type: 'string' }])

const detailCard = cardOf('card_detail', 'GET', '/api/materials/detail?id={id}', [
  { path: 'query.id', type: 'string' },
], [{ path: 'body.materialCode', type: 'string' }])

const failCard = cardOf('card_fail', 'GET', '/api/fail', [])
const slowACard = cardOf('card_slow_a', 'GET', '/api/slow-a', [])
const slowBCard = cardOf('card_slow_b', 'GET', '/api/slow-b', [])
const hangCard = cardOf('card_hang', 'GET', '/api/hang', [])
const bigCard = cardOf('card_big', 'GET', '/api/big', [], [{ path: 'body.items[*].internalId', type: 'string' }])
/** R-4 M1：声明了 cookie-session 的卡（卡文件本身仍零凭证）。 */
const cookieCard: InterfaceCardDoc = { ...cardOf('card_cookie', 'GET', '/api/cookie', []), auth: 'cookie-session' }
const authOnlyCard: InterfaceCardDoc = { ...cardOf('card_auth_only', 'GET', '/api/auth-only', []), auth: 'cookie-session' }
const protectedCard: InterfaceCardDoc = { ...cardOf('card_protected', 'GET', '/api/protected', []), auth: 'cookie-session' }

/** 测试用 provider：只回一份固定 cookie，摘要里不含值。 */
function providerOf(cookie: string): CredentialProvider {
  const name = cookie.split('=')[0] ?? 'sid'
  return () => ({
    headers: { cookie },
    application: {
      status: 'applied',
      source: 'capture',
      header: 'cookie',
      names: [name],
      domains: ['127.0.0.1'],
      captureIds: ['cap_1'],
      expired: 0,
    },
  })
}

/** 测试用 provider：什么都没匹配到。 */
const emptyProvider: CredentialProvider = () => ({
  headers: {},
  application: {
    status: 'none',
    source: 'capture',
    names: [],
    domains: [],
    captureIds: ['cap_1'],
    expired: 0,
    reason: '没有匹配 127.0.0.1 的 cookie',
  },
})

function cardsOf(...cards: InterfaceCardDoc[]): Map<string, InterfaceCardDoc> {
  return new Map(cards.map((card) => [card.cardId, card]))
}

function chainOf(nodes: ChainDoc['nodes'], edges: ChainDoc['edges'] = [], inputs: ChainDoc['inputs'] = []): ChainDoc {
  return {
    apiVersion: 'dataforge/v1',
    kind: 'interface-chain',
    meta: { site: '测试站点', flow: '采购下单', version: 2, created: '2026-10-17T00:00:00Z' },
    inputs,
    nodes,
    edges,
  }
}

/** 两节点链：搜索 → 下单（一条绑定边把 internalId 传下去）。 */
function happyDoc(): ChainDoc {
  return chainOf(
    [
      { id: 'query-material', card: 'card_search', constants: { 'query.orgId': '2120', 'query.q': '$inputs.keyword' } },
      { id: 'create-order', card: 'card_create', constants: { 'body.lines[0].quantity': '10', 'body.orgId': '2120' } },
    ],
    [{ from: 'query-material.body.items[0].internalId', to: 'create-order.body.lines[0].materialId' }],
    [{ name: 'keyword', type: 'string', required: true }],
  )
}

const CONFIG: ChainRunConfig = {
  enabled: true,
  nodeTimeoutSeconds: 5,
  concurrency: 4,
  responseLimitBytes: 2_097_152,
}

function depsOf(): ChainRunDeps {
  return { dataRoot: mkdtempSync(join(tmpdir(), 'chain-run-')), config: CONFIG }
}

function planOf(doc: ChainDoc, cards: Map<string, InterfaceCardDoc>, inputs: Record<string, unknown> = {}): ExecutionPlan {
  const planned = buildPlan(doc, cards, inputs, base)
  if (!planned.ok) throw new Error(`计划的夹具不合法：${planned.code} ${planned.message}`)
  return planned.plan
}

/* ================================================================== 主路径 */

describe('主路径：拓扑执行 + 绑定传值', () => {
  it('两节点链跑通：绑定值进下游请求体，事件流 meta→step×4→terminal→result', async () => {
    seen = []
    const deps = depsOf()
    const doc = happyDoc()
    const cards = cardsOf(searchCard, createCard)
    const plan = planOf(doc, cards, { keyword: '螺丝' })

    const result = await runChain(deps, { doc, cards, plan, inputs: { keyword: '螺丝' }, baseUrl: base })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.failedNode).toBeUndefined()
    expect(result.cancelled).toBe(false)
    expect(result.summary.status).toBe('completed')
    expect(result.summary.stepsDone).toBe(2)
    expect(result.summary.totalSteps).toBe(2)
    expect(result.summary.chain).toEqual({
      site: '测试站点',
      flow: '采购下单',
      version: 2,
      completedNodes: ['query-material', 'create-order'],
    })

    // 下游真的收到了上游的绑定值。
    const createRequest = seen.find((entry) => entry.url.startsWith('/api/orders'))
    expect(createRequest).toBeDefined()
    expect(JSON.parse(createRequest?.body ?? '{}')).toEqual({
      lines: [{ materialId: 'M-1', quantity: '10' }],
      orgId: '2120',
    })

    const events = loadRunEvents(deps.dataRoot, result.runId) ?? []
    expect(events.map((event) => event.event)).toEqual([
      'meta', 'step', 'step', 'step', 'step', 'terminal', 'result',
    ])
    const steps = events.filter((event) => event.event === 'step')
    expect(steps.map((event) => `${event.id}:${event.status}`)).toEqual([
      'query-material:start', 'query-material:done', 'create-order:start', 'create-order:done',
    ])
    // 出参探测：上游 done 事件的 emitted 里有绑定路径。
    const queryDone = steps[1] as { data?: { emitted?: Record<string, unknown> } }
    expect(queryDone.data?.emitted?.['query-material.body.items[0].internalId']).toBe('M-1')
  })

  it('三节点链（两条绑定边）跑通：值经两跳传到写节点，每节点恰好一对 start/终态', async () => {
    seen = []
    const deps = depsOf()
    const doc = chainOf(
      [
        { id: 'query-material', card: 'card_search', constants: { 'query.orgId': '2120', 'query.q': '$inputs.keyword' } },
        { id: 'query-detail', card: 'card_detail', constants: {} },
        { id: 'create-order', card: 'card_create', constants: { 'body.lines[0].quantity': '3', 'body.orgId': '2120' } },
      ],
      [
        { from: 'query-material.body.items[0].internalId', to: 'query-detail.query.id' },
        { from: 'query-detail.body.materialCode', to: 'create-order.body.lines[0].materialId' },
      ],
      [{ name: 'keyword', type: 'string', required: true }],
    )
    const cards = cardsOf(searchCard, detailCard, createCard)
    const plan = planOf(doc, cards, { keyword: '螺丝' })
    expect(plan.order).toEqual(['query-material', 'query-detail', 'create-order'])

    const result = await runChain(deps, { doc, cards, plan, inputs: { keyword: '螺丝' }, baseUrl: base })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.summary.status).toBe('completed')
    expect(result.summary.stepsDone).toBe(3)
    expect(result.nodes.map((node) => node.status)).toEqual(['done', 'done', 'done'])

    // 值经两跳：internalId(M-1) → detail.query.id → materialCode(CODE-9) → create.body…
    const createRequest = seen.find((entry) => entry.url.startsWith('/api/orders'))
    expect(JSON.parse(createRequest?.body ?? '{}')).toMatchObject({
      lines: [{ materialId: 'CODE-9' }],
    })
    // 依赖未满足不提前发请求：真实发出顺序 = 拓扑序。
    expect(seen.map((entry) => entry.url.split('?')[0])).toEqual([
      '/api/materials', '/api/materials/detail', '/api/orders',
    ])

    // 每节点恰好一条 start + 一条终态。
    const steps = (loadRunEvents(deps.dataRoot, result.runId) ?? []).filter((event) => event.event === 'step')
    for (const nodeId of plan.order) {
      const mine = steps.filter((event) => event.id === nodeId)
      expect(mine.filter((event) => event.status === 'start')).toHaveLength(1)
      expect(mine.filter((event) => event.status === 'done' || event.status === 'error')).toHaveLength(1)
    }
  })

  it('run.json 先于第一个请求落盘，且是 chain-run 快照', async () => {
    seen = []
    const deps = depsOf()
    const doc = happyDoc()
    const cards = cardsOf(searchCard, createCard)
    const plan = planOf(doc, cards, { keyword: '螺丝' })
    const input = { doc, cards, plan, inputs: { keyword: '螺丝' }, baseUrl: base }

    const prepared = prepareChainRun(deps, input)
    const record = readRunRecord(deps.dataRoot, prepared.runId)
    expect(record).toBeDefined()
    expect(record?.['kind']).toBe('chain-run')
    expect(record?.['flow']).toBe('采购下单')
    expect(record?.['dryRun']).toBe(false)
    expect(record?.['planned']).toEqual(['query-material', 'create-order'])
    expect(record?.['chain']).toMatchObject({ site: '测试站点', flow: '采购下单', version: 2 })
    // 起点写完还没发出任何请求。
    expect(seen).toHaveLength(0)

    const result = await executeChainRun(deps, prepared, input)
    expect(result.ok).toBe(true)
    expect(seen.length).toBeGreaterThan(0)
  })

  it('并发：两个无依赖节点同时发出（并发 2 明显快于串行）', async () => {
    const deps = depsOf()
    const cards = cardsOf(slowACard, slowBCard)
    const doc = chainOf([
      { id: 'a-node', card: 'card_slow_a', constants: {} },
      { id: 'b-node', card: 'card_slow_b', constants: {} },
    ])
    const plan = planOf(doc, cards)
    const startedAt = Date.now()
    const result = await runChain(deps, { doc, cards, plan, baseUrl: base, concurrency: 2 })
    const elapsed = Date.now() - startedAt

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.summary.stepsDone).toBe(2)
    // 串行要 ≥ 500ms；并发 2 应落在单次耗时附近。
    expect(elapsed).toBeLessThan(450)
  })

  it('就绪节点按 id 字典序取：并发 1 时先发 a-node 后发 b-node', async () => {
    seen = []
    const deps = depsOf()
    const cards = cardsOf(slowACard, slowBCard)
    // 故意声明成 b 在前、a 在后：调度顺序只由 id 字典序决定，与文件顺序无关。
    const doc = chainOf([
      { id: 'b-node', card: 'card_slow_b', constants: {} },
      { id: 'a-node', card: 'card_slow_a', constants: {} },
    ])
    const plan = planOf(doc, cards)
    await runChain(deps, { doc, cards, plan, baseUrl: base, concurrency: 1 })

    expect(seen.map((entry) => entry.url)).toEqual(['/api/slow-a', '/api/slow-b'])
  })
})

/* ================================================================== 凭证注入（R-4 M1） */

describe('凭证注入：cookie 只进出站请求，不进入任何留痕', () => {
  it('cookie-session 卡：请求带上注入的 cookie，事件全文扫不到值', async () => {
    seen = []
    const deps = depsOf()
    const cards = cardsOf(cookieCard)
    const doc = chainOf([{ id: 'cookie-node', card: 'card_cookie', constants: {} }])
    const plan = planOf(doc, cards)

    const result = await runChain(deps, {
      doc,
      cards,
      plan,
      baseUrl: base,
      credentials: providerOf('sid=SECRET-123'),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.summary.status).toBe('completed')

    // 服务端真的收到了 cookie。
    expect(seen[0]?.headers.cookie).toBe('sid=SECRET-123')

    const events = loadRunEvents(deps.dataRoot, result.runId) ?? []
    const text = JSON.stringify(events)
    expect(text).not.toContain('SECRET-123')
    // 摘要里能回答「带了哪个名字」，但不含值。
    const start = events.find((event) => event.event === 'step' && event.status === 'start' && event.id === 'cookie-node')
    expect(start?.data?.['credentials']).toMatchObject({
      status: 'applied',
      names: ['sid'],
      header: 'cookie',
    })
    // 请求摘要里的 cookie 头已打码。
    const digest = start?.data?.['request'] as { headers?: Record<string, string> } | undefined
    expect(digest?.headers?.['cookie']).toBe('***')
  })

  it('provider 缺席：行为与 R-3 完全一致（不发 cookie、无 credentials 摘要）', async () => {
    seen = []
    const deps = depsOf()
    const cards = cardsOf(cookieCard)
    const doc = chainOf([{ id: 'cookie-node', card: 'card_cookie', constants: {} }])
    const plan = planOf(doc, cards)

    const result = await runChain(deps, { doc, cards, plan, baseUrl: base })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(seen[0]?.headers.cookie).toBeUndefined()
    const events = loadRunEvents(deps.dataRoot, result.runId) ?? []
    const start = events.find((event) => event.event === 'step' && event.status === 'start' && event.id === 'cookie-node')
    expect(start?.data?.['credentials']).toBeUndefined()
  })

  it('注入了但仍 401：诊断说清「已注入 N 个 cookie」，不再推给「凭证注入是 R-4 的事」', async () => {
    seen = []
    const deps = depsOf()
    const cards = cardsOf(authOnlyCard)
    const doc = chainOf([{ id: 'auth-node', card: 'card_auth_only', constants: {} }])
    const plan = planOf(doc, cards)

    const result = await runChain(deps, {
      doc,
      cards,
      plan,
      baseUrl: base,
      credentials: providerOf('sid=STALE'),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.summary.status).toBe('failed')
    expect(result.failedNode).toBe('auth-node')
    const node = result.nodes.find((candidate) => candidate.nodeId === 'auth-node')
    expect(node?.errorCode).toBe('node-auth-required')
    expect(node?.error).toContain('已注入 1 个 cookie')
    expect(node?.error).toContain('relogin 登录链自动换票')
    expect(node?.credentials?.status).toBe('applied')
  })

  it('没有可用凭证时 401：诊断说清「没有注入」以及原因', async () => {
    seen = []
    const deps = depsOf()
    const cards = cardsOf(authOnlyCard)
    const doc = chainOf([{ id: 'auth-node', card: 'card_auth_only', constants: {} }])
    const plan = planOf(doc, cards)

    const result = await runChain(deps, {
      doc,
      cards,
      plan,
      baseUrl: base,
      credentials: emptyProvider,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const node = result.nodes.find((candidate) => candidate.nodeId === 'auth-node')
    expect(node?.errorCode).toBe('node-auth-required')
    expect(node?.error).toContain('没有注入可用凭证')
    expect(node?.error).toContain('没有匹配')
  })
})

/* ================================================================== 自动换票（R-4 M2） */

describe('自动换票：401 → 登录链 → 新 cookie → 重放一次', () => {
  const specOf = (overrides: Partial<ReloginSpec> = {}): ReloginSpec => ({
    site: '登录站点',
    flow: '登录',
    inputs: { user: 'u', pass: 'p' },
    ...overrides,
  })

  it('换票成功后重放当前节点：服务端先见旧 cookie、再见新 cookie', async () => {
    seen = []
    const calls: ReloginSpec[] = []
    const runner: ReloginRunner = async (spec) => {
      calls.push(spec)
      return { ok: true, cookieHeader: 'sid=fresh', cookieNames: ['sid'], runId: 'chain-login-1' }
    }
    const deps = depsOf()
    const cards = cardsOf(protectedCard)
    const doc = chainOf([{ id: 'protected-node', card: 'card_protected', constants: {} }])
    const plan = planOf(doc, cards)

    const result = await runChain(deps, {
      doc,
      cards,
      plan,
      baseUrl: base,
      credentials: providerOf('sid=stale'),
      relogin: { spec: specOf(), run: runner },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.summary.status).toBe('completed')
    expect(calls).toHaveLength(1)
    expect(seen.map((entry) => entry.headers.cookie)).toEqual(['sid=stale', 'sid=fresh'])
    const node = result.nodes[0]
    expect(node?.attempts).toBe(2)
    expect(node?.relogin).toMatchObject({ attempted: true, success: true, runId: 'chain-login-1', cookieNames: ['sid'] })

    const events = loadRunEvents(deps.dataRoot, result.runId) ?? []
    const text = JSON.stringify(events)
    expect(text).not.toContain('sid=fresh')
    expect(text).not.toContain('sid=stale')
  })

  it('并发节点同时 401：登录链只执行一次，两个节点都重放', async () => {
    seen = []
    let calls = 0
    const runner: ReloginRunner = async () => {
      calls += 1
      await new Promise((resolve) => setTimeout(resolve, 50))
      return { ok: true, cookieHeader: 'sid=fresh', cookieNames: ['sid'] }
    }
    const deps = depsOf()
    const cards = cardsOf(protectedCard)
    const doc = chainOf([
      { id: 'a-node', card: 'card_protected', constants: {} },
      { id: 'b-node', card: 'card_protected', constants: {} },
    ])
    const plan = planOf(doc, cards)

    const result = await runChain(deps, {
      doc,
      cards,
      plan,
      baseUrl: base,
      concurrency: 2,
      credentials: providerOf('sid=stale'),
      relogin: { spec: specOf(), run: runner },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.summary.status).toBe('completed')
    expect(calls).toBe(1)
    expect(result.nodes.every((node) => node.status === 'done')).toBe(true)
    // 至少有一次重放带上了新 cookie；另一个节点可能直接吃到换票后的 runtime cookie。
    expect(seen.some((entry) => entry.headers.cookie === 'sid=fresh')).toBe(true)
  })

  it('登录链失败 → 中止主链，错误码 relogin-failed 且明确「需人工重新登录」', async () => {
    seen = []
    const runner: ReloginRunner = async () => ({
      ok: false,
      code: 'relogin-failed',
      message: '账号被锁',
      runId: 'chain-login-failed',
    })
    const deps = depsOf()
    const cards = cardsOf(protectedCard)
    const doc = chainOf([{ id: 'protected-node', card: 'card_protected', constants: {} }])
    const plan = planOf(doc, cards)

    const result = await runChain(deps, {
      doc,
      cards,
      plan,
      baseUrl: base,
      credentials: providerOf('sid=stale'),
      relogin: { spec: specOf(), run: runner },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.summary.status).toBe('failed')
    expect(result.failedNode).toBe('protected-node')
    const node = result.nodes[0]
    expect(node?.errorCode).toBe('relogin-failed')
    expect(node?.error).toContain('需人工重新登录')
    expect(node?.relogin).toMatchObject({ attempted: true, success: false, code: 'relogin-failed', runId: 'chain-login-failed' })
    expect(seen).toHaveLength(1)
  })

  it('换票成功但重放仍 401 → node-auth-required，消息说清「已换票并重放」', async () => {
    seen = []
    const runner: ReloginRunner = async () => ({ ok: true, cookieHeader: 'sid=fresh', cookieNames: ['sid'] })
    const deps = depsOf()
    const cards = cardsOf(authOnlyCard)
    const doc = chainOf([{ id: 'auth-node', card: 'card_auth_only', constants: {} }])
    const plan = planOf(doc, cards)

    const result = await runChain(deps, {
      doc,
      cards,
      plan,
      baseUrl: base,
      credentials: providerOf('sid=stale'),
      relogin: { spec: specOf(), run: runner },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const node = result.nodes[0]
    expect(node?.errorCode).toBe('node-auth-required')
    expect(node?.error).toContain('已自动换票')
    expect(node?.error).toContain('重放')
    expect(node?.relogin?.success).toBe(true)
    expect(seen).toHaveLength(2)
  })

  it('登录链 = 主链自身 → relogin-cycle，登录链一次都不执行', async () => {
    seen = []
    let calls = 0
    const runner: ReloginRunner = async () => {
      calls += 1
      return { ok: true, cookieHeader: 'sid=fresh', cookieNames: ['sid'] }
    }
    const deps = depsOf()
    const cards = cardsOf(authOnlyCard)
    const doc = chainOf([{ id: 'auth-node', card: 'card_auth_only', constants: {} }])
    const plan = planOf(doc, cards)

    const result = await runChain(deps, {
      doc,
      cards,
      plan,
      baseUrl: base,
      credentials: providerOf('sid=stale'),
      relogin: { spec: specOf({ site: '测试站点', flow: '采购下单' }), run: runner },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const node = result.nodes[0]
    expect(node?.errorCode).toBe('relogin-cycle')
    expect(node?.error).toContain('不能是当前链自身')
    expect(calls).toBe(0)
    expect(seen).toHaveLength(1)
  })
})

/* ================================================================== 失败语义 */

describe('失败语义：中止调度、指到节点、未启动节点不发 step', () => {
  it('下游 500 → failedNode 指到该节点，依赖它的节点标 skipped 且没有 step 事件', async () => {
    const deps = depsOf()
    const cards = cardsOf(failCard, createCard)
    const doc = chainOf(
      [
        { id: 'bad-node', card: 'card_fail', constants: {} },
        { id: 'tail-node', card: 'card_create', constants: { 'body.orgId': '2120', 'body.lines[0].quantity': '1' } },
      ],
      [{ from: 'bad-node.status', to: 'tail-node.body.lines[0].materialId' }],
    )
    const plan = planOf(doc, cards)

    const result = await runChain(deps, { doc, cards, plan, baseUrl: base })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.failedNode).toBe('bad-node')
    expect(result.summary.status).toBe('failed')
    expect(result.summary.stepsDone).toBe(0)
    expect(result.summary.lastStepId).toBe('bad-node')
    expect(result.summary.lastError).toBe('HTTP 500')

    const failed = result.nodes.find((node) => node.nodeId === 'bad-node')
    expect(failed?.status).toBe('error')
    expect(failed?.errorCode).toBe('node-http-error')
    expect(failed?.httpStatus).toBe(500)
    expect(failed?.responseDigest?.bodyPreview).toBe('boom')

    const skipped = result.nodes.find((node) => node.nodeId === 'tail-node')
    expect(skipped?.status).toBe('skipped')

    const events = loadRunEvents(deps.dataRoot, result.runId) ?? []
    const touched = events.filter((event) => event.event === 'step').map((event) => event.id)
    expect(touched).toEqual(['bad-node', 'bad-node'])
    const terminal = events.find((event) => event.event === 'terminal')
    expect(terminal?.success).toBe(false)
    expect(String(terminal?.message)).toContain('bad-node')
    expect(String(terminal?.message)).toContain('node-http-error')
  })

  it('绑定取不到值 → binding-path-not-found 指到绑定边，请求不发', async () => {
    seen = []
    const deps = depsOf()
    const cards = cardsOf(searchCard, createCard)
    const doc = chainOf(
      [
        { id: 'query-material', card: 'card_search', constants: { 'query.orgId': '2120', 'query.q': 'x' } },
        { id: 'create-order', card: 'card_create', constants: { 'body.lines[0].quantity': '1', 'body.orgId': '2120' } },
      ],
      // 卡片模板里没有 body.missingField：上游响应里自然取不到。
      [{ from: 'query-material.body.missingField', to: 'create-order.body.lines[0].materialId' }],
    )
    const plan = planOf(doc, cards)
    const result = await runChain(deps, { doc, cards, plan, baseUrl: base })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.failedNode).toBe('create-order')
    const node = result.nodes.find((candidate) => candidate.nodeId === 'create-order')
    expect(node?.errorCode).toBe('binding-path-not-found')
    expect(node?.bindings[0]?.code).toBe('binding-path-not-found')
    // 上游发了，下游没发。
    expect(seen.map((entry) => entry.url)).toEqual(['/api/materials?q=x&orgId=2120'])
  })

  it('正文超上限且下游要读 body → response-too-large（不硬解析半截 JSON）', async () => {
    const deps: ChainRunDeps = { ...depsOf(), config: { ...CONFIG, responseLimitBytes: 64 } }
    const cards = cardsOf(bigCard, createCard)
    const doc = chainOf(
      [
        { id: 'big-node', card: 'card_big', constants: {} },
        { id: 'tail-node', card: 'card_create', constants: { 'body.orgId': '2120', 'body.lines[0].quantity': '1' } },
      ],
      [{ from: 'big-node.body.items[0].internalId', to: 'tail-node.body.lines[0].materialId' }],
    )
    const plan = planOf(doc, cards)
    const result = await runChain(deps, { doc, cards, plan, baseUrl: base })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.failedNode).toBe('big-node')
    const node = result.nodes.find((candidate) => candidate.nodeId === 'big-node')
    expect(node?.errorCode).toBe('response-too-large')
    expect(node?.responseDigest?.truncated).toBe(true)
  })
})

/* ================================================================== dry-run */

describe('dry-run：永不发请求，但仍落一条留痕', () => {
  it('一个请求都不发，run.json 标 dryRun，summary 完成', async () => {
    seen = []
    const deps = depsOf()
    const doc = happyDoc()
    const cards = cardsOf(searchCard, createCard)
    const plan = planOf(doc, cards, { keyword: '螺丝' })

    const result = await runChain(deps, {
      doc, cards, plan, inputs: { keyword: '螺丝' }, baseUrl: base, dryRun: true,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(seen).toHaveLength(0)
    expect(result.summary.status).toBe('completed')
    expect(result.summary.dryRun).toBe(true)
    expect(result.summary.totalSteps).toBe(2)
    expect(result.summary.stepsDone).toBe(0)
    expect(readRunRecord(deps.dataRoot, result.runId)?.['dryRun']).toBe(true)

    const events = loadRunEvents(deps.dataRoot, result.runId) ?? []
    expect(events.filter((event) => event.event === 'step')).toHaveLength(0)
    expect(events.map((event) => event.event)).toEqual(['meta', 'terminal', 'result'])
  })

  it('同一份输入的 dry-run 计划两次完全一致（可复现）', async () => {
    const deps = depsOf()
    const doc = happyDoc()
    const cards = cardsOf(searchCard, createCard)
    const inputs = { keyword: '螺丝' }
    const first = await runChain(deps, { doc, cards, plan: planOf(doc, cards, inputs), inputs, baseUrl: base, dryRun: true })
    const second = await runChain(deps, { doc, cards, plan: planOf(doc, cards, inputs), inputs, baseUrl: base, dryRun: true })

    expect(first.ok && second.ok).toBe(true)
    const read = (runId: string): unknown => (loadRunEvents(deps.dataRoot, runId) ?? [])
      .map((event) => ({ ...event, ts: undefined }))
    if (first.ok && second.ok) expect(read(first.runId)).toEqual(read(second.runId))
  })
})

/* ================================================================== 取消 */

describe('取消：在飞请求中止，终态收敛 killed', () => {
  it('abort 后节点标 cancelled，summary 是 killed', async () => {
    const deps = depsOf()
    const cards = cardsOf(hangCard)
    const doc = chainOf([{ id: 'hang-node', card: 'card_hang', constants: {} }])
    const plan = planOf(doc, cards)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 80)
    const result = await runChain(deps, { doc, cards, plan, baseUrl: base, signal: controller.signal })
    clearTimeout(timer)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.cancelled).toBe(true)
    expect(result.summary.status).toBe('killed')
    const node = result.nodes.find((candidate) => candidate.nodeId === 'hang-node')
    expect(node?.status).toBe('cancelled')
    expect(node?.errorCode).toBe('cancelled')

    const events = loadRunEvents(deps.dataRoot, result.runId) ?? []
    const terminal = events.find((event) => event.event === 'terminal')
    expect(terminal?.cancelled).toBe(true)
    expect(terminal?.success).toBe(false)
    expect(foldSummary(result.runId, events).status).toBe('killed')
  })
})

/* ================================================================== 小工具 */

describe('小工具', () => {
  it('clampConcurrency：非法值回默认，越界夹到 [1,16]', () => {
    expect(clampConcurrency(undefined, 4)).toBe(4)
    expect(clampConcurrency(Number.NaN, 4)).toBe(4)
    expect(clampConcurrency(0, 4)).toBe(1)
    expect(clampConcurrency(-3, 4)).toBe(1)
    expect(clampConcurrency(99, 4)).toBe(16)
    expect(clampConcurrency(2.7, 4)).toBe(2)
  })

  it('previewText：≤ 4 KiB 原样，超限按字节截断', () => {
    expect(previewText('short')).toBe('short')
    const long = 'y'.repeat(5000)
    expect(Buffer.byteLength(previewText(long), 'utf8')).toBe(4096)
  })

  it('runId 唯一：同一毫秒同名流程撞名自动加后缀', async () => {
    const deps = depsOf()
    const doc = happyDoc()
    const cards = cardsOf(searchCard, createCard)
    const plan = planOf(doc, cards, { keyword: 'k' })
    const input = { doc, cards, plan, inputs: { keyword: 'k' }, baseUrl: base, runId: 'chain-fixed-1' }
    prepareChainRun(deps, input)
    const second = prepareChainRun(deps, { ...input, runId: undefined })
    expect(second.runId).not.toBe('chain-fixed-1')
    expect(second.runId.startsWith('chain-')).toBe(true)
  })

  it('run.json 是合法 JSON 且含 runId（startRunRecord 的写入形状）', () => {
    const deps = depsOf()
    const doc = happyDoc()
    const cards = cardsOf(searchCard, createCard)
    const plan = planOf(doc, cards, { keyword: 'k' })
    const prepared = prepareChainRun(deps, { doc, cards, plan, inputs: { keyword: 'k' }, baseUrl: base })
    const parsed = JSON.parse(readFileSync(join(prepared.runDir, 'run.json'), 'utf8')) as Record<string, unknown>
    expect(parsed['runId']).toBe(prepared.runId)
    expect(parsed['kind']).toBe('chain-run')
    expect(parsed['concurrency']).toBe(4)
  })
})
