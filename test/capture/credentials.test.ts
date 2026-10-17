/**
 * 采集库 → 执行期凭证 provider（R-4 M1）：只读、按 captureId 限定、坏行不炸。
 *
 * 这一组用真的 `CaptureStore` 落 SQLite，再用 provider 只读打开——验证的是
 * 「一期的表/字段形状」到「执行期的 CredentialCookie」这一层翻译，不 mock 数据库。
 *
 * @module dsh-dataforge/test/capture/credentials
 */
import { describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CaptureStore } from '../../src/capture/store.js'
import { captureIdsOf, createCaptureCredentialProvider } from '../../src/capture/credentials.js'
import type { ChainDoc, InterfaceCardDoc } from '../../src/chains/schema.js'
import { buildPlan } from '../../src/execute/plan.js'
import { runChain } from '../../src/execute/run.js'

const NOW = 1_700_000_000_000

function cardOf(overrides: Partial<InterfaceCardDoc> = {}): InterfaceCardDoc {
  return {
    cardId: 'card_1',
    kind: 'interface-card',
    identity: { mergeKey: 'GET /api/x', method: 'GET', urlTemplate: '/api/x' },
    inputs: [],
    outputs: [],
    auth: 'cookie-session',
    sources: [{ captureId: 'cap_1', pages: ['https://a.example.com/page'] }],
    ...overrides,
  }
}

function storeOf(): { store: CaptureStore; dir: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'capture-cred-'))
  const dbPath = join(dir, 'capture.sqlite')
  const store = new CaptureStore(dbPath, join(dir, 'samples'), join(dir, 'events.ndjson'))
  store.upsertRun({
    id: 'cap_1',
    taskType: 'single_page',
    entryUrl: 'https://a.example.com/',
    status: 'done',
    startedAt: 1,
    stats: { pages: 0, requests: 0, cards: 0, credentials: 0 },
  })
  return { store, dir, dbPath }
}

function addCookie(
  store: CaptureStore,
  overrides: { captureId?: string; name?: string; value?: string; domain?: string; path?: string; expires?: number; secure?: boolean } = {},
): void {
  const expires = overrides.expires ?? Math.floor((NOW + 60_000) / 1000)
  store.upsertCredential(
    overrides.captureId ?? 'cap_1',
    'cookie',
    overrides.domain ?? '.example.com',
    overrides.name ?? 'sid',
    NOW,
    {
      name: overrides.name ?? 'sid',
      value: overrides.value ?? 'SECRET-1',
      domain: overrides.domain ?? '.example.com',
      path: overrides.path ?? '/',
      secure: overrides.secure ?? false,
      expires,
    },
  )
}

describe('captureIdsOf', () => {
  it('去重、保序、丢空串', () => {
    expect(
      captureIdsOf(
        cardOf({
          sources: [
            { captureId: 'cap_2', pages: [] },
            { captureId: 'cap_1', pages: [] },
            { captureId: 'cap_2', pages: [] },
          ],
        }),
      ),
    ).toEqual(['cap_2', 'cap_1'])
  })
})

describe('createCaptureCredentialProvider：只读采集库并注入', () => {
  it('命中同域 cookie → headers.cookie 有值，摘要不含值', () => {
    const { store, dbPath } = storeOf()
    addCookie(store)
    const provider = createCaptureCredentialProvider({ dbPath, now: () => NOW })

    const resolution = provider({ card: cardOf(), url: 'https://a.example.com/api/x', method: 'GET', nodeId: 'n1' })

    expect(resolution.headers.cookie).toBe('sid=SECRET-1')
    expect(resolution.application.status).toBe('applied')
    expect(resolution.application.names).toEqual(['sid'])
    expect(resolution.application.captureIds).toEqual(['cap_1'])
    expect(JSON.stringify(resolution.application)).not.toContain('SECRET-1')
  })

  it('不匹配的域不注入（A 站 cookie 不发 B 站）', () => {
    const { store, dbPath } = storeOf()
    addCookie(store, { domain: '.other.test' })
    const provider = createCaptureCredentialProvider({ dbPath, now: () => NOW })

    const resolution = provider({ card: cardOf(), url: 'https://a.example.com/api/x', method: 'GET', nodeId: 'n1' })

    expect(resolution.headers).toEqual({})
    expect(resolution.application.status).toBe('none')
    expect(resolution.application.reason).toContain('没有匹配')
  })

  it('全部过期 → status=expired，不注入', () => {
    const { store, dbPath } = storeOf()
    addCookie(store, { expires: Math.floor((NOW - 1_000) / 1000) })
    const provider = createCaptureCredentialProvider({ dbPath, now: () => NOW })

    const resolution = provider({ card: cardOf(), url: 'https://a.example.com/', method: 'GET', nodeId: 'n1' })

    expect(resolution.headers).toEqual({})
    expect(resolution.application.status).toBe('expired')
    expect(resolution.application.expired).toBe(1)
  })

  it('S 站没有来源 captureId 时不做全库兜底', () => {
    const { store, dbPath } = storeOf()
    addCookie(store)
    const provider = createCaptureCredentialProvider({ dbPath, now: () => NOW })

    const resolution = provider({
      card: cardOf({ sources: [] }),
      url: 'https://a.example.com/',
      method: 'GET',
      nodeId: 'n1',
    })

    expect(resolution.headers).toEqual({})
    expect(resolution.application.status).toBe('none')
    expect(resolution.application.reason).toContain('没有采集来源')
  })

  it('token 型不猜值：status=unsupported 并说明未采集', () => {
    const { store, dbPath } = storeOf()
    addCookie(store)
    const provider = createCaptureCredentialProvider({ dbPath, now: () => NOW })

    const resolution = provider({
      card: cardOf({ auth: 'token-header' }),
      url: 'https://a.example.com/',
      method: 'GET',
      nodeId: 'n1',
    })

    expect(resolution.headers).toEqual({})
    expect(resolution.application.status).toBe('unsupported')
    expect(resolution.application.reason).toContain('token')
  })

  it('采集库不存在 → 降级 none，不抛', () => {
    const dir = mkdtempSync(join(tmpdir(), 'capture-cred-missing-'))
    const dbPath = join(dir, 'nope.sqlite')
    expect(existsSync(dbPath)).toBe(false)
    const provider = createCaptureCredentialProvider({ dbPath, now: () => NOW })

    const resolution = provider({ card: cardOf(), url: 'https://a.example.com/', method: 'GET', nodeId: 'n1' })

    expect(resolution.headers).toEqual({})
    expect(resolution.application.status).toBe('none')
    expect(resolution.application.reason).toContain('采集库不可用')
  })

  it('坏 value_json 行被跳过，好行照常注入', () => {
    const { store, dbPath } = storeOf()
    store.upsertCredential('cap_1', 'cookie', '.example.com', 'bad', NOW, undefined)
    addCookie(store)
    const provider = createCaptureCredentialProvider({ dbPath, now: () => NOW })

    const resolution = provider({ card: cardOf(), url: 'https://a.example.com/', method: 'GET', nodeId: 'n1' })

    expect(resolution.headers.cookie).toBe('sid=SECRET-1')
  })

  it('端到端：采集库 → provider → 真实 HTTP 请求带上 cookie', async () => {
    let received: string | undefined
    const server = createServer((req, res) => {
      received = req.headers.cookie
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"ok":true}')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    try {
      const { store, dbPath } = storeOf()
      addCookie(store, { domain: '127.0.0.1', name: 'sid', value: 'SECRET-E2E' })
      const provider = createCaptureCredentialProvider({ dbPath, now: () => NOW })

      const card: InterfaceCardDoc = {
        ...cardOf(),
        auth: 'cookie-session',
        sources: [{ captureId: 'cap_1', pages: [`${base}/page`] }],
      }
      const doc: ChainDoc = {
        apiVersion: 'dataforge/v1',
        kind: 'interface-chain',
        meta: { site: '凭证测试', flow: '注入', version: 1, created: '2026-10-17T00:00:00Z' },
        inputs: [],
        nodes: [{ id: 'n1', card: card.cardId, constants: {} }],
        edges: [],
      }
      const cards = new Map([[card.cardId, card]])
      const planned = buildPlan(doc, cards, {}, base)
      if (!planned.ok) throw new Error(`计划编译失败：${planned.code} ${planned.message}`)

      const result = await runChain(
        {
          dataRoot: mkdtempSync(join(tmpdir(), 'capture-cred-run-')),
          config: { enabled: true, nodeTimeoutSeconds: 5, concurrency: 1, responseLimitBytes: 2_097_152 },
        },
        { doc, cards, plan: planned.plan, baseUrl: base, credentials: provider },
      )

      expect(result.ok).toBe(true)
      if (result.ok) expect(result.summary.status).toBe('completed')
      expect(received).toBe('sid=SECRET-E2E')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
