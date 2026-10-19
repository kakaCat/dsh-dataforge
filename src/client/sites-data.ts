/**
 * 站点聚合数据面（React hook）：采集网站页与接口库页共用。
 *
 * 现有路由没有站点聚合端点：/cards 分页拉满（上限 SITES_MAX_AGGREGATE_CARDS，超额照实
 * 标注 truncated，不谎称全量）+ /runs 单请求（SITES_MAX_RUNS）→ grouping.groupSites 纯函数。
 * 名称数据（/page-meta、/names）是**新增接口**：旧服务端没有这两条路由，取数失败一律
 * 降级成空集合（名称退回 host/URL），绝不让整页进 error 态。站点名还会复用编排里已有的
 * 站点名（编排 overview 的 site → hosts 投影）：编排页与采集/接口库因此显示同一个网站名，
 * 不必等「补抓名称」。15 秒轮询只在 visible 时发生；reload 供手动刷新 / 补抓名称收口后重取。
 *
 * @module dsh-dataforge/client/sites-data
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  PanelApiError, fetchCards, fetchNames, fetchOrchestrationOverview, fetchPageMeta, fetchRetitleStatus,
  fetchRuns, startRetitle,
} from './api.js'
import { REFRESH_MS, SITES_MAX_AGGREGATE_CARDS, SITES_MAX_RUNS } from './dom.js'
import {
  chainSiteNamesOf, groupSites, indexCardsByPage, resolvePageNames, resolveSiteNames,
  type ResolvedName, type SiteGroup,
} from './grouping.js'
import type {
  CardRow, NameMaps, OrchestrationSite, PageMetaRow, RetitleStartResult, RetitleStatus, RunRow,
} from './types.js'

function errText(err: unknown): string {
  return (err as Error)?.message ?? String(err)
}

/** 名称数据不可用时的空表（旧服务端 / 新接口 404）。 */
export const EMPTY_NAME_MAPS: NameMaps = { sites: {}, pages: {}, interfaces: {} }

/** 补抓名称的轮询间隔（与采集页 CAPTURE_POLL_MS 分开：补抓是短任务，快一点收口）。 */
export const BACKFILL_POLL_MS = 1_500

export type SiteAggregate = {
  cards: CardRow[]
  runs: RunRow[]
  sites: SiteGroup[]
  truncated: boolean
  /** 采集时记录的页面元数据（/page-meta 不可用时为空数组）。 */
  pageMeta: PageMetaRow[]
  /** 手工名称覆盖（/names 不可用时为空表）。 */
  names: NameMaps
  /** 编排里已有的站点名（host → 链 meta.site；overview 不可用时为空表）。 */
  chainSiteNames: ReadonlyMap<string, string>
  /** 名称接口是否可用（false = 宿主服务端未更新：补抓按钮给提示，名称退回 host/URL）。 */
  namesAvailable: boolean
}

export type AggregateSites = {
  aggregate: SiteAggregate | undefined
  cardsByPage: Map<string, CardRow[]>
  error: string | undefined
  lastSync: string
  reload: () => void
  /** 页面标题元数据（/page-meta 降级时为空数组）。 */
  pageMeta: PageMetaRow[]
  /** 手工名称覆盖（/names 降级时为空表）。 */
  names: NameMaps
  /** host → 站点名（手工 > 编排名 > 自动；无名称的 host 不在表里）。 */
  siteNames: Map<string, ResolvedName>
  /** 页面原始 URL → 页面名（手工 > 自动；无名称的页面不在表里）。 */
  pageNames: Map<string, ResolvedName>
  /** 名称接口是否可用（false = 服务端未更新：名称退回 host/URL，补抓按钮给提示）。 */
  namesAvailable: boolean
}

export function useAggregateSites(visible: boolean): AggregateSites {
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
      // 名称数据与 runs 并行取：名称接口不可用时只是「没有名称」，不能拖垮数据面。
      // /runs 失败仍按既有 error 三态处理（Promise.all 会 reject）；编排 overview 只用于
      // 复用已有站点名，失败（旧服务端/无工作区/无链）一律当空表降级。
      const [runsResult, metaResult, namesResult, overviewResult] = await Promise.all([
        fetchRuns(SITES_MAX_RUNS),
        fetchPageMeta().then(
          (value) => ({ ok: true as const, pages: value?.pages ?? [] }),
          () => ({ ok: false as const, pages: [] as PageMetaRow[] }),
        ),
        fetchNames().then(
          (value) => ({
            ok: true as const,
            names: {
              sites: value?.sites ?? {},
              pages: value?.pages ?? {},
              interfaces: value?.interfaces ?? {},
            } satisfies NameMaps,
          }),
          () => ({ ok: false as const, names: EMPTY_NAME_MAPS }),
        ),
        fetchOrchestrationOverview().then(
          (value) => value?.sites ?? [],
          () => [] as OrchestrationSite[],
        ),
      ])
      const { runs } = runsResult
      setAggregate({
        cards,
        runs,
        sites: groupSites(cards, runs),
        truncated: total > cards.length,
        pageMeta: metaResult.pages,
        names: namesResult.names,
        chainSiteNames: chainSiteNamesOf(overviewResult),
        // 只有两条名称接口都通，才算「名称能力可用」：补抓依赖服务端同时具备读写。
        namesAvailable: metaResult.ok && namesResult.ok,
      })
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

  const siteNames = useMemo(() => {
    if (aggregate === undefined) return new Map<string, ResolvedName>()
    return resolveSiteNames(
      aggregate.sites.map((site) => site.host),
      aggregate.runs,
      aggregate.pageMeta,
      aggregate.names,
      aggregate.chainSiteNames,
    )
  }, [aggregate])

  const pageNames = useMemo(() => {
    if (aggregate === undefined) return new Map<string, ResolvedName>()
    return resolvePageNames(
      aggregate.sites.flatMap((site) => site.pageUrls),
      aggregate.pageMeta,
      aggregate.names,
    )
  }, [aggregate])

  return {
    aggregate,
    cardsByPage,
    error,
    lastSync,
    reload: () => { setReloadTick((tick) => tick + 1) },
    pageMeta: aggregate?.pageMeta ?? [],
    names: aggregate?.names ?? EMPTY_NAME_MAPS,
    siteNames,
    pageNames,
    namesAvailable: aggregate?.namesAvailable ?? true,
  }
}

/* ───────────────────────── 补抓名称（/retitle） ───────────────────────── */

export type TitleBackfill = {
  /** 发起补抓（accepted 后每 1.5 秒轮询；失败/被拒给中文提示，不抛）。 */
  start: () => void
  busy: boolean
  status: RetitleStatus | undefined
  /** 结果/被拒/失败/进度文案；undefined = 还没发起过。 */
  notice: string | undefined
}

const RETITLE_REJECT_TEXT: Record<string, string> = {
  busy: '已有补抓在跑，等这次完成再试。',
  'no-targets': '没有缺名称的页面，无需补抓。',
  'capture-running': '有采集在跑，等采集收口后再补抓。',
}

/** 补抓接口在旧服务端上是 404/405：要说「重启后可用」，不能说数据坏了。 */
function backfillErrorText(err: unknown): string {
  if (err instanceof PanelApiError && (err.status === 404 || err.status === 405)) {
    return '服务端未更新（补抓接口不可用）：重启宿主服务后可用。'
  }
  return `补抓失败：${errText(err)}`
}

function retitleResultText(status: RetitleStatus): string {
  if (status.error !== undefined && status.error.length > 0) {
    return `补抓结束（有错误）：${status.error}（已更新 ${status.updated} 个名称，失败 ${status.failed} 个）`
  }
  const failed = status.failed > 0 ? `，失败 ${status.failed} 个` : ''
  const skipped = status.skipped > 0 ? `，跳过 ${status.skipped} 个` : ''
  return `补抓完成：更新 ${status.updated} 个名称${failed}${skipped}。`
}

/**
 * 补抓名称：POST /retitle 发起 → 每 1.5 秒轮询 /retitle/status → running=false 收口后
 * 调 `onDone`（调用方通常传 reload 重新取数）+ 给一句结果文案。
 *
 * `serverReady` 来自 /page-meta + /names 的可用性：旧服务端上按钮给提示而不是打无效请求。
 */
export function useTitleBackfill(onDone: () => void, serverReady = true): TitleBackfill {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<RetitleStatus | undefined>()
  const [notice, setNotice] = useState<string | undefined>()

  const doneRef = useRef(onDone)
  doneRef.current = onDone
  const readyRef = useRef(serverReady)
  readyRef.current = serverReady
  const busyRef = useRef(false)
  const aliveRef = useRef(true)
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      if (timerRef.current !== undefined) clearInterval(timerRef.current)
      timerRef.current = undefined
    }
  }, [])

  const stopPoll = (): void => {
    if (timerRef.current !== undefined) clearInterval(timerRef.current)
    timerRef.current = undefined
  }

  const finish = (final: RetitleStatus): void => {
    stopPoll()
    if (!aliveRef.current) return
    busyRef.current = false
    setBusy(false)
    setStatus(final)
    setNotice(retitleResultText(final))
    doneRef.current()
  }

  const start = (): void => {
    if (busyRef.current) return
    if (!readyRef.current) {
      setNotice('服务端未更新（名称接口不可用）：重启宿主服务后可用。')
      return
    }
    busyRef.current = true
    setBusy(true)
    setStatus(undefined)
    setNotice(undefined)
    void (async () => {
      let started: RetitleStartResult
      try {
        started = await startRetitle()
      } catch (err) {
        if (!aliveRef.current) return
        busyRef.current = false
        setBusy(false)
        setNotice(backfillErrorText(err))
        return
      }
      if (!aliveRef.current) return
      if (!started.accepted) {
        busyRef.current = false
        setBusy(false)
        setNotice(RETITLE_REJECT_TEXT[started.reason ?? ''] ?? '没有发起补抓（服务端未接受）。')
        return
      }
      setNotice(`已发起：补抓 ${started.targets} 个页面的名称…`)
      const poll = async (): Promise<void> => {
        if (!aliveRef.current) return
        let current: RetitleStatus
        try {
          current = await fetchRetitleStatus()
        } catch (err) {
          stopPoll()
          if (!aliveRef.current) return
          busyRef.current = false
          setBusy(false)
          setNotice(backfillErrorText(err))
          return
        }
        if (!aliveRef.current) return
        setStatus(current)
        if (!current.running) {
          finish(current)
          return
        }
        setNotice(
          `补抓中：已试 ${current.tried}/${current.targets}，更新 ${current.updated}`
          + (current.failed > 0 ? `，失败 ${current.failed}` : ''),
        )
      }
      timerRef.current = setInterval(() => { void poll() }, BACKFILL_POLL_MS)
      void poll()
    })()
  }

  return { start, busy, status, notice }
}

/**
 * 补抓状态行文案（两个页面共用）：结果 > 进度 > 「名称接口未就绪」提示。
 * undefined = 不显示状态行。
 */
export function backfillStatusText(backfill: TitleBackfill, namesAvailable: boolean): string | undefined {
  if (backfill.notice !== undefined) return backfill.notice
  if (backfill.busy) {
    const status = backfill.status
    if (status === undefined) return '正在发起补抓…'
    return `补抓中：已试 ${status.tried}/${status.targets}，更新 ${status.updated}`
      + (status.failed > 0 ? `，失败 ${status.failed}` : '')
  }
  if (!namesAvailable) return '名称接口未就绪（重启宿主服务后可用）：名称暂时退回 host / URL。'
  return undefined
}
