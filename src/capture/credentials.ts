/**
 * 采集库 → 执行期凭证的只读适配器（R-4 M1）。
 *
 * 为什么单独一层：执行层（`execute/*`）不认识 SQLite、不认识采集表；它只认
 * `CredentialProvider` 这个函数形状。本模块把「一期采集库」翻译成那个形状，
 * 读路径全程 `readonly`——不建表、不迁移、不写事件（与 `library/import.ts` 同一纪律）。
 *
 * 安全边界：
 *   - 只按卡的 `sources[].captureId` 查，**不做全库兜底扫描**（避免把 A 站凭证发给 B 站）；
 *   - 只取 `kind='cookie'`；token/localStorage 一期没采到，M1 明确 `unsupported`，不猜；
 *   - 返回值里的摘要只含名字/域/来源，值只进 `headers.cookie` 这一条出站请求头。
 *
 * @module dsh-dataforge/capture/credentials
 */
import Database from 'better-sqlite3'
import type { InterfaceCardDoc } from '../chains/schema.js'
import type {
  CredentialApplication,
  CredentialCookie,
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

/** 采集库里的 credential_events 行（只取本模块用到的列）。 */
type CredentialRow = {
  capture_id: string
  url: string | null
  name: string
  value_json: string | null
  obtained_at: number
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

/** 只读打开采集库，查这批 captureId 的 cookie 行；读不到就抛给调用方折成降级。 */
function readCookieRows(dbPath: string, captureIds: string[]): CredentialRow[] {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    const placeholders = captureIds.map(() => '?').join(',')
    return db
      .prepare(
        `SELECT capture_id, url, name, value_json, obtained_at
         FROM credential_events
         WHERE capture_id IN (${placeholders}) AND kind = 'cookie'
         ORDER BY obtained_at ASC`,
      )
      .all(...captureIds) as CredentialRow[]
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

function none(reason: string, captureIds: string[]): CredentialResolution {
  return { headers: {}, application: emptyCredentialApplication('none', reason, captureIds) }
}

function unsupported(card: InterfaceCardDoc, captureIds: string[]): CredentialResolution {
  const reason =
    card.auth === 'token-header' || card.auth === 'token-param'
      ? `token 型凭证一期未采集（auth=${card.auth}）：需要补采集或改用 cookie 型站点`
      : `未知鉴权类型「${String(card.auth)}」：不注入`
  return { headers: {}, application: emptyCredentialApplication('unsupported', reason, captureIds) }
}

/**
 * 创建执行期凭证 provider。
 *
 * 每次调用按需只读打开/关闭 SQLite：节点量级几十到几百，打开开销可接受；
 * M1 以「正确、无状态」优先，缓存留到 M3 有实测瓶颈再加。
 */
export function createCaptureCredentialProvider(options: CaptureCredentialProviderOptions): CredentialProvider {
  const now = options.now ?? (() => Date.now())
  return (need) => {
    const card = need.card
    const captureIds = captureIdsOf(card)

    if (card.auth === undefined || card.auth === 'none') return none('该卡无鉴权', captureIds)
    if (card.auth === 'unknown') return none('鉴权标志未判定，不注入', captureIds)
    if (card.auth !== 'cookie-session') return unsupported(card, captureIds)

    const entries: CredentialCookie[] = []
    let databaseError: string | undefined

    if (captureIds.length > 0) {
      try {
        const rows = readCookieRows(options.dbPath, captureIds)
        for (const row of rows) {
          const cookie = cookieOfRow(row)
          if (cookie !== undefined) entries.push(cookie)
        }
      } catch (error) {
        databaseError = messageOf(error)
      }
    }

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
}
