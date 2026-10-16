/**
 * 采集留痕存储：SQLite（WAL）查询面 + NDJSON 事件审计面 + 大体二进制落文件。
 *
 * 写路径全部同步（better-sqlite3），跨会话/跨句柄并发天然串行；
 * 样本正文超 captureBodyLimitBytes 时落 `<samplesDir>/<captureId>/*.bin`，DB 存相对路径。
 *
 * @module dsh-dataforge/capture/store
 */
import Database from 'better-sqlite3'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type {
  CardRow,
  CaptureRunRow,
  CaptureStatus,
  CredentialRow,
  PageRow,
  SampleRow,
  Template,
} from '../shared/capture-types.js'

const DDL = `
CREATE TABLE IF NOT EXISTS capture_runs (
  id TEXT PRIMARY KEY, task_type TEXT NOT NULL, entry_url TEXT NOT NULL,
  status TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER,
  stats_json TEXT NOT NULL DEFAULT '{}', error TEXT
);
CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY, capture_id TEXT REFERENCES capture_runs(id), url TEXT NOT NULL,
  depth INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'ok', visited_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS request_samples (
  id TEXT PRIMARY KEY, capture_id TEXT REFERENCES capture_runs(id), page_id TEXT,
  page_url TEXT, ts INTEGER NOT NULL, seq INTEGER NOT NULL, url TEXT NOT NULL, method TEXT NOT NULL,
  status INTEGER, request_headers_json TEXT, request_body_path TEXT, request_body_preview TEXT,
  response_headers_json TEXT, response_body_path TEXT, response_preview TEXT, truncated INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS interface_cards (
  id TEXT PRIMARY KEY, capture_id TEXT REFERENCES capture_runs(id), merge_key TEXT UNIQUE NOT NULL,
  name TEXT, url_template TEXT NOT NULL, method TEXT NOT NULL,
  request_template_json TEXT, response_template_json TEXT, auth_json TEXT,
  related_pages_json TEXT NOT NULL, sample_count INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS credential_events (
  id TEXT PRIMARY KEY, capture_id TEXT REFERENCES capture_runs(id), kind TEXT NOT NULL,
  url TEXT, name TEXT NOT NULL, value_json TEXT, obtained_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_sessions (
  id TEXT PRIMARY KEY, capture_id TEXT, origin TEXT NOT NULL, stored_body TEXT NOT NULL, stored_at INTEGER NOT NULL
);`

export type CaptureEventKind = 'page' | 'request' | 'card' | 'credential' | 'stats' | 'terminal'

export interface CaptureStoreIo {
  dbPath: string
  samplesDir: string
  eventsNdjsonPath?: string
}

export interface UpsertSampleInput {
  url: string
  method: string
  status?: number
  requestHeaders: Record<string, string>
  responseHeaders: Record<string, string>
  requestBody?: string | Buffer
  responseBody?: string | Buffer
  truncated?: boolean
  ts?: number
  bodyLimit: number
  pageUrl?: string
}

export interface UpsertCardInput {
  mergeKey: string
  method: string
  urlTemplate: string
  relatedPageUrls: string[]
  requestTemplate?: Template
  responseTemplate?: Template
  authBinding?: { cookies: number; storageKeys: number }
  name?: string
}

export class CaptureStore {
  private readonly db: Database.Database
  private readonly seqCounters = new Map<string, { requests: number }>()
  private readonly io: CaptureStoreIo

  constructor(
    dbPath: string,
    samplesDir: string,
    eventsNdjsonPath?: string,
  ) {
    this.io = { dbPath, samplesDir, eventsNdjsonPath }
    mkdirSync(samplesDir, { recursive: true })
    if (eventsNdjsonPath !== undefined) mkdirSync(join(eventsNdjsonPath, '..'), { recursive: true })
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(DDL)
  }

  close(): void {
    this.db.close()
  }

  // ── runs ──

  upsertRun(run: CaptureRunRow): void {
    this.db
      .prepare(
        `INSERT INTO capture_runs(id,task_type,entry_url,status,started_at,stats_json)
         VALUES (?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET status=excluded.status`,
      )
      .run(run.id, run.taskType, run.entryUrl, run.status, run.startedAt, JSON.stringify(run.stats))
    this.appendEvent({ kind: 'terminal', phase: 'start', captureId: run.id, taskType: run.taskType })
  }

  finishRun(id: string, status: CaptureStatus, error?: string, stats?: CaptureRunRow['stats']): void {
    const existing = this.getRun(id)
    if (existing === undefined) {
      throw new Error(`capture ${id} 不存在，无法 finish`)
    }
    const finalStats = stats ?? existing.stats
    this.db
      .prepare(`UPDATE capture_runs SET status=?, ended_at=?, error=?, stats_json=? WHERE id=?`)
      .run(status, Date.now(), error ?? null, JSON.stringify(finalStats), id)
    this.appendEvent({ kind: 'terminal', phase: 'end', captureId: id, status, error })
  }

  getRun(id: string): CaptureRunRow | undefined {
    const row = this.db.prepare('SELECT * FROM capture_runs WHERE id=?').get(id) as Record<string, unknown> | undefined
    if (row === undefined) return undefined
    return {
      id: String(row['id']),
      taskType: String(row['task_type']) as CaptureRunRow['taskType'],
      entryUrl: String(row['entry_url']),
      status: String(row['status']) as CaptureStatus,
      startedAt: Number(row['started_at']),
      endedAt: row['ended_at'] === null || row['ended_at'] === undefined ? undefined : Number(row['ended_at']),
      stats: JSON.parse(String(row['stats_json'])) as CaptureRunRow['stats'],
      error: row['error'] === null || row['error'] === undefined ? undefined : String(row['error']),
    }
  }

  listRuns(limit = 10): CaptureRunRow[] {
    const rows = this.db.prepare('SELECT id FROM capture_runs ORDER BY started_at DESC LIMIT ?').all(limit) as Array<{ id: string }>
    return rows.flatMap((r) => {
      const run = this.getRun(r.id)
      return run === undefined ? [] : [run]
    })
  }

  // ── pages ──

  upsertPage(captureId: string, url: string, depth: number, status: PageRow['status']): string {
    const id = `pg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    this.db
      .prepare('INSERT INTO pages(id,capture_id,url,depth,status,visited_at) VALUES (?,?,?,?,?,?)')
      .run(id, captureId, url, depth, status, Date.now())
    this.appendEvent({ kind: 'page', captureId, url, depth, status })
    this.bumpRunStats(captureId, 'pages')
    return id
  }

  listPages(captureId: string, limit = 50): PageRow[] {
    const rows = this.db
      .prepare('SELECT * FROM pages WHERE capture_id=? ORDER BY visited_at DESC LIMIT ?')
      .all(captureId, limit) as Array<Record<string, unknown>>
    return rows.map((row) => ({
      id: String(row['id']),
      captureId: String(row['capture_id']),
      url: String(row['url']),
      depth: Number(row['depth']),
      status: String(row['status']) as PageRow['status'],
    }))
  }

  // ── samples ──

  upsertSample(captureId: string, pageId: string | undefined, input: UpsertSampleInput): string {
    const id = `sm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const counter = this.seqCounters.get(captureId) ?? { requests: 0 }
    counter.requests += 1
    this.seqCounters.set(captureId, counter)
    const reqPath = this.bodyPath(captureId, input.requestBody, input.bodyLimit)
    const respPath = this.bodyPath(captureId, input.responseBody, input.bodyLimit)
    const truncated = input.truncated === true || reqPath !== undefined || respPath !== undefined
    this.db
      .prepare(
        `INSERT INTO request_samples(id,capture_id,page_id,page_url,ts,seq,url,method,status,
          request_headers_json,request_body_path,request_body_preview,response_headers_json,response_body_path,response_preview,truncated)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id, captureId, pageId ?? null, input.pageUrl ?? '', input.ts ?? Date.now(), counter.requests,
        input.url, input.method, input.status ?? null,
        JSON.stringify(input.requestHeaders), reqPath ?? null, previewOf(input.requestBody, input.bodyLimit),
        JSON.stringify(input.responseHeaders), respPath ?? null, previewOf(input.responseBody, input.bodyLimit),
        truncated ? 1 : 0,
      )
    this.appendEvent({ kind: 'request', captureId, url: input.url, method: input.method, status: input.status })
    this.bumpRunStats(captureId, 'requests')
    return id
  }

  countSamples(captureId: string): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM request_samples WHERE capture_id=?').get(captureId) as { n: number }
    return Number(row['n'])
  }

  listSamples(captureId: string, limit = 100): SampleRow[] {
    const rows = this.db
      .prepare('SELECT * FROM request_samples WHERE capture_id=? ORDER BY ts ASC, seq ASC LIMIT ?')
      .all(captureId, limit) as Array<Record<string, unknown>>
    return rows.map((row) => ({
      id: String(row['id']),
      captureId: String(row['capture_id']),
      pageUrl: row['page_url'] === null || row['page_url'] === undefined ? '' : String(row['page_url']),
      seq: Number(row['seq']),
      url: String(row['url']),
      method: String(row['method']),
      status: row['status'] === null || row['status'] === undefined ? undefined : Number(row['status']),
      requestHeaders: parseRecord(row['request_headers_json']),
      requestBodyPath: optString(row['request_body_path']),
      requestBodyPreview: optString(row['request_body_preview']),
      responseHeaders: parseRecord(row['response_headers_json']),
      responseBodyPath: optString(row['response_body_path']),
      responsePreview: optString(row['response_preview']),
      truncated: Number(row['truncated']) === 1,
      ts: Number(row['ts']),
    }))
  }

  readBinary(relPath: string): Buffer | undefined {
    const abs = join(this.io.samplesDir, relPath)
    return existsSync(abs) ? readFileSync(abs) : undefined
  }

  // ── cards ──

  /** 按 merge_key 幂等：已有卡 → 追加页面引用 + 样本计数 +1；新卡 → 建行。 */
  upsertCard(captureId: string, input: UpsertCardInput): string {
    const existing = this.db.prepare('SELECT id FROM interface_cards WHERE merge_key=?').get(input.mergeKey) as { id: string } | undefined
    if (existing !== undefined) {
      this.db
        .prepare('UPDATE interface_cards SET related_pages_json=?, sample_count=sample_count+1 WHERE id=?')
        .run(JSON.stringify(input.relatedPageUrls), existing.id)
      if (input.requestTemplate !== undefined) {
        this.db.prepare('UPDATE interface_cards SET request_template_json=? WHERE id=?').run(JSON.stringify(input.requestTemplate), existing.id)
      }
      if (input.responseTemplate !== undefined) {
        this.db.prepare('UPDATE interface_cards SET response_template_json=? WHERE id=?').run(JSON.stringify(input.responseTemplate), existing.id)
      }
      if (input.authBinding !== undefined) {
        this.db.prepare('UPDATE interface_cards SET auth_json=? WHERE id=?').run(JSON.stringify(input.authBinding), existing.id)
      }
      if (input.name !== undefined) {
        this.db.prepare('UPDATE interface_cards SET name=? WHERE id=?').run(input.name, existing.id)
      }
      this.appendEvent({ kind: 'card', captureId, cardId: existing.id, merged: true })
      return existing.id
    }
    const id = `card_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    this.db
      .prepare(
        `INSERT INTO interface_cards(id,capture_id,merge_key,name,url_template,method,
          request_template_json,response_template_json,auth_json,related_pages_json,sample_count,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,1,?)`,
      )
      .run(
        id, captureId, input.mergeKey, input.name ?? null, input.urlTemplate, input.method,
        input.requestTemplate === undefined ? null : JSON.stringify(input.requestTemplate),
        input.responseTemplate === undefined ? null : JSON.stringify(input.responseTemplate),
        input.authBinding === undefined ? null : JSON.stringify(input.authBinding),
        JSON.stringify(input.relatedPageUrls), Date.now(),
      )
    this.bumpRunStats(captureId, 'cards')
    this.appendEvent({ kind: 'card', captureId, cardId: id })
    return id
  }

  getCard(id: string): CardRow | undefined {
    const row = this.db.prepare('SELECT * FROM interface_cards WHERE id=?').get(id) as Record<string, unknown> | undefined
    return row === undefined ? undefined : rowToCard(row)
  }

  listCards(captureId: string, limit = 200): CardRow[] {
    const rows = this.db
      .prepare('SELECT * FROM interface_cards WHERE capture_id=? ORDER BY created_at ASC LIMIT ?')
      .all(captureId, limit) as Array<Record<string, unknown>>
    return rows.map(rowToCard)
  }

  // ── credentials ──

  upsertCredential(
    captureId: string,
    kind: CredentialRow['kind'],
    url: string,
    name: string,
    obtainedAt: number,
    value?: unknown,
  ): string {
    const id = `cr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    this.db
      .prepare('INSERT INTO credential_events(id,capture_id,kind,url,name,value_json,obtained_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, captureId, kind, url, name, value === undefined ? null : JSON.stringify(value), obtainedAt)
    this.bumpRunStats(captureId, 'credentials')
    this.appendEvent({ kind: 'credential', captureId, credentialKind: kind, name, url })
    return id
  }

  listCredentials(captureId: string, limit = 200): CredentialRow[] {
    const rows = this.db
      .prepare('SELECT * FROM credential_events WHERE capture_id=? ORDER BY obtained_at ASC LIMIT ?')
      .all(captureId, limit) as Array<Record<string, unknown>>
    return rows.map((row) => ({
      id: String(row['id']),
      captureId: String(row['capture_id']),
      kind: String(row['kind']) as CredentialRow['kind'],
      url: optString(row['url']) ?? '',
      name: String(row['name']),
      valueJson: optString(row['value_json']),
      obtainedAt: Number(row['obtained_at']),
    }))
  }

  saveSession(origin: string, captureId: string | undefined, body: unknown): string {
    const id = `ls_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    this.db
      .prepare('INSERT INTO login_sessions(id,capture_id,origin,stored_body,stored_at) VALUES (?,?,?,?,?)')
      .run(id, captureId ?? null, origin, JSON.stringify(body), Date.now())
    return id
  }

  // ── private ──

  private bumpRunStats(captureId: string, key: keyof CaptureRunRow['stats']): void {
    this.db
      .prepare(
        `UPDATE capture_runs SET stats_json = json_set(stats_json, '$.${key}', COALESCE(json_extract(stats_json, '$.${key}'),0)+1)
         WHERE id=?`,
      )
      .run(captureId)
  }

  private bodyPath(captureId: string, body: string | Buffer | undefined, limit: number): string | undefined {
    if (body === undefined || Buffer.byteLength(body) <= limit) return undefined
    const rel = join(captureId, `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}.bin`)
    mkdirSync(join(this.io.samplesDir, captureId), { recursive: true })
    writeFileSync(join(this.io.samplesDir, rel), body)
    return rel
  }

  private appendEvent(event: { kind: CaptureEventKind } & Record<string, unknown>): void {
    if (this.io.eventsNdjsonPath === undefined) return
    appendFileSync(this.io.eventsNdjsonPath, `${JSON.stringify({ ts: Date.now(), ...event })}\n`, 'utf8')
  }
}

function previewOf(body: string | Buffer | undefined, limit: number): string | undefined {
  if (body === undefined) return undefined
  if (Buffer.byteLength(body) > limit) return undefined
  return String(body).slice(0, 512)
}

function parseRecord(raw: unknown): Record<string, string> {
  if (typeof raw !== 'string') return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>
    }
    return {}
  } catch {
    return {}
  }
}

function optString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value)
}

function rowToCard(row: Record<string, unknown>): CardRow {
  const related = parseArray(row['related_pages_json'])
  const requestTemplate = optTemplate(row['request_template_json'])
  const responseTemplate = optTemplate(row['response_template_json'])
  return {
    id: String(row['id']),
    captureId: String(row['capture_id']),
    name: optString(row['name']),
    urlTemplate: String(row['url_template']),
    method: String(row['method']),
    requestTemplate,
    responseTemplate,
    authBinding: optRecord<{ cookies: number; storageKeys: number }>(row['auth_json']) as CardRow['authBinding'],
    relatedPageUrls: related,
    sampleCount: Number(row['sample_count']),
    createdAt: Number(row['created_at']),
  }
}

function optTemplate(raw: unknown): Template | undefined {
  if (typeof raw !== 'string' || raw.trim().startsWith('{') === false) return undefined
  const parsed: unknown = JSON.parse(raw)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  const record = parsed as { fields?: unknown; codePath?: unknown }
  const fields = Array.isArray(record['fields']) ? (record['fields'] as unknown[]) : []
  const codePath = typeof record['codePath'] === 'string' ? record['codePath'] : undefined
  return { fields: fields as Template['fields'], codePath }
}

function optRecord<T>(raw: unknown): T | undefined {
  if (typeof raw !== 'string' || raw.trim().startsWith('{') === false) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) ? undefined : (parsed as T)
  } catch {
    return undefined
  }
}

function parseArray(raw: unknown): string[] {
  if (typeof raw !== 'string') return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}
