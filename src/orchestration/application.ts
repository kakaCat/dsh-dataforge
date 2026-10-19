/**
 * 编排域的应用层：把 IF-1/2/3 的判定与错误折叠收在一处，工具壳（`src/tools.ts`）
 * 只做参数声明与回执渲染。
 *
 * 为什么单独一层而不是塞进工具壳：`src/tools.ts` 的自述纪律是"判定全在 application 层"。
 * 这三个工具的判定不是三道闸那种业务规则，而是「错误码 → 诚实回执」的折叠——
 * 但它同样需要被单测直接打到（不经过 defineTool 的 schema 校验），所以放这里。
 *
 * @module dsh-dataforge/orchestration/application
 */

import { importLibrary, type LibraryError } from '../library/import.js'
import { saveChain } from '../chains/store.js'
import { defaultCardResolver, loadChain, readChainText, listChainVersions, slugOf } from '../chains/store.js'
import type { ChainIssue, ChainDoc, InterfaceCardDoc } from '../chains/schema.js'
import { inputSlotNameOf } from '../chains/schema.js'
import { checkValueType } from '../execute/coverage.js'
import { buildPlan, type ExecutionPlan } from '../execute/plan.js'
import {
  chainExecutionUnavailableReason,
  executeChainRun,
  prepareChainRun,
  type ChainRunConfig,
  type ChainRunResult,
  type NodeResult,
  type ReloginOutcome,
  type ReloginRunner,
  type ReloginSpec,
} from '../execute/run.js'
import { foldSummary, listRunIds, loadRunEvents, readRunRecord } from '../runs/store.js'
import type { RunSummary } from '../shared/types.js'
import type { CredentialProvider } from '../execute/credentials.js'
import { cookieHeaderFromSetCookies, cookieNamesOf } from '../execute/credentials.js'
import { persistCookies } from '../capture/credential-store.js'
import { createReloginThrottle } from '../execute/throttle.js'
import { extractJobId, ownerOf } from '../application.js'
import { exportRunArtifacts } from '../datasets/export.js'

/**
 * R-4 M3：跨运行换票单飞。key = 主链 origin + 登录链 site/flow。
 *
 * M2 的单飞只在一条 run 内；这里提到进程级：同一站点同一登录链被并发运行时，
 * 只打一次登录接口，其余运行等待并共享结果（避免账号锁定与握手风暴）。
 * 失败不缓存——settle 后清理，下一次触发重新登录。
 */
const reloginThrottle = createReloginThrottle()

export type OrchestrationDeps = {
  /** 采集库 SQLite 路径（导入侧只读打开，绝不建表/写事件）。 */
  captureDbPath: string
  /** 工作区根解析：与流程发现同一套（session cwd → process.cwd()）。 */
  resolveWorkspaceRoot: (exec: unknown) => Promise<string | undefined>
}

/**
 * 链执行工具的依赖：在编排域依赖之上加「运行留痕根 + 执行面配置 + jobs 注入缝」。
 *
 * 刻意不并进 `OrchestrationDeps`：读写链与导库不需要执行配置，两个工具面各自只拿
 * 自己真正用到的东西，测试也不用为了读链去伪造一套执行配置。
 */
export type ChainRunToolDeps = OrchestrationDeps & {
  /** 运行留痕根（`config.dataRoot`；链运行与流程运行共用 `runs/`）。 */
  dataRoot: string
  /** 执行面配置（开关、超时、并发、正文上限、前台兜底超时）。 */
  chain: ChainRunConfig & { foregroundTimeoutSeconds: number }
  /** ctx.jobs 服务（可能 undefined —— 诚实降级前台）。 */
  resolveJobs: () => unknown
  /**
   * R-4 M1：凭证提供者。缺席 = 不注入（R-3 行为）；
   * 装配处（`index.ts`）把采集库只读适配器注进来，工具壳不认识 SQLite。
   */
  credentials?: CredentialProvider
  /**
   * R-4 M3：换票结果持久化文件（`dataRoot/credentials/cookies.json`）。
   * 缺省不落盘；装配处按 `config.chainCredentialPersistence` 决定是否给。
   */
  credentialStorePath?: string
  /** UI 验收执行器（装配处注入；缺席时 verify 如实记录未执行，不阻断主链）。 */
  verifyUi?: (request: ChainVerifyRequest) => Promise<ChainVerifyCallbackResult>
}

export type ChainVerifyRequest = {
  site: string
  flow: string
  version?: number
  inputs: Record<string, string>
}

export type ChainVerifyPlanValue = {
  site: string
  flow: string
  version?: number
  when: 'onSuccess' | 'onFailure' | 'always'
}

export type ChainVerifyCallbackResult = {
  runId?: string
  success?: boolean
  status?: string
  screenshot?: string
  message?: string
  skipped?: string
}

export type ChainVerifyResultValue = ChainVerifyPlanValue & {
  runId?: string
  success?: boolean
  status?: string
  screenshot?: string
  /** verify 的 UI run 自动导出后的产物（dataset/report）。 */
  datasetPath?: string
  reportPath?: string
  message?: string
  skipped?: string
}

/** 逐条问题时给模型看的行：`nodes[0]: reason`。 */
function issueLines(issues: ChainIssue[]): string[] {
  return issues.map((issue) => `${issue.target}：${issue.reason}`)
}

function toChainIssues(issues: ChainIssue[]): Array<{ target: string; code: string; reason: string }> {
  return issues.map((issue) => ({ target: issue.target, code: issue.code, reason: issue.reason }))
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isLibraryError(error: unknown): error is LibraryError {
  return error instanceof Error && typeof (error as { code?: unknown }).code === 'string' && Array.isArray((error as { hints?: unknown }).hints)
}

// ────────────────────────────────────────────────
// IF-1 dataforge_library_import
// ────────────────────────────────────────────────

export type ImportLibraryToolValue = {
  ok: boolean
  /** 失败码：no-capture-data / capture-unreadable / library-unavailable。 */
  code?: string
  message?: string
  hints?: string[]
  imported?: number
  merged?: number
  unchanged?: number
  skipped?: number
  /** 本次触达的卡 ID（升序）。 */
  cardIds?: string[]
  /** 逐张坏卡的中文原因。 */
  skippedReasons?: string[]
  captures?: string[]
  libraryRoot?: string
}

export type ImportLibraryToolArgs = { captureId?: string }

/**
 * 导入接口库。失败一律折成回执（**不抛**）：无采集数据是常态空态，agent 该据此
 * 引导用户去采集，而不是拿到一个异常。
 */
export async function importLibraryForTool(
  deps: OrchestrationDeps,
  exec: unknown,
  args: ImportLibraryToolArgs,
): Promise<ImportLibraryToolValue> {
  let workspaceRoot: string
  try {
    workspaceRoot = (await deps.resolveWorkspaceRoot(exec)) ?? process.cwd()
  } catch (error) {
    return { ok: false, code: 'library-unavailable', message: `解析工作区根失败：${messageOf(error)}`, hints: [] }
  }
  try {
    const result = importLibrary({
      workspaceRoot,
      captureDbPath: deps.captureDbPath,
      ...(args.captureId === undefined ? {} : { captureId: args.captureId }),
    })
    return {
      ok: true,
      imported: result.imported,
      merged: result.merged,
      unchanged: result.unchanged,
      skipped: result.skipped,
      cardIds: result.cardIds,
      skippedReasons: result.skippedDetails.map((item) => `${item.mergeKey}：${item.reason}`),
      captures: result.captureIds,
      libraryRoot: result.libraryRoot,
    }
  } catch (error) {
    if (isLibraryError(error)) {
      return { ok: false, code: error.code, message: error.message, hints: error.hints }
    }
    return { ok: false, code: 'library-unavailable', message: `导入接口库失败：${messageOf(error)}`, hints: [] }
  }
}

// ────────────────────────────────────────────────
// IF-2 dataforge_chain_upsert
// ────────────────────────────────────────────────

export type ChainUpsertToolValue = {
  ok: boolean
  code?: string
  message?: string
  version?: number
  path?: string
  /** 校验不过时逐条问题（指向 nodes[i] / edges[j]）。 */
  issues?: Array<{ target: string; code: string; reason: string }>
  /** 通过但值得提醒（例如常量里疑似凭证）。 */
  warnings?: string[]
}

export type ChainUpsertToolArgs = { site: string; flow: string; chainYaml: string }

/** 唯一的链写入口：先 schema、再语义校验，全过才落盘为新版本（不存在部分写入）。 */
export async function upsertChainForTool(
  deps: OrchestrationDeps,
  exec: unknown,
  args: ChainUpsertToolArgs,
): Promise<ChainUpsertToolValue> {
  const workspaceRoot = (await deps.resolveWorkspaceRoot(exec)) ?? process.cwd()
  if (args.site.trim() === '' || args.flow.trim() === '') {
    return { ok: false, code: 'invalid-chain', message: 'site 与 flow 不能为空：链按「站点 / 流程」归档' }
  }
  try {
    // 来源标注由写入方声明：这是 agent 会话保存的版本（画布保存走面板路由，标 canvas）。
    const saved = saveChain(workspaceRoot, args.chainYaml, { source: 'agent' })
    if (!saved.ok) {
      return {
        ok: false,
        code: saved.issues.some((issue) => issue.code === 'card-not-imported') ? 'card-not-imported' : 'invalid-chain',
        message: saved.issues.some((issue) => issue.code === 'card-not-imported')
          ? '链引用的接口卡不在项目接口库：先跑 dataforge_library_import'
          : `链未通过校验（${saved.issues.length} 条）：修好再提交，没有落盘`,
        issues: toChainIssues(saved.issues),
      }
    }
    return {
      ok: true,
      version: saved.version,
      path: saved.path,
      ...(saved.warnings.length === 0 ? {} : { warnings: issueLines(saved.warnings) }),
    }
  } catch (error) {
    return { ok: false, code: 'invalid-chain', message: `落盘链失败：${messageOf(error)}` }
  }
}

// ────────────────────────────────────────────────
// IF-3 dataforge_chain_get
// ────────────────────────────────────────────────

export type ChainGetToolValue = {
  ok: boolean
  code?: string
  message?: string
  /** 链 YAML 全文：导出即原文，天然零凭证。 */
  chainYaml?: string
  version?: number
  path?: string
  /** 可用版本（升序）：chain-not-found 时调用方据此重试或放弃。 */
  versions?: number[]
  issues?: Array<{ target: string; code: string; reason: string }>
}

export type ChainGetToolArgs = { site: string; flow: string; version?: number; export?: boolean }

/**
 * 读链。`export: true` 走原文读取（不校验，坏文件也照原样导出，便于人工抢救）；
 * 缺省走校验读取——文件被手改坏就如实报 invalid-chain 并提示可回读旧版本。
 */
export async function getChainForTool(
  deps: OrchestrationDeps,
  exec: unknown,
  args: ChainGetToolArgs,
): Promise<ChainGetToolValue> {
  const workspaceRoot = (await deps.resolveWorkspaceRoot(exec)) ?? process.cwd()
  if (args.export === true) {
    const found = readChainText(workspaceRoot, args.site, args.flow, args.version)
    if (found === undefined) {
      return {
        ok: false,
        code: 'chain-not-found',
        message: `没有找到 ${args.site} / ${args.flow} 的链${args.version === undefined ? '' : ` v${args.version}`}`,
        versions: listChainVersions(workspaceRoot, args.site, args.flow),
      }
    }
    return { ok: true, chainYaml: found.text, version: found.version, path: found.path }
  }

  const loaded = loadChain(workspaceRoot, args.site, args.flow, {
    ...(args.version === undefined ? {} : { version: args.version }),
  })
  if (!loaded.ok) {
    return {
      ok: false,
      code: loaded.code,
      message: loaded.message,
      versions: loaded.availableVersions,
      ...('issues' in loaded && loaded.issues !== undefined ? { issues: toChainIssues(loaded.issues) } : {}),
      ...('path' in loaded && loaded.path !== undefined ? { path: loaded.path } : {}),
    }
  }
  return {
    ok: true,
    chainYaml: loaded.text,
    version: loaded.version,
    path: loaded.path,
    versions: listChainVersions(workspaceRoot, args.site, args.flow),
  }
}

// ────────────────────────────────────────────────
// IF-1 dataforge_chain_run
// ────────────────────────────────────────────────

/** 计划卡的结构化形态：确认前给用户/模型看的就是这一份。 */
export type ChainRunPlanValue = {
  order: string[]
  totalNodes: number
  baseUrl: string
  /** 目标 host（确认卡必须写明请求会打到哪个站点）。 */
  host: string
  /** 写类节点（非 GET/HEAD）：这些是「已发出就无法撤销」的部分。 */
  writeNodes: string[]
  nodes: Array<{ nodeId: string; method: string; url: string; dependsOn: string[]; writes: boolean }>
  notices: string[]
  /** 声明式 cleanup：进入主链计划卡一起确认，主链结束后执行。 */
  cleanup?: ChainCleanupPlanValue
  /** 声明式 UI 验收：进入主链计划卡一起确认，主链成功/失败后执行。 */
  verify?: ChainVerifyPlanValue
}

export type ChainCleanupPlanValue = {
  site: string
  flow: string
  version?: number
  when: 'onFailure' | 'always'
  nodeCount: number
  writeCount: number
}

export type ChainCleanupResultValue = ChainCleanupPlanValue & {
  runId?: string
  status?: string
  message?: string
  skipped?: string
}

export type ChainRunNodeValue = {
  nodeId: string
  status: string
  method: string
  url: string
  httpStatus?: number
  attempts: number
  elapsedMs: number
  errorCode?: string
  error?: string
  /** R-4 M2：这一节点是否换过票、结果如何（不含值）。 */
  relogin?: {
    attempted: boolean
    success: boolean
    code?: string
    message?: string
    runId?: string
    cookieNames?: string[]
    persisted?: number
  }
}

export type ChainRunToolValue = {
  ok: boolean
  /** 是否真的开始跑（confirm-required / 预检失败都是 false）。 */
  accepted: boolean
  gate?: 'started' | 'confirm-required' | 'blocked'
  code?: string
  message?: string
  kind?: 'background' | 'foreground' | 'dry-run'
  jobId?: string
  runId?: string
  runDir?: string
  degradedNotice?: string
  plan?: ChainRunPlanValue
  /** 给模型看的确认卡（人话版计划）。 */
  card?: string
  /** 预检静态缺参：逐条「节点 · 卡字段路径 · 类型」。 */
  gaps?: Array<{ nodeId: string; path: string; type: string; target: string }>
  cycle?: string[]
  /** chain-not-found / invalid-chain 时的可用版本。 */
  versions?: number[]
  issues?: Array<{ target: string; code: string; reason: string }>
  nodes?: ChainRunNodeValue[]
  failedNode?: string
  summary?: RunSummary
  /** 主链结束后的 cleanup 结果（后台路径在 job detail 里）。 */
  cleanup?: ChainCleanupResultValue
  /** 主链结束后的 UI 验收结果（后台路径在 job detail 里）。 */
  verify?: ChainVerifyResultValue
}

export type ChainRunToolArgs = {
  site: string
  flow: string
  version?: number
  inputs?: Record<string, unknown>
  baseUrl?: string
  concurrency?: number
  dryRun?: boolean
  confirm?: boolean
  /**
   * R-4 M2：401 时自动执行的登录链。
   * `inputs` 是登录链自己的槽位值（账号/密码），只在内存里过手，不写运行记录。
   */
  relogin?: ReloginSpec
}

/** 链执行节点的卡：逐 cardId 解析（默认解析器直读接口库，单次调用内缓存）。 */
/** 逐 cardId 解析卡（probe/整链共用；单次调用内缓存）。 */
export function cardsForChain(workspaceRoot: string, doc: ChainDoc): Map<string, InterfaceCardDoc> {
  const resolve = defaultCardResolver(workspaceRoot)
  const cards = new Map<string, InterfaceCardDoc>()
  for (const node of doc.nodes) {
    if (typeof node.card !== 'string' || node.card.length === 0) continue
    if (cards.has(node.card)) continue
    const card = resolve(node.card)
    if (card !== undefined) cards.set(node.card, card)
  }
  return cards
}

/**
 * 槽位入参校验（`inputs-invalid`）：键必须是链文件声明过的槽位，值要符合声明类型。
 *
 * 与 `missing-params` 分工明确——这里管「你给了不该给的值」，`buildPlan` 管
 * 「该给的值没给」。两者都在第一个请求之前，不会发半截请求出去。
 */
function validateChainInputs(
  doc: ChainDoc,
  inputs: Record<string, unknown> | undefined,
): { ok: true } | { ok: false; message: string } {
  if (inputs === undefined) return { ok: true }
  const declared = new Map(doc.inputs.map((input) => [input.name, input]))
  for (const [name, value] of Object.entries(inputs)) {
    const slot = declared.get(name)
    if (slot === undefined) {
      const known = doc.inputs.map((input) => input.name)
      return {
        ok: false,
        message: `未知槽位「${name}」：本链只声明了 ${known.length === 0 ? '（没有槽位）' : known.join('、')}；槽位必须先写进链文件的 inputs 段`,
      }
    }
    const problem = checkValueType(name, slot.type, value)
    if (problem !== undefined) return { ok: false, message: `槽位值不符合声明类型：${problem}` }
  }
  return { ok: true }
}

export type ChainBaseCandidate = { ok: true; baseUrl?: string } | { ok: false; message: string }

/**
 * baseUrl 候选解析：工具入参 > 卡 `sources[].pages[]` 的 origin。
 *
 * 卡的 `identity.urlTemplate` 是采集期归一化后的相对路径，不含 origin，所以这一步
 * 不能省；多来源跨 origin 视为冲突（宁可拒跑也不打到错站点）。
 * 一个候选都没有时不在这里报错——交给 `buildPlan` 统一给 `base-url-unresolved`。
 */
export function resolveChainBaseUrl(
  doc: ChainDoc,
  cards: Map<string, InterfaceCardDoc>,
  explicit: string | undefined,
): ChainBaseCandidate {
  const raw = typeof explicit === 'string' ? explicit.trim() : ''
  if (raw.length > 0) return { ok: true, baseUrl: raw }

  const origins = new Set<string>()
  for (const node of doc.nodes) {
    const card = typeof node.card === 'string' ? cards.get(node.card) : undefined
    for (const source of card?.sources ?? []) {
      for (const page of source.pages ?? []) {
        const origin = originOf(page)
        if (origin !== undefined) origins.add(origin)
      }
    }
  }
  if (origins.size === 0) return { ok: true }
  if (origins.size > 1) {
    return {
      ok: false,
      message: `卡来源跨多个 origin（${[...origins].join('、')}）：显式传 baseUrl 指定目标站点，不让引擎猜`,
    }
  }
  return { ok: true, baseUrl: [...origins][0] }
}

function originOf(page: string): string | undefined {
  try {
    const url = new URL(page)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : undefined
  } catch {
    return undefined
  }
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl
  }
}

function planValueOf(plan: ExecutionPlan, notices: string[], cleanup?: ChainCleanupPlanValue, verify?: ChainVerifyPlanValue): ChainRunPlanValue {
  return {
    order: [...plan.order],
    totalNodes: plan.totalNodes,
    baseUrl: plan.baseUrl,
    host: hostOf(plan.baseUrl),
    writeNodes: [...plan.writeNodes],
    nodes: plan.nodes.map((node) => ({
      nodeId: node.nodeId,
      method: node.method,
      url: node.urlTemplate,
      dependsOn: [...node.dependsOn],
      writes: plan.writeNodes.includes(node.nodeId),
    })),
    notices: [...notices],
    ...(cleanup === undefined ? {} : { cleanup }),
    ...(verify === undefined ? {} : { verify }),
  }
}

/** 确认卡：拓扑序 + 每节点方法/URL 骨架 + 写方法清单 + 目标 host。 */
function chainConfirmationCard(doc: ChainDoc, plan: ExecutionPlan, notices: string[], cleanup?: ChainCleanupPlanValue, verify?: ChainVerifyPlanValue): string {
  const lines = plan.order.map((nodeId, index) => {
    const node = plan.nodes.find((candidate) => candidate.nodeId === nodeId) as ExecutionPlan['nodes'][number]
    const write = plan.writeNodes.includes(nodeId) ? ' ✍️写' : ''
    return `${index + 1}. ${nodeId}${write}：${node.method} ${node.urlTemplate}`
  })
  const writes = plan.writeNodes.length === 0
    ? '写类节点：无（整链只读）'
    : `写类节点：${plan.writeNodes.join('、')}（已发出的写请求无法撤销）`
  const note = notices.length === 0 ? '' : `\n提醒：${notices.join('；')}`
  const cleanupLine = cleanup === undefined ? '' : `\n清理：${cleanup.site} / ${cleanup.flow}${cleanup.version === undefined ? '' : ` v${cleanup.version}`}（${cleanup.when}，${cleanup.nodeCount} 节点，写 ${cleanup.writeCount} 个）`
  const verifyLine = verify === undefined ? '' : `\n验收：${verify.site} / ${verify.flow}${verify.version === undefined ? '' : ` v${verify.version}`}（${verify.when}）`
  return [
    `🧭 执行计划（${doc.meta.site} / ${doc.meta.flow} v${doc.meta.version}）→ ${hostOf(plan.baseUrl)}`,
    ...lines,
    writes,
    `确认后带 confirm=true 重调即真跑；只想留档用 dry_run=true（永不发请求）。${note}${cleanupLine}${verifyLine}`,
  ].join('\n')
}

/** cleanup 计划摘要：只读链/卡，不预检执行，供确认卡展示。 */
function cleanupPlanOf(
  workspaceRoot: string,
  doc: ChainDoc,
): { ok: true; value?: ChainCleanupPlanValue } | { ok: false; message: string } {
  if (doc.cleanup === undefined) return { ok: true }
  const loaded = loadChain(workspaceRoot, doc.cleanup.chain.site, doc.cleanup.chain.flow, {
    ...(doc.cleanup.chain.version === undefined ? {} : { version: doc.cleanup.chain.version }),
  })
  if (!loaded.ok) {
    return { ok: false, message: `cleanup 链不可用：${loaded.message}` }
  }
  const cleanupCards = cardsForChain(workspaceRoot, loaded.doc)
  let writeCount = 0
  for (const node of loaded.doc.nodes) {
    const card = node.card === undefined ? undefined : cleanupCards.get(node.card)
    if (card !== undefined && card.identity.method !== 'GET' && card.identity.method !== 'HEAD') writeCount += 1
  }
  return {
    ok: true,
    value: {
      site: loaded.doc.meta.site,
      flow: loaded.doc.meta.flow,
      version: loaded.doc.meta.version,
      when: doc.cleanup.when,
      nodeCount: loaded.doc.nodes.length,
      writeCount,
    },
  }
}

function valueAtPath(root: unknown, path: string): unknown {
  const clean = path.replace(/^\$\.?/, '')
  const tokens: Array<string | number> = []
  for (const part of clean.split('.')) {
    for (const match of part.matchAll(/([^[\]]+)|\[(\d+)\]/g)) {
      if (match[1] !== undefined && match[1] !== '') tokens.push(match[1])
      else if (match[2] !== undefined) tokens.push(Number(match[2]))
    }
  }
  let current = root
  for (const token of tokens) {
    if (typeof token === 'number') {
      if (!Array.isArray(current) || token < 0 || token >= current.length) return undefined
      current = current[token]
    } else {
      if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined
      current = (current as Record<string, unknown>)[token]
    }
  }
  return current
}

function shouldRunCleanup(doc: ChainDoc, summary: RunSummary): boolean {
  if (doc.cleanup === undefined) return false
  return doc.cleanup.when === 'always' || summary.status === 'failed'
}

function resolveBoundInputs(
  templates: Record<string, string> | undefined,
  mainInputs: Record<string, unknown>,
  summary: RunSummary,
): { ok: true; inputs: Record<string, unknown> } | { ok: false; missing: string } {
  const inputs: Record<string, unknown> = {}
  for (const [key, template] of Object.entries(templates ?? {})) {
    if (template.startsWith('$inputs.')) {
      const slot = template.slice('$inputs.'.length)
      if (!(slot in mainInputs)) return { ok: false, missing: template }
      inputs[key] = mainInputs[slot]
      continue
    }
    if (template.startsWith('$result.outputs.')) {
      const rest = template.slice('$result.outputs.'.length)
      const dot = rest.indexOf('.')
      const nodeId = dot < 0 ? rest : rest.slice(0, dot)
      const fieldPath = dot < 0 ? '' : rest.slice(dot + 1)
      const outputs = summary.businessData?.['outputs']
      const nodeOutputs = outputs !== null && typeof outputs === 'object' && !Array.isArray(outputs)
        ? (outputs as Record<string, unknown>)[nodeId]
        : undefined
      const direct = nodeOutputs !== null && typeof nodeOutputs === 'object' && !Array.isArray(nodeOutputs)
        ? (nodeOutputs as Record<string, unknown>)[fieldPath]
        : undefined
      const value = direct !== undefined ? direct : valueAtPath(nodeOutputs, fieldPath)
      if (value === undefined) return { ok: false, missing: template }
      inputs[key] = value
      continue
    }
    if (template.startsWith('$result.')) {
      const value = valueAtPath(summary.businessData, template.slice('$result.'.length))
      if (value === undefined) return { ok: false, missing: template }
      inputs[key] = value
      continue
    }
    inputs[key] = template
  }
  return { ok: true, inputs }
}

function cleanupInputsOf(doc: ChainDoc, mainInputs: Record<string, unknown>, summary: RunSummary) {
  return resolveBoundInputs(doc.cleanup?.inputs, mainInputs, summary)
}

function verifyInputsOf(doc: ChainDoc, mainInputs: Record<string, unknown>, summary: RunSummary) {
  return resolveBoundInputs(doc.verify?.inputs, mainInputs, summary)
}

function verifyPlanOf(doc: ChainDoc): ChainVerifyPlanValue | undefined {
  if (doc.verify === undefined) return undefined
  return {
    site: doc.verify.ui.site,
    flow: doc.verify.ui.flow,
    ...(doc.verify.ui.version === undefined ? {} : { version: doc.verify.ui.version }),
    when: doc.verify.when,
  }
}

function shouldRunVerify(doc: ChainDoc, summary: RunSummary): boolean {
  if (doc.verify === undefined) return false
  if (doc.verify.when === 'always') return true
  if (doc.verify.when === 'onSuccess') return summary.status === 'completed'
  return summary.status === 'failed'
}

/** 主链结束后执行 UI 验收；失败只返回错误信息，不覆盖主链结果。 */
async function runVerifyForTool(
  deps: ChainRunToolDeps,
  doc: ChainDoc,
  summary: RunSummary,
  mainInputs: Record<string, unknown>,
): Promise<ChainVerifyResultValue | undefined> {
  const base = verifyPlanOf(doc)
  if (base === undefined || !shouldRunVerify(doc, summary)) return undefined
  const resolved = verifyInputsOf(doc, mainInputs, summary)
  if (!resolved.ok) return { ...base, skipped: `缺 UI 验收入参 ${resolved.missing}（主链结果/输入里找不到）` }
  if (deps.verifyUi === undefined) return { ...base, skipped: '未装配 UI 验收执行器（uiTestEnabled / verifyUi）' }
  try {
    const result = await deps.verifyUi({
      site: base.site,
      flow: base.flow,
      ...(base.version === undefined ? {} : { version: base.version }),
      inputs: Object.fromEntries(Object.entries(resolved.inputs).map(([key, value]) => [key, String(value)])),
    })
    const merged = { ...base, ...result }
    if (merged.runId !== undefined) {
      const exported = exportRunArtifacts(deps.dataRoot, merged.runId)
      if (exported.ok) return { ...merged, datasetPath: exported.datasetPath, reportPath: exported.reportPath }
    }
    return merged
  } catch (error) {
    return { ...base, message: `UI 验收执行失败：${messageOf(error)}` }
  }
}

/** 主链结束后执行 cleanup；失败只返回错误信息，不覆盖主链结果。 */
async function runCleanupForTool(
  deps: ChainRunToolDeps,
  workspaceRoot: string,
  doc: ChainDoc,
  summary: RunSummary,
  mainInputs: Record<string, unknown>,
): Promise<ChainCleanupResultValue | undefined> {
  if (doc.cleanup === undefined || !shouldRunCleanup(doc, summary)) return undefined
  const planInfo = cleanupPlanOf(workspaceRoot, doc)
  if (!planInfo.ok || planInfo.value === undefined) {
    return { site: doc.cleanup.chain.site, flow: doc.cleanup.chain.flow, when: doc.cleanup.when, nodeCount: 0, writeCount: 0, message: planInfo.ok ? 'cleanup 链不可用' : planInfo.message }
  }
  const base = planInfo.value
  const resolved = cleanupInputsOf(doc, mainInputs, summary)
  if (!resolved.ok) {
    return { ...base, skipped: `缺 cleanup 入参 ${resolved.missing}（主链结果/输入里找不到）` }
  }
  const loaded = loadChain(workspaceRoot, base.site, base.flow, {
    ...(base.version === undefined ? {} : { version: base.version }),
  })
  if (!loaded.ok) return { ...base, message: `cleanup 链不可用：${loaded.message}` }
  const cards = cardsForChain(workspaceRoot, loaded.doc)
  const inputCheck = validateChainInputs(loaded.doc, resolved.inputs)
  if (!inputCheck.ok) return { ...base, message: inputCheck.message }
  const baseUrl = resolveChainBaseUrl(loaded.doc, cards, undefined)
  const planned = buildPlan(loaded.doc, cards, resolved.inputs, baseUrl.ok ? baseUrl.baseUrl : undefined)
  if (!planned.ok) {
    return { ...base, message: planned.code === 'base-url-unresolved' && !baseUrl.ok ? baseUrl.message : planned.message }
  }
  try {
    const runInput = {
      doc: loaded.doc,
      cards,
      plan: planned.plan,
      inputs: resolved.inputs,
      baseUrl: planned.plan.baseUrl,
      chainPath: chainPathForRecord(workspaceRoot, loaded.path),
      ...(deps.credentials === undefined ? {} : { credentials: deps.credentials }),
    }
    const prepared = prepareChainRun({ dataRoot: deps.dataRoot, config: deps.chain }, runInput)
    const run = await executeChainRun({ dataRoot: deps.dataRoot, config: deps.chain }, prepared, runInput)
    return {
      ...base,
      runId: prepared.runId,
      ...(run.ok ? { status: run.summary.status } : { message: run.message }),
    }
  } catch (error) {
    return { ...base, message: `cleanup 执行失败：${messageOf(error)}` }
  }
}

/** 链文件路径：工作区内用相对路径（便于回看与迁移），越界则保留绝对路径。 */
function chainPathForRecord(workspaceRoot: string, absolutePath: string): string {
  const base = workspaceRoot.replace(/\/+$/, '')
  return absolutePath.startsWith(`${base}/`) ? absolutePath.slice(base.length + 1) : absolutePath
}

function compactNodes(nodes: NodeResult[]): ChainRunNodeValue[] {
  return nodes.map((node) => ({
    nodeId: node.nodeId,
    status: node.status,
    method: node.method,
    url: node.url,
    ...(node.httpStatus === undefined ? {} : { httpStatus: node.httpStatus }),
    attempts: node.attempts,
    elapsedMs: node.elapsedMs,
    ...(node.errorCode === undefined ? {} : { errorCode: node.errorCode }),
    ...(node.error === undefined ? {} : { error: node.error }),
    ...(node.relogin === undefined ? {} : { relogin: node.relogin }),
  }))
}

function jobStatusOf(result: ChainRunResult, cancelled: boolean): 'completed' | 'killed' | 'failed' {
  if (!result.ok) return 'failed'
  if (cancelled || result.cancelled) return 'killed'
  return result.summary.status === 'completed' ? 'completed' : 'failed'
}

function jobDetailOf(result: ChainRunResult): string {
  if (!result.ok) return `${result.code}：${result.message}`
  return result.summary.message ?? `${result.summary.stepsDone}/${result.summary.totalSteps} 步`
}

/** jobs 服务的最小结构投影（与 `src/application.ts` 同一用途，声明在本地避免跨域耦合）。 */
interface ChainJobsLike {
  start?: (spec: ChainJobsSpec) => unknown
}

interface ChainJobsSpec {
  kind: string
  label: string
  owner?: string
  outputLimitBytes?: number
  run: (job: ChainJobsJobHandle) => ChainJobsHooks
}

interface ChainJobsJobHandle {
  readonly id: string
  append(text: string, options?: { channel?: 'stdout' | 'stderr' | 'log' }): void
  updateProgress(line: string): void
}

interface ChainJobsHooks {
  cancel: (reason?: string) => void
  done: Promise<{ status: 'completed' | 'killed' | 'failed'; detail?: string; result?: string }>
}

/**
 * R-4 M2：构造「执行登录链」的函数，交给执行器在 401 时调用。
 *
 * 登录链走与主链完全相同的加载/校验/执行路径；差异只有三点：
 *   1. 敏感模式（参数/正文/出参都不落值）；
 *   2. 不注入旧凭证、不再递归换票（避免 401 套 401）；
 *   3. 只把响应里的原始 `set-cookie` 收集成内存 jar 交回主链。
 */
function createReloginRunner(
  deps: ChainRunToolDeps,
  workspaceRoot: string,
  expectedBaseUrl: string,
): ReloginRunner {
  return async (spec: ReloginSpec, signal: AbortSignal): Promise<ReloginOutcome> => {
    // R-4 M3：跨运行单飞——同一站点的登录链并发触发只执行一次。
    // key 里带主链 origin：不同站点的同名登录链不会被误合并。
    const throttleKey = `${originOf(expectedBaseUrl) ?? 'unknown'}|${spec.site}/${spec.flow}`
    return reloginThrottle.run(throttleKey, () => reloginOnce(deps, workspaceRoot, expectedBaseUrl, spec, signal))
  }
}

/** 真正执行一条登录链（单飞的实际负载；同一时刻同 key 只有一个在飞）。 */
async function reloginOnce(
  deps: ChainRunToolDeps,
  workspaceRoot: string,
  expectedBaseUrl: string,
  spec: ReloginSpec,
  signal: AbortSignal,
): Promise<ReloginOutcome> {
  if (spec.site.trim() === '' || spec.flow.trim() === '') {
    return { ok: false, code: 'relogin-unavailable', message: '登录链的 site / flow 不能为空' }
  }
  const loaded = loadChain(workspaceRoot, spec.site, spec.flow, {
    ...(spec.version === undefined ? {} : { version: spec.version }),
  })
  if (!loaded.ok) {
    return { ok: false, code: 'relogin-unavailable', message: `登录链不可用：${loaded.message}` }
  }
  const doc = loaded.doc
  if (doc.kind !== 'interface-chain') {
    return { ok: false, code: 'relogin-unavailable', message: `登录链必须是 interface-chain（当前 ${doc.kind}）` }
  }
  const cards = cardsForChain(workspaceRoot, doc)
  const inputCheck = validateChainInputs(doc, spec.inputs)
  if (!inputCheck.ok) {
    return { ok: false, code: 'relogin-unavailable', message: `登录链入参不合法：${inputCheck.message}` }
  }
  const base = resolveChainBaseUrl(doc, cards, spec.baseUrl)
  if (!base.ok) {
    return { ok: false, code: 'relogin-unavailable', message: `登录链 baseUrl 无法确定：${base.message}` }
  }
  const planned = buildPlan(doc, cards, spec.inputs ?? {}, base.baseUrl)
  if (!planned.ok) {
    return { ok: false, code: 'relogin-unavailable', message: `登录链不可执行：${planned.message}` }
  }

  // 安全边界：登录链与主链必须同源，否则登录链下发的 cookie 会被带去另一个站点。
  const expectedOrigin = originOf(expectedBaseUrl)
  const loginOrigin = originOf(planned.plan.baseUrl)
  if (expectedOrigin !== undefined && loginOrigin !== undefined && expectedOrigin !== loginOrigin) {
    return {
      ok: false,
      code: 'relogin-unavailable',
      message: `登录链与主链不同源（登录 ${loginOrigin} / 主链 ${expectedOrigin}）：拒绝跨站复用凭证`,
    }
  }

  const cookies: string[] = []
  const chainDeps = { dataRoot: deps.dataRoot, config: deps.chain }
  const runInput = {
    doc,
    cards,
    plan: planned.plan,
    inputs: spec.inputs ?? {},
    baseUrl: planned.plan.baseUrl,
    chainPath: chainPathForRecord(workspaceRoot, loaded.path),
    sensitive: true,
    redactParams: true,
    onSetCookies: (values: string[]) => {
      for (const value of values) cookies.push(value)
    },
  }
  const prepared = prepareChainRun(chainDeps, runInput)
  const result = await executeChainRun(chainDeps, prepared, { ...runInput, signal })
  if (!result.ok) {
    return { ok: false, code: 'relogin-failed', message: result.message, runId: prepared.runId }
  }
  if (result.summary.status !== 'completed') {
    return {
      ok: false,
      code: 'relogin-failed',
      message: result.summary.message ?? `登录链未完成（${result.summary.status}）`,
      runId: prepared.runId,
    }
  }
  const cookieHeader = cookieHeaderFromSetCookies(cookies)
  if (cookieHeader === undefined) {
    return {
      ok: false,
      code: 'relogin-failed',
      message: '登录链执行完成但没有下发可用的 set-cookie（登录接口可能不是 cookie 型）',
      runId: prepared.runId,
    }
  }
  // R-4 M3：换票结果落本地 jar（0600，按 origin）。落盘失败不打断当前链。
  const persisted =
    deps.credentialStorePath !== undefined && expectedOrigin !== undefined
      ? persistCookies(deps.credentialStorePath, expectedOrigin, cookies, Date.now())
      : 0
  return {
    ok: true,
    cookieHeader,
    cookieNames: cookieNamesOf(cookieHeader),
    runId: prepared.runId,
    ...(persisted > 0 ? { persisted } : {}),
  }
}

/**
 * 唯一的执行入口（IF-1）。
 *
 * 顺序是设计的一部分：开关 → 载链 → 卡 → 槽位值 → baseUrl 候选 → 执行计划 →
 * 确认闸 → 能力探测 → 真跑。**前七步一个请求都不发**；缺参、环、坏 URL 全在
 * 第一个请求之前被拒，回执逐条指到「节点 · 字段 · 类型」。
 */
export async function chainRunForTool(
  deps: ChainRunToolDeps,
  exec: unknown,
  args: ChainRunToolArgs,
): Promise<ChainRunToolValue> {
  if (deps.chain.enabled !== true) {
    return {
      ok: false,
      accepted: false,
      gate: 'blocked',
      code: 'execution-disabled',
      message: '执行开关已关闭（config.chainRunEnabled=false）：链读写与历史回看照常，执行一律拒绝',
    }
  }

  let workspaceRoot: string
  try {
    workspaceRoot = (await deps.resolveWorkspaceRoot(exec)) ?? process.cwd()
  } catch (error) {
    return { ok: false, accepted: false, gate: 'blocked', code: 'invalid-chain', message: `解析工作区根失败：${messageOf(error)}` }
  }

  const loaded = loadChain(workspaceRoot, args.site, args.flow, {
    ...(args.version === undefined ? {} : { version: args.version }),
  })
  if (!loaded.ok) {
    if (loaded.code === 'chain-not-found') {
      return {
        ok: false,
        accepted: false,
        code: 'chain-not-found',
        message: loaded.message,
        versions: loaded.availableVersions,
      }
    }
    return {
      ok: false,
      accepted: false,
      code: 'invalid-chain',
      message: loaded.message,
      issues: toChainIssues(loaded.issues),
      versions: loaded.availableVersions,
    }
  }
  const doc = loaded.doc

  // R-4 M2：登录链的预检（不发请求、不建 run）。自环必须在主链开跑前拒掉。
  if (args.relogin !== undefined) {
    if (args.relogin.site.trim() === '' || args.relogin.flow.trim() === '') {
      return { ok: false, accepted: false, gate: 'blocked', code: 'relogin-unavailable', message: 'relogin.site / relogin.flow 不能为空' }
    }
    if (args.relogin.site === doc.meta.site && args.relogin.flow === doc.meta.flow) {
      return {
        ok: false,
        accepted: false,
        gate: 'blocked',
        code: 'relogin-cycle',
        message: `登录链不能是当前链自身（${doc.meta.site} / ${doc.meta.flow}）：会无限递归；请指定一条真正的登录链路`,
      }
    }
  }

  const cards = cardsForChain(workspaceRoot, doc)

  const inputCheck = validateChainInputs(doc, args.inputs)
  if (!inputCheck.ok) {
    return { ok: false, accepted: false, code: 'inputs-invalid', message: inputCheck.message }
  }

  const base = resolveChainBaseUrl(doc, cards, args.baseUrl)
  const planned = buildPlan(doc, cards, args.inputs ?? {}, base.ok ? base.baseUrl : undefined)
  if (!planned.ok) {
    return {
      ok: false,
      accepted: false,
      code: planned.code,
      // 跨 origin 冲突比「没提供」有用得多：优先给候选清单。
      message: planned.code === 'base-url-unresolved' && !base.ok ? base.message : planned.message,
      gaps: planned.gaps,
      cycle: planned.cycle,
    }
  }

  const plan = planned.plan
  const cleanupPlan = cleanupPlanOf(workspaceRoot, doc)
  if (!cleanupPlan.ok) {
    return { ok: false, accepted: false, gate: 'blocked', code: 'invalid-chain', message: cleanupPlan.message }
  }
  const cleanupValue = cleanupPlan.value
  const verifyValue = verifyPlanOf(doc)
  const planValue = planValueOf(plan, planned.notices, cleanupValue, verifyValue)

  // 确认闸：不带 confirm 且不是 dry-run → 只出计划卡；不建 run、不发请求。
  if (args.dryRun !== true && args.confirm !== true) {
    return {
      ok: true,
      accepted: false,
      gate: 'confirm-required',
      code: 'confirm-required',
      message: `计划已编译（${plan.totalNodes} 个节点，写类 ${plan.writeNodes.length} 个，目标 ${planValue.host}）：确认后带 confirm=true 重调`,
      plan: planValue,
      card: chainConfirmationCard(doc, plan, planned.notices, cleanupValue, verifyValue),
    }
  }

  // 能力探测只在真要发请求时判：dry-run 不需要 fetch。
  if (args.dryRun !== true) {
    const reason = chainExecutionUnavailableReason()
    if (reason !== undefined) {
      return { ok: false, accepted: false, gate: 'blocked', code: 'execution-unavailable', message: reason, plan: planValue }
    }
  }

  const chainDeps = { dataRoot: deps.dataRoot, config: deps.chain }
  const runInput = {
    doc,
    cards,
    plan,
    inputs: args.inputs ?? {},
    baseUrl: plan.baseUrl,
    ...(args.concurrency === undefined ? {} : { concurrency: args.concurrency }),
    chainPath: chainPathForRecord(workspaceRoot, loaded.path),
    ...(args.dryRun === true ? { dryRun: true } : {}),
    ...(deps.credentials === undefined ? {} : { credentials: deps.credentials }),
    ...(args.relogin === undefined
      ? {}
      : { relogin: { spec: args.relogin, run: createReloginRunner(deps, workspaceRoot, plan.baseUrl) } }),
  }

  // dry-run：同一份计划、永不发请求，但落一条 `dryRun: true` 留痕（计划本身要能被复查）。
  if (args.dryRun === true) {
    const prepared = prepareChainRun(chainDeps, runInput)
    const run = await executeChainRun(chainDeps, prepared, runInput)
    return {
      ok: true,
      accepted: true,
      gate: 'started',
      kind: 'dry-run',
      runId: prepared.runId,
      runDir: prepared.runDir,
      plan: planValue,
      ...(run.ok ? { summary: run.summary } : { message: run.message }),
    }
  }

  const prepared = prepareChainRun(chainDeps, runInput)
  const jobs = deps.resolveJobs() as ChainJobsLike | undefined

  // ── 后台 job 路径：长链不阻塞对话，可 job_kill ──
  if (jobs !== undefined && typeof jobs.start === 'function') {
    const controller = new AbortController()
    const spec: ChainJobsSpec = {
      kind: 'dataforge-chain',
      label: `${doc.meta.flow} v${doc.meta.version}`,
      owner: ownerOf(exec),
      outputLimitBytes: 65536,
      run(job) {
        const task = executeChainRun(chainDeps, prepared, {
          ...runInput,
          signal: controller.signal,
          onProgress: (line) => job.updateProgress(line),
        })
        job.append(`链 ${doc.meta.site}/${doc.meta.flow} v${doc.meta.version} → ${planValue.host}（${plan.totalNodes} 节点）`)
        return {
          cancel: (reason?: string) => controller.abort(reason),
          done: task.then(async (result) => {
            const verify = result.ok
              ? await runVerifyForTool(deps, doc, result.summary, args.inputs ?? {})
              : undefined
            if (verify !== undefined) job.append(`verify ${verify.site}/${verify.flow}：${verify.skipped ?? verify.status ?? (verify.success === true ? 'success' : verify.message ?? 'unknown')}`)
            const cleanup = result.ok
              ? await runCleanupForTool(deps, workspaceRoot, doc, result.summary, args.inputs ?? {})
              : undefined
            if (cleanup?.skipped !== undefined) job.append(`cleanup 跳过：${cleanup.skipped}`)
            else if (cleanup !== undefined) job.append(`cleanup ${cleanup.site}/${cleanup.flow}：${cleanup.status ?? cleanup.message ?? 'unknown'}`)
            return {
              status: jobStatusOf(result, controller.signal.aborted),
              detail: jobDetailOf(result),
              ...(result.ok
                ? {
                    result: JSON.stringify(cleanup === undefined && verify === undefined
                      ? result.summary
                      : { ...result.summary, ...(verify === undefined ? {} : { verify }), ...(cleanup === undefined ? {} : { cleanup }) }),
                  }
                : {}),
            }
          }),
        }
      },
    }
    const jobId = extractJobId(jobs.start(spec))
    return {
      ok: true,
      accepted: true,
      gate: 'started',
      kind: 'background',
      ...(jobId === undefined ? {} : { jobId }),
      runId: prepared.runId,
      runDir: prepared.runDir,
      plan: planValue,
    }
  }

  // ── 前台降级（宿主未装配 dsh-jobs）：如实标注，并用全局超时兜底 ──
  const controller = new AbortController()
  const watchdog = setTimeout(
    () => controller.abort('foreground-timeout'),
    Math.max(1, deps.chain.foregroundTimeoutSeconds) * 1000,
  )
  watchdog.unref?.()
  try {
    const run = await executeChainRun(chainDeps, prepared, { ...runInput, signal: controller.signal })
    const verify = run.ok
      ? await runVerifyForTool(deps, doc, run.summary, args.inputs ?? {})
      : undefined
    const cleanup = run.ok
      ? await runCleanupForTool(deps, workspaceRoot, doc, run.summary, args.inputs ?? {})
      : undefined
    return {
      ok: true,
      accepted: true,
      gate: 'started',
      kind: 'foreground',
      runId: prepared.runId,
      runDir: prepared.runDir,
      plan: planValue,
      degradedNotice: '宿主未装配 dsh-jobs：本次前台执行（长链会占用对话，且不可 job_kill；建议部署 @deepseek-ai/dsh-jobs + @deepseek-ai/dsh-tool-jobs）',
      ...(verify === undefined ? {} : { verify }),
      ...(cleanup === undefined ? {} : { cleanup }),
      ...(run.ok
        ? {
            summary: run.summary,
            nodes: compactNodes(run.nodes),
            ...(run.failedNode === undefined ? {} : { failedNode: run.failedNode }),
          }
        : { message: run.message }),
    }
  } finally {
    clearTimeout(watchdog)
  }
}

// ────────────────────────────────────────────────
// IF-2 dataforge_chain_runs
// ────────────────────────────────────────────────

export type ChainRunRow = {
  runId: string
  status: string
  startedAt: number
  updatedAt: number
  dryRun: boolean
  stepsDone: number
  totalSteps: number
  /** 这一跑用的链版本（写入时快照）。 */
  version?: number
  failedNode?: string
  flow?: string
  flowName?: string
  message?: string
}

export type ChainRunsToolArgs = { site: string; flow: string; version?: number; limit?: number }

export type ChainRunsToolValue = {
  ok: boolean
  runs?: ChainRunRow[]
  /** 空态与「坏记录已跳过」都走 notice（空态是常态，不是失败）。 */
  notice?: string
}

/**
 * 链维度运行列表（IF-2）：扫描 `runs/` 读 `run.json` 的 `chain` 段过滤。
 *
 * 没有链维度索引是有意的：单项目几十到几百条运行，全量扫描可接受；量级上来再加索引。
 * 运行留痕与链文件解耦——链被删/改名，历史运行仍能列出（`chain` 段是写入时快照）。
 */
export function listChainRunsForTool(deps: ChainRunToolDeps, args: ChainRunsToolArgs): ChainRunsToolValue {
  const limit = Math.max(1, Math.min(200, Math.floor(args.limit ?? 20)))
  const siteSlug = slugOf(args.site)
  const flowSlug = slugOf(args.flow)
  const rows: ChainRunRow[] = []
  let damaged = 0

  for (const runId of listRunIds(deps.dataRoot, 200)) {
    const record = readRunRecord(deps.dataRoot, runId)
    if (record === undefined) {
      damaged += 1
      continue
    }
    const chain = plainRecordOf(record['chain'])
    // 没有 chain 段的旧流程运行不属于任何链，不参与过滤（IF-2 兼容性）。
    if (chain === undefined) continue
    const site = typeof chain['site'] === 'string' ? chain['site'] : ''
    const flow = typeof chain['flow'] === 'string' ? chain['flow'] : ''
    const sameSite = site === args.site || slugOf(site) === siteSlug
    const sameFlow = flow === args.flow || slugOf(flow) === flowSlug
    if (!sameSite || !sameFlow) continue
    const version = typeof chain['version'] === 'number' ? chain['version'] : undefined
    if (args.version !== undefined && version !== args.version) continue

    const events = loadRunEvents(deps.dataRoot, runId)
    if (events === undefined || events.length === 0) continue
    const summary = foldSummary(runId, events)
    rows.push({
      runId,
      status: summary.status,
      startedAt: summary.startedAt,
      updatedAt: summary.updatedAt,
      dryRun: summary.dryRun,
      stepsDone: summary.stepsDone,
      totalSteps: summary.totalSteps,
      ...(version === undefined ? {} : { version }),
      ...(summary.chain?.failedNode === undefined ? {} : { failedNode: summary.chain.failedNode }),
      flow: summary.flow,
      flowName: summary.flowName,
      ...(summary.message === undefined ? {} : { message: summary.message }),
    })
  }

  rows.sort((left, right) =>
    right.startedAt - left.startedAt || (left.runId < right.runId ? 1 : left.runId > right.runId ? -1 : 0))

  const damagedNote = damaged > 0 ? `另有 ${damaged} 条运行记录读不出来已跳过` : undefined
  const runs = rows.slice(0, limit)
  if (runs.length === 0) {
    return { ok: true, runs, notice: ['该链暂无运行留痕', damagedNote].filter(Boolean).join('；') }
  }
  return { ok: true, runs, ...(damagedNote === undefined ? {} : { notice: damagedNote }) }
}

/** 非 plain object（数组/缺失）一律 undefined。 */
function plainRecordOf(value: unknown): Record<string, unknown> | undefined {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return undefined
}
