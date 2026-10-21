/**
 * AI 代办录制（agent-driven recording）：AI 自主操作页面，动作同步录成 UI 步骤。
 *
 * 与「人录」（recorder/sessions）的关系：同一批资产（ui-script），同一种步骤语义，
 * 但动作的触发方从「页面 DOM 事件」换成「AI 通过工具下发的意图」：
 *   - 人录：DOM 事件 → RecorderCore 去重 → 步骤；
 *   - 代办：AI 给一个动作（click/fill/scroll/…）→ 本模块定位元素 → 执行 →
 *     用与人录同一套口径收集候选/特征/落点 → 步骤。
 * 两套产物互相可回放：步骤都进同一个 ui-script schema。
 *
 * 纪律（与录制器一致，不另造）：
 *   - 密码字段：实际值永远只进浏览器 context，步骤里记 `{{password}}` 槽位（回放时人填）；
 *   - valueFrom：从服务端配置注入的密钥取值，模型上下文只见键名不见值；
 *   - 每个 act 后探测人机验证（验证码/滑块）：检测到就回报 challenge，AI 应暂停叫人，
 *     浏览器窗口保持可见，人过完验证码 AI 继续（混合登录）；
 *   - 全量留痕 dataRoot/ui-agent-runs/<runId>/（run.json + events.ndjson），
 *     事件里只有选择器/步骤形状，没有值。
 *
 * 引擎边界：代办录制需要直接持有 Playwright Page（执行 + 元素描述），
 * 因此只支持 playwright 引擎；配置指向 shared 时由应用层明确报错并给出切换指引。
 *
 * @module dsh-dataforge/uitest/agentrec
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Browser, BrowserContext, Page } from 'playwright-core'
import type { UiBrowserFactory, UiCookie } from './run.js'
import { openUiBrowser } from './run.js'
import { SELECTOR_HELPER_SCRIPT } from './selector-script.js'
import { normalizeFeatures, type UiTargetFeatures } from './features.js'
import type { UiClickPoint, UiStep } from './schema.js'

/* ────────────────────────────────────────────────
 * 页面内脚本：元素描述 / 人机验证探测 / 页面观察
 * ──────────────────────────────────────────────── */

const HELPER_VERSION = 1

/**
 * 代办执行面注入的页面脚本：在 __dfUiSelectorCandidates 之上补三个函数。
 * 幂等（版本守卫），重复注入不重复定义。
 */
export const AGENT_HELPER_SCRIPT = `(() => {
  var VERSION = ${HELPER_VERSION}
  if (window.__dfUiAgentVersion === VERSION) return
  window.__dfUiAgentVersion = VERSION

  function cleanText(value) {
    return String(value == null ? '' : value).replace(/\\s+/g, ' ').trim()
  }
  function pickTestId(el) {
    var attrs = ['data-testid', 'data-test-id', 'data-test', 'data-qa']
    for (var i = 0; i < attrs.length; i += 1) {
      var value = el.getAttribute(attrs[i])
      if (value) return value
    }
    return ''
  }
  function labelTextOf(el) {
    try {
      if (el.labels && el.labels.length > 0) return cleanText(el.labels[0].textContent).slice(0, 80)
    } catch (err) {}
    return ''
  }
  function describeElement(el) {
    var rect = el.getBoundingClientRect()
    var features = { tag: el.tagName.toLowerCase() }
    var id = pickTestId(el); if (id) features.testId = id
    if (el.id) features.id = el.id
    if (el.name) features.name = String(el.name)
    var aria = el.getAttribute('aria-label'); if (aria) features.ariaLabel = aria
    var placeholder = el.getAttribute('placeholder'); if (placeholder) features.placeholder = placeholder
    var role = el.getAttribute('role'); if (role) features.role = role
    if (el.type) features.type = String(el.type)
    var title = el.getAttribute('title'); if (title) features.title = title
    var alt = el.getAttribute('alt'); if (alt) features.alt = alt
    var href = el.getAttribute('href'); if (href) features.href = href
    var label = labelTextOf(el); if (label) features.label = label
    var text = cleanText(el.innerText || el.textContent).slice(0, 80)
    if (text) features.text = text
    return {
      found: true,
      tag: el.tagName,
      isPassword: el.tagName === 'INPUT' && String(el.type).toLowerCase() === 'password',
      text: text.slice(0, 60),
      candidates: (window.__dfUiSelectorCandidates ? window.__dfUiSelectorCandidates(el) : []) || [],
      features: features,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      vw: window.innerWidth,
      vh: window.innerHeight
    }
  }
  /** 按 CSS 选择器描述第一个命中元素（AI 多数时候给的就是 CSS）。 */
  window.__dfUiDescribe = function (selector) {
    var el = null
    try { el = document.querySelector(selector) } catch (err) { return { found: false, error: String(err && err.message ? err.message : err) } }
    if (!el) return { found: false }
    return describeElement(el)
  }
  /** 人机验证探测：验证码 iframe / 滑块 / 验证码输入框 / 验证文案。 */
  window.__dfUiChallenge = function () {
    var markers = []
    var push = function (marker) { if (markers.indexOf(marker) < 0) markers.push(marker) }
    try {
      if (document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], iframe[src*="captcha"]')) push('captcha-iframe')
      if (document.querySelector('#captcha, .geetest_panel, [id*="geetest"], [class*="geetest"], [class*="verify-slider"], [id*="slideVerify"]')) push('captcha-element')
      if (document.querySelector('input[name*="captcha"], input[id*="captcha"], input[placeholder*="验证码"], input[placeholder*="验证"]')) push('captcha-input')
      if (window.grecaptcha || window.hcaptcha || window.turnstile) push('captcha-global')
      var bodyText = document.body ? cleanText(document.body.innerText || document.body.textContent).slice(0, 2000) : ''
      if (/安全验证|请完成验证|拖动滑块|滑块验证|人机验证|输入验证码|向右滑动|verification code|verify you are human/i.test(bodyText)) push('captcha-text')
    } catch (err) {}
    return { detected: markers.length > 0, markers: markers }
  }
  /** 页面观察：URL/标题 + 可交互元素清单（AI 自主规划的眼睛；不产生步骤）。 */
  window.__dfUiInspect = function () {
    var nodes = document.querySelectorAll('a,button,input,textarea,select,label,[role="button"],[role="link"],[role="tab"],[role="checkbox"],[role="menuitem"],h1,h2,[data-testid]')
    var elements = []
    for (var i = 0; i < nodes.length && elements.length < 60; i += 1) {
      var el = nodes[i]
      var text = cleanText(el.innerText || el.textContent).slice(0, 60)
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
        text = cleanText(el.getAttribute('placeholder') || el.name || el.id || el.tagName).slice(0, 60)
      }
      var candidates = []
      try { candidates = (window.__dfUiSelectorCandidates ? window.__dfUiSelectorCandidates(el) : []) || [] } catch (err) {}
      elements.push({ index: i, tag: el.tagName.toLowerCase(), text: text, candidates: candidates.slice(0, 3) })
    }
    var challenge = window.__dfUiChallenge()
    return { url: location.href, title: document.title, elements: elements, challenge: challenge }
  }
})()`

/** 元素描述（__dfUiDescribe 的回传形状，Node 侧收口）。 */
export type AgentElementDesc = {
  found: boolean
  error?: string
  tag?: string
  isPassword?: boolean
  text?: string
  candidates?: string[]
  features?: unknown
  rect?: { x: number; y: number; width: number; height: number }
  vw?: number
  vh?: number
}

/** 人机验证探测结果。 */
export type AgentChallenge = { detected: boolean; markers: string[] }

/** 页面观察结果（inspect）。 */
export type AgentInspect = {
  url: string
  title: string
  elements: Array<{ index: number; tag: string; text: string; candidates: string[] }>
  challenge: AgentChallenge
}

/* ────────────────────────────────────────────────
 * 动作词表
 * ──────────────────────────────────────────────── */

/** AI 下发的动作。inspect 只观察不录步；其余动作执行成功都会录一步。 */
export type AgentActSpec =
  | { kind: 'inspect' }
  | { kind: 'goto'; url: string }
  | { kind: 'click'; selector: string }
  | { kind: 'fill'; selector: string; value?: string; valueFrom?: string }
  | { kind: 'select'; selector: string; value: string }
  | { kind: 'press'; key: string; selector?: string }
  | { kind: 'scroll'; selector?: string; deltaY?: number }
  | { kind: 'wait'; ms: number }

/** 单动作回执。 */
export type AgentActResult = {
  ok: boolean
  error?: string
  /** 动作后的页面地址（导航失败时可能缺省）。 */
  pageUrl?: string
  /** 动作后探测到的人机验证（detected=true 时 AI 应暂停叫人）。 */
  challenge?: AgentChallenge
  /** 录到的步骤（inspect 不产生步骤）。 */
  step?: UiStep
  /** 缓冲中已有步骤数（AI 感知进度）。 */
  stepsSoFar?: number
  /** inspect 的观察结果。 */
  inspect?: AgentInspect
  /** fill 命中密码字段：实际值已脱敏为 {{password}} 槽位。 */
  valueMasked?: boolean
}

/* ────────────────────────────────────────────────
 * 纯步骤构建（页面/浏览器无关，单测直测）
 * ──────────────────────────────────────────────── */

/** 从元素描述收口的特征（非法字段丢弃，与人录 normalizeFeatures 同一入口）。 */
export function featuresOfDesc(desc: AgentElementDesc): UiTargetFeatures | undefined {
  return normalizeFeatures(desc.features)
}

/** click 的落点：元素中心按视口坐标 + 元素内比例（canvas/结构漂移兜底，与人录同口径）。 */
export function clickPointOfDesc(desc: AgentElementDesc): UiClickPoint | undefined {
  const rect = desc.rect
  const vw = desc.vw
  const vh = desc.vh
  if (rect === undefined || vw === undefined || vh === undefined || vw <= 0 || vh <= 0) return undefined
  if (rect.width <= 0 || rect.height <= 0) return undefined
  const x = rect.x + rect.width / 2
  const y = rect.y + rect.height / 2
  return {
    fx: 0.5, fy: 0.5, x, y, vw, vh,
    ...(desc.tag === undefined ? {} : { tag: desc.tag }),
    bx: rect.x, by: rect.y, bw: rect.width, bh: rect.height,
    ...(desc.text === undefined || desc.text === '' ? {} : { name: desc.text.slice(0, 120) }),
  }
}

export const AGENT_PASSWORD_SLOT = 'password'

/**
 * 动作 + 元素描述 → UI 步骤（执行成功后调用）。
 *
 * 密钥纪律在这里收口：
 *   - valueFrom 的字段：步骤值记 `{{slot}}`（slot = 键名消毒后的槽位名），实际值不进步骤；
 *   - 密码字段：必须走 valueFrom（明文值根本不进密码框），步骤值同样只写槽位。
 */
export function buildAgentStep(
  seq: number,
  spec: AgentActSpec,
  desc: AgentElementDesc | undefined,
  pageUrl: string,
  slot?: string,
): UiStep {
  const id = `s${seq}`
  const at = pageUrl === '' ? undefined : pageUrl.slice(0, 2_000)
  const target = (): { selector?: string; candidates?: string[] } => {
    const candidates = (desc?.candidates ?? []).filter((item) => typeof item === 'string' && item !== '')
    if (candidates.length === 0) return {}
    return { selector: candidates[0], candidates }
  }
  const features = normalizeFeatures(desc?.features)
  const withCommon = (step: UiStep): UiStep => ({
    ...step,
    ...(features === undefined ? {} : { features }),
    ...(at === undefined ? {} : { at }),
  })

  switch (spec.kind) {
    case 'goto':
      return { id, kind: 'goto', url: spec.url }
    case 'wait':
      return { id, kind: 'wait', ms: spec.ms }
    case 'scroll': {
      if (spec.selector === undefined || spec.selector === '') {
        return { id, kind: 'scroll', deltaY: spec.deltaY ?? 0 }
      }
      const t = target()
      return withCommon({ id, kind: 'scroll', ...t })
    }
    case 'click':
      return withCommon({
        id, kind: 'click', ...target(),
        ...(desc === undefined ? {} : { clickPoint: clickPointOfDesc(desc) }),
      })
    case 'fill': {
      const masked = desc?.isPassword === true || spec.valueFrom !== undefined
      const slotName = slot ?? (spec.valueFrom !== undefined ? slotNameOf(spec.valueFrom) : AGENT_PASSWORD_SLOT)
      return withCommon({
        id, kind: 'fill', ...target(),
        value: masked ? `{{${slotName}}}` : (spec.value ?? ''),
      })
    }
    case 'select':
      return withCommon({ id, kind: 'select', ...target(), value: spec.value })
    case 'press': {
      if (spec.selector === undefined || spec.selector === '') return { id, kind: 'press', key: spec.key }
      return withCommon({ id, kind: 'press', ...target(), key: spec.key })
    }
    case 'inspect':
      // inspect 只观察不录步；走到这里说明调用方用错了，显式抛出而不是静默吞掉。
      throw new Error('inspect 动作不产生步骤')
  }
}

/* ────────────────────────────────────────────────
 * 会话：一个可见 Chrome = AI 的操作面 + 步骤缓冲 + 留痕
 * ──────────────────────────────────────────────── */

export type AgentSessionOpenArgs = {
  startUrl: string
  task: string
  headless?: boolean
  viewport?: { width: number; height: number }
  cookies?: UiCookie[]
  navigationTimeoutMs?: number
}

export type AgentSessionView = {
  sessionId: string
  runId: string
  pageUrl: string
  task: string
  steps: number
  startedAt: number
}

type AgentSessionRecord = {
  sessionId: string
  runId: string
  task: string
  startUrl: string
  viewport: { width: number; height: number }
  browser: Browser
  context: BrowserContext
  page: Page
  steps: UiStep[]
  /** 以 {{slot}} 形式录进脚本的密钥槽位（valueFrom 键名 / 密码兜底 password）。 */
  secretSlots: Set<string>
  startedAt: number
  traceDir?: string
}

const NO_CHALLENGE: AgentChallenge = { detected: false, markers: [] }

function messageOf(error: unknown): string {
  return String((error as Error)?.message ?? error).slice(0, 800)
}

/** 代办录制会话 registry：进程内；脚本才是资产，会话只活在执行期。 */
export class AgentRecordingSessions {
  private readonly sessions = new Map<string, AgentSessionRecord>()
  private readonly openBrowser: UiBrowserFactory
  private readonly dataRoot?: string
  private readonly now: () => number

  constructor(io: { openBrowser?: UiBrowserFactory; dataRoot?: string; now?: () => number } = {}) {
    this.openBrowser = io.openBrowser ?? openUiBrowser
    this.dataRoot = io.dataRoot
    this.now = io.now ?? Date.now
  }

  async open(args: AgentSessionOpenArgs): Promise<{ ok: boolean; sessionId?: string; runId?: string; pageUrl?: string; error?: string }> {
    const sessionId = `uia_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const runId = `uiar_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    try {
      const viewport = args.viewport ?? { width: 1280, height: 720 }
      // channel 由构造时的 openBrowser 工厂绑定（生产 = 系统 Chrome；测试 = 假工厂）。
      const opened = await this.openBrowser({ headless: args.headless ?? false, viewport, channel: '' })
      const record: AgentSessionRecord = {
        sessionId, runId,
        task: args.task.slice(0, 4_000),
        startUrl: args.startUrl,
        viewport,
        browser: opened.browser, context: opened.context, page: opened.page,
        steps: [], secretSlots: new Set(), startedAt: this.now(),
      }
      this.sessions.set(sessionId, record)
      // 选择器候选 + 元素描述/验证探测/页面观察：会话一打开就注入，导航后仍可用（init script）。
      // 两个脚本必须**分开**注册：都是 `(() => …)()` IIFE，字符串拼接会让 JS 把第二段
      // 当成对第一段返回值的调用（行首 `(` 触发），整段 init script 静默失败。
      await opened.page.evaluate(SELECTOR_HELPER_SCRIPT).catch(() => undefined)
      await opened.page.evaluate(AGENT_HELPER_SCRIPT).catch(() => undefined)
      await opened.context.addInitScript(SELECTOR_HELPER_SCRIPT).catch(() => undefined)
      await opened.context.addInitScript(AGENT_HELPER_SCRIPT).catch(() => undefined)
      if (args.cookies !== undefined && args.cookies.length > 0) {
        await opened.context.addCookies(args.cookies.map(toPlaywrightCookie)).catch(() => undefined)
      }
      this.initTrace(record)
      const timeout = args.navigationTimeoutMs ?? 20_000
      await opened.page.goto(args.startUrl, { waitUntil: 'domcontentloaded', timeout }).catch(() => undefined)
      this.appendTrace(record, { at: this.now(), event: 'open', startUrl: args.startUrl })
      return { ok: true, sessionId, runId, pageUrl: safeUrl(opened.page) }
    } catch (error) {
      this.sessions.delete(sessionId)
      return { ok: false, error: messageOf(error) }
    }
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  pageUrlOf(sessionId: string): string | undefined {
    const record = this.sessions.get(sessionId)
    return record === undefined ? undefined : safeUrl(record.page)
  }

  taskOf(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.task
  }

  stepsOf(sessionId: string): UiStep[] | undefined {
    const record = this.sessions.get(sessionId)
    return record === undefined ? undefined : [...record.steps]
  }

  /** 已用到的密钥槽位（落盘 inputs 用；顺序稳定，先 password 兜底键后按插入序）。 */
  secretSlotsOf(sessionId: string): string[] {
    const record = this.sessions.get(sessionId)
    if (record === undefined) return []
    return [...record.secretSlots]
  }

  runIdOf(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.runId
  }

  /** 会话打开时的起点 URL（脚本 meta.startUrl 用当前页会带上登录跳转变迁）。 */
  startUrlOf(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.startUrl
  }

  viewportOf(sessionId: string): { width: number; height: number } | undefined {
    return this.sessions.get(sessionId)?.viewport
  }

  list(): AgentSessionView[] {
    return [...this.sessions.values()].map((record) => ({
      sessionId: record.sessionId,
      runId: record.runId,
      pageUrl: safeUrl(record.page),
      task: record.task,
      steps: record.steps.length,
      startedAt: record.startedAt,
    }))
  }

  /** 执行一个动作并同步录步；任何一步失败都不进步骤缓冲（执行与录制不脱节）。 */
  async act(sessionId: string, spec: AgentActSpec, secrets: Record<string, string> = {}): Promise<AgentActResult> {
    const record = this.sessions.get(sessionId)
    if (record === undefined) return { ok: false, error: `会话 ${sessionId} 不存在（可能已关闭）` }
    const page = record.page
    const validateError = validateAct(spec)
    if (validateError !== undefined) return { ok: false, error: validateError, pageUrl: safeUrl(page) }

    try {
      if (spec.kind === 'inspect') {
        const inspect = await page.evaluate(`(window.__dfUiInspect ? window.__dfUiInspect() : null)`) as AgentInspect | null
        if (inspect === null) return { ok: false, error: '页面脚本未注入（请刷新会话页面或重开会话）', pageUrl: safeUrl(page) }
        this.appendTrace(record, { at: this.now(), event: 'act', kind: 'inspect', url: inspect.url })
        return { ok: true, pageUrl: inspect.url, inspect }
      }

      if (spec.kind === 'goto') {
        await page.goto(spec.url, { waitUntil: 'domcontentloaded', timeout: 20_000 })
        const step = buildAgentStep(record.steps.length + 1, spec, undefined, safeUrl(page))
        record.steps.push(step)
        this.appendTrace(record, { at: this.now(), event: 'act', kind: 'goto', url: spec.url, step: step.id })
        return this.finishAct(record, step)
      }

      if (spec.kind === 'wait') {
        await page.waitForTimeout(Math.min(Math.max(spec.ms, 0), 60_000))
        const step = buildAgentStep(record.steps.length + 1, spec, undefined, safeUrl(page))
        record.steps.push(step)
        this.appendTrace(record, { at: this.now(), event: 'act', kind: 'wait', ms: step.ms })
        return this.finishAct(record, step)
      }

      if (spec.kind === 'scroll' && (spec.selector === undefined || spec.selector === '')) {
        const deltaY = Math.min(Math.max(Math.round(spec.deltaY ?? 0), -10_000), 10_000)
        await page.mouse.wheel(0, deltaY)
        const step = buildAgentStep(record.steps.length + 1, { ...spec, deltaY }, undefined, safeUrl(page))
        record.steps.push(step)
        this.appendTrace(record, { at: this.now(), event: 'act', kind: 'scroll', deltaY })
        return this.finishAct(record, step)
      }

      // 以下动作都要先解析目标元素：CSS 先 describe（拿候选/特征），失败再试 Playwright 选择器。
      const selector = actSelectorOf(spec)
      if (selector === undefined) return { ok: false, error: '动作缺 selector', pageUrl: safeUrl(page) }
      const described = await this.describe(record, selector)
      const locator = await this.resolveLocator(record, selector, described)
      if (locator === undefined) {
        return {
          ok: false,
          error: described?.found === false && described.error !== undefined
            ? `selector 语法错误：${described.error}`
            : `定位不到元素：${selector}（可先 inspect 看页面结构）`,
          pageUrl: safeUrl(page),
        }
      }
      // 元素描述：describe 命中就用它的；否则从 locator 现取（Playwright 专属选择器路径）。
      const desc: AgentElementDesc = described?.found === true ? described : await this.describeLocator(locator)

      // 密钥纪律：valueFrom 的值只在服务端过手进浏览器；密码字段拒绝明文值。
      let value: string | undefined
      let valueMasked = false
      let slot: string | undefined
      if (spec.kind === 'fill') {
        if (spec.valueFrom !== undefined) {
          value = secrets[spec.valueFrom]
          if (value === undefined) {
            return {
              ok: false,
              error: `valueFrom 键 ${spec.valueFrom} 不在服务端密钥表（uiAgentCredentials 可用键：${Object.keys(secrets).join('、') || '（未配置）'}）`,
              pageUrl: safeUrl(page),
            }
          }
          slot = slotNameOf(spec.valueFrom)
          record.secretSlots.add(slot)
          valueMasked = true
        } else if (desc.isPassword === true) {
          return {
            ok: false,
            error: '目标是密码字段：请用 valueFrom 从服务端密钥表取值（明文值不允许进密码框，也不进脚本）',
            pageUrl: safeUrl(page),
          }
        } else {
          value = spec.value ?? ''
        }
      }

      const timeout = 15_000
      switch (spec.kind) {
        case 'click':
          await locator.click({ timeout })
          break
        case 'fill':
          await locator.fill(value ?? '', { timeout })
          break
        case 'select':
          await locator.selectOption(spec.value, { timeout })
          break
        case 'press':
          await locator.press(spec.key, { timeout })
          break
        case 'scroll':
          await locator.scrollIntoViewIfNeeded({ timeout })
          break
        default:
          return { ok: false, error: `未支持的动作：${(spec as { kind: string }).kind}`, pageUrl: safeUrl(page) }
      }

      const step = buildAgentStep(record.steps.length + 1, spec, desc, safeUrl(page), slot)
      record.steps.push(step)
      this.appendTrace(record, {
        at: this.now(), event: 'act', kind: spec.kind,
        selector: step.selector, step: step.id,
        ...(valueMasked ? { valueMasked: true } : {}),
      })
      const finished = await this.finishAct(record, step)
      return { ...finished, ...(valueMasked ? { valueMasked: true } : {}) }
    } catch (error) {
      return { ok: false, error: messageOf(error), pageUrl: safeUrl(page) }
    }
  }

  /** 动作收尾：探测人机验证 + 组装回执（challenge 永远尽力而为，探测失败不遮动作结果）。 */
  private async finishAct(record: AgentSessionRecord, step: UiStep): Promise<AgentActResult> {
    const challenge = await this.detectChallenge(record).catch(() => NO_CHALLENGE)
    return {
      ok: true,
      pageUrl: safeUrl(record.page),
      challenge,
      step,
      stepsSoFar: record.steps.length,
    }
  }

  private async detectChallenge(record: AgentSessionRecord): Promise<AgentChallenge> {
    const result = await record.page.evaluate('(window.__dfUiChallenge ? window.__dfUiChallenge() : null)').catch(() => null)
    if (result === null || typeof result !== 'object') return NO_CHALLENGE
    const value = result as { detected?: unknown; markers?: unknown }
    return {
      detected: value.detected === true,
      markers: Array.isArray(value.markers) ? value.markers.filter((item): item is string => typeof item === 'string') : [],
    }
  }

  /** CSS describe：返回页面脚本描述（未命中返回 found:false，不抛）。 */
  private async describe(record: AgentSessionRecord, selector: string): Promise<AgentElementDesc | undefined> {
    const expr = `(window.__dfUiDescribe ? window.__dfUiDescribe(${JSON.stringify(selector)}) : null)`
    const result = await record.page.evaluate(expr).catch(() => null)
    if (result === null || typeof result !== 'object') return undefined
    return result as AgentElementDesc
  }

  /** Playwright 专属选择器（text= 等）路径：动作由 locator 执行，描述事后从元素上现取。 */
  private async describeLocator(locator: Awaited<ReturnType<Page['locator']>>): Promise<AgentElementDesc> {
    const collected = await locator.evaluate((el: unknown) => {
      const win = globalThis as unknown as {
        __dfUiSelectorCandidates?: (node: unknown) => string[]
      }
      const candidates = typeof win.__dfUiSelectorCandidates === 'function' ? (win.__dfUiSelectorCandidates(el) ?? []) : []
      return { candidates, tag: (el as { tagName?: string })?.tagName ?? '' }
    }).catch(() => ({ candidates: [] as string[], tag: '' }))
    const rect = await locator.boundingBox().catch(() => null)
    return {
      found: true,
      tag: collected.tag,
      candidates: collected.candidates,
      ...(rect === null ? {} : { rect }),
    }
  }

  private async resolveLocator(
    record: AgentSessionRecord,
    selector: string,
    described: AgentElementDesc | undefined,
  ): Promise<Awaited<ReturnType<Page['locator']>> | undefined> {
    const page = record.page
    // 优先用 describe 出来的候选链（语义稳定）；Playwright 专属选择器（text=）只能直接 locator。
    const candidates = described?.found === true ? (described.candidates ?? []) : []
    for (const candidate of candidates.length > 0 ? candidates : [selector]) {
      const locator = page.locator(candidate).first()
      try {
        await locator.waitFor({ state: 'attached', timeout: 2_000 })
        return locator
      } catch {
        // 试下一个候选
      }
    }
    return undefined
  }

  /** 读当前页面元信息（自动命名用；读不到返回空对象，绝不抛）。 */
  async pageMetaOf(sessionId: string): Promise<{ url?: string; title?: string; siteName?: string }> {
    const record = this.sessions.get(sessionId)
    if (record === undefined) return {}
    try {
      const url = safeUrl(record.page)
      const title = await record.page.title().catch(() => '')
      const siteName = await record.page.evaluate(`(() => {
        const contentOf = (selector) => {
          try { const el = document.querySelector(selector); return el && el.getAttribute('content') ? el.getAttribute('content') : '' } catch (err) { return '' }
        }
        return contentOf('meta[property="og:site_name"]') || contentOf('meta[name="application-name"]') || contentOf('meta[name="apple-mobile-web-app-title"]')
      })()`).catch(() => '')
      return {
        url,
        ...(typeof title === 'string' && title !== '' ? { title } : {}),
        ...(typeof siteName === 'string' && siteName !== '' ? { siteName } : {}),
      }
    } catch {
      return {}
    }
  }

  /** 取会话 cookie（落凭证 jar 用；值只交给调用方，不进任何回执）。 */
  async cookiesOf(sessionId: string): Promise<UiCookie[]> {
    const record = this.sessions.get(sessionId)
    if (record === undefined) return []
    const raw = await record.context.cookies().catch(() => [])
    return raw.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure,
      ...(cookie.expires > 0 ? { expires: cookie.expires } : {}),
    }))
  }

  /** 关闭会话并写留痕终态。 */
  async close(sessionId: string): Promise<{ ok: boolean }> {
    const record = this.sessions.get(sessionId)
    if (record === undefined) return { ok: false }
    this.sessions.delete(sessionId)
    this.appendTrace(record, { at: this.now(), event: 'close', steps: record.steps.length })
    this.finishTrace(record)
    await record.browser.close().catch(() => undefined)
    return { ok: true }
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.close(id)))
  }

  /* ── 留痕（dataRoot/ui-agent-runs/<runId>/，事件里没有值） ── */

  private initTrace(record: AgentSessionRecord): void {
    if (this.dataRoot === undefined) return
    const dir = join(this.dataRoot, 'ui-agent-runs', record.runId)
    record.traceDir = dir
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'run.json'), JSON.stringify({
        runId: record.runId,
        sessionId: record.sessionId,
        task: record.task,
        startUrl: record.startUrl,
        viewport: record.viewport,
        startedAt: record.startedAt,
      }, null, 2), 'utf8')
    } catch {
      record.traceDir = undefined
    }
  }

  private appendTrace(record: AgentSessionRecord, event: Record<string, unknown>): void {
    if (record.traceDir === undefined) return
    try {
      appendFileSync(join(record.traceDir, 'events.ndjson'), `${JSON.stringify(event)}\n`, 'utf8')
    } catch {
      // 留痕失败不影响执行
    }
  }

  private finishTrace(record: AgentSessionRecord): void {
    if (record.traceDir === undefined) return
    try {
      writeFileSync(join(record.traceDir, 'run.json'), JSON.stringify({
        runId: record.runId,
        sessionId: record.sessionId,
        task: record.task,
        startUrl: record.startUrl,
        viewport: record.viewport,
        startedAt: record.startedAt,
        finishedAt: this.now(),
        steps: record.steps.length,
        secretsUsed: record.secretSlots.size,
      }, null, 2), 'utf8')
    } catch {
      // 留痕失败不影响关闭
    }
  }
}

/* ────────────────────────────────────────────────
 * 小工具
 * ──────────────────────────────────────────────── */

function validateAct(spec: AgentActSpec): string | undefined {
  switch (spec.kind) {
    case 'inspect':
    case 'wait':
      return undefined
    case 'goto':
      return isHttpUrl(spec.url) ? undefined : `goto 的 url 必须是 http/https：${spec.url}`
    case 'click':
      return spec.selector.trim() === '' ? 'click 缺 selector' : undefined
    case 'fill':
      if (spec.selector.trim() === '') return 'fill 缺 selector'
      if (spec.value === undefined && spec.valueFrom === undefined) return 'fill 需要 value 或 valueFrom'
      return undefined
    case 'select':
      if (spec.selector.trim() === '') return 'select 缺 selector'
      return spec.value.trim() === '' ? 'select 缺 value（选项值或可见文本）' : undefined
    case 'press':
      return spec.key.trim() === '' ? 'press 缺 key（Enter/Tab/…）' : undefined
    case 'scroll':
      if (spec.selector !== undefined && spec.selector.trim() !== '') return undefined
      if (spec.deltaY === undefined || !Number.isFinite(spec.deltaY)) return 'scroll 需要 selector 或 deltaY'
      return undefined
    default:
      return `未支持的动作：${(spec as { kind: string }).kind}`
  }
}

function actSelectorOf(spec: AgentActSpec): string | undefined {
  if ('selector' in spec && typeof spec.selector === 'string') return spec.selector.trim()
  return undefined
}

/** valueFrom 键名 → 合法槽位名（字母/数字/下划线，字母开头；映射稳定，录进脚本/回放同一入口）。 */
export function slotNameOf(key: string): string {
  const cleaned = key.replace(/[^A-Za-z0-9_]/g, '_')
  const withPrefix = /^[A-Za-z_]/.test(cleaned) ? cleaned : `_${cleaned}`
  return withPrefix || AGENT_PASSWORD_SLOT
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function safeUrl(page: Page): string {
  try {
    return page.url()
  } catch {
    return ''
  }
}

function toPlaywrightCookie(cookie: UiCookie): {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  expires?: number
} {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path ?? '/',
    secure: cookie.secure ?? false,
    ...(cookie.expires === undefined ? {} : { expires: cookie.expires }),
  }
}
