/**
 * 录制器：把用户在可见 Chrome 里的点击/输入变成可回放的 ui-script 步骤。
 *
 * 分层（与采集同款职责边界）：
 *   - 页面内脚本（RECORDER_SCRIPT）只做「事件 → 原始载荷」：拿 DOM 事件、生成 selector 候选、读值；
 *   - Node 侧（本模块类）做「原始载荷 → 步骤」：去重（click/submit、连续输入）、脱敏（密码）、
 *     selector 唯一性校验、id 分配、上限裁剪；
 *   - 落盘归 store，回放归 run——录制器不写盘、不发请求。
 *
 * 为什么密码输入不录：
 *   脚本是进 git 的项目资产。`input[type=password]` 的值一旦写进 YAML 就是明文泄漏，
 *   而回了登录态本来就应该走 cookie（录制结束把会话 cookie 持久化，回放带 cookie）。
 *   所以密码输入**直接跳过**，由停止回执如实报告跳过了几个。
 *
 * 为什么上传不录：
 *   浏览器安全模型不暴露用户选中的本地文件路径（只能拿到文件名），录出来的路径在回放
 *   机器上大概率不存在。上传步骤请在脚本里手写（路径可参数化），录制器只如实报告跳过。
 *
 * @module dsh-dataforge/uitest/recorder
 */
import type { BrowserContext, Page } from 'playwright-core'
import type { UiStep } from './schema.js'
import { SELECTOR_HELPER_SCRIPT } from './selector-script.js'
import { RecorderCore } from './recorder-core.js'

/** 页面内记录器版本：升级脚本内容时必须 bump，否则复用页面/宿主重启后仍会挂着旧逻辑。 */
const RECORDER_VERSION = 4

/** 页面内记录器：只认 DOM 事件，不碰网络、不碰存储；选择器候选交给共享 helper。 */
const RECORDER_SCRIPT = `(() => {
  var VERSION = ${JSON.stringify(RECORDER_VERSION)}
  var existing = window.__dfUiRecorder
  // 同版本：只重新激活；旧版本：先停掉旧监听器（它们都检查 state.active），再装新脚本。
  if (existing !== undefined && existing.version === VERSION) { existing.active = true; return }
  if (existing !== undefined) { try { existing.active = false } catch (err) {} }
  var state = { active: true, version: VERSION }
  window.__dfUiRecorder = state

  function pageUrl() {
    try { return location.href.slice(0, 2000) } catch (err) { return '' }
  }
  var candidatesFor = window.__dfUiSelectorCandidates || function () { return [] }

  function nameOf(el) {
    var aria = el.getAttribute('aria-label')
    if (aria && aria.trim()) return aria.trim().slice(0, 80)
    var text = ((el.innerText || el.textContent || '') + '').replace(/\s+/g, ' ').trim()
    if (text) return text.slice(0, 80)
    var value = el.getAttribute('value')
    if (value && /^(INPUT|BUTTON)$/.test(el.tagName)) return value.trim().slice(0, 80)
    var title = el.getAttribute('title')
    if (title && title.trim()) return title.trim().slice(0, 80)
    var placeholder = el.getAttribute('placeholder')
    if (placeholder && placeholder.trim()) return placeholder.trim().slice(0, 80)
    var alt = el.getAttribute('alt')
    if (alt && alt.trim()) return alt.trim().slice(0, 80)
    var nameAttr = el.getAttribute('name')
    if (nameAttr && nameAttr.trim()) return nameAttr.trim().slice(0, 80)
    return ''
  }

  function featuresFor(el) {
    var f = { tag: String(el.tagName || '').toLowerCase() }
    if (!f.tag) return f
    var attrs = ['data-testid', 'data-test-id', 'data-test', 'data-qa']
    for (var i = 0; i < attrs.length; i += 1) {
      var testId = el.getAttribute(attrs[i])
      if (testId) { f.testId = testId; break }
    }
    if (el.id) f.id = el.id
    if (el.getAttribute('name')) f.name = el.getAttribute('name')
    var aria = el.getAttribute('aria-label')
    if (aria) f.ariaLabel = aria
    var placeholder = el.getAttribute('placeholder')
    if (placeholder) f.placeholder = placeholder
    var role = el.getAttribute('role')
    if (role) f.role = role
    var type = el.getAttribute('type')
    if (type) f.type = type
    var title = el.getAttribute('title')
    if (title) f.title = title
    var alt = el.getAttribute('alt')
    if (alt) f.alt = alt
    if (f.tag === 'a' && el.getAttribute('href')) f.href = el.getAttribute('href')
    if (f.tag === 'canvas') {
      try {
        var canvases = document.querySelectorAll('canvas')
        var index = Array.prototype.indexOf.call(canvases, el)
        if (index >= 0) f.canvasIndex = index
      } catch (err) {}
    }
    if (/^(BUTTON|A|LABEL|SUMMARY)$/.test(el.tagName) || role) {
      var text = ((el.innerText || el.textContent || '') + '').replace(/\s+/g, ' ').trim().slice(0, 80)
      if (text) f.text = text
    }
    try {
      var label = el.labels && el.labels[0]
      if (!label && el.closest) label = el.closest('label')
      if (label) {
        var labelText = ((label.innerText || label.textContent || '') + '').replace(/\s+/g, ' ').trim().slice(0, 80)
        if (labelText) f.label = labelText
      }
    } catch (err) {}
    return f
  }

  function interactive(el) {
    if (!el || el.nodeType !== 1) return null
    return el.closest('a,button,input,textarea,select,label,[role="button"],[role="link"],[role="tab"],[role="checkbox"],[role="menuitem"]') || el
  }
  function isTextInput(el) {
    if (!el || el.tagName !== 'INPUT') return false
    var type = (el.type || 'text').toLowerCase()
    return ['text', 'search', 'email', 'password', 'tel', 'url', 'number', 'date',
      'datetime-local', 'month', 'week', 'time', 'color', 'range'].indexOf(type) >= 0
  }
  function isPassword(el) {
    return !!el && el.tagName === 'INPUT' && (el.type || '').toLowerCase() === 'password'
  }
  function isSubmitControl(el) {
    if (!el || el.nodeType !== 1) return false
    if (el.tagName === 'INPUT' && (el.type || '').toLowerCase() === 'submit') return true
    if (el.tagName === 'BUTTON') {
      var type = (el.getAttribute('type') || 'submit').toLowerCase()
      return type === 'submit' && el.closest('form') !== null
    }
    return false
  }
  function send(payload) {
    try {
      if (window.__dfUiRecordStep) { window.__dfUiRecordStep(payload); return }
      // seam 载体（共享浏览器）：没有 binding，事件进页面队列，由宿主轮询 drain。
      if (!window.__dfUiSeamQueue) window.__dfUiSeamQueue = []
      window.__dfUiSeamQueue.push(payload)
      if (window.__dfUiSeamQueue.length > 500) window.__dfUiSeamQueue.splice(0, window.__dfUiSeamQueue.length - 500)
    } catch (err) {}
  }

  document.addEventListener('click', function (event) {
    if (!state.active) return
    var el = interactive(event.target)
    if (!el) return
    if (isPassword(el)) { send({ kind: 'skip-secret', at: pageUrl() }); return }
    if (isTextInput(el)) return
    // canvas 图表只能按坐标命中：把真实点击位置（元素内比例 + 视口坐标）一并录下来。
    var rect = null
    try { rect = el.getBoundingClientRect() } catch (err) { rect = null }
    var clickPoint = rect && rect.width > 0 && rect.height > 0 ? {
      x: event.clientX,
      y: event.clientY,
      fx: (event.clientX - rect.left) / rect.width,
      fy: (event.clientY - rect.top) / rect.height,
      vw: window.innerWidth,
      vh: window.innerHeight,
      tag: el.tagName,
      bx: rect.left,
      by: rect.top,
      bw: rect.width,
      bh: rect.height,
      ...(nameOf(el) ? { name: nameOf(el) } : {})
    } : undefined
    send({
      kind: 'click',
      tag: el.tagName,
      candidates: candidatesFor(el),
      features: featuresFor(el),
      isSubmitter: isSubmitControl(el),
      ...(clickPoint ? { clickPoint: clickPoint } : {}),
      at: pageUrl()
    })
  }, true)

  document.addEventListener('input', function (event) {
    if (!state.active) return
    var el = event.target
    if (!el || !/^(INPUT|TEXTAREA)$/.test(el.tagName)) return
    if (isPassword(el)) { send({ kind: 'skip-secret', at: pageUrl() }); return }
    if (el.tagName === 'INPUT' && isTextInput(el) === false) return
    // 不做去抖：去抖会让「输入 → 立刻点击」在事件流里倒序（点击先到、输入后到），
    // 回放时就会先点空表单再填值。连续输入由 Node 侧合并成最后一次值（同元素相邻 fill）。
    send({ kind: 'fill', tag: el.tagName, candidates: candidatesFor(el), features: featuresFor(el), value: el.value, at: pageUrl() })
  }, true)

  document.addEventListener('change', function (event) {
    if (!state.active) return
    var el = event.target
    if (!el || el.tagName !== 'SELECT') return
    send({ kind: 'select', tag: el.tagName, candidates: candidatesFor(el), features: featuresFor(el), value: el.value, at: pageUrl() })
  }, true)

  document.addEventListener('submit', function (event) {
    if (!state.active) return
    var form = event.target
    if (!form || form.tagName !== 'FORM') return
    var submitter = event.submitter
    send({
      kind: 'submit',
      tag: 'FORM',
      candidates: candidatesFor(form),
      features: featuresFor(form),
      submitter: submitter ? candidatesFor(submitter) : [],
      at: pageUrl()
    })
  }, true)

  document.addEventListener('keydown', function (event) {
    if (!state.active) return
    var target = event.target
    var key = event.key
    if (key !== 'Escape' && key !== 'Tab' && key !== 'Enter') return
    if (key === 'Enter') {
      if (target && (isTextInput(target) || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return
      if (isSubmitControl(target)) return
    }
    send({ kind: 'press', key: key, candidates: target ? candidatesFor(target) : [], ...(target ? { features: featuresFor(target) } : {}), at: pageUrl() })
  }, true)
})()`

/** 页面回传的原始载荷（字段全部弱类型，Node 侧再收口）。 */
type RawPayload = {
  kind?: unknown
  tag?: unknown
  candidates?: unknown
  value?: unknown
  key?: unknown
  isSubmitter?: unknown
  submitter?: unknown
  at?: unknown
}

/** 录制结果：可直接喂给 UiScriptDoc 的 steps。 */
export type UiRecordingResult = {
  /** 录制开始时的页面地址（= 回放起点）。 */
  startUrl: string
  /** 录制时的视口尺寸（回放沿用，布局敏感断言才稳定）。 */
  viewport: { width: number; height: number }
  steps: UiStep[]
  /** 被跳过的密码输入次数（凭证不入脚本）。 */
  skippedSecrets: number
  /** 被跳过的上传次数（浏览器不给本地路径）。 */
  skippedUploads: number
  /** 停止时对 selector 候选做唯一性校验的汇总：只有一条候选命中的步骤数 / 总步骤数。 */
  singleCandidateSteps: number
  totalSteps: number
  /** 对外说的边界（进回执，不藏）。 */
  notice?: string
}

/** 录制器实例：一个页面同时只允许一个。 */
export class UiRecorder {
  private readonly page: Page
  private readonly context: BrowserContext
  private readonly startUrl: string
  private readonly viewport: { width: number; height: number }
  private readonly core = new RecorderCore()
  private stopped = false

  private constructor(
    page: Page,
    context: BrowserContext,
    startUrl: string,
    viewport: { width: number; height: number },
  ) {
    this.page = page
    this.context = context
    this.startUrl = startUrl
    this.viewport = viewport
  }

  /** 开始录制：注入页面脚本 + 绑定事件回传 + 监听文件选择（只计数，不录路径）。 */
  static async start(page: Page, context?: BrowserContext): Promise<UiRecorder> {
    const state = PAGE_STATE.get(page)
    if (state?.current !== undefined) return state.current
    const ctx = context ?? page.context()
    let viewport = { width: 1280, height: 720 }
    try {
      const size = page.viewportSize()
      if (size !== null && size.width > 0 && size.height > 0) viewport = { width: size.width, height: size.height }
    } catch {
      // 拿不到就按缺省，不影响录制
    }
    const recorder = new UiRecorder(page, ctx, safePageUrl(page), viewport)
    await recorder.install()
    // install 可能新建了状态对象（首装）：从 map 里取回来再挂 current，别用 start 开头的快照覆盖它
    // （否则 installed 被重置成 false，第二次 start 会重复 exposeBinding 直接报错）。
    const installedState = PAGE_STATE.get(page)
    if (installedState !== undefined) installedState.current = recorder
    return recorder
  }

  private async install(): Promise<void> {
    let state = PAGE_STATE.get(this.page)
    if (state === undefined) {
      state = { installed: false }
      PAGE_STATE.set(this.page, state)
    }
    if (!state.installed) {
      state.installed = true
      await this.page.exposeBinding('__dfUiRecordStep', (_source, payload: unknown) => {
        PAGE_STATE.get(this.page)?.current?.ingest(payload)
      })
    }
    // 当前文档立即生效；未来导航由 initScript 重新注入（SPA 同文档导航靠事件监听已覆盖）。
    // 两个脚本分开发：page.evaluate(string) 按**表达式**求值，拼两个 IIFE 会变成语法错误。
    await this.page.evaluate(SELECTOR_HELPER_SCRIPT).catch(() => undefined)
    await this.page.evaluate(RECORDER_SCRIPT).catch(() => undefined)
    await this.context.addInitScript(SELECTOR_HELPER_SCRIPT).catch(() => undefined)
    await this.context.addInitScript(RECORDER_SCRIPT).catch(() => undefined)
    this.page.on('filechooser', () => {
      this.core.recordUploadSkip()
    })
  }

/** 原始载荷 → 核心（去重/脱敏都在 RecorderCore）。 */
  private ingest(payload: unknown): void {
    if (this.stopped) return
    this.core.ingest(payload)
  }

  /** 停止录制：等一拍 → 停用页面监听 → 候选校验 → 生成步骤。 */
  async stop(): Promise<UiRecordingResult> {
    if (this.stopped) {
      return this.core.result([], { startUrl: this.startUrl, viewport: this.viewport })
    }
    // 只等一拍事件循环：input 事件是同步送达的，不再有去抖窗口待落地。
    await sleep(50)
    this.stopped = true
    if (PAGE_STATE.get(this.page)?.current === this) PAGE_STATE.get(this.page)!.current = undefined
    await this.page.evaluate(`(() => { if (window.__dfUiRecorder) window.__dfUiRecorder.active = false })()`)
      .catch(() => undefined)
    const steps = await this.core.finalize((candidates) => this.checkCandidates(candidates))
    return this.core.result(steps, { startUrl: this.startUrl, viewport: this.viewport })
  }

  /** 取消录制：不生成步骤（用于异常路径）。 */
  async cancel(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    if (PAGE_STATE.get(this.page)?.current === this) PAGE_STATE.get(this.page)!.current = undefined
    await this.page.evaluate(`(() => { if (window.__dfUiRecorder) window.__dfUiRecorder.active = false })()`)
      .catch(() => undefined)
  }

  /** 候选唯一性校验：只留当前页面唯一命中的候选；页面已销毁/选择器非法就保留原样。 */
  private async checkCandidates(candidates: string[]): Promise<string[]> {
    if (candidates.length === 0) return []
    const kept: string[] = []
    for (const candidate of candidates) {
      try {
        const count = await this.page.locator(candidate).count()
        if (count === 1) kept.push(candidate)
      } catch {
        return candidates
      }
    }
    return kept.length > 0 ? kept : candidates
  }
}

/** 页面 → 录制器状态（同一页面重复 start 返回同一个实例；binding 只注册一次）。 */
const PAGE_STATE = new WeakMap<Page, { current?: UiRecorder; installed: boolean }>()

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function safePageUrl(page: Page): string {
  try {
    return page.url()
  } catch {
    return ''
  }
}

/** 停止后从活跃表移除（测试/异常路径用；正常由 stop 做）。 */
export function forgetRecorder(page: Page): void {
  const state = PAGE_STATE.get(page)
  if (state !== undefined) state.current = undefined
}

/** 页面脚本原文（测试编译校验用；业务不要直接 eval）。 */
export const RECORDER_SOURCE = RECORDER_SCRIPT
