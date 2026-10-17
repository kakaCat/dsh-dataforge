/**
 * 接口库页（原型 docs/prototypes/api-library.html）—— 网站格子 ↔ 站点详情两视图：
 *
 * 视图 A：站点网格（每个 host 一张卡：页面/接口/样本 + 最近时间 + 进入 →），分页条；
 * 视图 B：面包屑 + 站点横幅 + 该站点逐页面的 page-node（接口卡含模板/鉴权/相关页细节），分页条。
 *
 * 数据面：无站点聚合端点 —— /cards 拉满（上限内）+ /runs → groupSites（site-data.ts）。
 * 面板没有全局 relations，所以库内不画「形态」清单（面板不谎造形态数）。
 * 跨页动线：站点页「接口 →」经 app 的 openSite/openNonce 直接落入本页视图 B。
 * 呈现纪律：诚实三态、用户数据只进 JSX 文本节点、零 dangerouslySetInnerHTML。
 *
 * @module dsh-dataforge/client/board-cards
 */
import { useEffect, useState, type ReactNode } from 'react'
import { AuthBlock, Legend, MethodBadge, RelatedPagesBlock, TemplateBlock } from './card-parts.js'
import { AUTH_TYPE_LABELS } from './dom.js'
import { fmtShort } from './el.js'
import type { SiteGroup } from './grouping.js'
import type { CardRow } from './types.js'
import { useAggregateSites } from './sites-data.js'

export interface CardsLibraryPageProps {
  visible: boolean
  /** 站点页「接口 →」跨页动线：host + nonce（nonce 变化才重新落入视图 B）。 */
  openSite?: string
  openNonce?: number
}

const SITES_PER_PAGE = 9
const PAGES_PER_HOST = 5

export function CardsLibraryPage({ visible, openSite, openNonce }: CardsLibraryPageProps): ReactNode {
  const { aggregate, cardsByPage, error, lastSync, reload } = useAggregateSites(visible)
  const [selectedHost, setSelectedHost] = useState<string | undefined>()
  const [pageA, setPageA] = useState(0)
  const [pageB, setPageB] = useState(0)

  useEffect(() => {
    if (openSite === undefined) return
    setSelectedHost(openSite)
    setPageB(0)
  }, [openSite, openNonce])

  const sites = aggregate?.sites ?? []
  const totalAPages = Math.max(1, Math.ceil(sites.length / SITES_PER_PAGE))
  const effectiveA = Math.min(pageA, totalAPages - 1)
  const pageSites = sites.slice(effectiveA * SITES_PER_PAGE, (effectiveA + 1) * SITES_PER_PAGE)

  const selectedSite = sites.find((site) => site.host === selectedHost)
  const selectedPages = selectedSite?.pageUrls ?? []
  const totalBPages = Math.max(1, Math.ceil(selectedPages.length / PAGES_PER_HOST))
  const effectiveB = Math.min(pageB, totalBPages - 1)

  return (
    <div className="dsh-df-page">
      {selectedSite === undefined ? (
        <SiteGridView
          loading={error === undefined && aggregate === undefined}
          error={error}
          lastSync={lastSync}
          sites={pageSites}
          totalSites={sites.length}
          totalCards={aggregate?.cards.length ?? 0}
          page={effectiveA}
          totalPages={totalAPages}
          onEnter={(host) => { setSelectedHost(host); setPageB(0) }}
          onGoto={(page) => { setPageA(page) }}
          onReload={reload}
        />
      ) : (
        <SiteDetailView
          site={selectedSite}
          clockPages={selectedPages}
          byPage={cardsByPage}
          lastSync={lastSync}
          page={effectiveB}
          totalPages={totalBPages}
          onBack={() => { setSelectedHost(undefined); setPageA(0) }}
          onGoto={(page) => { setPageB(page) }}
          onReload={reload}
        />
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

function SiteHeaderView({ site, huge }: { site: SiteGroup; huge?: boolean }): ReactNode {
  const stats = site.stats
  return (
    <>
      <span className="dsh-df-lv dsh-df-lv1">网站</span>
      <span className={huge ? 'dsh-df-site-name' : 'dsh-df-site-card-title'} style={huge ? undefined : { flex: '1', minWidth: 0 }}>
        <span style={{ flex: '1', minWidth: 0 }}>{site.host}</span>
      </span>
      <span className="dsh-df-stats">
        <span>页面 <b>{stats.pages}</b></span>
        <span>接口 <b>{stats.cards}</b></span>
        <span>样本 <b>{stats.samples}</b></span>
        {huge !== true && <span>采集 <b>{stats.runs}</b> 次</span>}
      </span>
    </>
  )
}

function SiteGridView({ loading, error, lastSync, sites, totalSites, totalCards, page, totalPages, onEnter, onGoto, onReload }: {
  loading: boolean
  error?: string
  lastSync: string
  sites: SiteGroup[]
  totalSites: number
  totalCards: number
  page: number
  totalPages: number
  onEnter: (host: string) => void
  onGoto: (page: number) => void
  onReload: () => void
}): ReactNode {
  return (
    <>
      <div className="dsh-df-head">
        <div>
          <h2>接口库</h2>
          <p className="dsh-df-sub">接口按网站分类归档；点站点卡进入它的页面与接口</p>
        </div>
        <div className="dsh-df-sync">
          <span className="dsh-df-last">{lastSync}</span>
          <button className="dsh-df-btn-ghost" type="button" onClick={onReload}>刷新</button>
        </div>
      </div>
      {error !== undefined && <div className="dsh-df-empty">{`取数失败：${error} —— 点「刷新」重试。`}</div>}
      {error === undefined && loading && <div className="dsh-df-state">加载中…</div>}
      {error === undefined && !loading && sites.length === 0 && (
        <div className="dsh-df-empty">
          <b>接口库还是空的</b>——采集运行沉淀的接口卡会按网站出现在这里。
        </div>
      )}
      {error === undefined && !loading && sites.length > 0 && (
        <div className="dsh-df-site-grid">
          {sites.map((site) => (
            <button className="dsh-df-site-card" key={site.host} type="button" onClick={() => { onEnter(site.host) }}>
              <span className="dsh-df-site-card-title">
                <span className="dsh-df-lv dsh-df-lv1">网站</span>
                <span style={{ flex: '1', minWidth: 0, overflowWrap: 'anywhere' }}>{site.host}</span>
              </span>
              <span className="dsh-df-site-card-stats">
                <span>页面 <b>{site.stats.pages}</b></span>
                <span>接口 <b>{site.stats.cards}</b></span>
                <span>样本 <b>{site.stats.samples}</b></span>
              </span>
              <span className="dsh-df-site-card-foot">
                {site.stats.lastAt === undefined ? '没有采集记录' : `最近 ${fmtShort(site.stats.lastAt)}`}
                <span className="dsh-df-site-card-enter">进入 →</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {error === undefined && !loading && totalSites > 0 && (
        <div className="dsh-df-pagerbar">
          <span>{`共 ${totalSites} 站点 · ${totalCards} 接口卡`}</span>
          {totalPages > 1 && (
            <span className="dsh-df-pages">
              {Array.from({ length: totalPages }, (_, index) => (
                <button
                  className="dsh-df-pg"
                  key={index}
                  type="button"
                  aria-current={index === page}
                  onClick={() => { onGoto(index) }}
                >
                  {index + 1}
                </button>
              ))}
            </span>
          )}
        </div>
      )}
    </>
  )
}

function SiteDetailView({ site, clockPages, byPage, lastSync, page, totalPages, onBack, onGoto, onReload }: {
  site: SiteGroup
  clockPages: string[]
  byPage: Map<string, CardRow[]>
  lastSync: string
  page: number
  totalPages: number
  onBack: () => void
  onGoto: (page: number) => void
  onReload: () => void
}): ReactNode {
  const shown = clockPages.slice(page * PAGES_PER_HOST, (page + 1) * PAGES_PER_HOST)
  return (
    <>
      <div className="dsh-df-crumb">
        <button type="button" onClick={onBack}>接口库</button>
        <span>/</span>
        <b style={{ color: 'var(--dsh-df-ink)' }}>{site.host}</b>
      </div>
      <div className="dsh-df-card dsh-df-site-banner">
        <SiteHeaderView site={site} huge />
        <span className="dsh-df-sync">
          <span className="dsh-df-last">{lastSync}</span>
          <button className="dsh-df-btn-ghost" type="button" onClick={onReload}>刷新</button>
        </span>
      </div>
      {shown.map((pageUrl) => (
        <PageNode key={pageUrl} pageUrl={pageUrl} cards={byPage.get(pageUrl) ?? []} />
      ))}
      <div className="dsh-df-pagerbar">
        <span>{`共 ${clockPages.length} 页面`}</span>
        {totalPages > 1 && (
          <span className="dsh-df-pages">
            {Array.from({ length: totalPages }, (_, index) => (
              <button
                className="dsh-df-pg"
                key={index}
                type="button"
                aria-current={index === page}
                onClick={() => { onGoto(index) }}
              >
                {index + 1}
              </button>
            ))}
          </span>
        )}
      </div>
    </>
  )
}

function PageNode({ pageUrl, cards }: { pageUrl: string; cards: CardRow[] }): ReactNode {
  const [open, setOpen] = useState(true)
  const cardCount = cards.length
  const sampleSum = cards.reduce((sum, card) => sum + card.sampleCount, 0)
  return (
    <div className={`dsh-df-page-node${open ? '' : ' dsh-df-collapsed'}`}>
      <button className="dsh-df-pn-head" type="button" onClick={() => { setOpen((value) => !value) }}>
        <span className="dsh-df-lv dsh-df-lv2">页面</span>
        <span className="dsh-df-pn-name dsh-df-mono">{pageUrl}</span>
        <span className="dsh-df-pn-meta">{`${cardCount} 接口 · ${sampleSum} 样本`}</span>
        <span className="dsh-df-caret">▾</span>
      </button>
      {open && (
        <div className="dsh-df-pn-body">
          {cards.length === 0 ? (
            <div className="dsh-df-cap">这页没有挂接口卡</div>
          ) : (
            cards.map((card) => <IfaceCard key={card.id} card={card} />)
          )}
        </div>
      )}
    </div>
  )
}

function IfaceCard({ card }: { card: CardRow }): ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <div className={`dsh-df-iface-card${open ? ' dsh-df-open' : ''}`}>
      <button className="dsh-df-iface-head" type="button" onClick={() => { setOpen((value) => !value) }}>
        <MethodBadge method={card.method} />
        <span className="dsh-df-grow">{card.name ?? '未命名接口'}</span>
        <span className="dsh-df-caret">▾</span>
      </button>
      <span className="dsh-df-iface-url">{card.urlTemplate}</span>
      <div className="dsh-df-iface-chips">
        <span><b>{card.sampleCount}</b> 样本</span>
        <span>页面 <b>{card.relatedPageUrls.length}</b></span>
        <span>鉴权 {card.authType === undefined ? '未探测' : AUTH_TYPE_LABELS[card.authType] ?? card.authType}</span>
        {card.createdAt > 0 && <span>{`沉淀 ${fmtShort(card.createdAt)}`}</span>}
      </div>
      {open && (
        <div className="dsh-df-iface-detail" onClick={(event) => { event.stopPropagation() }}>
          <TemplateBlock title="请求模板" template={card.requestTemplate} />
          <TemplateBlock title="响应模板" template={card.responseTemplate} />
          <AuthBlock card={card} />
          <RelatedPagesBlock card={card} />
        </div>
      )}
    </div>
  )
}
