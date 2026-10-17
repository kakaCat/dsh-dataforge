/**
 * 单节点试探（R-5 M1）：缺参暂停、来源校验、写闸、敏感值脱敏、失败留痕。
 *
 * 真起本地 HTTP 服务；不 mock fetch。这一组验的是「一次 probe 到底发了什么、
 * 留了什么」——首跑阶段最贵的错误是「没确认就写」和「把猜的值当事实」。
 *
 * @module dsh-dataforge/test/execute/probe
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChainDoc, InterfaceCardDoc } from '../../src/chains/schema.js'
import { probeNode, type ProbeInput } from '../../src/execute/probe.js'
import { loadRunEvents } from '../../src/runs/store.js'

let server: Server
let base = ''
let sees: Array<{ method: string; url: string; body: string; cookie?: string }> = []
let flakyHits = 0

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? '/'
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      sees.push({ method: req.method ?? '', url, body, ...(req.headers.cookie === undefined ? {} : { cookie: req.headers.cookie }) })
      if (url.startsWith('/api/materials')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ items: [{ internalId: 'M-1', name: '螺丝' }] }))
        return
      }
      if (url.startsWith('/api/orders')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ orderNo: 'PO-1' }))
        return
      }
      if (url.startsWith('/api/secure')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ echo: body }))
        return
      }
      if (url.startsWith('/api/flaky')) {
        flakyHits += 1
        if (flakyHits <= 2) {
          res.writeHead(500, { 'content-type': 'text/plain' })
          res.end('flaky')
        } else {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end('{"ok":true}')
        }
        return
      }
      if (url.startsWith('/api/auth')) {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end('{"error":"login required"}')
        return
      }
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end('boom')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function cardOf(
  cardId: string,
  method: string,
  urlTemplate: string,
  inputs: InterfaceCardDoc['inputs'],
  outputs: InterfaceCardDoc['outputs'] = [],
  auth?: string,
): InterfaceCardDoc {
  return {
    cardId,
    kind: 'interface-card',
    identity: { mergeKey: `${method} ${urlTemplate}`, method, urlTemplate },
    inputs,
    outputs,
    sources: [{ captureId: 'cap_1', pages: [`${base}/page`] }],
    ...(auth === undefined ? {} : { auth }),
  }
}

function docOf(nodeId: string, cardId: string): ChainDoc {
  return {
    apiVersion: 'dataforge/v1',
    kind: 'interface-chain',
    meta: { site: '测试站点', flow: '首跑', version: 1, created: '2026-10-17T00:00:00Z' },
    inputs: [],
    nodes: [{ id: nodeId, card: cardId, constants: {} }],
    edges: [],
  }
}

function inputOf(card: InterfaceCardDoc, overrides: Partial<ProbeInput> = {}): ProbeInput {
  const doc = docOf('probe-node', card.cardId)
  return {
    dataRoot: mkdtempSync(join(tmpdir(), 'probe-run-')),
    doc,
    node: doc.nodes[0] as ProbeInput['node'],
    card,
    baseUrl: base,
    config: { nodeTimeoutSeconds: 5, responseLimitBytes: 2_097_152 },
    ...overrides,
  }
}

const materialsCard = cardOf(
  'card_materials',
  'GET',
  '/api/materials?q={q}',
  [
    { path: 'query.q', type: 'string' },
    { path: 'query.orgId', type: 'string' },
  ],
  [
    { path: 'body.items[*].internalId', type: 'string' },
    { path: 'body.items[*].name', type: 'string' },
  ],
)

describe('缺参与来源校验', () => {
  it('缺参 → paused + gaps，一个请求都不发，但仍落一条 run', async () => {
    sees = []
    const input = inputOf(materialsCard, {
      values: { 'query.q': { value: '螺丝', source: 'user', evidence: '用户原话' } },
    })

    const result = await probeNode(input)

    expect(result.gate).toBe('paused')
    expect(result.ok).toBe(true)
    expect(result.code).toBe('missing-params')
    expect(result.gaps?.map((gap) => gap.path)).toEqual(['query.orgId'])
    expect(sees).toHaveLength(0)
    expect(result.runId).toBeDefined()

    const record = JSON.parse(readFileSync(join(result.runDir ?? '', 'run.json'), 'utf8')) as {
      probe: { paused: boolean; nodeId: string }
      provenance: Array<{ path: string; source: string }>
    }
    expect(record.probe.paused).toBe(true)
    expect(record.probe.nodeId).toBe('probe-node')
    expect(record.provenance.map((item) => item.path)).toEqual(['query.q'])

    const events = loadRunEvents(input.dataRoot, result.runId ?? '') ?? []
    expect(events.map((event) => event.event)).toEqual(['meta', 'terminal', 'result'])
    expect(events.some((event) => event.event === 'step')).toBe(false)
  })

  it('agent-inferred 缺 evidence → blocked，一个请求都不发', async () => {
    sees = []
    const input = inputOf(materialsCard, {
      values: {
        'query.q': { value: '螺丝', source: 'agent-inferred' },
        'query.orgId': { value: '2120', source: 'user' },
      },
    })
    const result = await probeNode(input)
    expect(result.gate).toBe('blocked')
    expect(result.code).toBe('invalid-source')
    expect(result.message).toContain('evidence')
    expect(sees).toHaveLength(0)
    expect(result.runId).toBeUndefined()
  })

  it('未知字段 → blocked unknown-value', async () => {
    const input = inputOf(materialsCard, {
      values: {
        'query.nope': { value: 'x', source: 'user' },
        'query.q': { value: '螺丝', source: 'user' },
        'query.orgId': { value: '2120', source: 'user' },
      },
    })
    const result = await probeNode(input)
    expect(result.gate).toBe('blocked')
    expect(result.code).toBe('unknown-value')
  })
})

describe('成功试探：请求/响应/来源/出参', () => {
  it('只发一个节点；provenance 覆盖常量与 user；outputs 给出内部 ID', async () => {
    sees = []
    const card = cardOf(
      'card_materials',
      'GET',
      '/api/materials?q={q}',
      [
        { path: 'query.q', type: 'string' },
        { path: 'query.orgId', type: 'string' },
      ],
      [
        { path: 'body.items[*].internalId', type: 'string' },
        { path: 'body.items[*].name', type: 'string' },
      ],
    )
    const doc = docOf('probe-node', card.cardId)
    doc.nodes[0] = { ...(doc.nodes[0] as ProbeInput['node']), constants: { 'query.orgId': '2120' } }
    const input = inputOf(card, {
      doc,
      node: doc.nodes[0] as ProbeInput['node'],
      values: { 'query.q': { value: '螺丝', source: 'user', evidence: '用户原话：用螺丝试一下' } },
    })

    const result = await probeNode(input)

    expect(result.gate).toBe('executed')
    expect(result.ok).toBe(true)
    expect(sees).toHaveLength(1)
    expect(sees[0]?.url).toBe('/api/materials?q=%E8%9E%BA%E4%B8%9D&orgId=2120')
    expect(result.response?.status).toBe(200)
    expect(result.provenance).toEqual([
      { path: 'query.q', source: 'user', evidence: '用户原话：用螺丝试一下', valuePreview: '螺丝' },
      { path: 'query.orgId', source: 'constant', evidence: '节点常量 query.orgId', valuePreview: '2120' },
    ])
    const internal = result.outputs?.find((output) => output.path === 'body.items[*].internalId')
    expect(internal?.valuePreview).toBe('M-1')
    expect(result.runId).toBeDefined()
    const record = JSON.parse(readFileSync(join(result.runDir ?? '', 'run.json'), 'utf8')) as {
      kind: string
      probe: { explorationId: string; writes: boolean }
      values: Record<string, unknown>
    }
    expect(record.kind).toBe('probe-run')
    expect(record.probe.writes).toBe(false)
    expect(record.probe.explorationId).toMatch(/^exp_/)
    expect(record.values).toEqual({ 'query.q': '螺丝', 'query.orgId': '2120' })
  })

  it('R-4 provider 仍生效：cookie-session 卡带上注入 cookie', async () => {
    sees = []
    const card = cardOf('card_auth', 'GET', '/api/materials?q={q}', [
      { path: 'query.q', type: 'string' },
      { path: 'query.orgId', type: 'string' },
    ], [], 'cookie-session')
    const input = inputOf(card, {
      values: {
        'query.q': { value: 'x', source: 'user' },
        'query.orgId': { value: '1', source: 'user' },
      },
      credentials: () => ({
        headers: { cookie: 'sid=SECRET' },
        application: {
          status: 'applied',
          source: 'capture',
          header: 'cookie',
          names: ['sid'],
          domains: ['127.0.0.1'],
          captureIds: ['cap_1'],
          expired: 0,
        },
      }),
    })

    const result = await probeNode(input)
    expect(result.gate).toBe('executed')
    expect(sees[0]?.cookie).toBe('sid=SECRET')
    expect(JSON.stringify(result)).not.toContain('SECRET')
  })
})

describe('写操作确认闸', () => {
  const orderCard = cardOf('card_order', 'POST', '/api/orders', [
    { path: 'body.materialId', type: 'string' },
    { path: 'body.quantity', type: 'number' },
  ])

  it('POST 没有 confirm → confirm-required，零请求、零 run', async () => {
    sees = []
    const input = inputOf(orderCard, {
      values: {
        'body.materialId': { value: 'M-1', source: 'upstream', evidence: 'probe:probe-1 · body.items[0].internalId' },
        'body.quantity': { value: 1, source: 'user' },
      },
    })
    const result = await probeNode(input)
    expect(result.gate).toBe('confirm-required')
    expect(result.code).toBe('confirm-required')
    expect(result.plan?.writes).toBe(true)
    expect(result.plan?.cardInputs.map((field) => field.path)).toEqual(['body.materialId', 'body.quantity'])
    expect(sees).toHaveLength(0)
    expect(result.runId).toBeUndefined()
  })

  it('confirm=true 才真发；写方法 retry 强制 0', async () => {
    sees = []
    const input = inputOf(orderCard, {
      confirm: true,
      retry: 3,
      values: {
        'body.materialId': { value: 'M-1', source: 'upstream', evidence: 'probe:probe-1 · body.items[0].internalId' },
        'body.quantity': { value: 1, source: 'user' },
      },
    })
    const result = await probeNode(input)
    expect(result.gate).toBe('executed')
    expect(result.attempts).toBe(1)
    expect(sees).toHaveLength(1)
    expect(sees[0]?.method).toBe('POST')
  })
})

describe('敏感值与失败', () => {
  it('敏感路径值写 ***，响应回显也不会进入留痕', async () => {
    sees = []
    const card = cardOf('card_secure', 'POST', '/api/secure', [
      { path: 'body.user', type: 'string' },
      { path: 'body.password', type: 'string' },
    ], [{ path: 'body.echo', type: 'string' }])
    const input = inputOf(card, {
      confirm: true,
      values: {
        'body.user': { value: 'alice', source: 'user' },
        'body.password': { value: 'PASSWORD-SECRET', source: 'user' },
      },
    })

    const result = await probeNode(input)
    expect(result.gate).toBe('executed')
    const recordText = readFileSync(join(result.runDir ?? '', 'run.json'), 'utf8')
    const eventsText = JSON.stringify(loadRunEvents(input.dataRoot, result.runId ?? '') ?? [])
    expect(recordText).not.toContain('PASSWORD-SECRET')
    expect(eventsText).not.toContain('PASSWORD-SECRET')
    expect(JSON.stringify(result)).not.toContain('PASSWORD-SECRET')
    expect(result.provenance?.find((item) => item.path === 'body.password')?.valuePreview).toBe('***')
  })

  it('HTTP 500 → failed，response 摘要与 run 都在', async () => {
    sees = []
    const card = cardOf('card_fail', 'GET', '/api/fail', [])
    const input = inputOf(card)
    const result = await probeNode(input)
    expect(result.gate).toBe('failed')
    expect(result.ok).toBe(false)
    expect(result.code).toBe('node-http-error')
    expect(result.response?.status).toBe(500)
    expect(result.runId).toBeDefined()
    const events = loadRunEvents(input.dataRoot, result.runId ?? '') ?? []
    expect(events.map((event) => event.event)).toEqual(['meta', 'step', 'step', 'terminal', 'result'])
  })

  it('401 且卡声明鉴权 → node-auth-required（probe 不换票）', async () => {
    const card = cardOf('card_auth401', 'GET', '/api/auth', [], [], 'cookie-session')
    const input = inputOf(card)
    const result = await probeNode(input)
    expect(result.gate).toBe('failed')
    expect(result.code).toBe('node-auth-required')
    expect(result.message).toContain('probe 不换票')
  })

  it('幂等方法 retry：500 两次后成功，attempts=3', async () => {
    flakyHits = 0
    const card = cardOf('card_flaky', 'GET', '/api/flaky', [])
    const input = inputOf(card, { retry: 2 })
    const result = await probeNode(input)
    expect(result.gate).toBe('executed')
    expect(result.attempts).toBe(3)
  })
})
