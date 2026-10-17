/**
 * 执行计划编译（纯函数，无 IO、不发请求）：链 + 接口卡 + 槽位值 → `ExecutionPlan`。
 *
 * 步骤（全部在第一个请求之前）：
 *   1. 只接受 `interface-chain`（`page-chain` → `not-executable`，不在执行段补页面语义）；
 *   2. 拓扑排序（**复用** `validate.topoOrder`，不实现第二套拓扑；成环 → `cycle`）；
 *   3. 解析每个节点引用的卡（缺失 → `card-not-imported`）；
 *   4. 静态缺参一次性判完（卡片字段 + 链级槽位；**`required` 不参与判据**），
 *      只要有一条 gaps 就整链不执行（`missing-params`，gaps 原文带回）；
 *   5. baseUrl 判定（缺省或非 http(s) → `base-url-unresolved`）。
 *
 * 缺参判据与覆盖判定见 `./coverage.ts`；本模块只负责编排与计划形状。
 *
 * @module dsh-dataforge/execute/plan
 */
import type { ChainDoc, InterfaceCardDoc } from '../chains/schema.js'
import { inputSlotNameOf, splitBindingPath } from '../chains/schema.js'
import { dependencyPairs, topoOrder } from '../chains/validate.js'
import type { StaticGap } from './coverage.js'
import { coveredPaths, missingInputs, normalizePath } from './coverage.js'

/** 计划里的一个节点：方法/URL 骨架、静态依赖、常量与自身缺参。 */
export type PlanNode = {
  nodeId: string
  cardId: string
  /** 节点级目标源；缺省用 ExecutionPlan.baseUrl。 */
  baseUrl?: string
  method: string
  urlTemplate: string
  dependsOn: string[]
  constants: Record<string, unknown>
  gaps: StaticGap[]
}

/** 执行计划：dry-run 与真实执行共用同一份产物。 */
export type ExecutionPlan = {
  order: string[]
  nodes: PlanNode[]
  gaps: StaticGap[]
  baseUrl: string
  writeNodes: string[]
  totalNodes: number
}

/** 预检失败码（与 IF-1/IF-3 的契约同名，只增不改）。 */
export type PlanFailureCode = 'missing-params' | 'base-url-unresolved' | 'cycle' | 'not-executable' | 'card-not-imported'

export type PlanResult =
  | { ok: true; plan: ExecutionPlan; notices: string[] }
  | { ok: false; code: PlanFailureCode; message: string; gaps: StaticGap[]; cycle: string[] }

/**
 * 编译执行计划。
 *
 * `inputs` 是本次运行的槽位值（键 = 链文件声明的槽位名）；`baseUrl` 由调用方
 * （`chain_run`）解析后传入，本函数只判定「是不是 http(s) 源」，不做来源推断。
 */
export function buildPlan(
  doc: ChainDoc,
  cards: Map<string, InterfaceCardDoc>,
  inputs: Record<string, unknown>,
  baseUrl?: string,
): PlanResult {
  // 1) 执行模型只有一套：页面链必须先经 R-1 编译成 interface-chain 草稿并落盘。
  if (doc.kind === 'page-chain') {
    return failure(
      'not-executable',
      `链 ${doc.meta.site}/${doc.meta.flow} 是 page-chain：先经 R-1 compilePageChain 编译成 interface-chain 草稿并落盘，再执行`,
    )
  }

  // 2) 拓扑只复用 validate.topoOrder；排不出来的就是环（防御性兜底，R-1 upsert 已拒）。
  //    环是链自身的结构问题，不依赖卡，所以先判——别让「卡没导入」掩盖「链成环」。
  const topo = topoOrder(doc)
  if (topo.cycle.length > 0) {
    return failure('cycle', `绑定关系成环，涉及节点：${topo.cycle.join(' → ')}`, [], topo.cycle)
  }

  // 3) 卡是覆盖判定的输入，缺失时无法继续（也不该猜字段）。
  const missingCards: string[] = []
  for (const node of doc.nodes) {
    if (typeof node.card !== 'string' || node.card.length === 0) {
      missingCards.push(`节点 ${node.id} 没有 card 引用`)
      continue
    }
    if (!cards.has(node.card)) {
      missingCards.push(`节点 ${node.id} 引用的卡 ${node.card} 不在项目接口库中`)
    }
  }
  if (missingCards.length > 0) {
    return failure(
      'card-not-imported',
      `${missingCards.join('；')}：先跑 dataforge_library_import 把采集包导入`,
    )
  }

  // 4) 静态缺参一次判完：卡片字段（不覆盖就报，不看 required）+ 链级槽位。
  const runtimeInputs = inputs ?? {}
  const declaredSlots = new Map(doc.inputs.map((input) => [input.name, input]))
  const edgeSlots = slotRefsFromEdges(doc)
  const gapsByNode = new Map<string, StaticGap[]>()
  const notices: string[] = []
  const authGapNodes: string[] = []

  for (const nodeId of topo.order) {
    const node = doc.nodes.find((candidate) => candidate.id === nodeId)
    if (!node) continue
    const card = cards.get(node.card as string) as InterfaceCardDoc
    const covered = coveredPaths(doc, node)
    const gaps = missingInputs(node, card, covered)

    // 凭证字段不报缺参、不发空值；只在 notices 里留一条（R-4 注入）。
    const uncoveredCredentials = (card.inputs ?? []).filter(
      (field) => field.role === 'credential' && !covered.has(normalizePath(field.path)),
    )
    if (uncoveredCredentials.length > 0) {
      authGapNodes.push(`${node.id}（${uncoveredCredentials.map((field) => field.path).join(' / ')}）`)
    }

    // 槽位引用：常量值里的 `$inputs.x` 与边 from 的 `$inputs.x` 都需要运行值。
    const seenSlots = new Set<string>()
    const slotValues = [
      ...Object.values(node.constants ?? {}).map((value) => String(value)),
      ...Object.values(node.files ?? {}),
      ...Object.values(node.hashes ?? {}).map((value) => value.replace(/^(md5|md5-array|sha1):/, '')),
    ]
    for (const value of slotValues) {
      const slot = inputSlotNameOf(value)
      if (slot === undefined || seenSlots.has(slot)) continue
      seenSlots.add(slot)
      const gap = slotGapOf(nodeId, slot, declaredSlots, runtimeInputs)
      if (gap) gaps.push(gap)
    }
    for (const slot of edgeSlots.get(nodeId) ?? []) {
      if (seenSlots.has(slot)) continue
      seenSlots.add(slot)
      const gap = slotGapOf(nodeId, slot, declaredSlots, runtimeInputs)
      if (gap) gaps.push(gap)
    }

    gapsByNode.set(nodeId, gaps)
  }

  const allGaps = topo.order.flatMap((nodeId) => gapsByNode.get(nodeId) ?? [])
  if (allGaps.length > 0) {
    return failure(
      'missing-params',
      `静态缺参 ${allGaps.length} 条（一个请求都不会发）：${describeGaps(allGaps)}`,
      allGaps,
    )
  }
  // 5) baseUrl：只判定，不解析来源（来源推断是 chain_run 的入参优先级问题）。
  //    放在缺参之后：缺参是链定义要改的事，先报更有用（调用方不该重试同一份链）。
  const resolvedBase = resolveBaseUrl(baseUrl)
  const nodesWithoutBase = doc.nodes.filter((node) => node.baseUrl === undefined)
  if (!resolvedBase.ok && nodesWithoutBase.length > 0) {
    return failure('base-url-unresolved', resolvedBase.message)
  }
  const planBaseUrl = resolvedBase.ok ? resolvedBase.baseUrl : ''

  if (authGapNodes.length > 0) {
    notices.push(
      `auth-not-injected：节点 ${authGapNodes.join('、')} 的凭证入参未注入（R-4 负责），引擎不会发送空值`,
    )
  }

  const idSet = new Set(topo.order)
  const dependsOn = new Map<string, string[]>()
  for (const pair of dependencyPairs(doc)) {
    if (!idSet.has(pair.from) || !idSet.has(pair.to)) continue
    const list = dependsOn.get(pair.to) ?? []
    if (!list.includes(pair.from)) list.push(pair.from)
    dependsOn.set(pair.to, list)
  }

  const nodes: PlanNode[] = topo.order.map((nodeId) => {
    const node = doc.nodes.find((candidate) => candidate.id === nodeId) as ChainDoc['nodes'][number]
    const card = cards.get(node.card as string) as InterfaceCardDoc
    return {
      nodeId,
      cardId: card.cardId,
      method: card.identity.method,
      urlTemplate: card.identity.urlTemplate,
      ...(node.baseUrl === undefined ? {} : { baseUrl: resolveBaseUrl(node.baseUrl).ok ? node.baseUrl : node.baseUrl }),
      dependsOn: dependsOn.get(nodeId) ?? [],
      constants: { ...(node.constants ?? {}) },
      gaps: gapsByNode.get(nodeId) ?? [],
    }
  })

  const plan: ExecutionPlan = {
    order: [...topo.order],
    nodes,
    gaps: [],
    baseUrl: planBaseUrl,
    writeNodes: nodes.filter((node) => isWriteMethod(node.method)).map((node) => node.nodeId),
    totalNodes: topo.order.length,
  }
  return { ok: true, plan, notices }
}

/* ------------------------------------------------------------------ 内部 */

function failure(
  code: PlanFailureCode,
  message: string,
  gaps: StaticGap[] = [],
  cycle: string[] = [],
): PlanResult {
  return { ok: false, code, message, gaps, cycle }
}

/** 写方法 = 非 GET/HEAD（大小写不敏感）；用于回执里的写类节点清单与确认纪律。 */
function isWriteMethod(method: string): boolean {
  const normalized = method.trim().toUpperCase()
  return normalized !== 'GET' && normalized !== 'HEAD'
}

type BaseUrlResult = { ok: true; baseUrl: string } | { ok: false; message: string }

/** baseUrl 只判定：缺省、不是合法 URL、或协议不是 http(s) 都算不可解析。 */
function resolveBaseUrl(baseUrl?: string): BaseUrlResult {
  const raw = typeof baseUrl === 'string' ? baseUrl.trim() : ''
  if (raw.length === 0) {
    return { ok: false, message: 'baseUrl 未提供：执行需要一个明确的 http(s) 源（工具入参 baseUrl）' }
  }
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return { ok: false, message: `baseUrl 不是合法的 URL：${raw}` }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, message: `baseUrl 必须是 http(s) 源，实际是 ${parsed.protocol}//：${raw}` }
  }
  return { ok: true, baseUrl: raw }
}

/** 边 `from: $inputs.x` → 终点节点 id 上的槽位引用（槽位不是节点，不能算依赖）。 */
function slotRefsFromEdges(doc: ChainDoc): Map<string, string[]> {
  const refs = new Map<string, string[]>()
  for (const edge of doc.edges) {
    const slot = inputSlotNameOf(edge.from)
    if (slot === undefined) continue
    const to = splitBindingPath(edge.to)
    if (!to) continue
    const list = refs.get(to.nodeId) ?? []
    if (!list.includes(slot)) list.push(slot)
    refs.set(to.nodeId, list)
  }
  return refs
}

/** 槽位没有运行值 → 缺参；`inputs[].required` 不参与判据（引用即需要值）。 */
function slotGapOf(
  nodeId: string,
  slot: string,
  declaredSlots: Map<string, { name: string; type: string }>,
  inputs: Record<string, unknown>,
): StaticGap | undefined {
  if (hasRuntimeValue(inputs, slot)) return undefined
  return {
    nodeId,
    path: `$inputs.${slot}`,
    type: declaredSlots.get(slot)?.type ?? 'unknown',
    target: `$inputs.${slot}`,
  }
}

function hasRuntimeValue(inputs: Record<string, unknown>, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(inputs, name) && inputs[name] !== undefined
}

function describeGaps(gaps: StaticGap[]): string {
  return gaps.map((gap) => `${gap.nodeId} · ${gap.path} · ${gap.type}`).join('；')
}
