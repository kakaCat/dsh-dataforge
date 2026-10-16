import { expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/index.js'

it('index: 注册 11 个工具，策略段含采集纪律', () => {
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
  } as never)
  expect(registered).toHaveLength(11)
  const names = registered.map((t) => t.name)
  expect(names.filter((n) => n.startsWith('dataforge_browser_'))).toHaveLength(4)
  expect(names).toContain('dataforge_capture')
  expect(names).toContain('dataforge_capture_cancel')
  expect(sections.some((s) => s.text.includes('dataforge-capture（接口采集）'))).toBe(true)
  expect(sections.some((s) => s.text.includes('不贴 token/cookie 原文'))).toBe(true)
})
