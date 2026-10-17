/**
 * 采集面板数据面：/dashboard/api/dataforge 前缀下的数据路由。
 *
 * 协议契约照抄 dsh-pmboard 路由层：
 *   - webServer.register({ kind:'prefix', path, handler })，handler = (req, res) => void，返回 disposer；
 *   - 信封：200 {success:true,data} / 4xx|500 {success:false,error,code?}；
 *   - GET 面只读，唯一写入口 POST /captures（发起单页采集），其余方法一律 405（方法显式，不静默兜底）。
 *
 * 安全边界：凭据 value_json（cookie/storage 原文）**永不出壳**——路由层是出口闸，
 * 在这里剥字段而不是靠调用方自觉。
 *
 * @module dsh-dataforge/capture/panel-routes
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SampleRow } from '../shared/capture-types.js'
import type { CaptureStore } from './store.js'
import type { CaptureToolValue } from './application.js'

export const PANEL_API_PREFIX = '/dashboard/api/dataforge'

const DEFAULT_LIST_LIMIT = 30
const MAX_LIST_LIMIT = 500
const RUN_DETAIL_CARDS_LIMIT = 200
const RUN_DETAIL_RELATIONS_LIMIT = 500
/** 写入口请求体上限：面板只需要 {taskType, entryUrl}，超过这个尺寸一律 413。 */
const MAX_CAPTURE_BODY_BYTES = 8_192

/** 宿主 webServer 的最小投影（形状对齐 dsh-pmboard legacy-board-route 的 ExactRouteRegistrar）。 */
export interface PanelRouteRegistrar {
  register(route: {
    kind: 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void
  }): () => void
}

export interface CapturePanelDeps {
  store: CaptureStore
  /** POST /captures 出口：单页采集的发起入口（FR-7.6：面板只开 single_page，写操作走 agent 会话）。 */
  startCapture?: (args: { taskType: 'single_page'; entryUrl: string }) => Promise<CaptureToolValue>
  /**
   * 编排子路由（同一前缀下的 `/orchestration/*`），由入口装配。
   *
   * 为什么塞进这里而不是各自 register 一次：宿主的 prefix 路由**匹配语义没有契约**
   * （是首个命中还是最长前缀，本地 checkout 看不到实现）。两个 handler 挂同一前缀、
   * 靠一条更长的路径去抢，就是在赌宿主实现；赌错了 /orchestration/* 会被采集 handler
   * 当 unknown-path 吃掉。所以前缀只注册一次，子路径在**我们自己的代码里**分派。
   */
  orchestration?: (req: IncomingMessage, res: ServerResponse) => void
}

/** 是不是该交给编排子路由（看路径里有没有 /dataforge/orchestration）。 */
export function isOrchestrationRequest(url: string | undefined): boolean {
  const path = new URL(url ?? '/', 'http://panel.localhost').pathname
  return path.includes('/dataforge/orchestration')
}

/**
 * 构造面板数据 handler。
 *
 * URL 两种形态都接受：宿主可能传完整路径（前缀含在 url 里）或剥好前缀的剩余路径。
 * GET 面只读；唯一的写入口 POST /captures（发起单页采集），其余方法一律 405。
 */
export function createCapturePanelHandler(deps: CapturePanelDeps): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    try {
      const method = (req.method ?? 'GET').toUpperCase()
      const url = new URL(req.url ?? '/', 'http://panel.localhost')
      const suffix = url.pathname.startsWith(PANEL_API_PREFIX)
        ? url.pathname.slice(PANEL_API_PREFIX.length)
        : url.pathname

      if (method === 'POST') {
        if (suffix === '/captures') {
          void handleStartCapture(deps, req, res)
          return
        }
        fail(res, 405, `面板路由不支持 ${method} ${suffix}（写入口仅 POST /captures）`, 'method-not-allowed')
        return
      }
      if (method !== 'GET') {
        fail(res, 405, `面板路由只支持 GET/POST /captures，收到 ${method}`, 'method-not-allowed')
        return
      }

      if (suffix === '/runs') {
        ok(res, {
          generatedAt: Date.now(),
          runs: deps.store.listRuns(clampLimit(url.searchParams.get('limit'), DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)),
        })
        return
      }

      if (suffix.startsWith('/runs/')) {
        const id = decodeURIComponent(suffix.slice('/runs/'.length))
        if (id.length === 0 || id.includes('/')) {
          fail(res, 404, `不认识的路径：${suffix}`, 'unknown-path')
          return
        }
        const run = deps.store.getRun(id)
        if (run === undefined) {
          fail(res, 404, `采集运行 ${id} 不存在`, 'not-found')
          return
        }
        ok(res, {
          generatedAt: Date.now(),
          run,
          pages: deps.store.listPages(id, MAX_LIST_LIMIT),
          samples: deps.store.listSamples(id, MAX_LIST_LIMIT).map(sanitizeSample),
          // 出口闸：凭据原文（value_json）在路由层剥除，永不进响应体。
          credentials: deps.store.listCredentials(id, MAX_LIST_LIMIT).map(({ valueJson: _valueStaysInDb, ...rest }) => rest),
          cards: deps.store.listCards(id, RUN_DETAIL_CARDS_LIMIT),
          relations: deps.store.listRelations(id, RUN_DETAIL_RELATIONS_LIMIT),
        })
        return
      }

      if (suffix === '/cards') {
        ok(res, {
          generatedAt: Date.now(),
          cards: deps.store.listAllCards(
            clampLimit(url.searchParams.get('limit'), DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT),
            clampOffset(url.searchParams.get('offset')),
          ),
          total: deps.store.countAllCards(),
        })
        return
      }

      fail(res, 404, `不认识的路径：${suffix}`, 'unknown-path')
    } catch (err) {
      fail(res, 500, String((err as Error)?.message ?? err), 'internal')
    }
  }
}

/** POST /captures：发起单页采集。FR-7.6 边界在闸内：body 里 taskType 只认 single_page，其余 400。 */
async function handleStartCapture(deps: CapturePanelDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: unknown
  try {
    body = JSON.parse((await readBody(req, MAX_CAPTURE_BODY_BYTES)) || '{}')
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      fail(res, 413, `请求体超过 ${MAX_CAPTURE_BODY_BYTES} 字节`, 'body-too-large')
      return
    }
    fail(res, 400, '请求体不是合法 JSON', 'bad-json')
    return
  }
  const record = (typeof body === 'object' && body !== null ? body : {}) as { entryUrl?: unknown; taskType?: unknown }
  const taskType = record['taskType'] === undefined ? 'single_page' : record['taskType']
  if (taskType !== 'single_page') {
    fail(res, 400, `面板只能发起 single_page 采集，收到 ${String(taskType)}（写操作/爬取走 agent 入口 dataforge_capture）`, 'bad-task-type')
    return
  }
  if (typeof record['entryUrl'] !== 'string' || record['entryUrl'].length === 0) {
    fail(res, 400, '缺少 entryUrl（字符串）', 'bad-entry-url')
    return
  }
  const entryUrl = record['entryUrl']
  let entry: URL
  try {
    entry = new URL(entryUrl)
  } catch {
    fail(res, 400, `entryUrl 不是合法 URL：${entryUrl.slice(0, 200)}`, 'bad-entry-url')
    return
  }
  if (entry.protocol !== 'http:' && entry.protocol !== 'https:') {
    fail(res, 400, `只支持 http/https 入口，收到 ${entry.protocol}`, 'bad-entry-url')
    return
  }
  // SSRF 收敛：本机回环 / 链路本地（含云元数据 169.254.169.254）一律拒绝。
  // 内网私有段不拦——本产品的采集对象就是企业内网系统（SRM/ERP）。
  const blocked = blockedTargetReason(entry.hostname)
  if (blocked !== undefined) {
    fail(res, 400, `拒绝采集 ${entry.hostname}：${blocked}`, 'blocked-target')
    return
  }
  // 同站点并发保护：同一 host 已有 running 采集 → 409（避免两个无头浏览器互抢/重复落卡）。
  const busy = deps.store.listRuns(200).find((run) => run.status === 'running' && sameHost(run.entryUrl, entry))
  if (busy !== undefined) {
    fail(res, 409, `该站点已有进行中的采集（${busy.id}），等它收口后再发起`, 'host-busy')
    return
  }
  // 校验全过才轮到装配检查：合法请求遇上没接线的宿主 → 503（不是请求方的错）。
  if (deps.startCapture === undefined) {
    fail(res, 503, '采集发起未装配（startCapture 未注入）', 'capture-not-wired')
    return
  }
  let result: CaptureToolValue
  try {
    result = await deps.startCapture({ taskType, entryUrl })
  } catch (err) {
    fail(res, 500, String((err as Error)?.message ?? err), 'capture-start-failed')
    return
  }
  // 出口闸：sessionId 是 agent 会话凭据，面板回执剥除；只回采集身份与状态。
  ok(res, {
    accepted: result.accepted,
    gate: result.gate,
    captureId: result.captureId,
    ...(result.degradedNotice === undefined ? {} : { degradedNotice: result.degradedNotice }),
    card: result.card,
  })
}

/** 本机 / 链路本地 / 云元数据地址：面板写入口不接受（agent 工具面不受此限，便于本地调试）。 */
function blockedTargetReason(hostname: string): string | undefined {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost')) return '本机回环地址'
  if (host === '::1' || host === '0.0.0.0') return '本机回环地址'
  if (/^127\./.test(host)) return '本机回环地址'
  if (/^169\.254\./.test(host)) return '链路本地/云元数据地址'
  return undefined
}

function sameHost(left: string, right: URL): boolean {
  try {
    const host = new URL(left).host
    return host === right.host
  } catch {
    return false
  }
}

class BodyTooLargeError extends Error {}

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let total = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > maxBytes) {
        reject(new BodyTooLargeError('request body too large'))
        // 已超限：排空剩余数据，避免连接悬挂（测试替身没有 resume，需判存在）
        if (typeof req.resume === 'function') req.resume()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * 把面板路由注册到宿主 webServer，返回幂等 disposer。
 *
 * 半注册规避（对齐 pm legacy-board-route 纪律）：register 抛错时撤销已注册者再向上抛，
 * 不留「没有 disposer 的泄漏注册」。
 */
export function registerCapturePanelRoutes(
  webServer: PanelRouteRegistrar,
  deps: CapturePanelDeps,
): () => void {
  const captureHandler = createCapturePanelHandler(deps)
  const orchestration = deps.orchestration
  const handler = orchestration === undefined
    ? captureHandler
    : (req: IncomingMessage, res: ServerResponse): void => {
        if (isOrchestrationRequest(req.url)) orchestration(req, res)
        else captureHandler(req, res)
      }
  const dispose = webServer.register({
    kind: 'prefix',
    path: PANEL_API_PREFIX,
    handler,
  })
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    dispose()
  }
}

function ok(res: ServerResponse, data: unknown): void {
  send(res, 200, { success: true, data })
}

/** 样本出口投影：header 记录（Cookie/Set-Cookie 与 value_json 同级的凭据载体）与服务端内部文件路径不出壳；预览正文保留。 */
function sanitizeSample(sample: SampleRow): Record<string, unknown> {
  return {
    id: sample.id,
    captureId: sample.captureId,
    pageUrl: sample.pageUrl,
    seq: sample.seq,
    url: sample.url,
    method: sample.method,
    status: sample.status,
    requestBodyPreview: sample.requestBodyPreview,
    responsePreview: sample.responsePreview,
    truncated: sample.truncated,
    ts: sample.ts,
  }
}

function fail(res: ServerResponse, status: number, error: string, code?: string): void {
  send(res, status, code === undefined ? { success: false, error } : { success: false, error, code })
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

function clampLimit(raw: string | null, fallback: number, max: number): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, max)
}

function clampOffset(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return parsed
}
