/**
 * 采集编排：任务型校验 → action 写操作闸 → 自治 job（single_page/site_crawl）→ 状态/产物/取消。
 *
 * - action 是 agent 驱动路径：只开会话（registry.open），动作由 agent 经 session 原语给；
 * - single_page / site_crawl 是自治路径：投递后台 job；jobs 不可用（服务缺席，或服务在但拒绝——
 *   面板路由没有 agent 归属时 start 会抛错）即前台降级，run 照常跑完，绝不留 running 僵尸。
 * - 三条路径统一记页面标题/站点名（browser.onPageMeta → store.upsertPage 的 meta 参数），
 *   旧库缺标题由面板「补抓名称」（TitleBackfillService）重访回填。
 */
import type { SessionRegistry } from './session.js'
import { crawlSite, type CrawlDriver } from './crawler.js'
import {
  buildRequestTemplate,
  buildResponseTemplate,
  classifyAuth,
  formPairsOf,
  jsonBodyOf,
  mergeKeyOf,
  newRequestSamplesAcc,
  normalizeUrlForTemplate,
  paramsFingerprintOf,
  pathSegmentsOf,
  queryPairsOf,
  semanticName,
} from './normalizer.js'
import { openCapturingPage, responseToRawSample, type PagePageMeta, type WireSample } from './browser.js'
import type { CaptureStore } from './store.js'
import { harvestTokenCredentials } from './token-harvest.js'
import { pageIdentityOf } from '../shared/page-url.js'
import type { Config } from '../config.js'
import type { Cookie } from 'playwright-core'
import type {
  CardRow, CaptureRunRow, CaptureTaskType, CredentialRow, PageRow, SampleRow, Template,
} from '../shared/capture-types.js'
import type { RawJson } from '../shared/types.js'

export type CaptureGate = 'started' | 'bad-task' | 'action-confirm-required' | 'bad-url'

export type CaptureDeps = {
  config: Required<Config>
  resolveJobs: () => unknown
  store: CaptureStore
  registry: Pick<SessionRegistry, 'open' | 'act' | 'snapshot' | 'close' | 'bindSink'>
  openCapturingPage: typeof openCapturingPage
}

export type StartCaptureArgs = {
  taskType: CaptureTaskType
  entryUrl: string
  /** action 闸 2：真实 UI 写操作需用户确认。 */
  confirm?: boolean
  maxDepth?: number
  maxPages?: number
  /** action 型：false = 可见 Chrome，用户手动登录；缺省无头。 */
  headless?: boolean
  /** 从指定 captureId 的 credential_events 读回 cookie，注入新浏览器上下文（恢复登录态）。 */
  reuseCookiesFrom?: string
}

export type CaptureToolValue = {
  accepted: boolean
  gate: CaptureGate
  captureId?: string
  sessionId?: string
  /** action 型：从旧 captureId 注入的 cookie 数。 */
  cookiesReused?: number
  /** jobs 不可用（缺席或被拒绝）时的降级说明：采集仍在前台进行，只是过程中无法进度查询。 */
  degradedNotice?: string
  card?: string
}

type JobHandle = { id: string; append: (text: string) => void; updateProgress: (text: string) => void }
type JobHooks = {
  cancel: (reason?: string) => void
  done: Promise<{ status: 'completed' | 'killed' | 'failed'; detail?: string; result?: string }>
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))

/**
 * 单次采集样本上限（§11 A9）：一次 run 至多入库 1000 条样本，超出如实弃采并在 run 上附 notice。
 * 用模块常量而非 config 项——上限是采集纪律（验收基准），不是部署调参。
 */
export const SAMPLE_LIMIT_PER_RUN = 1000

type CardAcc = {
  acc: ReturnType<typeof newRequestSamplesAcc>
  responseTexts: string[]
  /** 页面身份 → 该身份首次观测到的原始页面 URL（卡上的页面引用留原值，展示/打开/重采可用）。 */
  pageUrls: Map<string, string>
  sampleTotal: number
}

function newCardAcc(): CardAcc {
  return { acc: newRequestSamplesAcc(), responseTexts: [], pageUrls: new Map(), sampleTotal: 0 }
}

/** 每卡累计样本封顶（与 normalizer 的 TEMPLATE_DIFF_SAMPLE_CAP 对齐）：内存诚实上界，计数照实。 */
const CARD_ACC_SAMPLE_CAP = 20

function pushCapped<T>(bag: T[], item: T, cap: number): void {
  bag.push(item)
  if (bag.length > cap) bag.shift()
}

/** wire→store 桥：样本落库 + 关系/归并卡（自治 job、action 会话、面板采集页共用同一投影）。 */
function wireToStore(deps: CaptureDeps, captureId: string, pageIds: Map<string, string>): (w: WireSample) => void {
  const cards = new Map<string, CardAcc>()
  let sampleSeen = 0
  let overLimit = false
  const pageIdOf = (pageUrl: string): string => {
    const hit = pageIds.get(pageUrl)
    if (hit !== undefined) return hit
    const id = deps.store.upsertPage(captureId, pageUrl, 0, 'ok')
    pageIds.set(pageUrl, id)
    return id
  }
  return (w: WireSample): void => {
    sampleSeen += 1
    if (sampleSeen > SAMPLE_LIMIT_PER_RUN) {
      if (!overLimit) {
        overLimit = true
        deps.store.setRunNotice(captureId, `单次采集样本上限 ${SAMPLE_LIMIT_PER_RUN} 已达，超出部分如实弃采（已采样本完整保留）`)
      }
      return
    }
    const raw = responseToRawSample(w, deps.config.captureBodyLimitBytes)
    if (raw === undefined) return
    // 页面身份归一（shared/page-url）：page 行 / 关系行写「页面身份」，同一 SPA 页面的
    // hash 路由变体与 `?_at_=` 反缓存戳变体因此并成一页；样本行留原始 pageUrl（逐请求证据），
    // 卡上的页面引用也留首次观测到的原始 URL（展示/打开/重采要真实可打开的地址）。
    const pageUrl = pageIdentityOf(w.pageUrl)
    const pageId = pageIdOf(pageUrl)
    const sampleId = deps.store.upsertSample(captureId, pageId, {
      ...raw,
      responseHeaders: { 'content-type': w.contentType },
      pageUrl: w.pageUrl,
      ts: w.ts,
      bodyLimit: deps.config.captureBodyLimitBytes,
    })

    // 卡归并键（既有规则）+ 每卡累计：query / body / 请求头 / pathParams / 响应体，供多形态模板合成
    const urlTemplate = normalizeUrlForTemplate(raw.url).urlTemplate
    const mergeKey = mergeKeyOf(raw.method, urlTemplate)
    const cardAcc = cards.get(mergeKey) ?? newCardAcc()
    cards.set(mergeKey, cardAcc)
    pushCapped(cardAcc.acc.querySamples, queryPairsOf(raw.url), CARD_ACC_SAMPLE_CAP)
    pushCapped(cardAcc.acc.headerSamples, raw.requestHeaders, CARD_ACC_SAMPLE_CAP)
    const bodyJson = jsonBodyOf(raw.requestBody)
    if (bodyJson !== undefined) {
      pushCapped(cardAcc.acc.bodySamples, bodyJson, CARD_ACC_SAMPLE_CAP)
    } else {
      // 表单体（urlencoded）也进模板：转成扁平对象走同一套 role diff
      const form = formPairsOf(raw.requestBody)
      if (form !== undefined && form.length > 0) {
        pushCapped(cardAcc.acc.bodySamples, Object.fromEntries(form) as RawJson, CARD_ACC_SAMPLE_CAP)
      }
    }
    const templateSegments = urlTemplate.split('?')[0].split('/').filter((s) => s !== '')
    const rawSegments = pathSegmentsOf(raw.url)
    if (templateSegments.length === rawSegments.length) {
      for (let i = 0; i < templateSegments.length; i += 1) {
        if (templateSegments[i] === '{p}' && !cardAcc.acc.pathParams.includes(rawSegments[i]))
          cardAcc.acc.pathParams.push(rawSegments[i])
      }
    }
    // 同一身份只留首次观测到的原始 URL（卡上的页面引用用于展示/打开/重采，不参与归并）
    if (!cardAcc.pageUrls.has(pageUrl)) cardAcc.pageUrls.set(pageUrl, w.pageUrl)
    cardAcc.sampleTotal += 1
    if (typeof raw.responseBody === 'string' && raw.responseBody !== '')
      pushCapped(cardAcc.responseTexts, raw.responseBody, CARD_ACC_SAMPLE_CAP)

    // FR-3.7 鉴权探测（读原始请求线，不受易变键滤除影响）；凭证值只进凭证表，永不出现在卡上
    const auth = classifyAuth(raw.url, w.requestHeaders, raw.requestBody)
    const cardId = deps.store.upsertCard(captureId, {
      mergeKey, method: raw.method, urlTemplate,
      name: semanticName(raw.method, urlTemplate),
      relatedPageUrls: [...cardAcc.pageUrls.values()],
      requestTemplate: buildRequestTemplate({ acc: cardAcc.acc, sampleTotal: cardAcc.sampleTotal }),
      responseTemplate: buildResponseTemplate(cardAcc.responseTexts),
      ...(auth.authType === undefined ? {} : { authType: auth.authType }),
      ...(auth.evidence === undefined ? {} : { authEvidence: auth.evidence }),
    })
    const relationId = deps.store.upsertRelation(
      captureId, cardId, pageUrl, paramsFingerprintOf(raw.url, raw.requestBody), pageId,
    )
    // 样本回指关系行：一条请求属于「哪个页面 × 哪个接口 × 哪种形态」
    deps.store.attachSampleRelation(sampleId, relationId)
  }}

/**
 * 页面标题/站点名落库（三条采集路径共用）。
 *
 * url 先归一到页面身份再 upsert：与样本桥、爬行 page 事件写的是同一行（upsertPage 按
 * (capture_id,url) 幂等，后到的 meta 只补非空标题/站点名，不重复计页数）。
 * 身份为空（非法 URL）如实丢弃——名称是增强面，不因它中断采集。
 */
function pageMetaSink(deps: CaptureDeps, captureId: string): (meta: PagePageMeta) => void {
  return (meta) => {
    const identity = pageIdentityOf(meta.url)
    if (identity === '') return
    deps.store.upsertPage(captureId, identity, 0, 'ok', {
      ...(meta.title === undefined ? {} : { title: meta.title }),
      ...(meta.siteName === undefined ? {} : { siteName: meta.siteName }),
    })
  }
}

/**
 * 安全启动后台 job：三种结局都要能落地，不能把异常冒给调用方。
 *
 * - jobs 服务缺席 → { failure: 'absent' }；
 * - 服务在但拒绝（无 agent 归属 / 配额 / 组合未装 tool-jobs）→ start 抛错是**常态**，
 *   必须按缺席处理走前台降级，否则调用方拿到异常、run 行永远停在 running（僵尸）；
 * - start 返回 thenable 且后来 reject → 同样不能留僵尸：立刻把这个 run 收口为 failed。
 */
function startJobSafely(
  jobs: unknown,
  spec: unknown,
  onAsyncFailure: (reason: string) => void,
): { started?: unknown; failure?: string } {
  const start = (jobs as { start?: (s: unknown) => unknown } | undefined)?.start
  if (typeof start !== 'function') return { failure: 'absent' }
  let started: unknown
  try {
    started = start.call(jobs, spec)
  } catch (err) {
    return { failure: errText(err) }
  }
  if (started === undefined || started === null) return { failure: 'empty-handle' }
  const maybeThenable = started as { then?: unknown; catch?: (fn: (e: unknown) => void) => unknown }
  if (typeof maybeThenable.then === 'function' && typeof maybeThenable.catch === 'function') {
    maybeThenable.catch((err: unknown) => { onAsyncFailure(errText(err)) })
  }
  return { started }
}

function errText(err: unknown): string {
  const message = (err as Error | undefined)?.message
  return (typeof message === 'string' && message.length > 0 ? message : String(err)).slice(0, 200)
}

/** 从采集库的 credential_events 读回 cookie，转成 Playwright addCookies 的形状。 */
export function cookiesFromCapture(store: CaptureStore, captureId: string): Cookie[] {
  const cookies: Cookie[] = []
  const now = Date.now() / 1000
  for (const row of store.listCredentials(captureId, 500)) {
    if (row.kind !== 'cookie' || row.valueJson === undefined) continue
    let raw: unknown
    try {
      raw = JSON.parse(row.valueJson)
    } catch {
      continue
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue
    const record = raw as Record<string, unknown>
    const name = typeof record['name'] === 'string' ? record['name'] : row.name
    const value = typeof record['value'] === 'string' ? record['value'] : ''
    const domain = typeof record['domain'] === 'string' && record['domain'] !== '' ? record['domain'] : row.url
    if (name === '' || domain === '') continue
    const expires = typeof record['expires'] === 'number' && Number.isFinite(record['expires']) ? record['expires'] : -1
    if (expires > 0 && expires < now) continue
    const sameSiteRaw = typeof record['sameSite'] === 'string' ? record['sameSite'] : 'Lax'
    const sameSite = (sameSiteRaw === 'Strict' || sameSiteRaw === 'Lax' || sameSiteRaw === 'None' ? sameSiteRaw : 'Lax') as Cookie['sameSite']
    cookies.push({
      name,
      value,
      domain,
      path: typeof record['path'] === 'string' && record['path'] !== '' ? record['path'] : '/',
      expires,
      httpOnly: record['httpOnly'] === true,
      secure: record['secure'] === true,
      sameSite,
    })
  }
  return cookies
}

export async function startCapture(deps: CaptureDeps, args: StartCaptureArgs): Promise<CaptureToolValue> {
  const { taskType, entryUrl } = args
  let entry: URL
  try {
    entry = new URL(entryUrl)
  } catch {
    return { accepted: false, gate: 'bad-url', card: `❌ entryUrl 不是合法 URL：${entryUrl}` }
  }
  if (taskType !== 'single_page' && taskType !== 'site_crawl' && taskType !== 'action')
    return { accepted: false, gate: 'bad-task', card: `❌ taskType 非法：${String(taskType)}（可选 single_page/site_crawl/action）` }
  const captureId = `cap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

  if (taskType === 'action') {
    if (args.confirm !== true)
      return { accepted: false, gate: 'action-confirm-required', card: `⚠️ action 任务将对 ${entry.host} 执行真实 UI 写操作（提交/创建类）。请用户确认后以 confirm=true 重调。` }
    deps.store.upsertRun({
      id: captureId, taskType, entryUrl, status: 'running', startedAt: Date.now(),
      stats: { pages: 0, requests: 0, cards: 0, credentials: 0 },
    })
    const cookies = args.reuseCookiesFrom === undefined ? [] : cookiesFromCapture(deps.store, args.reuseCookiesFrom)
    const { sessionId } = await deps.registry.open({
      entryUrl,
      captureId,
      ...(args.headless === undefined ? {} : { headless: args.headless }),
      ...(cookies.length === 0 ? {} : { cookies }),
    })
    deps.registry.bindSink(sessionId, {
      onSample: wireToStore(deps, captureId, new Map()),
      onPageMeta: pageMetaSink(deps, captureId),
    })
    return { accepted: true, gate: 'started', captureId, sessionId, ...(cookies.length === 0 ? {} : { cookiesReused: cookies.length }) }
  }

  deps.store.upsertRun({
    id: captureId, taskType, entryUrl, status: 'running', startedAt: Date.now(),
    stats: { pages: 0, requests: 0, cards: 0, credentials: 0 },
  })
  const jobs = deps.resolveJobs()
  const spec = {
    kind: 'dataforge-capture',
    label: `capture ${taskType} ${entry.host}`,
    run: makeAutonomousRun(deps, captureId, taskType, entry, args),
  }
  const attempt = startJobSafely(jobs, spec, (reason) => {
    // 异步失败（thenable reject）：run 行还在 running，必须收口，否则面板永远显示「进行中」
    deps.store.setRunNotice(captureId, `后台任务启动后失败：${reason}`)
    deps.store.finishRun(captureId, 'failed', `后台任务启动后失败：${reason}`)
  })
  if (attempt.started === undefined) {
    // FR-1.5 前台降级：jobs 不可用不拦采集——仍起浏览器跑完全程，留痕只经 store 可查。
    // 「服务在但拒绝」与「服务缺席」同一处理：面板路由没有 agent 归属，start 抛错是常态。
    const why = attempt.failure === 'absent' ? 'jobs 服务缺席' : `jobs 服务拒绝（${attempt.failure ?? 'unknown'}）`
    deps.store.setRunNotice(captureId, `${why}，本次采集已前台降级执行`)
    const foreground = makeAutonomousRun(deps, captureId, taskType, entry, args)({
      id: captureId, append: () => undefined, updateProgress: () => undefined,
    })
    // 前台执行的失败已由 makeAutonomousRun 收口为 failed；这里只兜底未处理异常
    foreground.done.catch(() => undefined)
    return {
      accepted: true, gate: 'started', captureId,
      degradedNotice: `${why}，本次采集已前台降级执行：仍会完整采集落库，但过程中无法进度查询，仅在完成后可在面板看到结果`,
    }
  }
  return { accepted: true, gate: 'started', captureId }
}

function makeAutonomousRun(
  deps: CaptureDeps,
  captureId: string,
  taskType: 'single_page' | 'site_crawl',
  entry: URL,
  args: StartCaptureArgs,
): (job: JobHandle) => JobHooks {
  return (job: JobHandle): JobHooks => {
    let browserClosed = false
    let closeBrowser: (() => Promise<void>) | undefined
    const done = (async (): Promise<{ status: 'completed' | 'killed' | 'failed'; detail?: string }> => {
      try {
        const pageIds = new Map<string, string>()
        const onWire = wireToStore(deps, captureId, pageIds)
        const { page, context, browser } = await deps.openCapturingPage(deps.config.captureChromeChannel, onWire, {
          // 单页/爬取同样记标题：onPageMeta 在 load / 主 frame 导航后防抖上报，落 pages.title/site_name。
          onPageMeta: pageMetaSink(deps, captureId),
        })
        closeBrowser = async () => { await browser.close().catch(() => undefined) }
        if (taskType === 'single_page') {
          await page.goto(entry.href, { waitUntil: 'domcontentloaded', timeout: 30_000 })
          await page
            .waitForLoadState('networkidle', { timeout: Math.max(deps.config.captureStabilityWindowMs, 8_000) })
            .catch(() => undefined)
        } else {
          job.updateProgress('crawl-start')
          const driver: CrawlDriver = {
            openPage: async (url) => {
              await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
              await sleep(deps.config.captureStabilityWindowMs)
              return { pageId: '', html: await page.content(), sampleCount: deps.store.countSamples(captureId) }
            },
            close: async () => { await closeBrowser?.() },
          }
          const r = await crawlSite({
            entryUrl: entry.href,
            driver,
            ownHost: entry.host,
            maxDepth: args.maxDepth ?? deps.config.captureMaxDepth,
            maxPages: args.maxPages ?? deps.config.captureMaxPages,
            stabilityMs: deps.config.captureStabilityWindowMs,
            onEvent: (e) => {
              if (e.kind === 'page') {
                // 与 wireToStore 同口径：pages 表存页面身份；pageIds 的键也必须是身份串。
                // 请求先于爬行页事件到达时该页已建行 → 不重复建（否则同页计两次页数）。
                const pageUrl = pageIdentityOf(e.url)
                if (!pageIds.has(pageUrl)) pageIds.set(pageUrl, deps.store.upsertPage(captureId, pageUrl, 0, 'ok'))
              }
            },
            onSample: () => undefined,
          })
          job.updateProgress(`crawl-end pages=${r.pagesVisited} truncated=${r.truncated}`)
        }
        if (browserClosed) return { status: 'killed' }
        for (const c of (await context.cookies()) as unknown as Array<Record<string, unknown>>) {
          deps.store.upsertCredential(
            captureId, 'cookie', String(c['domain'] ?? ''), String(c['name'] ?? ''), Date.now(), c,
          )
        }
        // R-4 M3：从本次请求样本补采 token（Authorization / query token）→ credential_events。
        // 补采失败不打断收口：cookie 已经入库，token 是增强面；下次重新采集会再试。
        try {
          harvestTokenCredentials(deps.store, captureId)
        } catch {
          // 静默降级：value_json 坏行会在内部跳过，走到这里说明 store 本身不可用。
        }
        deps.store.finishRun(captureId, 'done', undefined)
        return { status: 'completed', detail: `capture ${captureId} 完成` }
      } catch (err) {
        const msg = (err as Error | undefined)?.message?.slice(0, 400) ?? 'unknown error'
        deps.store.finishRun(captureId, 'failed', msg)
        return { status: 'failed', detail: msg }
      }
    })()
    return {
      cancel: (reason?: string) => {
        browserClosed = true
        void (async () => { await closeBrowser?.() })()
        job.append(`capture cancel: ${reason ?? 'user requested'}`)
      },
      done,
    }
  }
}

export function captureStatus(
  deps: CaptureDeps,
  captureId?: string,
): { ok: boolean; run?: CaptureRunRow; runs?: CaptureRunRow[]; notice?: string } {
  if (captureId !== undefined) {
    const run = deps.store.getRun(captureId)
    if (run === undefined) return { ok: false, notice: `captureId ${captureId} 无记录` }
    return { ok: true, run }
  }
  return { ok: true, runs: deps.store.listRuns(10) }
}

export function captureResult(
  deps: CaptureDeps,
  captureId: string,
  scope: 'cards' | 'samples' | 'credentials' | 'pages',
  limit = 50,
): { ok: boolean; items?: Array<CardRow | SampleRow | CredentialRow | PageRow>; notice?: string } {
  const labels = { cards: '卡片', samples: '样本', credentials: '凭证', pages: '页面' }
  if (deps.store.getRun(captureId) === undefined) return { ok: false, notice: `captureId ${captureId} 无记录` }
  const items =
    scope === 'cards' ? deps.store.listCards(captureId, limit)
    : scope === 'samples' ? deps.store.listSamples(captureId, limit)
    : scope === 'credentials' ? deps.store.listCredentials(captureId, limit)
    : deps.store.listPages(captureId, limit)
  return items.length === 0
    ? { ok: true, notice: `captureId ${captureId} 的${labels[scope]}暂无记录` }
    : { ok: true, items }
}

export function captureCancel(
  deps: CaptureDeps,
  captureId: string,
): { ok: boolean; status?: string; notice?: string } {
  if (deps.store.getRun(captureId) === undefined) return { ok: false, notice: `captureId ${captureId} 无记录` }
  deps.store.finishRun(captureId, 'cancelled')
  return { ok: true, status: 'cancelled' }
}
