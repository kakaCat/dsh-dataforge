/**
 * 复跑对照（R-6 M2 / FR-6.7）：把两次 `chain-run` 的留痕并排投影成一张差异视图。
 *
 * 为什么要单独一个模块：`diagnose` 回答「一条失败的 run 断在哪」，对照要回答
 * 「换入参复跑之后什么变了、链生成值是不是重新求解」。两者都是只读投影，
 * 只是这里一次读一对 run，输出要能直接给模型看「入参 / 出参 / 节点状态」的差异。
 *
 * 只读铁律：只走 `readRunRecord` + `loadRunEvents`；不重跑、不发请求、不写留痕、
 * 不碰凭证。事件形状完全复用 R-3 已写入的事实（step done 的 `data.emitted` /
 * `data.response`、result 的 `businessData`），不发明第二套执行语义。
 *
 * @module dsh-dataforge/orchestration/compare
 */
import { isInputSlotRef, splitBindingPath } from '../chains/schema.js'
import { foldSummary, loadRunEvents, readRunRecord } from '../runs/store.js'
import type { BridgeEvent, JsonLike } from '../shared/types.js'
import type { ChainRunToolDeps } from './application.js'

type JsonObject = { [key: string]: JsonLike }

/** 对照入参：`runIds[0]` 是基线（通常是首跑），`runIds[1]` 是对照（通常是复跑）。 */
export type ChainCompareToolArgs = {
  runIds: [string, string]
}

/** 一侧 run 的身份快照（取自 run.json + 事件折叠，不重跑）。 */
export type ChainCompareRun = {
  runId: string
  chain?: { site: string; flow: string; version: number }
  params: JsonObject
  status: string
  failedNode?: string
  startedAt: number
}

/** 链级入参对照：同一槽位名只有两边都有值时才真正可比。 */
export type ChainCompareInput = {
  key: string
  base?: JsonLike
  target?: JsonLike
  changed: boolean
}

/** 节点级状态/耗时对照（url/method 刻意不投影：它们含实际入参，且不属于对照结论）。 */
export type ChainCompareNode = {
  nodeId: string
  baseStatus?: string
  targetStatus?: string
  baseHttpStatus?: number
  targetHttpStatus?: number
  baseElapsedMs?: number
  targetElapsedMs?: number
  changed: boolean
}

/** 出参对照：`path` 是绑定边 `from` 去掉节点前缀后的字段路径。 */
export type ChainCompareEmitted = {
  nodeId: string
  path: string
  base?: JsonLike
  target?: JsonLike
  changed: boolean
}

export type ChainCompareSummary = {
  nodesChanged: number
  emittedChanged: number
  inputsChanged: number
  baseFailedNode?: string
  targetFailedNode?: string
}

/** 工具回执的 JSON 安全投影：内部事件里的 unknown 值不能直接进工具出口。 */
export type ChainCompareToolValue = {
  ok: boolean
  code?: string
  message?: string
  runs?: [ChainCompareRun, ChainCompareRun]
  inputs?: ChainCompareInput[]
  nodes?: ChainCompareNode[]
  emitted?: ChainCompareEmitted[]
  summary?: ChainCompareSummary
  hints?: string[]
}

/** 工具回执的 JSON 安全投影（照 `diagnoseOutputOf` 的做法，二次序列化兜底）。 */
export function compareOutputOf(value: ChainCompareToolValue): ChainCompareToolValue {
  return JSON.parse(JSON.stringify(value)) as ChainCompareToolValue
}

/* ================================================================== 通用投影 */

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * 敏感键名片段（小写子串匹配）。
 *
 * 为什么用「命中即打码」而不是精确键名表：留痕里的键名有 `access_token`、
 * `x-api-key`、`Authorization` 等各种写法，漏一个就是一次泄漏；宁可多打码。
 */
const SENSITIVE_KEY_MARKERS = [
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'authorization',
  'cookie',
  'api-key',
  'apikey',
  'api_key',
  'private-key',
  'access-key',
]

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase()
  return SENSITIVE_KEY_MARKERS.some((marker) => lower.includes(marker))
}

/** 递归把敏感键名的值换成 `***`；数组/对象深拷贝，只用于输出投影。 */
function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? '***' : redactValue(child)
    }
    return out
  }
  return value
}

/** 把 unknown 折成 JSON 安全叶子；序列化不了的值不投影（诚实留空，不塞 `[object]`）。 */
function jsonValueOf(value: unknown): JsonLike | undefined {
  try {
    const text = JSON.stringify(value)
    if (text === undefined) return undefined
    return JSON.parse(text) as JsonLike
  } catch {
    return undefined
  }
}

/** 递归 JSON 比较（对象键序无关）：判断「值是否真的变了」只看原始值，不看打码后的投影。 */
function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((item, index) => deepEqual(item, right[index]))
  }
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord)
  if (leftKeys.length !== Object.keys(rightRecord).length) return false
  return leftKeys.every((key) => key in rightRecord && deepEqual(leftRecord[key], rightRecord[key]))
}

/* ================================================================== 单 run 投影 */

/** 节点级状态：step 事件是权威来源；`elapsed` 取事件上的节点耗时（R-3 写入）。 */
type NodeInfo = {
  status?: string
  httpStatus?: number
  elapsedMs?: number
}

/** 一条 run 的只读投影（后续 diff 只在这份投影上做）。 */
type RunSnapshot = {
  runId: string
  status: string
  startedAt: number
  chain?: { site: string; flow: string; version: number }
  /** 原始 params（未打码）：diff 要拿原始值判断 changed，输出时才脱敏。 */
  params: Record<string, unknown>
  failedNode?: string
  nodeOrder: string[]
  nodes: Map<string, NodeInfo>
  emittedOrder: string[]
  emitted: Map<string, unknown>
}

/**
 * 从事件流里取节点状态。
 *
 * 只认 step 事件：`start` 标 started，`done`/`error` 取 response.status 与 elapsed。
 * 没启动过的节点（失败后下游被跳过）不会有 step —— 由 `businessNodesOf` 补。
 */
function stepNodesOf(events: BridgeEvent[]): { order: string[]; nodes: Map<string, NodeInfo> } {
  const nodes = new Map<string, NodeInfo>()
  const order: string[] = []
  for (const event of events) {
    if (event.event !== 'step' || typeof event.id !== 'string') continue
    const nodeId = event.id
    const info: NodeInfo = { ...(nodes.get(nodeId) ?? {}) }
    if (!nodes.has(nodeId)) order.push(nodeId)
    if (event.status === 'start') info.status = 'started'
    if (event.status === 'done') info.status = 'done'
    if (event.status === 'error') info.status = 'error'
    const data = plainRecord(event.data)
    const response = plainRecord(data?.['response'])
    const httpStatus = numberOrUndefined(response?.['status'])
    if (httpStatus !== undefined) info.httpStatus = httpStatus
    const elapsedMs = numberOrUndefined(event.elapsed)
    if (elapsedMs !== undefined) info.elapsedMs = elapsedMs
    nodes.set(nodeId, info)
  }
  return { order, nodes }
}

/** `result.businessData.nodes`：全量节点列表（含 skipped），事件流里没有的靠它补。 */
function businessNodesOf(events: BridgeEvent[]): Array<{ nodeId: string } & NodeInfo> {
  let result: BridgeEvent | undefined
  for (const event of events) if (event.event === 'result') result = event
  const data = plainRecord(result?.businessData)
  const raw = data?.['nodes']
  if (!Array.isArray(raw)) return []
  const out: Array<{ nodeId: string } & NodeInfo> = []
  for (const item of raw) {
    const record = plainRecord(item)
    const nodeId = stringOf(record?.['nodeId'])
    if (nodeId === undefined) continue
    const status = stringOf(record?.['status'])
    const httpStatus = numberOrUndefined(record?.['httpStatus'])
    const elapsedMs = numberOrUndefined(record?.['elapsedMs'])
    out.push({
      nodeId,
      ...(status === undefined ? {} : { status }),
      ...(httpStatus === undefined ? {} : { httpStatus }),
      ...(elapsedMs === undefined ? {} : { elapsedMs }),
    })
  }
  return out
}

/** 出参实际值：step done 的 `data.emitted`，键就是绑定边 `from`（如 `query.body.items[0].internalId`）。 */
function emittedOf(events: BridgeEvent[]): { order: string[]; values: Map<string, unknown> } {
  const values = new Map<string, unknown>()
  const order: string[] = []
  for (const event of events) {
    if (event.event !== 'step' || event.status !== 'done') continue
    const data = plainRecord(event.data)
    const emitted = plainRecord(data?.['emitted'])
    if (emitted === undefined) continue
    for (const [path, value] of Object.entries(emitted)) {
      // 槽位引用不是「节点出参」，没有绑定边语义，不参与出参对照。
      if (isInputSlotRef(path)) continue
      if (splitBindingPath(path) === undefined) continue
      if (!values.has(path)) order.push(path)
      values.set(path, value)
    }
  }
  return { order, values }
}

/** 链身份：以 run.json 的 `chain` 快照为准（写入时的版本），旧 run 退回 meta 折叠。 */
function chainOf(
  record: Record<string, unknown>,
  summary: ReturnType<typeof foldSummary>,
): { site: string; flow: string; version: number } | undefined {
  const recordChain = plainRecord(record['chain'])
  const site = stringOf(recordChain?.['site']) ?? summary.chain?.site
  const flow = stringOf(recordChain?.['flow']) ?? summary.chain?.flow
  const version = numberOrUndefined(recordChain?.['version']) ?? summary.chain?.version
  if (site === undefined && flow === undefined && version === undefined) return undefined
  return { site: site ?? '', flow: flow ?? '', version: version ?? 0 }
}

/** 把一条 run 的留痕折成投影；事件流为空时调用方已经先报 run-not-found。 */
function snapshotOf(runId: string, record: Record<string, unknown>, events: BridgeEvent[]): RunSnapshot {
  const summary = foldSummary(runId, events)
  const step = stepNodesOf(events)
  // 失败后下游节点不发 step；businessData.nodes 里才有 skipped —— 不补进来，
  // 「一次成功一次失败」的节点对照会看起来像「对照侧没有这个节点」。
  for (const business of businessNodesOf(events)) {
    const existing = step.nodes.get(business.nodeId)
    if (existing === undefined) {
      step.order.push(business.nodeId)
      step.nodes.set(business.nodeId, {
        ...(business.status === undefined ? {} : { status: business.status }),
        ...(business.httpStatus === undefined ? {} : { httpStatus: business.httpStatus }),
        ...(business.elapsedMs === undefined ? {} : { elapsedMs: business.elapsedMs }),
      })
      continue
    }
    if (existing.status === undefined && business.status !== undefined) existing.status = business.status
    if (existing.httpStatus === undefined && business.httpStatus !== undefined) existing.httpStatus = business.httpStatus
    if (existing.elapsedMs === undefined && business.elapsedMs !== undefined) existing.elapsedMs = business.elapsedMs
  }
  const emitted = emittedOf(events)
  const chain = chainOf(record, summary)
  const failedNode =
    summary.chain?.failedNode ?? (summary.status === 'failed' ? summary.lastStepId : undefined)
  return {
    runId,
    status: summary.status,
    startedAt: numberOrUndefined(record['startedAt']) ?? summary.startedAt,
    ...(chain === undefined ? {} : { chain }),
    params: plainRecord(record['params']) ?? {},
    ...(failedNode === undefined ? {} : { failedNode }),
    nodeOrder: step.order,
    nodes: step.nodes,
    emittedOrder: emitted.order,
    emitted: emitted.values,
  }
}

/* ================================================================== 差异 */

function inputsOf(base: RunSnapshot, target: RunSnapshot): ChainCompareInput[] {
  const keys = [...new Set([...Object.keys(base.params), ...Object.keys(target.params)])]
  return keys.map((key) => {
    const hasBase = Object.prototype.hasOwnProperty.call(base.params, key)
    const hasTarget = Object.prototype.hasOwnProperty.call(target.params, key)
    const baseValue = base.params[key]
    const targetValue = target.params[key]
    const changed = hasBase !== hasTarget ? true : !deepEqual(baseValue, targetValue)
    const baseJson = hasBase ? jsonValueOf(isSensitiveKey(key) ? '***' : redactValue(baseValue)) : undefined
    const targetJson = hasTarget ? jsonValueOf(isSensitiveKey(key) ? '***' : redactValue(targetValue)) : undefined
    return {
      key,
      ...(baseJson === undefined ? {} : { base: baseJson }),
      ...(targetJson === undefined ? {} : { target: targetJson }),
      changed,
    }
  })
}

function emittedDiffsOf(base: RunSnapshot, target: RunSnapshot): ChainCompareEmitted[] {
  const keys = [...base.emittedOrder, ...target.emittedOrder.filter((key) => !base.emitted.has(key))]
  const out: ChainCompareEmitted[] = []
  for (const key of keys) {
    const split = splitBindingPath(key)
    if (split === undefined) continue
    const hasBase = base.emitted.has(key)
    const hasTarget = target.emitted.has(key)
    const baseRaw = base.emitted.get(key)
    const targetRaw = target.emitted.get(key)
    const changed = hasBase !== hasTarget ? true : !deepEqual(baseRaw, targetRaw)
    // 路径本身命中敏感键名（如 `body.access_token`）时整值打码：值是从响应里取的，
    // 键名已经说明它是凭证，不能因为「值不在 known secrets 里」就放行。
    const sensitive = isSensitiveKey(key)
    const baseJson = hasBase ? jsonValueOf(sensitive ? '***' : redactValue(baseRaw)) : undefined
    const targetJson = hasTarget ? jsonValueOf(sensitive ? '***' : redactValue(targetRaw)) : undefined
    out.push({
      nodeId: split.nodeId,
      path: split.fieldPath,
      ...(baseJson === undefined ? {} : { base: baseJson }),
      ...(targetJson === undefined ? {} : { target: targetJson }),
      changed,
    })
  }
  return out
}

function nodesOf(base: RunSnapshot, target: RunSnapshot): ChainCompareNode[] {
  const order = [...base.nodeOrder, ...target.nodeOrder.filter((nodeId) => !base.nodes.has(nodeId))]
  return order.map((nodeId) => {
    const baseInfo = base.nodes.get(nodeId)
    const targetInfo = target.nodes.get(nodeId)
    // 耗时也算 changed：复跑耗时差异正是用户要对照的信息；状态/HTTP 码差异同样计入。
    const changed =
      baseInfo?.status !== targetInfo?.status ||
      baseInfo?.httpStatus !== targetInfo?.httpStatus ||
      baseInfo?.elapsedMs !== targetInfo?.elapsedMs
    return {
      nodeId,
      ...(baseInfo?.status === undefined ? {} : { baseStatus: baseInfo.status }),
      ...(targetInfo?.status === undefined ? {} : { targetStatus: targetInfo.status }),
      ...(baseInfo?.httpStatus === undefined ? {} : { baseHttpStatus: baseInfo.httpStatus }),
      ...(targetInfo?.httpStatus === undefined ? {} : { targetHttpStatus: targetInfo.httpStatus }),
      ...(baseInfo?.elapsedMs === undefined ? {} : { baseElapsedMs: baseInfo.elapsedMs }),
      ...(targetInfo?.elapsedMs === undefined ? {} : { targetElapsedMs: targetInfo.elapsedMs }),
      changed,
    }
  })
}

/** 建议只给「下一步能做什么」，不重复回执里已有的事实。 */
function hintsOf(
  base: RunSnapshot,
  target: RunSnapshot,
  inputs: ChainCompareInput[],
  emitted: ChainCompareEmitted[],
  nodes: ChainCompareNode[],
): string[] {
  const hints: string[] = []
  const baseVersion = base.chain?.version
  const targetVersion = target.chain?.version
  if (baseVersion !== undefined && targetVersion !== undefined && baseVersion !== targetVersion) {
    hints.push(`链版本不同（v${baseVersion} → v${targetVersion}）：两次跑的不是同一版链，出参差异也可能来自链定义变化`)
  }
  const inputsChanged = inputs.filter((input) => input.changed).length
  const emittedChanged = emitted.filter((item) => item.changed).length
  if (inputsChanged > 0) {
    hints.push(`入参有 ${inputsChanged} 个不同（inputs.changed）：复跑换的就是这些槽位`)
  }
  if (emittedChanged > 0) {
    hints.push(`出参有 ${emittedChanged} 个不同（emitted.changed）：链生成值由上游响应重新求解，不是首跑缓存`)
  }
  if (base.failedNode !== undefined && target.failedNode === undefined) {
    hints.push(`基线失败于节点 ${base.failedNode}、对照运行已完成：对照 nodes 里该节点的状态变化可确认修复点`)
  }
  if (base.failedNode === undefined && target.failedNode !== undefined) {
    hints.push(`对照运行失败于节点 ${target.failedNode}：用 dataforge_chain_diagnose(runId=${target.runId}) 看该节点的入边与上游状态`)
  }
  if (base.failedNode !== undefined && target.failedNode !== undefined) {
    hints.push(
      base.failedNode === target.failedNode
        ? `两次都失败在同一节点 ${base.failedNode}：先核对入参与绑定边，再决定是否重跑`
        : `两次分别失败在 ${base.failedNode} / ${target.failedNode}：断点变了，先修对照运行的新断点`,
    )
  }
  const statusSame = nodes.every(
    (node) => node.baseStatus === node.targetStatus && node.baseHttpStatus === node.targetHttpStatus,
  )
  if (inputsChanged === 0 && emittedChanged === 0 && statusSame) {
    hints.push('两次运行在入参、出参与节点状态上没有差异（耗时可能不同）：复跑没有改变求解结果')
  }
  return hints
}

/* ================================================================== 读两条留痕 */

function failureOf(code: string, message: string): ChainCompareToolValue {
  return { ok: false, code, message }
}

function sideLabelOf(side: 'base' | 'target'): string {
  return side === 'base' ? '基线运行（runIds[0]）' : '对照运行（runIds[1]）'
}

type LoadedSnapshot = { ok: true; snapshot: RunSnapshot } | { ok: false; value: ChainCompareToolValue }

/**
 * 读一条 run 并折成投影。
 *
 * 只读：没有就如实报错，不猜测、不回退到「最近一次运行」——对照的对象必须是
 * 调用方明确给的那两条留痕。
 */
function loadSnapshotOf(deps: ChainRunToolDeps, runId: string, side: 'base' | 'target'): LoadedSnapshot {
  const label = sideLabelOf(side)
  const record = readRunRecord(deps.dataRoot, runId)
  if (record === undefined) {
    return { ok: false, value: failureOf('run-not-found', `${label} ${runId} 不存在（没有 run.json 留痕）`) }
  }
  // 只有 chain-run 的 run.json 才有 chain/params，probe/crystal/流程 run 的对照没有意义。
  if (record['kind'] !== 'chain-run') {
    return {
      ok: false,
      value: failureOf(
        'not-chain-run',
        `${label} ${runId} 不是链运行（kind=${String(record['kind'])}）：复跑对照只接受 dataforge_chain_run 的留痕`,
      ),
    }
  }
  const events = loadRunEvents(deps.dataRoot, runId)
  if (events === undefined || events.length === 0) {
    return { ok: false, value: failureOf('run-not-found', `${label} ${runId} 还没有事件留痕，无法对照`) }
  }
  return { ok: true, snapshot: snapshotOf(runId, record, events) }
}

/* ================================================================== 工具入口 */

/**
 * 对照两条链运行（只读）。
 *
 * 顺序语义：`runIds[0]` = 基线（base），`runIds[1]` = 对照（target）；
 * 输出的 `runs` 固定 [base, target]，`inputs`/`nodes`/`emitted` 的 base/target
 * 字段也按同样顺序，避免调用方还要猜。
 */
export async function compareForTool(
  deps: ChainRunToolDeps,
  args: ChainCompareToolArgs,
): Promise<ChainCompareToolValue> {
  const runIds: unknown = args.runIds
  if (!Array.isArray(runIds) || runIds.length !== 2) {
    return failureOf('invalid-run-ids', 'runIds 必须是 [baseRunId, targetRunId]：两个 runId 缺一不可')
  }
  const pair: unknown[] = runIds
  const [rawBase, rawTarget] = pair
  if (typeof rawBase !== 'string' || typeof rawTarget !== 'string') {
    return failureOf('invalid-run-ids', 'runIds 的两个元素都必须是字符串 runId')
  }
  const baseRunId = rawBase.trim()
  const targetRunId = rawTarget.trim()
  if (baseRunId === '' || targetRunId === '') {
    return failureOf('invalid-run-ids', 'runIds 的两个元素都不能为空字符串')
  }

  const baseLoaded = loadSnapshotOf(deps, baseRunId, 'base')
  if (!baseLoaded.ok) return baseLoaded.value
  const targetLoaded = loadSnapshotOf(deps, targetRunId, 'target')
  if (!targetLoaded.ok) return targetLoaded.value
  const base = baseLoaded.snapshot
  const target = targetLoaded.snapshot

  const inputs = inputsOf(base, target)
  const emitted = emittedDiffsOf(base, target)
  const nodes = nodesOf(base, target)
  const hints = hintsOf(base, target, inputs, emitted, nodes)

  const value: ChainCompareToolValue = {
    ok: true,
    runs: [
      {
        runId: base.runId,
        ...(base.chain === undefined ? {} : { chain: base.chain }),
        params: jsonObjectOf(base.params),
        status: base.status,
        ...(base.failedNode === undefined ? {} : { failedNode: base.failedNode }),
        startedAt: base.startedAt,
      },
      {
        runId: target.runId,
        ...(target.chain === undefined ? {} : { chain: target.chain }),
        params: jsonObjectOf(target.params),
        status: target.status,
        ...(target.failedNode === undefined ? {} : { failedNode: target.failedNode }),
        startedAt: target.startedAt,
      },
    ],
    inputs,
    nodes,
    emitted,
    summary: {
      nodesChanged: nodes.filter((node) => node.changed).length,
      emittedChanged: emitted.filter((item) => item.changed).length,
      inputsChanged: inputs.filter((input) => input.changed).length,
      ...(base.failedNode === undefined ? {} : { baseFailedNode: base.failedNode }),
      ...(target.failedNode === undefined ? {} : { targetFailedNode: target.failedNode }),
    },
    ...(hints.length === 0 ? {} : { hints }),
  }
  return compareOutputOf(value)
}

/** run.json 的 params 投影：顶层敏感键打码，嵌套值递归打码。 */
function jsonObjectOf(params: Record<string, unknown>): JsonObject {
  const out: JsonObject = {}
  for (const [key, value] of Object.entries(params)) {
    const redacted = isSensitiveKey(key) ? '***' : redactValue(value)
    const encoded = jsonValueOf(redacted)
    if (encoded !== undefined) out[key] = encoded
  }
  return out
}
