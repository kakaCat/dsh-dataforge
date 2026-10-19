/**
 * S1：trace 只读读取（顺序、正文来源/截断、敏感头、空/坏 capture）。
 *
 * @module dsh-dataforge/test/trace/read
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CaptureStore } from '../../src/capture/store.js'
import { readTrace } from '../../src/trace/read.js'

let dir: string
let store: CaptureStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'df-trace-'))
  store = new CaptureStore(join(dir, 'capture.sqlite'), join(dir, 'samples'))
  store.upsertRun({
    id: 'cap_test',
    taskType: 'action',
    entryUrl: 'https://example.test/start',
    status: 'done',
    startedAt: Date.now(),
    stats: { pages: 1, requests: 0, cards: 0, credentials: 0 },
  })
})

afterEach(() => {
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('readTrace', () => {
  it('按 seq 返回；敏感头只报名字；正文来自文件或预览并标截断', () => {
    store.upsertSample('cap_test', undefined, {
      url: 'https://example.test/api/one?x=1',
      method: 'GET',
      status: 200,
      requestHeaders: { accept: 'application/json', authorization: 'Bearer secret' },
      responseHeaders: { 'content-type': 'application/json', 'set-cookie': 'sid=secret' },
      responseBody: JSON.stringify({ data: { id: 'ID-1001' } }),
      bodyLimit: 4096,
      pageUrl: 'https://example.test/start',
      ts: 1,
    })
    // 超过 bodyLimit → 落文件（完整正文）；readTrace 的 bodyLimit 较大，能读回完整。
    const big = 'B'.repeat(6000)
    store.upsertSample('cap_test', undefined, {
      url: 'https://example.test/api/two',
      method: 'POST',
      status: 200,
      requestHeaders: {},
      responseHeaders: {},
      responseBody: big,
      bodyLimit: 1024,
      ts: 2,
    })
    // 大于 512 预览上限但小于 bodyLimit → DB 只存预览，读回必须标截断。
    const previewOnly = 'P'.repeat(900)
    store.upsertSample('cap_test', undefined, {
      url: 'https://example.test/api/three',
      method: 'GET',
      status: 200,
      requestHeaders: {},
      responseHeaders: {},
      responseBody: previewOnly,
      bodyLimit: 4096,
      ts: 3,
    })

    const trace = readTrace({ captureDbPath: join(dir, 'capture.sqlite'), samplesDir: join(dir, 'samples') }, 'cap_test')
    if ('ok' in trace) throw new Error(trace.error)
    expect(trace.samples.map((sample) => sample.seq)).toEqual([1, 2, 3])
    expect(trace.samples[0]?.requestHeaders.values['accept']).toBe('application/json')
    expect(trace.samples[0]?.requestHeaders.values['authorization']).toBeUndefined()
    expect(trace.samples[0]?.requestHeaders.sensitive).toContain('authorization')
    expect(trace.samples[0]?.responseHeaders.sensitive).toContain('set-cookie')
    expect(trace.samples[0]?.requestBody).toBeUndefined()
    expect(trace.samples[1]?.responseBodySource).toBe('file')
    expect(trace.samples[1]?.responseBodyTruncated).toBe(false)
    expect(trace.samples[2]?.responseBodySource).toBe('preview')
    expect(trace.samples[2]?.responseBodyTruncated).toBe(true)
    expect(trace.stats.returnedSamples).toBe(3)
    expect(trace.stats.truncatedBodies).toBeGreaterThanOrEqual(1)
  })

  it('样本与接口卡关联：返回 cardId / mergeKey', () => {
    const cardId = store.upsertCard('cap_test', {
      mergeKey: 'GET /api/one',
      method: 'GET',
      urlTemplate: 'https://example.test/api/one',
      relatedPageUrls: ['https://example.test/start'],
    })
    const relationId = store.upsertRelation('cap_test', cardId, 'https://example.test/start', 'fp-1')
    const sampleId = store.upsertSample('cap_test', undefined, {
      url: 'https://example.test/api/one', method: 'GET', status: 200,
      requestHeaders: {}, responseHeaders: {}, bodyLimit: 4096, pageUrl: 'https://example.test/start', ts: 1,
    })
    store.attachSampleRelation(sampleId, relationId)
    const trace = readTrace({ captureDbPath: join(dir, 'capture.sqlite'), samplesDir: join(dir, 'samples') }, 'cap_test')
    if ('code' in trace) throw new Error(trace.error)
    expect(trace.samples[0]?.cardId).toBe(cardId)
    expect(trace.samples[0]?.mergeKey).toBe('GET /api/one')
  })

  it('空 capture / 不存在 capture：结构化错误而不是抛异常', () => {
    store.upsertRun({
      id: 'cap_empty', taskType: 'single_page', entryUrl: 'https://example.test/', status: 'done',
      startedAt: Date.now(), stats: { pages: 0, requests: 0, cards: 0, credentials: 0 },
    })
    const deps = { captureDbPath: join(dir, 'capture.sqlite'), samplesDir: join(dir, 'samples') }
    const empty = readTrace(deps, 'cap_empty')
    if (!('code' in empty)) throw new Error('expected failure')
    expect(empty.code).toBe('capture-empty')
    const missing = readTrace(deps, 'cap_missing')
    if (!('code' in missing)) throw new Error('expected failure')
    expect(missing.code).toBe('capture-not-found')
  })

  it('路径分隔符/空 id 拒绝', () => {
    const deps = { captureDbPath: join(dir, 'capture.sqlite'), samplesDir: join(dir, 'samples') }
    const bad = readTrace(deps, '../etc/passwd')
    if (!('code' in bad)) throw new Error('expected failure')
    expect(bad.code).toBe('bad-capture-id')
  })

  it('limit 生效并给出 trace-limit 提示', () => {
    for (let index = 0; index < 3; index += 1) {
      store.upsertSample('cap_test', undefined, {
        url: `https://example.test/api/${index}`,
        method: 'GET',
        status: 200,
        requestHeaders: {},
        responseHeaders: {},
        bodyLimit: 4096,
        ts: index,
      })
    }
    const trace = readTrace({ captureDbPath: join(dir, 'capture.sqlite'), samplesDir: join(dir, 'samples') }, 'cap_test', { limit: 2 })
    if ('ok' in trace) throw new Error(trace.error)
    expect(trace.samples).toHaveLength(2)
    expect(trace.warnings.some((warning) => warning.code === 'trace-limit')).toBe(true)
  })
})
