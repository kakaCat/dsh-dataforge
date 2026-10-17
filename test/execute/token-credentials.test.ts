/**
 * token 型凭证注入（R-4 M3）：采集库 kind=token → provider → 真实 HTTP 请求。
 *
 * 全组真起本地 http server（不 mock fetch），验的是**发出去的事实**与**留痕的零泄漏**：
 *   - token-header：`Authorization` 原样注入（Bearer/Basic 都保留）；
 *   - token-param：query 参数正确编码后拼进 URL；
 *   - body token：provider 如实 unsupported，一个请求都不带错值；
 *   - 401 文案区分「注入了 token 仍 401」与「token 未采集」；
 *   - events.ndjson + 工具回执投影（NodeResult[]）里 token 原文零命中。
 *
 * @module dsh-dataforge/test/execute/token-credentials
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CaptureStore } from '../../src/capture/store.js'
import { createCaptureCredentialProvider } from '../../src/capture/credentials.js'
import type { ChainDoc, InterfaceCardDoc } from '../../src/chains/schema.js'
import { buildPlan } from '../../src/execute/plan.js'
import { runChain, type ChainRunDeps, type ChainRunConfig } from '../../src/execute/run.js'
import {
  redactSecretsInText,
  redactSecretValues,
  withQueryParams,
} from '../../src/execute/credentials.js'
import { loadRunEvents } from '../../src/runs/store.js'

const NOW = 1_700_000_000_000
const CONFIG: ChainRunConfig = {
  enabled: true,
  nodeTimeoutSeconds: 5,
  concurrency: 1,
  responseLimitBytes: 2_097_152,
}

/* ================================================================== 本地服务端 */

let server: Server
let base = ''
let seen: Array<{ url: string; headers: Record<string, string | string[] | undefined> }> = []

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? '/'
    seen.push({ url, headers: req.headers })
    const parsed = new URL(url, 'http://127.0.0.1')
    if (parsed.pathname === '/api/unauthorized') {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end('{"error":"login required"}')
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    if (parsed.pathname === '/api/token-header') {
      // 服务端把收到的 Authorization 原样回显：验证留痕的二次脱敏。
      res.end(JSON.stringify({ authorization: req.headers.authorization ?? '' }))
      return
    }
    if (parsed.pathname === '/api/token-param') {
      res.end(JSON.stringify({ token: parsed.searchParams.get('access_token') ?? '' }))
      return
    }
    res.end('{"ok":true}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

/* ================================================================== 夹具 */

function storeOf(): { store: CaptureStore; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'token-cred-'))
  const dbPath = join(dir, 'capture.sqlite')
  const store = new CaptureStore(dbPath, join(dir, 'samples'), join(dir, 'events.ndjson'))
  store.upsertRun({
    id: 'cap_1',
    taskType: 'single_page',
    entryUrl: `${base}/page`,
    status: 'done',
    startedAt: 1,
    stats: { pages: 0, requests: 0, cards: 0, credentials: 0 },
  })
  return { store, dbPath }
}

function addToken(
  store: CaptureStore,
  token: { location: 'header' | 'query' | 'body'; name: string; value: string },
  obtainedAt = NOW,
): void {
  store.upsertCredential('cap_1', 'token', `${base}/capture`, `${token.location}:${token.name.toLowerCase()}`, obtainedAt, token)
}

function cardOf(overrides: Partial<InterfaceCardDoc> & { authEvidence?: string } = {}): InterfaceCardDoc {
  return {
    cardId: 'card_1',
    kind: 'interface-card',
    identity: { mergeKey: 'GET /api/token-header', method: 'GET', urlTemplate: '/api/token-header' },
    inputs: [],
    outputs: [],
    auth: 'token-header',
    sources: [{ captureId: 'cap_1', pages: [`${base}/page`] }],
    ...overrides,
  } as InterfaceCardDoc
}

function docOf(card: InterfaceCardDoc): ChainDoc {
  const method = card.identity.method
  const template = card.identity.urlTemplate
  return {
    apiVersion: 'dataforge/v1',
    kind: 'interface-chain',
    meta: { site: 'token 测试', flow: '注入', version: 1, created: '2026-10-17T00:00:00Z' },
    inputs: [],
    nodes: [{ id: 'n1', card: card.cardId, constants: {} }],
    edges: [],
    ...{ method, template },
  } as unknown as ChainDoc
}

function depsOf(): ChainRunDeps {
  return { dataRoot: mkdtempSync(join(tmpdir(), 'token-cred-run-')), config: CONFIG }
}

async function runWith(
  card: InterfaceCardDoc,
  provider: ReturnType<typeof createCaptureCredentialProvider> | undefined,
): Promise<{ result: Awaited<ReturnType<typeof runChain>>; deps: ChainRunDeps }> {
  const doc = docOf(card)
  const cards = new Map([[card.cardId, card]])
  const planned = buildPlan(doc, cards, {}, base)
  if (!planned.ok) throw new Error(`计划编译失败：${planned.code} ${planned.message}`)
  const deps = depsOf()
  const result = await runChain(deps, {
    doc,
    cards,
    plan: planned.plan,
    baseUrl: base,
    ...(provider === undefined ? {} : { credentials: provider }),
  })
  return { result, deps }
}

/** 递归读一个目录下所有文件文本（零泄漏扫描门：run.json + events.ndjson 等）。 */
function readTree(root: string): string {
  const chunks: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else chunks.push(readFileSync(path, 'utf8'))
    }
  }
  walk(root)
  return chunks.join('\n')
}

/* ================================================================== 纯函数（M3 扩展） */

describe('withQueryParams：token-param 的 URL 拼接', () => {
  it('正确 URL 编码，同名参数覆盖，其它参数保留', () => {
    const url = withQueryParams('https://a.example.com/api?page=2&access_token=old', {
      access_token: 'a b&c=d',
    })
    const parsed = new URL(url)
    expect(parsed.searchParams.get('access_token')).toBe('a b&c=d')
    expect(parsed.searchParams.get('page')).toBe('2')
    // 编码形态是 URL 的序列化，不是手拼字符串。
    expect(url).toContain('access_token=a+b%26c%3Dd')
    expect(url).not.toContain('old')
  })

  it('非法 URL / 空参数 / 非 http(s) 原样返回', () => {
    expect(withQueryParams('not a url', { token: 'x' })).toBe('not a url')
    expect(withQueryParams('https://a.example.com/api', {})).toBe('https://a.example.com/api')
    expect(withQueryParams('file:///tmp/x', { token: 'x' })).toBe('file:///tmp/x')
  })
})

describe('redactSecretValues / redactSecretsInText：留痕二次脱敏', () => {
  it('过滤过短值、去重、按长度降序', () => {
    expect(redactSecretValues(['abcd', 'abc', 'abcdef', 'abcd', undefined, null])).toEqual(['abcdef', 'abcd'])
  })

  it('文本替换：长值先替换，短值不会留下半截', () => {
    const text = '{"auth":"Bearer abcdef","token":"abcdef"}'
    expect(redactSecretsInText(text, ['abcdef', 'Bearer abcdef'])).toBe('{"auth":"***","token":"***"}')
  })

  it('空敏感集合原样返回（不把正常文本打碎）', () => {
    expect(redactSecretsInText('normal body', [])).toBe('normal body')
    expect(redactSecretsInText('normal body', ['abc'])).toBe('normal body')
  })
})

/* ================================================================== 用例 */

describe('token-header：Authorization 原样注入，留痕零泄漏', () => {
  it('Bearer token 命中真实请求头；事件/回执/响应回显里都没有原文', async () => {
    seen = []
    const { store, dbPath } = storeOf()
    addToken(store, { location: 'header', name: 'authorization', value: 'Bearer SECRET-TOKEN' })
    const provider = createCaptureCredentialProvider({ dbPath, now: () => NOW })

    const { result, deps } = await runWith(cardOf({ cardId: 'card_h' }), provider)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.summary.status).toBe('completed')
    expect(seen).toHaveLength(1)
    expect(seen[0]?.headers.authorization).toBe('Bearer SECRET-TOKEN')

    const node = result.nodes.find((candidate) => candidate.nodeId === 'n1')
    expect(node?.credentials).toMatchObject({
      status: 'applied',
      header: 'authorization',
      names: ['authorization'],
    })
    // 请求摘要里 authorization 头恒为 ***。
    expect(node?.requestDigest.headers['authorization']).toBe('***')

    const events = JSON.stringify(loadRunEvents(deps.dataRoot, result.runId) ?? [])
    expect(events).not.toContain('SECRET-TOKEN')
    // 响应把 Authorization 回显在正文里：响应摘要同样必须脱敏。
    expect(node?.responseDigest?.bodyPreview).not.toContain('SECRET-TOKEN')
    expect(node?.responseDigest?.bodyPreview).toContain('***')
    // 工具回执投影（compactNodes 用 NodeResult.url/error 等）也不含值。
    expect(JSON.stringify(result.nodes)).not.toContain('SECRET-TOKEN')
    // 整个运行目录（run.json + events.ndjson）零命中。
    expect(readTree(deps.dataRoot)).not.toContain('SECRET-TOKEN')
  })

  it('Basic token 原样保留 scheme，不被改写', async () => {
    seen = []
    const { store, dbPath } = storeOf()
    addToken(store, { location: 'header', name: 'authorization', value: 'Basic dXNlcjpwYXNz' })
    const provider = createCaptureCredentialProvider({ dbPath, now: () => NOW })

    const { result } = await runWith(cardOf({ cardId: 'card_basic' }), provider)

    expect(result.ok).toBe(true)
    expect(seen[0]?.headers.authorization).toBe('Basic dXNlcjpwYXNz')
  })
})

describe('token-param：拼 query 且正确编码，留痕零泄漏', () => {
  it('access_token 拼进 URL；摘要按参数名打码', async () => {
    seen = []
    const { store, dbPath } = storeOf()
    addToken(store, { location: 'query', name: 'access_token', value: 'SECRET-QUERY' })
    const provider = createCaptureCredentialProvider({ dbPath, now: () => NOW })

    const card = cardOf({
      cardId: 'card_q',
      auth: 'token-param',
      identity: { mergeKey: 'GET /api/token-param', method: 'GET', urlTemplate: '/api/token-param' },
    })
    const { result, deps } = await runWith(card, provider)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.summary.status).toBe('completed')
    expect(seen[0]?.url).toBe('/api/token-param?access_token=SECRET-QUERY')

    const node = result.nodes.find((candidate) => candidate.nodeId === 'n1')
    expect(node?.credentials).toMatchObject({ status: 'applied', header: 'query', names: ['access_token'] })
    // 留痕里参数名在、值不在。
    expect(node?.url).toContain('access_token=***')
    expect(node?.url).not.toContain('SECRET-QUERY')
    expect(node?.requestDigest.url).not.toContain('SECRET-QUERY')

    const events = JSON.stringify(loadRunEvents(deps.dataRoot, result.runId) ?? [])
    expect(events).not.toContain('SECRET-QUERY')
    // 服务端把 token 回显在响应正文里：响应摘要同样脱敏。
    expect(node?.responseDigest?.bodyPreview).not.toContain('SECRET-QUERY')
    expect(JSON.stringify(result.nodes)).not.toContain('SECRET-QUERY')
    expect(readTree(deps.dataRoot)).not.toContain('SECRET-QUERY')
  })

  it('值含空格/& 等特殊字符时按 URL 编码拼参数', async () => {
    seen = []
    const { store, dbPath } = storeOf()
    addToken(store, { location: 'query', name: 'access_token', value: 'a b&c=d' })
    const provider = createCaptureCredentialProvider({ dbPath, now: () => NOW })
    const card = cardOf({
      cardId: 'card_q2',
      auth: 'token-param',
      identity: { mergeKey: 'GET /api/token-param', method: 'GET', urlTemplate: '/api/token-param' },
    })

    const { result } = await runWith(card, provider)

    expect(result.ok).toBe(true)
    // 服务端解析回原值（URLSearchParams 自动解码）。
    expect(seen[0]?.url).toBe('/api/token-param?access_token=a+b%26c%3Dd')
  })
})

describe('body token：本期如实 unsupported，不猜注入位置', () => {
  it('evidence=body:access_token → provider 标 unsupported，请求不带 token', async () => {
    seen = []
    const { store, dbPath } = storeOf()
    addToken(store, { location: 'body', name: 'access_token', value: 'SECRET-BODY' })
    const provider = createCaptureCredentialProvider({ dbPath, now: () => NOW })
    const card = cardOf({
      cardId: 'card_body',
      auth: 'token-param',
      ...{ authEvidence: 'body:access_token' },
    } as Partial<InterfaceCardDoc>)

    const { result } = await runWith(card, provider)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const node = result.nodes.find((candidate) => candidate.nodeId === 'n1')
    expect(node?.credentials?.status).toBe('unsupported')
    expect(node?.credentials?.reason).toContain('body')
    expect(seen[0]?.headers.authorization).toBeUndefined()
    expect(seen[0]?.url).not.toContain('access_token')
  })

  it('没有 evidence、只采到 body token → 仍如实 unsupported 并说明 body', async () => {
    seen = []
    const { store, dbPath } = storeOf()
    addToken(store, { location: 'body', name: 'access_token', value: 'SECRET-BODY-2' })
    const provider = createCaptureCredentialProvider({ dbPath, now: () => NOW })
    const card = cardOf({
      cardId: 'card_body2',
      auth: 'token-param',
      identity: { mergeKey: 'GET /api/token-header', method: 'GET', urlTemplate: '/api/token-header' },
    })

    const { result } = await runWith(card, provider)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const node = result.nodes.find((candidate) => candidate.nodeId === 'n1')
    expect(node?.credentials?.status).toBe('unsupported')
    expect(node?.credentials?.reason).toContain('body')
    expect(seen[0]?.url).not.toContain('access_token')
  })
})

describe('401 文案：区分「注入了 token 仍 401」与「token 未采集」', () => {
  it('注入了 token 仍 401：说清已注入什么', async () => {
    const { store, dbPath } = storeOf()
    addToken(store, { location: 'header', name: 'authorization', value: 'Bearer STALE' })
    const provider = createCaptureCredentialProvider({ dbPath, now: () => NOW })
    const card = cardOf({
      cardId: 'card_401',
      identity: { mergeKey: 'GET /api/unauthorized', method: 'GET', urlTemplate: '/api/unauthorized' },
    })

    const { result } = await runWith(card, provider)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const node = result.nodes.find((candidate) => candidate.nodeId === 'n1')
    expect(node?.errorCode).toBe('node-auth-required')
    expect(node?.error).toContain('已注入 authorization 头')
    expect(node?.error).toContain('但仍被拒')
    expect(node?.error).not.toContain('STALE')
  })

  it('token 未采集：说清「token 型凭证未采集」而不是笼统的没有凭证', async () => {
    const { store, dbPath } = storeOf()
    // 只有 cookie 行，没有 token 行。
    store.upsertCredential('cap_1', 'cookie', '.example.com', 'sid', NOW, {
      name: 'sid',
      value: 'SESSION',
      domain: '.example.com',
      path: '/',
      expires: -1,
    })
    const provider = createCaptureCredentialProvider({ dbPath, now: () => NOW })
    const card = cardOf({
      cardId: 'card_401b',
      identity: { mergeKey: 'GET /api/unauthorized', method: 'GET', urlTemplate: '/api/unauthorized' },
    })

    const { result } = await runWith(card, provider)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const node = result.nodes.find((candidate) => candidate.nodeId === 'n1')
    expect(node?.errorCode).toBe('node-auth-required')
    expect(node?.error).toContain('token 型凭证未采集')
    expect(node?.credentials?.status).toBe('unsupported')
  })
})
