/**
 * token 型凭证补采（R-4 M3）：从一期请求样本里收割 `Authorization` / query token。
 *
 * 为什么要有这一步：M1/M2 只消费 `kind='cookie'`，token 型卡在回执里只能标
 * `unsupported`。补采把「采集期已经出现在请求线上的 token」写成
 * `credential_events(kind='token')`，执行期 provider 再按卡的来源 captureId 读回。
 *
 * 安全边界（红线，改代码前先读）：
 *   - 凭证值只落 `credential_events.value_json`，**不写事件摘要**：追加的 credential
 *     事件只有 `name`（`header:authorization` / `query:access_token`）与脱敏后的 `url`；
 *   - 落库 URL 里的 token 类 query 参数值替换成 `***`——`request_samples` 本身已经
 *     留下原始请求线（那是采集事实），凭证事件不必再复写一份明文；
 *   - 本模块不联网、不读环境变量；唯一副作用是「扫描本 captureId 的样本 → 落 token 行」。
 *
 * 补采范围（诚实边界）：
 *   - header：`authorization` / `proxy-authorization`（值原样保留，含 `Bearer`/`Basic`）；
 *   - query：token 类参数名（大小写不敏感）；
 *   - body：JSON 顶层 token 类字段——**只检测、只落库**，注入侧本期如实标 `unsupported`
 *     （body token 与 query/header 的注入语义不同，不猜）；
 *   - 不采 localStorage / 登录表单：一期浏览器 API 没有对应采集点，冒领会让「看起来带了凭证」。
 *
 * @module dsh-dataforge/capture/token-harvest
 */
import type { CredentialRow, SampleRow } from '../shared/capture-types.js'

/** token 值在请求里的位置。 */
export type TokenLocation = 'header' | 'query' | 'body'

/** 一条可注入的 token 值（`value_json` 的形状）。 */
export type TokenValue = {
  location: TokenLocation
  /** header 名（小写）或 query/body 参数名（保留采集时的原始大小写）。 */
  name: string
  /** 原样值：`Bearer xxx` / `Basic xxx` / 裸 token。 */
  value: string
}

/** 从一条请求样本里检测出的 token 草案。 */
export type TokenDraft = {
  kind: 'token'
  /** 稳定的凭证事件名：`header:authorization` / `query:access_token` / `body:access_token`。 */
  name: string
  /** 采集时的请求 URL（落库前会脱敏 token 类 query 参数值）。 */
  url: string
  value: TokenValue
}

/** 检测输入：只取判断需要的字段（`request_samples` 行投影的子集）。 */
export type TokenSample = {
  url: string
  method: string
  requestHeaders: Record<string, string>
  requestBodyPreview?: string
  contentType?: string
}

/** 补采需要的最小 store 面（`CaptureStore` 结构上满足，测试可直接给假实现）。 */
export type TokenHarvestStore = {
  listSamples(captureId: string, limit?: number): SampleRow[]
  listCredentials(captureId: string, limit?: number): CredentialRow[]
  upsertCredential(
    captureId: string,
    kind: 'token',
    url: string,
    name: string,
    obtainedAt: number,
    value?: unknown,
  ): string
}

/** 单次补采最多扫描的样本数（与 `SAMPLE_LIMIT_PER_RUN` 对齐）。 */
export const TOKEN_HARVEST_SAMPLE_LIMIT = 1000
/** 单次补采最多读取的既有凭证行（去重基线）。 */
export const TOKEN_HARVEST_CREDENTIAL_LIMIT = 1000

/** 请求头里的 token 位置（与采集期 `classifyAuth` 的 TOKEN_HEADERS 同源）。 */
const TOKEN_HEADERS = new Set(['authorization', 'proxy-authorization'])

/**
 * query/body 里的 token 类参数名（与采集期 `classifyAuth` 的 TOKEN_PARAM_KEYS 对齐，
 * 另补 `id_token`/`jwt`/`refresh_token` 等 OAuth 常见名）。名称大小写不敏感。
 */
const TOKEN_PARAM_NAMES = new Set([
  'token',
  'access_token',
  'access-token',
  'accesstoken',
  'auth_token',
  'auth-token',
  'authtoken',
  'id_token',
  'id-token',
  'jwt',
  'api_key',
  'api-key',
  'apikey',
  'app_token',
  'apptoken',
  'refresh_token',
  'refresh-token',
  'access_key',
  'access-key',
])

function isTokenParamName(raw: string): boolean {
  const name = raw.trim().toLowerCase()
  if (name === '') return false
  if (TOKEN_PARAM_NAMES.has(name)) return true
  // `xsrf_token`/`csrf-token` 这类后缀名同样是 token 语义；只认明确的 `_token`/`-token` 后缀。
  return name.endsWith('_token') || name.endsWith('-token')
}

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return value
  }
  return undefined
}

/** 从 URL 里检测 token 类 query 参数（`searchParams` 已解码），逐条交给 push。 */
function collectQueryTokens(push: (value: TokenValue) => void, draftUrl: string): void {
  let parsed: URL
  try {
    // 采集样本的 URL 可能是相对路径；补一个不可路由的 base 只为解析 query。
    parsed = new URL(draftUrl, 'http://capture.local')
  } catch {
    return
  }
  for (const [name, value] of parsed.searchParams.entries()) {
    if (!isTokenParamName(name) || value === '') continue
    push({ location: 'query', name, value })
  }
}

/** 从 JSON 正文预览里检测顶层 token 类字段；坏 JSON / 非对象一律跳过。 */
function collectBodyTokens(
  push: (value: TokenValue) => void,
  preview: string | undefined,
  contentType: string | undefined,
): void {
  if (preview === undefined || preview.trim() === '') return
  const type = (contentType ?? '').toLowerCase()
  const looksJson = type.includes('json') || preview.trim().startsWith('{')
  if (!looksJson) return
  let raw: unknown
  try {
    raw = JSON.parse(preview)
  } catch {
    return
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isTokenParamName(name) || typeof value !== 'string' || value === '') continue
    push({ location: 'body', name, value })
  }
}

/**
 * 检测一条请求样本里的 token 凭证。
 *
 * 返回顺序固定（header → query → body，各自按出现顺序），同一次检测内按
 * `name + url + value` 去重；不读盘、不写盘。
 */
export function detectTokenCredentials(sample: TokenSample): TokenDraft[] {
  const drafts: TokenDraft[] = []
  const seen = new Set<string>()
  const push = (value: TokenValue): void => {
    const name = `${value.location}:${value.name.toLowerCase()}`
    const key = `${name}\u0000${sample.url}\u0000${value.value}`
    if (seen.has(key)) return
    seen.add(key)
    drafts.push({ kind: 'token', name, url: sample.url, value })
  }

  for (const [rawName, rawValue] of Object.entries(sample.requestHeaders)) {
    const name = rawName.toLowerCase()
    if (!TOKEN_HEADERS.has(name)) continue
    const value = rawValue.trim()
    if (value === '') continue
    push({ location: 'header', name, value })
  }

  collectQueryTokens(push, sample.url)
  collectBodyTokens(push, sample.requestBodyPreview, sample.contentType)
  return drafts
}

/** 解析 `value_json` → token 值；坏 JSON/字段缺失返回 `undefined`（坏行不炸批）。 */
export function tokenValueOfJson(valueJson: string | null | undefined): TokenValue | undefined {
  if (typeof valueJson !== 'string' || valueJson === '') return undefined
  let raw: unknown
  try {
    raw = JSON.parse(valueJson)
  } catch {
    return undefined
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const record = raw as Record<string, unknown>
  const location = record['location']
  const name = record['name']
  const value = record['value']
  if (location !== 'header' && location !== 'query' && location !== 'body') return undefined
  if (typeof name !== 'string' || name === '') return undefined
  if (typeof value !== 'string' || value === '') return undefined
  return { location, name, value }
}

/** token 类 query 参数值打码：`?access_token=SECRET` → `?access_token=***`。 */
function maskedUrlOf(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url, 'http://capture.local')
  } catch {
    return url
  }
  let changed = false
  for (const name of [...parsed.searchParams.keys()]) {
    if (!isTokenParamName(name)) continue
    parsed.searchParams.set(name, '***')
    changed = true
  }
  if (!changed) return url
  // 相对路径样本：只回写 path+query，避免把补的 base 写进落库 URL。
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)
    ? parsed.toString()
    : `${parsed.pathname}${parsed.search}`
}

function tokenKeyOf(name: string, url: string, value: string): string {
  return `${name}\u0000${url}\u0000${value}`
}

/**
 * 扫一个 captureId 的请求样本，把还没落库的 token 写成 `credential_events(kind='token')`。
 *
 * 去重键是 `name + 落库 url + value`：重复调用是幂等的（第二次返回 0）。
 * 返回新增条数；调用方负责吞异常（补采失败不该打断采集收口）。
 */
export function harvestTokenCredentials(store: TokenHarvestStore, captureId: string): number {
  const existing = new Set<string>()
  for (const row of store.listCredentials(captureId, TOKEN_HARVEST_CREDENTIAL_LIMIT)) {
    if (row.kind !== 'token') continue
    const value = tokenValueOfJson(row.valueJson)
    if (value === undefined) continue
    existing.add(tokenKeyOf(row.name, row.url, value.value))
  }

  const seen = new Set<string>()
  let added = 0
  const now = Date.now()
  for (const sample of store.listSamples(captureId, TOKEN_HARVEST_SAMPLE_LIMIT)) {
    const contentType = headerValue(sample.requestHeaders, 'content-type')
    const drafts = detectTokenCredentials({
      url: sample.url,
      method: sample.method,
      requestHeaders: sample.requestHeaders,
      ...(sample.requestBodyPreview === undefined ? {} : { requestBodyPreview: sample.requestBodyPreview }),
      ...(contentType === undefined ? {} : { contentType }),
    })
    for (const draft of drafts) {
      const url = maskedUrlOf(draft.url)
      const key = tokenKeyOf(draft.name, url, draft.value.value)
      if (seen.has(key) || existing.has(key)) continue
      seen.add(key)
      store.upsertCredential(captureId, 'token', url, draft.name, now, draft.value)
      added += 1
    }
  }
  return added
}
