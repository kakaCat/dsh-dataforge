/**
 * S4 端到端：草稿 → upsert → 计划卡（零请求）→ 确认执行（mock HTTP）。
 *
 * 这是“接口造数”主链路的验收：纯 TS、纯 HTTP、无 SQL/Python，写操作无 confirm 时一个请求都不发。
 *
 * @module dsh-dataforge/test/trace/s4-e2e
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CaptureStore } from '../../src/capture/store.js'
import { writeCard } from '../../src/library/store.js'
import type { LibraryCard } from '../../src/library/types.js'
import { chainDraftForTool } from '../../src/trace/application.js'
import { upsertChainForTool, chainRunForTool, type ChainRunToolDeps } from '../../src/orchestration/application.js'
import { exportRunArtifacts } from '../../src/datasets/export.js'
import { defineDatasetExportTool } from '../../src/tools.js'
import type { ChainDraftToolValue } from '../../src/trace/application.js'

type Received = { method: string; path: string; body: string; query: URLSearchParams }

let dir: string
let store: CaptureStore
let server: Server
let baseUrl: string
let received: Received[]

function cards(): LibraryCard[] {
  return [
    {
      cardId: 'card_000001', kind: 'interface-card',
      identity: { mergeKey: 'GET /api/orgs', method: 'GET', urlTemplate: '/api/orgs' },
      inputs: [{ path: 'query.name', type: 'string', required: true, role: 'input' }],
      outputs: [{ path: 'body.data[*].orgId', type: 'string' }],
      auth: 'none', sources: [],
    },
    {
      cardId: 'card_000002', kind: 'interface-card',
      identity: { mergeKey: 'POST /api/orders', method: 'POST', urlTemplate: '/api/orders' },
      inputs: [{ path: 'body.orgId', type: 'string', required: true, role: 'input' }],
      outputs: [{ path: 'body.data.orderNo', type: 'string' }],
      auth: 'none', sources: [],
    },
    {
      cardId: 'card_000003', kind: 'interface-card',
      identity: { mergeKey: 'POST /api/orders/submit', method: 'POST', urlTemplate: '/api/orders/submit' },
      inputs: [
        { path: 'body.orderNo', type: 'string', required: true, role: 'input' },
        { path: 'body.action', type: 'string', required: false, role: 'input' },
      ],
      outputs: [{ path: 'body.success', type: 'boolean' }],
      auth: 'none', sources: [],
    },
  ]
}

function sample(seq: number, method: string, path: string, requestBody?: string, responseBody?: string) {
  const url = `${baseUrl}${path}`
  const parsed = new URL(url)
  return {
    url,
    method,
    query: parsed.searchParams,
    path: parsed.pathname,
    requestBody,
    responseBody,
  }
}

beforeEach(async () => {
  received = []
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const parsed = new URL(req.url ?? '/', 'http://127.0.0.1')
      const body = Buffer.concat(chunks).toString('utf8')
      received.push({ method: req.method ?? 'GET', path: parsed.pathname, body, query: parsed.searchParams })
      res.setHeader('content-type', 'application/json')
      if (parsed.pathname === '/api/orgs') {
        res.end(JSON.stringify({ code: 0, status: 'OK', data: [{ orgId: 'ORG-1001', name: '生态链事业部' }] }))
      } else if (parsed.pathname === '/api/orders') {
        res.end(JSON.stringify({ code: 0, status: 'OK', data: { orderNo: 'PO-9001' } }))
      } else if (parsed.pathname === '/api/orders/submit') {
        res.end(JSON.stringify({ success: true }))
      } else {
        res.statusCode = 404
        res.end(JSON.stringify({ code: 404 }))
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('mock server 未监听')
  baseUrl = `http://127.0.0.1:${address.port}`
  dir = mkdtempSync(join(tmpdir(), 'df-s4-'))
  for (const card of cards()) writeCard(dir, card)
  store = new CaptureStore(join(dir, 'capture.sqlite'), join(dir, 'samples'))
  store.upsertRun({
    id: 'cap_s4', taskType: 'action', entryUrl: `${baseUrl}/start`, status: 'done',
    startedAt: Date.now(), stats: { pages: 1, requests: 0, cards: 0, credentials: 0 },
  })
  const rows = [
    sample(1, 'GET', '/api/orgs?name=生态链事业部', undefined, JSON.stringify({ code: 0, status: 'OK', data: [{ orgId: 'ORG-1001' }] })),
    sample(2, 'POST', '/api/orders', JSON.stringify({ orgId: 'ORG-1001', quantity: 2 }), JSON.stringify({ code: 0, status: 'OK', data: { orderNo: 'PO-9001' } })),
    sample(3, 'POST', '/api/orders/submit', JSON.stringify({ orderNo: 'PO-9001', action: 'submit' }), JSON.stringify({ success: true })),
  ]
  for (const [index, item] of rows.entries()) {
    const mergeKey = `${item.method} ${item.path}`
    const cardId = store.upsertCard('cap_s4', {
      mergeKey, method: item.method, urlTemplate: item.url,
      relatedPageUrls: [`${baseUrl}/start`],
    })
    const relationId = store.upsertRelation('cap_s4', cardId, `${baseUrl}/start`, `fp-${index}`)
    const sampleId = store.upsertSample('cap_s4', undefined, {
      url: item.url, method: item.method, status: 200,
      requestHeaders: {}, responseHeaders: {},
      ...(item.requestBody === undefined ? {} : { requestBody: item.requestBody }),
      ...(item.responseBody === undefined ? {} : { responseBody: item.responseBody }),
      bodyLimit: 4096, ts: index,
    })
    store.attachSampleRelation(sampleId, relationId)
  }
})

afterEach(async () => {
  store.close()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  rmSync(dir, { recursive: true, force: true })
})

describe('S4 草稿 → 保存 → 执行', () => {
  it('生成草稿 → upsert v1 → 计划卡零请求 → 确认后 mock 执行通过', async () => {
    const draft = await chainDraftForTool(
      { captureDbPath: join(dir, 'capture.sqlite'), samplesDir: join(dir, 'samples'), resolveWorkspaceRoot: async () => dir },
      undefined,
      { capture_id: 'cap_s4', site: 'example.test', flow: 's4-flow' },
    ) as ChainDraftToolValue
    expect(draft.ok).toBe(true)
    if (!draft.ok) return
    expect(draft.validation.ok).toBe(true)
    expect(draft.chain.nodes[0]?.expects?.length ?? 0).toBeGreaterThanOrEqual(2)

    const saved = await upsertChainForTool(
      { captureDbPath: join(dir, 'capture.sqlite'), resolveWorkspaceRoot: async () => dir },
      undefined,
      { site: 'example.test', flow: 's4-flow', chainYaml: draft.yaml },
    )
    expect(saved.ok).toBe(true)
    expect(saved.version).toBe(1)

    const runDeps: ChainRunToolDeps = {
      captureDbPath: join(dir, 'capture.sqlite'),
      resolveWorkspaceRoot: async () => dir,
      dataRoot: join(dir, 'data'),
      chain: { enabled: true, nodeTimeoutSeconds: 5, concurrency: 4, responseLimitBytes: 2_097_152, foregroundTimeoutSeconds: 30 },
      resolveJobs: () => undefined,
    }
    const inputs = Object.fromEntries(draft.chain.inputs.map((input) => [input.name, input.name === 'name' ? '生态链事业部' : 'submit']))
    const planned = await chainRunForTool(runDeps, undefined, { site: 'example.test', flow: 's4-flow', inputs, baseUrl })
    expect(planned.gate).toBe('confirm-required')
    expect(received).toHaveLength(0)
    expect(planned.plan?.writeNodes.length).toBeGreaterThan(0)

    const executed = await chainRunForTool(runDeps, undefined, { site: 'example.test', flow: 's4-flow', inputs, baseUrl, confirm: true })
    expect(executed.ok).toBe(true)
    expect(executed.accepted).toBe(true)
    expect(executed.kind).toBe('foreground')
    expect(executed.summary?.status).toBe('completed')
    expect(received.map((entry) => `${entry.method} ${entry.path}`)).toEqual([
      'GET /api/orgs',
      'POST /api/orders',
      'POST /api/orders/submit',
    ])
    expect(received[1]?.body).toContain('ORG-1001')
    expect(received[2]?.body).toContain('PO-9001')

    const exported = exportRunArtifacts(join(dir, 'data'), executed.runId ?? '')
    expect(exported.ok).toBe(true)
    if (!exported.ok) return
    expect(existsSync(exported.datasetPath)).toBe(true)
    expect(existsSync(exported.reportPath)).toBe(true)
    expect(readFileSync(exported.datasetPath, 'utf8')).toContain('run-dataset')
    expect(readFileSync(exported.reportPath, 'utf8')).toContain('运行报告')
    const tool = defineDatasetExportTool(join(dir, 'data')) as unknown as {
      execute: (args: { run_id: string }) => Promise<{ ok: boolean; reportPath?: string }>
    }
    const viaTool = await tool.execute({ run_id: executed.runId ?? '' })
    expect(viaTool.ok).toBe(true)
    expect(viaTool.reportPath).toBe(exported.reportPath)
  })
})
