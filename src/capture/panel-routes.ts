/**
 * 采集面板数据面：/dashboard/api/dataforge 前缀下的数据路由。
 *
 * 协议契约照抄 dsh-pmboard 路由层：
 *   - webServer.register({ kind:'prefix', path, handler })，handler = (req, res) => void，返回 disposer；
 *   - 信封：200 {success:true,data} / 4xx|500 {success:false,error,code?}；
 *   - GET 面只读；写入口仅三处：POST /captures（发起单页采集）、POST /names（三级手工名覆盖）、
 *     POST /retitle（旧页面标题补抓）。其余方法一律 405（方法显式，不静默兜底）。
 *
 * 名称数据面（本站契约）：/page-meta 给页面身份 + 标题/站点名；/names 给三级手工覆盖；
 * /cards 与 /runs/:id 的卡片投影统一补 mergeKey / name / nameSource（manual 优先，
 * 否则用改进后的 semanticName）——客户端不自行拼名字。
 *
 * 安全边界：凭据 value_json（cookie/storage 原文）**永不出壳**——路由层是出口闸，
 * 在这里剥字段而不是靠调用方自觉。补抓在服务端进程内跑，cookie 不经过任何响应体。
 *
 * @module dsh-dataforge/capture/panel-routes
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { CardRow, SampleRow } from '../shared/capture-types.js'
import { mergeKeyOf, semanticName } from './normalizer.js'
import type { CaptureStore } from './store.js'
import type { CaptureToolValue } from './application.js'
import {
  cleanName,
  isCaptureNameKind,
  NAME_MAX_CHARS,
  normalizeNameKey,
  type CaptureNamesSnapshot,
  type CaptureNamesStore,
} from './names.js'
import type { RetitleStatus, TitleBackfillService } from './retitle.js'

export const PANEL_API_PREFIX = '/dashboard/api/dataforge'

const DEFAULT_LIST_LIMIT = 30
const MAX_LIST_LIMIT = 500
const RUN_DETAIL_CARDS_LIMIT = 200
const RUN_DETAIL_RELATIONS_LIMIT = 500
/** /page-meta 缺省与上限（面板一次要全量页面名；采集库页面规模就几百量级）。 */
const PAGE_META_LIMIT = 500
/** 写入口请求体上限（面板只需要小 JSON），超过这个尺寸一律 413。 */
const MAX_WRITE_BODY_BYTES = 8_192

/** retitle 未装配时的零状态（GET /retitle/status 不 5xx，如实显示「没在跑」）。 */
const EMPTY_RETITLE_STATUS: RetitleStatus = {
  running: false, targets: 0, tried: 0, updated: 0, failed: 0, skipped: 0,
}

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
  /** 三级手工名覆盖（site/page/interface）；未装配时 /names 写入口 503、读回空覆盖。 */
  names?: CaptureNamesStore
  /** 旧页面标题补抓；未装配时 POST /retitle 503、status 回零状态。 */
  retitle?: TitleBackfillService
  /**
   * 编排子路由（同一前缀下的 `/orchestration/*`），由入口装配。
   *
   * 为什么塞进这里而不是各自 register 一次：宿主的 prefix 路由**匹配语义没有契约**
   * （是首个命中还是最长前缀，本地 checkout 看不到实现）。两个 handler 挂同一前缀、
   * 靠一条更长的路径去抢，就是在赌宿主实现；赌错了 /orchestration/* 会被采集 handler
   * 当 unknown-path 吃掉。所以前缀只注册一次，子路径在**我们自己的代码里**分派。
   */
  orchestration?: (req: IncomingMessage, res: ServerResponse) => void
  /**
   * UI 测试子路由（同一前缀下的 `/ui-tests/*`），由入口装配。
   *
   * 返回 true = 已接管，false = 不是它的路径（交回下一个分派）。
   * 与 orchestration 同理：前缀只注册一次，避免赌宿主的 prefix 匹配语义。
   */
  uiTest?: (req: IncomingMessage, res: ServerResponse) => boolean
  /** 运行产物子路由（同一前缀下的 `/artifacts/*`）；返回 true = 已接管。 */
  artifacts?: (req: IncomingMessage, res: ServerResponse) => boolean
}

/**
 * 是不是该交给编排子路由。
 *
 * 两种 URL 形态都要认（宿主可能传完整路径，也可能传剥好前缀的剩余路径）：
 * 完整 `/dashboard/api/dataforge/orchestration/...` 与剩余 `/orchestration/...`。
 * 采集路由是 /runs /cards /captures，与 /orchestration 无交集。
 */
export function isOrchestrationRequest(url: string | undefined): boolean {
  const path = new URL(url ?? '/', 'http://panel.localhost').pathname
  return path.includes('/dataforge/orchestration') || path.startsWith('/orchestration')
}

/**
 * 构造面板数据 handler。
 *
 * URL 两种形态都接受：宿主可能传完整路径（前缀含在 url 里）或剥好前缀的剩余路径。
 * GET 面只读；写入口仅 POST /captures、/names、/retitle，其余方法一律 405。
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
        if (suffix === '/names') {
          void handleSetName(deps, req, res)
          return
        }
        if (suffix === '/retitle') {
          handleRetitle(deps, res)
          return
        }
        fail(res, 405, `面板路由不支持 ${method} ${suffix}（写入口仅 POST /captures、/names、/retitle）`, 'method-not-allowed')
        return
      }
      if (method !== 'GET') {
        fail(res, 405, `面板路由只支持 GET 与 POST /captures、/names、/retitle，收到 ${method}`, 'method-not-allowed')
        return
      }

      // 名称数据面：页面身份 + 采集时记录的标题/站点名（全库去重、最新访问者胜）
      if (suffix === '/page-meta') {
        const limit = clampLimit(url.searchParams.get('limit'), PAGE_META_LIMIT, PAGE_META_LIMIT)
        ok(res, { generatedAt: Date.now(), pages: deps.store.listPageMeta(limit) })
        return
      }

      // 三级手工名覆盖：只有手工名，缺省空对象（自动名由客户端按 card 投影自取，不在这里重复）
      if (suffix === '/names') {
        ok(res, deps.names?.snapshot() ?? { sites: {}, pages: {}, interfaces: {} })
        return
      }

      // 旧页面补抓状态（异步动作的进度面；未装配时如实回零状态）
      if (suffix === '/retitle/status') {
        ok(res, deps.retitle?.status() ?? { ...EMPTY_RETITLE_STATUS })
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
          cards: deps.store.listCards(id, RUN_DETAIL_CARDS_LIMIT).map((card) => projectCard(card, deps.names?.snapshot())),
          relations: deps.store.listRelations(id, RUN_DETAIL_RELATIONS_LIMIT),
        })
        return
      }

      if (suffix === '/cards') {
        const names = deps.names?.snapshot()
        ok(res, {
          generatedAt: Date.now(),
          cards: deps.store
            .listAllCards(
              clampLimit(url.searchParams.get('limit'), DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT),
              clampOffset(url.searchParams.get('offset')),
            )
            .map((card) => projectCard(card, names)),
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

type PanelCard = CardRow & {
  mergeKey: string
  name: string
  nameSource: 'auto' | 'manual'
}

/**
 * 卡片出口投影：mergeKey / name / nameSource。
 *
 * name = 手工覆盖（按 mergeKey，来自 names.yaml）?? 改进后的 semanticName（方法+模板实时生成）。
 * 注意**不用**卡行上落库的 name 字段：那是采集期旧口径（v1 语义名），会与改进后的规则长期不一致；
 * 卡行 name 仍保留作审计，展示以本投影为准。
 */
function projectCard(card: CardRow, names: CaptureNamesSnapshot | undefined): PanelCard {
  const mergeKey = card.mergeKey !== undefined && card.mergeKey !== ''
    ? card.mergeKey
    : mergeKeyOf(card.method, card.urlTemplate)
  const manual: string | undefined = names?.interfaces[mergeKey]
  const manualName = manual !== undefined && manual !== '' ? manual : undefined
  return {
    ...card,
    mergeKey,
    name: manualName ?? semanticName(card.method, card.urlTemplate),
    nameSource: manualName === undefined ? 'auto' : 'manual',
  }
}

/** POST /captures：发起单页采集。FR-7.6 边界在闸内：body 里 taskType 只认 single_page，其余 400。 */
async function handleStartCapture(deps: CapturePanelDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: unknown
  try {
    body = JSON.parse((await readBody(req, MAX_WRITE_BODY_BYTES)) || '{}')
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      fail(res, 413, `请求体超过 ${MAX_WRITE_BODY_BYTES} 字节`, 'body-too-large')
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

/**
 * POST /names：写一条三级手工名覆盖。
 *
 * body `{kind:'site'|'page'|'interface', key:string, name:string}`；name trim 后空串 = 删除该条覆盖。
 * 校验：kind 合法、key 非空字符串、name 字符串且 ≤80 字符，否则 400 信封错误。
 * 回执 data `{kind,key,name?}`：key 是**归一后**的键（site 小写 / page 身份 / interface trim）。
 */
async function handleSetName(deps: CapturePanelDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: unknown
  try {
    body = JSON.parse((await readBody(req, MAX_WRITE_BODY_BYTES)) || '{}')
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      fail(res, 413, `请求体超过 ${MAX_WRITE_BODY_BYTES} 字节`, 'body-too-large')
      return
    }
    fail(res, 400, '请求体不是合法 JSON', 'bad-json')
    return
  }
  const record = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  const kindRaw = record['kind']
  if (!isCaptureNameKind(kindRaw)) {
    fail(res, 400, `kind 非法：${String(kindRaw)}（可选 site/page/interface）`, 'bad-name-kind')
    return
  }
  const keyRaw = record['key']
  if (typeof keyRaw !== 'string' || keyRaw.trim() === '') {
    fail(res, 400, '缺少 key（非空字符串）', 'bad-name-key')
    return
  }
  const nameRaw = record['name']
  if (typeof nameRaw !== 'string') {
    fail(res, 400, 'name 必须是字符串（空串 = 删除该条覆盖）', 'bad-name-value')
    return
  }
  const name = cleanName(nameRaw)
  if (name.length > NAME_MAX_CHARS) {
    fail(res, 400, `name 超过 ${NAME_MAX_CHARS} 字符`, 'name-too-long')
    return
  }
  const normalizedKey = normalizeNameKey(kindRaw, keyRaw)
  if (normalizedKey === '') {
    fail(res, 400, `key 归一后为空：${keyRaw.slice(0, 200)}`, 'bad-name-key')
    return
  }
  if (deps.names === undefined) {
    fail(res, 503, '名称覆盖存储未装配（names 未注入）', 'names-not-wired')
    return
  }
  try {
    deps.names.set(kindRaw, keyRaw, name)
  } catch (err) {
    fail(res, 500, `名称覆盖写入失败：${String((err as Error)?.message ?? err)}`, 'names-write-failed')
    return
  }
  ok(res, name === '' ? { kind: kindRaw, key: normalizedKey } : { kind: kindRaw, key: normalizedKey, name })
}

/**
 * POST /retitle：启动旧页面标题补抓。
 *
 * 操作反馈用 200 信封表达（accepted=false + reason='busy'|'no-targets'|'capture-running'），
 * 不用 4xx/5xx —— 这些不是请求错误，而是「现在不能跑」。未装配属装配问题，才回 503。
 */
function handleRetitle(deps: CapturePanelDeps, res: ServerResponse): void {
  if (deps.retitle === undefined) {
    fail(res, 503, '标题补抓未装配（retitle 未注入）', 'retitle-not-wired')
    return
  }
  try {
    ok(res, deps.retitle.start())
  } catch (err) {
    fail(res, 500, `标题补抓启动失败：${String((err as Error)?.message ?? err)}`, 'retitle-start-failed')
  }
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
  const uiTest = deps.uiTest
  const artifacts = deps.artifacts
  const handler = orchestration === undefined && uiTest === undefined && artifacts === undefined
    ? captureHandler
    : (req: IncomingMessage, res: ServerResponse): void => {
        // 产物 → UI 测试 → 编排 → 采集：各子路由路径互不重叠，返回 false 表示不是它。
        if (artifacts !== undefined && artifacts(req, res) === true) return
        if (uiTest !== undefined && uiTest(req, res) === true) return
        if (orchestration !== undefined && isOrchestrationRequest(req.url)) orchestration(req, res)
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
