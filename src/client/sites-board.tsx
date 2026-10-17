/**
 * 采集网站页（原型 docs/prototypes/sites.html）—— 站点级档案：搜索/排序工具条 +
 * site 文章级展开（时间行 + 页面 rail 的 pgcard：接口 → / 重采）+ 空态 + 分页条 + 图例。
 *
 * 数据面：无站点聚合端点 —— /cards 拉满（上限内）+ /runs → groupSites（site-data.ts）。
 * 呈现纪律：诚实三态、用户数据只进 JSX 文本节点、零 dangerouslySetInnerHTML。
 *
 * @module dsh-dataforge/client/sites-board
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Legend } from './card-parts.js'
import { SITES_MAX_AGGREGATE_CARDS } from './dom.js'
import { fmtShort } from './el.js'
import { UNKNOWN_SITE, type SiteGroup } from './grouping.js'
import type { CardRow } from './types.js'
import { useAggregateSites } from './sites-data.js'

export interface SitesBoardPageProps {
  visible: boolean
  /** 页面级「重采」：交给总组件切到快速采集页并预填 URL。 */
  onRecapture?: (url: string) => void
  /** pgcard「接口 →」：交给总组件切到接口库并直接进入该站点视图。 */
  onOpenInLibrary?: (host: string) => void
}

type SortKey = 'recent' | 'cards' | 'name'

const SORT_OPTIONS: ReadonlyArray<{ key: SortKey; label: string }> = [
  { key: 'recent', label: '最近采集' },
  { key: 'cards', label: '接口最多' },
  { key: 'name', label: '站点名' },
]

const SITES_PER_PAGE = 10

export function SitesBoardPage({ visible, onRecapture, onOpenInLibrary }: SitesBoardPageProps): ReactNode {
  const { aggregate, cardsByPage, error, lastSync, reload } = useAggregateSites(visible)
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('recent')
  const [expandAll, setExpandAll] = useState(false)
  const [expandedHosts, setExpandedHosts] = useState<ReadonlySet<string>>(new Set())
  const [page, setPage] = useState(0)

  const shownSites = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const matched = (aggregate?.sites ?? []).filter((site) => {
      if (needle.length === 0) return true
      return site.host.toLowerCase().includes(needle)
        || site.pageUrls.some((pageUrl) => pageUrl.toLowerCase().includes(needle))
    })
    if (sortKey === 'recent') return matched
    const sorted = [...matched].sort((left, right) => {
      if (sortKey === 'cards') return right.stats.cards - left.stats.cards
      return left.host.localeCompare(right.host)
    })
    const unknown = sorted.find((site) => site.host === UNKNOWN_SITE)
    return unknown === undefined ? sorted : [...sorted.filter((site) => site.host !== UNKNOWN_SITE), unknown]
  }, [aggregate, query, sortKey])

  const totalPages = Math.max(1, Math.ceil(shownSites.length / SITES_PER_PAGE))
  const effectivePage = Math.min(page, totalPages - 1)
  const pageSites = shownSites.slice(effectivePage * SITES_PER_PAGE, (effectivePage + 1) * SITES_PER_PAGE)

  const toggleSite = (host: string): void => {
    setExpandedHosts((prev) => {
      const next = new Set(prev)
      if (next.has(host)) next.delete(host)
      else next.add(host)
      return next
    })
  }

  return (
    <div className="dsh-df-page">
      <div className="dsh-df-head">
        <div>
          <h2>采集网站</h2>
          <p className="dsh-df-sub">按站点看已采过的页面与接口；15 秒自动刷新</p>
        </div>
        <div className="dsh-df-sync">
          <span className="dsh-df-last">{lastSync}</span>
          <button className="dsh-df-btn-ghost" type="button" onClick={reload}>刷新</button>
        </div>
      </div>
      <div className="dsh-df-toolbar">
        <input
          className="dsh-df-search"
          type="search"
          placeholder="搜索站点或页面 URL"
          spellCheck={false}
          value={query}
          onChange={(event) => { setQuery(event.target.value) }}
        />
        <select className="dsh-df-select" value={sortKey} onChange={(event) => { setSortKey(event.target.value as SortKey) }}>
          {SORT_OPTIONS.map((option) => (
            <option key={option.key} value={option.key}>{option.label}</option>
          ))}
        </select>
        <button
          className="dsh-df-btn-ghost"
          type="button"
          disabled={aggregate === undefined || shownSites.length === 0}
          onClick={() => { setExpandAll((value) => !value) }}
        >
          {expandAll === false ? '全部展开' : '全部收起'}
        </button>
      </div>
      {aggregate?.truncated === true && (
        <div className="dsh-df-note" style={{ marginBottom: 12 }}>
          {`接口卡超过 ${SITES_MAX_AGGREGATE_CARDS} 张：本页仅按最近 ${SITES_MAX_AGGREGATE_CARDS} 张卡聚合，站点清单可能不全。`}
        </div>
      )}
      {error !== undefined && (
        <div className="dsh-df-empty">{`取数失败：${error} —— 点「刷新」重试。`}</div>
      )}
      {error === undefined && aggregate === undefined && (
        <div className="dsh-df-state">加载中…</div>
      )}
      {error === undefined && aggregate !== undefined && shownSites.length === 0 && (
        <div className="dsh-df-empty">
          <b>还没有可展示的站点</b>——先用快速采集或 agent 会话采一次接口。
        </div>
      )}
      {error === undefined && pageSites.map((site) => (
        <SiteItem
          key={site.host}
          site={site}
          byPage={cardsByPage}
          shown={expandAll || expandedHosts.has(site.host)}
          onRecapture={onRecapture}
          onOpenInLibrary={onOpenInLibrary}
          onToggle={() => { toggleSite(site.host) }}
        />
      ))}
      {error === undefined && aggregate !== undefined && shownSites.length > 0 && (
        <div className="dsh-df-pagerbar">
          <span>{`共 ${shownSites.length} 站点 · ${aggregate.cards.length} 接口卡`}</span>
          {totalPages > 1 && (
            <span className="dsh-df-pages">
              <button
                className="dsh-df-pg"
                type="button"
                disabled={effectivePage <= 0}
                onClick={() => { setPage(effectivePage - 1) }}
              >
                ‹
              </button>
              {Array.from({ length: totalPages }, (_, index) => (
                <button
                  className="dsh-df-pg"
                  key={index}
                  type="button"
                  aria-current={index === effectivePage}
                  onClick={() => { setPage(index) }}
                >
                  {index + 1}
                </button>
              ))}
              <button
                className="dsh-df-pg"
                type="button"
                disabled={effectivePage >= totalPages - 1}
                onClick={() => { setPage(effectivePage + 1) }}
              >
                ›
              </button>
            </span>
          )}
        </div>
      )}
      <Legend
        entries={[
          { level: 1, label: '网站' },
          { level: 2, label: '页面' },
          { level: 3, label: '接口' },
        ]}
      />
    </div>
  )
}

function SiteItem({ site, byPage, shown, onRecapture, onOpenInLibrary, onToggle }: {
  site: SiteGroup
  byPage: Map<string, CardRow[]> | undefined
  shown: boolean
  onRecapture?: (url: string) => void
  onOpenInLibrary?: (host: string) => void
  onToggle: () => void
}): ReactNode {
  const stats = site.stats
  return (
    <article className={`dsh-df-site${shown ? '' : ' dsh-df-collapsed'}`}>
      <button className="dsh-df-site-header" type="button" onClick={onToggle}>
        <span className="dsh-df-lv dsh-df-lv1">网站</span>
        <span className="dsh-df-site-name">{site.host}</span>
        <span className="dsh-df-stats">
          <span>页面 <b>{stats.pages}</b></span>
          <span>接口 <b>{stats.cards}</b></span>
          <span>样本 <b>{stats.samples}</b></span>
          <span>采集 <b>{stats.runs}</b> 次</span>
        </span>
        <span className="dsh-df-caret">▾</span>
      </button>
      {shown && (
        <>
          <div className="dsh-df-time-row">
            <span>{stats.firstAt === undefined ? '没有采集记录（历史卡）' : `首次 ${fmtShort(stats.firstAt)}`}</span>
            {stats.lastAt !== undefined && <span>{`最近 ${fmtShort(stats.lastAt)}`}</span>}
          </div>
          <div className="dsh-df-site-body">
            {site.host === UNKNOWN_SITE && (
              <p className="dsh-df-sub" style={{ margin: '0 0 10px' }}>
                这批接口卡（或采集 run）的 URL 无法解析出 host。
              </p>
            )}
            <h3>{`页面 ${site.pageUrls.length}`}</h3>
            {site.pageUrls.length === 0 ? (
              <div className="dsh-df-cap">没有页面记录</div>
            ) : (
              <div className="dsh-df-pages-rail">
                {site.pageUrls.map((pageUrl) => (
                  <PageCardRow
                    key={pageUrl}
                    siteHost={site.host}
                    pageUrl={pageUrl}
                    cards={byPage?.get(pageUrl) ?? []}
                    onRecapture={onRecapture}
                    onOpenInLibrary={onOpenInLibrary}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </article>
  )
}

function PageCardRow({ siteHost, pageUrl, cards, onRecapture, onOpenInLibrary }: {
  siteHost: string
  pageUrl: string
  cards: CardRow[]
  onRecapture?: (url: string) => void
  onOpenInLibrary?: (host: string) => void
}): ReactNode {
  const samples = cards.reduce((sum, card) => sum + card.sampleCount, 0)
  const lastAt = cards.reduce((latest, card) => Math.max(latest, card.createdAt), 0)
  return (
    <div className="dsh-df-pgcard">
      <span className="dsh-df-lv dsh-df-lv2">页面</span>
      <div className="dsh-df-pg-main">
        <a className="dsh-df-purl" href={pageUrl} target="_blank" rel="noreferrer">{pageUrl}</a>
        <div className="dsh-df-pg-chips">
          <span><b>{cards.length}</b> 接口</span>
          <span><b>{samples}</b> 样本</span>
          {lastAt > 0 && <span>{`最近 ${fmtShort(lastAt)}`}</span>}
        </div>
      </div>
      <div className="dsh-df-pg-acts">
        {onOpenInLibrary !== undefined && (
          <button className="dsh-df-pact" type="button" onClick={() => { onOpenInLibrary(siteHost) }}>
            接口 →
          </button>
        )}
        {onRecapture !== undefined && (
          <button className="dsh-df-pact" type="button" onClick={() => { onRecapture(pageUrl) }}>
            重采
          </button>
        )}
      </div>
    </div>
  )
}
