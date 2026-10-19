import { expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/index.js'

it('index: 注册 35 个工具（含 trace/lookup/链草稿/dataset、编排、首跑 probe、绑定回写、结晶、诊断与复跑对照、UI 录制回放/批量），策略段含采集/首跑/结晶/UI 纪律', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cap-idx-'))
  const registered: Array<{ name: string }> = []
  const sections: Array<{ name: string; text: string }> = []
  const ctx = {
    logger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
    inject: (services: string[], cb: (svc: Record<string, unknown>) => void) => {
      if (services[0] === 'jobs') cb({ jobs: undefined })
      else cb({ tools: { register: (t: { name: string }) => { registered.push(t) } } })
    },
    systemPrompt: {
      section: (spec: { name: string; text: string }) => sections.push(spec),
      getSectionOrder: () => 0,
    },
  }
  apply(ctx as never, {
    engineRoot: join(dir, 'engine'),
    pythonBin: 'python3',
    dataRoot: join(dir, 'data'),
    timeoutSeconds: 600,
    injectPolicy: true,
    captureMaxDepth: 3,
    captureMaxPages: 50,
    captureStabilityWindowMs: 1500,
    captureBodyLimitBytes: 262_144,
    captureChromeChannel: 'chrome',
    chainRunEnabled: true, chainNodeTimeoutSeconds: 30, chainConcurrency: 4, chainResponseLimitBytes: 2_097_152, chainCredentialPersistence: true, uiTestEnabled: true, uiStepTimeoutSeconds: 15, uiTestBrowser: 'playwright',
  } as never)
  expect(registered).toHaveLength(35)
  const names = registered.map((t) => t.name)
  expect(names.filter((n) => n.startsWith('dataforge_browser_'))).toHaveLength(4)
  expect(names).toContain('dataforge_capture')
  expect(names).toContain('dataforge_capture_cancel')
  expect(names).toContain('dataforge_trace_get')
  expect(names).toContain('dataforge_trace_analyze')
  expect(names).toContain('dataforge_chain_draft')
  expect(names).toContain('dataforge_lookup')
  expect(names).toContain('dataforge_dataset_export')
  // 编排四件套：接口库导入 + 链读写 + 绑定回写（R-1 M3 / R-5 M2）。
  expect(names).toContain('dataforge_library_import')
  expect(names).toContain('dataforge_chain_upsert')
  expect(names).toContain('dataforge_chain_get')
  expect(names).toContain('dataforge_chain_bind')
  // 执行两件套：唯一执行入口 + 链维度运行列表（R-3）。
  expect(names).toContain('dataforge_chain_run')
  expect(names).toContain('dataforge_chain_runs')
  expect(names).toContain('dataforge_chain_probe')
  expect(names).toContain('dataforge_chain_crystallize')
  expect(names).toContain('dataforge_chain_diagnose')
  expect(names).toContain('dataforge_chain_compare')
  // UI 测试八件套：脚本读写 + 录制生命周期 + 回放 + 运行记录。
  expect(names).toContain('dataforge_ui_script_get')
  expect(names).toContain('dataforge_ui_script_upsert')
  expect(names).toContain('dataforge_ui_record_open')
  expect(names).toContain('dataforge_ui_record_start')
  expect(names).toContain('dataforge_ui_record_stop')
  expect(names).toContain('dataforge_ui_record_close')
  expect(names).toContain('dataforge_ui_run')
  expect(names).toContain('dataforge_ui_runs')
  expect(names).toContain('dataforge_ui_batch_run')
  expect(sections.some((s) => s.text.includes('dataforge-capture（接口采集）'))).toBe(true)
  expect(sections.some((s) => s.text.includes('不贴 token/cookie 原文'))).toBe(true)
  expect(sections.some((s) => s.text.includes('dataforge-explore（首跑试探）'))).toBe(true)
  expect(sections.some((s) => s.text.includes('upstream 值绝不冻常量'))).toBe(true)
  expect(sections.some((s) => s.text.includes('dataforge_chain_diagnose(run_id)'))).toBe(true)
  expect(sections.some((s) => s.text.includes('dataforge_chain_bind'))).toBe(true)
  expect(sections.some((s) => s.text.includes('dataforge_chain_compare'))).toBe(true)
  expect(sections.some((s) => s.text.includes('dataforge-ui-test（浏览器录制 + 回放）'))).toBe(true)
  expect(sections.some((s) => s.text.includes('dataforge-trace（采集 → 自动编排草稿）'))).toBe(true)
  expect(sections.some((s) => s.text.includes('密码/上传不进脚本'))).toBe(true)
})
