/**
 * 采集编排：任务型校验 → action 写操作闸 → 自治 job（single_page/site_crawl）→ 状态/产物/取消。
 *
 * - action 是 agent 驱动路径：只开会话（registry.open），动作由 agent 经 session 原语给；
 * - single_page / site_crawl 是自治路径：投递后台 job（无 jobs 服务则前台降级），闭包内
 *   browser 起页 → wire 桥（样本 → normalizer → store）→ cookie 收割 → finishRun。
 */
import type { SessionRegistry } from './session.js'
import { crawlSite, type CrawlDriver } from './crawler.js'
import { mergeKeyOf, normalizeUrlForTemplate, jsonToTemplate } from './normalizer.js'
import { openCapturingPage, responseToRawSample, type WireSample } from './browser.js'
import type { CaptureStore } from './store.js'
import type { Config } from '../config.js'
import type { RawJson } from '../shared/types.js'
import type { CaptureTaskType, Template } from '../shared/capture-types.js'

export type CaptureGate = 'started' | 'bad-task' | 'action-confirm-required' | 'bad-url'

export type CaptureDeps = {
  config: Required<Config>
  resolveJobs: () => unknown
  store: CaptureStore
  registry: Pick<SessionRegistry, 'open'>
  openCapturingPage: typeof openCapturingPage
}

export type StartCaptureArgs = {
  taskType: CaptureTaskType
  entryUrl: string
  /** action 闸 2：真实 UI 写操作需用户确认。 */
  confirm?: boolean
  maxDepth?: number
  maxPages?: number
}

export type CaptureToolValue = {
  accepted: boolean
  gate: CaptureGate
  captureId?: string
  sessionId?: string
  card?: string
}

type JobHandle = { id: string; append: (text: string) => void; updateProgress: (text: string) => void }
type JobHooks = {
  cancel: (reason?: string) => void
  done: Promise<{ status: 'completed' | 'killed' | 'failed'; detail?: string; result?: string }>
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))

function jsonTemplateOf(body: string | Buffer | undefined): Template | undefined {
  if (typeof body !== 'string' || body.trim().startsWith('{') === false) return undefined
  try {
    const parsed: unknown = JSON.parse(body)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    return jsonToTemplate(parsed as RawJson)
  } catch {
    return undefined
  }
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
    const { sessionId } = await deps.registry.open({ entryUrl, captureId })
    return { accepted: true, gate: 'started', captureId, sessionId }
  }

  deps.store.upsertRun({
    id: captureId, taskType, entryUrl, status: 'running', startedAt: Date.now(),
    stats: { pages: 0, requests: 0, cards: 0, credentials: 0 },
  })
  const jobs = deps.resolveJobs() as { start?: (spec: unknown) => unknown } | undefined
  const spec = {
    kind: 'dataforge-capture',
    label: `capture ${taskType} ${entry.host}`,
    run: makeAutonomousRun(deps, captureId, taskType, entry, args),
  }
  const started = jobs?.start?.(spec)
  return { accepted: true, gate: 'started', captureId, ...(started === undefined ? {} : {}) }
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
        const pageUrls = new Map<string, Set<string>>()
        const onWire = (w: WireSample): void => {
          const raw = responseToRawSample(w, deps.config.captureBodyLimitBytes)
          if (raw === undefined) return
          deps.store.upsertSample(captureId, undefined, {
            ...raw,
            responseHeaders: { 'content-type': w.contentType },
            pageUrl: w.pageUrl,
            ts: w.ts,
            bodyLimit: deps.config.captureBodyLimitBytes,
          })
          const urlTemplate = normalizeUrlForTemplate(raw.url).urlTemplate
          const mergeKey = mergeKeyOf(raw.method, urlTemplate)
          const pages = pageUrls.get(mergeKey) ?? new Set<string>()
          pages.add(w.pageUrl)
          pageUrls.set(mergeKey, pages)
          const requestTemplate = raw.truncated ? undefined : jsonTemplateOf(raw.requestBody)
          const responseTemplate = raw.truncated ? undefined : jsonTemplateOf(raw.responseBody)
          deps.store.upsertCard(captureId, {
            mergeKey, method: raw.method, urlTemplate, relatedPageUrls: [...pages],
            ...(requestTemplate === undefined ? {} : { requestTemplate }),
            ...(responseTemplate === undefined ? {} : { responseTemplate }),
          })
        }
        const { page, context, browser } = await deps.openCapturingPage(deps.config.captureChromeChannel, onWire)
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
              if (e.kind === 'page') deps.store.upsertPage(captureId, e.url, 0, 'ok')
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
): { ok: boolean; run?: unknown; runs?: unknown[]; notice?: string } {
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
): { ok: boolean; items?: unknown[]; notice?: string } {
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
