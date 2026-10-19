/**
 * UI 测试工具壳：脚本读写 / 录制落盘 / 回放三道闸。
 *
 * @module dsh-dataforge/test/uitest/tools
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Browser, BrowserContext, Page } from 'playwright-core'
import { defineUiBatchRunTool, defineUiRecordOpenTool, defineUiRecordStopTool, defineUiRunTool, defineUiScriptGetTool, defineUiScriptUpsertTool } from '../../src/tools.js'
import type { UiTestDeps } from '../../src/uitest/application.js'
import type { UiBrowserEngine } from '../../src/uitest/engines.js'
import type { UiRecordingSessions } from '../../src/uitest/sessions.js'
import type { UiRecordingResult } from '../../src/uitest/recorder.js'
import { runUiScript, type UiRunDeps } from '../../src/uitest/run.js'

let dir: string | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'df-ui-tools-'))
})

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

const YAML = `apiVersion: dataforge/v1
kind: ui-script
meta:
  site: 示例站
  flow: 搜索
  version: 1
  created: '2026-10-17T21:00:00+08:00'
  startUrl: https://example.com/
inputs:
  - name: keyword
    type: string
    required: true
steps:
  - id: s1
    kind: goto
    url: https://example.com/
  - id: s2
    kind: fill
    selector: '#kw'
    value: '{{keyword}}'
  - id: s3
    kind: click
    selector: 'button:has-text("搜索")'
    expect:
      - { kind: visible, selector: '#result' }
`

const RECORDED: UiRecordingResult = {
  startUrl: 'https://example.com/',
  viewport: { width: 1280, height: 720 },
  steps: [
    { id: 's1', kind: 'fill', selector: '#kw', value: '键盘精灵' },
    { id: 's2', kind: 'click', selector: 'button:has-text("搜索")' },
  ],
  skippedSecrets: 1,
  skippedUploads: 0,
  singleCandidateSteps: 2,
  totalSteps: 2,
  notice: '跳过 1 次密码输入',
}

function fakeSessions(overrides: Partial<UiRecordingSessions> = {}): UiRecordingSessions {
  return {
    open: async () => ({ ok: true, sessionId: 'uis_x', pageUrl: 'https://example.com/' }),
    start: async () => ({ ok: true, pageUrl: 'https://example.com/' }),
    stop: async () => ({ ok: true, result: RECORDED }),
    cookiesOf: async () => [],
    close: async () => ({ ok: true }),
    list: () => [],
    pageUrlOf: () => 'https://example.com/',
    has: () => true,
    closeAll: async () => undefined,
    ...overrides,
  } as unknown as UiRecordingSessions
}

function fakeBrowser(): { openBrowser: NonNullable<UiRunDeps['openBrowser']> } {
  const page = {
    url: () => 'https://example.com/',
    goto: async () => null,
    locator: (selector: string) => ({
      first() { return this },
      count: async () => 1,
      click: async () => undefined,
      fill: async () => undefined,
      isVisible: async () => true,
      innerText: async () => (selector === '#result' ? '结果' : ''),
      inputValue: async () => '',
      waitFor: async () => undefined,
      press: async () => undefined,
      selectOption: async () => undefined,
      evaluate: async () => undefined,
      setInputFiles: async () => undefined,
    }),
    keyboard: { press: async () => undefined },
    waitForTimeout: async () => undefined,
    screenshot: async () => undefined,
    content: async () => '<html></html>',
  } as unknown as Page
  const context = { addCookies: async () => undefined } as unknown as BrowserContext
  const browser = { close: async () => undefined } as unknown as Browser
  return { openBrowser: async () => ({ browser, context, page }) }
}

function fakeEngine(overrides: Partial<UiBrowserEngine> = {}): UiBrowserEngine {
  const sessions = fakeSessions()
  const { openBrowser } = fakeBrowser()
  return {
    kind: 'playwright',
    label: '假引擎',
    managesCookies: false,
    available: () => true,
    open: (args) => sessions.open(args as never),
    start: (sessionId) => sessions.start(sessionId),
    stop: (sessionId) => sessions.stop(sessionId),
    pickSelector: (sessionId, timeoutMs) => sessions.pickSelector(sessionId, timeoutMs),
    pageMeta: async () => ({ url: 'https://example.com/', title: '示例页 - 示例站', siteName: '示例站' }),
    cookiesOf: (sessionId) => sessions.cookiesOf(sessionId),
    close: (sessionId) => sessions.close(sessionId),
    list: () => sessions.list(),
    pageUrlOf: (sessionId) => sessions.pageUrlOf(sessionId),
    has: (sessionId) => sessions.has(sessionId),
    closeAll: () => sessions.closeAll(),
    run: (doc, inputs, options) => runUiScript(
      { dataRoot: join(dir as string, 'data'), channel: 'chrome', stepTimeoutMs: 400, openBrowser },
      { doc, inputs, ...(options?.headless === undefined ? {} : { headless: options.headless }) },
    ),
    ...overrides,
  }
}

function deps(overrides: Partial<UiTestDeps> = {}): UiTestDeps {
  return {
    resolveWorkspaceRoot: async () => dir as string,
    dataRoot: join(dir as string, 'data'),
    enabled: true,
    resolveEngine: () => ({ engine: fakeEngine() }),
    batchEngine: fakeEngine(),
    ...overrides,
  }
}

describe('UI 脚本工具', () => {
  it('upsert → get：脚本落 v1，详情带 steps 与 yaml', async () => {
    const d = deps()
    const upsert = defineUiScriptUpsertTool(d) as unknown as { execute: (a: { yaml: string }) => Promise<{ ok: boolean; version?: number }> }
    const saved = await upsert.execute({ yaml: YAML })
    expect(saved.ok).toBe(true)
    expect(saved.version).toBe(1)

    const get = defineUiScriptGetTool(d) as unknown as { execute: (a: Record<string, unknown>) => Promise<{ ok: boolean; doc?: { steps: unknown[] }; yaml?: string }> }
    const detail = await get.execute({ site: '示例站', flow: '搜索' })
    expect(detail.ok).toBe(true)
    expect(detail.doc?.steps).toHaveLength(3)
    expect(detail.yaml).toContain('ui-script')
  })

  it('upsert 校验不过不落盘（缺 steps）', async () => {
    const tool = defineUiScriptUpsertTool(deps()) as unknown as { execute: (a: { yaml: string }) => Promise<{ ok: boolean; message?: string }> }
    const value = await tool.execute({ yaml: 'apiVersion: dataforge/v1\nkind: ui-script\nmeta:\n  site: a\n  flow: b\n  version: 1\n  created: now\n  startUrl: https://a.com/\nsteps: []\n' })
    expect(value.ok).toBe(false)
    expect(value.message).toContain('至少')
  })
})

describe('录制工具', () => {
  it('record_stop 带 site/flow → 落脚本新版本', async () => {
    const tool = defineUiRecordStopTool(deps()) as unknown as { execute: (a: Record<string, unknown>) => Promise<{ ok: boolean; stepCount?: number; saved?: { version: number }; skippedSecrets?: number }> }
    const value = await tool.execute({ session_id: 'uis_x', site: '示例站', flow: '录制流程' })
    expect(value.ok).toBe(true)
    expect(value.stepCount).toBe(2)
    expect(value.skippedSecrets).toBe(1)
    expect(value.saved?.version).toBe(1)
  })

  it('record_stop 站点/流程留空 → 自动命名后落盘', async () => {
    const tool = defineUiRecordStopTool(deps()) as unknown as {
      execute: (a: Record<string, unknown>) => Promise<{ ok: boolean; saved?: { site: string; flow: string; version: number }; notice?: string }>
    }
    const value = await tool.execute({ session_id: 'uis_x' })
    expect(value.ok).toBe(true)
    expect(value.saved?.site).toBe('示例站')
    expect(value.saved?.flow).toBe('示例页')
    expect(value.notice).toContain('自动命名')
  })

  it('record_open 拒绝非 http(s) 起点', async () => {
    const tool = defineUiRecordOpenTool(deps()) as unknown as { execute: (a: { start_url: string }) => Promise<{ ok: boolean; error?: string }> }
    const value = await tool.execute({ start_url: 'file:///tmp/x.html' })
    expect(value.ok).toBe(false)
    expect(value.error).toContain('http')
  })
})

describe('回放工具闸门', () => {
  it('缺必填入参 → missing-inputs（不起浏览器）', async () => {
    const d = deps()
    await (defineUiScriptUpsertTool(d) as unknown as { execute: (a: { yaml: string }) => Promise<unknown> }).execute({ yaml: YAML })
    const tool = defineUiRunTool(d) as unknown as { execute: (a: Record<string, unknown>) => Promise<{ ok: boolean; gate?: string; missing?: string[] }> }
    const value = await tool.execute({ site: '示例站', flow: '搜索' })
    expect(value.ok).toBe(false)
    expect(value.gate).toBe('missing-inputs')
    expect(value.missing).toEqual(['keyword'])
  })

  it('不带 confirm → confirm-required 计划卡', async () => {
    const d = deps()
    await (defineUiScriptUpsertTool(d) as unknown as { execute: (a: { yaml: string }) => Promise<unknown> }).execute({ yaml: YAML })
    const tool = defineUiRunTool(d) as unknown as { execute: (a: Record<string, unknown>) => Promise<{ ok: boolean; gate?: string; plan?: { card?: string; stepCount: number } }> }
    const value = await tool.execute({ site: '示例站', flow: '搜索', inputs: { keyword: '键盘精灵' } })
    expect(value.ok).toBe(true)
    expect(value.gate).toBe('confirm-required')
    expect(value.plan?.stepCount).toBe(3)
    expect(value.plan?.card).toContain('确认后带 confirm=true')
  })

  it('confirm=true → 真执行（假浏览器）并留 run', async () => {
    const d = deps()
    await (defineUiScriptUpsertTool(d) as unknown as { execute: (a: { yaml: string }) => Promise<unknown> }).execute({ yaml: YAML })
    const tool = defineUiRunTool(d) as unknown as { execute: (a: Record<string, unknown>) => Promise<{ ok: boolean; gate?: string; result?: { success: boolean; totalSteps: number; runId: string } }> }
    const value = await tool.execute({ site: '示例站', flow: '搜索', inputs: { keyword: '键盘精灵' }, confirm: true })
    expect(value.ok).toBe(true)
    expect(value.gate).toBe('executed')
    expect(value.result?.success).toBe(true)
    expect(value.result?.totalSteps).toBe(3)
    expect(value.result?.runId).toMatch(/^uir_/)
  })

  it('批量：计划卡 → 确认执行（假浏览器）→ 报告落盘', async () => {
    const d = deps()
    await (defineUiScriptUpsertTool(d) as unknown as { execute: (a: { yaml: string }) => Promise<unknown> }).execute({ yaml: YAML })
    const tool = defineUiBatchRunTool(d) as unknown as {
      execute: (a: Record<string, unknown>) => Promise<{
        ok: boolean
        gate?: string
        plan?: { total: number; items: Array<{ missing: string[] }> }
        result?: { passed: number; failed: number; total: number; report: string; reportJson: string }
      }>
    }
    const planned = await tool.execute({})
    expect(planned.ok).toBe(true)
    expect(planned.gate).toBe('confirm-required')
    expect(planned.plan?.total).toBe(1)
    expect(planned.plan?.items[0]?.missing).toEqual(['keyword'])

    const result = await tool.execute({ inputs: { keyword: '键盘精灵' }, confirm: true })
    expect(result.ok).toBe(true)
    expect(result.gate).toBe('executed')
    expect(result.result?.total).toBe(1)
    expect(result.result?.passed).toBe(1)
    expect(result.result?.failed).toBe(0)
    expect(result.result?.report).toContain('ui-batches')
    expect(existsSync(join(dir as string, 'data', result.result?.report as string))).toBe(true)
  })

  it('开关关闭 → ui-test-disabled', async () => {
    const d = deps({ enabled: false })
    const tool = defineUiRunTool(d) as unknown as { execute: (a: Record<string, unknown>) => Promise<{ gate?: string }> }
    const value = await tool.execute({ site: 'a', flow: 'b' })
    expect(value.gate).toBe('ui-test-disabled')
  })
})
