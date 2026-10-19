/**
 * UI 回放引擎：步骤执行 / 候选回退 / 断言 / 失败证据 / 入参替换 / cookie 注入。
 *
 * 用假浏览器驱动：只实现回放器用到的 Page 原语，真 Chrome 的端到端在
 * `test/uitest/e2e-local.test.ts`（默认跳过）。
 *
 * @module dsh-dataforge/test/uitest/run
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Browser, BrowserContext, Page } from 'playwright-core'
import type { UiScriptDoc } from '../../src/uitest/schema.js'
import { planUiRun, runUiScript, type UiCookie, type UiRunDeps } from '../../src/uitest/run.js'
import { readUiRunEvents, readUiRunRecord } from '../../src/uitest/run-store.js'

/** 单个 selector 的假行为。 */
type ElementSpec = {
  count?: number
  visible?: boolean
  text?: string
  value?: string
  /** click 后把页面 URL 改到哪。 */
  clickUrl?: string
  clickError?: string
}

type FakeBrowser = {
  page: Page
  context: BrowserContext
  browser: Browser
  /** 记录动作（元素选择器 + 方法 + 参数）。 */
  actions: Array<{ selector: string; method: string; args: unknown[] }>
  cookies: Array<Record<string, unknown>>
  gotoUrls: string[]
  closed: boolean
  /** 页面当前 URL。 */
  currentUrl: () => string
}

function fakeBrowser(elements: Record<string, ElementSpec> = {}): FakeBrowser {
  const spec = (selector: string): ElementSpec => elements[selector] ?? { count: 1, visible: true, text: '结果：键盘精灵', value: '' }
  let url = 'about:blank'
  const actions: FakeBrowser['actions'] = []
  const gotoUrls: string[] = []
  let closed = false
  const cookies: Array<Record<string, unknown>> = []

  const locator = (selector: string): Record<string, unknown> => {
    const self: Record<string, unknown> = {
      first: () => self,
      count: async () => spec(selector).count ?? 1,
      click: async (...args: unknown[]) => {
        actions.push({ selector, method: 'click', args })
        const target = spec(selector)
        if (target.clickError !== undefined) throw new Error(target.clickError)
        if (target.clickUrl !== undefined) url = target.clickUrl
      },
      fill: async (value: unknown) => { actions.push({ selector, method: 'fill', args: [value] }) },
      selectOption: async (value: unknown) => { actions.push({ selector, method: 'selectOption', args: [value] }) },
      press: async (key: unknown) => { actions.push({ selector, method: 'press', args: [key] }) },
      evaluate: async (script: unknown) => {
        actions.push({ selector, method: 'evaluate', args: [script] })
        return undefined
      },
      setInputFiles: async (files: unknown) => { actions.push({ selector, method: 'setInputFiles', args: [files] }) },
      isVisible: async () => spec(selector).visible ?? true,
      innerText: async () => spec(selector).text ?? '',
      inputValue: async () => spec(selector).value ?? '',
      waitFor: async () => undefined,
    }
    return self
  }

  const page = {
    url: () => url,
    goto: async (target: string) => { url = target; gotoUrls.push(target); return null },
    locator,
    keyboard: { press: async (key: unknown) => { actions.push({ selector: '<page>', method: 'keyboard.press', args: [key] }) } },
    waitForTimeout: async () => undefined,
    screenshot: async () => undefined,
    content: async () => '<html>failure</html>',
  } as unknown as Page

  const context = {
    addCookies: async (list: Array<Record<string, unknown>>) => { cookies.push(...list) },
  } as unknown as BrowserContext

  const browser = {
    close: async () => { closed = true },
  } as unknown as Browser

  return {
    page, context, browser, actions, cookies, gotoUrls,
    get closed() { return closed },
    currentUrl: () => url,
  }
}

function doc(overrides: Partial<UiScriptDoc> = {}): UiScriptDoc {
  return {
    apiVersion: 'dataforge/v1',
    kind: 'ui-script',
    meta: {
      site: '示例站',
      flow: '搜索',
      version: 1,
      created: '2026-10-17T21:00:00+08:00',
      startUrl: 'https://example.com/',
      viewport: { width: 1280, height: 720 },
    },
    inputs: [],
    steps: [
      { id: 's1', kind: 'goto', url: 'https://example.com/' },
      { id: 's2', kind: 'fill', selector: '#kw', value: '键盘精灵' },
      { id: 's3', kind: 'click', selector: 'button:has-text("搜索")' },
      { id: 's4', kind: 'click', selector: '#detail' },
    ],
    ...overrides,
  }
}

let dir: string | undefined
let fake: FakeBrowser

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'df-ui-run-'))
})

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

function deps(overrides: Partial<UiRunDeps> = {}): UiRunDeps {
  return {
    dataRoot: dir as string,
    channel: 'chrome',
    stepTimeoutMs: 400,
    openBrowser: async () => ({ browser: fake.browser, context: fake.context, page: fake.page }),
    ...overrides,
  }
}

describe('planUiRun', () => {
  it('计划：入参替换 + 写操作计数', () => {
    const script = doc({
      meta: {
        site: '示例站', flow: '搜索', version: 1, created: '2026-10-17T21:00:00+08:00',
        startUrl: 'https://example.com/?q={{kw}}',
      },
      inputs: [{ name: 'kw', type: 'string', required: true }],
      steps: [
        { id: 's1', kind: 'goto', url: 'https://example.com/?q={{kw}}' },
        { id: 's2', kind: 'fill', selector: '#kw', value: '{{kw}}' },
        { id: 's3', kind: 'wait', ms: 100 },
      ],
    })
    const plan = planUiRun(script, { kw: '键盘精灵' })
    expect(plan.startUrl).toBe('https://example.com/?q=键盘精灵')
    expect(plan.writeSteps).toBe(0)
    expect(plan.steps[1]?.value).toBe('键盘精灵')
  })

  it('click/submit/upload 计为写操作', () => {
    const plan = planUiRun(doc())
    expect(plan.writeSteps).toBe(2)
  })
})

describe('runUiScript', () => {
  it('全部步骤 + 断言通过：success + 留痕', async () => {
    fake = fakeBrowser({ '#detail': { count: 1, visible: true } })
    const script = doc({
      steps: [
        { id: 's1', kind: 'goto', url: 'https://example.com/' },
        { id: 's2', kind: 'fill', selector: '#kw', value: '键盘精灵' },
        {
          id: 's3', kind: 'click', selector: 'button:has-text("搜索")',
          expect: [{ kind: 'text', selector: '#echo', equals: '结果：键盘精灵' }],
        },
      ],
    })
    const result = await runUiScript(deps(), { doc: script })
    expect(result.success).toBe(true)
    expect(result.steps.map((step) => step.ok)).toEqual([true, true, true])
    expect(result.failedStep).toBeUndefined()
    expect(fake.gotoUrls[0]).toBe('https://example.com/')
    expect(fake.actions.some((action) => action.method === 'fill' && action.args[0] === '键盘精灵')).toBe(true)
    expect(fake.closed).toBe(true)

    const record = readUiRunRecord(dir as string, result.runId)
    expect(record?.status).toBe('success')
    const events = readUiRunEvents(dir as string, result.runId)
    expect(events.some((event) => event.event === 'step' && event.status === 'done')).toBe(true)
    expect(events.some((event) => event.event === 'terminal' && event.success === true)).toBe(true)
  })

  it('断言失败：fail-fast + 截图/现场留痕', async () => {
    fake = fakeBrowser({ '#echo': { count: 1, visible: true, text: '别的结果' } })
    const script = doc({
      steps: [
        { id: 's1', kind: 'goto', url: 'https://example.com/' },
        {
          id: 's2', kind: 'click', selector: 'button:has-text("搜索")',
          expect: [{ kind: 'text', selector: '#echo', equals: '结果：键盘精灵' }],
        },
        { id: 's3', kind: 'click', selector: '#never' },
      ],
    })
    const result = await runUiScript(deps(), { doc: script })
    expect(result.success).toBe(false)
    expect(result.failedStep?.id).toBe('s2')
    expect(result.steps).toHaveLength(2)
    expect(result.screenshot).toBe(join('ui-runs', result.runId, 'failure.png'))
    expect(result.dom).toBe(join('ui-runs', result.runId, 'failure.html'))
    expect(existsSync(join(dir as string, result.dom as string))).toBe(true)
    expect(readFileSync(join(dir as string, result.dom as string), 'utf8')).toContain('failure')
    const record = readUiRunRecord(dir as string, result.runId)
    expect(record?.status).toBe('failed')
    expect(record?.failedStep).toBe('s2')
  })

  it('候选回退：第一个候选有歧义 → 用第二个唯一候选', async () => {
    fake = fakeBrowser({
      '[data-testid="search"]': { count: 2 },
      'button:has-text("搜索")': { count: 1 },
    })
    const script = doc({
      steps: [{
        id: 's1', kind: 'click',
        selector: '[data-testid="search"]',
        candidates: ['[data-testid="search"]', 'button:has-text("搜索")'],
      }],
    })
    const result = await runUiScript(deps(), { doc: script })
    expect(result.success).toBe(true)
    expect(result.steps[0]?.target).toBe('button:has-text("搜索")')
    expect(fake.actions[0]?.selector).toBe('button:has-text("搜索")')
  })

  it('入参替换：fill 值里的 {{kw}} 换成运行值', async () => {
    fake = fakeBrowser()
    const script = doc({
      inputs: [{ name: 'kw', type: 'string', required: true }],
      steps: [{ id: 's1', kind: 'fill', selector: '#kw', value: '{{kw}}' }],
    })
    const result = await runUiScript(deps(), { doc: script, inputs: { kw: 'C/D 值' } })
    expect(result.success).toBe(true)
    expect(fake.actions[0]?.args[0]).toBe('C/D 值')
  })

  it('cookie 注入：只进 context，回执只有条数', async () => {
    fake = fakeBrowser()
    const cookies: UiCookie[] = [
      { name: 'sid', value: 'SECRET-A', domain: 'example.com' },
      { name: 'token', value: 'SECRET-B', domain: '.example.com' },
    ]
    const result = await runUiScript(deps({ loadCookies: async () => cookies }), {
      doc: doc({ steps: [{ id: 's1', kind: 'goto', url: 'https://example.com/' }] }),
    })
    expect(result.cookiesApplied).toBe(2)
    expect(fake.cookies).toHaveLength(2)
    expect(fake.cookies[0]?.['name']).toBe('sid')
    expect(JSON.stringify(result)).not.toContain('SECRET-A')
    expect(JSON.stringify(result)).not.toContain('SECRET-B')
  })

  it('slowMoMs：慢放只影响节奏，结果与顺序不变', async () => {
    fake = fakeBrowser()
    const script = doc({
      steps: [
        { id: 's1', kind: 'goto', url: 'https://example.com/' },
        { id: 's2', kind: 'click', selector: '#go' },
      ],
    })
    const result = await runUiScript(deps(), { doc: script, slowMoMs: 10 })
    expect(result.success).toBe(true)
    expect(result.steps.map((step) => step.id)).toEqual(['s1', 's2'])
  })

  it('动作抛错（元素不存在等）：记录错误不崩溃', async () => {
    fake = fakeBrowser({ '#boom': { count: 1, clickError: 'element is not visible' } })
    const script = doc({ steps: [{ id: 's1', kind: 'click', selector: '#boom' }] })
    const result = await runUiScript(deps(), { doc: script })
    expect(result.success).toBe(false)
    expect(result.error).toContain('element is not visible')
    expect(result.steps[0]?.error).toContain('element is not visible')
  })

  it('浏览器启动失败：running → failed，不留 running 假象', async () => {
    const result = await runUiScript(deps({
      openBrowser: async () => { throw new Error('chrome 启动失败') },
    }), { doc: doc() })
    expect(result.success).toBe(false)
    expect(result.error).toContain('chrome 启动失败')
    expect(readUiRunRecord(dir as string, result.runId)?.status).toBe('failed')
  })
})
