import { expect, it, vi } from 'vitest'
import { crawlSite, type CrawlDriver } from '../../src/capture/crawler.js'

const mkDriver = (htmlFor: Record<string, string>, visited: string[]): CrawlDriver => ({
  openPage: async (url) => {
    visited.push(url)
    return { pageId: `pg_${visited.length}`, html: htmlFor[url] ?? '', sampleCount: 0 }
  },
  close: async () => undefined,
})

it('BFS：同域发现、外域跳过记录、maxPages 截断', async () => {
  const visited: string[] = []
  const driver = mkDriver(
    { 'https://x.test/': '<a href="/b"></a><a href="/c"></a><a href="https://external.test/c"></a>' },
    visited,
  )
  const onEvent = vi.fn()
  const result = await crawlSite({
    entryUrl: 'https://x.test/', driver, ownHost: 'x.test',
    maxDepth: 2, maxPages: 3, stabilityMs: 0, onEvent, onSample: vi.fn(),
  })
  expect(result.pagesVisited).toBe(3) // /, /b, /c（cap=maxPages）
  expect(result.externalSkipped).toBeGreaterThanOrEqual(1)
  expect(result.truncated).toBe(true) // 诚实标注
})

it('深度上限：depth > maxDepth 不再展开', async () => {
  const visited: string[] = []
  const chain: Record<string, string> = {
    'https://x.test/': '<a href="/l1"></a>',
    'https://x.test/l1': '<a href="/l2"></a>',
    'https://x.test/l1/l2': '<a href="/l3"></a>',
  }
  const result = await crawlSite({
    entryUrl: 'https://x.test/', driver: mkDriver(chain, visited), ownHost: 'x.test',
    maxDepth: 1, maxPages: 50, stabilityMs: 0, onEvent: vi.fn(), onSample: vi.fn(),
  })
  expect(visited.sort()).toEqual(['https://x.test/', 'https://x.test/l1'])
  expect(result.pagesVisited).toBe(2)
})

it('driver 抛错：error 事件 + 继续/收尾', async () => {
  const events: Array<{ kind: string; url: string }> = []
  const driver: CrawlDriver = {
    openPage: async (url) => {
      if (url === 'https://x.test/bad') throw new Error('net down')
      return { pageId: 'pg', html: '<a href="/bad"></a>', sampleCount: 0 }
    },
    close: async () => undefined,
  }
  const result = await crawlSite({
    entryUrl: 'https://x.test/bad', driver, ownHost: 'x.test',
    maxDepth: 1, maxPages: 5, stabilityMs: 0,
    onEvent: (e) => events.push({ kind: e.kind, url: e.url }), onSample: vi.fn(),
  })
  expect(events.some((e) => e.kind === 'error' && e.url === 'https://x.test/bad')).toBe(true)
  expect(result.errors).toHaveLength(1)
})
