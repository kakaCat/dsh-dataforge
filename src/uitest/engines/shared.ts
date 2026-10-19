/**
 * 共享浏览器引擎（`dsh-builtin-browser` seam）的 Playwright 适配实现。
 *
 * 与 Playwright 引擎同契约，差别只在"怎么拿页面"：
 *   - 会话：开的是插件管理的共享浏览器（人机同页，用户可随时接管）；
 *   - 录制：把录制脚本注入页面（`execute`），事件进 `__dfUiSeamQueue`，宿主轮询 drain；
 *   - 回放：用 seam 的高层操作（navigate/click/setValue/key/execute/screenshot）。
 *
 * 边界（诚实标注）：seam 没有文件选择通道，`upload` 步骤在共享引擎上不支持；
 * 需要上传的脚本请切回 Playwright 引擎。登录态由共享浏览器自己的持久 profile 管理，
 * 因此本引擎 `managesCookies: true`，上层不再注入/写回 dataforge 的 cookie jar。
 *
 * @module dsh-dataforge/uitest/engines/playwright
 */
import type { BrowserSeam, SeamExecuteResult } from '../browser-seam.js'
import type { UiBrowserEngine, UiEngineOpenArgs, UiEngineOpenResult, UiEngineRunOptions, UiEngineStartResult, UiEngineStopResult } from '../engines.js'
import type { PickedElement } from '../selector-script.js'
import type { UiRecordingResult } from '../recorder.js'
import type { UiRecordingSessionView } from '../sessions.js'
import type { UiCookie, UiRunResult } from '../run.js'
import type { UiScriptDoc } from '../schema.js'
import type { UiPageMeta } from '../naming.js'
import { PICKER_SCRIPT, SELECTOR_HELPER_SCRIPT } from '../selector-script.js'
import { RECORDER_SOURCE } from '../recorder.js'
import { RecorderCore, normalizeCandidateList } from '../recorder-core.js'
import { runUiScriptOnSeam } from './shared-run.js'

/** 页面里 drain 事件队列 + 返回诊断信息（URL / 是否仍安装）。 */
const DRAIN_EXPRESSION = `(() => {
  const queue = window.__dfUiSeamQueue
  window.__dfUiSeamQueue = []
  return {
    installed: !!window.__dfUiRecorder,
    events: Array.isArray(queue) ? queue : [],
    url: (() => { try { return location.href } catch (err) { return '' } })()
  }
})()`

/** 候选唯一性校验（页面内，纯 CSS；Playwright 专属选择器会整体回退原候选）。 */
const CHECK_CANDIDATES_EXPRESSION = `return (function (candidates) {
  const kept = []
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i]
    try {
      if (document.querySelectorAll(candidate).length === 1) kept.push(candidate)
    } catch (err) {
      return candidates
    }
  }
  return kept.length > 0 ? kept : candidates
})(arguments[0])`

type SharedSession = {
  seam: BrowserSeam
  sessionId: string
  startUrl: string
  viewport: { width: number; height: number }
  startedAt: number
  lastUrl: string
  recording: boolean
  core?: RecorderCore
  timer?: ReturnType<typeof setInterval>
  lastInjectAt: number
  polling: boolean
}

export type SharedEngineIo = {
  /** 惰性取 seam（宿主可能晚于本插件挂载 ctx.browser；未装插件时为 undefined）。 */
  resolveSeam: () => BrowserSeam | undefined
  /**
   * 当前 DSH 对话 id（`session-…`）。
   *
   * 为什么必须传：共享浏览器插件的桌面载体按「对话」把页面挂到该对话自己的右侧栏面板，
   * 传固定标签会让桥接层找不到面板（页面不显示），只有真实会话 id 才能定位。
   * 由宿主用 `ctx.get('agents').list()[0].id` 提供（与插件自身读取方式一致）。
   */
  resolveOwner: () => string | undefined
  dataRoot: string
  stepTimeoutMs: number
  /** 录制事件轮询间隔（缺省 350ms；测试可调小）。 */
  pollIntervalMs?: number
}

/** 共享浏览器引擎：录制/点选走 seam，回放交给 shared-run。 */
export class SharedBrowserEngine implements UiBrowserEngine {
  readonly kind = 'shared' as const
  readonly label = '共享浏览器（dsh-builtin-browser）'
  readonly managesCookies = true
  private readonly sessions = new Map<string, SharedSession>()

  constructor(private readonly io: SharedEngineIo) {}

  available(): boolean {
    return this.io.resolveSeam() !== undefined
  }

  async open(args: UiEngineOpenArgs): Promise<UiEngineOpenResult> {
    const seam = this.io.resolveSeam()
    if (seam === undefined) return { ok: false, error: '共享浏览器不可用（宿主没有注册 ctx.browser：请安装/启用 dsh-builtin-browser）' }
    const owner = args.owner ?? this.io.resolveOwner()
    if (owner === undefined || owner === '') {
      return { ok: false, error: '无法确定当前 DSH 对话 id（ctx.agents 不可用）：共享浏览器需要按对话打开右侧栏面板；请改用 uiTestBrowser=playwright，或重启 DSH 后重试' }
    }
    let sessionId: string
    try {
      // label 不是装饰：共享浏览器把它当作对话 owner，用来定位该对话自己的侧栏面板。
      sessionId = await seam.open(owner)
    } catch (error) {
      return { ok: false, error: messageOf(error) }
    }
    const session: SharedSession = {
      seam,
      sessionId,
      startUrl: args.startUrl,
      viewport: args.viewport ?? { width: 1280, height: 720 },
      startedAt: Date.now(),
      lastUrl: args.startUrl,
      recording: false,
      lastInjectAt: 0,
      polling: false,
    }
    this.sessions.set(sessionId, session)
    try {
      await seam.openUrl(sessionId, { url: args.startUrl })
      await seam.waitFor(sessionId, { loaded: true, timeoutMs: args.navigationTimeoutMs ?? 20_000 }).catch(() => undefined)
      session.lastUrl = await this.activeUrl(seam, sessionId) ?? args.startUrl
    } catch (error) {
      // 打开失败要如实报错并清掉半开会话：以前这里吞错返回 ok，面板"成功"但根本没有页面。
      this.sessions.delete(sessionId)
      await seam.close(sessionId).catch(() => undefined)
      return { ok: false, error: `共享浏览器打开页面失败：${messageOf(error)}` }
    }
    return { ok: true, sessionId, pageUrl: session.lastUrl }
  }

  async start(sessionId: string): Promise<UiEngineStartResult> {
    const session = this.sessions.get(sessionId)
    if (session === undefined) return { ok: false, error: `会话 ${sessionId} 不存在（可能已关闭）` }
    if (session.recording) return { ok: true, pageUrl: session.lastUrl, alreadyRecording: true }
    const injected = await this.injectRecorder(session)
    if (!injected.ok) return { ok: false, error: injected.error }
    session.core = new RecorderCore()
    session.recording = true
    const interval = Math.max(50, this.io.pollIntervalMs ?? 350)
    session.timer = setInterval(() => { void this.poll(session) }, interval)
    return { ok: true, pageUrl: session.lastUrl }
  }

  async stop(sessionId: string): Promise<UiEngineStopResult> {
    const session = this.sessions.get(sessionId)
    if (session === undefined) return { ok: false, error: `会话 ${sessionId} 不存在（可能已关闭）` }
    if (!session.recording) return { ok: false, error: `会话 ${sessionId} 没有在录制` }
    session.recording = false
    if (session.timer !== undefined) clearInterval(session.timer)
    session.timer = undefined
    // 等正在进行的轮询落地，再做最后一次 drain（避免最后几个事件被在途轮询吞掉）。
    const idleDeadline = Date.now() + 1_000
    while (session.polling && Date.now() < idleDeadline) await new Promise((resolve) => setTimeout(resolve, 10))
    await this.execute(session, '(() => { if (window.__dfUiRecorder) window.__dfUiRecorder.active = false })()').catch(() => undefined)
    await this.poll(session)
    const core = session.core ?? new RecorderCore()
    const steps = await core.finalize((candidates) => this.checkCandidates(session, candidates))
    const result: UiRecordingResult = core.result(steps, { startUrl: session.startUrl, viewport: session.viewport })
    session.core = undefined
    return { ok: true, result }
  }

  async pickSelector(sessionId: string, timeoutMs?: number): Promise<PickedElement> {
    const session = this.sessions.get(sessionId)
    if (session === undefined) return { ok: false, error: `会话 ${sessionId} 不存在（可能已关闭）` }
    if (session.recording) return { ok: false, error: '正在录制：先停止录制再点选元素（点选本身也会产生点击）' }
    await this.execute(session, SELECTOR_HELPER_SCRIPT).catch(() => undefined)
    const budget = Math.min(Math.max(timeoutMs ?? 120_000, 1_000), 120_000)
    const result = await session.seam.execute(session.sessionId, { script: PICKER_SCRIPT, timeoutMs: budget }).catch((error: unknown) => ({ ok: false as const, exception: messageOf(error) }))
    if (!result.ok) {
      return { ok: false, error: result.exception }
    }
    const value = result.value
    if (typeof value !== 'object' || value === null) return { ok: false, error: '点选没有返回值' }
    return value as PickedElement
  }

  async pageMeta(sessionId: string): Promise<UiPageMeta> {
    const session = this.sessions.get(sessionId)
    if (session === undefined) return {}
    const result = await this.execute(session, `(() => {
      const contentOf = (selector) => {
        try { const el = document.querySelector(selector); return el && el.getAttribute('content') ? el.getAttribute('content') : '' } catch (err) { return '' }
      }
      return {
        url: (() => { try { return location.href } catch (err) { return '' } })(),
        title: (() => { try { return document.title || '' } catch (err) { return '' } })(),
        siteName: contentOf('meta[property="og:site_name"]') || contentOf('meta[name="application-name"]') || contentOf('meta[name="apple-mobile-web-app-title"]')
      }
    })()`)
    if (!result.ok || typeof result.value !== 'object' || result.value === null) return {}
    const value = result.value as { url?: unknown; title?: unknown; siteName?: unknown }
    return {
      ...(typeof value.url === 'string' && value.url !== '' ? { url: value.url } : {}),
      ...(typeof value.title === 'string' && value.title !== '' ? { title: value.title } : {}),
      ...(typeof value.siteName === 'string' && value.siteName !== '' ? { siteName: value.siteName } : {}),
    }
  }

  async cookiesOf(sessionId: string): Promise<UiCookie[]> {
    void sessionId
    // 共享浏览器使用自己的持久 profile，dataforge 不接管它的 cookie。
    return []
  }

  async close(sessionId: string): Promise<{ ok: boolean; error?: string }> {
    const session = this.sessions.get(sessionId)
    if (session === undefined) return { ok: false, error: `会话 ${sessionId} 不存在（可能已关闭）` }
    if (session.timer !== undefined) clearInterval(session.timer)
    session.recording = false
    this.sessions.delete(sessionId)
    try {
      await session.seam.close(sessionId)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: messageOf(error) }
    }
  }

  list(): UiRecordingSessionView[] {
    return [...this.sessions.values()].map((session) => ({
      sessionId: session.sessionId,
      pageUrl: session.lastUrl,
      recording: session.recording,
      startedAt: session.startedAt,
    }))
  }

  pageUrlOf(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.lastUrl
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  async closeAll(): Promise<void> {
    for (const sessionId of [...this.sessions.keys()]) await this.close(sessionId)
  }

  async run(doc: UiScriptDoc, inputs: Record<string, string>, options?: UiEngineRunOptions): Promise<UiRunResult> {
    const seam = this.io.resolveSeam()
    if (seam === undefined) throw new Error('共享浏览器不可用（宿主没有注册 ctx.browser）')
    const owner = options?.owner ?? this.io.resolveOwner()
    if (owner === undefined || owner === '') {
      throw new Error('无法确定当前 DSH 对话 id（共享浏览器需要按对话挂右侧栏面板）')
    }
    return runUiScriptOnSeam(
      { seam, owner, dataRoot: this.io.dataRoot, stepTimeoutMs: this.io.stepTimeoutMs },
      doc,
      inputs,
      {
        slowMoMs: options?.slowMoMs ?? 0,
        highlightClicks: options?.highlightClicks ?? true,
        ...(options?.holdMs === undefined ? {} : { holdMs: options.holdMs }),
      },
    )
  }

  /* ── 内部：注入 / 轮询 / 校验 ── */

  private async injectRecorder(session: SharedSession): Promise<{ ok: boolean; error?: string }> {
    const helper = await this.execute(session, SELECTOR_HELPER_SCRIPT)
    if (!helper.ok) return { ok: false, error: `注入选择器脚本失败：${helper.exception}` }
    const recorder = await this.execute(session, RECORDER_SOURCE)
    if (!recorder.ok) return { ok: false, error: `注入录制脚本失败：${recorder.exception}` }
    session.lastInjectAt = Date.now()
    return { ok: true }
  }

  private async poll(session: SharedSession): Promise<void> {
    if (session.polling) return
    session.polling = true
    try {
      const result = await this.execute(session, DRAIN_EXPRESSION)
      if (!result.ok) return
      const value = result.value
      if (typeof value !== 'object' || value === null) return
      const record = value as { installed?: unknown; events?: unknown; url?: unknown }
      if (typeof record.url === 'string' && record.url !== '') session.lastUrl = record.url
      const events = Array.isArray(record.events) ? record.events : []
      for (const event of events) session.core?.ingest(event)
      // 页面导航后注入脚本丢失：录制中自动补装（导航瞬间的事件会丢，诚实边界）。
      if (session.recording && record.installed !== true && Date.now() - session.lastInjectAt > 1_000) {
        await this.injectRecorder(session)
      }
    } finally {
      session.polling = false
    }
  }

  private async checkCandidates(session: SharedSession, candidates: string[]): Promise<string[]> {
    if (candidates.length === 0) return []
    const result = await this.execute(session, CHECK_CANDIDATES_EXPRESSION, [candidates])
    if (!result.ok) return candidates
    const value = result.value
    if (!Array.isArray(value)) return candidates
    return normalizeCandidateList(value)
  }

  private execute(session: SharedSession, script: string, args?: readonly unknown[]): Promise<SeamExecuteResult> {
    return session.seam.execute(session.sessionId, { script, ...(args === undefined ? {} : { args }), timeoutMs: this.io.stepTimeoutMs })
  }

  private async activeUrl(seam: BrowserSeam, sessionId: string): Promise<string | undefined> {
    try {
      const tabs = await seam.listTabs(sessionId)
      return tabs.find((tab) => tab.active)?.url ?? tabs[0]?.url
    } catch {
      return undefined
    }
  }
}

function messageOf(error: unknown): string {
  return String((error as Error)?.message ?? error).slice(0, 500)
}
