/**
 * UI 录制会话：一个可见 Chrome 窗口 = 用户手动登录/操作 + 录制器挂在同一页面上。
 *
 * 为什么不复用采集的 SessionRegistry：
 *   采集会话的职责是「页面动作 → 网络样本」，它的 page 不对外暴露，网络旁路也在这里用不到；
 *   录制要的是 page 本身（注入事件监听、截图、取 cookie）。两条会话寿命都短，但职责不同，
 *   硬塞在一起会让采集层多背一个 UI 概念。这里独立一个小 registry，只依赖浏览器工厂缝。
 *
 * 与 capture/browser 的关系：同款浏览器启动参数（系统 Chrome、免下载），但**不import**它——
 * 录制要不要网络旁路由业务决定，不是浏览器层决定的。
 *
 * @module dsh-dataforge/uitest/sessions
 */
import type { Browser, BrowserContext, Page } from 'playwright-core'
import { UiRecorder, type UiRecordingResult } from './recorder.js'
import { openUiBrowser, type UiBrowserFactory, type UiCookie } from './run.js'
import { pickOnPage } from './picker.js'
import type { UiPageMeta } from './naming.js'
import { SELECTOR_HELPER_SCRIPT, type PickedElement } from './selector-script.js'

/** 打开录制的入参。 */
export type UiRecordingOpenArgs = {
  startUrl: string
  /** false = 可见 Chrome（缺省，供手动登录）；true = 无头（只适合不需要登录的站点）。 */
  headless?: boolean
  channel: string
  viewport?: { width: number; height: number }
  /** 从本地凭证 jar 注入的 cookie（值只在内存里过手）。 */
  cookies?: UiCookie[]
  /** 页面导航超时（毫秒）。 */
  navigationTimeoutMs?: number
}

/** 会话视图（面板/工具回执用；不含 cookie）。 */
export type UiRecordingSessionView = {
  sessionId: string
  pageUrl: string
  recording: boolean
  startedAt: number
}

type SessionRecord = {
  browser: Browser
  context: BrowserContext
  page: Page
  recorder?: UiRecorder
  startedAt: number
}

/** 录制会话 registry：进程内、关闭即释放；不落盘（脚本才是资产）。 */
export class UiRecordingSessions {
  private readonly sessions = new Map<string, SessionRecord>()
  private readonly openBrowser: UiBrowserFactory

  constructor(io: { openBrowser?: UiBrowserFactory } = {}) {
    this.openBrowser = io.openBrowser ?? openUiBrowser
  }

  /** 打开一个可见浏览器窗口（不自动开始录制——先让用户登录，再手动开始录）。 */
  async open(args: UiRecordingOpenArgs): Promise<{ ok: boolean; sessionId?: string; pageUrl?: string; error?: string }> {
    const sessionId = `uis_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    try {
      const viewport = args.viewport ?? { width: 1280, height: 720 }
      const opened = await this.openBrowser({ headless: args.headless ?? false, viewport, channel: args.channel })
      this.sessions.set(sessionId, { ...opened, startedAt: Date.now() })
      // 点选器依赖页面内的选择器候选 helper：会话一打开就注入（录制器也会用同一份）。
      await opened.page.evaluate(SELECTOR_HELPER_SCRIPT).catch(() => undefined)
      await opened.context.addInitScript(SELECTOR_HELPER_SCRIPT).catch(() => undefined)
      if (args.cookies !== undefined && args.cookies.length > 0) {
        await opened.context.addCookies(args.cookies.map(toPlaywrightCookie)).catch(() => undefined)
      }
      const timeout = args.navigationTimeoutMs ?? 20_000
      await opened.page.goto(args.startUrl, { waitUntil: 'domcontentloaded', timeout }).catch(() => undefined)
      return { ok: true, sessionId, pageUrl: safeUrl(opened.page) }
    } catch (error) {
      return { ok: false, error: messageOf(error) }
    }
  }

  /** 开始录制（页面脚本注入 + 事件绑定）；重复调用返回已在录。 */
  async start(sessionId: string): Promise<{ ok: boolean; pageUrl?: string; error?: string; alreadyRecording?: boolean }> {
    const record = this.sessions.get(sessionId)
    if (record === undefined) return { ok: false, error: `会话 ${sessionId} 不存在（可能已关闭）` }
    const already = record.recorder !== undefined
    try {
      record.recorder = await UiRecorder.start(record.page, record.context)
      return { ok: true, pageUrl: safeUrl(record.page), ...(already ? { alreadyRecording: true } : {}) }
    } catch (error) {
      return { ok: false, error: messageOf(error) }
    }
  }

  /** 停止录制并返回步骤（会话保留，可继续录下一个流程）。 */
  async stop(sessionId: string): Promise<{ ok: boolean; result?: UiRecordingResult; error?: string }> {
    const record = this.sessions.get(sessionId)
    if (record === undefined) return { ok: false, error: `会话 ${sessionId} 不存在（可能已关闭）` }
    if (record.recorder === undefined) return { ok: false, error: `会话 ${sessionId} 没有在录制` }
    try {
      const result = await record.recorder.stop()
      record.recorder = undefined
      return { ok: true, result }
    } catch (error) {
      record.recorder = undefined
      return { ok: false, error: messageOf(error) }
    }
  }

  /**
   * 在会话页面上点选一个元素（录制结束后补断言/改步骤用）。
   *
   * 录制中拒绝：点选也会产生点击，混进录制步骤会污染脚本。
   */
  async pickSelector(sessionId: string, timeoutMs?: number): Promise<PickedElement & { sessionId?: string }> {
    const record = this.sessions.get(sessionId)
    if (record === undefined) return { ok: false, error: `会话 ${sessionId} 不存在（可能已关闭）` }
    if (record.recorder !== undefined) {
      return { ok: false, error: '正在录制：先停止录制再点选元素（点选本身也会产生点击）' }
    }
    const picked = await pickOnPage(record.page, timeoutMs)
    return { ...picked, sessionId }
  }

  /** 读当前页面的 URL/标题/站点名（自动命名用；读不到就返回空对象，绝不抛）。 */
  async pageMetaOf(sessionId: string): Promise<UiPageMeta> {
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

  /** 取会话 cookie（录制结束持久化用；值只交给调用方，不回任何回执）。 */
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

  /** 关闭会话（先取消未结束的录制，再关浏览器）。 */
  async close(sessionId: string): Promise<{ ok: boolean }> {
    const record = this.sessions.get(sessionId)
    if (record === undefined) return { ok: false }
    this.sessions.delete(sessionId)
    await record.recorder?.cancel().catch(() => undefined)
    await record.browser.close().catch(() => undefined)
    return { ok: true }
  }

  /** 会话视图（面板轮询录制状态用）。 */
  list(): UiRecordingSessionView[] {
    return [...this.sessions.entries()].map(([sessionId, record]) => ({
      sessionId,
      pageUrl: safeUrl(record.page),
      recording: record.recorder !== undefined,
      startedAt: record.startedAt,
    }))
  }

  pageUrlOf(sessionId: string): string | undefined {
    const record = this.sessions.get(sessionId)
    return record === undefined ? undefined : safeUrl(record.page)
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  /** 关掉全部会话（插件卸载/测试清理用）。 */
  async closeAll(): Promise<void> {
    const ids = [...this.sessions.keys()]
    await Promise.all(ids.map((id) => this.close(id)))
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

function safeUrl(page: Page): string {
  try {
    return page.url()
  } catch {
    return ''
  }
}

function messageOf(error: unknown): string {
  return String((error as Error)?.message ?? error).slice(0, 500)
}
