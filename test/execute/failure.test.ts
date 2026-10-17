/**
 * 失败语义（IF-3 运行期错误码 / FR-3.5）：超时、网络错、鉴权缺口、重试边界。
 *
 * 这一组全都要真打网络：错误分类靠的是运行时行为（连接被拒、超时、状态码），
 * mock fetch 会把「分类对不对」这件事本身也 mock 掉。
 *
 * @module dsh-dataforge/test/execute/failure
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChainDoc, InterfaceCardDoc } from '../../src/chains/schema.js'
import { buildPlan, type ExecutionPlan } from '../../src/execute/plan.js'
import { runChain, type ChainRunDeps, type ChainRunConfig } from '../../src/execute/run.js'
import { loadRunEvents } from '../../src/runs/store.js'

let server: Server
let base = ''
/** 一直不回的响应：关服务前必须主动断开，否则 afterAll 会挂住。 */
const hanging: ServerResponse[] = []
/** 每个路径收到的次数（验证重试边界）。 */
let hits = new Map<string, number>()

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0] ?? '/'
    hits.set(url, (hits.get(url) ?? 0) + 1)
    req.resume()
    if (url === '/api/never') {
      hanging.push(res)
      return
    }
    if (url === '/api/flaky' || url === '/api/flaky-post') {
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end('flaky')
      return
    }
    if (url === '/api/unauthorized') {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end('{"error":"login required"}')
      return
    }
    if (url === '/api/forbidden') {
      res.writeHead(403, { 'content-type': 'text/plain' })
      res.end('forbidden')
      return
    }
    if (url === '/api/methods') {
      res.writeHead(405, { 'content-type': 'text/plain' })
      res.end('method not allowed')
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"ok":true}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  for (const res of hanging) res.socket?.destroy()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

/* ================================================================== 夹具 */

const CONFIG: ChainRunConfig = {
  enabled: true,
  nodeTimeoutSeconds: 30,
  concurrency: 2,
  responseLimitBytes: 2_097_152,
}

function card(cardId: string, method: string, urlTemplate: string, auth?: string): InterfaceCardDoc {
  return {
    cardId,
    kind: 'interface-card',
    identity: { mergeKey: `${method} ${urlTemplate}`, method, urlTemplate },
    inputs: [],
    outputs: [],
    ...(auth === undefined ? {} : { auth }),
    sources: [{ captureId: 'cap_1', pages: [`${base}/page`] }],
  }
}

function docOf(nodes: ChainDoc['nodes'], cards: InterfaceCardDoc[]): ChainDoc {
  return {
    apiVersion: 'dataforge/v1',
    kind: 'interface-chain',
    meta: { site: '测试站点', flow: '失败语义', version: 1, created: '2026-10-17T00:00:00Z' },
    inputs: [],
    nodes,
    edges: [],
    ...{ cards },
  } as ChainDoc
}

function planOf(doc: ChainDoc, cards: Map<string, InterfaceCardDoc>, baseUrl = base): ExecutionPlan {
  const planned = buildPlan(doc, cards, {}, baseUrl)
  if (!planned.ok) throw new Error(`夹具不合法：${planned.code} ${planned.message}`)
  return planned.plan
}

function depsOf(config: ChainRunConfig = CONFIG): ChainRunDeps {
  return { dataRoot: mkdtempSync(join(tmpdir(), 'chain-failure-')), config }
}

function cardsOf(...list: InterfaceCardDoc[]): Map<string, InterfaceCardDoc> {
  return new Map(list.map((item) => [item.cardId, item]))
}

async function runOne(
  cardDoc: InterfaceCardDoc,
  nodeOverrides: Partial<ChainDoc['nodes'][number]> = {},
  options: { config?: ChainRunConfig; baseUrl?: string } = {},
): Promise<{ result: Awaited<ReturnType<typeof runChain>>; deps: ChainRunDeps }> {
  const deps = depsOf(options.config)
  const cards = cardsOf(cardDoc)
  const doc = docOf([{ id: 'node-1', card: cardDoc.cardId, constants: {}, ...nodeOverrides }], [cardDoc])
  const planned = buildPlan(doc, cards, {}, options.baseUrl ?? base)
  if (!planned.ok) throw new Error(`夹具不合法：${planned.code} ${planned.message}`)
  const result = await runChain(deps, {
    doc, cards, plan: planned.plan, baseUrl: options.baseUrl ?? base,
  })
  return { result, deps }
}

/* ================================================================== 用例 */

describe('超时：node-timeout', () => {
  it('节点级 timeoutSeconds 覆盖全局缺省（1 秒即中止）', async () => {
    const { result, deps } = await runOne(card('card_never', 'GET', '/api/never'), { timeoutSeconds: 1 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const node = result.nodes[0]
    expect(node?.errorCode).toBe('node-timeout')
    expect(result.summary.lastError).toBe('请求超时（1000ms）')
    const events = loadRunEvents(deps.dataRoot, result.runId) ?? []
    const failed = events.find((event) => event.event === 'step' && event.status === 'error')
    expect(failed?.data?.['code']).toBe('node-timeout')
  }, 10_000)

  it('没有节点级配置时用 config.chainNodeTimeoutSeconds 兜底', async () => {
    const { result } = await runOne(
      card('card_never', 'GET', '/api/never'),
      {},
      { config: { ...CONFIG, nodeTimeoutSeconds: 1 } },
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.nodes[0]?.errorCode).toBe('node-timeout')
  }, 10_000)
})

describe('网络错：node-network-error', () => {
  it('连接被拒 → node-network-error，attempts=1（不重试）', async () => {
    const { result } = await runOne(
      card('card_dead', 'GET', '/api/x'),
      {},
      // 端口 1 上没有服务：ECONNREFUSED。
      { baseUrl: 'http://127.0.0.1:1' },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.nodes[0]?.errorCode).toBe('node-network-error')
    expect(result.nodes[0]?.attempts).toBe(1)
    expect(result.summary.status).toBe('failed')
  })
})

describe('HTTP 4xx/5xx 与鉴权缺口', () => {
  it('500 → node-http-error，带状态码与响应摘要', async () => {
    const { result } = await runOne(card('card_flaky', 'GET', '/api/flaky'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.nodes[0]?.errorCode).toBe('node-http-error')
    expect(result.nodes[0]?.httpStatus).toBe(500)
    expect(result.nodes[0]?.responseDigest?.bodyPreview).toBe('flaky')
  })

  it('405 也算 node-http-error（不是鉴权缺口）', async () => {
    const { result } = await runOne(card('card_methods', 'GET', '/api/methods'))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.nodes[0]?.errorCode).toBe('node-http-error')
  })

  it('401 + 卡声明了鉴权 → node-auth-required（提示 R-4，不换票）', async () => {
    const { result } = await runOne(card('card_auth', 'GET', '/api/unauthorized', 'cookie-session'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const node = result.nodes[0]
    expect(node?.errorCode).toBe('node-auth-required')
    expect(node?.error).toContain('R-4')
  })

  it('403 + 卡没声明鉴权 → 仍是 node-http-error（不谎报缺凭证）', async () => {
    const { result } = await runOne(card('card_plain', 'GET', '/api/forbidden'))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.nodes[0]?.errorCode).toBe('node-http-error')
  })
})

describe('重试边界：只有幂等方法吃 node.retry', () => {
  it('GET + retry=2 → attempts=3', async () => {
    hits = new Map()
    const { result } = await runOne(card('card_flaky', 'GET', '/api/flaky'), { retry: 2 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 最后一次尝试拿到的是 500 响应（可读），所以节点以 node-http-error 收口。
    expect(result.nodes[0]?.attempts).toBe(3)
    expect(hits.get('/api/flaky')).toBe(3)
    expect(result.nodes[0]?.errorCode).toBe('node-http-error')
  }, 15_000)

  it('POST + retry=2 → attempts=1（写方法绝不自动重放）', async () => {
    hits = new Map()
    const { result } = await runOne(card('card_flaky_post', 'POST', '/api/flaky-post'), { retry: 2 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.nodes[0]?.attempts).toBe(1)
    expect(hits.get('/api/flaky-post')).toBe(1)
  })

  it('retry 超过硬上限按 5 封顶', async () => {
    const { result } = await runOne(card('card_flaky', 'GET', '/api/flaky'), { retry: 99 })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.nodes[0]?.attempts).toBe(6)
  }, 20_000)
})
