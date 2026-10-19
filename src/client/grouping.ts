/**
 * 采集结果分组（纯函数，零 DOM）：页面 → 接口 → 形态。
 *
 * 分组依据是关系行（pageUrl × cardId × 入参指纹）。页面按 {@link pageIdentityOf}
 * 归一后的身份归并——同一 SPA 页面的 hash 路由变体 / 反缓存戳变体是一页；
 * 展示与「重采」用真实访问过的原始页面 URL：新数据从卡上的页面引用取（写的是首次观测值），
 * 历史数据退回关系行里的字面 URL。身份串只做分组键，不直接给用户看。
 *
 * 历史卡没有关系行时归到「未记录页面」兜底组——已经采到的接口不能因为缺关系行就消失。
 *
 * @module dsh-dataforge/client/grouping
 */
import { pageIdentityOf } from '../shared/page-url.js'
import type { CardRow, NameMaps, OrchestrationSite, PageMetaRow, RelationRow, RunRow } from './types.js'

/** 历史卡（无关系行）的兜底页面键。 */
export const UNRECORDED_PAGE = '（未记录页面）'

/** 无法识别 host（URL 非法/非 http(s)）的卡与 run 的兜底站点键。 */
export const UNKNOWN_SITE = '（未识别站点）'

export type GroupedCard = { card: CardRow; relations: RelationRow[] }
/** pageUrl = 该页面身份真实访问过的原始 URL（展示/打开/重采用），不是归一后的身份串。 */
export type GroupedPage = { pageUrl: string; cards: GroupedCard[] }

export function groupByPage(cards: CardRow[], relations: RelationRow[]): GroupedPage[] {
  const cardById = new Map(cards.map((card) => [card.id, card]))
  const order: string[] = []
  // 展示 URL 优先取卡上的页面引用（写入方保留首次观测到的原始 URL）；历史数据/无卡时才退回关系行。
  const displayByKey = new Map<string, string>()
  for (const card of cards) {
    for (const pageUrl of card.relatedPageUrls) {
      const key = pageIdentityOf(pageUrl)
      if (key !== '' && !displayByKey.has(key)) displayByKey.set(key, pageUrl)
    }
  }
  const byPage = new Map<string, { pageUrl: string; byCard: Map<string, RelationRow[]> }>()
  const attach = (rawPageUrl: string, cardId: string, relation: RelationRow | undefined): void => {
    const key = pageIdentityOf(rawPageUrl)
    let group = byPage.get(key)
    if (group === undefined) {
      group = { pageUrl: displayByKey.get(key) ?? rawPageUrl, byCard: new Map<string, RelationRow[]>() }
      byPage.set(key, group)
      order.push(key)
    }
    const bag = group.byCard.get(cardId) ?? []
    if (relation !== undefined) bag.push(relation)
    if (!group.byCard.has(cardId)) group.byCard.set(cardId, bag)
  }
  for (const relation of relations) {
    if (!cardById.has(relation.cardId)) continue // 关系行指向已不存在的卡：跳过而不是报错
    attach(relation.pageUrl, relation.cardId, relation)
  }
  const placed = new Set<string>()
  for (const group of byPage.values()) for (const cardId of group.byCard.keys()) placed.add(cardId)
  for (const card of cards) {
    if (!placed.has(card.id)) attach(UNRECORDED_PAGE, card.id, undefined)
  }
  return order.map((key) => {
    const group = byPage.get(key) ?? { pageUrl: '', byCard: new Map<string, RelationRow[]>() }
    return {
      pageUrl: group.pageUrl,
      cards: [...group.byCard.entries()].flatMap(([cardId, rows]) => {
        const card = cardById.get(cardId)
        return card === undefined ? [] : [{ card, relations: rows }]
      }),
    }
  })
}

/** 卡片在某个页面下的形态数（无关系行时按 1 个形态计）与样本数。 */
export function shapeStats(card: CardRow, relations: RelationRow[]): { shapes: number; samples: number } {
  if (relations.length === 0) return { shapes: 1, samples: card.sampleCount }
  const shapes = new Set(relations.map((relation) => relation.paramsFingerprint))
  const samples = relations.reduce((sum, relation) => sum + relation.sampleCount, 0)
  return { shapes: shapes.size, samples }
}

/** 关系行 → 形态清单（首次出现顺序；同指纹样本数求和），仅在有真关系行时调用。 */
export function shapeEntries(relations: RelationRow[]): Array<{ fp: string; samples: number }> {
  const order: string[] = []
  const samplesByFp = new Map<string, number>()
  for (const relation of relations) {
    const fp = relation.paramsFingerprint
    if (!samplesByFp.has(fp)) {
      samplesByFp.set(fp, 0)
      order.push(fp)
    }
    samplesByFp.set(fp, (samplesByFp.get(fp) ?? 0) + relation.sampleCount)
  }
  return order.map((fp) => ({ fp, samples: samplesByFp.get(fp) ?? 0 }))
}

/**
 * 卡片按页面身份索引（站点页 2 级展开 / 接口库页面节点共用）。
 *
 * 键是 {@link pageIdentityOf} 产出的身份串——同一卡片的多个页面变体只挂一次，
 * 查询用 {@link cardsOnPage}（把展示 URL 再归一一次）。
 */
export function indexCardsByPage(cards: CardRow[]): Map<string, CardRow[]> {
  const index = new Map<string, CardRow[]>()
  for (const card of cards) {
    const seen = new Set<string>()
    for (const pageUrl of card.relatedPageUrls) {
      const key = pageIdentityOf(pageUrl)
      if (key === '' || seen.has(key)) continue
      seen.add(key)
      const bag = index.get(key) ?? []
      bag.push(card)
      index.set(key, bag)
    }
  }
  return index
}

/** 页面（展示 URL）→ 该页的卡；索引口径与 {@link indexCardsByPage} 一致。 */
export function cardsOnPage(index: Map<string, CardRow[]>, pageUrl: string): CardRow[] {
  return index.get(pageIdentityOf(pageUrl)) ?? []
}

/**
 * 页面 URL 清单去重（按页面身份，保留首次出现的原始 URL）。
 *
 * 卡上的 `relatedPageUrls`：新数据是首次观测到的原始 URL，历史数据可能还是同一 SPA
 * 页面的多个字面变体——展示「关联页面」清单与计数前先过这一道。
 */
export function uniquePageUrls(pages: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const page of pages) {
    const key = pageIdentityOf(page)
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    out.push(page)
  }
  return out
}

export type SiteStats = {
  pages: number
  cards: number
  samples: number
  runs: number
  /** 最早一次采集开始时间；无 run 时 undefined（此时只有卡没有采集记录）。 */
  firstAt?: number
  /** 最近一次采集开始时间；无 run 时 undefined（此时只有卡没有采集记录）。 */
  lastAt?: number
}
export type SiteGroup = { host: string; stats: SiteStats; pageUrls: string[] }

/** URL → host（仅 http/https 有意义）；非法或相对地址返回 undefined。 */
export function hostOf(url: string): string | undefined {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
  return parsed.host === '' ? undefined : parsed.host
}

/**
 * 把卡与采集 run 聚合成站点组。
 *
 * 归属规则：卡的站点取其关系页面 URL 的 host（无关系页的历史卡按 captureId
 * 对到该次 run 的 entryUrl host；仍对不上则归「未识别站点」）；run 独立计入
 * 所在站点的采集次数/首末时间，哪怕它一张卡都没出。页面集合 = 各卡页面引用
 * ∪ 各 run entryUrl 的主页面，**按页面身份去重**（pageUrls 保留真实访问过的原始 URL，
 * 新数据取卡上首次观测值；history 字面值原样保留）。
 *
 * SPA 外壳入口不单独成页（仅面板页面清单口径）：run 的 entryUrl 无 hash、而同一 run
 * 的采集页正是 `<entry>#/…`（hash 路由页）时，入口只是外壳——并入路由页，不再多报一个空页面。
 * 工具回执（capture_result pages）与 run.stats.pages 仍是 pages 表的访问记录，不受这条影响。
 */
export function groupSites(cards: CardRow[], runs: RunRow[]): SiteGroup[] {
  const hostByRunId = new Map(runs.map((run) => [run.id, hostOf(run.entryUrl) ?? UNKNOWN_SITE]))
  const groups = new Map<string, { stats: SiteStats; pages: Map<string, string>; seenCards: Set<string> }>()
  const siteOf = (host: string): { stats: SiteStats; pages: Map<string, string>; seenCards: Set<string> } => {
    let site = groups.get(host)
    if (site === undefined) {
      site = { stats: { pages: 0, cards: 0, samples: 0, runs: 0 }, pages: new Map(), seenCards: new Set() }
      groups.set(host, site)
    }
    return site
  }
  const addPage = (site: { pages: Map<string, string> }, rawPageUrl: string): void => {
    const key = pageIdentityOf(rawPageUrl)
    if (key === '' || site.pages.has(key)) return
    site.pages.set(key, rawPageUrl)
  }

  const cardPageKeysByCapture = new Map<string, Set<string>>()
  for (const card of cards) {
    let keys = cardPageKeysByCapture.get(card.captureId)
    if (keys === undefined) {
      keys = new Set<string>()
      cardPageKeysByCapture.set(card.captureId, keys)
    }
    for (const pageUrl of card.relatedPageUrls) keys.add(pageIdentityOf(pageUrl))
  }
  /** run 的入口是否只是 SPA 外壳（同 run 的采集页是它的 hash 路由页）。 */
  const isSpaShell = (run: RunRow): boolean => {
    const entry = pageIdentityOf(run.entryUrl)
    if (entry === '' || entry.includes('#')) return false
    const prefix = `${entry}#`
    for (const key of cardPageKeysByCapture.get(run.id) ?? []) if (key.startsWith(prefix)) return true
    return false
  }

  for (const run of runs) {
    const host = hostByRunId.get(run.id) ?? UNKNOWN_SITE
    const site = siteOf(host)
    if (!isSpaShell(run)) addPage(site, run.entryUrl)
    site.stats.runs += 1
    site.stats.firstAt = site.stats.firstAt === undefined ? run.startedAt : Math.min(site.stats.firstAt, run.startedAt)
    site.stats.lastAt = site.stats.lastAt === undefined ? run.startedAt : Math.max(site.stats.lastAt, run.startedAt)
  }

  for (const card of cards) {
    const host =
      card.relatedPageUrls.map(hostOf).find((found) => found !== undefined) ??
      hostByRunId.get(card.captureId) ??
      UNKNOWN_SITE
    const site = siteOf(host)
    if (site.seenCards.has(card.id)) continue
    site.seenCards.add(card.id)
    site.stats.cards += 1
    site.stats.samples += card.sampleCount
    for (const pageUrl of card.relatedPageUrls) if (hostOf(pageUrl) === host) addPage(site, pageUrl)
  }

  for (const site of groups.values()) site.stats.pages = site.pages.size
  const unrecorded = groups.get(UNKNOWN_SITE)
  const ordered = [...groups.entries()]
    .filter(([host]) => host !== UNKNOWN_SITE)
    .map(([host, site]) => ({ host, stats: site.stats, pageUrls: [...site.pages.values()] }))
    .sort((left, right) => (right.stats.lastAt ?? Number.NaN) - (left.stats.lastAt ?? Number.NaN))
  if (unrecorded !== undefined) {
    ordered.push({ host: UNKNOWN_SITE, stats: unrecorded.stats, pageUrls: [...unrecorded.pages.values()] })
  }
  return ordered
}

/* ───────────────────────── 三级名称（网站 / 页面 / 接口） ───────────────────────── */

/**
 * 名称来源：
 *   - manual = 面板手工改名（最高优先；接口改名的持久化覆盖）；
 *   - chain  = 编排里已有的站点名（链 `meta.site`，经 chain 引用页面 host 映射过来）——
 *              编排页与采集/接口库页因此显示同一个网站名，不要求先补抓标题；
 *   - auto   = 采集标题推断（显示「自动取名」小标）。
 */
export type NameSource = 'auto' | 'manual' | 'chain'
export type ResolvedName = { name: string; source: NameSource }

/** 标题分隔符：页面标题惯例是「页面名 - 站点名」（原型与真实站点都这么做）。 */
const TITLE_SEPARATOR = /[-|—·–_丨]/
/** 第一段仍过长（>24）时才按逗号再截；截后仍 >30 视为不可用。 */
const TITLE_SEGMENT_MAX = 24
const TITLE_LABEL_MAX = 30

/**
 * 页面标题 → 站点名候选。
 *
 * 按分隔符取第一段（`采购订单列表 - 智慧供应链 SCM` → `采购订单列表`），
 * 第一段仍过长再按 `，` / `,` 截断；trim 后为空或超过 30 字符返回 undefined（宁缺勿滥：
 * 宁可不显示自动名，也不能把整句标题塞进站点卡）。
 */
export function siteLabelFromTitle(title: string | undefined): string | undefined {
  if (title === undefined) return undefined
  const segments = title.trim().split(TITLE_SEPARATOR)
  let label = ''
  for (const segment of segments) {
    const trimmed = segment.trim()
    if (trimmed !== '') {
      label = trimmed
      break
    }
  }
  if (label.length > TITLE_SEGMENT_MAX) label = (label.split(/[，,]/)[0] ?? '').trim()
  if (label.length === 0 || label.length > TITLE_LABEL_MAX) return undefined
  return label
}

/** 手工名映射取值：空串/空白视为没改过名（服务端删除覆盖后不应残留空名）。 */
function manualName(map: Record<string, string> | undefined, key: string): string | undefined {
  const name = map?.[key]?.trim()
  return name === undefined || name === '' ? undefined : name
}

/**
 * 编排站点名 → host（`chainSiteNamesOf`）。
 *
 * 编排里网站本来就有名称（链 `meta.site`，如「百度网盘」）；把 overview 的
 * `site × hosts` 投影成 `host → 站点名`，采集网站/接口库就能直接复用同一个名字，
 * 不必等补抓标题。同一 host 被多个链站点引用时按流程数多者优先（确定性）。
 */
export function chainSiteNamesOf(sites: readonly OrchestrationSite[]): Map<string, string> {
  const ordered = [...sites].sort((left, right) => {
    if (right.flows !== left.flows) return right.flows - left.flows
    return left.site.localeCompare(right.site, 'zh-Hans-CN')
  })
  const names = new Map<string, string>()
  for (const site of ordered) {
    const name = site.site.trim()
    if (name === '') continue
    for (const host of site.hosts) {
      const key = host.trim().toLowerCase()
      if (key !== '' && !names.has(key)) names.set(key, name)
    }
  }
  return names
}

/** pageMeta 归类用：行里的 url 已是归一身份，再归一一次是幂等的（非 http 原样返回）。 */
function metaIdentity(row: PageMetaRow): string {
  return pageIdentityOf(row.url)
}

/** 每个页面身份 → 最新一次带 title 的元数据行（后写覆盖先写，但只有带标题的行才有意义）。 */
function latestTitledByPage(pageMeta: readonly PageMetaRow[]): Map<string, PageMetaRow> {
  const map = new Map<string, PageMetaRow>()
  for (const row of pageMeta) {
    if (row.title === undefined || row.title.trim() === '') continue
    const key = metaIdentity(row)
    const prev = map.get(key)
    if (prev === undefined || row.visitedAt >= prev.visitedAt) map.set(key, row)
  }
  return map
}

/**
 * 解析站点名（手工名 > 编排名 > 自动名 > 无）。
 *
 * `sites` = groupSites 产出的 host 清单（解析结果按 host 索引）。
 * `chainSiteNames` = 编排里已有的站点名（host → 链 `meta.site`）：编排页与采集/接口库
 * 因此显示同一个网站名，不用等「补抓名称」。自动名依次退让：
 *   1. 该 host 下最新一次采集记录的 og:site_name；
 *   2. 该 host 最近一次采集 run 的 entryUrl 对应页面的标题（经 siteLabelFromTitle 清洗）；
 *   3. 该 host 下最新页面的标题（同上清洗）。
 * 都拿不到就不放进结果表 —— 调用方退回 host 展示。
 */
export function resolveSiteNames(
  sites: readonly string[],
  runs: readonly RunRow[],
  pageMeta: readonly PageMetaRow[],
  names: NameMaps,
  chainSiteNames?: ReadonlyMap<string, string>,
): Map<string, ResolvedName> {
  const titledByPage = latestTitledByPage(pageMeta)
  /** host → 最新带 siteName 的元数据行。 */
  const siteNameByHost = new Map<string, { siteName: string; visitedAt: number }>()
  for (const row of pageMeta) {
    const siteName = row.siteName?.trim()
    if (siteName === undefined || siteName === '') continue
    const host = hostOf(metaIdentity(row))
    if (host === undefined) continue
    const prev = siteNameByHost.get(host)
    if (prev === undefined || row.visitedAt >= prev.visitedAt) siteNameByHost.set(host, { siteName, visitedAt: row.visitedAt })
  }
  /** host → 最近一次采集 run（entryUrl 能解析出该 host 的）。 */
  const latestRunByHost = new Map<string, RunRow>()
  for (const run of runs) {
    const host = hostOf(run.entryUrl)
    if (host === undefined) continue
    const prev = latestRunByHost.get(host)
    if (prev === undefined || run.startedAt >= prev.startedAt) latestRunByHost.set(host, run)
  }
  /** host → 最新一处带标题的页面元数据行。 */
  const latestPageByHost = new Map<string, { title: string; visitedAt: number }>()
  for (const row of pageMeta) {
    const title = row.title?.trim()
    if (title === undefined || title === '') continue
    const host = hostOf(metaIdentity(row))
    if (host === undefined) continue
    const prev = latestPageByHost.get(host)
    if (prev === undefined || row.visitedAt >= prev.visitedAt) latestPageByHost.set(host, { title, visitedAt: row.visitedAt })
  }

  const resolved = new Map<string, ResolvedName>()
  for (const host of sites) {
    const manual = manualName(names.sites, host.toLowerCase())
    if (manual !== undefined) {
      resolved.set(host, { name: manual, source: 'manual' })
      continue
    }
    const fromChain = chainSiteNames?.get(host.toLowerCase())?.trim()
    if (fromChain !== undefined && fromChain !== '') {
      resolved.set(host, { name: fromChain, source: 'chain' })
      continue
    }
    const siteName = siteNameByHost.get(host)?.siteName
    if (siteName !== undefined) {
      resolved.set(host, { name: siteName, source: 'auto' })
      continue
    }
    const run = latestRunByHost.get(host)
    if (run !== undefined) {
      const label = siteLabelFromTitle(titledByPage.get(pageIdentityOf(run.entryUrl))?.title)
      if (label !== undefined) {
        resolved.set(host, { name: label, source: 'auto' })
        continue
      }
    }
    const label = siteLabelFromTitle(latestPageByHost.get(host)?.title)
    if (label !== undefined) resolved.set(host, { name: label, source: 'auto' })
  }
  return resolved
}

/**
 * 解析页面名（手工名 > 自动名 > 无）：结果按**传入的原始 URL** 索引（展示/打开用原值），
 * 匹配则走 `pageIdentityOf`（同一 SPA 页面的 hash/反缓存戳变体共享一个名称）。
 */
export function resolvePageNames(
  pageUrls: readonly string[],
  pageMeta: readonly PageMetaRow[],
  names: NameMaps,
): Map<string, ResolvedName> {
  const titledByPage = latestTitledByPage(pageMeta)
  const resolved = new Map<string, ResolvedName>()
  for (const pageUrl of pageUrls) {
    const identity = pageIdentityOf(pageUrl)
    const manual = manualName(names.pages, identity)
    if (manual !== undefined) {
      resolved.set(pageUrl, { name: manual, source: 'manual' })
      continue
    }
    const title = titledByPage.get(identity)?.title?.trim()
    if (title !== undefined && title !== '') resolved.set(pageUrl, { name: title, source: 'auto' })
  }
  return resolved
}
