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
import type { Browser, BrowserContext, Page } from 'playwright-core'

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

const SAMPLE_THRESHOLD = 10_000

/** wire→store 输入：小体量 JSON 才读全量；超限标 truncated 不挂预览。 */
export function responseToRawSample(wire: WireSample, bodyLimit: number): RawSampleInput | undefined {
  const body = wire.responseText
  const oversized = body !== undefined && Buffer.byteLength(body) > bodyLimit
  return {
    url: wire.url,
    method: wire.method,
    status: wire.status,
    requestHeaders: wire.requestHeaders,
    requestBody: wire.requestPostData === undefined || Buffer.byteLength(wire.requestPostData) > SAMPLE_THRESHOLD ? undefined : wire.requestPostData,
    responseBody: body === undefined || oversized ? undefined : body,
    truncated: oversized,
  }
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
): Promise<CapturingPage> {
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({
    channel,
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  })
  const context = await browser.newContext()
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
        const postRaw: string | null = resourceType === 'fetch' ? request.postData() : null
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
