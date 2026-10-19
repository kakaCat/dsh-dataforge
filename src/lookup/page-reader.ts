/**
 * page 来源 lookup 的 Playwright 读取器。
 *
 * 只读：打开页面 → 等 items 选择器 → 按配置读取 text/attr → 返回候选；不点按钮、不填表。
 * 登录态暂不注入（page 来源适合公开页面；需要登录时优先用 api 来源）。
 *
 * @module dsh-dataforge/lookup/page-reader
 */
import { chromium, type Browser } from 'playwright-core'
import type { LookupCandidate, LookupPageSource } from './lookup.js'

export type PageLookupReaderOptions = {
  /** 系统 Chrome channel（与采集/UI 测试同款）；缺省用 Playwright 自带 chromium。 */
  channel?: string
  timeoutMs?: number
}

/** 构造 page lookup reader；返回值可注入 lookup deps。 */
export function createPageLookupReader(options: PageLookupReaderOptions = {}): (source: LookupPageSource) => Promise<LookupCandidate[]> {
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 15_000, 1_000), 60_000)
  return async (source) => {
    let browser: Browser | undefined
    try {
      browser = await chromium.launch({
        headless: true,
        ...(options.channel === undefined || options.channel === '' ? {} : { channel: options.channel }),
      })
      const page = await browser.newPage()
      await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
      const selector = source.items
      const appeared = await page.waitForSelector(selector, { state: 'attached', timeout: timeoutMs }).then(() => true).catch(() => false)
      if (!appeared) throw new Error(`page lookup 未找到 items 选择器：${selector}`)
      const expression = `(function (cfg) {
        const read = (element, spec) => {
          if (spec === 'text') return ((element.innerText || element.textContent || '') + '').replace(/\s+/g, ' ').trim()
          if (spec.startsWith('attr:')) return (element.getAttribute(spec.slice(5)) || '').trim()
          return ''
        }
        return Array.from(document.querySelectorAll(cfg.selector)).map((element) => {
          const values = {}
          Object.keys(cfg.map).forEach((key) => {
            const value = read(element, cfg.map[key])
            if (value !== '') values[key] = value
          })
          return { label: read(element, cfg.label), values: values }
        }).filter((item) => item.label !== '' && Object.keys(item.values).length > 0)
      })(${JSON.stringify({ selector, label: source.label, map: source.map })})`
      const rows = await page.evaluate(expression) as LookupCandidate[]
      return rows
    } finally {
      await browser?.close().catch(() => undefined)
    }
  }
}
