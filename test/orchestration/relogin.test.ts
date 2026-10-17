/**
 * 自动换票的应用层链路（R-4 M2）：主链 401 → 登录链 → set-cookie → 重放。
 *
 * 这一组走真的 `chainRunForTool`：真工作区、真链文件、真 HTTP 服务、真 runs 留痕。
 * 验三件事：
 *   1. 登录链下发的 set-cookie 能喂回主链重放（链不断）；
 *   2. 登录链以敏感模式留痕——账号/密码/响应 token 都不出现在 run.json/events；
 *   3. 自环与非 interface-chain 在发请求前被拒。
 *
 * @module dsh-dataforge/test/orchestration/relogin
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChainDoc, InterfaceCardDoc } from '../../src/chains/schema.js'
import { chainToYaml } from '../../src/chains/schema.js'
import { cardsRoot, saveChain } from '../../src/chains/store.js'
import { chainRunForTool, type ChainRunToolDeps } from '../../src/orchestration/application.js'
import { loadRunEvents, listRunIds, readRunRecord } from '../../src/runs/store.js'

const CHAIN_CONFIG = {
  enabled: true,
  nodeTimeoutSeconds: 5,
  concurrency: 2,
  responseLimitBytes: 2_097_152,
  foregroundTimeoutSeconds: 60,
}

let server: Server
let base = ''
/** 业务接口收到的 cookie 顺序（第一次无、第二次换票后的新 cookie）。 */
let dataCookies: Array<string | undefined> = []
/** 登录接口被调用的次数（跨源/自环等预检应在 0 次时拒掉）。 */
let loginHits = 0

beforeAll(async () => {
  server = createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      const url = req.url ?? '/'
      if (url.startsWith('/login')) {
        loginHits += 1
        res.writeHead(200, {
          'content-type': 'application/json',
          'set-cookie': 'sid=fresh; Path=/; HttpOnly',
        })
        res.end('{"token":"TOKEN-SECRET"}')
        return
      }
      if (url.startsWith('/data')) {
        const cookie = req.headers.cookie
        dataCookies.push(cookie)
        if (cookie !== undefined && cookie.includes('sid=fresh')) {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end('{"ok":true}')
        } else {
          res.writeHead(401, { 'content-type': 'application/json' })
          res.end('{"error":"login required"}')
        }
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

function workspaceOf(): string {
  return mkdtempSync(join(tmpdir(), 'relogin-'))
}

function depsOf(workspace: string): ChainRunToolDeps {
  return {
    captureDbPath: join(workspace, 'capture.sqlite'),
    resolveWorkspaceRoot: async () => workspace,
    dataRoot: join(workspace, 'data'),
    chain: CHAIN_CONFIG,
    resolveJobs: () => undefined,
  }
}

function cardOf(cardId: string, method: string, urlTemplate: string, inputs: InterfaceCardDoc['inputs'] = []): InterfaceCardDoc {
  return {
    cardId,
    kind: 'interface-card',
    identity: { mergeKey: `${method} ${urlTemplate}`, method, urlTemplate },
    inputs,
    outputs: [],
    sources: [{ captureId: 'cap_1', pages: [`${base}/page`] }],
  }
}

function writeCard(workspace: string, card: InterfaceCardDoc): void {
  const dir = cardsRoot(workspace)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${card.cardId}.yaml`), JSON.stringify(card, null, 2), 'utf8')
}

function seedChain(workspace: string, site: string, flow: string, nodes: ChainDoc['nodes'], inputs: ChainDoc['inputs'] = []): void {
  const doc: ChainDoc = {
    apiVersion: 'dataforge/v1',
    kind: 'interface-chain',
    meta: { site, flow, version: 1, created: '2026-10-17T00:00:00Z' },
    inputs,
    nodes,
    edges: [],
  }
  const saved = saveChain(workspace, chainToYaml(doc), { source: 'agent' })
  if (!saved.ok) throw new Error(`夹具链落盘失败：${saved.issues.map((issue) => issue.reason).join('；')}`)
}

function loginRunOf(dataRoot: string): { runId: string; eventsText: string; params: Record<string, unknown> } {
  for (const runId of listRunIds(dataRoot, 20)) {
    const record = readRunRecord(dataRoot, runId)
    if (record === undefined) continue
    const chain = record['chain'] as { flow?: unknown } | undefined
    if (chain?.flow !== '登录') continue
    const events = loadRunEvents(dataRoot, runId) ?? []
    return {
      runId,
      eventsText: JSON.stringify(events),
      params: (record['params'] ?? {}) as Record<string, unknown>,
    }
  }
  throw new Error('没有找到登录链的运行留痕')
}

describe('主链 401 → 登录链换票 → 重放', () => {
  it('set-cookie 喂回主链，主链成功；登录链的账号/密码/token 不进留痕', async () => {
    dataCookies = []
    const workspace = workspaceOf()
    const loginCard = cardOf('card_login', 'POST', '/login', [
      { path: 'body.user', type: 'string' },
      { path: 'body.pass', type: 'string' },
    ])
    const dataCard = { ...cardOf('card_data', 'GET', '/data'), auth: 'cookie-session' }
    writeCard(workspace, loginCard)
    writeCard(workspace, dataCard)
    seedChain(workspace, '认证站点', '登录', [
      {
        id: 'login',
        card: 'card_login',
        constants: { 'body.user': '$inputs.user', 'body.pass': '$inputs.pass' },
      },
    ], [
      { name: 'user', type: 'string', required: true },
      { name: 'pass', type: 'string', required: true },
    ])
    seedChain(workspace, '业务站点', '取数', [{ id: 'data', card: 'card_data', constants: {} }])

    const deps = depsOf(workspace)
    const value = await chainRunForTool(deps, {}, {
      site: '业务站点',
      flow: '取数',
      confirm: true,
      relogin: {
        site: '认证站点',
        flow: '登录',
        inputs: { user: 'alice', pass: 'PASSWORD-SECRET' },
        baseUrl: base,
      },
    })

    expect(value.ok).toBe(true)
    expect(value.accepted).toBe(true)
    expect(value.summary?.status).toBe('completed')
    expect(value.nodes?.[0]?.relogin).toMatchObject({ attempted: true, success: true })
    expect(dataCookies[0]).toBeUndefined()
    expect(dataCookies[1]).toBe('sid=fresh')

    // 登录链自己的留痕：params 值打码，正文/事件里没有密码与 token。
    const login = loginRunOf(deps.dataRoot)
    expect(login.params).toEqual({ user: '***', pass: '***' })
    expect(login.eventsText).not.toContain('PASSWORD-SECRET')
    expect(login.eventsText).not.toContain('TOKEN-SECRET')
    expect(login.eventsText).toContain('[已脱敏]')

    // 主链留痕也不能有换票后的 cookie 值。
    const mainEvents = loadRunEvents(deps.dataRoot, value.runId ?? '') ?? []
    expect(JSON.stringify(mainEvents)).not.toContain('sid=fresh')
  })

  it('登录链与主链不同源 → relogin-unavailable，登录请求一次都不发', async () => {
    dataCookies = []
    loginHits = 0
    const workspace = workspaceOf()
    const loginCard = cardOf('card_login', 'POST', '/login', [
      { path: 'body.user', type: 'string' },
      { path: 'body.pass', type: 'string' },
    ])
    const dataCard = { ...cardOf('card_data', 'GET', '/data'), auth: 'cookie-session' }
    writeCard(workspace, loginCard)
    writeCard(workspace, dataCard)
    seedChain(workspace, '认证站点', '登录', [
      { id: 'login', card: 'card_login', constants: { 'body.user': '$inputs.user', 'body.pass': '$inputs.pass' } },
    ], [
      { name: 'user', type: 'string', required: true },
      { name: 'pass', type: 'string', required: true },
    ])
    seedChain(workspace, '业务站点', '取数', [{ id: 'data', card: 'card_data', constants: {} }])

    const deps = depsOf(workspace)
    const value = await chainRunForTool(deps, {}, {
      site: '业务站点',
      flow: '取数',
      confirm: true,
      relogin: {
        site: '认证站点',
        flow: '登录',
        inputs: { user: 'alice', pass: 'PASSWORD-SECRET' },
        // 同端口、不同 origin：host 从 127.0.0.1 换成 localhost。
        baseUrl: base.replace('127.0.0.1', 'localhost'),
      },
    })

    expect(value.ok).toBe(true)
    expect(value.accepted).toBe(true)
    expect(value.summary?.status).toBe('failed')
    const node = value.nodes?.[0]
    expect(node?.errorCode).toBe('relogin-unavailable')
    expect(node?.error).toContain('不同源')
    expect(loginHits).toBe(0)
    expect(dataCookies).toHaveLength(1)
  })

  it('自环：relogin 指向主链自身 → relogin-cycle，一个请求都不发', async () => {
    dataCookies = []
    const workspace = workspaceOf()
    const dataCard = { ...cardOf('card_data', 'GET', '/data'), auth: 'cookie-session' }
    writeCard(workspace, dataCard)
    seedChain(workspace, '业务站点', '取数', [{ id: 'data', card: 'card_data', constants: {} }])

    const deps = depsOf(workspace)
    const value = await chainRunForTool(deps, {}, {
      site: '业务站点',
      flow: '取数',
      confirm: true,
      relogin: { site: '业务站点', flow: '取数' },
    })

    expect(value.ok).toBe(false)
    expect(value.code).toBe('relogin-cycle')
    expect(value.accepted).toBe(false)
    expect(dataCookies).toHaveLength(0)
    expect(listRunIds(deps.dataRoot, 10)).toHaveLength(0)
  })

  it('登录链不存在 → relogin-unavailable，主链中止但不发第二个请求', async () => {
    dataCookies = []
    const workspace = workspaceOf()
    const dataCard = { ...cardOf('card_data', 'GET', '/data'), auth: 'cookie-session' }
    writeCard(workspace, dataCard)
    seedChain(workspace, '业务站点', '取数', [{ id: 'data', card: 'card_data', constants: {} }])

    const deps = depsOf(workspace)
    const value = await chainRunForTool(deps, {}, {
      site: '业务站点',
      flow: '取数',
      confirm: true,
      relogin: { site: '不存在站点', flow: '不存在登录', baseUrl: base },
    })

    expect(value.ok).toBe(true)
    expect(value.accepted).toBe(true)
    expect(value.summary?.status).toBe('failed')
    const node = value.nodes?.[0]
    expect(node?.errorCode).toBe('relogin-unavailable')
    expect(node?.error).toContain('需人工重新登录')
    expect(dataCookies).toHaveLength(1)
  })
})
