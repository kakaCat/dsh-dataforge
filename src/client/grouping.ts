/**
 * 采集结果分组（纯函数，零 DOM）：页面 → 接口 → 形态。
 *
 * 分组依据是关系行（pageUrl × cardId × 入参指纹）。历史卡没有关系行时归到
 * 「未记录页面」兜底组——已经采到的接口不能因为缺关系行就消失。
 *
 * @module dsh-dataforge/client/grouping
 */
import type { CardRow, RelationRow, RunRow } from './types.js'

/** 历史卡（无关系行）的兜底页面键。 */
export const UNRECORDED_PAGE = '（未记录页面）'

/** 无法识别 host（URL 非法/非 http(s)）的卡与 run 的兜底站点键。 */
export const UNKNOWN_SITE = '（未识别站点）'

export type GroupedCard = { card: CardRow; relations: RelationRow[] }
export type GroupedPage = { pageUrl: string; cards: GroupedCard[] }

export function groupByPage(cards: CardRow[], relations: RelationRow[]): GroupedPage[] {
  const cardById = new Map(cards.map((card) => [card.id, card]))
  const order: string[] = []
  const byPage = new Map<string, Map<string, RelationRow[]>>()
  const attach = (pageUrl: string, cardId: string, relation: RelationRow | undefined): void => {
    let byCard = byPage.get(pageUrl)
    if (byCard === undefined) {
      byCard = new Map<string, RelationRow[]>()
      byPage.set(pageUrl, byCard)
      order.push(pageUrl)
    }
    const bag = byCard.get(cardId) ?? []
    if (relation !== undefined) bag.push(relation)
    if (!byCard.has(cardId)) byCard.set(cardId, bag)
  }
  for (const relation of relations) {
    if (!cardById.has(relation.cardId)) continue // 关系行指向已不存在的卡：跳过而不是报错
    attach(relation.pageUrl, relation.cardId, relation)
  }
  const placed = new Set<string>()
  for (const byCard of byPage.values()) for (const cardId of byCard.keys()) placed.add(cardId)
  for (const card of cards) {
    if (!placed.has(card.id)) attach(UNRECORDED_PAGE, card.id, undefined)
  }
  return order.map((pageUrl) => {
    const byCard = byPage.get(pageUrl) ?? new Map<string, RelationRow[]>()
    return {
      pageUrl,
      cards: [...byCard.entries()].flatMap(([cardId, rows]) => {
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

/** 卡片按页面 URL 索引（站点页 2 级展开 / 接口库页面节点共用）。 */
export function indexCardsByPage(cards: CardRow[]): Map<string, CardRow[]> {
  const index = new Map<string, CardRow[]>()
  for (const card of cards) {
    for (const pageUrl of card.relatedPageUrls) {
      const bag = index.get(pageUrl) ?? []
      bag.push(card)
      index.set(pageUrl, bag)
    }
  }
  return index
}

export type SiteStats = {
  pages: number
  cards: number
  samples: number
  runs: number
  /** 最早一次采集开始时间；无 run 时 undefined（此时只有卡没有采集记录）。 */
  firstAt?: number
  /** 最近一次采集开始时间；无 run 时 undefined。 */
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
 * 所在站点的采集次数/首末时间，哪怕它一张卡都没出。页面集合 = 各卡关系页
 * ∪ 各 run entryUrl 的主页面。
 */
export function groupSites(cards: CardRow[], runs: RunRow[]): SiteGroup[] {
  const hostByRunId = new Map(runs.map((run) => [run.id, hostOf(run.entryUrl) ?? UNKNOWN_SITE]))
  const groups = new Map<string, { stats: SiteStats; pages: Set<string>; seenCards: Set<string> }>()
  const siteOf = (host: string): { stats: SiteStats; pages: Set<string>; seenCards: Set<string> } => {
    let site = groups.get(host)
    if (site === undefined) {
      site = { stats: { pages: 0, cards: 0, samples: 0, runs: 0 }, pages: new Set(), seenCards: new Set() }
      groups.set(host, site)
    }
    return site
  }

  for (const run of runs) {
    const host = hostByRunId.get(run.id) ?? UNKNOWN_SITE
    const site = siteOf(host)
    site.pages.add(run.entryUrl)
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
    for (const pageUrl of card.relatedPageUrls) if (hostOf(pageUrl) === host) site.pages.add(pageUrl)
  }

  for (const site of groups.values()) site.stats.pages = site.pages.size
  const unrecorded = groups.get(UNKNOWN_SITE)
  const ordered = [...groups.entries()]
    .filter(([host]) => host !== UNKNOWN_SITE)
    .map(([host, site]) => ({ host, stats: site.stats, pageUrls: [...site.pages] }))
    .sort((left, right) => (right.stats.lastAt ?? Number.NaN) - (left.stats.lastAt ?? Number.NaN))
  if (unrecorded !== undefined) {
    ordered.push({ host: UNKNOWN_SITE, stats: unrecorded.stats, pageUrls: [...unrecorded.pages] })
  }
  return ordered
}
