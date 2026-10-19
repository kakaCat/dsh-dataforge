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
import { pageIdentityOf } from '../shared/page-url.js'
import type {
  CardRow,
  CaptureRunRow,
  CaptureStatus,
  CredentialRow,
  PageMetaRow,
  PageRow,
  RelationRow,
  SampleRow,
  Template,
} from '../shared/capture-types.js'

/** 页面元信息（标题/站点名）：空串/null 视为「没有值」，不覆盖旧值。 */
export interface PageMetaInput {
  title?: string
  siteName?: string
}

const CARDS_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS interface_cards (
  id TEXT PRIMARY KEY, capture_id TEXT REFERENCES capture_runs(id), merge_key TEXT NOT NULL,
  name TEXT, url_template TEXT NOT NULL, method TEXT NOT NULL,
  request_template_json TEXT, response_template_json TEXT, auth_json TEXT,
  related_pages_json TEXT NOT NULL, sample_count INTEGER NOT NULL, created_at INTEGER NOT NULL
);`

/**
 * 卡片身份 = (capture_id, merge_key)。
 *
 * 早期把 merge_key 建成了全库 UNIQUE：第二次采到同一接口时会被并进**第一次运行**的那张卡，
 * 卡的 capture_id / related_pages 张冠李戴，后一次运行的 cards 视图直接是空的。
 * 索引把唯一性收进单个 run 内，跨 run 各留各的卡。
 */
const CARDS_INDEX_DDL = 'CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_capture_merge ON interface_cards(capture_id, merge_key);'

const DDL = `
CREATE TABLE IF NOT EXISTS capture_runs (
  id TEXT PRIMARY KEY, task_type TEXT NOT NULL, entry_url TEXT NOT NULL,
  status TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER,
  stats_json TEXT NOT NULL DEFAULT '{}', error TEXT
);
CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY, capture_id TEXT REFERENCES capture_runs(id), url TEXT NOT NULL,
  depth INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'ok', visited_at INTEGER NOT NULL,
  title TEXT, site_name TEXT
);
CREATE TABLE IF NOT EXISTS request_samples (
  id TEXT PRIMARY KEY, capture_id TEXT REFERENCES capture_runs(id), page_id TEXT, relation_id TEXT,
  page_url TEXT, ts INTEGER NOT NULL, seq INTEGER NOT NULL, url TEXT NOT NULL, method TEXT NOT NULL,
  status INTEGER, request_headers_json TEXT, request_body_path TEXT, request_body_preview TEXT,
  response_headers_json TEXT, response_body_path TEXT, response_preview TEXT, truncated INTEGER DEFAULT 0
);
${CARDS_TABLE_DDL}
CREATE TABLE IF NOT EXISTS credential_events (
  id TEXT PRIMARY KEY, capture_id TEXT REFERENCES capture_runs(id), kind TEXT NOT NULL,
  url TEXT, name TEXT NOT NULL, value_json TEXT, obtained_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_sessions (
  id TEXT PRIMARY KEY, capture_id TEXT, origin TEXT NOT NULL, stored_body TEXT NOT NULL, stored_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS page_card_relations (
  id TEXT PRIMARY KEY, capture_id TEXT REFERENCES capture_runs(id), card_id TEXT NOT NULL,
  page_id TEXT, page_url TEXT NOT NULL, params_fingerprint TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, sample_count INTEGER NOT NULL DEFAULT 1
);`

const RELATIONS_INDEX_DDL =
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_relations_card_page_fp ON page_card_relations(card_id, page_url, params_fingerprint);'

export type CaptureEventKind = 'page' | 'request' | 'card' | 'credential' | 'stats' | 'terminal' | 'relation'

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
  authType?: CardRow['authType']
  authEvidence?: string
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
    this.migrateLegacyCardScope()
    this.db.exec(CARDS_INDEX_DDL)
    this.db.exec(RELATIONS_INDEX_DDL)
    this.ensureRunsNoticeColumn()
    this.ensurePagesMetaColumns()
    this.ensureSamplesRelationColumn()
    this.backfillLegacyRelations()
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

  finishRun(id: string, status: CaptureStatus, error?: string, stats?: CaptureRunRow['stats'], notice?: string): void {
    const existing = this.getRun(id)
    if (existing === undefined) {
      throw new Error(`capture ${id} 不存在，无法 finish`)
    }
    const finalStats = stats ?? existing.stats
    this.db
      .prepare(`UPDATE capture_runs SET status=?, ended_at=?, error=?, stats_json=?, notice=COALESCE(?, notice) WHERE id=?`)
      .run(status, Date.now(), error ?? null, JSON.stringify(finalStats), notice ?? null, id)
    this.appendEvent({ kind: 'terminal', phase: 'end', captureId: id, status, error })
  }

  setRunNotice(id: string, notice: string): void {
    this.db.prepare(`UPDATE capture_runs SET notice=? WHERE id=?`).run(notice, id)
    this.appendEvent({ kind: 'stats', captureId: id, notice })
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
      notice: optString(row['notice']),
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

  /**
   * 页面行幂等写入（按 `(capture_id, url)` 唯一）。
   *
   * 同一页面会从多条证据重复写入：旁路样本首次见到的 pageUrl（wireToStore）、爬行的 page 事件、
   * browser 的标题上报（onPageMeta）。早期每次 INSERT 新行，pages 表里同一页会出现多行、
   * 页数统计虚高；现在把 `(capture_id, url)` 当身份：
   *   - 已存在 → 只刷新 visited_at/status 与**非空**标题/站点名，不重复 bump 统计；
   *   - 不存在 → INSERT 并 bump `pages` 统计。
   *
   * url 由调用方传页面身份（`shared/page-url`）；历史字面 URL 行保持原样，由出口投影归并。
   */
  upsertPage(captureId: string, url: string, depth: number, status: PageRow['status'], meta?: PageMetaInput): string {
    const title = cleanMetaText(meta?.title)
    const siteName = cleanMetaText(meta?.siteName)
    const existing = this.db
      .prepare('SELECT id FROM pages WHERE capture_id=? AND url=?')
      .get(captureId, url) as { id: string } | undefined
    if (existing !== undefined) {
      this.db
        .prepare(
          `UPDATE pages SET visited_at=?,
             status=?,
             title=CASE WHEN ?<>'' THEN ? ELSE title END,
             site_name=CASE WHEN ?<>'' THEN ? ELSE site_name END
           WHERE id=?`,
        )
        .run(Date.now(), status, title, title, siteName, siteName, existing.id)
      return existing.id
    }
    const id = `pg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    this.db
      .prepare('INSERT INTO pages(id,capture_id,url,depth,status,visited_at,title,site_name) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, captureId, url, depth, status, Date.now(), title === '' ? null : title, siteName === '' ? null : siteName)
    this.appendEvent({ kind: 'page', captureId, url, depth, status })
    this.bumpRunStats(captureId, 'pages')
    return id
  }

  /**
   * 页面清单（按页面身份去重，最近访问为准）。
   *
   * 新写入的 pages.url 本身就是页面身份（见 application 桥）；历史库存的是字面 URL，
   * 同一 SPA 页面的 hash/反缓存戳变体会是多行 —— 出口按同一口径归并，避免工具回执
   * 把「同一个页面」报成多页。归并只影响投影，不改历史行（证据仍在 request_samples）。
   */
  listPages(captureId: string, limit = 50): PageRow[] {
    // 先取全量再归并、最后截断：历史字面 URL 变体会占多行，先 LIMIT 会让同一身份把后面
    // 别的页面挤掉（返回不足 limit 条且静默漏页）。每 run 的 pages 行数受采集页数上限约束。
    const rows = this.db
      .prepare('SELECT * FROM pages WHERE capture_id=? ORDER BY visited_at DESC')
      .all(captureId) as Array<Record<string, unknown>>
    const seen = new Set<string>()
    const pages: PageRow[] = []
    for (const row of rows) {
      const pageUrl = pageIdentityOf(String(row['url']))
      if (seen.has(pageUrl)) continue
      seen.add(pageUrl)
      const title = cleanMetaText(optString(row['title']))
      const siteName = cleanMetaText(optString(row['site_name']))
      pages.push({
        id: String(row['id']),
        captureId: String(row['capture_id']),
        url: pageUrl,
        depth: Number(row['depth']),
        status: String(row['status']) as PageRow['status'],
        ...(title === '' ? {} : { title }),
        ...(siteName === '' ? {} : { siteName }),
      })
      if (pages.length >= limit) break
    }
    return pages
  }

  /**
   * 全库页面元信息（/page-meta 数据面）：按页面身份归并、visitedAt 最新者胜、跳过非 http(s)。
   *
   * 多取 `limit × 4` 原始行再归并：历史字面 URL 变体（hash/反缓存戳）会占多行，
   * 只取 limit 行会让同一身份把后面别的页面挤掉。归并只影响投影，不改历史行。
   *
   * 同一身份的旧行只**补缺**标题/站点名（不拿旧值覆盖最新行的非空值）：标题与站点名可能
   * 分两次上报（先 title 后 siteName，毫秒相同则 SQL 排序不定），纯「取第一行」会让另一个字段丢失。
   */
  listPageMeta(limit = 500): PageMetaRow[] {
    const fetchLimit = Math.max(1, limit) * 4
    const rows = this.db
      .prepare('SELECT url, title, site_name, visited_at FROM pages ORDER BY visited_at DESC LIMIT ?')
      .all(fetchLimit) as Array<Record<string, unknown>>
    const byIdentity = new Map<string, PageMetaRow>()
    const order: string[] = []
    for (const row of rows) {
      const rawUrl = String(row['url'] ?? '')
      if (!/^https?:/i.test(rawUrl.trim())) continue
      const identity = pageIdentityOf(rawUrl)
      const title = cleanMetaText(optString(row['title']))
      const siteName = cleanMetaText(optString(row['site_name']))
      const existing = byIdentity.get(identity)
      if (existing === undefined) {
        if (order.length >= limit) continue
        byIdentity.set(identity, {
          url: identity,
          ...(title === '' ? {} : { title }),
          ...(siteName === '' ? {} : { siteName }),
          visitedAt: Number(row['visited_at']),
        })
        order.push(identity)
        continue
      }
      // 同一身份：只补缺，不覆盖最新行已有的非空值
      if (existing.title === undefined && title !== '') existing.title = title
      if (existing.siteName === undefined && siteName !== '') existing.siteName = siteName
    }
    return order.flatMap((identity) => {
      const row = byIdentity.get(identity)
      return row === undefined ? [] : [row]
    })
  }

  /**
   * 按页面身份回写标题/站点名（旧页面补抓的落点）：匹配**所有**同一身份的历史行。
   *
   * 空值不覆盖旧值（补抓只补缺：读不到标题时不该把已有标题清空）。
   * 返回实际被更新的行数（调用方据此判断目标是否在 pages 表里存在）。
   */
  applyPageMeta(url: string, title?: string, siteName?: string): number {
    const cleanTitle = cleanMetaText(title)
    const cleanSite = cleanMetaText(siteName)
    if (cleanTitle === '' && cleanSite === '') return 0
    const target = pageIdentityOf(url)
    if (target === '') return 0
    const rows = this.db.prepare('SELECT id, url FROM pages').all() as Array<{ id: string; url: string }>
    const update = this.db.prepare(
      `UPDATE pages SET
         title=CASE WHEN ?<>'' THEN ? ELSE title END,
         site_name=CASE WHEN ?<>'' THEN ? ELSE site_name END
       WHERE id=?`,
    )
    let updated = 0
    const apply = this.db.transaction((): void => {
      for (const row of rows) {
        if (pageIdentityOf(row.url) !== target) continue
        update.run(cleanTitle, cleanTitle, cleanSite, cleanSite, row.id)
        updated += 1
      }
    })
    apply()
    return updated
  }

  /** kind='cookie' 的 value_json 原文（补抓复用登录态；值只在服务端内存过手，不出壳）。 */
  listCookieJson(limit = 500): string[] {
    const rows = this.db
      .prepare(`SELECT value_json FROM credential_events WHERE kind='cookie' AND value_json IS NOT NULL ORDER BY obtained_at DESC LIMIT ?`)
      .all(Math.max(1, limit)) as Array<{ value_json: string }>
    return rows.map((row) => String(row['value_json']))
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
      relationId: optString(row['relation_id']),
    }))
  }

  readBinary(relPath: string): Buffer | undefined {
    const abs = join(this.io.samplesDir, relPath)
    return existsSync(abs) ? readFileSync(abs) : undefined
  }

  // ── cards ──

  /** 按 (capture_id, merge_key) 幂等：同 run 已有卡 → 追加页面引用 + 样本计数 +1；新卡 → 建行。 */
  upsertCard(captureId: string, input: UpsertCardInput): string {
    const existing = this.db
      .prepare('SELECT id FROM interface_cards WHERE capture_id=? AND merge_key=?')
      .get(captureId, input.mergeKey) as { id: string } | undefined
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
      if (input.authBinding !== undefined || input.authType !== undefined || input.authEvidence !== undefined) {
        const merged = mergeAuthJson(this.getCard(existing.id), input)
        this.db.prepare('UPDATE interface_cards SET auth_json=? WHERE id=?').run(JSON.stringify(merged), existing.id)
      }
      if (input.name !== undefined) {
        this.db.prepare('UPDATE interface_cards SET name=? WHERE id=?').run(input.name, existing.id)
      }
      this.appendEvent({ kind: 'card', captureId, cardId: existing.id, merged: true })
      return existing.id
    }
    const id = `card_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const authJson: Record<string, unknown> = {
      ...(input.authBinding === undefined ? {} : input.authBinding),
      ...(input.authType === undefined ? {} : { authType: input.authType }),
      ...(input.authEvidence === undefined ? {} : { authEvidence: input.authEvidence }),
    }
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
        Object.keys(authJson).length === 0 ? null : JSON.stringify(authJson),
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

  /** 接口库页面跨 run 列卡（created_at 降序，LIMIT/OFFSET 分页）；listCards 是 per-capture 视角，两条含义不同，都在场。 */
  listAllCards(limit = 200, offset = 0): CardRow[] {
    const rows = this.db
      .prepare('SELECT * FROM interface_cards ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(limit, offset) as Array<Record<string, unknown>>
    return rows.map(rowToCard)
  }

  /** 接口库卡片总数（分页器算页数用；与 listAllCards 同一筛选面，无额外条件）。 */
  countAllCards(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM interface_cards').get() as { n: number }
    return Number(row.n)
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

  // ── page ↔ card relations（§6.2：pageId × cardId × 入参指纹）──

  /**
   * 幂等关系行：唯一键 (card_id, page_url, params_fingerprint)。
   * 已存在 → last_seen_at 前移 + sample_count+1（同形态重复调用聚一行）；
   * 指纹不同 → 同一卡片下新增一行（调用形态可区分，正是规格要的），不并卡。
   */
  upsertRelation(captureId: string, cardId: string, pageUrl: string, paramsFingerprint: string, pageId?: string): string {
    const existing = this.db
      .prepare(`SELECT id FROM page_card_relations WHERE card_id=? AND page_url=? AND params_fingerprint=?`)
      .get(cardId, pageUrl, paramsFingerprint) as { id: string } | undefined
    const now = Date.now()
    if (existing !== undefined) {
      this.db
        .prepare(`UPDATE page_card_relations SET last_seen_at=?, sample_count=sample_count+1, page_id=COALESCE(?, page_id) WHERE id=?`)
        .run(now, pageId ?? null, existing.id)
      return existing.id
    }
    const id = `pr_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    this.db
      .prepare(
        `INSERT INTO page_card_relations(id,capture_id,card_id,page_id,page_url,params_fingerprint,first_seen_at,last_seen_at,sample_count)
         VALUES (?,?,?,?,?,?,?, ?,1)`,
      )
      .run(id, captureId, cardId, pageId ?? null, pageUrl, paramsFingerprint, now, now)
    this.appendEvent({ kind: 'relation', captureId, cardId, pageUrl, fingerprint: paramsFingerprint })
    return id
  }

  listRelations(captureId: string, limit = 500): RelationRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM page_card_relations WHERE capture_id=? ORDER BY last_seen_at DESC LIMIT ?`)
      .all(captureId, limit) as Array<Record<string, unknown>>
    return rows.map(rowToRelation)
  }

  /** 单卡的关系行（「这个接口在哪些页面的哪些形态下被调用过」）。 */
  listRelationsByCard(cardId: string, limit = 200): RelationRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM page_card_relations WHERE card_id=? ORDER BY last_seen_at DESC LIMIT ?`)
      .all(cardId, limit) as Array<Record<string, unknown>>
    return rows.map(rowToRelation)
  }

  /** 样本回指关系行：一条请求属于「哪个页面 × 哪个接口 × 哪种形态」。 */
  attachSampleRelation(sampleId: string, relationId: string): void {
    this.db.prepare('UPDATE request_samples SET relation_id=? WHERE id=?').run(relationId, sampleId)
  }

  saveSession(origin: string, captureId: string | undefined, body: unknown): string {
    const id = `ls_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    this.db
      .prepare('INSERT INTO login_sessions(id,capture_id,origin,stored_body,stored_at) VALUES (?,?,?,?,?)')
      .run(id, captureId ?? null, origin, JSON.stringify(body), Date.now())
    return id
  }

  /**
   * 老库迁移：检测 interface_cards 是否还带着 `merge_key TEXT UNIQUE`（全库唯一）。
   *
   * SQLite 无法直接 DROP 表级约束，只能重建：列与顺序原样搬运（旧数据里已经没有重复 merge_key，
   * 搬过去必然满足新的 (capture_id, merge_key) 唯一），改名后由 CARDS_INDEX_DDL 补索引。
   */
  private migrateLegacyCardScope(): void {
    const row = this.db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='interface_cards'")
      .get() as { sql?: unknown } | undefined
    const sql = typeof row?.['sql'] === 'string' ? row['sql'] : ''
    if (!/merge_key\s+TEXT\s+UNIQUE/i.test(sql)) return
    const columns =
      'id,capture_id,merge_key,name,url_template,method,request_template_json,response_template_json,auth_json,related_pages_json,sample_count,created_at'
    this.db.exec(`
      BEGIN;
      DROP TABLE IF EXISTS interface_cards_migrated;
      ${CARDS_TABLE_DDL.replace('interface_cards', 'interface_cards_migrated')}
      INSERT INTO interface_cards_migrated(${columns}) SELECT ${columns} FROM interface_cards;
      DROP TABLE interface_cards;
      ALTER TABLE interface_cards_migrated RENAME TO interface_cards;
      COMMIT;
    `)
  }

  /**
   * 老库迁移：`request_samples` 无 relation_id 列（关系模型引入前建的库）→ ALTER 补齐。
   * 历史样本的 relation 留空是诚实结果：当时就没记关系，不能倒推猜测。
   */
  private ensureSamplesRelationColumn(): void {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM pragma_table_info('request_samples') WHERE name='relation_id'")
      .get() as { n: number }
    if (Number(row.n) > 0) return
    this.db.exec('ALTER TABLE request_samples ADD COLUMN relation_id TEXT')
  }

  /**
   * 老卡补 legacy 关系行（幂等）：关系模型引入前沉淀的卡只有 related_pages_json 这个冗余缓存，
   * 不补的话「页面 → 接口」视图里历史卡等于不存在。指纹记 'legacy' 表示「当时没采到入参形态」。
   */
  private backfillLegacyRelations(): void {
    const cards = this.db
      .prepare(`SELECT c.id, c.capture_id, c.related_pages_json FROM interface_cards c
                WHERE NOT EXISTS (SELECT 1 FROM page_card_relations r WHERE r.card_id = c.id)`)
      .all() as Array<{ id: string; capture_id: string; related_pages_json: string }>
    if (cards.length === 0) return
    const pageOf = this.db.prepare('SELECT id FROM pages WHERE capture_id=? AND url=? LIMIT 1')
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO page_card_relations
        (id,capture_id,card_id,page_id,page_url,params_fingerprint,first_seen_at,last_seen_at,sample_count)
       VALUES (?,?,?,?,?,?,?,?,1)`,
    )
    const now = Date.now()
    for (const card of cards) {
      let urls: unknown = []
      try {
        urls = JSON.parse(card.related_pages_json)
      } catch {
        urls = []
      }
      if (!Array.isArray(urls)) continue
      for (const url of urls) {
        if (typeof url !== 'string' || url.length === 0) continue
        const page = pageOf.get(card.capture_id, url) as { id: string } | undefined
        insert.run(
          `pr_legacy_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          card.capture_id, card.id, page?.id ?? null, url, 'legacy', now, now,
        )
      }
    }
  }

  // ── private ──

  /** 老库（2026-10-17 前建）capture_runs 无 notice 列：ALTER 补齐，已存在则跳过。 */
  private ensureRunsNoticeColumn(): void {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM pragma_table_info('capture_runs') WHERE name='notice'")
      .get() as { n: number }
    if (Number(row.n) > 0) return
    this.db.exec('ALTER TABLE capture_runs ADD COLUMN notice TEXT')
  }

  /**
   * 老库迁移：pages 无 title/site_name 列（名称数据面引入前建的库）→ ALTER 补齐。
   *
   * 只加列、不动历史行：历史页面标题靠面板「补抓名称」动作（TitleBackfillService）重访回填；
   * 库仍可被旧版本插件打开（新列全为 NULL，旧查询不受影响）。
   */
  private ensurePagesMetaColumns(): void {
    const hasColumn = (column: string): boolean => {
      const row = this.db
        .prepare("SELECT COUNT(*) AS n FROM pragma_table_info('pages') WHERE name=?")
        .get(column) as { n: number }
      return Number(row.n) > 0
    }
    if (!hasColumn('title')) this.db.exec('ALTER TABLE pages ADD COLUMN title TEXT')
    if (!hasColumn('site_name')) this.db.exec('ALTER TABLE pages ADD COLUMN site_name TEXT')
  }

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

/** 页面元信息清洗：压空白、去首尾；缺席/非字符串 → 空串（调用方统一当「没有值」）。 */
function cleanMetaText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim()
}

function rowToCard(row: Record<string, unknown>): CardRow {
  const auth = optRecord<Record<string, unknown>>(row['auth_json'])
  const authType = typeof auth?.['authType'] === 'string' ? (auth['authType'] as CardRow['authType']) : undefined
  const authEvidence = typeof auth?.['authEvidence'] === 'string' ? auth['authEvidence'] : undefined
  const authBinding = auth === undefined
    ? undefined
    : (Object.fromEntries(
        Object.entries(auth).filter(([k]) => k === 'cookies' || k === 'storageKeys'),
      ) as CardRow['authBinding'])
  return {
    id: String(row['id']),
    captureId: String(row['capture_id']),
    name: optString(row['name']),
    mergeKey: optString(row['merge_key']),
    urlTemplate: String(row['url_template']),
    method: String(row['method']),
    requestTemplate: optTemplate(row['request_template_json']),
    responseTemplate: optTemplate(row['response_template_json']),
    ...(Object.keys(authBinding ?? {}).length === 0 ? {} : { authBinding }),
    ...(authType === undefined ? {} : { authType }),
    ...(authEvidence === undefined ? {} : { authEvidence }),
    relatedPageUrls: parseArray(row['related_pages_json']),
    sampleCount: Number(row['sample_count']),
    createdAt: Number(row['created_at']),
  }
}

function mergeAuthJson(card: CardRow | undefined, input: UpsertCardInput): Record<string, unknown> {
  return {
    ...(card?.authBinding ?? {}),
    ...(input.authBinding ?? {}),
    ...(input.authType === undefined ? (card?.authType === undefined ? {} : { authType: card.authType }) : { authType: input.authType }),
    ...(input.authEvidence === undefined ? (card?.authEvidence === undefined ? {} : { authEvidence: card.authEvidence }) : { authEvidence: input.authEvidence }),
  }
}

function rowToRelation(row: Record<string, unknown>): RelationRow {
  return {
    id: String(row['id']),
    captureId: String(row['capture_id']),
    cardId: String(row['card_id']),
    pageId: optString(row['page_id']),
    pageUrl: String(row['page_url']),
    paramsFingerprint: String(row['params_fingerprint']),
    firstSeenAt: Number(row['first_seen_at']),
    lastSeenAt: Number(row['last_seen_at']),
    sampleCount: Number(row['sample_count']),
  }
}

function optTemplate(raw: unknown): Template | undefined {
  if (typeof raw !== 'string' || raw.trim().startsWith('{') === false) return undefined
  const parsed: unknown = JSON.parse(raw)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  const record = parsed as { fields?: unknown; codePath?: unknown; pathParams?: unknown }
  const fields = Array.isArray(record['fields']) ? (record['fields'] as unknown[]) : []
  const codePath = typeof record['codePath'] === 'string' ? record['codePath'] : undefined
  const pathParams = Array.isArray(record['pathParams']) ? record['pathParams'].map(String) : undefined
  return { fields: fields as Template['fields'], ...(codePath === undefined ? {} : { codePath }), ...(pathParams === undefined ? {} : { pathParams }) }
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
