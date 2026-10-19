/**
 * 接口库页（原型 docs/prototypes/api-library.html）—— 网站格子 ↔ 站点详情两视图：
 *
 * 视图 A：站点网格（每个 host 一张卡：站点名 + 自动取名标签 + host、页面/接口/样本 + 最近时间 + 进入 →），分页条；
 * 视图 B：面包屑 + 站点横幅（名称 + host + 自动标签）+ 该站点逐页面的 page-node（页面名 + URL；接口卡含模板/鉴权/相关页细节），分页条。
 *
 * 名称来源：服务端已给接口自动名（可手工改名，按 mergeKey 持久化）；站点/页面名由
 * page-meta + names 解析（手工 > 自动 > 无，见 sites-data / grouping）。名称是增强：
 * 名称接口不可用时退回 host/URL，不影响数据面三态。
 *
 * 数据面：无站点聚合端点 —— /cards 拉满（上限内）+ /runs → groupSites（site-data.ts）。
 * 面板没有全局 relations，所以库内不画「形态」清单（面板不谎造形态数）。
 * 跨页动线：站点页「接口 →」经 app 的 openSite/openNonce 直接落入本页视图 B。
 * 呈现纪律：诚实三态、用户数据只进 JSX 文本节点、零 dangerouslySetInnerHTML。
 *
 * @module dsh-dataforge/client/board-cards
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { postName } from './api.js'
import { AuthBlock, Legend, MethodBadge, PagerBar, RelatedPagesBlock, TemplateBlock } from './card-parts.js'
import { AUTH_TYPE_LABELS, IFACES_PER_PAGE } from './dom.js'
import { fmtShort } from './el.js'
import { cardsOnPage, uniquePageUrls, type ResolvedName, type SiteGroup } from './grouping.js'
import {
  backfillStatusText, useAggregateSites, useTitleBackfill, type TitleBackfill,
} from './sites-data.js'
import type { CardRow } from './types.js'

export interface CardsLibraryPageProps {
  visible: boolean
  /** 站点页「接口 →」跨页动线：host + nonce（nonce 变化才重新落入视图 B）。 */
  openSite?: string
  openNonce?: number
}

const SITES_PER_PAGE = 9
const PAGES_PER_HOST = 5

function errText(err: unknown): string {
  return (err as Error)?.message ?? String(err)
}

export function CardsLibraryPage({ visible, openSite, openNonce }: CardsLibraryPageProps): ReactNode {
  const { aggregate, cardsByPage, error, lastSync, reload, siteNames, pageNames, namesAvailable } = useAggregateSites(visible)
  // 补抓名称：服务端重访缺名称的页面；收口后 reload 让新名称进来。
  const backfill = useTitleBackfill(reload, namesAvailable)
  const backfillText = backfillStatusText(backfill, namesAvailable)
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
          siteNames={siteNames}
          backfill={backfill}
          backfillText={backfillText}
          namesAvailable={namesAvailable}
          onEnter={(host) => { setSelectedHost(host); setPageB(0) }}
          onGoto={(page) => { setPageA(page) }}
          onReload={reload}
        />
      ) : (
        <SiteDetailView
          site={selectedSite}
          siteName={siteNames.get(selectedSite.host)}
          clockPages={selectedPages}
          byPage={cardsByPage}
          pageNames={pageNames}
          lastSync={lastSync}
          page={effectiveB}
          totalPages={totalBPages}
          backfill={backfill}
          backfillText={backfillText}
          namesAvailable={namesAvailable}
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

/** 站点名展示：有名称用名称，否则退回 host。 */
function siteLabel(site: SiteGroup, name: ResolvedName | undefined): string {
  return name?.name ?? site.host
}

/** 站点名的副行（host）：只有解析出名称时才显示，避免名称=host 时同一行重复。 */
function SiteHostLine({ site, name }: { site: SiteGroup; name: ResolvedName | undefined }): ReactNode {
  if (name === undefined) return null
  return <span className="dsh-df-host">{site.host}</span>
}

/** 自动取名小标（手工名不标：手工名是用户自己的命名，不需要提示来源）。 */
function AutoNameTag({ name }: { name: ResolvedName | undefined }): ReactNode {
  if (name?.source !== 'auto') return null
  return <span className="dsh-df-auto-tag">自动取名</span>
}

function SyncControls({ lastSync, onReload, backfill, namesAvailable }: {
  lastSync: string
  onReload: () => void
  backfill: TitleBackfill
  namesAvailable: boolean
}): ReactNode {
  return (
    <span className="dsh-df-sync">
      <span className="dsh-df-last">{lastSync}</span>
      <button className="dsh-df-btn-ghost" type="button" onClick={onReload}>刷新</button>
      <button
        className="dsh-df-btn-ghost"
        type="button"
        disabled={backfill.busy || !namesAvailable}
        title={namesAvailable
          ? '让服务端重访缺名称的已采页面，补抓页面标题 / 站点名'
          : '服务端未更新：重启宿主服务后可用'}
        onClick={backfill.start}
      >
        {backfill.busy ? '补抓中…' : '补抓名称'}
      </button>
    </span>
  )
}

/** 补抓状态行：结果/进度文案；名称接口不可用时如实提示（不谎称没有名称）。 */
function BackfillLine({ text, namesAvailable }: { text: string | undefined; namesAvailable: boolean }): ReactNode {
  if (text === undefined) return null
  return (
    <div className={`dsh-df-backfill-line${namesAvailable ? '' : ' dsh-df-backfill-off'}`}>{text}</div>
  )
}

function SiteGridView({ loading, error, lastSync, sites, totalSites, totalCards, page, totalPages, siteNames, backfill, backfillText, namesAvailable, onEnter, onGoto, onReload }: {
  loading: boolean
  error?: string
  lastSync: string
  sites: SiteGroup[]
  totalSites: number
  totalCards: number
  page: number
  totalPages: number
  siteNames: Map<string, ResolvedName>
  backfill: TitleBackfill
  backfillText: string | undefined
  namesAvailable: boolean
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
        <SyncControls lastSync={lastSync} onReload={onReload} backfill={backfill} namesAvailable={namesAvailable} />
      </div>
      <BackfillLine text={backfillText} namesAvailable={namesAvailable} />
      {error !== undefined && <div className="dsh-df-empty">{`取数失败：${error} —— 点「刷新」重试。`}</div>}
      {error === undefined && loading && <div className="dsh-df-state">加载中…</div>}
      {error === undefined && !loading && sites.length === 0 && (
        <div className="dsh-df-empty">
          <b>接口库还是空的</b>——采集运行沉淀的接口卡会按网站出现在这里。
        </div>
      )}
      {error === undefined && !loading && sites.length > 0 && (
        <div className="dsh-df-site-grid">
          {sites.map((site) => {
            const name = siteNames.get(site.host)
            return (
              <button className="dsh-df-site-card" key={site.host} type="button" onClick={() => { onEnter(site.host) }}>
                <span className="dsh-df-site-card-title">
                  <span className="dsh-df-lv dsh-df-lv1">网站</span>
                  <b className="dsh-df-grow">{siteLabel(site, name)}</b>
                  <AutoNameTag name={name} />
                </span>
                <SiteHostLine site={site} name={name} />
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
            )
          })}
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

function SiteDetailView({ site, siteName, clockPages, byPage, pageNames, lastSync, page, totalPages, backfill, backfillText, namesAvailable, onBack, onGoto, onReload }: {
  site: SiteGroup
  siteName: ResolvedName | undefined
  clockPages: string[]
  byPage: Map<string, CardRow[]>
  pageNames: Map<string, ResolvedName>
  lastSync: string
  page: number
  totalPages: number
  backfill: TitleBackfill
  backfillText: string | undefined
  namesAvailable: boolean
  onBack: () => void
  onGoto: (page: number) => void
  onReload: () => void
}): ReactNode {
  const shown = clockPages.slice(page * PAGES_PER_HOST, (page + 1) * PAGES_PER_HOST)
  const stats = site.stats
  return (
    <>
      <div className="dsh-df-crumb">
        <button type="button" onClick={onBack}>接口库</button>
        <span>/</span>
        <b style={{ color: 'var(--dsh-df-ink)' }}>{siteLabel(site, siteName)}</b>
      </div>
      <div className="dsh-df-card dsh-df-site-banner">
        <span className="dsh-df-lv dsh-df-lv1">网站</span>
        <span className="dsh-df-site-banner-names">
          <span className="dsh-df-site-banner-title">
            <span className="dsh-df-site-name">{siteLabel(site, siteName)}</span>
            <AutoNameTag name={siteName} />
          </span>
          <SiteHostLine site={site} name={siteName} />
        </span>
        <span className="dsh-df-stats">
          <span>页面 <b>{stats.pages}</b></span>
          <span>接口 <b>{stats.cards}</b></span>
          <span>样本 <b>{stats.samples}</b></span>
        </span>
        <SyncControls lastSync={lastSync} onReload={onReload} backfill={backfill} namesAvailable={namesAvailable} />
      </div>
      <BackfillLine text={backfillText} namesAvailable={namesAvailable} />
      {shown.map((pageUrl) => (
        <PageNode
          key={pageUrl}
          pageUrl={pageUrl}
          name={pageNames.get(pageUrl)}
          cards={cardsOnPage(byPage, pageUrl)}
          onReload={onReload}
        />
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

function PageNode({ pageUrl, name, cards, onReload }: {
  pageUrl: string
  name: ResolvedName | undefined
  cards: CardRow[]
  onReload: () => void
}): ReactNode {
  // 默认收起：进站点先看「页面清单」，接口卡留到点开页面再看。
  // 与编排页「默认全部折叠」同口径；站点/分页切换都会重新挂载，用户翻页后不会被上一次的展开态带偏。
  const [open, setOpen] = useState(false)
  // 接口分页独立于站点/页面分页：切页只换本页节点里的接口列表。
  const [page, setPage] = useState(0)
  const cardCount = cards.length
  const sampleSum = cards.reduce((sum, card) => sum + card.sampleCount, 0)
  const totalPages = Math.max(1, Math.ceil(cardCount / IFACES_PER_PAGE))
  const effectivePage = Math.min(page, totalPages - 1)
  const first = effectivePage * IFACES_PER_PAGE
  const shown = cards.slice(first, first + IFACES_PER_PAGE)
  return (
    <div className={`dsh-df-page-node${open ? '' : ' dsh-df-collapsed'}`}>
      <button className="dsh-df-pn-head" type="button" onClick={() => { setOpen((value) => !value) }}>
        <span className="dsh-df-lv dsh-df-lv2">页面</span>
        <span className="dsh-df-pn-names">
          {name !== undefined && <span className="dsh-df-pn-title">{name.name}</span>}
          <span className={name === undefined ? 'dsh-df-pn-name dsh-df-mono' : 'dsh-df-pn-url dsh-df-mono'}>{pageUrl}</span>
        </span>
        <span className="dsh-df-pn-meta">{`${cardCount} 接口 · ${sampleSum} 样本`}</span>
        <span className="dsh-df-caret">▾</span>
      </button>
      {open && (
        <div className="dsh-df-pn-body">
          {cardCount === 0 ? (
            <div className="dsh-df-cap">这页没有挂接口卡</div>
          ) : (
            <>
              {shown.map((card) => <IfaceCard key={card.id} card={card} onReload={onReload} />)}
              <PagerBar
                page={effectivePage}
                totalPages={totalPages}
                label={`第 ${first + 1}–${first + shown.length} / 共 ${cardCount} 接口`}
                onGoto={setPage}
                ariaLabel="接口分页"
              />
            </>
          )}
        </div>
      )}
    </div>
  )
}

function IfaceCard({ card, onReload }: { card: CardRow; onReload: () => void }): ReactNode {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | undefined>()
  // Enter 提交后输入框卸载可能再触发 blur：用 ref 拦掉第二次提交（写接口不做幂等猜测）。
  const committingRef = useRef(false)

  const startEdit = (): void => {
    setDraft(card.name ?? '')
    setEditError(undefined)
    committingRef.current = false
    setEditing(true)
  }

  const cancelEdit = (): void => {
    if (saving) return
    committingRef.current = true
    setEditing(false)
    setEditError(undefined)
  }

  const commit = async (): Promise<void> => {
    if (!editing || committingRef.current) return
    committingRef.current = true
    const name = draft.trim()
    setSaving(true)
    try {
      await postName('interface', card.mergeKey, name)
      setEditing(false)
      setEditError(undefined)
      onReload()
    } catch (err) {
      setEditError(errText(err))
      committingRef.current = false
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`dsh-df-iface-card${open ? ' dsh-df-open' : ''}`}>
      <div className="dsh-df-iface-title-row">
        {editing ? (
          <>
            <MethodBadge method={card.method} />
            <input
              className="dsh-df-rename-input"
              type="text"
              value={draft}
              placeholder="留空恢复自动名"
              spellCheck={false}
              autoFocus
              disabled={saving}
              aria-label="接口名"
              onChange={(event) => { setDraft(event.target.value) }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void commit()
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  cancelEdit()
                }
              }}
              onBlur={() => { void commit() }}
            />
          </>
        ) : (
          <>
            <button className="dsh-df-iface-head" type="button" onClick={() => { setOpen((value) => !value) }}>
              <MethodBadge method={card.method} />
              <span className="dsh-df-grow">{(card.name ?? '') === '' ? '未命名接口' : card.name}</span>
              <span className="dsh-df-caret">▾</span>
            </button>
            {typeof card.mergeKey === 'string' && card.mergeKey !== '' && (
              <button
                className="dsh-df-edit-btn"
                type="button"
                title="改接口名（留空恢复自动名）"
                aria-label="改接口名"
                onClick={(event) => { event.stopPropagation(); startEdit() }}
              >
                ✎
              </button>
            )}
          </>
        )}
      </div>
      {editError !== undefined && <div className="dsh-df-errline">{`改名失败：${editError}`}</div>}
      <span className="dsh-df-iface-url">{card.urlTemplate}</span>
      <div className="dsh-df-iface-chips">
        <span><b>{card.sampleCount}</b> 样本</span>
        <span>页面 <b>{uniquePageUrls(card.relatedPageUrls).length}</b></span>
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
