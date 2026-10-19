/**
 * S1/S2 应用层：工具回执形状、脱敏、错误码。
 *
 * @module dsh-dataforge/test/trace/tools
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CaptureStore } from '../../src/capture/store.js'
import { traceAnalyzeForTool, traceGetForTool } from '../../src/trace/application.js'
import { defineTraceAnalyzeTool, defineTraceGetTool } from '../../src/tools.js'

let dir: string
let store: CaptureStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'df-trace-tool-'))
  store = new CaptureStore(join(dir, 'capture.sqlite'), join(dir, 'samples'))
  store.upsertRun({
    id: 'cap_tool', taskType: 'action', entryUrl: 'https://tool.test/', status: 'done',
    startedAt: Date.now(), stats: { pages: 1, requests: 0, cards: 0, credentials: 0 },
  })
  store.upsertSample('cap_tool', undefined, {
    url: 'https://tool.test/api/a', method: 'POST', status: 200,
    requestHeaders: { cookie: 'sid=secret' }, responseHeaders: { authorization: 'Bearer secret' },
    requestBody: JSON.stringify({ id: 'ID-7001', password: 'super-secret' }), responseBody: JSON.stringify({ code: 0, id: 'ID-7001', token: 'tok-123' }),
    bodyLimit: 4096, pageUrl: 'https://tool.test/', ts: 1,
  })
})

afterEach(() => {
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('trace tools application', () => {
  it('trace_get 回执：敏感头只有名字；正文可读', () => {
    const deps = { captureDbPath: join(dir, 'capture.sqlite'), samplesDir: join(dir, 'samples') }
    const value = traceGetForTool(deps, { capture_id: 'cap_tool' })
    expect(value.ok).toBe(true)
    if (!value.ok) return
    expect(value.samples[0]?.requestHeaders.values['cookie']).toBeUndefined()
    expect(value.samples[0]?.requestHeaders.sensitive).toContain('cookie')
    expect(value.samples[0]?.responseHeaders.sensitive).toContain('authorization')
    expect(JSON.stringify(value)).not.toContain('sid=secret')
    expect(JSON.stringify(value)).not.toContain('Bearer secret')
    expect(JSON.stringify(value)).not.toContain('super-secret')
    expect(JSON.stringify(value)).not.toContain('tok-123')
  })

  it('工具壳 execute：schema 通过，返回 trace/analysis', async () => {
    const deps = { captureDbPath: join(dir, 'capture.sqlite'), samplesDir: join(dir, 'samples') }
    const getTool = defineTraceGetTool(deps) as unknown as {
      execute: (args: { capture_id: string; limit?: number }) => Promise<{ ok: boolean; stats?: { totalSamples: number } }>
    }
    const got = await getTool.execute({ capture_id: 'cap_tool', limit: 10 })
    expect(got.ok).toBe(true)
    expect(got.stats?.totalSamples).toBe(1)
    const analyzeTool = defineTraceAnalyzeTool(deps) as unknown as {
      execute: (args: { capture_id: string; limit?: number }) => Promise<{ ok: boolean; analysis?: { nodes: unknown[] } }>
    }
    const analyzed = await analyzeTool.execute({ capture_id: 'cap_tool', limit: 10 })
    expect(analyzed.ok).toBe(true)
    expect(analyzed.analysis?.nodes).toHaveLength(1)
  })

  it('trace_analyze 回执：节点/输入/覆盖率可用；错误码透传', () => {
    const deps = { captureDbPath: join(dir, 'capture.sqlite'), samplesDir: join(dir, 'samples') }
    const value = traceAnalyzeForTool(deps, { capture_id: 'cap_tool' })
    expect(value.ok).toBe(true)
    if (!value.ok) return
    expect(value.analysis.nodes).toHaveLength(1)
    expect(value.analysis.nodes[0]?.write).toBe(true)
    expect(value.analysis.stats.writes).toBe(1)
    const missing = traceAnalyzeForTool(deps, { capture_id: 'cap_missing' })
    expect(missing.ok).toBe(false)
    if (missing.ok) return
    expect(missing.code).toBe('capture-not-found')
  })
})
