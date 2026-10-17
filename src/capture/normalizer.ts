/**
 * URL/JSON 归一化与模板合成：纯函数、零 I/O。
 *
 * 归并规则（与测试对齐的两层命令）：
 *   - urlTemplate：路径数字/长随机段抽 {p}；query 去重、滤易变键、按**键名**排序、保值 —— 留全值是为了回放；
 *     非空 query 用 `?` 拼接（模板本身即合法 URL：能回放、能被面板/工具回执直接辨认，不再用 `:` 这个非法分隔符）；
 *   - mergeKey：method + 路径 + ':' + query 键集合 —— 值不入键，跨页同键归并。
 *
 * @module dsh-dataforge/capture/normalizer
 */
import { createHash } from 'node:crypto'
import type { RawJson } from '../shared/types.js'
import type { AuthType, FieldLocation, FieldRole, Template, TemplateField } from '../shared/capture-types.js'

/**
 * 每次必变、且变值对回放无意义的 query 键：连同键一起从模板与归并键里剔除。
 *
 * 只收「无歧义的易变键」——语义参数（哪怕值多变）一律保留，宁可模板啰嗦也不能吞掉真实入参：
 *   - 时间戳 / 缓存击穿：t、_t、_、ts、_ts、timestamp、rnd、_r
 *   - JSONP 回调：cb、callback、jsonp、jsonpcallback
 *   - 会话 / 请求标识：sid、isid、nonce、rsv_t、rsv_pq、token
 */
const VOLATILE = new Set([
  't', '_t', '_', 'ts', '_ts', 'timestamp', 'rnd', '_r',
  'cb', 'callback', 'jsonp', 'jsonpcallback',
  'sid', 'isid', 'nonce', 'rsv_t', 'rsv_pq', 'token',
])

const SEGMENT_PARAM = /\/(?:\d+|[a-f0-9][a-f0-9-]{19,})(?=\/|$)/gi

/**
 * `new URL()` 会把路径里的 `{}` 转义成 `%7B…%7D`。
 *
 * 模板占位符（`{p}`、`{id}`）必须原样保留：一旦落成 `%7Bp%7D`，入库后再归一化一次就完全
 * 认不出来了——链上要替换的 `{p}` 没了，执行期只能报「匿名占位符无法给值」。
 * 这里只还原**花括号**这一种转义，不动路径里别的 `%xx`（那可能是业务语义，比如 `%2F`）。
 */
function restorePlaceholderBraces(pathname: string): string {
  return pathname.replace(/%7B([A-Za-z0-9_]*)%7D/gi, '{$1}')
}

export function normalizeUrlForTemplate(rawUrl: string): { urlTemplate: string } {
  const u = new URL(rawUrl, 'http://capture.local')
  const seen = new Map<string, string>()
  for (const [k, v] of u.searchParams.entries()) {
    if (VOLATILE.has(k)) continue
    if (!seen.has(k)) seen.set(k, v)
  }
  const path = restorePlaceholderBraces(u.pathname).replace(SEGMENT_PARAM, '/{p}')
  const pairs = [...seen.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const query = sortedParamsToString(pairs)
  return { urlTemplate: query === '' ? path : `${path}?${query}` }
}

function sortedParamsToString(pairs: Array<[string, string]>): string {
  return pairs.map(([k, v]) => (v === '' ? k : `${k}=${v}`)).join('&')
}

/** 归并键：值不入键（键集合排序），同接口跨参数值变化可归并。 */
export function mergeKeyOf(method: string, urlTemplate: string): string {
  const mark = urlTemplate.indexOf('?')
  if (mark === -1) return `${method} ${urlTemplate}`
  const path = urlTemplate.slice(0, mark)
  const queryPart = urlTemplate.slice(mark + 1)
  const keys = queryPart.split('&').filter((kv) => kv !== '').map((kv) => kv.split('=')[0]).sort()
  return `${method} ${path}:${keys.join(',')}`
}

const LINK_RE = /href\s*=\s*["']([^"'#]+)["']/gi

/** 提取页面同域绝对链接（去重；javascript:/非法剔除）。 */
export function extractLinks(html: string, baseUrl: string, ownHost: string): string[] {
  return extractAllLinks(html, baseUrl).filter((u) => captureHost(u) === ownHost)
}

/** 同上但不做 host 过滤——crawler 调用方自持 host 过滤并统计被跳过的外域。 */
export function extractAllLinks(html: string, baseUrl: string): string[] {
  const out = new Set<string>()
  let match: RegExpExecArray | null
  while ((match = LINK_RE.exec(html)) !== null) {
    try {
      const u = new URL(match[1], baseUrl)
      if (u.protocol.startsWith('http')) out.add(u.href)
    } catch {
      // 非法链接跳过
    }
  }
  return [...out]
}

/** 站点归并域：host（协议差异不出域，https/http 视为同站点）。 */
export function captureHost(url: string): string {
  return new URL(url).host
}

const MAX_TEMPLATE_DEPTH = 2
const SAMPLE_MAX = 120

export function jsonToTemplate(body: RawJson): Template {
  const fields: TemplateField[] = []
  const walk = (obj: RawJson, prefix: string, depth: number): void => {
    for (const [key, value] of Object.entries(obj)) {
      const field = prefix === '' ? key : `${prefix}.${key}`
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        if (depth < MAX_TEMPLATE_DEPTH) walk(value as RawJson, field, depth + 1)
        continue
      }
      if (Array.isArray(value)) {
        const first = value[0]
        // 数组一律成字段（物料清单这类入参主体就是数组，不能静默丢掉）：
        // 对象元素按 `[]` 展开首元素；基本量元素按整体样本值标注。
        if (depth < MAX_TEMPLATE_DEPTH && first !== null && typeof first === 'object' && !Array.isArray(first)) {
          walk(first as RawJson, `${field}[]`, depth + 1)
          continue
        }
        fields.push({
          field: `${field}[]`,
          type: first === undefined || first === null ? 'null' : typeof first === 'number' ? 'number' : typeof first === 'boolean' ? 'boolean' : 'string',
          sample: JSON.stringify(value).slice(0, SAMPLE_MAX),
          role: 'constant',
          unverified: true,
        })
        continue
      }
      fields.push({
        field,
        type: value === null ? 'null' : typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string',
        sample: value === null ? 'null' : String(value).slice(0, SAMPLE_MAX),
        role: 'constant',
        unverified: true,
      })
    }
  }
  walk(body, '', 0)
  const hasCode = fields.find((f) => f.field === 'code')
  const hasErrNo = fields.find((f) => f.field === 'err_no')
  const codePath = hasCode !== undefined ? 'code' : hasErrNo !== undefined ? 'err_no' : undefined
  return { fields, ...(codePath === undefined ? {} : { codePath }) }
}

/**
 * role diff：n≥2 样本里同字段值变 → input（unverified=false）；
 * 值恒 → constant；n==1 整体保持 unverified（诚实标注"未验证"）。
 */
export function assignRoles(samples: RawJson[]): Template {
  const base = jsonToTemplate(samples[0] ?? {})
  if (samples.length <= 1) return base
  const fields = base.fields.map((f0) => {
    const bag = new Set<string>()
    for (const s of samples) {
      const v = pathAt(s, f0.field)
      bag.add(v === undefined ? '<undef>' : String(v))
    }
    const role: FieldRole = bag.size > 1 ? 'input' : f0.role
    return { ...f0, role, unverified: bag.size <= 1 }
  })
  return { fields, ...(base.codePath === undefined ? {} : { codePath: base.codePath }) }
}

function pathAt(obj: unknown, path: string): unknown {
  let current: unknown = obj
  for (const seg of path.replace(/\[\]/g, '').split('.')) {
    // 数组段取首元素（多形态 diff 只需要一个代表值）
    if (Array.isArray(current)) current = current[0]
    if (current !== null && typeof current === 'object') {
      current = (current as RawJson)[seg]
    } else {
      return undefined
    }
  }
  return current
}

// ────────────────────────────────────────────────
// A7/A8：入参指纹、鉴权探测（v1.3）、语义名称、多形态模板合成（全部纯函数）
// ────────────────────────────────────────────────

export function pathSegmentsOf(rawUrl: string): string[] {
  const u = new URL(rawUrl, 'http://capture.local')
  return u.pathname
    .split('/')
    .filter((s) => s !== '')
    .map((seg) => {
      try {
        return decodeURIComponent(seg)
      } catch {
        return seg
      }
    })
}

export function queryPairsOf(rawUrl: string): Array<[string, string]> {
  const u = new URL(rawUrl, 'http://capture.local')
  const seen = new Map<string, string>()
  for (const [k, v] of u.searchParams.entries()) {
    if (VOLATILE.has(k)) continue
    if (!seen.has(k)) seen.set(k, v)
  }
  return [...seen.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
}

export function jsonBodyOf(raw: string | Buffer | undefined): RawJson | undefined {
  if (typeof raw !== 'string' || raw.trim().startsWith('{') === false) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    return parsed as RawJson
  } catch {
    return undefined
  }
}

/**
 * JSON 体扁平成 'path=value'（叶值、深度 2、叶键滤易变键）：指纹与请求体模板共用同一条契约。
 *
 * 数组是**保序参与**的（物料清单这类入参主体就在数组里）：
 * - 基本量数组 → `field[]=[v1,v2,…]`，元素顺序不同即视为不同形态；
 * - 对象数组 → 逐元素按 `field[]` 递归展开。
 */
export function bodyPairsOf(body: RawJson | undefined): string[] {
  if (body === undefined) return []
  const out: string[] = []
  const lastSeg = (path: string): string => path.split('.').pop() ?? ''
  const walk = (obj: RawJson, prefix: string, depth: number): void => {
    for (const [key, value] of Object.entries(obj)) {
      const field = prefix === '' ? key : `${prefix}.${key}`
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        if (depth < MAX_TEMPLATE_DEPTH) walk(value as RawJson, field, depth + 1)
        continue
      }
      if (Array.isArray(value)) {
        const primitives = value.filter((item) => item === null || typeof item !== 'object')
        if (primitives.length > 0) {
          out.push(`${field}[]=[${primitives.map((item) => (item === null ? 'null' : String(item).slice(0, 120))).join(',')}]`)
        }
        if (depth < MAX_TEMPLATE_DEPTH) {
          for (const item of value) {
            if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
              walk(item as RawJson, `${field}[]`, depth + 1)
            }
          }
        }
        if (value.length === 0) out.push(`${field}[]=[]`)
        continue
      }
      if (VOLATILE.has(lastSeg(field))) continue
      out.push(`${field}=${value === null ? 'null' : String(value).slice(0, 120)}`)
    }
  }
  walk(body, '', 0)
  return out
}

const FORM_PAIR_RE = /^[^=&\s{}[\]"']+=[^&]*$/

/**
 * 表单体（application/x-www-form-urlencoded）：`a=1&b=2` → 有序键值对。
 * multipart / 二进制体解析不了就如实返回 undefined（不猜、不吞成"没有入参"）。
 */
export function formPairsOf(raw: string | Buffer | undefined): Array<[string, string]> | undefined {
  if (typeof raw !== 'string') return undefined
  const text = raw.trim()
  if (text.length === 0 || !text.includes('=')) return undefined
  const parts = text.split('&')
  if (!parts.every((part) => FORM_PAIR_RE.test(part))) return undefined
  const pairs: Array<[string, string]> = []
  for (const part of parts) {
    const eq = part.indexOf('=')
    const key = part.slice(0, eq)
    if (VOLATILE.has(key)) continue
    pairs.push([key, part.slice(eq + 1)])
  }
  return pairs
}

/** 指纹用体配对：JSON 与表单两条解析路径统一入口，输出按键排序（键序无关）；都解析不了 → []（诚实留空）。 */
export function bodyPairsOfRaw(raw: string | Buffer | undefined): string[] {
  const json = jsonBodyOf(raw)
  if (json !== undefined) return bodyPairsOf(json).sort()
  const form = formPairsOf(raw)
  return form === undefined ? [] : form.map(([k, v]) => `${k}=${v}`).sort()
}

const FINGERPRINT_INPUT_CAP = 8_192

/**
 * 入参指纹（§6.2 rule 2）：归一化后的 query + 请求体（键排序、滤易变键）做稳定哈希。
 * 同接口（mergeKey 同）指纹不同 = 不同调用形态 → 关系表各留一行。
 */
export function paramsFingerprintOf(rawUrl: string, requestBody?: string | Buffer): string {
  const query = queryPairsOf(rawUrl).map(([k, v]) => `${k}=${v}`)
  const body = bodyPairsOfRaw(requestBody)
  const canonical = `q:${query.join('&')}|b:${body.join('&')}`
  return sha256(canonical.slice(0, FINGERPRINT_INPUT_CAP))
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16)
}

/** 语义化名称（§6.3 六要素之一）：method + 最后一个具名路径段（先过 {@link normalizeUrlForTemplate} 抽 {p}），全抽象时退回 host。 */
export function semanticName(method: string, urlTemplate: string): string {
  const pathOnly = normalizeUrlForTemplate(urlTemplate).urlTemplate.split('?')[0]
  let host = ''
  try {
    host = new URL(pathOnly, 'http://capture.local').host
  } catch {
    host = ''
  }
  const named = pathSegmentsOf(pathOnly).filter((s) => s !== '{p}')
  const last = named[named.length - 1] ?? ''
  return last === '' ? `${method} ${host}` : `${method} ${last}`
}

// ── FR-3.7 鉴权探测（读原始样本，不受 VOLATILE 滤键影响；只记名称，不记值） ──

const TOKEN_HEADERS = new Set(['authorization', 'proxy-authorization'])

const TOKEN_PARAM_KEYS = new Set([
  'token', 'access_token', 'access-token', 'accesstoken',
  'auth_token', 'auth-token', 'authtoken',
  'api_key', 'api-key', 'apikey', 'app_token', 'apptoken',
])

export type AuthProbe = { authType: AuthType; evidence?: string }

export function classifyAuth(rawUrl: string, requestHeaders: Record<string, string>, requestBody?: string | Buffer): AuthProbe {
  const lowerHeaders = new Map(Object.keys(requestHeaders).map((k) => [k.toLowerCase(), k] as const))
  const authHeader = [...lowerHeaders.keys()].find((k) => TOKEN_HEADERS.has(k))
  if (authHeader !== undefined) return { authType: 'token-header', evidence: `header:${authHeader}` }

  const rawQueryKeys = [...new URL(rawUrl, 'http://capture.local').searchParams.keys()]
  const tokenQuery = rawQueryKeys.find((k) => TOKEN_PARAM_KEYS.has(k.toLowerCase()))
  if (tokenQuery !== undefined) return { authType: 'token-param', evidence: `query:${tokenQuery}` }

  const tokenBody = bodyKeysOf(requestBody).find((k) => TOKEN_PARAM_KEYS.has(k.toLowerCase()))
  if (tokenBody !== undefined) return { authType: 'token-param', evidence: `body:${tokenBody}` }

  const cookieHeader = firstHeaderOf(requestHeaders, 'cookie')
  if (cookieHeader !== undefined) {
    // 浏览器请求几乎都带 Cookie（埋点/偏好/AB 分流），一律判 cookie-session 会让鉴权标志失去区分度。
    // 只认「会话风格」的 cookie 名（只记名字，不记值）。
    const names = cookieHeader.split(';').map((p) => (p.split('=')[0] ?? '').trim()).filter((n) => n !== '')
    const sessionName = names.find((n) => SESSION_COOKIE_RE.test(n))
    return sessionName === undefined
      ? { authType: 'none' }
      : { authType: 'cookie-session', evidence: `header:cookie:${sessionName}` }
  }
  if (lowerHeaders.size === 0) return { authType: 'unknown' }
  return { authType: 'none' }
}

/** 会话风格 cookie 名（启发式，只用于判定，不记录值）：session / sid / token / auth / uid / JSESSIONID / PHPSESSID… */
const SESSION_COOKIE_RE = /(session|sess|sid|token|auth|login|uid|jsessionid|phpsessid|connect\.sid)/i

function bodyKeysOf(raw: string | Buffer | undefined): string[] {
  return bodyPairsOfRaw(raw).map((pair) => (pair.split('=')[0] ?? '').split('.').pop() ?? '').filter((k) => k !== '')
}

// ── 多形态模板合成：跨样本 role diff + 位置标注 + 请求头契约 ──

const CREDENTIAL_HEADERS = new Set(['cookie', 'authorization', 'proxy-authorization', 'set-cookie'])
const HEADER_CONTRACT_KEYS = new Set(['content-type', 'accept'])

export type RequestSamplesAcc = {
  querySamples: Array<Array<[string, string]>>
  bodySamples: RawJson[]
  headerSamples: Array<Record<string, string>>
  pathParams: string[]
}

export function newRequestSamplesAcc(): RequestSamplesAcc {
  return { querySamples: [], bodySamples: [], headerSamples: [], pathParams: [] }
}

/**
 * 模板合成样本数上限：同一卡片跨样本 diff 只看最近 N 个样本（内存与 CPU 的诚实上界）。
 * 样本计数本身仍由 sample_count 全量累计，不受此上限影响。
 */
export const TEMPLATE_DIFF_SAMPLE_CAP = 20;

export type RequestBodySource = {
  acc: RequestSamplesAcc
  /** 单形态旗标：本卡总样本数 ≤1 时全模板保 unverified（诚实标注未验证）。 */
  sampleTotal: number
}

/** 请求模板合成：query（location=query）+ body（location=body）+ 头契约（location=header）三段并集（codePath 有则附）。 */
export function buildRequestTemplate(src: RequestBodySource): Template {
  const fields: TemplateField[] = []
  fields.push(...queryFieldsOf(src.acc.querySamples, src.sampleTotal))
  const bodySamples = lastOf(src.acc.bodySamples, TEMPLATE_DIFF_SAMPLE_CAP).map(stripVolatileLeaves)
  const assignRolesResult = bodySamples.length > 0 ? assignRoles(bodySamples) : undefined
  if (assignRolesResult !== undefined) {
    for (const f of assignRolesResult.fields) fields.push({ ...f, location: 'body' })
  }
  fields.push(...headerFieldsOf(src.acc.headerSamples, src.sampleTotal))
  return {
    fields,
    ...(assignRolesResult?.codePath === undefined ? {} : { codePath: assignRolesResult.codePath }),
    ...(src.acc.pathParams.length === 0 ? {} : { pathParams: src.acc.pathParams }),
  }
}

function queryFieldsOf(samples: Array<Array<[string, string]>>, sampleTotal: number): TemplateField[] {
  const picked = lastOf(samples, TEMPLATE_DIFF_SAMPLE_CAP)
  const keys = new Set<string>()
  for (const pairs of picked) for (const [k] of pairs) keys.add(k)
  const fields: TemplateField[] = []
  for (const key of [...keys].sort()) {
    const bag = new Set<string>()
    for (const pairs of picked) {
      const hit = pairs.find(([k]) => k === key)
      bag.add(hit === undefined ? '<undef>' : hit[1])
    }
    fields.push({
      field: key,
      type: 'string',
      sample: [...bag].filter((v) => v !== '<undef>')[0] ?? '',
      role: bag.size > 1 ? 'input' : 'constant',
      unverified: sampleTotal <= 1 || bag.size <= 1,
      location: 'query',
    })
  }
  return fields
}

function headerFieldsOf(samples: Array<Record<string, string>>, sampleTotal: number): TemplateField[] {
  const picked = lastOf(samples, TEMPLATE_DIFF_SAMPLE_CAP)
  const lowerKeys = new Set<string>()
  for (const headers of picked) {
    for (const [k] of Object.entries(headers)) lowerKeys.add(k.toLowerCase())
  }
  const fields: TemplateField[] = []
  for (const key of [...lowerKeys].sort()) {
    const isContract = HEADER_CONTRACT_KEYS.has(key) || key.startsWith('x-')
    if (CREDENTIAL_HEADERS.has(key)) {
      fields.push({ field: key, type: 'string', sample: '', role: 'credential', unverified: false, location: 'header' })
      continue
    }
    if (!isContract) continue
    const bag = new Set<string>()
    for (const headers of picked) {
      const value = firstHeaderOf(headers, key)
      bag.add(value === undefined ? '<undef>' : value)
    }
    fields.push({
      field: key,
      type: 'string',
      sample: [...bag].filter((v) => v !== '<undef>')[0] ?? '',
      role: bag.size > 1 ? 'input' : 'constant',
      unverified: sampleTotal <= 1 || bag.size <= 1,
      location: 'header',
    })
  }
  return fields
}

function firstHeaderOf(headers: Record<string, string>, lowerKey: string): string | undefined {
  const hit = Object.keys(headers).find((k) => k.toLowerCase() === lowerKey)
  return hit === undefined ? undefined : String(headers[hit]).slice(0, 120)
}

/** 出参模板合成：多形态样本 role diff（样本文本 → JSON）。 */
export function buildResponseTemplate(bodyTexts: string[]): Template | undefined {
  const bodies: RawJson[] = []
  for (const text of lastOf(bodyTexts, TEMPLATE_DIFF_SAMPLE_CAP)) {
    const parsed = jsonBodyOf(text)
    if (parsed !== undefined) bodies.push(parsed)
  }
  if (bodies.length === 0) return undefined
  return assignRoles(bodies)
}

function lastOf<T>(items: T[], cap: number): T[] {
  return items.length <= cap ? items : items.slice(items.length - cap)
}

/** 请求体模板专用：递归剔除 VOLATILE 叶键（与 bodyPairsOf 同口径）——指纹/模板不吃每拍即变的噪声键。 */
function stripVolatileLeaves(body: RawJson): RawJson {
  const out: RawJson = {}
  for (const [key, value] of Object.entries(body)) {
    if (VOLATILE.has(key)) continue
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = stripVolatileLeaves(value as RawJson)
      continue
    }
    // 数组必须保留（物料清单是入参主体）：元素内部的易变键仍然要剔
    if (Array.isArray(value)) {
      out[key] = value.map((item) =>
        item !== null && typeof item === 'object' && !Array.isArray(item)
          ? stripVolatileLeaves(item as RawJson)
          : item)
      continue
    }
    out[key] = value
  }
  return out
}
