/**
 * 运行产物（只读）：dataset/evidence 列表 + report/dataset 直链。
 *
 * 数据来自 `GET /artifacts`（只读，支持 kind/status/q/limit/offset）；不提供删除/重跑入口。
 *
 * @module dsh-dataforge/client/page-artifacts
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { artifactUrl, fetchArtifacts } from './api.js'
import { formatTime } from './format.js'
import type { ArtifactRow } from './types.js'

export interface ArtifactsPageProps {
  visible: boolean
}

const PAGE_SIZE = 20

function kindLabel(kind: ArtifactRow['kind']): string {
  if (kind === 'chain') return '接口链'
  if (kind === 'ui') return 'UI 回放'
  return '未知'
}

function statusClass(status: string | undefined): string {
  if (status === 'completed' || status === 'success') return 'dsh-df-done'
  if (status === 'failed' || status === 'error') return 'dsh-df-err-soft'
  return 'dsh-df-doing'
}

function sizeLabel(size: number | undefined): string {
  if (size === undefined) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

export function ArtifactsPage({ visible }: ArtifactsPageProps): ReactNode {
  const [rows, setRows] = useState<ArtifactRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(undefined)
    try {
      const data = await fetchArtifacts({ limit: PAGE_SIZE, offset: page * PAGE_SIZE, kind, status, q })
      setRows(data.artifacts)
      setTotal(data.total)
    } catch (err) {
      setError(String((err as Error)?.message ?? err))
    } finally {
      setLoading(false)
    }
  }, [kind, page, q, status])

  useEffect(() => {
    if (visible) void load()
  }, [visible, load])

  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1)
  const changeFilter = (next: () => void): void => {
    setPage(0)
    next()
  }

  return (
    <section className="dsh-df-page" aria-label="运行产物">
      <div className="dsh-df-head">
        <h2>运行产物</h2>
        <span className="dsh-df-badge">{total}</span>
        <span className="dsh-df-grow" />
        <button className="dsh-df-btn dsh-df-btn-ghost" type="button" onClick={() => { void load() }} disabled={loading}>
          {loading ? '刷新中…' : '刷新'}
        </button>
      </div>
      <p className="dsh-df-hint">只读：dataset JSON + evidence report/截图；不提供删除/重跑。</p>
      <div className="dsh-df-toolbar">
        <input
          className="dsh-df-search"
          value={q}
          placeholder="搜 runId / 站点 / 流程"
          onChange={(event) => { changeFilter(() => { setQ(event.target.value) }) }}
        />
        <select className="dsh-df-select" value={kind} onChange={(event) => { changeFilter(() => { setKind(event.target.value) }) }}>
          <option value="">全部类型</option>
          <option value="chain">接口链</option>
          <option value="ui">UI 回放</option>
        </select>
        <select className="dsh-df-select" value={status} onChange={(event) => { changeFilter(() => { setStatus(event.target.value) }) }}>
          <option value="">全部状态</option>
          <option value="completed">completed</option>
          <option value="success">success</option>
          <option value="failed">failed</option>
        </select>
      </div>
      {error === undefined ? null : <div className="dsh-df-err">{error}</div>}
      {rows.length === 0 && !loading ? (
        <div className="dsh-df-empty">
          <p>没有匹配的运行产物。</p>
          <p className="dsh-df-empty-hint">跑一次链或 UI 回放，再用 dataforge_dataset_export 导出。</p>
        </div>
      ) : (
        <div className="dsh-df-list">
          {rows.map((row) => (
            <div className="dsh-df-row" key={row.runId}>
              <div className="dsh-df-grow">
                <div>
                  <span className={`dsh-df-badge ${statusClass(row.status)}`}>{row.status ?? 'unknown'}</span>
                  <strong>{row.site ?? '未标站点'} / {row.flow ?? '未标流程'}</strong>
                  <span className="dsh-df-badge">{kindLabel(row.kind)}</span>
                </div>
                <div className="dsh-df-hint">
                  <code>{row.runId}</code>
                  {row.createdAt === undefined ? '' : ` ｜ ${formatTime(row.createdAt)}`}
                  {row.datasetSize === undefined ? '' : ` ｜ ${sizeLabel(row.datasetSize)}`}
                </div>
              </div>
              <div className="dsh-df-gops">
                {row.hasReport ? <a className="dsh-df-btn dsh-df-btn-ghost" href={artifactUrl(row.runId, 'report')} target="_blank" rel="noreferrer">报告</a> : null}
                {row.hasDataset ? <a className="dsh-df-btn dsh-df-btn-ghost" href={artifactUrl(row.runId, 'dataset')} target="_blank" rel="noreferrer">dataset</a> : null}
              </div>
            </div>
          ))}
        </div>
      )}
      {total > PAGE_SIZE ? (
        <div className="dsh-df-pagerbar">
          <button className="dsh-df-btn dsh-df-btn-ghost" type="button" disabled={page <= 0 || loading} onClick={() => { setPage((value) => Math.max(0, value - 1)) }}>
            上一页
          </button>
          <span className="dsh-df-hint">第 {page + 1} / {maxPage + 1} 页</span>
          <button className="dsh-df-btn dsh-df-btn-ghost" type="button" disabled={page >= maxPage || loading} onClick={() => { setPage((value) => Math.min(maxPage, value + 1)) }}>
            下一页
          </button>
        </div>
      ) : null}
    </section>
  )
}
