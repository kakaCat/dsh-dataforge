/**
 * 采集结果分组（纯函数）：页面 → 接口 → 形态。
 *
 * 这是「采集页结果区」的核心语义，单独测掉：分组顺序稳定、孤儿卡有兜底、
 * 形态数/样本数算得对（关系行是真相源，卡片上的冗余计数只在无关系行时兜底）。
 *
 * @module test/client-grouping
 */
import { expect, it } from 'vitest'
import {
  UNKNOWN_SITE, UNRECORDED_PAGE, cardsOnPage, groupByPage, groupSites, hostOf, indexCardsByPage,
  chainSiteNamesOf, resolvePageNames, resolveSiteNames, shapeStats, siteLabelFromTitle, uniquePageUrls,
} from '../src/client/grouping.js'
import type { CardRow, NameMaps, PageMetaRow, RelationRow, RunRow } from '../src/client/types.js'

function card(id: string, extra: Partial<CardRow> = {}): CardRow {
  return {
    id, captureId: 'cap_x', mergeKey: `GET /api/${id}`, name: `接口 ${id}`,
    urlTemplate: `/api/${id}`, method: 'GET',
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

/* ── 页面身份归一（SPA hash 路由 / 反缓存戳） ── */

const BAIDU_PAGE = 'https://pan.baidu.com/disk/main#/index'
const BAIDU_VARIANTS = [
  'https://pan.baidu.com/disk/main#/index?category=all',
  'https://pan.baidu.com/disk/main#/index',
  'https://pan.baidu.com/disk/main?_at_=1792240465584#/index?category=all',
]

it('groupByPage: 同一 SPA 页面的 hash/反缓存戳变体并成一页，展示首次观测的原始 URL', () => {
  const cards = [card('c1')]
  const groups = groupByPage(cards, [
    relation('c1', BAIDU_VARIANTS[0]!, 'fp1', 2),
    relation('c1', BAIDU_VARIANTS[1]!, 'fp2', 1),
    relation('c1', BAIDU_VARIANTS[2]!, 'fp1', 3),
  ])
  expect(groups).toHaveLength(1)
  expect(groups[0]?.pageUrl).toBe(BAIDU_VARIANTS[0])
  // 合并后仍按指纹区分形态、样本数求和（关系行才是真相源）
  expect(shapeStats(cards[0]!, groups[0]!.cards[0]!.relations)).toEqual({ shapes: 2, samples: 6 })
})

it('groupByPage: 新数据（关系行存身份、卡引用存原始 URL）展示卡上真实访问过的原始 URL', () => {
  // 采集写入侧：关系行 page_url = 页面身份；卡 relatedPageUrls = 首次观测到的原始 URL
  const cards = [card('c1', { relatedPageUrls: [BAIDU_VARIANTS[2]!] })]
  const groups = groupByPage(cards, [relation('c1', BAIDU_PAGE, 'fp1', 2)])
  expect(groups).toHaveLength(1)
  expect(groups[0]?.pageUrl).toBe(BAIDU_VARIANTS[2])
})

it('uniquePageUrls: 卡上的历史字面页面只要身份相同就只算一条；空串跳过', () => {
  const pages = uniquePageUrls([
    ...BAIDU_VARIANTS,
    'https://pan.baidu.com/disk/main#/share',
    'https://pan.baidu.com/',
    '',
    '   ',
  ])
  expect(pages).toEqual([
    BAIDU_VARIANTS[0],
    'https://pan.baidu.com/disk/main#/share',
    'https://pan.baidu.com/',
  ])
})

it('groupByPage: 同页不同 hash 路由仍是两页（路由是页面身份的一部分）', () => {
  const groups = groupByPage([card('c1')], [
    relation('c1', BAIDU_PAGE, 'fp1'),
    relation('c1', 'https://pan.baidu.com/disk/main#/share', 'fp1'),
  ])
  expect(groups).toHaveLength(2)
})

it('indexCardsByPage: 同一卡的多页面变体按身份只索引一次；cardsOnPage 用展示 URL 也能查到', () => {
  const c = card('c1', {
    relatedPageUrls: [...BAIDU_VARIANTS, 'https://pan.baidu.com/disk/main#/share'],
  })
  const index = indexCardsByPage([c])
  expect([...index.keys()]).toEqual([BAIDU_PAGE, 'https://pan.baidu.com/disk/main#/share'])
  expect(index.get(BAIDU_PAGE)).toEqual([c])
  expect(cardsOnPage(index, BAIDU_VARIANTS[2]!)).toEqual([c])
  expect(cardsOnPage(index, 'https://unrelated.test/')).toEqual([])
})

it('groupSites: 同一 SPA 页面的变体只计一页；SPA 外壳入口不单独成页', () => {
  const runs = [run('r1', 'https://pan.baidu.com/disk/main', { startedAt: 10 })]
  const cards = [
    card('c1', { captureId: 'r1', relatedPageUrls: [BAIDU_VARIANTS[0]!] }),
    card('c2', { captureId: 'r1', relatedPageUrls: [BAIDU_VARIANTS[1]!, BAIDU_VARIANTS[2]!] }),
  ]
  const sites = groupSites(cards, runs)
  expect(sites).toHaveLength(1)
  expect(sites[0]!.pageUrls).toEqual([BAIDU_VARIANTS[0]])
  expect(sites[0]!.stats.pages).toBe(1)
})

it('groupSites: 入口页与 hash 路由页无关时，入口页仍照常成页', () => {
  const runs = [run('r1', 'https://pan.baidu.com/', { startedAt: 10 })]
  const cards = [card('c1', { captureId: 'r1', relatedPageUrls: [BAIDU_PAGE] })]
  const sites = groupSites(cards, runs)
  expect(sites[0]!.stats.pages).toBe(2)
  expect(sites[0]!.pageUrls.sort()).toEqual(['https://pan.baidu.com/', BAIDU_PAGE].sort())
})

it('groupSites: SPA 外壳判定吃 query/结尾斜杠（归一后仍是同一入口）', () => {
  const runs = [run('r1', 'https://pan.baidu.com/disk/main/?from=nav', { startedAt: 10 })]
  const cards = [card('c1', { captureId: 'r1', relatedPageUrls: [BAIDU_PAGE] })]
  const sites = groupSites(cards, runs)
  expect(sites[0]!.stats.pages).toBe(1)
  expect(sites[0]!.pageUrls).toEqual([BAIDU_PAGE])
})

it('groupSites: 外壳判定按 run 隔离（别的 run 的空入口仍成页）', () => {
  const runs = [
    run('r1', 'https://a.test/app', { startedAt: 10 }),
    run('r2', 'https://a.test/app', { startedAt: 20 }),
  ]
  const cards = [card('c1', { captureId: 'r1', relatedPageUrls: ['https://a.test/app#/orders'] })]
  const sites = groupSites(cards, runs)
  expect(sites[0]!.stats.pages).toBe(2)
  expect(sites[0]!.pageUrls.sort()).toEqual(['https://a.test/app', 'https://a.test/app#/orders'].sort())
})

it('groupSites: 入口自带 hash 时不当外壳（hash 路由页各自成页）', () => {
  const runs = [run('r1', 'https://a.test/app#/index', { startedAt: 10 })]
  const cards = [card('c1', { captureId: 'r1', relatedPageUrls: ['https://a.test/app#/index/detail'] })]
  const sites = groupSites(cards, runs)
  expect(sites[0]!.stats.pages).toBe(2)
})

it('groupSites: 外壳入口本身被某张卡引用时，页面仍出现（不丢真实页面）', () => {
  const runs = [run('r1', 'https://a.test/app', { startedAt: 10 })]
  const cards = [
    card('c1', { captureId: 'r1', relatedPageUrls: ['https://a.test/app#/orders'] }),
    card('c2', { captureId: 'r1', relatedPageUrls: ['https://a.test/app'] }),
  ]
  const sites = groupSites(cards, runs)
  expect(sites[0]!.stats.pages).toBe(2)
})

/* ── 三级名称解析（网站 / 页面）：手工名 > 自动名 > 无 ── */

const NO_NAMES: NameMaps = { sites: {}, pages: {}, interfaces: {} }

function meta(url: string, extra: Partial<PageMetaRow> = {}): PageMetaRow {
  return { url, visitedAt: 1, ...extra }
}

it('siteLabelFromTitle: 按分隔符取第一段并 trim（页面标题惯例是「页面名 - 站点名」）', () => {
  expect(siteLabelFromTitle('采购订单列表 - 智慧供应链 SCM')).toBe('采购订单列表')
  expect(siteLabelFromTitle('BPM 审批中心 | 工作台')).toBe('BPM 审批中心')
  expect(siteLabelFromTitle('待办 — 审批 · 中心')).toBe('待办')
  expect(siteLabelFromTitle('首页_统一认证丨门户')).toBe('首页')
  expect(siteLabelFromTitle('  采购订单列表  ')).toBe('采购订单列表')
})

it('siteLabelFromTitle: 首段过长按逗号再截；仍空 / 超 30 字符返回 undefined', () => {
  expect(siteLabelFromTitle(`${'超长标题'.repeat(6)}，后半段忽略`)).toBe('超长标题'.repeat(6))
  expect(siteLabelFromTitle('a'.repeat(31))).toBeUndefined()
  expect(siteLabelFromTitle('   -   ')).toBeUndefined()
  expect(siteLabelFromTitle(undefined)).toBeUndefined()
  expect(siteLabelFromTitle('')).toBeUndefined()
})

it('resolveSiteNames: 手工名优先于自动名（names.sites 键为小写 host）', () => {
  const pageMeta = [meta('https://x.test/a', { siteName: '自动站点', visitedAt: 5 })]
  const names: NameMaps = { sites: { 'x.test': '手工站点' }, pages: {}, interfaces: {} }
  const resolved = resolveSiteNames(['x.test'], [], pageMeta, names)
  expect(resolved.get('x.test')).toEqual({ name: '手工站点', source: 'manual' })
})

it('resolveSiteNames: 自动名来自该 host 最新一次采集的 og:site_name（不是最早那次）', () => {
  const pageMeta = [
    meta('https://x.test/a', { siteName: '旧站点名', visitedAt: 1 }),
    meta('https://x.test/b', { siteName: '新站点名', visitedAt: 9 }),
  ]
  expect(resolveSiteNames(['x.test'], [], pageMeta, NO_NAMES).get('x.test'))
    .toEqual({ name: '新站点名', source: 'auto' })
})

it('resolveSiteNames: 无 og:site_name 时用最近 run 入口页标题经清洗（身份归一后匹配）', () => {
  const runs = [run('r1', 'https://x.test/home#/index?tab=1', { startedAt: 5 })]
  // 采集期记录的是身份串；run 入口的 query 变体归一后仍是同一页
  const pageMeta = [meta('https://x.test/home#/index', { title: '工作台 - X 系统', visitedAt: 3 })]
  expect(resolveSiteNames(['x.test'], runs, pageMeta, NO_NAMES).get('x.test'))
    .toEqual({ name: '工作台', source: 'auto' })
})

it('resolveSiteNames: 没有 siteName / run 标题时退到 host 下最新页面标题', () => {
  const runs = [run('r1', 'https://x.test/nope', { startedAt: 5 })]
  const pageMeta = [
    meta('https://x.test/a', { title: '旧页 - 站', visitedAt: 1 }),
    meta('https://x.test/b', { title: '新页 - 站', visitedAt: 8 }),
  ]
  expect(resolveSiteNames(['x.test'], runs, pageMeta, NO_NAMES).get('x.test'))
    .toEqual({ name: '新页', source: 'auto' })
})

it('resolveSiteNames: 没有任何名称来源 → 结果表不含该 host（调用方退回 host）', () => {
  const runs = [run('r1', 'https://x.test/', { startedAt: 5 })]
  expect(resolveSiteNames(['x.test', UNKNOWN_SITE], runs, [], NO_NAMES).size).toBe(0)
  expect(resolveSiteNames(['x.test'], runs, [], NO_NAMES).has('x.test')).toBe(false)
})

it('resolveSiteNames: 空手工名视为没改名，不覆盖自动名', () => {
  const pageMeta = [meta('https://x.test/a', { siteName: '自动站点', visitedAt: 2 })]
  const names: NameMaps = { sites: { 'x.test': '   ' }, pages: {}, interfaces: {} }
  expect(resolveSiteNames(['x.test'], [], pageMeta, names).get('x.test'))
    .toEqual({ name: '自动站点', source: 'auto' })
})

it('resolveSiteNames: 编排已有的站点名（chain）优先于采集标题自动名，来源标 chain', () => {
  const pageMeta = [meta('https://x.test/a', { siteName: '采集到的站名', visitedAt: 5 })]
  const chain = new Map([['x.test', '编排里的站名']])
  expect(resolveSiteNames(['x.test'], [], pageMeta, NO_NAMES, chain).get('x.test'))
    .toEqual({ name: '编排里的站名', source: 'chain' })
})

it('resolveSiteNames: 手工名仍优先于编排名（手工 > chain > auto）', () => {
  const pageMeta = [meta('https://x.test/a', { siteName: '采集到的站名', visitedAt: 5 })]
  const chain = new Map([['x.test', '编排里的站名']])
  const names: NameMaps = { sites: { 'x.test': '手工站名' }, pages: {}, interfaces: {} }
  expect(resolveSiteNames(['x.test'], [], pageMeta, names, chain).get('x.test'))
    .toEqual({ name: '手工站名', source: 'manual' })
})

it('chainSiteNamesOf: 链站点按 hosts 映射为小写 host；同 host 多站点按流程数多者优先', () => {
  const names = chainSiteNamesOf([
    { site: '少流程站', pageFlows: 0, apiFlows: 1, flows: 1, domains: [], hosts: ['A.TEST', 'shared.test'] },
    { site: '多流程站', pageFlows: 0, apiFlows: 4, flows: 4, domains: [], hosts: ['b.test', 'shared.test'] },
  ])
  expect(names.get('a.test')).toBe('少流程站')
  expect(names.get('b.test')).toBe('多流程站')
  expect(names.get('shared.test')).toBe('多流程站')
  expect(names.size).toBe(3)
})

it('resolvePageNames: 手工名 > 页面标题自动名；按页面身份匹配（查询串/hash 变体共享名称）', () => {
  const pageMeta = [
    meta('https://x.test/a#/list', { title: '采购订单列表', visitedAt: 2 }),
    meta('https://x.test/b', { title: '供应商管理', visitedAt: 1 }),
  ]
  const names: NameMaps = { sites: {}, pages: { 'https://x.test/b': '供应商页（手工）' }, interfaces: {} }
  const resolved = resolvePageNames(
    ['https://x.test/a#/list?page=2', 'https://x.test/b', 'https://x.test/unknown'],
    pageMeta,
    names,
  )
  expect(resolved.get('https://x.test/a#/list?page=2')).toEqual({ name: '采购订单列表', source: 'auto' })
  expect(resolved.get('https://x.test/b')).toEqual({ name: '供应商页（手工）', source: 'manual' })
  expect(resolved.has('https://x.test/unknown')).toBe(false)
})

it('resolvePageNames: 同一页面多次采集取最新标题；空标题行不冒充名称', () => {
  const pageMeta = [
    meta('https://x.test/a', { title: '旧标题', visitedAt: 1 }),
    meta('https://x.test/a', { title: '新标题', visitedAt: 9 }),
    meta('https://x.test/b', { title: '   ', visitedAt: 2 }),
  ]
  const resolved = resolvePageNames(['https://x.test/a', 'https://x.test/b'], pageMeta, NO_NAMES)
  expect(resolved.get('https://x.test/a')).toEqual({ name: '新标题', source: 'auto' })
  expect(resolved.has('https://x.test/b')).toBe(false)
})
