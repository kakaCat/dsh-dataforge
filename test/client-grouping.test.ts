/**
 * 采集结果分组（纯函数）：页面 → 接口 → 形态。
 *
 * 这是「采集页结果区」的核心语义，单独测掉：分组顺序稳定、孤儿卡有兜底、
 * 形态数/样本数算得对（关系行是真相源，卡片上的冗余计数只在无关系行时兜底）。
 *
 * @module test/client-grouping
 */
import { expect, it } from 'vitest'
import { UNKNOWN_SITE, UNRECORDED_PAGE, groupByPage, groupSites, hostOf, shapeStats } from '../src/client/grouping.js'
import type { CardRow, RelationRow, RunRow } from '../src/client/types.js'

function card(id: string, extra: Partial<CardRow> = {}): CardRow {
  return {
    id, captureId: 'cap_x', urlTemplate: `/api/${id}`, method: 'GET',
    relatedPageUrls: [], sampleCount: 1, createdAt: 1, ...extra,
  }
}

function relation(cardId: string, pageUrl: string, fingerprint: string, sampleCount = 1): RelationRow {
  return { cardId, pageUrl, paramsFingerprint: fingerprint, sampleCount }
}

it('按页面分组，页面内按接口聚合形态；顺序稳定（页面首次出现顺序）', () => {
  const cards = [card('c1'), card('c2')]
  const relations = [
    relation('c1', 'https://x.test/a', 'fp1', 2),
    relation('c1', 'https://x.test/a', 'fp2', 1),
    relation('c2', 'https://x.test/b', 'fp3', 1),
  ]
  const groups = groupByPage(cards, relations)
  expect(groups.map((g) => g.pageUrl)).toEqual(['https://x.test/a', 'https://x.test/b'])
  expect(groups[0]?.cards).toHaveLength(1)
  expect(groups[0]?.cards[0]?.card.id).toBe('c1')
  expect(groups[0]?.cards[0]?.relations.map((r) => r.paramsFingerprint)).toEqual(['fp1', 'fp2'])
  expect(shapeStats(cards[0]!, groups[0]!.cards[0]!.relations)).toEqual({ shapes: 2, samples: 3 })
})

it('同一接口出现在多个页面：每个页面各一组（页面维度不被卡片冗余合并）', () => {
  const cards = [card('c1')]
  const groups = groupByPage(cards, [
    relation('c1', 'https://x.test/a', 'fp1'),
    relation('c1', 'https://x.test/b', 'fp1'),
  ])
  expect(groups.map((g) => g.pageUrl)).toEqual(['https://x.test/a', 'https://x.test/b'])
  expect(groups.every((g) => g.cards[0]?.card.id === 'c1')).toBe(true)
})

it('历史卡没有关系行 → 归入「未记录页面」兜底组，不丢卡', () => {
  const cards = [card('old', { sampleCount: 5 }), card('c2')]
  const groups = groupByPage(cards, [relation('c2', 'https://x.test/a', 'fp1')])
  expect(groups[0]?.pageUrl).toBe('https://x.test/a')
  const fallback = groups.find((g) => g.pageUrl === UNRECORDED_PAGE)
  expect(fallback?.cards.map((c) => c.card.id)).toEqual(['old'])
  expect(shapeStats(cards[0]!, [])).toEqual({ shapes: 1, samples: 5 })
})

it('关系行指向已不存在的卡：跳过该关系行（不为它造页面组）', () => {
  const groups = groupByPage([card('c1')], [relation('ghost', 'https://x.test/a', 'fp1')])
  // ghost 行被丢弃；真实存在的 c1 没有关系行 → 走兜底组
  expect(groups.map((g) => g.pageUrl)).toEqual([UNRECORDED_PAGE])
  expect(groups[0]?.cards.map((c) => c.card.id)).toEqual(['c1'])
})

it('空输入：零页面零卡，不抛错', () => {
  expect(groupByPage([], [])).toEqual([])
})

function run(id: string, entryUrl: string, extra: Partial<RunRow> = {}): RunRow {
  return {
    id, taskType: 'single_page', entryUrl, status: 'succeeded', startedAt: 1,
    endedAt: undefined, stats: { pages: 0, requests: 0, cards: 0, credentials: 0 }, ...extra,
  }
}

it('groupSites: 卡按关系页 host 归组；页面集合并入 run entryUrl', () => {
  const runs = [run('r1', 'https://x.test/home', { startedAt: 100 })]
  const cards = [
    card('c1', { captureId: 'r1', relatedPageUrls: ['https://x.test/search', 'https://x.test/detail'] }),
    card('c2', { captureId: 'r1', relatedPageUrls: ['https://x.test/search'], sampleCount: 3 }),
  ]
  const sites = groupSites(cards, runs)
  expect(sites).toHaveLength(1)
  expect(sites[0]?.host).toBe('x.test')
  // 页面去重：两卡共享 search 页 + run 主页 home
  expect([...sites[0]!.pageUrls].sort()).toEqual(['https://x.test/detail', 'https://x.test/home', 'https://x.test/search'])
  expect(sites[0]!.stats).toEqual({ pages: 3, cards: 2, samples: 4, runs: 1, firstAt: 100, lastAt: 100 })
})

it('groupSites: 无关系页的历史卡按 captureId 对到该 run 的 entryUrl host', () => {
  const runs = [run('r9', 'https://y.test/', { startedAt: 5 })]
  const sites = groupSites([card('old', { captureId: 'r9', relatedPageUrls: [], sampleCount: 2 })], runs)
  expect(sites).toHaveLength(1)
  expect(sites[0]?.host).toBe('y.test')
  expect(sites[0]!.stats.cards).toBe(1)
})

it('groupSites: 对不上归属 → 「未识别站点」兜底且排最后', () => {
  const sites = groupSites([card('ghost-card', { captureId: 'gone', relatedPageUrls: [] })], [])
  expect(sites).toHaveLength(1)
  expect(sites[0]?.host).toBe(UNKNOWN_SITE)
})

it('groupSites: run 没出卡也计入站点（采集次数/首末时间独立于卡）', () => {
  const sites = groupSites([], [run('r1', 'https://a.test/', { startedAt: 10 }), run('r2', 'https://b.test/', { startedAt: 99 })])
  expect(sites.map((s) => s.host)).toEqual(['b.test', 'a.test']) // 按最近采集倒序
  expect(sites[0]!.stats).toEqual({ pages: 1, cards: 0, samples: 0, runs: 1, firstAt: 99, lastAt: 99 })
})

it('groupSites: 非法 URL 归「未识别站点」；排序兜底组恒在末尾', () => {
  const runs = [run('r1', 'not-a-url', { startedAt: 1 })]
  const sites = groupSites([card('c0', { relatedPageUrls: ['https://ok.test/p'] })], runs)
  expect(sites.map((s) => s.host)).toEqual(['ok.test', UNKNOWN_SITE])
})

it('hostOf: 仅 http/https 有 host；相对地址与其它协议返回 undefined', () => {
  expect(hostOf('https://a.test:8443/p')).toBe('a.test:8443')
  expect(hostOf('http://b.test/')).toBe('b.test')
  expect(hostOf('/api/x')).toBeUndefined()
  expect(hostOf('ftp://c.test/')).toBeUndefined()
  expect(hostOf('::::')).toBeUndefined()
})

it('groupSites: 空输入零组，不抛错', () => {
  expect(groupSites([], [])).toEqual([])
})
