/**
 * S5：dataset/evidence 同时支持 UI 回放证据（success/failure 截图）。
 *
 * @module dsh-dataforge/test/datasets/export
 */
import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportRunArtifacts } from '../../src/datasets/export.js'
import { defineDatasetExportTool } from '../../src/tools.js'

function seedUiRun(dataRoot: string): string {
  const runId = 'uir_1'
  const dir = join(dataRoot, 'ui-runs', runId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'success.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  writeFileSync(join(dir, 'run.json'), JSON.stringify({
    runId, kind: 'ui-run', status: 'success', site: '示例站点', flow: '打开页面', version: 1,
    startUrl: 'https://example.test/', startedAt: 1, finishedAt: 2, totalSteps: 1, stepsDone: 1,
    screenshot: `ui-runs/${runId}/success.png`,
  }), 'utf8')
  writeFileSync(join(dir, 'events.ndjson'), [
    { event: 'meta', site: '示例站点', flow: '打开页面', version: 1, startUrl: 'https://example.test/' },
    { event: 'step', id: 's1', kind: 'goto', status: 'done', elapsed: 10 },
    { event: 'terminal', success: true, screenshot: `ui-runs/${runId}/success.png` },
  ].map((event) => JSON.stringify(event)).join('\n'), 'utf8')
  return runId
}

describe('dataset/evidence export', () => {
  it('UI run：dataset + report.html + success.png 复制到 evidence', () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'df-export-'))
    const runId = seedUiRun(dataRoot)
    const exported = exportRunArtifacts(dataRoot, runId)
    expect(exported.ok).toBe(true)
    if (!exported.ok) return
    expect(exported.kind).toBe('ui')
    expect(exported.status).toBe('success')
    expect(existsSync(exported.datasetPath)).toBe(true)
    expect(existsSync(exported.reportPath)).toBe(true)
    expect(existsSync(join(dataRoot, 'evidence', runId, 'success.png'))).toBe(true)
    expect(readFileSync(exported.datasetPath, 'utf8')).toContain('ui-run-dataset')
    expect(readFileSync(exported.reportPath, 'utf8')).toContain('success.png')
  })

  it('工具壳 execute：UI 导出 schema 通过', async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'df-export-tool-'))
    const runId = seedUiRun(dataRoot)
    const tool = defineDatasetExportTool(dataRoot) as unknown as {
      execute: (args: { run_id: string }) => Promise<{ ok: boolean; kind?: string; ui?: { runId?: string } }>
    }
    const value = await tool.execute({ run_id: runId })
    expect(value.ok).toBe(true)
    expect(value.kind).toBe('ui')
    expect(value.ui?.runId).toBe(runId)
  })
})
