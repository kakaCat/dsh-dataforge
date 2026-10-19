/**
 * browser 层：系统 Chrome 无头起会话 + 旁路监听 → WireSample 流。
 *
 * 只做职责边界（网络浮雕→wire 类型、体量裁剪）：
 * - 智能驱动（点哪/填什么）在会话原语之上由 agent 给；
 * - 归一化/模板合成在 normalizer；
 * - 落库在 store。
 *
 * @module dsh-dataforge/capture/browser
 */
import type { Browser, BrowserContext, Cookie, Page } from 'playwright-core'

/** browser 层 wire 类型（playwright 投影，归一化前的原始形状）。 */
export type WireSample = {
  url: string
  method: string
  status?: number
  resourceType: string
  contentType: string
  requestHeaders: Record<string, string>
  requestPostData?: string
  responseText?: string
  pageUrl: string
  ts: number
}

export interface RawSampleInput {
  url: string
  method: string
  status?: number
  requestHeaders: Record<string, string>
  requestBody?: string
  responseBody?: string | Buffer
  truncated: boolean
}

/**
 * wire→store 输入：请求体与响应体共用同一条体量上限。
 *
 * 超限不挂正文（避免把上传/大表单整包灌进盘），但**必须如实置 truncated**——
 * 早期实现对超限请求体静默丢正文且不置位，卡上就只剩一个「没有入参的 POST 接口」。
 */
export function responseToRawSample(wire: WireSample, bodyLimit: number): RawSampleInput | undefined {
  const body = wire.responseText
  const responseOversized = body !== undefined && Buffer.byteLength(body) > bodyLimit
  const request = wire.requestPostData
  const requestOversized = request !== undefined && Buffer.byteLength(request) > bodyLimit
  return {
    url: wire.url,
    method: wire.method,
    status: wire.status,
    requestHeaders: wire.requestHeaders,
    requestBody: requestOversized ? undefined : request,
    responseBody: responseOversized ? undefined : body,
    truncated: responseOversized || requestOversized,
  }
}

export type CapturingPageOptions = {
  /** false = 可见 Chrome（用户手动登录）；缺省 true = 无头采集。 */
  headless?: boolean
  /** 开上下文后立刻注入的 cookie（从本地 credential_events 恢复登录态）。 */
  cookies?: Cookie[]
  /**
   * 页面标题/站点名上报（防抖 150ms；load + 主 frame 导航触发）。
   *
   * 回调错误一律吞掉：标题只是名称数据面的增强项，绝不能因为读标题失败影响采集本身。
   */
  onPageMeta?: (meta: PagePageMeta) => void
}

/** 页面标题/站点名（`url` 是读 meta 时的真实 page.url()，身份校验由调用方做）。 */
export type PagePageMeta = {
  url: string
  title?: string
  siteName?: string
}

export const PAGE_TITLE_MAX = 300
export const PAGE_SITE_NAME_MAX = 80

/** 页面内取标题/站点名的表达式（字符串形式：本 tsconfig 不含 DOM lib，且与 session.eval 同风格）。 */
const PAGE_META_SCRIPT = `(() => {
  const contentOf = (selector) => {
    try {
      const el = document.querySelector(selector)
      return el === null ? '' : (el.getAttribute('content') || '')
    } catch (err) {
      return ''
    }
  }
  return {
    title: typeof document.title === 'string' ? document.title : '',
    siteTags: [
      contentOf('meta[property="og:site_name"]'),
      contentOf('meta[name="application-name"]'),
      contentOf('meta[name="apple-mobile-web-app-title"]')
    ]
  }
})()`

/** 空白压缩：换行/连续空格压成单空格并去首尾（标题里常见「站点 \\n | 页面」）。 */
function cleanMetaText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim()
}

/**
 * 读当前页面的标题与站点名。
 *
 * - title 来自 `document.title`（≤300 字符）；
 * - siteName 依次取 `og:site_name` → `application-name` → `apple-mobile-web-app-title`（≤80 字符）；
 * - 读不到/页面已销毁 → 只回 `{ url }`，绝不抛错（采集旁路不因元信息失败中断）。
 */
export async function readPageMeta(page: Page): Promise<PagePageMeta> {
  let url = ''
  try {
    url = page.url()
  } catch {
    url = ''
  }
  try {
    const raw: unknown = await page.evaluate(PAGE_META_SCRIPT)
    const record = (raw !== null && typeof raw === 'object' ? raw : {}) as { title?: unknown; siteTags?: unknown }
    const title = cleanMetaText(record.title).slice(0, PAGE_TITLE_MAX)
    let siteName = ''
    const candidates = Array.isArray(record.siteTags) ? record.siteTags : []
    for (const candidate of candidates) {
      const cleaned = cleanMetaText(candidate)
      if (cleaned !== '') {
        siteName = cleaned.slice(0, PAGE_SITE_NAME_MAX)
        break
      }
    }
    return {
      url,
      ...(title === '' ? {} : { title }),
      ...(siteName === '' ? {} : { siteName }),
    }
  } catch {
    return { url }
  }
}

/** 标题上报防抖窗口：SPA 一次导航常连发 load/framenavigated，150ms 内合并成一次读页面。 */
const PAGE_META_DEBOUNCE_MS = 150

export interface CapturingPage {
  browser: Browser
  context: BrowserContext
  page: Page
}

/**
 * 起一次会话：无头 chrome（channel: 'chrome' 系统浏览器）
 * + 旁路 CDP response 流（只收 xhr/fetch，静态资源全滤）。
 * 页面与 context 由 openCapturingPage 拥有，close 也由它交付（SessionRegistry 调 close）。
 */
export async function openCapturingPage(
  channel: string,
  onWireSample: (wire: WireSample) => void,
  options: CapturingPageOptions = {},
): Promise<CapturingPage> {
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({
    channel,
    headless: options.headless ?? true,
    args: ['--disable-blink-features=AutomationControlled'],
  })
  const context = await browser.newContext()
  if (options.cookies !== undefined && options.cookies.length > 0) {
    await context.addCookies(options.cookies).catch(() => undefined)
  }
  const page = await context.newPage()
  page.on('response', (response) => {
    void (async () => {
      const request = response.request()
      const resourceType = request.resourceType()
      if (resourceType !== 'xhr' && resourceType !== 'fetch') return
      let responseText: string | undefined
      const contentType = response.headers()['content-type'] ?? ''
      let status: number | undefined
      let method = request.method()
      let url = request.url()
      try {
        status = response.status()
        url = response.url()
        if (contentType.includes('json') || contentType.includes('javascript')) {
          responseText = await response.text()
        }
      } catch {
        responseText = undefined // 响应体不可读（redirect/二进制/已丢失）诚实弃止
      }
      try {
        method = request.method()
        // 请求体一律取（xhr 与 fetch 同等）：POST 业务接口的入参就在这里，早期只对 fetch 取是硬伤。
        let postRaw: string | null = null
        try {
          postRaw = request.postData()
        } catch {
          postRaw = null // 取不到（已回收/流式）如实留空，不假装有入参
        }
        onWireSample({
          url,
          method,
          status,
          resourceType,
          contentType,
          requestHeaders: request.headers(),
          requestPostData: postRaw === null ? undefined : postRaw,
          responseText,
          pageUrl: page.url(),
          ts: Date.now(),
        })
      } catch {
        // 请求已销毁（会话竞速）：诚实弃止
      }
    })().catch(() => undefined)
  })
  // 页面标题/站点名上报：load 与主 frame 导航各触发一次，150ms 内合并（SPA 一次导航常连发两个事件）。
  // readPageMeta 自身吞错；这里再兜一层 catch —— 标题失败绝不能冒泡进采集主流程。
  if (options.onPageMeta !== undefined) {
    const onPageMeta = options.onPageMeta
    let timer: ReturnType<typeof setTimeout> | undefined
    const report = (): void => {
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        void readPageMeta(page).then((meta) => onPageMeta(meta)).catch(() => undefined)
      }, PAGE_META_DEBOUNCE_MS)
    }
    page.on('load', report)
    page.on('framenavigated', (frame) => {
      // 只认主 frame：iframe 的导航不代表页面页面变了
      if (frame === page.mainFrame()) report()
    })
  }
  return { browser, context, page }
}
