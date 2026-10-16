/**
 * site_crawl BFS driver：同域逐页采集与链接发现。
 *
 * 登录会话由调用方先就绪（application 层先 open 会话再委托抓取）；
 * 这里只做 BFS 队列调度、同 host 过滤、深度/页数截断与诚实标注。
 *
 * @module dsh-dataforge/capture/crawler
 */
import { captureHost, extractAllLinks } from './normalizer.js'

export type CrawlDriver = {
  openPage(url: string): Promise<{ pageId: string; html: string; sampleCount: number }>
  close(): Promise<void>
}

export type CrawlResult = { pagesVisited: number; externalSkipped: number; truncated: boolean; errors: string[] }

export type CrawlEvent = { kind: 'page' | 'skip' | 'error'; url: string; detail?: string }

/** site_crawl BFS：登录会话由调用方先就绪；这里只做同域逐页采集与链接发现。 */
export async function crawlSite(o: {
  entryUrl: string
  driver: CrawlDriver
  ownHost: string
  maxDepth: number
  maxPages: number
  stabilityMs: number
  onEvent: (e: CrawlEvent) => void
  onSample: (w: unknown) => void
}): Promise<CrawlResult> {
  const visited = new Set<string>()
  const queued = new Set<string>([o.entryUrl])
  const queue: Array<{ url: string; depth: number }> = [{ url: o.entryUrl, depth: 0 }]
  let externalSkipped = 0
  const errors: string[] = []
  while (queue.length > 0 && visited.size < o.maxPages) {
    const { url, depth } = queue.shift() as { url: string; depth: number }
    if (visited.has(url) || depth > o.maxDepth) continue
    visited.add(url)
    try {
      const { html } = await o.driver.openPage(url)
      o.onEvent({ kind: 'page', url })
      for (const link of extractAllLinks(html, url)) {
        if (visited.has(link) || queued.has(link)) continue
        // host 过滤在调用方统一计数：外域不进队列但如实披露
        if (captureHost(link) !== o.ownHost) {
          externalSkipped += 1
          o.onEvent({ kind: 'skip', url: link, detail: 'external host' })
          continue
        }
        if (visited.size + queue.length >= o.maxPages || depth + 1 > o.maxDepth) continue
        queued.add(link)
        queue.push({ url: link, depth: depth + 1 })
      }
    } catch (err) {
      const msg = (err as Error | undefined)?.message?.slice(0, 200) ?? 'unknown error'
      errors.push(msg)
      o.onEvent({ kind: 'error', url, detail: msg })
    }
  }
  await o.driver.close().catch(() => undefined)
  return {
    pagesVisited: visited.size,
    externalSkipped,
    truncated: queue.length > 0 || visited.size >= o.maxPages,
    errors,
  }
}
