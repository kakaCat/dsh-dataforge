/**
 * 会话原语 registry：agent 侧的"手"。
 *
 * worker 不含智能，只服从 agent 指示分派页面动作（click/fill/press/submit/wait/goto）。
 * 采集网络样本经 sink 回调流出（由 application 层桥接到 normalizer+store）。
 *
 * @module dsh-dataforge/capture/session
 */
import type { Browser, BrowserContext, Cookie, Page } from 'playwright-core'
import type { JsonLike } from '../shared/types.js'
import { openCapturingPage, type PagePageMeta, type WireSample } from './browser.js'

/**
 * 得到一个会话的静默事件侧：页面采集样本与页面标题/站点名经 sink 输出（调用方消费）。
 *
 * `onPageMeta` 可缺省：只有需要名称数据面的调用方（application 采集桥）才关心它。
 */
export type Sink = {
  onSample: (w: WireSample) => void
  onPageMeta?: (meta: PagePageMeta) => void
}

type OpenOptions = { entryUrl?: string; captureId?: string; headless?: boolean; cookies?: Cookie[] }

/** 会话原语点击/填单派发表——worker 不含智能，只服从 agent 指示。 */
export type ActSpec =
  | { kind: 'click'; selector: string }
  | { kind: 'fill'; selector: string; value: string }
  | { kind: 'upload'; selector: string; files: string[] }
  | { kind: 'eval'; script: string }
  | { kind: 'press'; key: string }
  | { kind: 'submit'; selector: string }
  | { kind: 'wait'; ms: number }
  | { kind: 'goto'; url: string }

interface SessionRecord {
  page: Page
  browser: Browser
  context: BrowserContext
  sink?: Sink
  /**
   * sink 尚未绑定时收到的最近一次页面元信息。
   *
   * open 内的 entry goto 会先触发 load/标题上报，而 action 路径要等 open 返回后才 bindSink：
   * 不暂存这一次，入口页标题就永久丢了。只留最新一条（同一页的重复上报无需排队）。
   */
  pendingMeta?: PagePageMeta
  captureId?: string
}

export class SessionRegistry {
  private readonly sessions = new Map<string, SessionRecord>()
  constructor(private readonly io: { openCapturingPage: typeof openCapturingPage; bodyLimit: number }) {}

  async open(o: OpenOptions): Promise<{ sessionId: string; pageUrl: string }> {
    const sessionId = `bs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const { browser, context, page } = await this.io.openCapturingPage('chrome', (w) => {
      this.sessions.get(sessionId)?.sink?.onSample(w)
    }, {
      ...(o.headless === undefined ? {} : { headless: o.headless }),
      ...(o.cookies === undefined ? {} : { cookies: o.cookies }),
      // 标题上报路由到「当前 sink」；sink 未绑定则暂存最新一条，bindSink 时补发（见 SessionRecord.pendingMeta）。
      onPageMeta: (meta) => {
        const s = this.sessions.get(sessionId)
        if (s === undefined) return
        if (s.sink?.onPageMeta !== undefined) s.sink.onPageMeta(meta)
        else s.pendingMeta = meta
      },
    })
    this.sessions.set(sessionId, o.captureId === undefined ? { page, browser, context } : { page, browser, context, captureId: o.captureId })
    if (o.entryUrl !== undefined) await page.goto(o.entryUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => undefined)
    return { sessionId, pageUrl: page.url() }
  }

  /** 绑定事件侧；兼容旧调用形态（只给 onSample 函数）与新形态（Sink 对象，含 onPageMeta）。 */
  bindSink(sessionId: string, sink: Sink['onSample'] | Sink): void {
    const s = this.sessions.get(sessionId)
    if (s === undefined) return
    const normalized: Sink = typeof sink === 'function' ? { onSample: sink } : sink
    s.sink = normalized
    if (s.pendingMeta !== undefined) {
      const meta = s.pendingMeta
      s.pendingMeta = undefined
      normalized.onPageMeta?.(meta)
    }
  }

  async act(sessionId: string, spec: ActSpec): Promise<{ ok: boolean; pageUrl?: string; error?: string; value?: JsonLike }> {
    const s = this.sessions.get(sessionId)
    if (s === undefined) return { ok: false, error: `session ${sessionId} 不存在` }
    try {
      if (spec.kind === 'click') await s.page.click(spec.selector, { timeout: 10_000 })
      else if (spec.kind === 'fill') await s.page.fill(spec.selector, spec.value, { timeout: 10_000 })
      else if (spec.kind === 'upload') await s.page.setInputFiles(spec.selector, spec.files, { timeout: 20_000 })
      else if (spec.kind === 'eval') {
        const value = await s.page.evaluate(spec.script)
        return { ok: true, pageUrl: s.page.url(), value: value as JsonLike }
      }
      else if (spec.kind === 'press') await s.page.keyboard.press(spec.key)
      else if (spec.kind === 'submit') await s.page.click(spec.selector, { timeout: 10_000 })
      else if (spec.kind === 'wait') await s.page.waitForTimeout(Math.min(spec.ms, 10_000))
      else if (spec.kind === 'goto') await s.page.goto(spec.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      return { ok: true, pageUrl: s.page.url() }
    } catch (err) {
      const msg = (err as Error | undefined)?.message
      return typeof msg === 'string' ? { ok: false, error: msg.slice(0, 300) } : { ok: false }
    }
  }

  async snapshot(sessionId: string): Promise<{ ok: boolean; elements?: string[]; error?: string }> {
    const s = this.sessions.get(sessionId)
    if (s === undefined) return { ok: false, error: `session ${sessionId} 不存在` }
    try {
      const elements = await s.page.$$eval(
        'a[href], button, input, form, select, textarea',
        (els) =>
          (els as unknown[]).filter((el) => {
            const e = el as { tagName: unknown; id: unknown; offsetWidth: unknown; offsetHeight: unknown; textContent: unknown; getAttribute: (n: string) => string | null }
            return typeof e.offsetWidth === 'number' && e.offsetWidth > 0 && typeof e.offsetHeight === 'number' && e.offsetHeight > 0
          }).slice(0, 80).map((el) => {
            const e = el as { tagName: unknown; id: unknown; textContent: unknown; getAttribute: (n: string) => string | null }
            const tag = String(e.tagName ?? '?').toLowerCase()
            const id = String(e.id ?? '')
            const name = e.getAttribute('name') ?? ''
            const txt = String(e.textContent ?? '').trim().slice(0, 40)
            return `${tag}${id ? `#${id}` : ''}${name ? `[name=${name}]` : ''} ${txt}`.trim()
          }),
      )
      return { ok: true, elements }
    } catch (err) {
      const msg = (err as Error | undefined)?.message
      return typeof msg === 'string' ? { ok: false, error: msg.slice(0, 300) } : { ok: false }
    }
  }

  async close(sessionId: string): Promise<{ ok: boolean; cookies: Array<Record<string, unknown>>; captureId?: string }> {
    const s = this.sessions.get(sessionId)
    if (s === undefined) return { ok: false, cookies: [] }
    const raw = (await s.context.cookies()) as unknown as Array<Record<string, unknown>>
    await s.browser.close().catch(() => undefined)
    this.sessions.delete(sessionId)
    return s.captureId === undefined ? { ok: true, cookies: raw } : { ok: true, cookies: raw, captureId: s.captureId }
  }
}
