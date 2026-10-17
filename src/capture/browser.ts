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
}

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
  return { browser, context, page }
}
