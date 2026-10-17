import { expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/index.js'

it('index: 注册 18 个工具（含编排三件套、首跑 probe 与结晶），策略段含采集/首跑/结晶纪律', () => {
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
    chainRunEnabled: true, chainNodeTimeoutSeconds: 30, chainConcurrency: 4, chainResponseLimitBytes: 2_097_152, chainCredentialPersistence: true,
  } as never)
  expect(registered).toHaveLength(18)
  const names = registered.map((t) => t.name)
  expect(names.filter((n) => n.startsWith('dataforge_browser_'))).toHaveLength(4)
  expect(names).toContain('dataforge_capture')
  expect(names).toContain('dataforge_capture_cancel')
  // 编排三件套：接口库导入 + 链读写（R-1 M3）。
  expect(names).toContain('dataforge_library_import')
  expect(names).toContain('dataforge_chain_upsert')
  expect(names).toContain('dataforge_chain_get')
  // 执行两件套：唯一执行入口 + 链维度运行列表（R-3）。
  expect(names).toContain('dataforge_chain_run')
  expect(names).toContain('dataforge_chain_runs')
  expect(names).toContain('dataforge_chain_probe')
  expect(names).toContain('dataforge_chain_crystallize')
  expect(sections.some((s) => s.text.includes('dataforge-capture（接口采集）'))).toBe(true)
  expect(sections.some((s) => s.text.includes('不贴 token/cookie 原文'))).toBe(true)
  expect(sections.some((s) => s.text.includes('dataforge-explore（首跑试探）'))).toBe(true)
  expect(sections.some((s) => s.text.includes('upstream 值绝不冻常量'))).toBe(true)
})
