/**
 * 运行产物只读面板数据面：`/dashboard/api/dataforge/artifacts/*`
 *
 *   GET /artifacts                  数据根下 dataset + evidence 列表
 *   GET /artifacts/:runId/report    evidence report.html
 *   GET /artifacts/:runId/dataset   datasets/<runId>.json
 *   GET /artifacts/:runId/asset?name=success.png|failure.png|failure.html
 *
 * 只读、无写入口；runId 与 asset 名都白名单校验，不拼用户输入到路径。
 *
 * @module dsh-dataforge/datasets/panel-routes
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const ARTIFACTS_API_PREFIX = '/artifacts'

export type ArtifactRow = {
  runId: string
  kind: 'chain' | 'ui' | 'unknown'
  status?: string
  site?: string
  flow?: string
  createdAt?: string
  hasDataset: boolean
  hasReport: boolean
  datasetSize?: number
}

export type ArtifactsPanelDeps = {
  dataRoot: string
}

type Envelope = { success: true; data: unknown } | { success: false; error: string; code?: string }

function sendJson(res: ServerResponse, status: number, body: Envelope): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function ok(res: ServerResponse, data: unknown): void {
  sendJson(res, 200, { success: true, data })
}

function fail(res: ServerResponse, status: number, error: string, code?: string): void {
  sendJson(res, status, { success: false, error, ...(code === undefined ? {} : { code }) })
}

function stripPrefix(pathname: string): string | undefined {
  const full = `/dashboard/api/dataforge${ARTIFACTS_API_PREFIX}`
  if (pathname.startsWith(full)) return pathname.slice(full.length) || '/'
  if (pathname.startsWith(ARTIFACTS_API_PREFIX)) return pathname.slice(ARTIFACTS_API_PREFIX.length) || '/'
  return undefined
}

function readDataset(dataRoot: string, runId: string): Record<string, unknown> | undefined {
  const path = join(dataRoot, 'datasets', `${runId}.json`)
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

function kindOf(dataset: Record<string, unknown> | undefined): ArtifactRow['kind'] {
  const kind = dataset?.['kind']
  if (kind === 'ui-run-dataset') return 'ui'
  if (kind === 'run-dataset') return 'chain'
  return 'unknown'
}

function listArtifacts(dataRoot: string): ArtifactRow[] {
  const runIds = new Set<string>()
  const datasetDir = join(dataRoot, 'datasets')
  if (existsSync(datasetDir)) {
    for (const name of readdirSync(datasetDir)) {
      if (name.endsWith('.json')) runIds.add(name.slice(0, -'.json'.length))
    }
  }
  const evidenceDir = join(dataRoot, 'evidence')
  if (existsSync(evidenceDir)) {
    for (const name of readdirSync(evidenceDir)) {
      try {
        if (statSync(join(evidenceDir, name)).isDirectory()) runIds.add(name)
      } catch {
        // 坏目录跳过
      }
    }
  }
  const rows: ArtifactRow[] = []
  for (const runId of runIds) {
    if (!/^[A-Za-z0-9._-]+$/.test(runId)) continue
    const dataset = readDataset(dataRoot, runId)
    let datasetSize: number | undefined
    try {
      const stat = statSync(join(datasetDir, `${runId}.json`))
      datasetSize = stat.size
    } catch {
      datasetSize = undefined
    }
    const reportPath = join(evidenceDir, runId, 'report.html')
    rows.push({
      runId,
      kind: kindOf(dataset),
      ...(typeof dataset?.['status'] === 'string' ? { status: dataset['status'] } : {}),
      ...(typeof dataset?.['site'] === 'string' ? { site: dataset['site'] } : {}),
      ...(typeof dataset?.['flow'] === 'string' ? { flow: dataset['flow'] } : {}),
      ...(typeof dataset?.['createdAt'] === 'string' ? { createdAt: dataset['createdAt'] } : {}),
      hasDataset: dataset !== undefined,
      hasReport: existsSync(reportPath),
      ...(datasetSize === undefined ? {} : { datasetSize }),
    })
  }
  return rows.sort((left, right) => String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? '')))
}

function sendFile(res: ServerResponse, path: string, contentType: string): void {
  if (!existsSync(path)) {
    fail(res, 404, '产物不存在', 'not-found')
    return
  }
  res.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store' })
  res.end(readFileSync(path))
}

/**
 * 构造 artifacts handler；返回 true = 已接管，false = 不是 /artifacts 路径。
 */
export function createArtifactsPanelHandler(
  deps: ArtifactsPanelDeps,
): (req: IncomingMessage, res: ServerResponse) => boolean {
  return (req, res) => {
    const url = new URL(req.url ?? '/', 'http://panel.localhost')
    const suffix = stripPrefix(url.pathname)
    if (suffix === undefined) return false
    const method = (req.method ?? 'GET').toUpperCase()
    if (method !== 'GET') {
      fail(res, 405, '运行产物只读：只支持 GET', 'method-not-allowed')
      return true
    }
    if (suffix === '/' || suffix === '') {
      const all = listArtifacts(deps.dataRoot)
      const kind = url.searchParams.get('kind')
      const status = url.searchParams.get('status')
      const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
      const filtered = all.filter((row) => {
        if (kind !== null && kind !== '' && row.kind !== kind) return false
        if (status !== null && status !== '' && row.status !== status) return false
        if (q !== '' && !`${row.runId} ${row.site ?? ''} ${row.flow ?? ''}`.toLowerCase().includes(q)) return false
        return true
      })
      const limitRaw = Number(url.searchParams.get('limit') ?? '50')
      const offsetRaw = Number(url.searchParams.get('offset') ?? '0')
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 200) : 50
      const offset = Number.isFinite(offsetRaw) ? Math.max(Math.floor(offsetRaw), 0) : 0
      ok(res, { artifacts: filtered.slice(offset, offset + limit), total: filtered.length, limit, offset })
      return true
    }
    const match = /^\/([A-Za-z0-9._-]+)\/(report|dataset|asset|success\.png|failure\.png|failure\.html)$/.exec(suffix)
    if (match === null) {
      fail(res, 404, `不认识的产物路径：${suffix}`, 'unknown-path')
      return true
    }
    const runId = match[1] as string
    const kind = match[2]
    if (kind === 'success.png' || kind === 'failure.png' || kind === 'failure.html') {
      sendFile(res, join(deps.dataRoot, 'evidence', runId, kind), kind.endsWith('.html') ? 'text/html; charset=utf-8' : 'image/png')
      return true
    }
    if (kind === 'report') {
      sendFile(res, join(deps.dataRoot, 'evidence', runId, 'report.html'), 'text/html; charset=utf-8')
      return true
    }
    if (kind === 'dataset') {
      sendFile(res, join(deps.dataRoot, 'datasets', `${runId}.json`), 'application/json; charset=utf-8')
      return true
    }
    const name = url.searchParams.get('name') ?? ''
    if (name !== 'success.png' && name !== 'failure.png' && name !== 'failure.html') {
      fail(res, 400, '证据文件名只支持 success.png / failure.png / failure.html', 'bad-evidence')
      return true
    }
    sendFile(res, join(deps.dataRoot, 'evidence', runId, name), name.endsWith('.html') ? 'text/html; charset=utf-8' : 'image/png')
    return true
  }
}
