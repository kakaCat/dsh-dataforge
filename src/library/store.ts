/**
 * 项目接口库的存取面：卡文件（`cards/<cardId>.yaml`）+ 索引（`index.yaml`）。
 *
 * 纪律（与流程包发现层同哲学）：
 *   - **卡文件是权威，索引只是指针**：索引缺失/损坏时按卡文件重建，绝不因为索引坏了就
 *     否认盘上已有的卡；
 *   - **坏卡不炸批**：单张卡 YAML 坏了 → 跳过它（返回 undefined），由调用方计入 `skipped`；
 *   - **写是原子的**：先写 `<file>.tmp` 再 rename，避免半截文件被后续读取当成真卡；
 *   - `cardId` 序号式、不复用：序号水位持久化在 `index.yaml` 的 `nextCardSeq`，并取
 *     盘上现有卡号的最大值兜底（索引被删也不会撞号）。
 *
 * @module dsh-dataforge/library/store
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import yaml from 'js-yaml'
import type {
  LibraryCard,
  LibraryCardDraft,
  LibraryFieldType,
  LibraryIndex,
  LibraryIndexEntry,
  LibraryInput,
  LibraryOutput,
  LibrarySource,
} from './types.js'

/** 库根相对工作区的位置：`.dsh/dataforge/library/`（与 `.dsh/dataforge/flows` 同级）。 */
export const LIBRARY_DIR_SEGMENTS = ['.dsh', 'dataforge', 'library'] as const

const CARD_ID_RE = /^card_(\d{6,})$/
const CARD_FILE_RE = /^card_\d{6,}\.yaml$/
const FIELD_TYPES = new Set<LibraryFieldType>(['string', 'number', 'boolean', 'object', 'array'])

/** 库根（绝对路径）。 */
export function libraryRoot(workspaceRoot: string): string {
  return join(workspaceRoot, ...LIBRARY_DIR_SEGMENTS)
}

/** 卡文件目录。 */
export function cardsDir(workspaceRoot: string): string {
  return join(libraryRoot(workspaceRoot), 'cards')
}

/** 索引文件路径。 */
export function indexPath(workspaceRoot: string): string {
  return join(libraryRoot(workspaceRoot), 'index.yaml')
}

/** 库是否已存在（有索引或有卡文件）——没有就说明从没导入过，如实报"无采集数据"。 */
export function libraryExists(workspaceRoot: string): boolean {
  if (existsSync(indexPath(workspaceRoot))) return true
  const dir = cardsDir(workspaceRoot)
  return existsSync(dir) && readdirSync(dir).some((name) => CARD_FILE_RE.test(name))
}

/** 序号 → cardId（6 位补零，与设计文档 `card_000123` 一致）。 */
export function cardIdOf(seq: number): string {
  return `card_${String(seq).padStart(6, '0')}`
}

/** cardId → 序号；形状不合法返回 undefined。 */
export function cardSeqOf(cardId: string): number | undefined {
  const match = CARD_ID_RE.exec(cardId)
  return match === null ? undefined : Number(match[1])
}

function cardPathOf(workspaceRoot: string, cardId: string): string {
  return join(cardsDir(workspaceRoot), `${cardId}.yaml`)
}

function emptyIndex(): LibraryIndex {
  return { apiVersion: 'dataforge/v1', kind: 'interface-library-index', nextCardSeq: 1, cards: [] }
}

function writeFileAtomic(path: string, text: string): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, text, 'utf8')
  renameSync(tmp, path)
}

/** 站点 host：来源页面里的第一个能解析出 host 的 URL；都解析不出来就是空串（不编造）。 */
function siteOf(card: LibraryCard): string {
  for (const source of card.sources) {
    for (const page of source.pages) {
      try {
        return new URL(page).host
      } catch {
        // 页面 URL 非法（历史数据/相对路径）→ 换下一条，绝不因为溯源字段炸掉整次导入。
      }
    }
  }
  return ''
}

/** 卡 → 索引条目。 */
export function indexEntryOf(card: LibraryCard): LibraryIndexEntry {
  return {
    cardId: card.cardId,
    file: `cards/${card.cardId}.yaml`,
    mergeKey: card.identity.mergeKey,
    method: card.identity.method,
    urlTemplate: card.identity.urlTemplate,
    site: siteOf(card),
    updatedAt: Date.now(),
  }
}

// ── 卡文件的读 ────────────────────────────────────────────────────────────────

function optString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function fieldTypeOf(value: unknown): LibraryFieldType {
  return typeof value === 'string' && FIELD_TYPES.has(value as LibraryFieldType) ? (value as LibraryFieldType) : 'string'
}

function toInput(raw: unknown): LibraryInput | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const record = raw as Record<string, unknown>
  const path = optString(record['path'])
  if (path === undefined) return undefined
  const role = optString(record['role'])
  return {
    path,
    type: fieldTypeOf(record['type']),
    required: record['required'] === true,
    role: role === 'constant' || role === 'input' || role === 'chain' ? role : 'constant',
    ...(record['unverified'] === true ? { unverified: true } : {}),
  }
}

function toOutput(raw: unknown): LibraryOutput | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const record = raw as Record<string, unknown>
  const path = optString(record['path'])
  if (path === undefined) return undefined
  return { path, type: fieldTypeOf(record['type']) }
}

function toSource(raw: unknown): LibrarySource | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const record = raw as Record<string, unknown>
  const captureId = optString(record['captureId'])
  if (captureId === undefined) return undefined
  return { captureId, pages: strArray(record['pages']), relationIds: strArray(record['relationIds']) }
}

const AUTH_TYPES = new Set(['none', 'token-header', 'token-param', 'cookie-session', 'unknown'])

function toAuth(value: unknown): LibraryCard['auth'] {
  return typeof value === 'string' && AUTH_TYPES.has(value) ? (value as LibraryCard['auth']) : 'unknown'
}

/**
 * YAML 文本 → 卡对象。形状不合法（缺 cardId/归并键/入参出参不是数组……）返回 undefined：
 * 单张坏卡跳过，不阻断整批导入。
 */
export function parseCardFile(text: string): LibraryCard | undefined {
  let doc: unknown
  try {
    doc = yaml.load(text)
  } catch {
    return undefined
  }
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return undefined
  const record = doc as Record<string, unknown>
  const cardId = optString(record['cardId'])
  const identity = record['identity']
  if (cardId === undefined || cardSeqOf(cardId) === undefined) return undefined
  if (identity === null || typeof identity !== 'object') return undefined
  const id = identity as Record<string, unknown>
  const mergeKey = optString(id['mergeKey'])
  const method = optString(id['method'])
  const urlTemplate = optString(id['urlTemplate'])
  if (mergeKey === undefined || method === undefined || urlTemplate === undefined) return undefined
  if (!Array.isArray(record['inputs']) || !Array.isArray(record['outputs']) || !Array.isArray(record['sources'])) {
    return undefined
  }
  const authEvidence = optString(record['authEvidence'])
  const name = optString(record['name'])
  const notice = strArray(record['notice'])
  return {
    cardId,
    kind: 'interface-card',
    ...(name === undefined ? {} : { name }),
    identity: { mergeKey, method, urlTemplate },
    inputs: record['inputs'].map(toInput).filter((item): item is LibraryInput => item !== undefined),
    outputs: record['outputs'].map(toOutput).filter((item): item is LibraryOutput => item !== undefined),
    auth: toAuth(record['auth']),
    ...(authEvidence === undefined ? {} : { authEvidence }),
    sources: record['sources'].map(toSource).filter((item): item is LibrarySource => item !== undefined),
    ...(notice.length === 0 ? {} : { notice }),
  }
}

/** 读一张卡；文件缺失或内容坏了 → undefined（不抛）。 */
export function readCard(workspaceRoot: string, cardId: string): LibraryCard | undefined {
  if (cardSeqOf(cardId) === undefined) return undefined
  const path = cardPathOf(workspaceRoot, cardId)
  if (!existsSync(path)) return undefined
  try {
    return parseCardFile(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

/** 盘上所有卡文件的名字（不解析内容；坏文件也在里面，调用方读的时候再跳过）。 */
export function listCardIdsOnDisk(workspaceRoot: string): string[] {
  const dir = cardsDir(workspaceRoot)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => CARD_FILE_RE.test(name))
    .map((name) => basename(name, '.yaml'))
    .sort()
}

/** 读全部卡（坏卡跳过，按 cardId 升序）。 */
export function listCards(workspaceRoot: string): LibraryCard[] {
  const out: LibraryCard[] = []
  for (const cardId of listCardIdsOnDisk(workspaceRoot)) {
    const card = readCard(workspaceRoot, cardId)
    if (card !== undefined) out.push(card)
  }
  return out
}

// ── 卡文件的写 ────────────────────────────────────────────────────────────────

/** 卡对象 → YAML 文本（字段顺序固定，便于 git diff 与人工手改）。 */
export function dumpCardFile(card: LibraryCard): string {
  const doc: Record<string, unknown> = {
    cardId: card.cardId,
    kind: 'interface-card',
    ...(card.name === undefined ? {} : { name: card.name }),
    identity: {
      mergeKey: card.identity.mergeKey,
      method: card.identity.method,
      urlTemplate: card.identity.urlTemplate,
    },
    inputs: card.inputs.map((field) => ({
      path: field.path,
      type: field.type,
      required: field.required,
      role: field.role,
      ...(field.unverified === true ? { unverified: true } : {}),
    })),
    outputs: card.outputs.map((field) => ({ path: field.path, type: field.type })),
    auth: card.auth,
    ...(card.authEvidence === undefined ? {} : { authEvidence: card.authEvidence }),
    sources: card.sources.map((source) => ({
      captureId: source.captureId,
      pages: source.pages,
      relationIds: source.relationIds,
    })),
    ...(card.notice === undefined || card.notice.length === 0 ? {} : { notice: card.notice }),
  }
  return yaml.dump(doc, { lineWidth: 120, noRefs: true, sortKeys: false })
}

/** 落盘一张卡（mkdir -p + 原子写）。返回卡文件绝对路径。 */
export function writeCard(workspaceRoot: string, card: LibraryCard): string {
  mkdirSync(cardsDir(workspaceRoot), { recursive: true })
  const path = cardPathOf(workspaceRoot, card.cardId)
  writeFileAtomic(path, dumpCardFile(card))
  return path
}

/** 删一张卡（归并误并的回滚动作：删卡重导，采集库不动）。 */
export function deleteCard(workspaceRoot: string, cardId: string): boolean {
  const path = cardPathOf(workspaceRoot, cardId)
  if (!existsSync(path)) return false
  renameSync(path, `${path}.deleted`)
  return true
}

// ── 索引的读写 ────────────────────────────────────────────────────────────────

function toIndexEntry(raw: unknown): LibraryIndexEntry | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const record = raw as Record<string, unknown>
  const cardId = optString(record['cardId'])
  const mergeKey = optString(record['mergeKey'])
  if (cardId === undefined || cardSeqOf(cardId) === undefined || mergeKey === undefined) return undefined
  return {
    cardId,
    file: optString(record['file']) ?? `cards/${cardId}.yaml`,
    mergeKey,
    method: optString(record['method']) ?? '',
    urlTemplate: optString(record['urlTemplate']) ?? '',
    site: optString(record['site']) ?? '',
    updatedAt: typeof record['updatedAt'] === 'number' ? record['updatedAt'] : 0,
  }
}

function parseIndexFile(text: string): LibraryIndex | undefined {
  let doc: unknown
  try {
    doc = yaml.load(text)
  } catch {
    return undefined
  }
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return undefined
  const record = doc as Record<string, unknown>
  if (!Array.isArray(record['cards'])) return undefined
  const cards = record['cards'].map(toIndexEntry).filter((item): item is LibraryIndexEntry => item !== undefined)
  const seq = typeof record['nextCardSeq'] === 'number' && record['nextCardSeq'] > 0 ? Math.floor(record['nextCardSeq']) : 1
  return { apiVersion: 'dataforge/v1', kind: 'interface-library-index', nextCardSeq: seq, cards }
}

/**
 * 读索引。索引缺失或坏了 → **按卡文件重建**（卡文件是权威，索引只是加速器）。
 * 永不抛：库里没有卡就是空索引。
 */
export function readIndex(workspaceRoot: string): LibraryIndex {
  const path = indexPath(workspaceRoot)
  let index: LibraryIndex | undefined
  if (existsSync(path)) {
    try {
      index = parseIndexFile(readFileSync(path, 'utf8'))
    } catch {
      index = undefined
    }
  }
  const cards = listCards(workspaceRoot)
  const entries = new Map<string, LibraryIndexEntry>()
  for (const card of cards) entries.set(card.cardId, indexEntryOf(card))
  // 索引里有、盘上没有的条目一律作废（卡被删了）——索引不留在场但不存在的东西。
  const merged: LibraryIndexEntry[] = [...entries.values()].sort((a, b) => (a.cardId < b.cardId ? -1 : 1))

  // 水位取**盘上文件名**的最大号，不是解析成功的卡的最大号：坏卡的号也占着，
  // 必须越过它，否则下一次分配会覆盖那张坏卡文件（"cardId 不复用"就破了）。
  const maxSeq = listCardIdsOnDisk(workspaceRoot).reduce((acc, cardId) => Math.max(acc, cardSeqOf(cardId) ?? 0), 0)
  const seqFloor = Math.max(index?.nextCardSeq ?? 1, maxSeq + 1, 1)
  return { apiVersion: 'dataforge/v1', kind: 'interface-library-index', nextCardSeq: seqFloor, cards: merged }
}

/** 落盘索引（原子写）。 */
export function writeIndex(workspaceRoot: string, index: LibraryIndex): string {
  mkdirSync(libraryRoot(workspaceRoot), { recursive: true })
  const path = indexPath(workspaceRoot)
  writeFileAtomic(
    path,
    yaml.dump(
      {
        apiVersion: index.apiVersion,
        kind: index.kind,
        nextCardSeq: index.nextCardSeq,
        cards: index.cards.map((entry) => ({
          cardId: entry.cardId,
          file: entry.file,
          mergeKey: entry.mergeKey,
          method: entry.method,
          urlTemplate: entry.urlTemplate,
          site: entry.site,
          updatedAt: entry.updatedAt,
        })),
      },
      { lineWidth: 120, noRefs: true, sortKeys: false },
    ),
  )
  return path
}

/** 按归并键找卡（索引命中即可，不用翻卡文件）。 */
export function findCardByMergeKey(workspaceRoot: string, mergeKey: string): { entry: LibraryIndexEntry; card: LibraryCard } | undefined {
  const entry = readIndex(workspaceRoot).cards.find((item) => item.mergeKey === mergeKey)
  if (entry === undefined) return undefined
  const card = readCard(workspaceRoot, entry.cardId)
  return card === undefined ? undefined : { entry, card }
}

/**
 * 分配一个新 cardId 并把水位推进一位。**不复用**：水位来自 `readIndex` 的
 * `nextCardSeq`（它已经取了盘上最大卡号 +1 兜底），删卡也不会把号还回去。
 * 返回推进后的索引（调用方继续写卡/写索引，避免同一批导入反复读盘）。
 */
export function allocateCardId(
  workspaceRoot: string,
  index: LibraryIndex,
): { cardId: string; index: LibraryIndex } {
  let seq = index.nextCardSeq
  // 防御：水位若与盘上文件撞号（索引被手改过），往后挪到空号为止。
  while (readCard(workspaceRoot, cardIdOf(seq)) !== undefined) seq += 1
  return { cardId: cardIdOf(seq), index: { ...index, nextCardSeq: seq + 1 } }
}

/** 把一张卡登记进索引（同 cardId 覆盖，新增追加）。 */
export function upsertIndexEntry(index: LibraryIndex, card: LibraryCard): LibraryIndex {
  const entry = indexEntryOf(card)
  const cards = index.cards.filter((item) => item.cardId !== card.cardId)
  cards.push(entry)
  cards.sort((a, b) => (a.cardId < b.cardId ? -1 : 1))
  const seq = cardSeqOf(card.cardId) ?? 0
  return { ...index, cards, nextCardSeq: Math.max(index.nextCardSeq, seq + 1) }
}

/**
 * 建一张新卡并落盘（分配 cardId → 写卡 → 把索引推进内存态返回）。
 * 调用方负责在整批结束后 `writeIndex`，避免逐卡刷盘。
 */
export function createCard(
  workspaceRoot: string,
  index: LibraryIndex,
  draft: LibraryCardDraft,
): { card: LibraryCard; index: LibraryIndex } {
  const allocated = allocateCardId(workspaceRoot, index)
  const card: LibraryCard = { cardId: allocated.cardId, ...draft }
  writeCard(workspaceRoot, card)
  return { card, index: upsertIndexEntry(allocated.index, card) }
}
