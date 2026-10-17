/**
 * 接口库导入：采集库（SQLite）→ 项目接口库（卡文件）。
 *
 * 三条硬纪律：
 *   1. **采集库只读**：本模块自己用 `readonly: true` 打开 SQLite，不走会建表/写事件的
 *      `CaptureStore`——导错导坏都不可能影响采集数据；
 *   2. **纯增量幂等**：以 `mergeKey` 为天然幂等键（同键即同卡），`sources` 按 captureId
 *      去重，重复导入同一 run 结果收敛到同一卡集合、且不重写文件（git 干净）；
 *   3. **坏卡不炸批**：单张采集卡数据损坏 → 跳过它、计入 `skipped` 并给中文原因，
 *      其余照常导入（与流程包发现"坏 yaml 跳过不炸"同纪律）。
 *
 * 归并规则（设计 §数据模型）：同 `mergeKey` 即同卡；再导入同卡 = 合并 `sources`、
 * 用新样本刷新字段模板（字段并集，类型/角色冲突记 `notice`，保留既有值）。
 *
 * @module dsh-dataforge/library/import
 */

import Database from 'better-sqlite3'
import { existsSync } from 'node:fs'
import { mergeKeyOf, normalizeUrlForTemplate } from '../capture/normalizer.js'
import type { AuthType, Template, TemplateField } from '../shared/capture-types.js'
import { lossless } from '../shared/json.js'
import { createCard, libraryRoot, readCard, readIndex, upsertIndexEntry, writeCard, writeIndex } from './store.js'
import type {
  LibraryCard,
  LibraryCardDraft,
  LibraryFieldRole,
  LibraryFieldType,
  LibraryIndex,
  LibraryInput,
  LibraryOutput,
  LibrarySource,
} from './types.js'

/** 导入失败码（`no-capture-data` 待由 `shared/errors.ts` 的持有者并入联合类型）。 */
export type LibraryErrorCode = 'no-capture-data' | 'capture-unreadable'

export interface LibraryError extends Error {
  code: LibraryErrorCode
  hints: string[]
}

function libraryError(code: LibraryErrorCode, message: string, hints: string[] = []): LibraryError {
  return Object.assign(new Error(message), { name: 'LibraryError', code, hints }) as LibraryError
}

/** 导入回执（IF-1 的输出面）。 */
export type LibraryImportResult = {
  /** 新建卡数。 */
  imported: number
  /** 归并进既有卡且确有变化的卡数。 */
  merged: number
  /** 与原卡完全一致、未重写的卡数（重复导入时的常态）。 */
  unchanged: number
  /** 跳过的坏卡数。 */
  skipped: number
  /** 本次落库/归并触达的 cardId 清单（升序、去重）。 */
  cardIds: string[]
  /** 逐张坏卡的中文原因（回执要能指到是哪张卡）。 */
  skippedDetails: Array<{ captureId: string; mergeKey: string; reason: string }>
  /** 本次处理的采集 run。 */
  captureIds: string[]
  /** 接口库根（绝对路径，便于人直接去看文件）。 */
  libraryRoot: string
}

export type ImportLibraryOptions = {
  /** 工作区根：卡落 `<workspaceRoot>/.dsh/dataforge/library/`。 */
  workspaceRoot: string
  /** 采集库 SQLite 路径（只读打开）。 */
  captureDbPath: string
  /** 只导入这一次采集；缺省 = 全部尚未导入完的 run。 */
  captureId?: string
}

// ── 采集库只读读取面 ──────────────────────────────────────────────────────────

type RawCardRow = {
  id: string
  captureId: string
  name?: string
  urlTemplate: string
  method: string
  requestTemplateJson?: string
  responseTemplateJson?: string
  authJson?: string
  relatedPagesJson: string
  sampleCount: number
}

type RawRelationRow = {
  id: string
  cardId: string
  captureId: string
  pageUrl: string
}

function parseJson(text: string | null): unknown {
  if (text === null || text === '') return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

function parseStringArray(text: string | null): string[] {
  const parsed = parseJson(text)
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
}

/** 模板 JSON → Template；**存在但解析不出形状**返回 'broken'（调用方按坏卡跳过）。 */
function parseTemplate(text: string | null): Template | undefined | 'broken' {
  if (text === null || text === '') return undefined
  const parsed = parseJson(text)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return 'broken'
  const fields = (parsed as Record<string, unknown>)['fields']
  if (!Array.isArray(fields)) return 'broken'
  const record = parsed as Record<string, unknown>
  const codePath = typeof record['codePath'] === 'string' ? record['codePath'] : undefined
  const pathParams = Array.isArray(record['pathParams'])
    ? record['pathParams'].filter((item): item is string => typeof item === 'string')
    : undefined
  return {
    fields: fields as TemplateField[],
    ...(codePath === undefined ? {} : { codePath }),
    ...(pathParams === undefined ? {} : { pathParams }),
  }
}

function parseAuthType(text: string | null): { auth: AuthType; authEvidence?: string } {
  const parsed = parseJson(text)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { auth: 'unknown' }
  const record = parsed as Record<string, unknown>
  const raw = record['authType']
  const auth: AuthType =
    raw === 'none' || raw === 'token-header' || raw === 'token-param' || raw === 'cookie-session' ? raw : 'unknown'
  const evidence = typeof record['authEvidence'] === 'string' && record['authEvidence'] !== '' ? record['authEvidence'] : undefined
  return { auth, ...(evidence === undefined ? {} : { authEvidence: evidence }) }
}

type CaptureSnapshot = {
  runIds: string[]
  cards: RawCardRow[]
  relations: RawRelationRow[]
}

/**
 * 只读打开采集库并取出导入所需的全部行。
 * 库文件不存在 / 没有 interface_cards 表 → `no-capture-data`（诚实空态，不建空库）。
 */
function readCaptureSnapshot(dbPath: string, captureId?: string): CaptureSnapshot {
  if (!existsSync(dbPath)) {
    throw libraryError('no-capture-data', `采集库不存在：${dbPath}`, [
      '先让用户跑一次采集（capture 工具或 dataforge_capture），再来导入接口库',
    ])
  }
  let db: Database.Database
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true })
  } catch (error) {
    throw libraryError('capture-unreadable', `采集库打不开（只读）：${(error as Error).message}`, [
      '确认文件没有被别的进程独占写到一半，或先重跑一次采集',
    ])
  }
  try {
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((row) => row.name),
    )
    if (!tables.has('interface_cards')) {
      throw libraryError('no-capture-data', '采集库里还没有接口卡表：没有任何采集数据', [
        '先跑一次采集再导入；接口库导入只读采集库，不会凭空造卡',
      ])
    }
    const runIds = (db.prepare('SELECT id FROM capture_runs ORDER BY started_at DESC').all() as Array<{ id: string }>).map(
      (row) => row.id,
    )
    const hasRelations = tables.has('page_card_relations')
    const hasRuns = tables.has('capture_runs')
    const where = captureId === undefined ? '' : ' WHERE capture_id=?'
    const params = captureId === undefined ? [] : [captureId]
    const cards = (
      db
        .prepare(
          `SELECT id,capture_id,name,url_template,method,request_template_json,response_template_json,auth_json,
                  related_pages_json,sample_count
             FROM interface_cards${where}
            ORDER BY created_at ASC`,
        )
        .all(...params) as Array<Record<string, unknown>>
    ).map(
      (row): RawCardRow => ({
        id: String(row['id']),
        captureId: String(row['capture_id']),
        ...(typeof row['name'] === 'string' && row['name'] !== '' ? { name: String(row['name']) } : {}),
        urlTemplate: typeof row['url_template'] === 'string' ? row['url_template'] : '',
        method: typeof row['method'] === 'string' ? row['method'] : '',
        ...(typeof row['request_template_json'] === 'string' ? { requestTemplateJson: row['request_template_json'] } : {}),
        ...(typeof row['response_template_json'] === 'string' ? { responseTemplateJson: row['response_template_json'] } : {}),
        ...(typeof row['auth_json'] === 'string' ? { authJson: row['auth_json'] } : {}),
        relatedPagesJson: typeof row['related_pages_json'] === 'string' ? row['related_pages_json'] : '[]',
        sampleCount: typeof row['sample_count'] === 'number' ? row['sample_count'] : 0,
      }),
    )
    const relations = hasRelations
      ? (
          db
            .prepare(
              `SELECT id,card_id,capture_id,page_url FROM page_card_relations${captureId === undefined ? '' : ' WHERE capture_id=?'}`,
            )
            .all(...params) as Array<Record<string, unknown>>
        ).map(
          (row): RawRelationRow => ({
            id: String(row['id']),
            cardId: String(row['card_id']),
            captureId: String(row['capture_id']),
            pageUrl: typeof row['page_url'] === 'string' ? row['page_url'] : '',
          }),
        )
      : []
    return { runIds: hasRuns ? runIds : [], cards, relations }
  } finally {
    db.close()
  }
}

// ── 采集卡 → 库卡投影 ────────────────────────────────────────────────────────

const LOCATION_PREFIX: Record<string, string> = {
  query: 'query',
  body: 'body',
  header: 'header',
  path: 'path',
}

/** 采集模板的数组记法 `items[]` 统一成库的 `items[*]`（设计文档 §数据模型 的写法）。 */
function normalizeFieldPath(field: string): string {
  return field.replace(/\[\]/g, '[*]')
}

function libraryTypeOf(field: TemplateField): LibraryFieldType {
  const type = field.type
  return type === 'null' ? 'string' : type
}

function libraryRoleOf(field: TemplateField): LibraryFieldRole {
  return field.role === 'input' || field.role === 'chain' ? field.role : 'constant'
}

function inputPathOf(field: TemplateField): string {
  const prefix = LOCATION_PREFIX[field.location ?? 'body'] ?? 'body'
  return `${prefix}.${normalizeFieldPath(field.field)}`
}

/**
 * URL 模板的路径占位符 → 卡上的 `path.*` 入参名。
 *
 * 关键区别：采集期的 `pathParams` 记的是**采到的真实段值**（`['12345']`），不是参数名——
 * 拿它当字段名会产出 `path.12345` 这种垃圾，而且每采到一个新 ID 就多一条，字段表会无限膨胀。
 * 所以名字只能从**模板的占位符**来：`/orders/{p}/items` 里的 `{p}` 是采集期把「数字/长随机段」
 * 统一抽掉的匿名记号，按出现次序命名为 `p1`、`p2`…；`{id}` 这种具名占位符直接用名字。
 */
function pathParamNamesOf(urlTemplate: string): string[] {
  const path = urlTemplate.split('?')[0]
  const names: string[] = []
  let anonymous = 0
  for (const segment of path.split('/')) {
    const match = /^\{([A-Za-z0-9_]+)\}$/.exec(segment.trim())
    if (match === null) continue
    const raw = match[1]
    if (raw === 'p') {
      anonymous += 1
      names.push(`p${anonymous}`)
      continue
    }
    names.push(raw)
  }
  return names
}

function projectInputs(template: Template | undefined, urlTemplate: string): LibraryInput[] {
  if (template === undefined) return []
  const out: LibraryInput[] = []
  const seen = new Set<string>()
  // path 参数先投影：它们天然由调用方/上游提供。缺了它们，详情页接口
  // （`/api/orders/{p}/items`）在卡里就没有任何 `path.*` 入参、链也绑不上。
  for (const name of pathParamNamesOf(urlTemplate)) {
    const path = `path.${name}`
    if (seen.has(path)) continue
    seen.add(path)
    out.push({ path, type: 'string', required: true, role: 'input' })
  }
  for (const field of template.fields) {
    // 凭证角色字段不入卡：鉴权只以 auth 标志 + 来源名表达（红线）。
    if (field.role === 'credential') continue
    const path = inputPathOf(field)
    // 与 path 参数投影按 path 去重（同名 path 字段已有入参，不重复出条目）。
    if (seen.has(path)) continue
    seen.add(path)
    const role = libraryRoleOf(field)
    out.push({
      path,
      type: libraryTypeOf(field),
      required: role === 'input',
      role,
      ...(field.unverified === true ? { unverified: true } : {}),
    })
  }
  return out
}

function projectOutputs(template: Template | undefined): LibraryOutput[] {
  if (template === undefined) return []
  const out: LibraryOutput[] = []
  for (const field of template.fields) {
    if (field.role === 'credential') continue
    out.push({ path: `body.${normalizeFieldPath(field.field)}`, type: libraryTypeOf(field) })
  }
  return out
}

type Projection = { draft: LibraryCardDraft } | { reason: string }

function projectCard(card: RawCardRow, relations: RawRelationRow[]): Projection {
  if (card.method === '') return { reason: '采集卡缺 method' }
  if (card.urlTemplate === '') return { reason: '采集卡缺 urlTemplate' }
  const requestTemplate = parseTemplate(card.requestTemplateJson ?? null)
  if (requestTemplate === 'broken') return { reason: '请求模板 JSON 结构损坏' }
  const responseTemplate = parseTemplate(card.responseTemplateJson ?? null)
  if (responseTemplate === 'broken') return { reason: '响应模板 JSON 结构损坏' }

  const urlTemplate = normalizeUrlForTemplate(card.urlTemplate).urlTemplate
  const mergeKey = mergeKeyOf(card.method, urlTemplate)
  if (mergeKey === '') return { reason: '归并键为空' }

  const pages = [...new Set([...parseStringArray(card.relatedPagesJson), ...relations.map((row) => row.pageUrl)])].filter(
    (page) => page !== '',
  )
  const relationIds = [...new Set(relations.map((row) => row.id))]
  const auth = parseAuthType(card.authJson ?? null)

  return {
    draft: {
      kind: 'interface-card',
      ...(card.name === undefined ? {} : { name: card.name }),
      identity: { mergeKey, method: card.method, urlTemplate },
      inputs: projectInputs(requestTemplate, urlTemplate),
      outputs: projectOutputs(responseTemplate),
      auth: auth.auth,
      ...(auth.authEvidence === undefined ? {} : { authEvidence: auth.authEvidence }),
      sources: [{ captureId: card.captureId, pages, relationIds }],
    },
  }
}

// ── 归并 ──────────────────────────────────────────────────────────────────────

function mergeSources(existing: LibrarySource[], incoming: LibrarySource[]): LibrarySource[] {
  const out = existing.map((source) => ({ ...source, pages: [...source.pages], relationIds: [...source.relationIds] }))
  for (const source of incoming) {
    const hit = out.find((item) => item.captureId === source.captureId)
    if (hit === undefined) {
      out.push({ captureId: source.captureId, pages: [...source.pages], relationIds: [...source.relationIds] })
      continue
    }
    hit.pages = [...new Set([...hit.pages, ...source.pages])]
    hit.relationIds = [...new Set([...hit.relationIds, ...source.relationIds])]
  }
  return out
}

function mergeInputs(existing: LibraryInput[], incoming: LibraryInput[], notice: string[]): LibraryInput[] {
  const out = existing.map((field) => ({ ...field }))
  for (const field of incoming) {
    const hit = out.find((item) => item.path === field.path)
    if (hit === undefined) {
      out.push({ ...field })
      continue
    }
    if (hit.type !== field.type) notice.push(`入参 ${field.path} 类型冲突：既有 ${hit.type}，新样本 ${field.type}（保留既有）`)
    if (hit.role !== field.role) notice.push(`入参 ${field.path} 角色冲突：既有 ${hit.role}，新样本 ${field.role}（保留既有）`)
    // 任一来源确认过不再是"未验证"，就摘掉 unverified 标记。
    if (field.unverified !== true) delete hit.unverified
    if (field.required) hit.required = true
  }
  return out
}

function mergeOutputs(existing: LibraryOutput[], incoming: LibraryOutput[], notice: string[]): LibraryOutput[] {
  const out = existing.map((field) => ({ ...field }))
  for (const field of incoming) {
    const hit = out.find((item) => item.path === field.path)
    if (hit === undefined) {
      out.push({ ...field })
      continue
    }
    if (hit.type !== field.type) notice.push(`出参 ${field.path} 类型冲突：既有 ${hit.type}，新样本 ${field.type}（保留既有）`)
  }
  return out
}

const AUTH_RANK: Record<AuthType, number> = { unknown: 0, none: 1, 'token-param': 2, 'token-header': 2, 'cookie-session': 2 }

function mergeAuth(existing: LibraryCard, draft: LibraryCardDraft, notice: string[]): Pick<LibraryCard, 'auth' | 'authEvidence'> {
  const keep = { auth: existing.auth, ...(existing.authEvidence === undefined ? {} : { authEvidence: existing.authEvidence }) }
  if (existing.auth === draft.auth) {
    return { auth: existing.auth, ...((existing.authEvidence ?? draft.authEvidence) === undefined ? {} : { authEvidence: existing.authEvidence ?? draft.authEvidence }) }
  }
  if (AUTH_RANK[draft.auth] > AUTH_RANK[existing.auth]) {
    return { auth: draft.auth, ...(draft.authEvidence === undefined ? {} : { authEvidence: draft.authEvidence }) }
  }
  notice.push(`鉴权标志冲突：既有 ${existing.auth}，新样本 ${draft.auth}（保留既有）`)
  return keep
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** 归并一张既有卡；`changed === false` 表示与原卡完全一致（不重写文件，保住幂等与 git 干净）。 */
export function mergeCard(existing: LibraryCard, draft: LibraryCardDraft): { card: LibraryCard; changed: boolean } {
  const notice = [...(existing.notice ?? [])]
  const merged: LibraryCard = {
    ...existing,
    inputs: mergeInputs(existing.inputs, draft.inputs, notice),
    outputs: mergeOutputs(existing.outputs, draft.outputs, notice),
    ...mergeAuth(existing, draft, notice),
    sources: mergeSources(existing.sources, draft.sources),
  }
  if (existing.name === undefined && draft.name !== undefined) merged.name = draft.name
  const nextNotice = [...new Set(notice)]
  if (nextNotice.length > 0) merged.notice = nextNotice
  const changed = !sameJson(merged, existing)
  return { card: changed ? merged : existing, changed }
}

// ── 主流程 ────────────────────────────────────────────────────────────────────

/**
 * 导入接口库（IF-1）。
 *
 * `captureId` 缺省时只处理"尚未导入完"的 run：某 run 的每张卡都已在 sources 里记过
 * 该 captureId 才算导完；已有卡+新采集卡并存时照样会补进来（幂等且不丢新数据）。
 *
 * @throws LibraryError `no-capture-data`（无采集库/无卡）/ `capture-unreadable`（库打不开）
 */
export function importLibrary(options: ImportLibraryOptions): LibraryImportResult {
  const { workspaceRoot, captureDbPath, captureId } = options
  const snapshot = readCaptureSnapshot(captureDbPath, captureId)
  const root = libraryRoot(workspaceRoot)

  if (snapshot.cards.length === 0) {
    throw libraryError(
      'no-capture-data',
      captureId === undefined ? '采集库里还没有任何接口卡' : `采集 ${captureId} 里没有接口卡`,
      ['先让用户做一次采集（至少抓到一个 XHR/fetch 请求），再来导入接口库'],
    )
  }

  let index: LibraryIndex = readIndex(workspaceRoot)
  const cardsByMergeKey = new Map<string, LibraryCard>()
  for (const entry of index.cards) {
    if (cardsByMergeKey.has(entry.mergeKey)) continue
    // 索引是加速器：条目指向的卡文件若坏了，按"没导入过"处理（下面会重建这张卡）。
    const file = readCard(workspaceRoot, entry.cardId)
    if (file !== undefined) cardsByMergeKey.set(entry.mergeKey, file)
  }

  const createdIds = new Set<string>()
  const merged = new Set<string>()
  const unchanged = new Set<string>()
  const skippedDetails: LibraryImportResult['skippedDetails'] = []
  const touched = new Set<string>()
  const captureIds = new Set<string>()

  const relationsByCard = new Map<string, RawRelationRow[]>()
  for (const relation of snapshot.relations) {
    const list = relationsByCard.get(relation.cardId)
    if (list === undefined) relationsByCard.set(relation.cardId, [relation])
    else list.push(relation)
  }

  for (const raw of snapshot.cards) {
    const projection = projectCard(raw, relationsByCard.get(raw.id) ?? [])
    if ('reason' in projection) {
      skippedDetails.push({ captureId: raw.captureId, mergeKey: `${raw.method} ${raw.urlTemplate}`, reason: projection.reason })
      continue
    }
    const draft = projection.draft
    const existing = cardsByMergeKey.get(draft.identity.mergeKey)
    if (existing === undefined) {
      const created = createCard(workspaceRoot, index, draft)
      index = created.index
      cardsByMergeKey.set(draft.identity.mergeKey, created.card)
      createdIds.add(created.card.cardId)
      touched.add(created.card.cardId)
      captureIds.add(raw.captureId)
      continue
    }
    // 同一 captureId 已在 sources 里也照样走一遍归并：重复导入必须**收敛到正确的卡状态**，
    // 而不是只因为「这个 run 导过」就跳过。历史卡缺 `path.*`（早先版本导入的）、或卡被手改过，
    // 都靠这一次重导修正；内容真没变时 mergeCard 会报 changed=false，不写文件、不留 git 噪音。
    const result = mergeCard(existing, draft)
    cardsByMergeKey.set(draft.identity.mergeKey, result.card)
    if (!result.changed) {
      unchanged.add(result.card.cardId)
      touched.add(result.card.cardId)
      captureIds.add(raw.captureId)
      continue
    }
    writeCard(workspaceRoot, result.card)
    // 归并后的卡必须回到索引里：卡文件在、索引被删过时这里补登记。
    index = upsertIndexEntry(index, result.card)
    merged.add(result.card.cardId)
    touched.add(result.card.cardId)
    captureIds.add(raw.captureId)
  }

  // 索引只在真发生变化时落盘（纯重复导入不留 git 噪音）。
  if (createdIds.size > 0 || merged.size > 0) writeIndex(workspaceRoot, index)

  return lossless({
    imported: createdIds.size,
    merged: merged.size,
    unchanged: unchanged.size,
    skipped: skippedDetails.length,
    cardIds: [...touched].sort(),
    skippedDetails,
    captureIds: [...captureIds].sort(),
    libraryRoot: root,
  })
}
