/**
 * UI 批量回归：选择口径 / 计划卡 / 执行汇总 / 报告 / 缺参与坏文件。
 *
 * 执行器注入假 run（不起浏览器），报告与留痕在临时工作区上验证。
 *
 * @module dsh-dataforge/test/uitest/batch
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { executeUiBatch, planUiBatch, type UiBatchRunner } from '../../src/uitest/batch.js'
import { listUiBatches, readUiBatch } from '../../src/uitest/batch-store.js'
import { saveUiScript } from '../../src/uitest/store.js'
import type { UiScriptDoc } from '../../src/uitest/schema.js'
import type { UiRunResult } from '../../src/uitest/run.js'

let dir: string | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'df-ui-batch-'))
})

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

function workspace(): string {
  return dir as string
}

function script(site: string, flow: string, options: { input?: boolean } = {}): UiScriptDoc {
  const inputs = options.input === true ? [{ name: 'keyword', type: 'string' as const, required: true }] : []
  const steps: UiScriptDoc['steps'] = [
    { id: 's1', kind: 'goto', url: 'https://example.com/' },
    {
      id: 's2', kind: 'click', selector: '#go',
      ...(options.input === true ? { expect: [{ kind: 'text' as const, selector: '#echo', equals: '{{keyword}}' }] } : {}),
    },
  ]
  return {
    apiVersion: 'dataforge/v1',
    kind: 'ui-script',
    meta: {
      site, flow, version: 1, created: '2026-10-18T00:00:00+08:00',
      startUrl: 'https://example.com/', source: 'record',
    },
    inputs,
    steps,
  }
}

function seed(): void {
  for (const [site, flow] of [['示例站', '流程A'], ['示例站', '流程B'], ['另一站', '流程C']] as const) {
    const saved = saveUiScript(workspace(), script(site, flow))
    expect(saved.ok).toBe(true)
  }
}

function fakeRun(options: { failFlow?: string; throwFlow?: string } = {}): { runner: UiBatchRunner; calls: string[] } {
  const calls: string[] = []
  const runner: UiBatchRunner = async (doc) => {
    calls.push(`${doc.meta.site}/${doc.meta.flow}`)
    if (options.throwFlow === doc.meta.flow) throw new Error('浏览器启动失败')
    const failed = options.failFlow === doc.meta.flow
    const result: UiRunResult = {
      runId: `uir_${calls.length}`,
      site: doc.meta.site,
      flow: doc.meta.flow,
      version: doc.meta.version,
      startUrl: doc.meta.startUrl,
      success: !failed,
      totalSteps: doc.steps.length,
      stepsDone: failed ? 1 : doc.steps.length,
      steps: [],
      ...(failed ? { failedStep: { id: 's2', kind: 'click', ok: false, elapsedMs: 3, error: '元素不存在', assertions: [] } } : {}),
      ...(failed ? { screenshot: `ui-runs/uir_${calls.length}/failure.png`, error: '元素不存在' } : {}),
      elapsedMs: 5,
      cookiesApplied: 0,
    }
    return result
  }
  return { runner, calls }
}

describe('planUiBatch', () => {
  it('全部脚本：按目录列出最新版本 + 步骤/写操作计数', () => {
    seed()
    const planned = planUiBatch(workspace(), {})
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    expect(planned.plan.selection).toBe('all')
    expect(planned.plan.total).toBe(3)
    expect(planned.plan.items.every((item) => item.stepCount === 2)).toBe(true)
    expect(planned.plan.writeSteps).toBe(3)
  })

  it('按站点筛选', () => {
    seed()
    const planned = planUiBatch(workspace(), { site: '示例站' })
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    expect(planned.plan.selection).toBe('site')
    expect(planned.plan.site).toBe('示例站')
    expect(planned.plan.items.map((item) => `${item.site}/${item.flow}`)).toEqual(['示例站/流程A', '示例站/流程B'])
  })

  it('显式 flows：site/flow 与 site/flow@版本', () => {
    seed()
    const planned = planUiBatch(workspace(), { flows: ['另一站/流程C@1', '示例站/流程A'] })
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    expect(planned.plan.selection).toBe('flows')
    expect(planned.plan.items).toHaveLength(2)
    expect(planned.plan.items[0]?.version).toBe(1)
  })

  it('flows 格式不对 → ok:false 可读原因', () => {
    const planned = planUiBatch(workspace(), { flows: ['没有斜杠'] })
    expect(planned.ok).toBe(false)
    if (planned.ok) return
    expect(planned.message).toContain('格式不对')
  })

  it('limit 截断', () => {
    seed()
    const planned = planUiBatch(workspace(), { limit: 2 })
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    expect(planned.plan.total).toBe(2)
    expect(planned.plan.limit).toBe(2)
  })

  it('缺必填入参：计划里列出 missing，不静默跳过', () => {
    const saved = saveUiScript(workspace(), script('示例站', '带参流程', { input: true }))
    expect(saved.ok).toBe(true)
    const planned = planUiBatch(workspace(), {})
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    expect(planned.plan.missingInputs).toEqual(['keyword'])
    expect(planned.plan.items[0]?.missing).toEqual(['keyword'])
  })

  it('坏脚本文件：计划条目带 error，不让整批炸掉', () => {
    seed()
    const bad = saveUiScript(workspace(), script('坏站', '坏流程'))
    expect(bad.ok).toBe(true)
    if (!bad.ok) return
    // 直接改坏文件（模拟手改坏）
    writeFileSync(bad.path, 'kind: ui-script', 'utf8')
    const planned = planUiBatch(workspace(), { site: '坏站' })
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    expect(planned.plan.items[0]?.error).toBeTruthy()
  })
})

describe('executeUiBatch', () => {
  it('汇总通过/失败 + 落 batch.json 与 report.md/json', async () => {
    seed()
    const planned = planUiBatch(workspace(), {})
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    const { runner, calls } = fakeRun({ failFlow: '流程B' })
    const result = await executeUiBatch({ dataRoot: join(workspace(), 'data'), run: runner }, planned)
    expect(calls).toHaveLength(3)
    expect(result.total).toBe(3)
    expect(result.passed).toBe(2)
    expect(result.failed).toBe(1)
    expect(result.skipped).toBe(0)
    expect(result.items.find((item) => item.flow === '流程B')?.failedStep).toBe('s2')

    const record = readUiBatch(join(workspace(), 'data'), result.batchId)
    expect(record?.status).toBe('done')
    expect(record?.passed).toBe(2)
    expect(listUiBatches(join(workspace(), 'data'))).toHaveLength(1)

    const reportPath = join(workspace(), 'data', result.report)
    expect(existsSync(reportPath)).toBe(true)
    const report = readFileSync(reportPath, 'utf8')
    expect(report).toContain('UI 批量回归报告')
    expect(report).toContain('2 通过 / 1 失败')
    expect(report).toContain('流程B')
    expect(existsSync(join(workspace(), 'data', result.reportJson))).toBe(true)
    const json = JSON.parse(readFileSync(join(workspace(), 'data', result.reportJson), 'utf8')) as { success: boolean; items: unknown[] }
    expect(json.success).toBe(false)
    expect(json.items).toHaveLength(3)
  })

  it('缺参脚本：跳过且不调 run；其余照常执行', async () => {
    const withInput = saveUiScript(workspace(), script('示例站', '带参流程', { input: true }))
    const noInput = saveUiScript(workspace(), script('示例站', '普通流程'))
    expect(withInput.ok && noInput.ok).toBe(true)
    const planned = planUiBatch(workspace(), {})
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    const { runner, calls } = fakeRun()
    const result = await executeUiBatch({ dataRoot: join(workspace(), 'data'), run: runner }, planned)
    expect(calls).toEqual(['示例站/普通流程'])
    expect(result.skipped).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.items.find((item) => item.flow === '带参流程')?.error).toContain('缺必填入参')
  })

  it('某条抛错不中断整批', async () => {
    seed()
    const planned = planUiBatch(workspace(), {})
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    const { runner } = fakeRun({ throwFlow: '流程B' })
    const result = await executeUiBatch({ dataRoot: join(workspace(), 'data'), run: runner }, planned)
    expect(result.total).toBe(3)
    expect(result.failed).toBe(1)
    expect(result.items.find((item) => item.flow === '流程B')?.error).toContain('浏览器启动失败')
    expect(result.passed).toBe(2)
  })
})
