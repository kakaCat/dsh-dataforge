/**
 * 从采集库只读读取一条 capture 的 trace。
 *
 * 只读纪律与接口库导入一致：`readonly: true, fileMustExist: true`，不建表、不写事件。
 * 正文读取顺序：落盘文件（完整）→ DB 预览（最多 512 字符）→ 缺失；截断必须如实标注。
 *
 * @module dsh-dataforge/trace/read
 */
import Database from 'better-sqlite3'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type {
  Trace, TraceBodySource, TraceFailure, TraceHeaders, TraceReadOptions, TraceSample, TraceStats, TraceWarning,
} from './types.js'

const SENSITIVE_HEADER = /authorization|proxy-authorization|cookie|set-cookie|token|secret|password|api[-_]?key|session/i
const SENSITIVE_BODY_KEY = /authorization|cookie|token|secret|password|api[-_]?key|session/i
const PREVIEW_CAP = 512

export type TraceReadDeps = {
  /** `dataRoot/capture/capture.sqlite`。 */
  captureDbPath: string
  /** `dataRoot/capture/samples`（落盘正文的根）。 */
  samplesDir: string
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.floor(value), min), max)
}

function failure(code: TraceFailure['code'], error: string, hints?: string[]): TraceFailure {
  return { ok: false, code, error, ...(hints === undefined ? {} : { hints }) }
}

function parseHeaders(raw: string | null | undefined): TraceHeaders {
  const values: Record<string, string> = {}
  const sensitive: string[] = []
  if (typeof raw !== 'string' || raw === '') return { values, sensitive }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { values, sensitive }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { values, sensitive }
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (SENSITIVE_HEADER.test(name)) {
      sensitive.push(name)
      continue
    }
    if (typeof value === 'string') values[name] = value
  }
  sensitive.sort()
  return { values, sensitive }
}

function redactJson(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[depth]'
  if (Array.isArray(value)) return value.map((item) => redactJson(item, depth + 1))
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_BODY_KEY.test(key) ? '[redacted]' : redactJson(item, depth + 1)
    }
    return out
  }
  return value
}

/** 工具回执用的正文脱敏：JSON 递归按敏感键替换；表单按参数名替换；其它原样截断。 */
export function redactBodyForDisplay(body: string | undefined): string | undefined {
  if (body === undefined) return undefined
  const trimmed = body.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.stringify(redactJson(JSON.parse(trimmed)))
    } catch {
      return body
    }
  }
  if (/^[^=&\s]+=[^&\s]*(?:&[^=&\s]+=[^&\s]*)*$/.test(trimmed)) {
    try {
      const params = new URLSearchParams(trimmed)
      const out = new URLSearchParams()
      for (const [key, value] of params.entries()) out.append(key, SENSITIVE_BODY_KEY.test(key) ? '[redacted]' : value)
      return out.toString()
    } catch {
      return body
    }
  }
  return body
}

type ReadBody = {
  body?: string
  source: TraceBodySource
  truncated: boolean
}

function safeReadFile(root: string, relPath: string): Buffer | undefined {
  try {
    const rootAbs = resolve(root)
    const abs = resolve(rootAbs, relPath)
    if (abs !== rootAbs && !abs.startsWith(`${rootAbs}${sep}`)) return undefined
    if (!existsSync(abs)) return undefined
    return readFileSync(abs)
  } catch {
    return undefined
  }
}

function readBody(
  samplesDir: string,
  bodyPath: string | undefined,
  preview: string | undefined,
  cap: number,
  rawTruncated: boolean,
): ReadBody {
  if (bodyPath !== undefined && bodyPath !== '') {
    const buffer = safeReadFile(samplesDir, bodyPath)
    if (buffer !== undefined) {
      const truncated = buffer.byteLength > cap
      return {
        body: truncated ? buffer.subarray(0, cap).toString('utf8') : buffer.toString('utf8'),
        source: 'file',
        truncated,
      }
    }
  }
  if (preview !== undefined && preview !== '') {
    // DB 预览本身只写前 512 字符：达到上限就认定被截断（不能把预览当完整正文）。
    return {
      body: preview.slice(0, cap),
      source: 'preview',
      truncated: preview.length >= PREVIEW_CAP || rawTruncated,
    }
  }
  return { source: 'none', truncated: rawTruncated }
}

function parseUrl(url: string): { path: string; query: Record<string, string> } {
  try {
    const parsed = new URL(url)
    const query: Record<string, string> = {}
    for (const [key, value] of parsed.searchParams.entries()) query[key] = value
    return { path: parsed.pathname, query }
  } catch {
    return { path: url, query: {} }
  }
}

type SampleDbRow = {
  id: string
  page_url: string | null
  ts: number
  seq: number
  url: string
  method: string
  status: number | null
  request_headers_json: string | null
  request_body_path: string | null
  request_body_preview: string | null
  response_headers_json: string | null
  response_body_path: string | null
  response_preview: string | null
  truncated: number
  relation_id: string | null
}

/**
 * 读一条 capture 的 trace；失败返回结构化 code（不抛业务错）。
 *
 * @param deps - 采集库路径 + 落盘正文根。
 * @param captureId - 采集 run id。
 * @param options - limit/bodyLimit/redactBodies/includeBodies。
 */
export function readTrace(deps: TraceReadDeps, captureId: string, options: TraceReadOptions = {}): Trace | TraceFailure {
  const id = typeof captureId === 'string' ? captureId.trim() : ''
  if (id === '' || id.length > 200 || /[\\/]/.test(id)) {
    return failure('bad-capture-id', 'capture_id 非法：需要采集 run id（不含路径分隔符）', ['先用 dataforge_capture_status 或面板确认 captureId'])
  }
  if (!existsSync(deps.captureDbPath)) {
    return failure('capture-not-found', `采集库不存在：${deps.captureDbPath}`, ['先跑一次采集，再生成 trace'])
  }
  const limit = clamp(options.limit, 1, 2000, 200)
  const bodyLimit = clamp(options.bodyLimit, 256, 65_536, 8_192)
  let db: Database.Database
  try {
    db = new Database(deps.captureDbPath, { readonly: true, fileMustExist: true })
  } catch (error) {
    return failure('capture-unreadable', `采集库打不开（只读）：${(error as Error).message}`, ['确认采集库没有被独占写入；或先关闭正在跑的采集'])
  }
  try {
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((row) => row.name),
    )
    if (!tables.has('capture_runs') || !tables.has('request_samples')) {
      return failure('capture-empty', '采集库里还没有 capture_runs/request_samples：没有可读的 trace', ['先跑一次采集'])
    }
    const run = db.prepare('SELECT id,entry_url,status FROM capture_runs WHERE id=?').get(id) as
      | { id: string; entry_url: string; status: string }
      | undefined
    const countRow = db.prepare('SELECT COUNT(*) AS n FROM request_samples WHERE capture_id=?').get(id) as { n: number }
    const totalSamples = Number(countRow.n)
    if (run === undefined && totalSamples === 0) {
      return failure('capture-not-found', `没有这个 capture：${id}`, ['先用 dataforge_capture_status 列最近采集，确认 id'])
    }
    if (totalSamples === 0) {
      return failure('capture-empty', `capture ${id} 还没有请求样本`, ['确认采集已完成且页面确实产生了 XHR/fetch；或重采一条'])
    }

    const relations = new Map<string, { cardId: string; mergeKey?: string }>()
    if (tables.has('page_card_relations')) {
      const relRows = db.prepare('SELECT id,card_id FROM page_card_relations WHERE capture_id=?').all(id) as Array<{ id: string; card_id: string }>
      const cards = new Map<string, { mergeKey?: string }>()
      if (tables.has('interface_cards')) {
        const cardRows = db.prepare('SELECT id,merge_key FROM interface_cards WHERE capture_id=?').all(id) as Array<{ id: string; merge_key: string | null }>
        for (const card of cardRows) {
          cards.set(card.id, card.merge_key === null ? {} : { mergeKey: card.merge_key })
        }
      }
      for (const rel of relRows) {
        const card = cards.get(rel.card_id)
        relations.set(rel.id, { cardId: rel.card_id, ...(card?.mergeKey === undefined ? {} : { mergeKey: card.mergeKey }) })
      }
    }

    const rows = db
      .prepare(
        `SELECT id,page_url,ts,seq,url,method,status,request_headers_json,request_body_path,request_body_preview,
                response_headers_json,response_body_path,response_preview,truncated,relation_id
           FROM request_samples WHERE capture_id=? ORDER BY seq ASC, ts ASC LIMIT ?`,
      )
      .all(id, limit) as SampleDbRow[]

    const includeBodies = options.includeBodies !== false
    const redactBodies = options.redactBodies === true
    const warnings: TraceWarning[] = []
    const interfaces = new Set<string>()
    const pages = new Set<string>()
    let writes = 0
    let truncatedBodies = 0

    const samples: TraceSample[] = rows.map((row) => {
      const method = String(row.method || 'GET').toUpperCase()
      const url = String(row.url || '')
      const parsed = parseUrl(url)
      const request = readBody(deps.samplesDir, row.request_body_path ?? undefined, row.request_body_preview ?? undefined, bodyLimit, row.truncated === 1)
      const response = readBody(deps.samplesDir, row.response_body_path ?? undefined, row.response_preview ?? undefined, bodyLimit, row.truncated === 1)
      if (request.truncated || response.truncated) truncatedBodies += 1
      if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') writes += 1
      interfaces.add(`${method} ${parsed.path}`)
      const pageUrl = typeof row.page_url === 'string' && row.page_url !== '' ? row.page_url : undefined
      if (pageUrl !== undefined) pages.add(pageUrl)
      const relation = row.relation_id === null ? undefined : relations.get(row.relation_id)
      const requestBody = includeBodies && request.body !== undefined
        ? (redactBodies ? redactBodyForDisplay(request.body) : request.body)
        : undefined
      const responseBody = includeBodies && response.body !== undefined
        ? (redactBodies ? redactBodyForDisplay(response.body) : response.body)
        : undefined
      return {
        id: String(row.id),
        seq: Number(row.seq),
        ts: Number(row.ts),
        method,
        url,
        path: parsed.path,
        query: parsed.query,
        ...(row.status === null ? {} : { status: Number(row.status) }),
        ...(pageUrl === undefined ? {} : { pageUrl }),
        requestHeaders: parseHeaders(row.request_headers_json),
        ...(requestBody === undefined ? {} : { requestBody }),
        requestBodySource: includeBodies ? request.source : 'none',
        requestBodyTruncated: includeBodies ? request.truncated : false,
        responseHeaders: parseHeaders(row.response_headers_json),
        ...(responseBody === undefined ? {} : { responseBody }),
        responseBodySource: includeBodies ? response.source : 'none',
        responseBodyTruncated: includeBodies ? response.truncated : false,
        truncated: row.truncated === 1,
        ...(relation === undefined ? {} : { cardId: relation.cardId }),
        ...(relation?.mergeKey === undefined ? {} : { mergeKey: relation.mergeKey }),
      }
    })

    if (rows.length < totalSamples) {
      warnings.push({
        code: 'trace-limit',
        message: `只返回了前 ${rows.length} / ${totalSamples} 条样本（limit=${limit}）；分析全文时提高 limit。`,
      })
    }
    if (truncatedBodies > 0) {
      warnings.push({
        code: 'body-truncated',
        message: `${truncatedBodies} 条样本的正文被截断/只有预览；字段流转推断可能漏字段。`,
      })
    }
    const stats: TraceStats = {
      totalSamples,
      returnedSamples: samples.length,
      interfaces: interfaces.size,
      writes,
      pages: pages.size,
      truncatedBodies,
    }
    return {
      captureId: id,
      entryUrl: run?.entry_url ?? '',
      ...(run === undefined ? {} : { status: run.status }),
      samples,
      stats,
      warnings,
    }
  } finally {
    db.close()
  }
}
