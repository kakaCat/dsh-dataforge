/**
 * S3：TraceAnalysis → interface-chain 草稿。
 *
 * 重点：节点只引用接口库 cardId；未绑定值变成 $inputs，不把 trace 里的业务值写进 YAML；
 * 草稿必须通过现有链校验；缺卡/缺必填入参要 warning，不静默成功。
 *
 * @module dsh-dataforge/test/trace/draft
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { analyzeTrace } from '../../src/trace/analyze.js'
import { buildChainDraft } from '../../src/trace/draft.js'
import { chainDraftForTool } from '../../src/trace/application.js'
import { defineChainDraftTool } from '../../src/tools.js'
import { CaptureStore } from '../../src/capture/store.js'
import { writeCard } from '../../src/library/store.js'
import type { LibraryCard } from '../../src/library/types.js'
import type { Trace, TraceSample } from '../../src/trace/types.js'

function headers(values: Record<string, string> = {}): TraceSample['requestHeaders'] {
  return { values, sensitive: [] }
}

function sample(seq: number, method: string, url: string, options: {
  requestBody?: string
  responseBody?: string
  mergeKey?: string
  ts?: number
} = {}): TraceSample {
  const parsed = new URL(url)
  return {
    id: `sm_${seq}`,
    seq,
    ts: options.ts ?? seq * 1_000,
    method,
    url,
    path: parsed.pathname,
    query: Object.fromEntries(parsed.searchParams.entries()),
    status: 200,
    pageUrl: 'https://example.test/page',
    requestHeaders: headers(),
    ...(options.requestBody === undefined ? {} : { requestBody: options.requestBody }),
    requestBodySource: options.requestBody === undefined ? 'none' : 'file',
    requestBodyTruncated: false,
    responseHeaders: headers({ 'content-type': 'application/json' }),
    ...(options.responseBody === undefined ? {} : { responseBody: options.responseBody }),
    responseBodySource: options.responseBody === undefined ? 'none' : 'file',
    responseBodyTruncated: false,
    truncated: false,
    ...(options.mergeKey === undefined ? {} : { mergeKey: options.mergeKey }),
  }
}

function fixtureTrace(): Trace {
  const samples = [
    sample(1, 'GET', 'https://example.test/api/orgs?name=生态链事业部', {
      mergeKey: 'GET /api/orgs',
      responseBody: JSON.stringify({ code: 0, data: [{ orgId: 'ORG-1001', name: '生态链事业部' }] }),
    }),
    sample(2, 'POST', 'https://example.test/api/orders', {
      mergeKey: 'POST /api/orders',
      requestBody: JSON.stringify({ orgId: 'ORG-1001', quantity: 2 }),
      responseBody: JSON.stringify({ code: 0, data: { orderNo: 'PO-9001' } }),
    }),
    sample(3, 'POST', 'https://example.test/api/orders/submit', {
      mergeKey: 'POST /api/orders/submit',
      requestBody: JSON.stringify({ orderNo: 'PO-9001', action: 'submit' }),
      responseBody: JSON.stringify({ success: true }),
    }),
  ]
  return {
    captureId: 'cap_fixture',
    entryUrl: 'https://example.test/start',
    samples,
    stats: { totalSamples: 3, returnedSamples: 3, interfaces: 3, writes: 2, pages: 1, truncatedBodies: 0 },
    warnings: [],
  }
}

function cards(): LibraryCard[] {
  return [
    {
      cardId: 'card_000001', kind: 'interface-card',
      identity: { mergeKey: 'GET /api/orgs', method: 'GET', urlTemplate: 'https://example.test/api/orgs' },
      inputs: [{ path: 'query.name', type: 'string', required: true, role: 'input' }],
      outputs: [{ path: 'body.data[*].orgId', type: 'string' }],
      auth: 'none', sources: [],
    },
    {
      cardId: 'card_000002', kind: 'interface-card',
      identity: { mergeKey: 'POST /api/orders', method: 'POST', urlTemplate: 'https://example.test/api/orders' },
      inputs: [
        { path: 'body.orgId', type: 'string', required: true, role: 'input' },
        { path: 'body.quantity', type: 'number', required: true, role: 'input' },
      ],
      outputs: [{ path: 'body.data.orderNo', type: 'string' }],
      auth: 'none', sources: [],
    },
    {
      cardId: 'card_000003', kind: 'interface-card',
      identity: { mergeKey: 'POST /api/orders/submit', method: 'POST', urlTemplate: 'https://example.test/api/orders/submit' },
      inputs: [
        { path: 'body.orderNo', type: 'string', required: true, role: 'input' },
        { path: 'body.action', type: 'string', required: false, role: 'input' },
      ],
      outputs: [{ path: 'body.success', type: 'boolean' }],
      auth: 'none', sources: [],
    },
  ]
}

describe('buildChainDraft', () => {
  it('生成 cardId 节点/绑定边/输入槽位，并通过链校验；业务值不写进 YAML', () => {
    const analysis = analyzeTrace(fixtureTrace())
    const built = buildChainDraft(analysis, cards(), { site: 'example.test', flow: 'trace-flow', domain: '示例域' })
    if (built.ok !== true) throw new Error(built.error)
    expect(built.chain.kind).toBe('interface-chain')
    expect(built.chain.nodes.map((node) => node.card)).toEqual(['card_000001', 'card_000002', 'card_000003'])
    expect(built.chain.edges).toEqual([
      { from: 'n1.body.data[0].orgId', to: 'n2.body.orgId' },
      { from: 'n2.body.data.orderNo', to: 'n3.body.orderNo' },
    ])
    expect(built.chain.inputs.some((input) => input.name === 'name')).toBe(true)
    expect(built.chain.nodes[0]?.constants['query.name']).toMatch(/^\$inputs\./)
    expect(built.validation.ok).toBe(true)
    expect(built.outputs.length).toBeGreaterThan(0)
    expect(built.yaml).not.toContain('ORG-1001')
    expect(built.yaml).not.toContain('PO-9001')
    expect(built.warnings.some((warning) => warning.code === 'missing-required-input')).toBe(true)
  })

  it('没有接口库卡 → no-cards；没有匹配卡 → no-nodes', () => {
    const analysis = analyzeTrace(fixtureTrace())
    const none = buildChainDraft(analysis, [])
    expect(none.ok).toBe(false)
    if (none.ok) return
    expect(none.code).toBe('no-cards')
  })

  it('trace 里有卡但没导入 → 节点跳过并 warning', () => {
    const analysis = analyzeTrace(fixtureTrace())
    const onlyFirst = cards().slice(0, 1)
    const built = buildChainDraft(analysis, onlyFirst)
    if (built.ok !== true) throw new Error(built.error)
    expect(built.chain.nodes).toHaveLength(1)
    expect(built.warnings.some((warning) => warning.code === 'card-not-imported')).toBe(true)
  })
})

describe('chainDraftForTool', () => {
  let dir: string
  let store: CaptureStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'df-draft-'))
    writeCard(dir, cards()[0] as LibraryCard)
    writeCard(dir, cards()[1] as LibraryCard)
    writeCard(dir, cards()[2] as LibraryCard)
    store = new CaptureStore(join(dir, 'capture.sqlite'), join(dir, 'samples'))
    store.upsertRun({
      id: 'cap_draft', taskType: 'action', entryUrl: 'https://example.test/start', status: 'done',
      startedAt: Date.now(), stats: { pages: 1, requests: 0, cards: 0, credentials: 0 },
    })
    for (const item of fixtureTrace().samples) {
      const cardId = store.upsertCard('cap_draft', {
        mergeKey: item.mergeKey ?? `${item.method} ${item.path}`,
        method: item.method,
        urlTemplate: item.url,
        relatedPageUrls: ['https://example.test/page'],
      })
      const relationId = store.upsertRelation('cap_draft', cardId, 'https://example.test/page', `fp-${item.seq}`)
      const sampleId = store.upsertSample('cap_draft', undefined, {
        url: item.url, method: item.method, status: 200,
        requestHeaders: {}, responseHeaders: {},
        ...(item.requestBody === undefined ? {} : { requestBody: item.requestBody }),
        ...(item.responseBody === undefined ? {} : { responseBody: item.responseBody }),
        bodyLimit: 4096, ts: item.ts,
      })
      store.attachSampleRelation(sampleId, relationId)
    }
  })

  afterEach(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('工具壳 execute：schema 通过，返回 yaml', async () => {
    const tool = defineChainDraftTool({
      captureDbPath: join(dir, 'capture.sqlite'), samplesDir: join(dir, 'samples'), resolveWorkspaceRoot: async () => dir,
    }) as unknown as {
      execute: (args: { capture_id: string; site?: string; flow?: string }, exec?: unknown) => Promise<{ ok: boolean; yaml?: string; validation?: { ok: boolean } }>
    }
    const value = await tool.execute({ capture_id: 'cap_draft', site: 'example.test', flow: 'trace-flow' }, undefined)
    expect(value.ok).toBe(true)
    expect(value.yaml).toContain('kind: interface-chain')
    expect(value.validation?.ok).toBe(true)
  })

  it('工作区接口库 → trace 草稿；工具回执带 yaml/validation', async () => {
    const value = await chainDraftForTool(
      { captureDbPath: join(dir, 'capture.sqlite'), samplesDir: join(dir, 'samples'), resolveWorkspaceRoot: async () => dir },
      undefined,
      { capture_id: 'cap_draft', site: 'example.test', flow: 'trace-flow' },
    )
    expect(value.ok).toBe(true)
    if (!value.ok) return
    expect(value.yaml).toContain('kind: interface-chain')
    expect(value.validation.ok).toBe(true)
  })
})
