/**
 * S2：通用自动编排分析（顺序/轮询/写操作/字段流转/输入输出/覆盖率）。
 *
 * 规则只用方法、序号、JSON 值匹配；fixture 中不依赖任何业务系统实现。
 *
 * @module dsh-dataforge/test/trace/analyze
 */
import { describe, expect, it } from 'vitest'
import { analyzeTrace, type TraceAnalysis } from '../../src/trace/analyze.js'
import type { Trace, TraceSample } from '../../src/trace/types.js'

function headers(values: Record<string, string> = {}): TraceSample['requestHeaders'] {
  return { values, sensitive: [] }
}

function sample(seq: number, method: string, url: string, options: {
  requestBody?: string
  responseBody?: string
  status?: number
  ts?: number
  query?: Record<string, string>
} = {}): TraceSample {
  const parsed = new URL(url)
  const query = options.query ?? Object.fromEntries(parsed.searchParams.entries())
  return {
    id: `sm_${seq}`,
    seq,
    ts: options.ts ?? seq * 1_000,
    method,
    url,
    path: parsed.pathname,
    query,
    status: options.status ?? 200,
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
  }
}

function trace(samples: TraceSample[]): Trace {
  return {
    captureId: 'cap_fixture',
    entryUrl: 'https://example.test/start',
    samples,
    stats: {
      totalSamples: samples.length,
      returnedSamples: samples.length,
      interfaces: new Set(samples.map((item) => `${item.method} ${item.path}`)).size,
      writes: samples.filter((item) => item.method !== 'GET').length,
      pages: 1,
      truncatedBodies: 0,
    },
    warnings: [],
  }
}

function bindingKeys(analysis: TraceAnalysis): string[] {
  return analysis.bindings.map((binding) => `${binding.from.nodeId}.${binding.from.path}->${binding.to.nodeId}.${binding.to.path}`)
}

describe('analyzeTrace', () => {
  it('顺序 + 字段流转 + 输入输出：生成可解释的 binding', () => {
    const result = analyzeTrace(trace([
      sample(1, 'GET', 'https://example.test/api/orgs?name=生态链事业部', {
        responseBody: JSON.stringify({ code: 0, data: [{ orgId: 'ORG-1001', name: '生态链事业部' }] }),
      }),
      sample(2, 'POST', 'https://example.test/api/orders', {
        requestBody: JSON.stringify({ orgId: 'ORG-1001', quantity: 2 }),
        responseBody: JSON.stringify({ code: 0, data: { orderNo: 'PO-9001' } }),
        ts: 2_000,
      }),
      sample(3, 'POST', 'https://example.test/api/orders/submit', {
        requestBody: JSON.stringify({ orderNo: 'PO-9001', action: 'submit' }),
        responseBody: JSON.stringify({ success: true }),
        ts: 3_000,
      }),
    ]))

    expect(result.nodes.map((node) => node.id)).toEqual(['n1', 'n2', 'n3'])
    expect(result.nodes[1]?.write).toBe(true)
    expect(bindingKeys(result)).toEqual(expect.arrayContaining([
      'n1.body.data[0].orgId->n2.body.orgId',
      'n2.body.data.orderNo->n3.body.orderNo',
    ]))
    const precise = result.bindings.filter((binding) => binding.confidence >= 0.9)
    expect(precise.length).toBeGreaterThanOrEqual(2)
    expect(result.inputs.some((input) => input.path === 'query.name')).toBe(true)
    expect(result.coverage.bindingCoverage).toBeGreaterThan(0)
    expect(result.assertions.some((assertion) => assertion.path === 'status')).toBe(true)
    expect(result.assertions.some((assertion) => assertion.path === 'body.code')).toBe(true)
  })

  it('连续重复调用合并为 polling 节点', () => {
    const result = analyzeTrace(trace([
      sample(1, 'GET', 'https://example.test/api/job/1', { responseBody: '{"status":"PENDING"}', ts: 1_000 }),
      sample(2, 'GET', 'https://example.test/api/job/1', { responseBody: '{"status":"PENDING"}', ts: 2_000 }),
      sample(3, 'GET', 'https://example.test/api/job/1', { responseBody: '{"status":"DONE"}', ts: 3_000 }),
    ]))
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0]?.polling).toBe(true)
    expect(result.nodes[0]?.occurrences).toBe(3)
    expect(result.warnings.some((warning) => warning.code === 'polling-merged')).toBe(true)
  })

  it('写操作请求体不同：相邻也不能合并', () => {
    const result = analyzeTrace(trace([
      sample(1, 'POST', 'https://example.test/api/orders', { requestBody: '{"id":"A-1001"}', ts: 1_000 }),
      sample(2, 'POST', 'https://example.test/api/orders', { requestBody: '{"id":"B-2002"}', ts: 2_000 }),
    ]))
    expect(result.nodes).toHaveLength(2)
    expect(result.nodes.map((node) => node.occurrences)).toEqual([1, 1])
  })

  it('静态资源过滤；动态值/截断正文进 warning，不伪装成 input', () => {
    const result = analyzeTrace(trace([
      sample(1, 'GET', 'https://example.test/static/app.js', {}),
      sample(2, 'POST', 'https://example.test/api/x', {
        requestBody: JSON.stringify({ nonce: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6', name: 'demo-user' }),
        responseBody: 'not-json',
      }),
    ]))
    expect(result.stats.staticAssets).toBe(1)
    expect(result.nodes).toHaveLength(1)
    expect(result.warnings.some((warning) => warning.code === 'response-body-unparsed')).toBe(true)
    expect(result.warnings.some((warning) => warning.code === 'unresolved-dynamic')).toBe(true)
  })

  it('fixture 指标：binding precision/recall ≥ 需求阈值（≥0.8 / ≥0.7）', () => {
    const fixtures = [
      trace([
        sample(1, 'GET', 'https://a.test/api/u', { responseBody: '{"data":{"id":"USR-7788"}}' }),
        sample(2, 'POST', 'https://a.test/api/settings', {
          requestBody: '{"userId":"USR-7788","theme":"dark"}',
          responseBody: '{"ok":true}',
        }),
      ]),
      trace([
        sample(1, 'POST', 'https://b.test/api/session', {
          requestBody: '{"account":"tester-01"}',
          responseBody: '{"data":{"referenceId":"REF-4455"}}',
        }),
        sample(2, 'GET', 'https://b.test/api/profile?referenceId=REF-4455', {
          responseBody: '{"data":{"referenceId":"REF-4455"}}',
        }),
      ]),
    ]
    let truePositive = 0
    let predicted = 0
    let actual = 0
    const expected = new Set([
      'n1.body.data.id->n2.body.userId',
      'n1.body.data.referenceId->n2.query.referenceId',
    ])
    for (const item of fixtures) {
      const analysis = analyzeTrace(item)
      predicted += analysis.bindings.length
      for (const key of bindingKeys(analysis)) {
        if (expected.has(key)) truePositive += 1
      }
    }
    actual = expected.size
    const precision = predicted === 0 ? 0 : truePositive / predicted
    const recall = actual === 0 ? 0 : truePositive / actual
    expect(precision).toBeGreaterThanOrEqual(0.8)
    expect(recall).toBeGreaterThanOrEqual(0.7)
  })
})
