/**
 * 凭证注入的纯函数与契约（R-4 M1）。
 *
 * 边界（重要）：
 *   - 本模块**不读盘、不联网**：只做 cookie 匹配、排序、头合并；
 *   - 执行层不认识采集库、不认识 SQLite：凭证来源由注入的 `CredentialProvider` 提供；
 *   - 摘要（`CredentialApplication`）**永不含凭证值**，只留名字/域/来源 captureId。
 *
 * 匹配语义取浏览器 cookie 的最小集：domain / path / secure / expires。
 * 不做 SameSite、Partitioned、Port 等高级语义——那些在 M1 的目标站点里不改变
 * 「这一发请求带不带这个 cookie」的结论，贸然实现反而会制造与浏览器不一致的假阴性。
 *
 * @module dsh-dataforge/execute/credentials
 */
import type { InterfaceCardDoc } from '../chains/schema.js'

/** 一条可注入的 cookie：值只在内存里过手，不进入任何摘要。 */
export type CredentialCookie = {
  name: string
  value: string
  /** 原样保留前导点（`.example.com`）；匹配时再归一。 */
  domain: string
  /** cookie path；缺省 `/`。 */
  path: string
  secure: boolean
  /** 毫秒时间戳；`undefined` = 会话 cookie（不按时间过期）。 */
  expiresAt?: number
  captureId: string
  obtainedAt: number
}

/** 注入状态：`applied` 才有 `headers`；其余都是「没带」的诚实叙述。 */
export type CredentialApplicationStatus = 'applied' | 'none' | 'expired' | 'unsupported'

/** 可审计的注入摘要：只留名字，不留值。 */
export type CredentialApplication = {
  status: CredentialApplicationStatus
  source: 'capture'
  /** 目前只有 cookie；未来 token 注入会扩展，但不改名。 */
  header?: 'cookie'
  /** 注入的 cookie 名（不是值）。 */
  names: string[]
  /** 匹配到的 cookie 域（不是页面 URL）。 */
  domains: string[]
  /** 卡来源里实际查询过的 captureId（用于回答「从哪一批采集拿的」）。 */
  captureIds: string[]
  /** 匹配到但已过期的条数。 */
  expired: number
  /** R-4 M3：其中来自持久化换票 jar 的条数（0/缺省 = 全部来自采集库）。 */
  persisted?: number
  /** 降级原因（可进事件，不含值）。 */
  reason?: string
}

/** 一次注入查询：执行层唯一认识的最小上下文。 */
export type CredentialNeed = {
  card: InterfaceCardDoc
  /** `buildRequest()` 产出的绝对 URL。 */
  url: string
  method: string
  nodeId: string
}

export type CredentialResolution = {
  /** 要合并进请求的头（目前只有 `cookie`）；没有就是空对象。 */
  headers: Record<string, string>
  application: CredentialApplication
}

/** 注入缝：provider 缺席 = 不注入（R-3 行为）。 */
export type CredentialProvider = (need: CredentialNeed) => CredentialResolution

/** `selectCookies()` 的三段结果：匹配全集 / 过期子集 / 最终可发送子集。 */
export type CookieSelection = {
  selected: CredentialCookie[]
  expired: CredentialCookie[]
  matched: CredentialCookie[]
}

/** 空摘要（降级用）。 */
export function emptyCredentialApplication(
  status: Exclude<CredentialApplicationStatus, 'applied'>,
  reason: string,
  captureIds: string[] = [],
): CredentialApplication {
  return { status, source: 'capture', names: [], domains: [], captureIds: [...captureIds], expired: 0, reason }
}

/** 去掉前导点并小写：`.Example.com` → `example.com`。 */
function normalizeDomain(domain: string): string {
  return domain.replace(/^\./, '').toLowerCase()
}

/** 域名匹配：host 等于域，或 host 以 `.域` 结尾（`badexample.com` 不会命中 `example.com`）。 */
export function domainMatches(host: string, cookieDomain: string): boolean {
  const domain = normalizeDomain(cookieDomain)
  if (domain === '') return false
  const target = host.toLowerCase()
  return target === domain || target.endsWith(`.${domain}`)
}

/** 路径匹配：`/api` 命中 `/api/x`，不命中 `/apix`；`/` 恒命中。 */
export function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (cookiePath === '' || cookiePath === '/') return true
  if (requestPath === cookiePath) return true
  if (!requestPath.startsWith(cookiePath)) return false
  return cookiePath.endsWith('/') || requestPath[cookiePath.length] === '/'
}

function expiredAt(cookie: CredentialCookie, now: number): boolean {
  return cookie.expiresAt !== undefined && cookie.expiresAt <= now
}

function domainSpecificity(cookie: CredentialCookie): number {
  return normalizeDomain(cookie.domain).length
}

/**
 * 按目标 URL 选 cookie：domain/path/secure 匹配 → 过期拆分 → 同名去重 → 排序。
 *
 * 同名去重键是 `name + path`：浏览器可能同时持有父域与子域的同名 cookie，
 * 全发出去会让服务端取到不确定的那一个。这里选**更具体的域**（更长），
 * 同域再取 `obtainedAt` 更新者——可解释、可复现。
 */
export function selectCookies(entries: CredentialCookie[], url: string, now: number): CookieSelection {
  let target: URL
  try {
    target = new URL(url)
  } catch {
    return { selected: [], expired: [], matched: [] }
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return { selected: [], expired: [], matched: [] }
  }

  const host = target.hostname
  const requestPath = target.pathname === '' ? '/' : target.pathname
  const matched: CredentialCookie[] = []
  for (const cookie of entries) {
    if (cookie.name === '' || cookie.value === '') continue
    if (!domainMatches(host, cookie.domain)) continue
    if (!pathMatches(requestPath, cookie.path)) continue
    if (cookie.secure && target.protocol !== 'https:') continue
    matched.push(cookie)
  }

  const expired: CredentialCookie[] = []
  const live: CredentialCookie[] = []
  for (const cookie of matched) (expiredAt(cookie, now) ? expired : live).push(cookie)

  const byKey = new Map<string, CredentialCookie>()
  for (const cookie of live) {
    const key = `${cookie.name}\u0000${cookie.path}`
    const existing = byKey.get(key)
    if (
      existing === undefined ||
      domainSpecificity(cookie) > domainSpecificity(existing) ||
      (domainSpecificity(cookie) === domainSpecificity(existing) && cookie.obtainedAt > existing.obtainedAt)
    ) {
      byKey.set(key, cookie)
    }
  }

  const selected = [...byKey.values()].sort((left, right) => {
    if (left.path.length !== right.path.length) return right.path.length - left.path.length
    return left.name.localeCompare(right.name)
  })

  return { selected, expired, matched }
}

/** 选中的 cookie → `Cookie` 头值；空集合返回 `undefined`（不造空头）。 */
export function cookieHeaderOf(cookies: CredentialCookie[]): string | undefined {
  if (cookies.length === 0) return undefined
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
}

/**
 * 合并凭证头：头名大小写不敏感；`cookie` 与已有值拼接，其它同名以注入值为准。
 *
 * 纯函数：不修改入参对象。凭证是权威——卡上若显式写了同名头，注入值覆盖它；
 * 唯一例外是 `cookie`，因为丢弃卡上已有的 cookie 会静默改变请求语义。
 */
export function mergeCredentialHeaders(
  existing: Record<string, string>,
  injected: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = { ...existing }
  for (const [rawName, value] of Object.entries(injected)) {
    const key = Object.keys(out).find((candidate) => candidate.toLowerCase() === rawName.toLowerCase())
    if (key === undefined) {
      out[rawName] = value
      continue
    }
    if (key.toLowerCase() === 'cookie' && out[key] !== '') out[key] = `${out[key]}; ${value}`
    else out[key] = value
  }
  return out
}

/** 由匹配结果构造 `applied` 摘要（名字/域/来源，不含值）。 */
export function appliedCredentialApplication(
  selection: CookieSelection,
  captureIds: string[],
): CredentialApplication {
  return {
    status: 'applied',
    source: 'capture',
    header: 'cookie',
    names: selection.selected.map((cookie) => cookie.name),
    domains: [...new Set(selection.selected.map((cookie) => normalizeDomain(cookie.domain)))],
    captureIds: [...captureIds],
    expired: selection.expired.length,
  }
}

/* ------------------------------------------------------------------ M2 换票 */

/** 一条 `Set-Cookie` 解析出的名字/值（属性丢弃）。 */
export type SetCookiePair = { name: string; value: string }

/**
 * 解析 `Set-Cookie`：只取 `name=value`，属性（Path/Domain/HttpOnly…）不进内存 jar。
 *
 * M2 的 jar 只服务「同一个主链目标站点」的重放，不需要跨域/跨路径选择；
 * 真正的域/路径匹配仍由采集期 provider 负责。属性丢掉是刻意的简化，写在设计里。
 */
export function setCookiePairsOf(setCookies: string[]): SetCookiePair[] {
  const pairs: SetCookiePair[] = []
  for (const raw of setCookies) {
    const first = raw.split(';')[0]?.trim() ?? ''
    const at = first.indexOf('=')
    if (at <= 0) continue
    const name = first.slice(0, at).trim()
    const value = first.slice(at + 1).trim()
    if (name === '' || value === '') continue
    pairs.push({ name, value })
  }
  return pairs
}

/** `Set-Cookie[]` → 一个可发的 `cookie` 头值；没有可用 cookie 返回 `undefined`。 */
export function cookieHeaderFromSetCookies(setCookies: string[]): string | undefined {
  const pairs = setCookiePairsOf(setCookies)
  if (pairs.length === 0) return undefined
  return pairs.map((pair) => `${pair.name}=${pair.value}`).join('; ')
}

/** cookie 头值里的名字（去重、保序）；用于事件摘要，不含值。 */
export function cookieNamesOf(header: string | undefined): string[] {
  if (header === undefined || header === '') return []
  const names: string[] = []
  for (const part of header.split(';')) {
    const name = part.trim().split('=')[0]?.trim() ?? ''
    if (name !== '' && !names.includes(name)) names.push(name)
  }
  return names
}

/**
 * 合并两份 cookie 头：按 name 覆盖，fresh 永远赢。
 *
 * 换票后的新会话 cookie 必须覆盖旧值；保留其它 cookie（locale/AB 等）能减少
 * 「登录成功但页面参数丢了」的次生失败。返回 `undefined` 表示两边都没有。
 */
export function mergeCookieValues(base: string | undefined, fresh: string | undefined): string | undefined {
  const pairs = new Map<string, string>()
  const ingest = (header: string | undefined): void => {
    if (header === undefined || header === '') return
    for (const part of header.split(';')) {
      const trimmed = part.trim()
      const at = trimmed.indexOf('=')
      if (at <= 0) continue
      const name = trimmed.slice(0, at).trim()
      const value = trimmed.slice(at + 1).trim()
      if (name !== '') pairs.set(name, value)
    }
  }
  ingest(base)
  ingest(fresh)
  if (pairs.size === 0) return undefined
  return [...pairs].map(([name, value]) => `${name}=${value}`).join('; ')
}

/** 把 `cookie` 头写进请求头（大小写不敏感替换）；不修改入参。 */
export function withCookieHeader(
  headers: Record<string, string>,
  cookieHeader: string | undefined,
): Record<string, string> {
  const out: Record<string, string> = { ...headers }
  if (cookieHeader === undefined || cookieHeader === '') return out
  const key = Object.keys(out).find((name) => name.toLowerCase() === 'cookie')
  if (key === undefined) out['cookie'] = cookieHeader
  else out[key] = cookieHeader
  return out
}

/** 读取请求头里的 cookie 值（大小写不敏感）；没有返回 `undefined`。 */
export function cookieHeaderIn(headers: Record<string, string>): string | undefined {
  const key = Object.keys(headers).find((name) => name.toLowerCase() === 'cookie')
  return key === undefined ? undefined : headers[key]
}
