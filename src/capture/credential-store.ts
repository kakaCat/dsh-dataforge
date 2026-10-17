/**
 * 换票 cookie 的本地持久化（R-4 M3）。
 *
 * 为什么要落盘：M2 的换票结果只活一次运行，R-6 的「隔天复跑」会重新 401、重新登录。
 * 这里把登录链下发的 cookie 存到 `dataRoot/credentials/cookies.json`，下一次运行
 * 由 provider 按 origin 读回，直接带上去。
 *
 * 安全纪律（红线，改代码前先读）：
 *   - 只存本地 `dataRoot`，目录 0700、文件 0600；不做任何上传/日志/回执输出；
 *   - 按 **origin** 隔离：`https://a.example.com` 的 cookie 不会发给 `b.example.com`；
 *   - 只由登录链（换票）写入；普通主链响应里的 `set-cookie` 不落盘；
 *   - 文件损坏/超大 → 当作空库，不抛、不阻塞执行；
 *   - 凭证值只出现在这个文件和出站 `cookie` 头里，事件/摘要/回执一律不落值。
 *
 * @module dsh-dataforge/capture/credential-store
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { CredentialCookie } from '../execute/credentials.js'

/** 单 origin 最多保留的 cookie 数（防登录接口刷出无限多）。 */
const MAX_COOKIES_PER_ORIGIN = 100

/** 读文件上限：超过就当作空库（防止有人把大文件塞进数据根）。 */
const MAX_STORE_BYTES = 512 * 1024

export type PersistedCookie = {
  name: string
  value: string
  /** 毫秒时间戳；缺省 = 会话 cookie（不按时间过期）。 */
  expiresAt?: number
}

export type PersistedOrigin = {
  updatedAt: number
  cookies: PersistedCookie[]
}

export type PersistedStore = {
  version: 1
  origins: Record<string, PersistedOrigin>
}

function emptyStore(): PersistedStore {
  // null 原型：防止坏 JSON 里的 `__proto__` 键污染普通对象。
  return { version: 1, origins: Object.create(null) as Record<string, PersistedOrigin> }
}

/** 读库：不存在/坏 JSON/超大 → 空库。绝不抛。 */
export function readStore(storePath: string): PersistedStore {
  try {
    if (!existsSync(storePath)) return emptyStore()
    const text = readFileSync(storePath, 'utf8')
    if (text.length === 0 || Buffer.byteLength(text, 'utf8') > MAX_STORE_BYTES) return emptyStore()
    const raw = JSON.parse(text) as unknown
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return emptyStore()
    const record = raw as Record<string, unknown>
    if (record['version'] !== 1) return emptyStore()
    const originsRaw = record['origins']
    if (typeof originsRaw !== 'object' || originsRaw === null || Array.isArray(originsRaw)) return emptyStore()

    const origins = Object.create(null) as Record<string, PersistedOrigin>
    for (const [origin, value] of Object.entries(originsRaw as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
      const entry = value as Record<string, unknown>
      const cookiesRaw = entry['cookies']
      if (!Array.isArray(cookiesRaw)) continue
      const cookies: PersistedCookie[] = []
      for (const item of cookiesRaw) {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
        const cookie = item as Record<string, unknown>
        const name = typeof cookie['name'] === 'string' ? cookie['name'] : ''
        const cookieValue = typeof cookie['value'] === 'string' ? cookie['value'] : ''
        if (name === '' || cookieValue === '') continue
        const expiresAt = typeof cookie['expiresAt'] === 'number' && Number.isFinite(cookie['expiresAt'])
          ? cookie['expiresAt']
          : undefined
        cookies.push({ name, value: cookieValue, ...(expiresAt === undefined ? {} : { expiresAt }) })
      }
      if (cookies.length === 0) continue
      origins[origin] = {
        updatedAt: typeof entry['updatedAt'] === 'number' ? entry['updatedAt'] : 0,
        cookies,
      }
    }
    return { version: 1, origins }
  } catch {
    return emptyStore()
  }
}

/** 原子写：临时文件 0600 → rename；目录 0700。失败不抛（换票成功不应因落盘失败而失败）。 */
export function writeStore(storePath: string, store: PersistedStore): boolean {
  const tempPath = `${storePath}.${process.pid}.${Date.now()}.tmp`
  try {
    mkdirSync(dirname(storePath), { recursive: true, mode: 0o700 })
    try {
      chmodSync(dirname(storePath), 0o700)
    } catch {
      // 某些平台/文件系统不支持 chmod：不把它变成致命错误。
    }
    writeFileSync(tempPath, `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    renameSync(tempPath, storePath)
    try {
      chmodSync(storePath, 0o600)
    } catch {
      // 同上。
    }
    return true
  } catch {
    try {
      if (existsSync(tempPath)) unlinkSync(tempPath)
    } catch {
      // 清理失败不影响主流程。
    }
    return false
  }
}

/** `https://a.example.com/x` → `https://a.example.com`；非法 URL 返回 undefined。 */
export function originOfUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
    return parsed.origin
  } catch {
    return undefined
  }
}

/**
 * 解析一条 `Set-Cookie` 的 name/value/expiresAt。
 *
 * `Max-Age` 优先于 `Expires`（RFC 6265）；`Max-Age=0` 视为立即过期。
 * 属性名大小写不敏感；值里允许出现 `=`。
 */
function parseSetCookie(raw: string, now: number): PersistedCookie | undefined {
  const parts = raw.split(';')
  const first = parts[0]?.trim() ?? ''
  const at = first.indexOf('=')
  if (at <= 0) return undefined
  const name = first.slice(0, at).trim()
  const value = first.slice(at + 1).trim()
  if (name === '' || value === '') return undefined

  let expiresAt: number | undefined
  for (const part of parts.slice(1)) {
    const trimmed = part.trim()
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const attr = trimmed.slice(0, eq).trim().toLowerCase()
    const attrValue = trimmed.slice(eq + 1).trim()
    if (attr === 'max-age') {
      const seconds = Number(attrValue)
      if (Number.isFinite(seconds)) expiresAt = seconds <= 0 ? now - 1 : now + Math.floor(seconds) * 1000
    } else if (attr === 'expires' && expiresAt === undefined) {
      const parsed = Date.parse(attrValue)
      if (Number.isFinite(parsed)) expiresAt = parsed
    }
  }
  return { name, value, ...(expiresAt === undefined ? {} : { expiresAt }) }
}

/** 读某个 origin 的可用 cookie（已过期的不返回）。 */
export function readPersistedCookies(storePath: string, origin: string, now: number): CredentialCookie[] {
  const store = readStore(storePath)
  const entry = store.origins[origin]
  if (entry === undefined) return []
  let host: string
  let secure: boolean
  try {
    const parsed = new URL(origin)
    host = parsed.hostname
    secure = parsed.protocol === 'https:'
  } catch {
    return []
  }
  return entry.cookies
    .filter((cookie) => cookie.expiresAt === undefined || cookie.expiresAt > now)
    .map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: host,
      path: '/',
      secure,
      ...(cookie.expiresAt === undefined ? {} : { expiresAt: cookie.expiresAt }),
      captureId: 'persisted',
      obtainedAt: entry.updatedAt,
    }))
}

/**
 * 把登录链下发的 `set-cookie` 合并进某个 origin（同名覆盖），并原子落盘。
 *
 * 返回写入的 cookie 数（0 = 没有可用 cookie / 落盘失败）。失败不抛：
 * 换票本身已经成功，持久化是「下一次更省事」，不能反过来把当前链打断。
 */
export function persistCookies(storePath: string, origin: string, setCookies: string[], now: number): number {
  const parsed = setCookies
    .map((raw) => parseSetCookie(raw, now))
    .filter((cookie): cookie is PersistedCookie => cookie !== undefined)
    .filter((cookie) => cookie.expiresAt === undefined || cookie.expiresAt > now)
  if (parsed.length === 0) return 0

  const store = readStore(storePath)
  const existing = store.origins[origin]?.cookies ?? []
  const byName = new Map<string, PersistedCookie>()
  for (const cookie of existing) byName.set(cookie.name, cookie)
  for (const cookie of parsed) byName.set(cookie.name, cookie)
  let cookies = [...byName.values()].slice(-MAX_COOKIES_PER_ORIGIN)
  cookies = cookies.filter((cookie) => cookie.expiresAt === undefined || cookie.expiresAt > now)
  if (cookies.length === 0) {
    delete store.origins[origin]
    writeStore(storePath, store)
    return 0
  }
  store.origins[origin] = { updatedAt: now, cookies }
  return writeStore(storePath, store) ? parsed.length : 0
}
