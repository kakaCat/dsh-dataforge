/**
 * 采集库 → 执行期凭证的只读适配器（R-4 M1/M3）。
 *
 * 为什么单独一层：执行层（`execute/*`）不认识 SQLite、不认识采集表；它只认
 * `CredentialProvider` 这个函数形状。本模块把「一期采集库」翻译成那个形状，
 * 读路径全程 `readonly`——不建表、不迁移、不写事件（与 `library/import.ts` 同一纪律）。
 *
 * 安全边界：
 *   - 只按卡的 `sources[].captureId` 查，**不做全库兜底扫描**（避免把 A 站凭证发给 B 站）；
 *   - cookie 型只取 `kind='cookie'`；token 型（M3）只取 `kind='token'`，且只按卡声明的
 *     `auth` 与 evidence 名匹配，不猜 Authorization 的 scheme；
 *   - body token 本期**不注入**，如实标 `unsupported`（注入语义与 query/header 不同）；
 *   - 返回值里的摘要只含名字/域/来源，值只进 `headers.*` 或 `query` 这一条出站请求。
 *
 * 运行级缓存（M3）：
 *   - `cache: true` 时按「db 文件 mtimeMs+size」与「持久化 jar 文件 mtimeMs+size」做键缓存行；
 *   - 文件内容变化 → 自动失效并重读；文件被删除 → 沿用缓存（同一运行内不因中途删库丢凭证）；
 *   - 缺省关闭，保证不传 `cache` 的调用方行为与 M1 完全一致。
 *
 * @module dsh-dataforge/capture/credentials
 */
import { statSync } from 'node:fs'
import Database from 'better-sqlite3'
import type { InterfaceCardDoc } from '../chains/schema.js'
import type {
  CredentialApplication,
  CredentialCookie,
  CredentialInjectionSite,
  CredentialProvider,
  CredentialResolution,
} from '../execute/credentials.js'
import {
  appliedCredentialApplication,
  cookieHeaderOf,
  emptyCredentialApplication,
  selectCookies,
} from '../execute/credentials.js'
import { originOfUrl, readPersistedCookies } from './credential-store.js'
import { tokenValueOfJson, type TokenLocation } from './token-harvest.js'

/** 采集库里的 credential_events 行（只取本模块用到的列）。 */
type CredentialRow = {
  capture_id: string
  url: string | null
  name: string
  value_json: string | null
  obtained_at: number
}

/** 一次读取拿到的行（cookie + token 共用同一次 SQLite 打开）。 */
type CredentialRows = {
  cookieRows: CredentialRow[]
  tokenRows: CredentialRow[]
  databaseError?: string
}

type RowCacheEntry = CredentialRows & { dbSig: string; dbWalSig: string; storeSig: string }

/** 一行 token → 可注入的 token（值只在内存里过手）。 */
type TokenCredential = {
  location: TokenLocation
  name: string
  value: string
  captureId: string
  obtainedAt: number
}

export type CaptureCredentialProviderOptions = {
  /** `dataRoot/capture/capture.sqlite`。 */
  dbPath: string
  /**
   * R-4 M3：换票结果持久化文件（`dataRoot/credentials/cookies.json`）。
   * 缺省不读持久化；传入后按目标 origin 合并，换票得到的新 cookie 优先。
   */
  storePath?: string
  /** 测试可注入的时钟（毫秒）。 */
  now?: () => number
  /**
   * R-4 M3：运行级缓存。缺省 `false`（每次查询都只读打开采集库，与 M1 行为一致）；
   * 打开后同一 db/jar 文件签名内复用行，文件变化自动失效。
   */
  cache?: boolean
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 卡来源里的 captureId（去重、保序、去掉空串）。 */
export function captureIdsOf(card: InterfaceCardDoc): string[] {
  const ids = new Set<string>()
  for (const source of card.sources ?? []) {
    if (typeof source.captureId === 'string' && source.captureId !== '') ids.add(source.captureId)
  }
  return [...ids]
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/**
 * 文件签名（缓存键）：`mtimeMs:size`；不存在返回 `missing`。
 *
 * 采集库是 SQLite WAL：提交只写 `-wal` 边车文件，主库文件的 mtime/size 可能长期不变。
 * 所以 db 的签名 = 主库 + `-wal` 两个文件；否则一次运行写入的新 token 会被缓存挡住，
 * 变成「跨 run 陈旧数据」。运行级缓存的语义是「同一份采集库内容内不重复开库」，不是永久缓存。
 */
function fileSignature(path: string): string {
  try {
    const stat = statSync(path)
    return `${stat.mtimeMs}:${stat.size}`
  } catch {
    return 'missing'
  }
}

/** 缓存命中判据：文件现在不存在（运行中被删）或与缓存时签名一致。 */
function signatureStillValid(current: string, cached: string): boolean {
  return current === 'missing' || current === cached
}

/** 只读打开采集库，一次查询取回 cookie 与 token 行；读不到就抛给调用方折成降级。 */
function readCredentialRows(dbPath: string, captureIds: string[]): { cookieRows: CredentialRow[]; tokenRows: CredentialRow[] } {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    const placeholders = captureIds.map(() => '?').join(',')
    const select = (kind: 'cookie' | 'token'): CredentialRow[] =>
      db
        .prepare(
          `SELECT capture_id, url, name, value_json, obtained_at
           FROM credential_events
           WHERE capture_id IN (${placeholders}) AND kind = ?
           ORDER BY obtained_at ASC`,
        )
        .all(...captureIds, kind) as CredentialRow[]
    return { cookieRows: select('cookie'), tokenRows: select('token') }
  } finally {
    db.close()
  }
}

/** Playwright `expires`（秒）→ 毫秒；`-1`/`0`/缺失 = 会话 cookie。 */
function expiresAtOf(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return undefined
  // 防御：老数据若已经是毫秒（> 1e12），不再乘 1000。
  return raw > 1e12 ? raw : raw * 1000
}

/**
 * 一行 → 0..1 条 cookie。坏 JSON / 缺名缺值一律跳过——一条坏行不该炸整条链。
 */
function cookieOfRow(row: CredentialRow): CredentialCookie | undefined {
  if (row.value_json === null || row.value_json === '') return undefined
  let raw: unknown
  try {
    raw = JSON.parse(row.value_json)
  } catch {
    return undefined
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const record = raw as Record<string, unknown>

  const name = typeof record['name'] === 'string' && record['name'] !== '' ? record['name'] : row.name
  const value = typeof record['value'] === 'string' ? record['value'] : ''
  if (name === '' || value === '') return undefined

  const domain =
    typeof record['domain'] === 'string' && record['domain'] !== ''
      ? record['domain']
      : (row.url ?? '')
  if (domain === '') return undefined

  const path = typeof record['path'] === 'string' && record['path'] !== '' ? record['path'] : '/'
  return {
    name,
    value,
    domain,
    path,
    secure: record['secure'] === true,
    expiresAt: expiresAtOf(record['expires']),
    captureId: row.capture_id,
    obtainedAt: row.obtained_at,
  }
}

/** 一行 → token（坏 JSON/缺字段跳过）。 */
function tokenOfRow(row: CredentialRow): TokenCredential | undefined {
  const value = tokenValueOfJson(row.value_json)
  if (value === undefined) return undefined
  return { ...value, captureId: row.capture_id, obtainedAt: row.obtained_at }
}

/** 取 `obtainedAt` 最新的一条（同时间取后出现者，与 SQL ASC 顺序对齐）。 */
function latestOf<T extends { obtainedAt: number }>(items: T[]): T | undefined {
  let best: T | undefined
  for (const item of items) {
    if (best === undefined || item.obtainedAt >= best.obtainedAt) best = item
  }
  return best
}

/**
 * 读卡的鉴权证据名（如 `header:authorization` / `query:access_token`）。
 *
 * 卡 schema 从 R-4 M3 起显式收 `authEvidence`（只存名字）；老卡没有该字段时
 * 返回 undefined，由 provider 按 token 位置的缺省名兜底。
 */
function authEvidenceOf(card: InterfaceCardDoc): string | undefined {
  const raw = card.authEvidence
  return typeof raw === 'string' && raw !== '' ? raw : undefined
}

/** `evidence` 前缀匹配：`header:authorization` + kind=`header` → `authorization`。 */
function evidenceNameOf(evidence: string | undefined, kind: TokenLocation): string | undefined {
  if (evidence === undefined) return undefined
  const prefix = `${kind}:`
  if (!evidence.toLowerCase().startsWith(prefix)) return undefined
  const name = evidence.slice(prefix.length).trim()
  return name === '' ? undefined : name
}

function none(reason: string, captureIds: string[]): CredentialResolution {
  return { headers: {}, application: emptyCredentialApplication('none', reason, captureIds) }
}

/** 卡声明了 token 型鉴权，但采集库里没有可注入的值：如实 unsupported + 原因。 */
function unsupportedReason(reason: string, captureIds: string[]): CredentialResolution {
  return { headers: {}, application: emptyCredentialApplication('unsupported', reason, captureIds) }
}

function unsupported(card: InterfaceCardDoc, captureIds: string[]): CredentialResolution {
  const reason = `未知鉴权类型「${String(card.auth)}」：不注入`
  return unsupportedReason(reason, captureIds)
}

/** token 型注入摘要（只留头/参数名，不含值）。 */
function appliedTokenApplication(
  header: Exclude<CredentialInjectionSite, 'cookie'>,
  names: string[],
  captureIds: string[],
): CredentialApplication {
  return {
    status: 'applied',
    source: 'capture',
    header,
    names: [...names],
    domains: [],
    captureIds: [...captureIds],
    expired: 0,
  }
}

/**
 * 创建执行期凭证 provider。
 *
 * 缺省每次调用按需只读打开/关闭 SQLite（节点量级几十到几百，打开开销可接受）；
 * `cache: true` 时按文件签名复用行（M3 运行级缓存）。
 */
export function createCaptureCredentialProvider(options: CaptureCredentialProviderOptions): CredentialProvider {
  const now = options.now ?? (() => Date.now())
  const useCache = options.cache === true
  const rowCache = new Map<string, RowCacheEntry>()

  const storeSig = (): string => (options.storePath === undefined ? 'absent' : fileSignature(options.storePath))

  const loadRows = (captureIds: string[]): CredentialRows => {
    if (captureIds.length === 0) return { cookieRows: [], tokenRows: [] }
    const key = captureIds.join('\u0000')
    const dbSig = fileSignature(options.dbPath)
    const dbWalSig = fileSignature(`${options.dbPath}-wal`)
    const jarSig = storeSig()
    if (useCache) {
      const hit = rowCache.get(key)
      if (
        hit !== undefined &&
        signatureStillValid(dbSig, hit.dbSig) &&
        signatureStillValid(dbWalSig, hit.dbWalSig) &&
        signatureStillValid(jarSig, hit.storeSig)
      ) {
        return hit
      }
    }
    try {
      const rows = readCredentialRows(options.dbPath, captureIds)
      if (useCache) rowCache.set(key, { dbSig, dbWalSig, storeSig: jarSig, ...rows })
      return rows
    } catch (error) {
      // 读失败不缓存：文件可能是刚建好/正在被换掉，下一次调用值得重试。
      return { cookieRows: [], tokenRows: [], databaseError: messageOf(error) }
    }
  }

  const resolveCookies = (need: { url: string }, captureIds: string[], rows: CredentialRows): CredentialResolution => {
    const entries: CredentialCookie[] = []
    for (const row of rows.cookieRows) {
      const cookie = cookieOfRow(row)
      if (cookie !== undefined) entries.push(cookie)
    }
    const databaseError = rows.databaseError

    // R-4 M3：换票结果持久化。按目标 origin 精确取，同名由 selectCookies 去重时新值胜出
    // （持久化 cookie 的 domain 是目标 host，比采集 cookie 的 `.父域` 更具体）。
    if (options.storePath !== undefined) {
      const origin = originOfUrl(need.url)
      if (origin !== undefined) entries.push(...readPersistedCookies(options.storePath, origin, now()))
    }

    if (entries.length === 0) {
      if (captureIds.length === 0) {
        return none(
          databaseError === undefined
            ? '卡没有采集来源（sources[].captureId 为空）'
            : `采集库不可用：${databaseError}`,
          [],
        )
      }
      return databaseError === undefined
        ? none(`没有匹配 ${hostOf(need.url)} 的 cookie`, captureIds)
        : none(`采集库不可用：${databaseError}`, captureIds)
    }

    const selection = selectCookies(entries, need.url, now())
    const header = cookieHeaderOf(selection.selected)
    if (header === undefined) {
      if (selection.matched.length > 0) {
        const application: CredentialApplication = {
          ...emptyCredentialApplication('expired', '匹配到的 cookie 全部过期', captureIds),
          expired: selection.matched.length,
        }
        return { headers: {}, application }
      }
      return none(`没有匹配 ${hostOf(need.url)} 的 cookie`, captureIds)
    }

    const application = appliedCredentialApplication(selection, captureIds)
    const persistedUsed = selection.selected.filter((cookie) => cookie.captureId === 'persisted').length
    if (persistedUsed > 0) application.persisted = persistedUsed
    // 持久化命中但采集库不可用：摘要里保留原因，不把「从哪来的」说错。
    if (databaseError !== undefined) application.reason = `采集库不可用（已用持久化凭证兜底）：${databaseError}`
    return { headers: { cookie: header }, application }
  }

  /** token-header：按 evidence 名取最新 token（缺省 `authorization`），值原样注入。 */
  const resolveTokenHeader = (
    captureIds: string[],
    tokens: TokenCredential[],
    evidence: string | undefined,
  ): CredentialResolution => {
    const proposed = evidenceNameOf(evidence, 'header')
    const headerTokens = tokens.filter((token) => token.location === 'header')
    const wanted = (proposed ?? 'authorization').toLowerCase()
    let headerName = wanted
    let pick = latestOf(headerTokens.filter((token) => token.name.toLowerCase() === wanted))

    // 没有 evidence（链侧投影丢了 authEvidence）时不做无谓的 null：只要真采到 header token，
    // 就按它自己的头名注入（`proxy-authorization` 也走这里）；有 evidence 时仍严格匹配。
    if (pick === undefined && proposed === undefined) {
      pick = latestOf(headerTokens)
      if (pick !== undefined) headerName = pick.name.toLowerCase()
    }

    if (pick === undefined) {
      return unsupportedReason(
        `token 型凭证未采集：采集库里没有 ${wanted} 头，需重新采集登录态站点（不猜 Authorization scheme）`,
        captureIds,
      )
    }
    return {
      headers: { [headerName]: pick.value },
      application: appliedTokenApplication('authorization', [headerName], captureIds),
    }
  }

  /** token-param：按 evidence 名取最新 query token；body token 如实 unsupported。 */
  const resolveTokenParam = (
    captureIds: string[],
    tokens: TokenCredential[],
    evidence: string | undefined,
  ): CredentialResolution => {
    if (evidence !== undefined && evidence.toLowerCase().startsWith('body:')) {
      return unsupportedReason(
        `token 型凭证暂不支持 body 注入（证据 ${evidence}）：body 字段不是 query 参数，本期只注入 header/query token`,
        captureIds,
      )
    }
    const proposed = evidenceNameOf(evidence, 'query')
    const queryTokens = tokens.filter((token) => token.location === 'query')
    const wanted = proposed?.toLowerCase()
    let pick =
      wanted === undefined
        ? latestOf(queryTokens)
        : latestOf(queryTokens.filter((token) => token.name.toLowerCase() === wanted))
    // 没有 evidence 时允许按「最新 query token」兜底；有 evidence 但采不到时绝不换个参数凑数。
    if (pick === undefined && proposed === undefined && queryTokens.length > 0) {
      pick = latestOf(queryTokens)
    }
    if (pick === undefined) {
      const bodyTokens = tokens.filter((token) => token.location === 'body')
      if (proposed === undefined && bodyTokens.length > 0) {
        return unsupportedReason(
          `token 型凭证暂不支持 body 注入（采到 ${bodyTokens.length} 条 body token）：本期只注入 header/query token`,
          captureIds,
        )
      }
      return unsupportedReason(
        `token 型凭证未采集：采集库里没有 ${proposed ?? 'query token'} 参数，需重新采集登录态站点`,
        captureIds,
      )
    }
    const paramName = pick.name
    return {
      headers: {},
      query: { [paramName]: pick.value },
      application: appliedTokenApplication('query', [paramName], captureIds),
    }
  }

  const resolveToken = (
    card: InterfaceCardDoc,
    captureIds: string[],
    rows: CredentialRows,
  ): CredentialResolution => {
    if (captureIds.length === 0) {
      return unsupportedReason('卡没有采集来源（sources[].captureId 为空），无法补采 token', captureIds)
    }
    if (rows.databaseError !== undefined) {
      return unsupportedReason(`采集库不可用，无法补采 token：${rows.databaseError}`, captureIds)
    }
    const tokens: TokenCredential[] = []
    for (const row of rows.tokenRows) {
      const token = tokenOfRow(row)
      if (token !== undefined) tokens.push(token)
    }
    const evidence = authEvidenceOf(card)
    return card.auth === 'token-header'
      ? resolveTokenHeader(captureIds, tokens, evidence)
      : resolveTokenParam(captureIds, tokens, evidence)
  }

  return (need) => {
    const card = need.card
    const captureIds = captureIdsOf(card)

    if (card.auth === undefined || card.auth === 'none') return none('该卡无鉴权', captureIds)
    if (card.auth === 'unknown') return none('鉴权标志未判定，不注入', captureIds)
    const tokenAuth = card.auth === 'token-header' || card.auth === 'token-param'
    if (card.auth !== 'cookie-session' && !tokenAuth) return unsupported(card, captureIds)

    const rows = loadRows(captureIds)
    return tokenAuth ? resolveToken(card, captureIds, rows) : resolveCookies(need, captureIds, rows)
  }
}
