/**
 * 站点聚合数据面（React hook）：采集网站页与接口库页共用。
 *
 * 现有路由没有站点聚合端点：/cards 分页拉满（上限 SITES_MAX_AGGREGATE_CARDS，超额照实
 * 标注 truncated，不谎称全量）+ /runs 单请求（SITES_MAX_RUNS）→ grouping.groupSites 纯函数。
 * 15 秒轮询只在 visible 时发生；reload 供手动刷新。
 *
 * @module dsh-dataforge/client/sites-data
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchCards, fetchRuns } from './api.js'
import { REFRESH_MS, SITES_MAX_AGGREGATE_CARDS, SITES_MAX_RUNS } from './dom.js'
import { groupSites, indexCardsByPage, type SiteGroup } from './grouping.js'
import type { CardRow, RunRow } from './types.js'

function errText(err: unknown): string {
  return (err as Error)?.message ?? String(err)
}

export type SiteAggregate = {
  cards: CardRow[]
  runs: RunRow[]
  sites: SiteGroup[]
  truncated: boolean
}

export function useAggregateSites(visible: boolean): {
  aggregate: SiteAggregate | undefined
  cardsByPage: Map<string, CardRow[]>
  error: string | undefined
  lastSync: string
  reload: () => void
} {
  const [aggregate, setAggregate] = useState<SiteAggregate | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [lastSync, setLastSync] = useState('')
  const [reloadTick, setReloadTick] = useState(0)

  const visibleRef = useMemo(() => ({ current: visible }), [])
  visibleRef.current = visible

  const loadRef = useRef<(() => Promise<void>) | undefined>(undefined)
  loadRef.current = async (): Promise<void> => {
    try {
      const pageSize = 500
      let cards: CardRow[] = []
      let total = 0
      do {
        const batch = await fetchCards(pageSize, cards.length)
        total = batch.total
        cards = cards.concat(batch.cards)
      } while (cards.length < total && cards.length < SITES_MAX_AGGREGATE_CARDS)
      const { runs } = await fetchRuns(SITES_MAX_RUNS)
      setAggregate({ cards, runs, sites: groupSites(cards, runs), truncated: total > cards.length })
      setError(undefined)
      setLastSync(`刷新于 ${new Date().toLocaleTimeString()}`)
    } catch (err) {
      setAggregate(undefined)
      setError(errText(err))
    }
  }

  useEffect(() => {
    if (!visible) return
    void loadRef.current?.()
  }, [visible, reloadTick])

  useEffect(() => {
    const timer = setInterval(() => {
      if (!visibleRef.current) return
      void loadRef.current?.()
    }, REFRESH_MS)
    return () => { clearInterval(timer) }
  }, [visibleRef])

  const cardsByPage = useMemo(
    () => (aggregate === undefined ? new Map<string, CardRow[]>() : indexCardsByPage(aggregate.cards)),
    [aggregate],
  )

  return { aggregate, cardsByPage, error, lastSync, reload: () => { setReloadTick((tick) => tick + 1) } }
}
