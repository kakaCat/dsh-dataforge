/**
 * 执行引擎的唯一 HTTP 出口（R-3 IF-4）。
 *
 * 为什么必须收在一处：执行语义（超时、重试、正文上限、头脱敏、重定向策略）只要散落两处，
 * 迟早会出现「一边脱敏一边没脱敏」「一处重试一处不重试」的裂缝。本模块是插件里**第一个
 * 主动向外部站点发请求**的地方（此前只有采集期浏览器与 python 桥），所以安全默认值全写死在这里：
 *
 * - `credentials: 'omit'`——绝不继承任何 cookie jar；
 * - 重定向自己走（`redirect: 'manual'`），跨 origin 时剥掉鉴权头，次数有上限；
 * - 响应正文按上限流式截断（超限不是错误，标 `truncated: true` 如实回报）；
 * - {@link redactHeaders} 给运行留痕用：凭证类头名一律替换成 `***`，只留名字不留值。
 *
 * 不抛异常：错误分类折成 `ok: false` + 错误码，让调度器能把「超时/网络/取消」分开记。
 * 只用 Node 22 内置 `fetch`，不引第三方 client（需求 Q1 已决）。
 *
 * @module dsh-dataforge/execute/http
 */

/** 一次请求的输入（`body` 已由 request 层序列化好，这里不碰 JSON 语义）。 */
export type HttpRequestSpec = {
  method: string
  url: string
  headers?: Record<string, string>
  /** 已序列化的正文；GET/HEAD 不传。 */
  body?: string
  /** 单次尝试的超时（毫秒）。 */
  timeoutMs?: number
  /** 额外重试次数（0 = 只发一次）。 */
  retry?: number
  /** 调用方取消信号（job_kill / Ctrl-C）。 */
  signal?: AbortSignal
  /** 正文上限（字节）；超过即截断并标 truncated。 */
  limitBytes?: number
  /** 跟随重定向的最大跳数。 */
  maxRedirects?: number
}

/** 一次请求的结果（截断后的正文 + 可解析的 JSON）。 */
export type HttpResult = {
  status: number
  /** 响应头（名已小写，便于查 `content-type`）。 */
  headers: Record<string, string>
  /**
   * 原始 `Set-Cookie` 行（多条各一行，没有被 `, ` 合并）。
   *
   * 只给换票链路消费（R-4 M2）；**不进运行记录**——响应摘要只投影状态/长度/正文预览。
   */
  setCookies?: string[]
  bodyText: string
  /** `bodyText` 能解析成 JSON 时给解析值；否则缺省。 */
  json?: unknown
  bytes: number
  truncated: boolean
  attempts: number
  elapsedMs: number
  finalUrl: string
}

/**
 * 失败分类。前三个是设计文档 IF-4 列出的；后两个是执行期必然会遇到的输入类错误，
 * 单列比混进 `network-error` 更好定位（调度器据此决定「重试 / 中止 / 报配置错」）。
 */
export type HttpFailureCode = 'timeout' | 'network-error' | 'aborted' | 'redirect-limit' | 'bad-url'

export type HttpOutcome =
  | { ok: true; response: HttpResult }
  | { ok: false; code: HttpFailureCode; message: string; attempts: number; elapsedMs: number }

/** 默认正文上限 2 MiB（对齐设计的 `chainResponseLimitBytes` 缺省）。 */
export const DEFAULT_RESPONSE_LIMIT_BYTES = 2 * 1024 * 1024
/** 默认单次超时 30s。 */
export const DEFAULT_TIMEOUT_MS = 30_000
/** 默认重定向跳数上限。 */
export const DEFAULT_MAX_REDIRECTS = 5

/** 留痕时必须脱敏的头名（小写）。 */
const SECRET_HEADERS = new Set([
  'cookie',
  'set-cookie',
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'x-auth-token',
  'x-csrf-token',
])

/** 跨 origin 重定向时绝不带过去的头。 */
const AUTH_HEADERS = new Set(['authorization', 'proxy-authorization', 'cookie', 'x-api-key'])

/**
 * 头脱敏：凭证类头名只留名字，值替换成 `***`。
 *
 * 进 `events.ndjson` 的请求/响应头都要过这一道——运行留痕是要长期保存、可能被导出的资产。
 */
export function redactHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers ?? {})) {
    out[name] = SECRET_HEADERS.has(name.toLowerCase()) ? '***' : value
  }
  return out
}

/**
 * 原始 `Set-Cookie` 行：优先用 `getSetCookie()`（Node 22 / undici），
 * 老实现退回单条 `get('set-cookie')`。绝不把多条用 `, ` 拼起来再解析。
 */
function setCookiesOf(headers: Headers): string[] {
  const getter = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie
  if (typeof getter === 'function') {
    try {
      return getter.call(headers)
    } catch {
      return []
    }
  }
  const merged = headers.get('set-cookie')
  return merged === null ? [] : [merged]
}

/** 小写化响应头（同名多值按 `, ` 合并）。 */
function normalizeHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((value, name) => {
    const key = name.toLowerCase()
    const existing = out[key]
    out[key] = existing === undefined ? value : `${existing}, ${value}`
  })
  return out
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599)
}

function parseUrlOrUndefined(raw: string): URL | undefined {
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined
  } catch {
    return undefined
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))

/** 单次尝试的结果：要么拿到响应，要么是分类过的失败。 */
type Attempt =
  | { kind: 'response'; response: Response; finalUrl: string }
  | { kind: 'failure'; code: HttpFailureCode; message: string }

/**
 * 发一次请求（含重定向跟随）。
 *
 * `redirect: 'manual'` 是有意的：`fetch` 自带的自动跟随没有跳数上限，也管不住跨 origin
 * 时是否把鉴权头带过去。这里每一跳都自己判一遍。
 */
async function attemptOnce(spec: HttpRequestSpec, headers: Record<string, string>): Promise<Attempt> {
  const timeoutMs = spec.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxRedirects = spec.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  let currentUrl = spec.url

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const target = parseUrlOrUndefined(currentUrl)
    if (target === undefined) return { kind: 'failure', code: 'bad-url', message: `不是合法的 http(s) URL：${currentUrl}` }

    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    const onCallerAbort = (): void => controller.abort()
    spec.signal?.addEventListener('abort', onCallerAbort, { once: true })

    let response: Response
    try {
      response = await fetch(currentUrl, {
        method: spec.method,
        headers,
        // GET/HEAD 带 body 会被 fetch 直接拒；由调用方保证不传。
        ...(spec.body === undefined ? {} : { body: spec.body }),
        redirect: 'manual',
        credentials: 'omit',
        signal: controller.signal,
      })
    } catch (err) {
      // 分类顺序要紧：先看调用方取消（job_kill），再看自己的超时，剩下的才算网络错。
      if (spec.signal?.aborted === true) return { kind: 'failure', code: 'aborted', message: '调用方已取消' }
      if (timedOut) return { kind: 'failure', code: 'timeout', message: `请求超时（${timeoutMs}ms）` }
      const detail = err instanceof Error ? err.message : String(err)
      return { kind: 'failure', code: 'network-error', message: detail }
    } finally {
      clearTimeout(timer)
      spec.signal?.removeEventListener('abort', onCallerAbort)
    }

    const location = response.headers.get('location')
    if (!isRedirect(response.status) || location === null) {
      return { kind: 'response', response, finalUrl: currentUrl }
    }

    // 丢弃这一跳的正文（重定向体没有业务含义），继续下一跳。
    await response.body?.cancel().catch(() => undefined)
    const next = parseUrlOrUndefined(new URL(location, currentUrl).href)
    if (next === undefined) {
      return { kind: 'failure', code: 'bad-url', message: `重定向目标不是合法的 http(s) URL：${location}` }
    }
    if (next.origin !== target.origin) {
      for (const name of Object.keys(headers)) {
        if (AUTH_HEADERS.has(name.toLowerCase())) delete headers[name]
      }
    }
    // 303 语义上要改成 GET（fetch 手动模式下不会替你改）。
    if (response.status === 303) spec = { ...spec, method: 'GET', body: undefined }
    currentUrl = next.href
  }

  return {
    kind: 'failure',
    code: 'redirect-limit',
    message: `重定向超过 ${maxRedirects} 跳，已中止（疑似循环跳转）`,
  }
}

/**
 * 按上限流式读正文。
 *
 * 不用 `response.text()`：那会把整个响应先读进内存再让你截断，上限就形同虚设。
 * 顺便 `reader.cancel()` 尽早断开，不给服务端继续灌数据的机会。
 */
async function readBodyLimited(
  response: Response,
  limitBytes: number,
): Promise<{ text: string; bytes: number; truncated: boolean }> {
  const body = response.body
  if (body === null) return { text: '', bytes: 0, truncated: false }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  let truncated = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value === undefined) continue
      const room = limitBytes - bytes
      if (value.byteLength >= room) {
        if (room > 0) chunks.push(value.subarray(0, room))
        bytes += Math.max(0, room)
        truncated = true
        await reader.cancel().catch(() => undefined)
        break
      }
      chunks.push(value)
      bytes += value.byteLength
    }
  } finally {
    reader.releaseLock()
  }

  const merged = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { text: new TextDecoder('utf-8').decode(merged), bytes, truncated }
}

function parseJson(text: string): unknown | undefined {
  const trimmed = text.trim()
  if (trimmed === '' || (trimmed.startsWith('{') === false && trimmed.startsWith('[') === false)) return undefined
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return undefined
  }
}

/**
 * 发请求并返回分类后的结果。
 *
 * 重试只发生在**没有拿到可用响应**的情形：网络错、超时、以及 429/5xx。
 * 4xx（除 429）不重试——那是定义问题，重试只是把同一个错误多打几遍。
 * 调用方取消后立即停止重试。
 */
export async function httpRequest(spec: HttpRequestSpec): Promise<HttpOutcome> {
  const started = Date.now()
  const retry = Math.max(0, spec.retry ?? 0)
  const limitBytes = spec.limitBytes ?? DEFAULT_RESPONSE_LIMIT_BYTES
  const headers: Record<string, string> = { ...(spec.headers ?? {}) }
  let attempts = 0
  let last: { code: HttpFailureCode; message: string } | undefined

  for (let attempt = 0; attempt <= retry; attempt += 1) {
    attempts = attempt + 1
    if (spec.signal?.aborted === true) {
      return { ok: false, code: 'aborted', message: '调用方已取消', attempts, elapsedMs: Date.now() - started }
    }

    const outcome = await attemptOnce(spec, headers)
    if (outcome.kind === 'failure') {
      last = { code: outcome.code, message: outcome.message }
      // 取消/坏 URL/跳数超限没有重试价值。
      if (outcome.code === 'aborted' || outcome.code === 'bad-url' || outcome.code === 'redirect-limit') break
    } else {
      const { response, finalUrl } = outcome
      if (!isRetryableStatus(response.status) || attempt === retry) {
        const read = await readBodyLimited(response, limitBytes)
        const json = parseJson(read.text)
        const setCookies = setCookiesOf(response.headers)
        return {
          ok: true,
          response: {
            status: response.status,
            headers: normalizeHeaders(response.headers),
            ...(setCookies.length === 0 ? {} : { setCookies }),
            bodyText: read.text,
            ...(json === undefined ? {} : { json }),
            bytes: read.bytes,
            truncated: read.truncated,
            attempts,
            elapsedMs: Date.now() - started,
            finalUrl,
          },
        }
      }
      // 可重试状态码：丢弃正文，退避后重来。
      await response.body?.cancel().catch(() => undefined)
      last = { code: 'network-error', message: `HTTP ${response.status}` }
    }

    if (attempt < retry) await sleep(120 * (attempt + 1))
  }

  return {
    ok: false,
    code: last?.code ?? 'network-error',
    message: last?.message ?? '请求失败（无细节）',
    attempts,
    elapsedMs: Date.now() - started,
  }
}
