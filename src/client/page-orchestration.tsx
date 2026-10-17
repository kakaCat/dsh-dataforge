/**
 * 编排页（R-2）：原型 `docs/prototypes/orchestration.html` 的四段动线。
 *
 *   ① 网站选择   → ② 流程列表（页面编排 / 接口编排 × 业务域 → 流程 → 版本，带检索与分页）
 *   → ③ 编排图列表（每个版本一张图，分页，导出 YAML / 打开画布）→ ④ 画布（@xyflow/react）
 *
 * 与原型的两处**有意偏差**（都在界面上说明了原因）：
 *   1. 节点「名称 / 方法 / 地址」不在这里编辑——那些字段属于接口卡，链里只存 cardId。
 *      画布可编辑的是常量绑定、页面地址、重试/超时、坐标（见 orchestration-canvas.tsx）。
 *   2. 「新建流程」不预先落盘空白链：R-1 校验要求「链至少要有一个节点」，所以新建只是
 *      在内存里起一份草稿并进画布，首次「保存为新版本」才真正落盘。
 *
 * 数据来自 `GET /orchestration/overview`（一次拿够网站+流程+版本），画布用
 * `GET /orchestration/graph` 取可编辑副本。分页/检索在客户端做——链是项目资产，
 * 量级是「几十条流程」，服务端分页只会多一次往返。
 *
 * @module dsh-dataforge/client/page-orchestration
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { fetchChainGraph, fetchOrchestrationOverview, importChainYaml, saveChainGraph } from './api.js'
import { formatTime } from './format.js'
import { OrchestrationCanvas } from './orchestration-canvas.js'
import type {
  ChainDocLike, ChainGraph, ChainSaveResult, ChainSource, OrchestrationFlow,
  OrchestrationOverview, OrchestrationVersion,
} from './types.js'

const SITES_PAGE_SIZE = 9
const FLOWS_PAGE_SIZE = 10
const GRAPHS_PAGE_SIZE = 10
/** 每页条数候选（原型三处分页条都有这个下拉，默认值就是上面三个常量）。 */
const SITE_PAGE_OPTIONS = [9, 18, 36] as const
const FLOW_PAGE_OPTIONS = [10, 20, 50] as const
const GRAPH_PAGE_OPTIONS = [10, 20, 50] as const

type View = 'sites' | 'flows' | 'graphs' | 'canvas'
type KindTab = 'page' | 'api'

const SOURCE_LABELS: Record<ChainSource, string> = {
  agent: 'agent 会话保存',
  canvas: '画布保存',
  import: 'YAML 导入',
}

const KIND_LABELS: Record<string, string> = {
  'page-chain': '页面编排',
  'interface-chain': '接口编排',
}

function sourceLabel(source: ChainSource | undefined): string {
  return source === undefined ? '未标注来源' : SOURCE_LABELS[source]
}

/** 站点展示名：链文件里的 meta.site 与目录 slug 可能不同，这里以目录名为键、原名为展示。 */
function siteLabel(overview: OrchestrationOverview, site: string): string {
  const flow = overview.flows.find((item) => item.site === site)
  // 流程行里的 site 就是 store 给的目录名，真实站点名在链文件的 meta.site——
  // 但 route 的 overview 只回目录名，所以这里就用它（与链文件 slugOf 一致可读）。
  return flow === undefined ? site : site
}

export interface OrchestrationPageProps {
  visible: boolean
}

export function OrchestrationPage({ visible }: OrchestrationPageProps): ReactNode {
  const [overview, setOverview] = useState<OrchestrationOverview | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [notice, setNotice] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)

  const [view, setView] = useState<View>('sites')
  const [site, setSite] = useState<string | undefined>()
  const [kind, setKind] = useState<KindTab>('page')
  const [search, setSearch] = useState('')
  const [flow, setFlow] = useState<OrchestrationFlow | undefined>()
  const [graph, setGraph] = useState<ChainGraph | undefined>()
  const [graphLoading, setGraphLoading] = useState(false)

  const [sitesPage, setSitesPage] = useState(1)
  const [flowsPage, setFlowsPage] = useState(1)
  const [graphsPage, setGraphsPage] = useState(1)
  const [sitesPageSize, setSitesPageSize] = useState<number>(SITES_PAGE_SIZE)
  const [flowsPageSize, setFlowsPageSize] = useState<number>(FLOWS_PAGE_SIZE)
  const [graphsPageSize, setGraphsPageSize] = useState<number>(GRAPHS_PAGE_SIZE)
  const [collapsedDomains, setCollapsedDomains] = useState<Set<string>>(new Set())
  const [collapsedFlows, setCollapsedFlows] = useState<Set<string>>(new Set())

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(undefined)
    try {
      setOverview(await fetchOrchestrationOverview())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!visible) return
    void reload()
  }, [reload, visible])

  /** 面板切走再回来时刷新一次（别的会话可能刚存了新版本）。 */
  useEffect(() => {
    if (visible) return
    setOverview(undefined)
  }, [visible])

  /* ───────────────────────── 派生数据 ───────────────────────── */

  const flowsOfSite = useMemo(() => {
    if (site === undefined) return []
    const target = kind === 'page' ? 'page-chain' : 'interface-chain'
    return (overview?.flows ?? []).filter((item) => item.site === site && item.kind === target)
  }, [kind, overview, site])

  const filteredFlows = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (keyword.length === 0) return flowsOfSite
    return flowsOfSite.filter((item) => {
      const haystack = [
        item.flow,
        item.domain ?? '',
        item.note ?? '',
        ...item.versions.flatMap((version) => [String(version.version), sourceLabel(version.source)]),
      ].join(' ').toLowerCase()
      return haystack.includes(keyword)
    })
  }, [flowsOfSite, search])

  /** 业务域 → 流程（检索后仍按域分组；未标业务域的归「未分组」）。 */
  const domains = useMemo(() => {
    const groups = new Map<string, OrchestrationFlow[]>()
    for (const item of filteredFlows) {
      const domain = item.domain ?? '未分组'
      const list = groups.get(domain) ?? []
      list.push(item)
      groups.set(domain, list)
    }
    return [...groups.entries()].sort((left, right) => left[0].localeCompare(right[0]))
  }, [filteredFlows])

  const pagedFlows = useMemo(() => {
    const start = (flowsPage - 1) * flowsPageSize
    return filteredFlows.slice(start, start + flowsPageSize)
  }, [filteredFlows, flowsPage, flowsPageSize])

  const pagedDomains = useMemo(() => {
    const visibleIds = new Set(pagedFlows.map((item) => item.flow))
    return domains
      .map(([domain, list]) => [domain, list.filter((item) => visibleIds.has(item.flow))] as const)
      .filter(([, list]) => list.length > 0)
  }, [domains, pagedFlows])

  const siteRows = overview?.sites ?? []
  const pagedSites = useMemo(() => {
    const start = (sitesPage - 1) * sitesPageSize
    return siteRows.slice(start, start + sitesPageSize)
  }, [siteRows, sitesPage, sitesPageSize])

  const versionRows = useMemo(() => {
    if (flow === undefined) return [] as OrchestrationVersion[]
    return flow.versions
  }, [flow])

  const pagedVersions = useMemo(() => {
    const start = (graphsPage - 1) * graphsPageSize
    return versionRows.slice(start, start + graphsPageSize)
  }, [graphsPage, versionRows, graphsPageSize])

  /* ───────────────────────── 动线 ───────────────────────── */

  const enterSite = (next: string): void => {
    setSite(next)
    setFlowsPage(1)
    setSearch('')
    setView('flows')
  }

  const openGraphs = (target: OrchestrationFlow): void => {
    setFlow(target)
    setGraphsPage(1)
    setView('graphs')
  }

  const openCanvas = async (target: OrchestrationFlow, version?: number): Promise<void> => {
    setGraphLoading(true)
    setError(undefined)
    try {
      const loaded = await fetchChainGraph(target.site, target.flow, version)
      setGraph(loaded)
      setFlow(target)
      setView('canvas')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setGraphLoading(false)
    }
  }

  const handleSave = useCallback(async (doc: ChainDocLike): Promise<ChainSaveResult> => {
    const result = await saveChainGraph(doc)
    if (result.ok) {
      await reload()
      // 保存成功后把画布切到新版本（否则用户看到的是旧版本的复制品）
      if (doc.meta.site !== undefined) {
        try {
          const saved = await fetchChainGraph(doc.meta.site, doc.meta.flow, result.version)
          setGraph(saved)
        } catch {
          // 刷新失败不影响「已保存」的事实，列表已经 reload 过
        }
      }
    }
    return result
  }, [reload])

  /** 新建流程：内存草稿 + 直接进画布（不落盘空白链）。 */
  const createDraft = (draft: { flow: string; kind: KindTab; domain: string; note: string }): void => {
    if (site === undefined) return
    const chainKind = draft.kind === 'page' ? 'page-chain' : 'interface-chain'
    const doc: ChainDocLike = {
      apiVersion: 'dataforge/v1',
      kind: chainKind,
      meta: {
        site,
        flow: draft.flow,
        version: 0,
        created: new Date().toISOString(),
        ...(draft.domain.length === 0 ? {} : { domain: draft.domain }),
        ...(draft.note.length === 0 ? {} : { note: draft.note }),
      },
      inputs: [],
      nodes: [
        {
          id: draft.kind === 'page' ? 'page-1' : 'api-1',
          ...(draft.kind === 'page' ? { page: '/new-page' } : {}),
          constants: {},
          layout: { x: 0, y: 0 },
        },
      ],
      edges: [],
    }
    setGraph({
      site,
      flow: draft.flow,
      version: 0,
      kind: chainKind,
      ...(draft.domain.length === 0 ? {} : { domain: draft.domain }),
      created: doc.meta.created,
      chainYaml: '',
      doc,
      cards: {},
      versions: [],
    })
    setView('canvas')
  }

  /* ───────────────────────── 渲染 ───────────────────────── */

  if (!visible) return null

  return (
    <div className="dsh-df-page">
      {notice === undefined ? null : (
        <div className="dsh-df-canvas-notice" role="status">
          {notice}
          <button type="button" className="dsh-df-btn" onClick={() => { setNotice(undefined) }}>知道了</button>
        </div>
      )}
      {error === undefined ? null : (
        <div className="dsh-df-errline" role="alert">
          {error}
          <button type="button" className="dsh-df-btn" onClick={() => { void reload() }}>重试</button>
        </div>
      )}

      {view === 'sites' && (
        <SitesView
          loading={loading}
          sites={pagedSites}
          total={siteRows.length}
          totalFlows={overview?.flows.length ?? 0}
          page={sitesPage}
          pageSize={sitesPageSize}
          sizeOptions={SITE_PAGE_OPTIONS}
          onPageSize={(size) => { setSitesPageSize(size); setSitesPage(1) }}
          hint={overview?.chainsRootHint}
          onPage={setSitesPage}
          onEnter={enterSite}
        />
      )}

      {view === 'flows' && site !== undefined && (
        <FlowsView
          site={site}
          siteName={siteLabel(overview ?? { sites: [], flows: [], chainsRootHint: '' }, site)}
          kind={kind}
          search={search}
          domains={pagedDomains}
          total={filteredFlows.length}
          page={flowsPage}
          pageSize={flowsPageSize}
          sizeOptions={FLOW_PAGE_OPTIONS}
          onPageSize={(size) => { setFlowsPageSize(size); setFlowsPage(1) }}
          collapsedDomains={collapsedDomains}
          collapsedFlows={collapsedFlows}
          onKind={(next) => { setKind(next); setFlowsPage(1); setSearch('') }}
          onSearch={(next) => { setSearch(next); setFlowsPage(1) }}
          onToggleDomain={(domain) => {
            setCollapsedDomains((current) => {
              const next = new Set(current)
              if (next.has(domain)) next.delete(domain)
              else next.add(domain)
              return next
            })
          }}
          onToggleFlow={(key) => {
            setCollapsedFlows((current) => {
              const next = new Set(current)
              if (next.has(key)) next.delete(key)
              else next.add(key)
              return next
            })
          }}
          onPage={setFlowsPage}
          onBack={() => { setView('sites') }}
          onOpenGraphs={openGraphs}
          onOpenCanvas={(target, version) => { void openCanvas(target, version) }}
          onCreated={createDraft}
          onImported={(text) => { setNotice(text); void reload() }}
        />
      )}

      {view === 'graphs' && flow !== undefined && (
        <GraphsView
          flow={flow}
          versions={pagedVersions}
          total={versionRows.length}
          page={graphsPage}
          pageSize={graphsPageSize}
          sizeOptions={GRAPH_PAGE_OPTIONS}
          onPageSize={(size) => { setGraphsPageSize(size); setGraphsPage(1) }}
          busy={graphLoading}
          onPage={setGraphsPage}
          onBack={() => { setView('flows') }}
          onOpenCanvas={(version) => { void openCanvas(flow, version) }}
        />
      )}

      {view === 'canvas' && graph !== undefined && (
        <>
          <div className="dsh-df-crumb">
            <button type="button" onClick={() => { setView('graphs') }}>← 返回编排图列表</button>
            <span>/</span>
            <span>编排</span>
            <span>/</span>
            <b>{graph.site}</b>
            <span>/</span>
            <b>{graph.flow}</b>
          </div>
          <OrchestrationCanvas graph={graph} onSave={handleSave} />
        </>
      )}
      <HierarchyLegend />
    </div>
  )
}

/* ───────────────────────── ① 网站选择 ───────────────────────── */

function SitesView(props: {
  loading: boolean
  sites: Array<{ site: string; pageFlows: number; apiFlows: number; flows: number; updatedAt?: string; domains: string[] }>
  total: number
  totalFlows: number
  page: number
  pageSize: number
  sizeOptions: readonly number[]
  hint?: string
  onPage: (page: number) => void
  onPageSize: (size: number) => void
  onEnter: (site: string) => void
}): ReactNode {
  const { loading, sites, total, totalFlows, page, pageSize, sizeOptions, hint, onPage, onPageSize, onEnter } = props
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <>
      <div className="dsh-df-view-head">
        <h1>编排（DAG）</h1>
        <span className="dsh-df-sub">把采集到的页面与接口编排成业务流程 · 先选择一个网站</span>
      </div>
      {loading && total === 0 ? <p className="dsh-df-sub">读取编排数据…</p> : null}
      {!loading && total === 0 ? (
        <div className="dsh-df-empty">
          还没有任何编排流程。链落在 <code>{hint ?? '<工作区>/.dsh/dataforge/chains'}</code>；
          可以由 agent 会话保存（dataforge_chain_upsert），或在下方选择网站后新建流程。
        </div>
      ) : null}
      <div className="dsh-df-site-grid">
        {sites.map((row) => (
          <button key={row.site} type="button" className="dsh-df-site-card" onClick={() => { onEnter(row.site) }}>
            <div className="dsh-df-title">
              <span className="dsh-df-lv dsh-df-lv-1">网站</span>
              <b>{row.site}</b>
            </div>
            <div className="dsh-df-host">
              {row.domains.length === 0 ? '业务域：未分组' : `业务域：${row.domains.join(' / ')}`}
            </div>
            <div className="dsh-df-stats">
              <span>页面编排 <b>{row.pageFlows}</b></span>
              <span>接口编排 <b>{row.apiFlows}</b></span>
            </div>
            <div className="dsh-df-foot">
              <span>最近更新 {formatTime(row.updatedAt)}</span>
              <span className="dsh-df-enter">进入 →</span>
            </div>
          </button>
        ))}
      </div>
      <PagerBar
        total={<>共 <b>{total}</b> 个网站 · <b>{totalFlows}</b> 条编排流程</>}
        unit="网站"
        page={page}
        pages={pages}
        pageSize={pageSize}
        sizeOptions={sizeOptions}
        onPage={onPage}
        onPageSize={onPageSize}
      />
    </>
  )
}

/* ───────────────────────── ② 流程列表 ───────────────────────── */

function FlowsView(props: {
  site: string
  siteName: string
  kind: KindTab
  search: string
  domains: ReadonlyArray<readonly [string, OrchestrationFlow[]]>
  total: number
  page: number
  pageSize: number
  collapsedDomains: Set<string>
  collapsedFlows: Set<string>
  onKind: (kind: KindTab) => void
  onSearch: (value: string) => void
  onToggleDomain: (domain: string) => void
  onToggleFlow: (key: string) => void
  onPage: (page: number) => void
  onPageSize: (size: number) => void
  sizeOptions: readonly number[]
  onBack: () => void
  onOpenGraphs: (flow: OrchestrationFlow) => void
  onOpenCanvas: (flow: OrchestrationFlow, version?: number) => void
  onCreated: (draft: { flow: string; kind: KindTab; domain: string; note: string }) => void
  onImported: (notice: string) => void
}): ReactNode {
  const {
    siteName, kind, search, domains, total, page, pageSize, sizeOptions, collapsedDomains, collapsedFlows,
    onKind, onSearch, onToggleDomain, onToggleFlow, onPage, onPageSize, onBack, onOpenGraphs, onOpenCanvas,
    onCreated, onImported,
  } = props
  const [modalOpen, setModalOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const pages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <>
      <div className="dsh-df-crumb">
        <button type="button" onClick={onBack}>← 返回网站列表</button>
        <span>/</span>
        <span>编排</span>
        <span>/</span>
        <b>{siteName}</b>
      </div>

      <div className="dsh-df-kind-tabs" role="group" aria-label="编排类型">
        <button type="button" className="dsh-df-kind-tab" aria-pressed={kind === 'page'} onClick={() => { onKind('page') }}>
          页面编排 <small>跨页面的业务流程</small>
        </button>
        <button type="button" className="dsh-df-kind-tab" aria-pressed={kind === 'api'} onClick={() => { onKind('api') }}>
          接口编排 <small>接口调用依赖 DAG</small>
        </button>
      </div>

      <div className="dsh-df-ob-toolbar">
        <input
          className="dsh-df-search"
          placeholder="搜索流程名 / 业务域 / 版本说明…"
          value={search}
          onChange={(event) => { onSearch(event.target.value) }}
        />
        <div className="dsh-df-ops">
          <span className="dsh-df-fmt-tag">导入格式：YAML</span>
          <button
            type="button"
            className="dsh-df-btn"
            disabled={importing}
            onClick={() => { fileRef.current?.click() }}
          >
            {importing ? '导入中…' : '导入编排'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".yaml,.yml,text/yaml"
            style={{ display: 'none' }}
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file === undefined) return
              setImporting(true)
              void file.text()
                .then((text) => importChainYaml(text))
                .then((result) => {
                  if (result.ok) {
                    onImported(`已导入为 v${result.version ?? '?'}（来源：YAML 导入）`)
                  } else {
                    const lines = (result.issues ?? []).map((issue) => `${issue.target}：${issue.reason}`)
                    onImported(`导入被拒绝，未落盘：\n${lines.join('\n')}`)
                  }
                })
                .catch((err: unknown) => {
                  onImported(`导入失败：${err instanceof Error ? err.message : String(err)}`)
                })
                .finally(() => { setImporting(false) })
            }}
          />
          <button type="button" className="dsh-df-btn-primary" onClick={() => { setModalOpen(true) }}>+ 新建流程</button>
        </div>
      </div>

      {total === 0 ? (
        <div className="dsh-df-empty">
          {search.trim().length > 0
            ? `没有匹配「${search.trim()}」的流程。`
            : `这个网站还没有${kind === 'page' ? '页面编排' : '接口编排'}流程。`}
        </div>
      ) : null}

      {domains.map(([domain, list]) => {
        const collapsed = collapsedDomains.has(domain)
        return (
          <div key={domain} className={`dsh-df-domain${collapsed ? ' dsh-df-collapsed' : ''}`}>
            <button type="button" className="dsh-df-domain-head" onClick={() => { onToggleDomain(domain) }}>
              <span className="dsh-df-lv dsh-df-lv-1">业务域</span>
              <span className="dsh-df-dname">{domain}</span>
              <span className="dsh-df-meta">{list.length} 条流程</span>
              <span className="dsh-df-caret">▼</span>
            </button>
            <div className="dsh-df-domain-body">
              {list.map((item) => {
                const key = `${item.site}/${item.flow}`
                const flowCollapsed = collapsedFlows.has(key)
                const latest = item.versions.find((version) => version.version === item.latest)
                return (
                  <div key={key} className={`dsh-df-flow${flowCollapsed ? ' dsh-df-collapsed' : ''}`}>
                    <button type="button" className="dsh-df-flow-head" onClick={() => { onToggleFlow(key) }}>
                      <span className="dsh-df-lv dsh-df-lv-2">流程</span>
                      <span className="dsh-df-fname">{item.flow}</span>
                      <span className="dsh-df-meta">
                        {item.nodeCount ?? 0} {item.kind === 'interface-chain' ? '接口' : '页面'}节点 ·
                        更新于 {formatTime(item.updatedAt)}
                      </span>
                      <span className="dsh-df-caret">▼</span>
                    </button>
                    <div className="dsh-df-flow-body">
                      {item.unreadable === undefined ? null : (
                        <div className="dsh-df-errline">最新版本读不出来：{item.unreadable}</div>
                      )}
                      {item.versions.map((version) => {
                        const current = version.version === item.latest
                        return (
                          <div key={version.version} className="dsh-df-ver">
                            <span className="dsh-df-lv dsh-df-lv-3">版本</span>
                            <span className={`dsh-df-vtag${current ? ' dsh-df-cur' : ''}`}>
                              v{version.version}{current ? ' · 当前' : ''}
                            </span>
                            <span className="dsh-df-vmeta">
                              {formatTime(version.created)} · 由 {sourceLabel(version.source)} · {version.nodeCount ?? 0} 节点
                              {version.unreadable === undefined ? '' : ` · 读不出来：${version.unreadable}`}
                            </span>
                            <button
                              type="button"
                              className={current ? 'dsh-df-btn-primary' : 'dsh-df-btn'}
                              onClick={() => { onOpenGraphs(item) }}
                            >
                              查看编排图
                            </button>
                          </div>
                        )
                      })}
                      {item.versions.length === 0 ? (
                        <div className="dsh-df-sub">该流程没有可读版本</div>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      <PagerBar
        total={<>共 <b>{total}</b> 条{kind === 'page' ? '页面编排' : '接口编排'}流程</>}
        unit="条"
        page={page}
        pages={pages}
        pageSize={pageSize}
        sizeOptions={sizeOptions}
        onPage={onPage}
        onPageSize={onPageSize}
      />

      {modalOpen ? (
        <NewFlowModal
          kind={kind}
          onClose={() => { setModalOpen(false) }}
          onCreate={(draft) => { setModalOpen(false); onCreated(draft) }}
        />
      ) : null}
    </>
  )
}

function NewFlowModal(props: {
  kind: KindTab
  onClose: () => void
  onCreate: (draft: { flow: string; kind: KindTab; domain: string; note: string }) => void
}): ReactNode {
  const { kind, onClose, onCreate } = props
  const [flow, setFlow] = useState('')
  const [domain, setDomain] = useState('')
  const [note, setNote] = useState('')
  const [draftKind, setDraftKind] = useState<KindTab>(kind)
  const trimmed = flow.trim()
  return (
    <div className="dsh-df-modal-mask" role="dialog" aria-modal="true">
      <div className="dsh-df-modal">
        <h2>新建流程</h2>
        <p className="dsh-df-sub">
          创建后进入空白画布；首次「保存为新版本」才会落盘（链至少要有一个节点才合法）。
        </p>
        <div className="dsh-df-field">
          <label>流程名称 *</label>
          <input value={flow} placeholder="例如：采购下单动线" onChange={(event) => { setFlow(event.target.value) }} />
        </div>
        <div className="dsh-df-row2">
          <div className="dsh-df-field">
            <label>编排类型 *</label>
            <select value={draftKind} onChange={(event) => { setDraftKind(event.target.value as KindTab) }}>
              <option value="page">页面编排（跨页面业务流程）</option>
              <option value="api">接口编排（接口调用依赖 DAG）</option>
            </select>
          </div>
          <div className="dsh-df-field">
            <label>业务域</label>
            <input value={domain} placeholder="例如：采购域（留空则未分组）" onChange={(event) => { setDomain(event.target.value) }} />
          </div>
        </div>
        <div className="dsh-df-field">
          <label>备注</label>
          <textarea rows={2} value={note} onChange={(event) => { setNote(event.target.value) }} />
        </div>
        <div className="dsh-df-modal-ops">
          <button type="button" className="dsh-df-btn" onClick={onClose}>取消</button>
          <button
            type="button"
            className="dsh-df-btn-primary"
            disabled={trimmed.length === 0}
            onClick={() => { onCreate({ flow: trimmed, kind: draftKind, domain: domain.trim(), note: note.trim() }) }}
          >
            创建并进入画布
          </button>
        </div>
      </div>
    </div>
  )
}

/* ───────────────────────── ③ 编排图列表 ───────────────────────── */

function GraphsView(props: {
  flow: OrchestrationFlow
  versions: OrchestrationVersion[]
  total: number
  page: number
  pageSize: number
  sizeOptions: readonly number[]
  busy: boolean
  onPage: (page: number) => void
  onPageSize: (size: number) => void
  onBack: () => void
  onOpenCanvas: (version: number) => void
}): ReactNode {
  const { flow, versions, total, page, pageSize, sizeOptions, busy, onPage, onPageSize, onBack, onOpenCanvas } = props
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <>
      <div className="dsh-df-crumb">
        <button type="button" onClick={onBack}>← 返回流程列表</button>
        <span>/</span>
        <span>编排</span>
        <span>/</span>
        <b>{flow.site}</b>
        <span>/</span>
        <b>{flow.flow}</b>
      </div>
      <div className="dsh-df-view-head">
        <h1>
          编排图
          <span className="dsh-df-lv dsh-df-lv-2">{KIND_LABELS[flow.kind ?? ''] ?? '未标注类型'}</span>
        </h1>
        <span className="dsh-df-sub">该流程各版本的编排图 · 点「打开画布」进入编辑</span>
      </div>

      {versions.map((version) => {
        const current = version.version === flow.latest
        return (
          <div key={version.version} className="dsh-df-graph">
            <svg className="dsh-df-thumb" viewBox="0 0 132 64" aria-hidden="true">
              <rect x="6" y="24" width="22" height="14" rx="4" fill="#fff" stroke="#3b6ef0" />
              <rect x="46" y="10" width="26" height="14" rx="4" fill="#fff" stroke="#3b6ef0" />
              <rect x="46" y="40" width="26" height="14" rx="4" fill="#fff" stroke="#3b6ef0" />
              <rect x="92" y="24" width="28" height="14" rx="4" fill="#fff" stroke="#3b6ef0" />
              <path d="M28 31 L46 17 M28 31 L46 47 M72 17 L92 29 M72 47 L92 33" stroke="#86909c" fill="none" />
            </svg>
            <div className="dsh-df-info">
              <div className="dsh-df-gname">
                {flow.flow}
                <span className={`dsh-df-vtag${current ? ' dsh-df-cur' : ''}`}>
                  v{version.version}{current ? ' · 当前' : ''}
                </span>
              </div>
              <div className="dsh-df-gmeta">
                <span>节点 <b>{version.nodeCount ?? 0}</b></span>
                <span>边 <b>{version.edgeCount ?? 0}</b></span>
                <span>更新于 <b>{formatTime(version.created)}</b></span>
                <span>来源 <b>{sourceLabel(version.source)}</b></span>
                {current ? null : <span>已被 v{flow.latest} 取代</span>}
                {version.unreadable === undefined ? null : <span>读不出来：{version.unreadable}</span>}
              </div>
            </div>
            <div className="dsh-df-gops">
              <button type="button" className="dsh-df-btn" disabled={busy} onClick={() => { onOpenCanvas(version.version) }}>
                打开画布
              </button>
            </div>
          </div>
        )
      })}

      {total === 0 ? <div className="dsh-df-empty">该流程还没有可读版本。</div> : null}

      <PagerBar
        total={<>共 <b>{total}</b> 张编排图</>}
        unit="张"
        page={page}
        pages={pages}
        pageSize={pageSize}
        sizeOptions={sizeOptions}
        onPage={onPage}
        onPageSize={onPageSize}
      />
    </>
  )
}

/* ───────────────────────── 分页条 ───────────────────────── */

/**
 * 分页条（原型 .pagerbar）：左边「共 N …」+「每页 N 条」下拉，右边页码。
 *
 * 下拉是真的生效（改 pageSize 并回到第 1 页），不是原型里的装饰控件——
 * 假控件比没有更糟：用户会以为点了没反应。
 */
function PagerBar(props: {
  total: ReactNode
  unit: string
  page: number
  pages: number
  pageSize: number
  sizeOptions: readonly number[]
  onPage: (page: number) => void
  onPageSize: (size: number) => void
}): ReactNode {
  const { total, unit, page, pages, pageSize, sizeOptions, onPage, onPageSize } = props
  return (
    <div className="dsh-df-pagerbar">
      <span className="dsh-df-total">{total}</span>
      <select
        className="dsh-df-select dsh-df-pagesize"
        value={pageSize}
        aria-label={`每页${unit}数`}
        onChange={(event) => { onPageSize(Number(event.target.value)) }}
      >
        {sizeOptions.map((size) => (
          <option key={size} value={size}>{size} {unit}/页</option>
        ))}
      </select>
      <Pager page={page} pages={pages} onPage={onPage} />
    </div>
  )
}

/** 右下角「层级图例」（原型 .legend）：编排页三级结构的自解释卡片。 */
function HierarchyLegend(): ReactNode {
  return (
    <aside className="dsh-df-legend dsh-df-legend-stack">
      <b>层级图例</b>
      <div><span className="dsh-df-lv dsh-df-lv-1">网站 / 业务域</span><span>一级：先选网站，流程按业务域分组</span></div>
      <div><span className="dsh-df-lv dsh-df-lv-2">流程</span><span>二级：页面编排 / 接口编排下的业务流程</span></div>
      <div><span className="dsh-df-lv dsh-df-lv-3">版本</span><span>三级：流程的版本快照，点「查看编排图」进编排图列表（分页）→ 打开画布</span></div>
    </aside>
  )
}

function Pager(props: { page: number; pages: number; onPage: (page: number) => void }): ReactNode {
  const { page, pages, onPage } = props
  const numbers = pageNumbers(page, pages)
  return (
    <div className="dsh-df-pages">
      <button type="button" className="dsh-df-pg" disabled={page <= 1} onClick={() => { onPage(page - 1) }}>‹</button>
      {numbers.map((value) => (
        <button
          key={value}
          type="button"
          className="dsh-df-pg"
          aria-current={value === page}
          onClick={() => { onPage(value) }}
        >
          {value}
        </button>
      ))}
      <button type="button" className="dsh-df-pg" disabled={page >= pages} onClick={() => { onPage(page + 1) }}>›</button>
    </div>
  )
}

/** 页码收敛：页数少就全列，多则首尾 + 当前邻近。 */
export function pageNumbers(page: number, pages: number): number[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1)
  const set = new Set<number>([1, pages, page, page - 1, page + 1])
  return [...set].filter((value) => value >= 1 && value <= pages).sort((left, right) => left - right)
}
