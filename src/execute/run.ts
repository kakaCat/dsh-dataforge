/**
 * 执行调度器（IF-3）：一条 interface-chain + 一份执行计划 → 一条 runs 事件流。
 *
 * 职责边界（刻意收窄）：
 *   - 只认 `buildPlan()` 的产物，不自己算拓扑或覆盖判定（`topoOrder` / `dependencyPairs`
 *     只有一份，见 `chains/validate.ts`）；
 *   - 只依赖 `chains/*`、`runs/store.ts` 与 `execute/*`，**不**依赖 capture/ library/ client/；
 *   - 闸门（预检、确认、执行开关、后台 job 装配）全在 `orchestration/application.ts`，
 *     这里只回答一个问题：按计划把请求发出去，并把发生的事如实写进事件流。
 *
 * 调度规则：
 *   - 就绪队列 = indegree 0 的节点；indegree 由 `dependencyPairs(doc)` 统计，且只保留两端
 *     都在节点集合里的 pair（与 `topoOrder` 内部的 `indegree.has` 同源，不引第二套规则）；
 *   - 就绪节点按节点 ID 字典序取，同等输入下调度顺序可复现；
 *   - 某节点成功后才对其下游 `indegree-1`（失败/取消不再放行任何新节点）；
 *   - 并发上限 `concurrency`（默认 4，硬上限 16）。
 *
 * 事件不变量：
 *   - 每个实际启动的节点恰好一条 `step(status:start)` + 一条终态（`done` | `error`）；
 *   - 因中止而没启动的节点**不发** `step`，只在 `result.businessData` 里标 `skipped`
 *     ——否则会被 `foldSummary` 误算成失败节点；
 *   - `start` 先于请求；`terminal` / `result` 只在全部在飞节点落定后写。
 *
 * 错误码是契约：`ChainRunErrorCode` 只增不改名（工具回执、运行记录、面板都按它分支）。
 * 三处映射在这里显式写明，不打哑谜：
 *   - HTTP `aborted` → `cancelled`；`timeout` → `node-timeout`；
 *   - HTTP `bad-url` → `bad-url-template`；`redirect-limit` → `node-network-error`（带原文）；
 *   - `buildRequest` 的运行期 `param-missing` → `param-missing`（静态缺参已在 `buildPlan`
 *     拦过，走到这里是防御：例如模板里有 `{p2}` 但卡只声明了 `path.p1`）。
 *
 * @module dsh-dataforge/execute/run
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { appendEvent, foldSummary, loadRunEvents, runsRoot, startRunRecord } from '../runs/store.js'
import type { BridgeEvent, RunSummary } from '../shared/types.js'
import type { ChainDoc, ChainNode, InterfaceCardDoc } from '../chains/schema.js'
import { isInputSlotRef, splitBindingPath } from '../chains/schema.js'
import { slugOf } from '../chains/store.js'
import { dependencyPairs } from '../chains/validate.js'
import type { BindingRoot } from './binding.js'
import { resolveBinding } from './binding.js'
import type { ExecutionPlan, PlanNode } from './plan.js'
import { buildRequest } from './request.js'
import type { StaticGap } from './coverage.js'
import { normalizePath } from './coverage.js'
import { httpRequest, redactHeaders } from './http.js'

/* ================================================================== 常量 */

/** 摘要正文上限：请求/响应各留前 4 KiB（隐私面与可诊断面的平衡点）。 */
const DIGEST_PREVIEW_BYTES = 4096

const DEFAULT_CONCURRENCY = 4
const MAX_CONCURRENCY = 16
/** 节点级重试硬上限（与 IF-4 的 retry 上限一致）。 */
const MAX_NODE_RETRY = 5

/** 幂等方法：只有它们才吃 `node.retry`（写方法重试 = 重放写请求，绝不默认）。 */
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/* ================================================================== 契约 */

/** 执行错误码（预检 + 运行期）。只增不改名。 */
export type ChainRunErrorCode =
  // ── 预检（与 IF-1 同名；全部在第一个请求之前返回）──
  | 'missing-params'
  | 'chain-not-found'
  | 'invalid-chain'
  | 'card-not-imported'
  | 'not-executable'
  | 'cycle'
  | 'base-url-unresolved'
  | 'inputs-invalid'
  | 'confirm-required'
  | 'execution-disabled'
  | 'execution-unavailable'
  // ── 运行期 ──
  | 'binding-path-not-found'
  | 'binding-type-mismatch'
  | 'binding-null'
  | 'empty-wildcard'
  | 'param-missing'
  | 'param-type-mismatch'
  | 'bad-url-template'
  | 'node-timeout'
  | 'node-network-error'
  | 'node-http-error'
  | 'node-auth-required'
  | 'response-too-large'
  | 'cancelled'

/** 请求摘要：进运行记录时头名命中脱敏集合即打码，正文只留前 4 KiB。 */
export type RequestDigest = {
  method: string
  url: string
  headers: Record<string, string>
  bodyPreview?: string
}

export type ResponseDigest = {
  status: number
  bytes: number
  truncated: boolean
  bodyPreview: string
}

/** 一条绑定边的求值记录（值只留预览，事件流不做数据仓库）。 */
export type BindingRecord = {
  /** 绑定边原文 `from`（`上游节点.出参路径`，或 `$inputs.<name>` 已在别处处理）。 */
  from: string
  /** 绑定边原文 `to`（`下游节点.入参路径`）。 */
  to: string
  /** 求值成功时的值预览（≤ 512 字符）。 */
  valuePreview?: string
  /** 求值失败码（`binding-*` / `empty-wildcard`）。 */
  code?: string
  error?: string
}

export type NodeResult = {
  nodeId: string
  cardId: string
  method: string
  /** 实际发出的 URL（构造失败时是模板原文，便于对照）。 */
  url: string
  status: 'done' | 'error' | 'skipped' | 'cancelled'
  httpStatus?: number
  attempts: number
  elapsedMs: number
  errorCode?: ChainRunErrorCode
  error?: string
  requestDigest: RequestDigest
  responseDigest?: ResponseDigest
  bindings: BindingRecord[]
  truncated?: boolean
}

/** `run.json` 的内容（写入一次，先于第一个请求；崩溃时至少留下计划与目标）。 */
export type ChainRunMeta = {
  kind: 'chain-run'
  /** 沿用现有键：`foldSummary` / status 不需要改。 */
  flow: string
  /** 展示名（与 `flow` 同值；对齐 R-3 设计里的 run.json 形状）。 */
  flowName: string
  chain: {
    site: string
    flow: string
    version: number
    /** 链文件相对工作区的路径（缺省不写：调用方可能没给）。 */
    path?: string
    apiVersion: string
  }
  params: Record<string, unknown>
  baseUrl: string
  dryRun: boolean
  planned: string[]
  concurrency: number
  startedAt: number
}

/** 已落盘的运行起点（run.json + meta 事件都已写完，可以安全回执 runId）。 */
export type PreparedChainRun = {
  runId: string
  runDir: string
  meta: ChainRunMeta
}

export type ChainRunResult =
  | { ok: false; code: ChainRunErrorCode; message: string; gaps: StaticGap[]; cycle: string[] }
  | {
      ok: true
      runId: string
      runDir: string
      summary: RunSummary
      nodes: NodeResult[]
      failedNode?: string
      cancelled: boolean
    }

/** 执行面配置（从 `config.ts` 取子集；不认识 `Config` 全貌，便于单测直接构造）。 */
export type ChainRunConfig = {
  /** 全局执行开关（关掉只影响执行，不影响链读写与历史回看）。 */
  enabled: boolean
  /** 单节点请求超时（秒）；节点 `timeoutSeconds` 优先。 */
  nodeTimeoutSeconds: number
  /** 默认并发（硬上限 16）。 */
  concurrency: number
  /** 响应正文读取上限（字节）。 */
  responseLimitBytes: number
}

export type ChainRunDeps = {
  /** 运行留痕根（`dataRoot/runs` 的上一级，即 `config.dataRoot`）。 */
  dataRoot: string
  config: ChainRunConfig
}

export type RunChainInput = {
  /** 已加载并校验过的链文档。 */
  doc: ChainDoc
  /** 节点 cardId → 卡（调用方已确认全部在场）。 */
  cards: Map<string, InterfaceCardDoc>
  /** `buildPlan()` 的产物：dry-run 与真实执行共用同一份。 */
  plan: ExecutionPlan
  /** 链级槽位运行值（键 = 链文件声明的槽位名）。 */
  inputs?: Record<string, unknown>
  /** 目标源（调用方已按「入参 > 卡来源 origin」解析）。 */
  baseUrl: string
  /** 运行期并发（缺省 `config.concurrency`，硬上限 16）。 */
  concurrency?: number
  /** dry-run：只落计划留痕，永不发请求。 */
  dryRun?: boolean
  /** 取消信号（宿主 `job_kill` → AbortController）。 */
  signal?: AbortSignal
  /** 逐节点进度回调（后台 job 用 `job.updateProgress`）。 */
  onProgress?: (line: string) => void
  /** 已解析好的 runId（后台 job 要在启动前把 runId 回执给调用方）。 */
  runId?: string
  /** 链文件相对路径（写进 run.json，事后能对上「当时跑的是哪一版」）。 */
  chainPath?: string
}

/* ================================================================== 能力探测 */

/**
 * 执行能力探测：不按 Node 版本号硬判，只看实际能力。
 *
 * 这样 `package.json` 的 `engines` 不必为执行模块单独收紧；能力缺席时诚实报
 * `execution-unavailable`，不做 polyfill（polyfill 会让「能跑」变成不确定行为）。
 */
export function chainExecutionUnavailableReason(): string | undefined {
  if (typeof fetch !== 'function') return '当前运行时没有全局 fetch（需要 Node 22+）：执行不可用'
  if (typeof AbortSignal.timeout !== 'function') return '当前运行时没有 AbortSignal.timeout：执行不可用'
  return undefined
}

/* ================================================================== runId */

/**
 * 生成唯一 runId：`chain-<流程 slug>-<毫秒>`，撞名加 `-2`/`-3`。
 *
 * 目录名必须安全（会当目录用），所以走 `slugOf`；流程名是用户词汇，中日韩字符保留。
 */
export function newChainRunId(dataRoot: string, flow: string, now: number): string {
  const base = `chain-${slugOf(flow) || 'flow'}-${now}`
  let candidate = base
  let suffix = 2
  while (existsSync(join(runsRoot(dataRoot), candidate))) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  return candidate
}

/* ================================================================== 起点写盘 */

/** 归一并发：非法值退回默认值，越界夹到 [1, 16]。 */
export function clampConcurrency(value: number | undefined, fallback = DEFAULT_CONCURRENCY): number {
  const raw = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
  return Math.max(1, Math.min(MAX_CONCURRENCY, raw))
}

/**
 * 写运行起点：run.json（写入一次）+ `meta` 事件。
 *
 * **同步**完成是刻意的：调用方（后台 job 路径）必须在启动 job 之前拿到 runId/runDir，
 * 而 `run.json` 又必须早于第一个请求——只有一个同步入口能同时满足这两条。
 */
export function prepareChainRun(deps: ChainRunDeps, input: RunChainInput): PreparedChainRun {
  const now = Date.now()
  const runId = input.runId ?? newChainRunId(deps.dataRoot, input.doc.meta.flow, now)
  const concurrency = clampConcurrency(input.concurrency, deps.config.concurrency)
  const chain: ChainRunMeta['chain'] = {
    site: input.doc.meta.site,
    flow: input.doc.meta.flow,
    version: input.doc.meta.version,
    ...(input.chainPath === undefined ? {} : { path: input.chainPath }),
    apiVersion: input.doc.apiVersion,
  }
  const meta: ChainRunMeta = {
    kind: 'chain-run',
    flow: input.doc.meta.flow,
    flowName: input.doc.meta.flow,
    chain,
    params: { ...(input.inputs ?? {}) },
    baseUrl: input.plan.baseUrl,
    dryRun: input.dryRun === true,
    planned: [...input.plan.order],
    concurrency,
    startedAt: now,
  }
  const runDir = startRunRecord(deps.dataRoot, runId, meta as unknown as Record<string, unknown>)
  appendEvent(deps.dataRoot, runId, {
    event: 'meta',
    flow: meta.flow,
    name: meta.flowName,
    steps: meta.planned,
    dryRun: meta.dryRun,
    chain,
  })
  return { runId, runDir, meta }
}

/* ================================================================== 调度 */

/** 节点执行结果（内部用途：让调度器区分「完成 / 失败 / 取消」三态）。 */
type NodeOutcome =
  | { kind: 'done' }
  | { kind: 'failed'; code: ChainRunErrorCode; message: string }
  | { kind: 'cancelled'; message: string }

/**
 * 跑完一条链（预检已过、计划已定）。
 *
 * 返回 `ok: false` 只可能是**预检**级别的问题（当前实现里只有「计划为空」这类防御分支）；
 * 运行期失败走 `ok: true` + `summary.status='failed'` + `failedNode`——因为留痕已经写下了，
 * 调用方不该把它当成「没开始」。
 */
export async function executeChainRun(
  deps: ChainRunDeps,
  prepared: PreparedChainRun,
  input: RunChainInput,
): Promise<ChainRunResult> {
  const { doc, cards, plan } = input
  const { runId, runDir } = prepared
  const inputs = input.inputs ?? {}
  const concurrency = clampConcurrency(input.concurrency, deps.config.concurrency)
  const fallbackTimeoutMs = Math.max(1, Math.floor(deps.config.nodeTimeoutSeconds)) * 1000
  const limitBytes = Math.max(1, Math.floor(deps.config.responseLimitBytes))

  // 事件流：以盘上内容为起点（`prepareChainRun` 已经写了 meta），后续每条都即写即落盘。
  const events: BridgeEvent[] = loadRunEvents(deps.dataRoot, runId) ?? []
  const emit = (event: BridgeEvent): void => {
    appendEvent(deps.dataRoot, runId, event)
    events.push({ ...event, ts: Date.now() } as BridgeEvent)
  }

  const nodeById = new Map<string, ChainNode>()
  for (const node of doc.nodes) nodeById.set(node.id, node)
  const planById = new Map<string, PlanNode>()
  for (const node of plan.nodes) planById.set(node.nodeId, node)

  /* ── dry-run：同一份计划，永不发请求，但落留痕（计划本身就是要被复查的证据）── */
  if (input.dryRun === true) {
    emit({
      event: 'terminal',
      success: true,
      cancelled: false,
      message: `dry-run：计划 ${plan.order.length} 个节点，未发送任何请求`,
    })
    emit({ event: 'result', success: true, businessData: businessDataOf(doc, []) })
    return {
      ok: true,
      runId,
      runDir,
      summary: foldSummary(runId, loadRunEvents(deps.dataRoot, runId) ?? events),
      nodes: [],
      cancelled: false,
    }
  }

  /* ── indegree + 下游表：判据与 topoOrder 同源（两端都在节点集合里）── */
  const idSet = new Set(plan.order)
  const indegree = new Map<string, number>()
  for (const id of plan.order) indegree.set(id, 0)
  const downstream = new Map<string, string[]>()
  for (const pair of dependencyPairs(doc)) {
    if (!idSet.has(pair.from) || !idSet.has(pair.to)) continue
    indegree.set(pair.to, (indegree.get(pair.to) ?? 0) + 1)
    const list = downstream.get(pair.from) ?? []
    if (!list.includes(pair.to)) list.push(pair.to)
    downstream.set(pair.from, list)
  }

  const ready = plan.order.filter((id) => (indegree.get(id) ?? 0) === 0)
  const sortReady = (): void => {
    ready.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
  }
  sortReady()

  /* ── 取消：外部 signal 是唯一入口；自身不主动中止（失败只停调度，不掐在飞请求）── */
  const controller = new AbortController()
  const onAbort = (): void => controller.abort()
  if (input.signal?.aborted === true) controller.abort()
  else input.signal?.addEventListener('abort', onAbort, { once: true })

  const roots = new Map<string, BindingRoot>()
  const results = new Map<string, NodeResult>()
  let failure: { nodeId: string; code: ChainRunErrorCode; message: string } | undefined
  let cancelled = false
  let cancelledMessage: string | undefined

  const markSkipped = (nodeId: string): void => {
    const planNode = planById.get(nodeId) as PlanNode
    if (results.has(nodeId)) return
    results.set(nodeId, {
      nodeId,
      cardId: planNode.cardId,
      method: planNode.method.toUpperCase(),
      url: planNode.urlTemplate,
      status: 'skipped',
      attempts: 0,
      elapsedMs: 0,
      requestDigest: { method: planNode.method.toUpperCase(), url: planNode.urlTemplate, headers: {} },
      bindings: [],
    })
  }

  async function runNode(nodeId: string): Promise<NodeOutcome> {
    const planNode = planById.get(nodeId) as PlanNode
    const card = cards.get(planNode.cardId) as InterfaceCardDoc
    const node = nodeById.get(nodeId) as ChainNode
    const method = planNode.method.toUpperCase()
    const startedAt = Date.now()
    const bindings: BindingRecord[] = []

    const result: NodeResult = {
      nodeId,
      cardId: planNode.cardId,
      method,
      url: planNode.urlTemplate,
      status: 'error',
      attempts: 0,
      elapsedMs: 0,
      requestDigest: { method, url: planNode.urlTemplate, headers: {} },
      bindings,
    }

    // 1) 绑定边求值：上游响应已在 `roots` 里（indegree 保证上游已 done）。
    const provided: Record<string, unknown> = {}
    for (const edge of doc.edges) {
      const to = splitBindingPath(edge.to)
      if (!to || to.nodeId !== nodeId) continue
      if (isInputSlotRef(edge.from)) continue // 槽位不是绑定：由 buildRequest 从 inputs 取值
      const from = splitBindingPath(edge.from)
      if (!from) {
        const message = `绑定边 ${edge.from} → ${edge.to} 的 from 不是合法路径`
        bindings.push({ from: edge.from, to: edge.to, code: 'binding-path-not-found', error: message })
        return failPreRequest(bindings, 'binding-path-not-found', message)
      }
      const root = roots.get(from.nodeId)
      if (root === undefined) {
        // 正常不可达（indegree 已经等到上游 done）；如实报，不猜值。
        const message = `绑定边 ${edge.from} → ${edge.to} 的上游节点 ${from.nodeId} 没有可用响应`
        bindings.push({ from: edge.from, to: edge.to, code: 'binding-path-not-found', error: message })
        return failPreRequest(bindings, 'binding-path-not-found', message)
      }
      // `edge.from` 带节点前缀（`node.body.x`），求值只认字段路径部分。
      const bound = resolveBinding(root, from.fieldPath, edgeTargetType(card, to.fieldPath))
      if (!bound.ok) {
        const code = bindingCodeOf(bound.code)
        const message = `绑定边 ${edge.from} → ${edge.to} 求值失败：${bound.message}`
        bindings.push({ from: edge.from, to: edge.to, code, error: bound.message })
        return failPreRequest(bindings, code, message)
      }
      provided[normalizePath(to.fieldPath)] = bound.value
      bindings.push({ from: edge.from, to: edge.to, valuePreview: previewValue(bound.value) })
    }

    // 2) 构造请求（纯函数）：缺参/类型/模板问题都在这里，且发生在任何网络动作之前。
    const built = buildRequest({ node: planNode, card, baseUrl: plan.baseUrl, provided, inputs })
    if (!built.ok) {
      const message = built.message
      emit({
        event: 'step',
        id: nodeId,
        action: `${method} ${planNode.urlTemplate}`,
        status: 'start',
        data: { card: planNode.cardId },
      })
      return failAfterStart(bindings, built.code, message)
    }

    const request = built.request
    const requestDigest: RequestDigest = {
      method: request.method,
      url: request.url,
      headers: redactHeaders(request.headers),
      ...(request.body === undefined ? {} : { bodyPreview: previewText(request.body) }),
    }
    result.requestDigest = requestDigest
    result.url = request.url

    // 3) start 事件先于请求落盘：请求一旦发出，记录里必须已经有它。
    emit({
      event: 'step',
      id: nodeId,
      action: `${request.method} ${request.url}`,
      status: 'start',
      data: { card: planNode.cardId, attempt: 1, request: requestDigest },
    })
    input.onProgress?.(`▶ ${nodeId}：${request.method} ${request.url}`)

    const outcome = await httpRequest({
      method: request.method,
      url: request.url,
      headers: request.headers,
      ...(request.body === undefined ? {} : { body: request.body }),
      timeoutMs: timeoutOf(node, fallbackTimeoutMs),
      retry: retryOf(node, method),
      limitBytes,
      signal: controller.signal,
    })
    result.attempts = outcome.ok ? outcome.response.attempts : outcome.attempts

    if (!outcome.ok) {
      // 取消优先于其它分类：用户按下取消后，超时/网络错的叙述都不再重要。
      if (outcome.code === 'aborted' || controller.signal.aborted) {
        result.status = 'cancelled'
        result.errorCode = 'cancelled'
        result.error = '已取消：请求在飞行途中被中止'
        result.elapsedMs = Date.now() - startedAt
        results.set(nodeId, result)
        emit({ event: 'step', id: nodeId, status: 'error', elapsed: result.elapsedMs, error: result.error, data: { code: 'cancelled' } })
        return { kind: 'cancelled', message: result.error }
      }
      const code: ChainRunErrorCode =
        outcome.code === 'timeout'
          ? 'node-timeout'
          : outcome.code === 'bad-url'
            ? 'bad-url-template'
            : 'node-network-error'
      result.errorCode = code
      result.error = outcome.message
      result.elapsedMs = Date.now() - startedAt
      results.set(nodeId, result)
      emit({
        event: 'step',
        id: nodeId,
        status: 'error',
        elapsed: result.elapsedMs,
        error: outcome.message,
        data: { code, attempts: outcome.attempts },
      })
      return { kind: 'failed', code, message: `节点 ${nodeId}：${outcome.message}` }
    }

    const response = outcome.response
    const responseDigest: ResponseDigest = {
      status: response.status,
      bytes: response.bytes,
      truncated: response.truncated,
      bodyPreview: previewText(response.bodyText),
    }
    result.httpStatus = response.status
    result.responseDigest = responseDigest
    if (response.truncated) result.truncated = true
    result.elapsedMs = Date.now() - startedAt

    // 4) 非 2xx：先分清「缺凭证」与「其它 HTTP 失败」，两者对用户的下一步完全不同。
    if (response.status < 200 || response.status >= 300) {
      const code: ChainRunErrorCode =
        response.status === 401 || response.status === 403
          ? authRequired(card)
            ? 'node-auth-required'
            : 'node-http-error'
          : 'node-http-error'
      const hint = code === 'node-auth-required'
        ? `HTTP ${response.status}：该卡声明了鉴权（${card.auth}），凭证注入是 R-4 的事；引擎不换票、不重试`
        : `HTTP ${response.status}`
      result.errorCode = code
      result.error = hint
      results.set(nodeId, result)
      emit({ event: 'step', id: nodeId, status: 'error', elapsed: result.elapsedMs, error: hint, data: { code, response: responseDigest } })
      return { kind: 'failed', code, message: `节点 ${nodeId}：${hint}` }
    }

    // 5) 正文被上限截断且下游要读 body：宁可失败也不拿半截 JSON 硬解析。
    const truncatedBody = response.truncated && needsBody(doc, nodeId)
    if (truncatedBody) {
      result.errorCode = 'response-too-large'
      result.error = `响应正文超过 ${limitBytes} 字节上限（已截断），下游要读 body：拒绝拿半截正文解析`
      results.set(nodeId, result)
      emit({
        event: 'step',
        id: nodeId,
        status: 'error',
        elapsed: result.elapsedMs,
        error: result.error,
        data: { code: 'response-too-large', response: responseDigest },
      })
      return { kind: 'failed', code: 'response-too-large', message: `节点 ${nodeId}：${result.error}` }
    }

    // 6) 成功：存响应根（供下游绑定求值）→ 报出参 → step(done)。
    roots.set(nodeId, { body: response.json ?? response.bodyText, status: response.status, headers: response.headers })
    const emitted = collectEmitted(doc, cards, nodeId, roots.get(nodeId) as BindingRoot)
    result.status = 'done'
    results.set(nodeId, result)
    emit({
      event: 'step',
      id: nodeId,
      status: 'done',
      elapsed: result.elapsedMs,
      data: { response: responseDigest, emitted },
    })
    input.onProgress?.(`✔ ${nodeId}：HTTP ${response.status}，${result.elapsedMs}ms`)
    return { kind: 'done' }

    /* ── 局部收口：request 没构造出来的两类失败 ── */
    function failPreRequest(records: BindingRecord[], code: ChainRunErrorCode, message: string): NodeOutcome {
      emit({ event: 'step', id: nodeId, action: `${method} ${planNode.urlTemplate}`, status: 'start', data: { card: planNode.cardId } })
      return failAfterStart(records, code, message)
    }

    function failAfterStart(records: BindingRecord[], code: ChainRunErrorCode, message: string): NodeOutcome {
      result.status = 'error'
      result.errorCode = code
      result.error = message
      result.elapsedMs = Date.now() - startedAt
      result.bindings = records
      results.set(nodeId, result)
      emit({ event: 'step', id: nodeId, status: 'error', elapsed: result.elapsedMs, error: message, data: { code } })
      return { kind: 'failed', code, message: `节点 ${nodeId}：${message}` }
    }
  }

  /* ── 就绪队列主循环 ── */
  const inFlight = new Set<Promise<void>>()
  for (;;) {
    while (failure === undefined && !controller.signal.aborted && ready.length > 0 && inFlight.size < concurrency) {
      const nodeId = ready.shift() as string
      const task: Promise<void> = runNode(nodeId)
        .then((outcome) => {
          if (outcome.kind === 'done') {
            for (const next of downstream.get(nodeId) ?? []) {
              const left = (indegree.get(next) ?? 0) - 1
              indegree.set(next, left)
              if (left === 0 && !results.has(next)) {
                ready.push(next)
                sortReady()
              }
            }
            return
          }
          if (outcome.kind === 'cancelled') {
            cancelled = true
            cancelledMessage = outcome.message
            return
          }
          if (failure === undefined) failure = { nodeId, code: outcome.code, message: outcome.message }
        })
        .finally(() => {
          inFlight.delete(task)
        })
      inFlight.add(task)
    }

    if (inFlight.size === 0) break
    await Promise.race(inFlight)
  }

  // 外部 signal 在循环里不会自己触发任务，兜底一次。
  if (controller.signal.aborted && !cancelled && results.size < plan.order.length) {
    cancelled = true
    cancelledMessage = cancelledMessage ?? '已取消：调度在节点边界停止'
  }

  /* ── 收口：未启动节点标 skipped（不发 step 事件），汇总 terminal + result ── */
  for (const nodeId of plan.order) if (!results.has(nodeId)) markSkipped(nodeId)
  // 防御：没有失败也没有取消、却有节点从没被放行 → 依赖表与拓扑序不一致（正常不可达）。
  // 不把这种情况说成「全部完成」：宁可报一个诚实的错，也不留一条看起来成功的假记录。
  if (failure === undefined && !cancelled) {
    const stranded = plan.order.filter((nodeId) => results.get(nodeId)?.status === 'skipped')
    if (stranded.length > 0) {
      failure = {
        nodeId: stranded[0] as string,
        code: 'cycle',
        message: `调度器没有放行 ${stranded.join('、')}：依赖永远满足不了（拓扑序与依赖表不一致，链可能被绕过工具手改）`,
      }
    }
  }
  const ordered = plan.order.map((nodeId) => results.get(nodeId) as NodeResult)
  const success = failure === undefined && !cancelled
  const failedNode = failure?.nodeId
  const message = terminalMessage(doc, plan, failure, cancelled, cancelledMessage, ordered)

  emit({
    event: 'terminal',
    success,
    cancelled,
    message,
  })
  emit({
    event: 'result',
    success,
    businessData: businessDataOf(doc, ordered, { failedNode, cancelled }),
  })

  input.signal?.removeEventListener('abort', onAbort)

  const finalEvents = loadRunEvents(deps.dataRoot, runId) ?? events
  return {
    ok: true,
    runId,
    runDir,
    summary: foldSummary(runId, finalEvents),
    nodes: ordered,
    ...(failedNode === undefined ? {} : { failedNode }),
    cancelled,
  }
}

/* ================================================================== 结果折叠 */

/** 结果段的业务视图：只放小字段，NodeResult 的摘要留在 step 事件里。 */
function businessDataOf(
  doc: ChainDoc,
  nodes: NodeResult[],
  extra: { failedNode?: string; cancelled?: boolean } = {},
): Record<string, unknown> {
  const completed = nodes.filter((node) => node.status === 'done').map((node) => node.nodeId)
  return {
    chain: { site: doc.meta.site, flow: doc.meta.flow, version: doc.meta.version },
    ...(extra.failedNode === undefined ? {} : { failedNode: extra.failedNode }),
    ...(extra.cancelled === true ? { cancelled: true } : {}),
    completed,
    nodes: nodes.map((node) => ({
      nodeId: node.nodeId,
      status: node.status,
      attempts: node.attempts,
      elapsedMs: node.elapsedMs,
      ...(node.httpStatus === undefined ? {} : { httpStatus: node.httpStatus }),
      ...(node.errorCode === undefined ? {} : { errorCode: node.errorCode }),
    })),
  }
}

/** 终态消息：成功/失败/取消三种叙述，失败时必须指到节点与第几步。 */
function terminalMessage(
  doc: ChainDoc,
  plan: ExecutionPlan,
  failure: { nodeId: string; code: ChainRunErrorCode; message: string } | undefined,
  cancelled: boolean,
  cancelledMessage: string | undefined,
  nodes: NodeResult[],
): string {
  const doneCount = nodes.filter((node) => node.status === 'done').length
  if (failure !== undefined) {
    const step = plan.order.indexOf(failure.nodeId) + 1
    return `链 ${doc.meta.site}/${doc.meta.flow} v${doc.meta.version} 在第 ${step} 步「${failure.nodeId}」失败（${failure.code}）：${failure.message}`
  }
  if (cancelled) {
    return `链 ${doc.meta.site}/${doc.meta.flow} v${doc.meta.version} 已取消：${doneCount}/${plan.order.length} 个节点完成${cancelledMessage === undefined ? '' : `（${cancelledMessage}）`}`
  }
  return `链 ${doc.meta.site}/${doc.meta.flow} v${doc.meta.version} 执行完成：${plan.order.length} 个节点全绿`
}

/* ================================================================== 小工具 */

function bindingCodeOf(code: string): ChainRunErrorCode {
  if (code === 'type-mismatch') return 'binding-type-mismatch'
  if (code === 'null-value') return 'binding-null'
  if (code === 'empty-wildcard') return 'empty-wildcard'
  return 'binding-path-not-found'
}

/** 一个节点的下游绑定目标字段声明类型（决定 `[*]` 解包还是保数组）。 */
function edgeTargetType(card: InterfaceCardDoc, fieldPath: string): string | undefined {
  const key = normalizePath(fieldPath)
  return (card.inputs ?? []).find((field) => normalizePath(field.path) === key)?.type
}

/** 节点出参探测：把能取到的绑定值报进 `emitted`；取不到的不报错（由消费节点报）。 */
function collectEmitted(
  doc: ChainDoc,
  cards: Map<string, InterfaceCardDoc>,
  nodeId: string,
  root: BindingRoot,
): Record<string, unknown> {
  const emitted: Record<string, unknown> = {}
  for (const edge of doc.edges) {
    if (isInputSlotRef(edge.from)) continue
    const from = splitBindingPath(edge.from)
    if (!from || from.nodeId !== nodeId) continue
    const to = splitBindingPath(edge.to)
    const card = to === undefined ? undefined : cards.get(cardOfNode(doc, to.nodeId))
    const bound = resolveBinding(
      root,
      from.fieldPath,
      to === undefined || card === undefined ? undefined : edgeTargetType(card, to.fieldPath),
    )
    if (bound.ok) emitted[edge.from] = bound.value
  }
  return emitted
}

function cardOfNode(doc: ChainDoc, nodeId: string): string {
  return doc.nodes.find((node) => node.id === nodeId)?.card ?? ''
}

/** 下游是否有绑定读 `body.*`（决定「截断能否忍」）。 */
function needsBody(doc: ChainDoc, nodeId: string): boolean {
  for (const edge of doc.edges) {
    if (isInputSlotRef(edge.from)) continue
    const from = splitBindingPath(edge.from)
    if (!from || from.nodeId !== nodeId) continue
    const path = from.fieldPath
    if (path === 'body' || path.startsWith('body.') || path.startsWith('body[')) return true
  }
  return false
}

/** 卡声明了鉴权（非 `none`）才有资格报 `node-auth-required`。 */
function authRequired(card: InterfaceCardDoc): boolean {
  return typeof card.auth === 'string' && card.auth.length > 0 && card.auth !== 'none'
}

/** 节点级超时优先（R-1 预留位），否则用全局缺省。 */
function timeoutOf(node: ChainNode, fallbackMs: number): number {
  const seconds = node.timeoutSeconds
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) * 1000 : fallbackMs
}

/** 只有幂等方法才吃节点级 retry：写方法重试就是重放写请求。 */
function retryOf(node: ChainNode, method: string): number {
  if (!IDEMPOTENT_METHODS.has(method)) return 0
  const raw = node.retry
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0
  return Math.max(0, Math.min(MAX_NODE_RETRY, Math.floor(raw)))
}

/** 正文预览：按字节截前 4 KiB（多字节字符被切断时留替换符，比超限更可接受）。 */
export function previewText(text: string): string {
  const buffer = Buffer.from(text ?? '', 'utf8')
  if (buffer.byteLength <= DIGEST_PREVIEW_BYTES) return text ?? ''
  return buffer.subarray(0, DIGEST_PREVIEW_BYTES).toString('utf8')
}

/** 绑定值预览：标量原样，对象/数组序列化后截断（事件流不做数据仓库）。 */
function previewValue(value: unknown): string {
  if (typeof value === 'string') return value.length <= 512 ? value : `${value.slice(0, 512)}…`
  if (value === null) return 'null'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    const text = JSON.stringify(value)
    return text.length <= 512 ? text : `${text.slice(0, 512)}…`
  } catch {
    return '[不可序列化]'
  }
}

/** 便捷入口：写起点 + 跑完（工具层在需要 job 分段时拆开用）。 */
export async function runChain(deps: ChainRunDeps, input: RunChainInput): Promise<ChainRunResult> {
  return executeChainRun(deps, prepareChainRun(deps, input), input)
}
