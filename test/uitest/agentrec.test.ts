/**
 * AI 代办录制（agentrec）单测：步骤构建纯函数 + 假页面驱动的会话 + 落盘审查闭环。
 *
 * 假页面只实现 act() 会碰到的那几个方法（evaluate 字符串分发 / locator 族），
 * 真实 Chrome 端到端见 e2e-local.test.ts（UI_E2E=1 才跑）。
 */
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, beforeEach } from 'vitest'
import {
  AgentRecordingSessions, AGENT_HELPER_SCRIPT,
  buildAgentStep, clickPointOfDesc, slotNameOf,
  type AgentElementDesc,
} from '../../src/uitest/agentrec.js'
import { parseUiScriptYaml } from '../../src/uitest/schema.js'
import {
  confirmAgentReviewForTool, openAgentSessionForTool, agentActForTool, stopAgentSessionForTool,
  type UiTestDeps,
} from '../../src/uitest/application.js'
import type { UiBrowserEngine } from '../../src/uitest/engines.js'

/* ── 假页面 ── */

type FakeLocator = {
  waitFor: (opts?: unknown) => Promise<void>
  first: () => FakeLocator
  click: (opts?: unknown) => Promise<void>
  fill: (value: string, opts?: unknown) => Promise<void>
  selectOption: (value: string, opts?: unknown) => Promise<void>
  press: (key: string, opts?: unknown) => Promise<void>
  scrollIntoViewIfNeeded: (opts?: unknown) => Promise<void>
  evaluate: (fn: unknown) => Promise<{ candidates: string[]; tag: string }>
  boundingBox: () => Promise<{ x: number; y: number; width: number; height: number } | null>
}

function makeFakePage(elements: Record<string, AgentElementDesc>, challenge: { detected: boolean; markers: string[] } = { detected: false, markers: [] }) {
  const calls: Array<{ method: string; arg?: unknown }> = []
  const locatorOf = (selector: string): FakeLocator => {
    const base: FakeLocator = {
      waitFor: async () => {
        if (elements[selector] === undefined) throw new Error(`no such selector: ${selector}`)
      },
      first() { return base },
      click: async () => { calls.push({ method: 'click', arg: selector }) },
      fill: async (value: string) => { calls.push({ method: 'fill', arg: { selector, value } }) },
      selectOption: async (value: string) => { calls.push({ method: 'select', arg: { selector, value } }) },
      press: async (key: string) => { calls.push({ method: 'press', arg: { selector, key } }) },
      scrollIntoViewIfNeeded: async () => { calls.push({ method: 'scrollIntoView', arg: selector }) },
      evaluate: async () => ({ candidates: elements[selector]?.candidates ?? [], tag: elements[selector]?.tag ?? '' }),
      boundingBox: async () => elements[selector]?.rect ?? null,
    }
    return base
  }
  const page = {
    url: () => 'https://example.com/home',
    title: async () => '示例站',
    goto: async (url: string) => { calls.push({ method: 'goto', arg: url }); page.url = () => url },
    waitForTimeout: async (ms: number) => { calls.push({ method: 'wait', arg: ms }) },
    mouse: { wheel: async (_x: number, y: number) => { calls.push({ method: 'wheel', arg: y }) } },
    locator: (selector: string) => locatorOf(selector),
    evaluate: async (expr: unknown) => {
      const text = String(expr)
      if (text.includes('__dfUiDescribe')) {
        const match = /\("(.+)"\)/.exec(text.replace(/\\"/g, '"'))
        const selector = match?.[1] ?? ''
        return elements[selector] ?? { found: false }
      }
      if (text.includes('__dfUiChallenge')) return challenge
      if (text.includes('__dfUiInspect')) {
        return { url: 'https://example.com/home', title: '示例站', elements: [], challenge }
      }
      if (text.includes('__dfUiSelectorCandidates') || text.includes('__dfUiAgentVersion')) return undefined
      return undefined
    },
    __calls: calls,
  }
  return page
}

function fakeBrowserFactory(page: ReturnType<typeof makeFakePage>) {
  return async () => ({
    browser: { close: async () => undefined } as never,
    context: { cookies: async () => [], addCookies: async () => undefined, addInitScript: async () => undefined } as never,
    page: page as never,
  })
}

const DESC_USERNAME: AgentElementDesc = {
  found: true, tag: 'INPUT', isPassword: false, text: '',
  candidates: ['#username', 'input[name="username"]'],
  features: { tag: 'input', name: 'username' },
  rect: { x: 100, y: 200, width: 200, height: 40 },
  vw: 1280, vh: 720,
}

const DESC_PASSWORD: AgentElementDesc = {
  found: true, tag: 'INPUT', isPassword: true, text: '',
  candidates: ['#password'],
  features: { tag: 'input', type: 'password', name: 'password' },
  rect: { x: 100, y: 260, width: 200, height: 40 },
  vw: 1280, vh: 720,
}

const DESC_SEARCH_BUTTON: AgentElementDesc = {
  found: true, tag: 'BUTTON', isPassword: false, text: '搜索',
  candidates: ['#search-btn', 'button:has-text("搜索")'],
  features: { tag: 'button', text: '搜索' },
  rect: { x: 300, y: 100, width: 80, height: 32 },
  vw: 1280, vh: 720,
}

/* ── 纯步骤构建 ── */

describe('buildAgentStep', () => {
  it('click：候选/特征/落点/at 齐全', () => {
    const step = buildAgentStep(1, { kind: 'click', selector: '#search-btn' }, DESC_SEARCH_BUTTON, 'https://example.com/home')
    expect(step).toMatchObject({
      id: 's1', kind: 'click',
      selector: '#search-btn',
      candidates: ['#search-btn', 'button:has-text("搜索")'],
      at: 'https://example.com/home',
    })
    expect(step.features?.text).toBe('搜索')
    expect(step.clickPoint).toMatchObject({ fx: 0.5, fy: 0.5, vw: 1280, vh: 720, bx: 300, by: 100 })
  })

  it('fill 密码字段：无论给什么值都脱敏为 {{password}}', () => {
    const step = buildAgentStep(2, { kind: 'fill', selector: '#password', value: '不该出现' }, DESC_PASSWORD, 'https://example.com/')
    expect(step.value).toBe('{{password}}')
    expect(JSON.stringify(step)).not.toContain('不该出现')
  })

  it('fill valueFrom：值记 {{槽位}}（槽位名消毒）', () => {
    const step = buildAgentStep(3, { kind: 'fill', selector: '#username', valueFrom: 'login.user' }, DESC_USERNAME, 'https://example.com/')
    expect(step.value).toBe('{{login_user}}')
  })

  it('scroll 两种形态：窗口滚动带 deltaY；元素滚动带目标', () => {
    const windowStep = buildAgentStep(4, { kind: 'scroll', deltaY: 800 }, undefined, 'https://example.com/')
    expect(windowStep).toMatchObject({ kind: 'scroll', deltaY: 800 })
    const elStep = buildAgentStep(5, { kind: 'scroll', selector: '#list' }, DESC_USERNAME, 'https://example.com/')
    expect(elStep.selector).toBe('#username')
    expect(elStep.deltaY).toBeUndefined()
  })

  it('press 带/不带 selector；goto/wait 无目标', () => {
    expect(buildAgentStep(6, { kind: 'press', key: 'Enter' }, undefined, 'https://e.com/'))
      .toMatchObject({ kind: 'press', key: 'Enter' })
    expect(buildAgentStep(7, { kind: 'press', key: 'Enter', selector: '#q' }, DESC_USERNAME, 'https://e.com/').selector)
      .toBe('#username')
    expect(buildAgentStep(8, { kind: 'goto', url: 'https://e.com/x' }, undefined, 'https://e.com/x'))
      .toMatchObject({ kind: 'goto', url: 'https://e.com/x' })
    expect(buildAgentStep(9, { kind: 'wait', ms: 500 }, undefined, 'https://e.com/'))
      .toMatchObject({ kind: 'wait', ms: 500 })
  })

  it('clickPointOfDesc：无 rect 返回 undefined', () => {
    expect(clickPointOfDesc({ found: true })).toBeUndefined()
  })

  it('slotNameOf：消毒到合法槽位名', () => {
    expect(slotNameOf('login.user')).toBe('login_user')
    expect(slotNameOf('9token')).toBe('_9token')
    expect(slotNameOf(' password ')).toBe('_password_')
  })
})

/* ── 假页面驱动的会话 ── */

describe('AgentRecordingSessions（假页面）', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'df-agentrec-'))
  })

  function makeSessions(page: ReturnType<typeof makeFakePage>) {
    return new AgentRecordingSessions({ openBrowser: fakeBrowserFactory(page), dataRoot: join(dir, 'data') })
  }

  it('act 执行 + 录步 + 探测 challenge；inspect 不录步', async () => {
    const page = makeFakePage({ '#username': DESC_USERNAME, '#password': DESC_PASSWORD, '#search-btn': DESC_SEARCH_BUTTON })
    const sessions = makeSessions(page)
    const opened = await sessions.open({ startUrl: 'https://example.com/', task: '登录并搜索' })
    expect(opened.ok).toBe(true)

    const inspect = await sessions.act(opened.sessionId as string, { kind: 'inspect' })
    expect(inspect.ok).toBe(true)
    expect(inspect.inspect?.title).toBe('示例站')
    expect(sessions.stepsOf(opened.sessionId as string)).toHaveLength(0)

    const fill = await sessions.act(opened.sessionId as string, {
      kind: 'fill', selector: '#username', value: 'kaka',
    })
    expect(fill.ok).toBe(true)
    expect(fill.step).toMatchObject({ kind: 'fill', selector: '#username', value: 'kaka' })

    const secret = await sessions.act(opened.sessionId as string, {
      kind: 'fill', selector: '#password', valueFrom: 'loginPassword',
    }, { loginPassword: 's3cret' })
    expect(secret.ok).toBe(true)
    expect(secret.valueMasked).toBe(true)
    expect(secret.step?.value).toBe('{{loginPassword}}')

    const click = await sessions.act(opened.sessionId as string, { kind: 'click', selector: '#search-btn' })
    expect(click.ok).toBe(true)
    expect(click.challenge?.detected).toBe(false)

    expect(sessions.stepsOf(opened.sessionId as string)).toHaveLength(3)
    expect(sessions.secretSlotsOf(opened.sessionId as string)).toEqual(['loginPassword'])
    // 密钥值没有泄漏进步骤/回执
    expect(JSON.stringify(sessions.stepsOf(opened.sessionId as string))).not.toContain('s3cret')
  })

  it('密码字段拒绝明文 value', async () => {
    const page = makeFakePage({ '#password': DESC_PASSWORD })
    const sessions = makeSessions(page)
    const opened = await sessions.open({ startUrl: 'https://example.com/', task: '登录' })
    const result = await sessions.act(opened.sessionId as string, { kind: 'fill', selector: '#password', value: '明文' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('valueFrom')
    expect(sessions.stepsOf(opened.sessionId as string)).toHaveLength(0)
  })

  it('valueFrom 键不存在：不执行不录步', async () => {
    const page = makeFakePage({ '#password': DESC_PASSWORD })
    const sessions = makeSessions(page)
    const opened = await sessions.open({ startUrl: 'https://example.com/', task: '登录' })
    const result = await sessions.act(opened.sessionId as string, { kind: 'fill', selector: '#password', valueFrom: 'nope' }, {})
    expect(result.ok).toBe(false)
    expect(result.error).toContain('nope')
  })

  it('定位失败：不录步，提示先 inspect', async () => {
    const page = makeFakePage({})
    const sessions = makeSessions(page)
    const opened = await sessions.open({ startUrl: 'https://example.com/', task: 'x' })
    const result = await sessions.act(opened.sessionId as string, { kind: 'click', selector: '#ghost' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('inspect')
    expect(sessions.stepsOf(opened.sessionId as string)).toHaveLength(0)
  })

  it('检测到 challenge 如实上报', async () => {
    const page = makeFakePage({ '#search-btn': DESC_SEARCH_BUTTON }, { detected: true, markers: ['captcha-iframe'] })
    const sessions = makeSessions(page)
    const opened = await sessions.open({ startUrl: 'https://example.com/', task: 'x' })
    const result = await sessions.act(opened.sessionId as string, { kind: 'click', selector: '#search-btn' })
    expect(result.ok).toBe(true)
    expect(result.challenge).toEqual({ detected: true, markers: ['captcha-iframe'] })
  })

  it('goto/wait/scroll 窗口形态录步正确', async () => {
    const page = makeFakePage({})
    const sessions = makeSessions(page)
    const opened = await sessions.open({ startUrl: 'https://example.com/', task: 'x' })
    const id = opened.sessionId as string
    expect((await sessions.act(id, { kind: 'goto', url: 'https://example.com/list' })).step)
      .toMatchObject({ kind: 'goto', url: 'https://example.com/list' })
    expect((await sessions.act(id, { kind: 'wait', ms: 300 })).step).toMatchObject({ kind: 'wait', ms: 300 })
    expect((await sessions.act(id, { kind: 'scroll', deltaY: 600 })).step).toMatchObject({ kind: 'scroll', deltaY: 600 })
    expect(page.__calls.map((c) => c.method)).toContain('wheel')
  })

  it('非法 goto url / 缺 value 的 fill：参数闸不进会话', async () => {
    const page = makeFakePage({ '#username': DESC_USERNAME })
    const sessions = makeSessions(page)
    const opened = await sessions.open({ startUrl: 'https://example.com/', task: 'x' })
    const id = opened.sessionId as string
    expect((await sessions.act(id, { kind: 'goto', url: 'ftp://x' })).ok).toBe(false)
    expect((await sessions.act(id, { kind: 'fill', selector: '#username' })).ok).toBe(false)
    expect(sessions.stepsOf(id)).toHaveLength(0)
  })

  it('留痕：run.json + events.ndjson，事件里没有值', async () => {
    const page = makeFakePage({ '#password': DESC_PASSWORD })
    const sessions = makeSessions(page)
    const opened = await sessions.open({ startUrl: 'https://example.com/', task: '留痕' })
    const id = opened.sessionId as string
    await sessions.act(id, { kind: 'fill', selector: '#password', valueFrom: 'pw' }, { pw: 's3cret' })
    await sessions.close(id)
    const runDir = join(dir, 'data', 'ui-agent-runs', opened.runId as string)
    expect(existsSync(join(runDir, 'run.json'))).toBe(true)
    const events = readFileSync(join(runDir, 'events.ndjson'), 'utf8')
    expect(events).toContain('"event":"open"')
    expect(events).toContain('"valueMasked":true')
    expect(events).not.toContain('s3cret')
  })
})

/* ── 应用层：三道闸 + 落盘待审查 + 审查确认 ── */

describe('代办录制应用层', () => {
  let dir: string
  let deps: UiTestDeps

  const fakeEngine = (): UiBrowserEngine => ({
    kind: 'playwright', label: 'fake', managesCookies: false, available: () => true,
    open: async () => ({ ok: true, sessionId: 's1' }),
    start: async () => ({ ok: true }), stop: async () => ({ ok: true, result: undefined as never }),
    pickSelector: async () => ({ ok: false }), pageMeta: async () => ({}),
    cookiesOf: async () => [], close: async () => ({ ok: true }), list: () => [],
    pageUrlOf: () => undefined, has: () => true, closeAll: async () => {},
    run: async () => ({ ok: false }) as never,
  })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'df-agentapp-'))
    deps = {
      resolveWorkspaceRoot: async () => dir,
      dataRoot: join(dir, 'data'),
      enabled: true,
      resolveEngine: () => ({ engine: fakeEngine() }),
      batchEngine: fakeEngine(),
      agentSessions: new AgentRecordingSessions(),
      agentSecrets: {},
    }
  })

  it('open 闸2：不带 confirm 只回计划卡；空任务被拒', async () => {
    const plan = await openAgentSessionForTool(deps, undefined, {
      task: '收集文章', startUrl: 'https://example.com/',
    })
    expect(plan.ok).toBe(true)
    expect(plan.gate).toBe('confirm-required')
    expect(plan.plan?.card).toContain('收集文章')
    expect(plan.sessionId).toBeUndefined()

    const empty = await openAgentSessionForTool(deps, undefined, { task: '  ', startUrl: 'https://example.com/', confirm: true })
    expect(empty.ok).toBe(false)
  })

  it('open 引擎无关：shared 引擎下代办会话照开（自己的浏览器工厂）', async () => {
    const sharedDeps: UiTestDeps = {
      ...deps,
      resolveEngine: () => ({ engine: { ...fakeEngine(), kind: 'shared' as const } }),
      agentSessions: new AgentRecordingSessions({ openBrowser: fakeBrowserFactory(makeFakePage({})) }),
    }
    const result = await openAgentSessionForTool(sharedDeps, undefined, {
      task: 'x', startUrl: 'https://example.com/', confirm: true,
    })
    expect(result.ok).toBe(true)
    expect(result.sessionId).toBeTruthy()
    await sharedDeps.agentSessions.close(result.sessionId as string)
  })

  it('stop 落盘：review=pending + task + 密钥槽位 inputs；confirm 转 confirmed 新版本', async () => {
    const page = makeFakePage({ '#password': DESC_PASSWORD, '#search-btn': DESC_SEARCH_BUTTON })
    deps.agentSessions = new AgentRecordingSessions({ openBrowser: fakeBrowserFactory(page) })
    deps.agentSecrets = { loginPassword: 's3cret' }

    const opened = await openAgentSessionForTool(deps, undefined, {
      task: '登录并搜索文章', startUrl: 'https://example.com/', confirm: true,
    })
    expect(opened.ok).toBe(true)
    const sessionId = opened.sessionId as string

    await agentActForTool(deps, { sessionId, act: { kind: 'fill', selector: '#password', valueFrom: 'loginPassword' } })
    await agentActForTool(deps, { sessionId, act: { kind: 'click', selector: '#search-btn' } })

    const stopped = await stopAgentSessionForTool(deps, undefined, { sessionId, site: '示例站', flow: '文章搜索' })
    expect(stopped.ok).toBe(true)
    expect(stopped.saved?.review).toBe('pending')
    expect(stopped.saved?.version).toBe(1)

    const yaml = readFileSync(join(dir, '.dsh', 'dataforge', 'ui-tests', '示例站', '文章搜索', 'v1.yaml'), 'utf8')
    expect(yaml).toContain('review: pending')
    expect(yaml).toContain('task: 登录并搜索文章')
    expect(yaml).toContain('{{loginPassword}}')
    expect(yaml).not.toContain('s3cret')
    const parsed = parseUiScriptYaml(yaml)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.doc.inputs).toEqual([{ name: 'loginPassword', type: 'string', required: true, example: '回放时由人提供' }])
    }

    // 审查确认 → v2 confirmed（版本不可变，旧 v1 原样）
    const confirmed = await confirmAgentReviewForTool(dir, { site: '示例站', flow: '文章搜索', version: 1 })
    expect(confirmed.ok).toBe(true)
    expect(confirmed.version).toBe(2)
    const v1 = readFileSync(join(dir, '.dsh', 'dataforge', 'ui-tests', '示例站', '文章搜索', 'v1.yaml'), 'utf8')
    const v2 = readFileSync(join(dir, '.dsh', 'dataforge', 'ui-tests', '示例站', '文章搜索', 'v2.yaml'), 'utf8')
    expect(v1).toContain('review: pending')
    expect(v2).toContain('review: confirmed')
  })

  it('stop 空步骤不落盘但正常收口', async () => {
    const page = makeFakePage({})
    deps.agentSessions = new AgentRecordingSessions({ openBrowser: fakeBrowserFactory(page) })
    const opened = await openAgentSessionForTool(deps, undefined, {
      task: 'x', startUrl: 'https://example.com/', confirm: true,
    })
    const stopped = await stopAgentSessionForTool(deps, undefined, { sessionId: opened.sessionId as string })
    expect(stopped.ok).toBe(true)
    expect(stopped.stepCount).toBe(0)
    expect(stopped.saved).toBeUndefined()
    expect(existsSync(join(dir, '.dsh', 'dataforge', 'ui-tests'))).toBe(false)
  })
})

describe('脚本 schema：scroll 步骤与 review/task 元信息', () => {
  it('scroll 两种形态解析通过；selector 与 deltaY 互斥', () => {
    const yaml = `apiVersion: dataforge/v1
kind: ui-script
meta: { site: s, flow: f, version: 1, created: '2026-01-01T00:00:00Z', startUrl: 'https://e.com/' }
inputs: []
steps:
  - { id: s1, kind: scroll, deltaY: 500 }
  - { id: s2, kind: scroll, selector: '#list' }
`
    const parsed = parseUiScriptYaml(yaml)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.doc.steps[0].deltaY).toBe(500)
      expect(parsed.doc.steps[1].selector).toBe('#list')
    }

    const bad = parseUiScriptYaml(yaml.replace('deltaY: 500', 'deltaY: 99999'))
    expect(bad.ok).toBe(false)
    const both = parseUiScriptYaml(yaml.replace("selector: '#list'", "selector: '#list', deltaY: 1"))
    expect(both.ok).toBe(false)
  })

  it('review/task 元信息解析；非法 review 值被忽略', () => {
    const yaml = `apiVersion: dataforge/v1
kind: ui-script
meta: { site: s, flow: f, version: 1, created: '2026-01-01T00:00:00Z', startUrl: 'https://e.com/', review: pending, task: '收集文章' }
inputs: []
steps:
  - { id: s1, kind: wait, ms: 100 }
`
    const parsed = parseUiScriptYaml(yaml)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.doc.meta.review).toBe('pending')
      expect(parsed.doc.meta.task).toBe('收集文章')
    }
    const bad = parseUiScriptYaml(yaml.replace('review: pending', 'review: banana'))
    expect(bad.ok).toBe(true)
    if (bad.ok) expect(bad.doc.meta.review).toBeUndefined()
  })
})

describe('页面脚本', () => {
  it('AGENT_HELPER_SCRIPT 是幂等 IIFE 且安装三个函数', () => {
    expect(AGENT_HELPER_SCRIPT.startsWith('(() =>')).toBe(true)
    expect(AGENT_HELPER_SCRIPT).toContain('__dfUiDescribe')
    expect(AGENT_HELPER_SCRIPT).toContain('__dfUiChallenge')
    expect(AGENT_HELPER_SCRIPT).toContain('__dfUiInspect')
    expect(AGENT_HELPER_SCRIPT).toContain('__dfUiAgentVersion')
  })
})
