/**
 * 快速采集页（原型 docs/prototypes/quick-capture.html）—— 双列布局：
 * 左「发起采集 / 本次进度 / 边界说明」，右「按 页面 → 接口 → 形态 组装的结果文档」。
 *
 * 边界（FR-7.6）：面板只开 single_page；进度轮询只在进行中发生（收口即停；不可见不打请求）。
 * 呈现纪律：诚实三态；原型步骤时间线的时间戳没有数据支撑——进度改为三个由 run.status
 * 派生的阶段，不造数据；用户数据只进 JSX 文本节点，零 dangerouslySetInnerHTML。
 *
 * @module dsh-dataforge/client/page-capture
 */
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { fetchRunDetail, postCapture } from './api.js'
import { AuthBlock, Legend, MethodBadge, PagerBar, ShapesBlock, TemplateBlock } from './card-parts.js'
import { AUTH_TYPE_LABELS, CAPTURE_POLL_MS, IFACES_PER_PAGE, STATUS_LABELS } from './dom.js'
import { fmtShort } from './el.js'
import { pageIdentityOf } from '../shared/page-url.js'
import { groupByPage, shapeStats, type GroupedPage } from './grouping.js'
import type { CardRow, RecaptureSeed, RelationRow, RunDetail } from './types.js'

export interface QuickCapturePageProps {
  /** 可见性门闩：false 时轮询 tick 直接跳过。 */
  visible: boolean
  /** 站点页「重采」跨页动线：变化一次就预填一次输入框。 */
  seed?: RecaptureSeed
}

function errText(err: unknown): string {
  return (err as Error)?.message ?? String(err)
}

function entryUrl(raw: string): string {
  if (raw.length === 0 || raw.startsWith('http://') || raw.startsWith('https://')) return raw
  return `https://${raw}`
}

export function QuickCapturePage({ visible, seed }: QuickCapturePageProps): ReactNode {
  const [url, setUrl] = useState('')
  const [sending, setSending] = useState(false)
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | undefined>()
  const [captureId, setCaptureId] = useState<string | undefined>()
  const [detail, setDetail] = useState<RunDetail | undefined>()
  const [detailError, setDetailError] = useState<string | undefined>()

  useEffect(() => {
    if (seed !== undefined) setUrl(seed.url)
  }, [seed])

  const visibleRef = useMemo(() => ({ current: visible }), [])
  visibleRef.current = visible

  useEffect(() => {
    if (captureId === undefined) return undefined
    let alive = true
    let timer: ReturnType<typeof setInterval> | undefined
    const stop = (): void => {
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
    }
    void tick()
    timer = setInterval(() => { void tick() }, CAPTURE_POLL_MS)
    return () => { alive = false; stop() }

    async function tick(): Promise<void> {
      const id = captureId
      if (id === undefined || !visibleRef.current) return
      let fetched: RunDetail
      try {
        fetched = await fetchRunDetail(id)
      } catch (err) {
        if (!alive) return
        stop()
        setDetailError(`进度取数失败：${errText(err)}`)
        return
      }
      if (!alive) return
      setDetail(fetched)
      setDetailError(undefined)
      if (fetched.run.status !== 'running') stop()
    }
  }, [captureId, visibleRef])

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const target = entryUrl(url.trim())
    if (target.length === 0) {
      setOutcome({ ok: false, text: '请先输入页面 URL' })
      return
    }
    setOutcome({ ok: true, text: '发起中…' })
    setSending(true)
    setCaptureId(undefined)
    setDetail(undefined)
    setDetailError(undefined)
    try {
      const result = await postCapture('single_page', target)
      if (result.accepted && result.captureId !== undefined) {
        setCaptureId(result.captureId)
        setOutcome({ ok: true, text: `已发起（captureId ${result.captureId}）——左侧实时更新进度，收口后出接口文档。` })
        return
      }
      setOutcome({
        ok: false,
        text: result.accepted === false
          ? `未能发起：${result.gate}${result.card === undefined ? '' : `\n${result.card}`}`
          : `发起失败：面板信封异常`,
      })
    } catch (err) {
      setOutcome({ ok: false, text: `发起失败：${errText(err)}` })
    } finally {
      setSending(false)
    }
  }

  const run = detail?.run
  const running = run?.status === 'running'
  const statusLabel = run === undefined ? undefined : STATUS_LABELS[run.status] ?? run.status

  return (
    <div className="dsh-df-page-spl">
      {/* 左列三块卡必须包在 aside 里：否则 grid 自动排布会把「本次进度」放进右列、
          「采集结果」挤到第二行，结果区既不在顶上也更容易被视口裁掉。原型 .page > aside 同款。 */}
      <aside>
        <section className="dsh-df-card">
          <h2>发起采集</h2>
          <p className="dsh-df-sub">对单个页面发起，把它的 XHR / fetch 沉淀成接口卡。</p>
          <form onSubmit={(event) => { void submit(event) }}>
            <input
              className="dsh-df-url-input"
              type="url"
              name="entryUrl"
              placeholder="https://example.com/page（单页入口）"
              autoComplete="off"
              spellCheck={false}
              style={{ marginTop: 10, display: 'block' }}
              value={url}
              onChange={(event) => { setUrl(event.target.value) }}
            />
            <div className="dsh-df-mode-tag">单页 · 只读 · 静止期监听</div>
            <button className="dsh-df-btn-primary dsh-df-btn-block" type="submit" disabled={sending}>发起采集</button>
          </form>
          {outcome !== undefined && (
            <div
              className={outcome.ok ? 'dsh-df-noticeline' : 'dsh-df-errline'}
              style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}
            >
              {outcome.text}
            </div>
          )}
        </section>
        <section className="dsh-df-card">
          <h2>
            本次进度
            {statusLabel !== undefined && <span className={`dsh-df-badge ${run?.status ?? ''}`}>{statusLabel}</span>}
          </h2>
          {detail === undefined && detailError === undefined && (
            <p className="dsh-df-sub">还没发起。发起后这里出现实时进度与统计。</p>
          )}
          {detailError !== undefined && <div className="dsh-df-errline">{detailError}</div>}
          {detail !== undefined && run !== undefined && (
            <>
              <div className="dsh-df-stat-grid">
                <div className="dsh-df-stat"><b>{run.stats.pages}</b><span>页面</span></div>
                <div className="dsh-df-stat"><b>{run.stats.requests}</b><span>样本</span></div>
                <div className="dsh-df-stat"><b>{run.stats.cards}</b><span>接口</span></div>
                <div className="dsh-df-stat"><b>{run.stats.credentials}</b><span>凭证</span></div>
              </div>
              <ul className="dsh-df-steps">
                <li className="dsh-df-done">
                  发起采集
                  <small>{`${fmtShort(run.startedAt)} · captureId ${run.id}`}</small>
                </li>
                <li className={running ? 'dsh-df-doing' : 'dsh-df-done'}>
                  静止期监听 XHR / fetch
                  <small>
                    {running
                      ? `进行中 · 已捕获 ${run.stats.requests} 个请求样本`
                      : `共捕获 ${run.stats.requests} 个请求样本`}
                  </small>
                </li>
                <li className={running ? undefined : 'dsh-df-done'}>
                  归并收口出接口文档
                  <small>
                    {running
                      ? '等待页面静止，收口后出文档'
                      : `${run.stats.cards} 个接口卡${run.endedAt === undefined ? '' : ` · 收口于 ${fmtShort(run.endedAt)}`}`}
                  </small>
                </li>
              </ul>
              {run.error !== undefined && run.error.length > 0 && <div className="dsh-df-errline">{run.error}</div>}
              {run.notice !== undefined && run.notice.length > 0 && <div className="dsh-df-noticeline">{run.notice}</div>}
              {running && <p className="dsh-df-sub">{`每 ${CAPTURE_POLL_MS / 1000} 秒刷新，收口后自动停止。`}</p>}
            </>
          )}
        </section>
        <section className="dsh-df-card">
          <h2>边界说明</h2>
          <div className="dsh-df-kv">只走 HTTP 请求洞察：不点按钮、不填表单、不执行写操作。</div>
          <div className="dsh-df-kv">静止期窗口：页面加载完成后继续监听一小段时间，收走 XHR / fetch。</div>
          <div className="dsh-df-kv">要驱动真实交互（登录、翻页、提交）→ 用 agent 会话 dataforge_capture。</div>
          <div className="dsh-df-kv">凭证只记标志与来源，原文不进卡、不出路由。</div>
        </section>
      </aside>
      <main>
        <div className="dsh-df-doc-head">
          <h1>采集结果</h1>
          <div className="dsh-df-summary">
            {detail === undefined
              ? '还没有进行中的采集'
              : running === true
                ? '采集中——收口后自动出文档'
                : `${detail.cards?.length ?? 0} 个接口卡`}
          </div>
        </div>
        {detail === undefined && (
          <div className="dsh-df-empty">
            <b>发起一次采集</b>后，这里会出现按「页面 → 接口 → 形态」组装的接口文档。
          </div>
        )}
        {detail !== undefined && running === true && (
          <div className="dsh-df-empty">
            <b>采集进行中</b>——收口后这里出现按「页面 → 接口 → 形态」组装的接口文档。
          </div>
        )}
        {detail !== undefined && running === false && <ResultDoc detail={detail} />}
        <Legend
          entries={[
            { level: 1, label: '页面' },
            { level: 2, label: '接口' },
            { level: 3, label: '形态' },
          ]}
        />
      </main>
    </div>
  )
}

/** 结果文档：页面 → 接口 → 形态（分组逻辑在 grouping.ts，纯函数可单测）。 */
function ResultDoc({ detail }: { detail: RunDetail }): ReactNode {
  const cards = detail.cards ?? []
  if (cards.length === 0) {
    return (
      <div className="dsh-df-empty">
        <b>本页没有采到 XHR/fetch 接口</b>——页面可能是纯静态，或接口在登录/交互之后才发。
        可换页或用 agent 会话驱动交互再采。
      </div>
    )
  }
  // 页面名（采集时记录的 document.title）按页面身份匹配：分组用的展示 URL 可能是
  // 同一 SPA 页面的另一个变体，直接按字面 URL 查会漏。
  const titlesByPage = new Map<string, string>()
  for (const page of detail.pages) {
    const title = page.title?.trim()
    if (title === undefined || title === '') continue
    const identity = pageIdentityOf(page.url)
    if (!titlesByPage.has(identity)) titlesByPage.set(identity, title)
  }
  const groups = groupByPage(cards, detail.relations ?? [])
  const shapeTotal = cards.reduce((sum, card) => sum + shapeStats(card, detail.relations ?? []).shapes, 0)
  return (
    <>
      <div className="dsh-df-summary" style={{ marginBottom: 12 }}>
        {`${groups.length} 个页面 · ${cards.length} 个接口 · ${shapeTotal} 个形态`}
      </div>
      {groups.map((group) => (
        <PageNode group={group} key={group.pageUrl} title={titlesByPage.get(pageIdentityOf(group.pageUrl))} />
      ))}
    </>
  )
}

function PageNode({ group, title }: { group: GroupedPage; title?: string }): ReactNode {
  const [open, setOpen] = useState(true)
  // 接口分页：页面节点展开后默认只渲染当前页，几百个接口不会把结果文档拉成一条长龙。
  const [page, setPage] = useState(0)
  const pageCards = group.cards
  const shapeSum = pageCards.reduce(
    (sum, entry) => sum + shapeStats(entry.card, entry.relations).shapes,
    0,
  )
  const totalPages = Math.max(1, Math.ceil(pageCards.length / IFACES_PER_PAGE))
  const effectivePage = Math.min(page, totalPages - 1)
  const first = effectivePage * IFACES_PER_PAGE
  const shown = pageCards.slice(first, first + IFACES_PER_PAGE)
  return (
    <div className={`dsh-df-page-node${open ? '' : ' dsh-df-collapsed'}`}>
      <button
        className="dsh-df-pn-head"
        type="button"
        onClick={() => { setOpen((value) => !value) }}
      >
        <span className="dsh-df-lv dsh-df-lv1">页面</span>
        <span className="dsh-df-pn-names">
          {title !== undefined && <span className="dsh-df-pn-title">{title}</span>}
          <span className={title === undefined ? 'dsh-df-pn-name dsh-df-mono' : 'dsh-df-pn-url dsh-df-mono'}>{group.pageUrl}</span>
        </span>
        <span className="dsh-df-pn-meta">
          {`${pageCards.length} 接口 · ${shapeSum} 形态`}
        </span>
        <span className="dsh-df-caret">▾</span>
      </button>
      {open && (
        <div className="dsh-df-pn-body">
          {shown.map((entry) => (
            <IfaceCard key={entry.card.id} card={entry.card} relations={entry.relations} />
          ))}
          <PagerBar
            page={effectivePage}
            totalPages={totalPages}
            label={`第 ${first + 1}–${first + shown.length} / 共 ${pageCards.length} 接口`}
            onGoto={setPage}
            ariaLabel="接口分页"
          />
        </div>
      )}
    </div>
  )
}

function IfaceCard({ card, relations }: { card: CardRow; relations: RelationRow[] }): ReactNode {
  const [open, setOpen] = useState(false)
  const stats = shapeStats(card, relations)
  return (
    <div className={`dsh-df-iface-card${open ? ' dsh-df-open' : ''}`}>
      <button className="dsh-df-iface-head" type="button" onClick={() => { setOpen((value) => !value) }}>
        <MethodBadge method={card.method} />
        <span className="dsh-df-grow">{card.name ?? '未命名接口'}</span>
        <span className="dsh-df-caret">▾</span>
      </button>
      <span className="dsh-df-iface-url">{card.urlTemplate}</span>
      <div className="dsh-df-iface-chips">
        <span><b>{stats.shapes}</b> 形态</span>
        <span><b>{stats.samples}</b> 样本</span>
        <span>鉴权 {card.authType === undefined ? '未探测' : AUTH_TYPE_LABELS[card.authType] ?? card.authType}</span>
      </div>
      {open && (
        <div className="dsh-df-iface-detail" onClick={(event) => { event.stopPropagation() }}>
          <TemplateBlock title="请求模板" template={card.requestTemplate} />
          <TemplateBlock title="响应模板" template={card.responseTemplate} />
          <AuthBlock card={card} />
          <ShapesBlock relations={relations} />
        </div>
      )}
    </div>
  )
}
