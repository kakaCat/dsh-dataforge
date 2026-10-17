/**
 * 链的语义校验：schema 之外的检查全在这（悬空卡引用、成环、绑定字段存在性、
 * 绑定与常量互斥、僵尸槽位）。
 *
 * 卡引用走注入的 `CardResolver`：本模块**不 import** `src/library/**`，
 * 谁是卡由调用方给（解耦缝）。测试用内存假卡，工具用接口库读盘。
 *
 * 报错纪律：能报的全报完再返回（不 fail-fast），每条指到 `nodes[i]` / `edges[j]`
 * 并给中文原因——agent 逐条改一次过，比来回试快。
 *
 * @module dsh-dataforge/chains/validate
 */
import type {
  CardResolver,
  ChainDoc,
  ChainIssue,
  ChainParseResult,
  InterfaceCardDoc,
} from './schema.js'
import {
  CHAIN_API_VERSION,
  CHAIN_VALUE_TYPES,
  fieldSegments,
  inputSlotNameOf,
  isDeclaredContainer, isFieldDeclared,
  isInputSlotRef,
  parseChainDoc,
  parseChainYaml,
  splitBindingPath,
} from './schema.js'

export type ValidateOptions = {
  /** 卡引用解析器（必给：不给就是没接接口库，悬空引用必须显式判定）。 */
  resolveCard: CardResolver
}

/** 原始值（YAML 已解析 / 工具入参）→ 校验通过的 ChainDoc；问题逐条返回。 */
export function validateChain(input: unknown, options: ValidateOptions): ChainParseResult {
  const parsed = parseChainDoc(input)
  if (!parsed.ok) return parsed
  const issues = checkChain(parsed.doc, options.resolveCard)
  return issues.length === 0 ? { ok: true, doc: parsed.doc } : { ok: false, issues }
}

/** 链 YAML 文本 → 校验通过的 ChainDoc（IF-2 的入口）。 */
export function validateChainYaml(text: string, options: ValidateOptions): ChainParseResult {
  const parsed = parseChainYaml(text)
  if (!parsed.ok) return parsed
  const issues = checkChain(parsed.doc, options.resolveCard)
  return issues.length === 0 ? { ok: true, doc: parsed.doc } : { ok: false, issues }
}

/** 全量语义检查（纯函数，无 IO）。 */
export function checkChain(doc: ChainDoc, resolveCard: CardResolver): ChainIssue[] {
  const issues: ChainIssue[] = []

  if (doc.apiVersion !== CHAIN_API_VERSION) {
    issues.push({
      target: 'chain',
      code: 'invalid-chain',
      reason: `apiVersion 必须是 ${CHAIN_API_VERSION}，实际是 ${String(doc.apiVersion)}`,
    })
  }
  if (doc.nodes.length === 0) {
    issues.push({ target: 'nodes', code: 'invalid-chain', reason: '链至少要有一个节点' })
  }

  // --- 节点 id：非空、不带 '.'（绑定路径靠它分隔）、链内唯一
  const nodeIds = new Set<string>()
  doc.nodes.forEach((node, index) => {
    const target = `nodes[${index}]`
    const id = typeof node.id === 'string' ? node.id.trim() : ''
    if (id.length === 0) {
      issues.push({ target, code: 'bad-node-id', reason: '节点 id 不能为空' })
      return
    }
    if (id.includes('.')) {
      issues.push({
        target,
        code: 'bad-node-id',
        reason: `节点 id 不能含 '.'（绑定路径用它分隔节点与字段）：${id}`,
      })
    }
    if (nodeIds.has(id)) {
      issues.push({ target, code: 'duplicate-node-id', reason: `节点 id 重复：${id}` })
    }
    nodeIds.add(id)
  })

  // --- 节点形态必须与 kind 一致，且 card / page 互斥
  doc.nodes.forEach((node, index) => {
    const target = `nodes[${index}]`
    const hasCard = typeof node.card === 'string' && node.card.length > 0
    const hasPage = typeof node.page === 'string' && node.page.length > 0
    if (hasCard && hasPage) {
      issues.push({
        target,
        code: 'node-kind-mismatch',
        reason: `节点 ${node.id} 同时写了 card 与 page：一份链只能取一种形态`,
      })
      return
    }
    if (doc.kind === 'interface-chain' && !hasCard) {
      issues.push({
        target,
        code: 'node-kind-mismatch',
        reason: `interface-chain 的节点 ${node.id} 必须写 card（引用的接口卡 ID）`,
      })
      return
    }
    if (doc.kind === 'page-chain' && !hasPage) {
      issues.push({
        target,
        code: 'node-kind-mismatch',
        reason: `page-chain 的节点 ${node.id} 必须写 page（页面 URL 模板）`,
      })
    }
  })

  // --- 卡引用（仅 interface-chain）：解析不到的卡是硬错误，提示先跑导入
  const cards = new Map<string, InterfaceCardDoc>()
  if (doc.kind === 'interface-chain') {
    doc.nodes.forEach((node, index) => {
      if (typeof node.card !== 'string' || node.card.length === 0) return
      const card = resolveCard(node.card)
      if (!card) {
        issues.push({
          target: `nodes[${index}]`,
          code: 'card-not-imported',
          reason: `节点 ${node.id} 引用的卡 ${node.card} 不在项目接口库中：先跑 dataforge_library_import 把采集包导入`,
        })
        return
      }
      cards.set(node.id, card)
    })
  }

  // --- 节点级 baseUrl / hash 规格
  doc.nodes.forEach((node, index) => {
    if (node.baseUrl !== undefined) {
      try {
        const url = new URL(node.baseUrl)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          issues.push({ target: `nodes[${index}]`, code: 'invalid-chain', reason: `节点 ${node.id} 的 baseUrl 必须是 http(s)：${node.baseUrl}` })
        }
      } catch {
        issues.push({ target: `nodes[${index}]`, code: 'invalid-chain', reason: `节点 ${node.id} 的 baseUrl 不是合法 URL：${node.baseUrl}` })
      }
    }
    for (const [field, spec] of Object.entries(node.hashes ?? {})) {
      if (!/^(md5|md5-array|sha1):.+/.test(spec)) {
        issues.push({ target: `nodes[${index}]`, code: 'invalid-chain', reason: `节点 ${node.id} 的 hash 字段 ${field} 规格非法：${spec}（只支持 md5:/md5-array:/sha1: + 文件路径）` })
      }
    }
  })

  // --- 链级入参槽位：名字唯一、类型在词表内
  const declaredSlots = new Set<string>()
  doc.inputs.forEach((input, index) => {
    const target = `inputs[${index}]`
    if (declaredSlots.has(input.name)) {
      issues.push({ target, code: 'duplicate-input-slot', reason: `槽位名重复：${input.name}` })
    }
    declaredSlots.add(input.name)
    if (!(CHAIN_VALUE_TYPES as readonly string[]).includes(input.type)) {
      issues.push({
        target,
        code: 'invalid-input-type',
        reason: `槽位 ${input.name} 的类型 ${input.type} 不在词表内：${CHAIN_VALUE_TYPES.join(' / ')}`,
      })
    }
  })

  // --- 槽位引用（常量值）+ 僵尸槽位（声明了没人用）
  const referencedSlots = new Set<string>()
  const constantsOf = new Map<string, Set<string>>()
  doc.nodes.forEach((node, index) => {
    const target = `nodes[${index}]`
    const keys = new Set<string>()
    for (const [key, value] of Object.entries(node.constants ?? {})) {
      keys.add(fieldSegments(key).join('.'))
      const slot = inputSlotNameOf(value)
      if (slot === undefined) continue
      referencedSlots.add(slot)
      if (!declaredSlots.has(slot)) {
        issues.push({
          target,
          code: 'unknown-input-slot',
          reason: `节点 ${node.id} 的常量 ${key} 引用了未声明的槽位 $inputs.${slot}`,
        })
      }
    }
    for (const [key, value] of [...Object.entries(node.files ?? {}), ...Object.entries(node.hashes ?? {})]) {
      const slot = inputSlotNameOf(value.replace(/^(md5|md5-array|sha1):/, ''))
      if (slot === undefined) continue
      referencedSlots.add(slot)
      if (!declaredSlots.has(slot)) {
        issues.push({
          target,
          code: 'unknown-input-slot',
          reason: `节点 ${node.id} 的文件/hash 字段 ${key} 引用了未声明的槽位 $inputs.${slot}`,
        })
      }
    }
    constantsOf.set(node.id, keys)
  })

  // --- 边
  if (doc.kind === 'page-chain') {
    checkPageEdges(doc, nodeIds, issues)
  } else {
    checkInterfaceEdges(doc, nodeIds, cards, constantsOf, declaredSlots, referencedSlots, issues)
  }

  // --- 僵尸槽位：声明了但没有任何节点入参引用
  doc.inputs.forEach((input, index) => {
    if (!referencedSlots.has(input.name)) {
      issues.push({
        target: `inputs[${index}]`,
        code: 'unreferenced-input-slot',
        reason: `槽位 ${input.name} 没有任何节点入参引用（僵尸槽位：要么接到某个节点的入参，要么删掉）`,
      })
    }
  })

  // --- 成环（Kahn 兜底）
  const cycle = cycleOf(doc)
  if (cycle.length > 0) {
    issues.push({
      target: 'edges',
      code: 'cycle',
      reason: `绑定关系成环，涉及节点：${cycle.join(' → ')}（绑定即依赖，环意味着谁先跑都拿不到上游值）`,
    })
  }

  return issues
}

/** page-chain：边是页面动线（节点 id → 节点 id）。 */
function checkPageEdges(doc: ChainDoc, nodeIds: Set<string>, issues: ChainIssue[]): void {
  doc.edges.forEach((edge, index) => {
    const target = `edges[${index}]`
    if (!nodeIds.has(edge.from)) {
      issues.push({ target, code: 'unknown-node', reason: `动线起点节点不存在：${edge.from}` })
    }
    if (!nodeIds.has(edge.to)) {
      issues.push({ target, code: 'unknown-node', reason: `动线终点节点不存在：${edge.to}` })
    }
  })
}

/** interface-chain：边是绑定声明（节点.字段 → 节点.字段，from 可为槽位引用）。 */
function checkInterfaceEdges(
  doc: ChainDoc,
  nodeIds: Set<string>,
  cards: Map<string, InterfaceCardDoc>,
  constantsOf: Map<string, Set<string>>,
  declaredSlots: Set<string>,
  referencedSlots: Set<string>,
  issues: ChainIssue[],
): void {
  doc.edges.forEach((edge, index) => {
    const target = `edges[${index}]`

    // from：槽位引用 或 节点.出参路径
    const slot = inputSlotNameOf(edge.from)
    if (slot !== undefined) {
      referencedSlots.add(slot)
      if (!declaredSlots.has(slot)) {
        issues.push({
          target,
          code: 'unknown-input-slot',
          reason: `边的 from 引用了未声明的槽位 ${edge.from}`,
        })
      }
    } else {
      const from = splitBindingPath(edge.from)
      if (!from) {
        issues.push({
          target,
          code: 'bad-binding-path',
          reason: `边的 from 必须是 <节点 id>.<出参路径> 或 $inputs.<槽位名>，实际是 ${edge.from}`,
        })
      } else if (!nodeIds.has(from.nodeId)) {
        issues.push({ target, code: 'unknown-node', reason: `边的起点节点不存在：${from.nodeId}` })
      } else {
        const card = cards.get(from.nodeId)
        if (card && !isFieldDeclared(from.fieldPath, card.outputs) && !(edge.pick !== undefined && isDeclaredContainer(from.fieldPath, card.outputs))) {
          issues.push({
            target,
            code: 'unknown-source-field',
            reason: `${edge.from} 不在卡 ${card.cardId} 的出参模板里（卡模板里没有这个字段）`,
          })
        }
      }
    }

    // to：节点.入参路径，且与节点常量互斥
    const to = splitBindingPath(edge.to)
    if (!to) {
      issues.push({
        target,
        code: 'bad-binding-path',
        reason: `边的 to 必须是 <节点 id>.<入参路径>，实际是 ${edge.to}`,
      })
      return
    }
    if (!nodeIds.has(to.nodeId)) {
      issues.push({ target, code: 'unknown-node', reason: `边的终点节点不存在：${to.nodeId}` })
      return
    }
    const normalized = fieldSegments(to.fieldPath).join('.')
    if (constantsOf.get(to.nodeId)?.has(normalized)) {
      issues.push({
        target,
        code: 'binding-constant-conflict',
        reason: `${edge.to} 同时被绑定边与节点常量赋值：绑定与常量互斥`,
      })
      return
    }
    const card = cards.get(to.nodeId)
    if (card && !isFieldDeclared(to.fieldPath, card.inputs)) {
      issues.push({
        target,
        code: 'unknown-target-field',
        reason: `${edge.to} 不在卡 ${card.cardId} 的入参模板里（卡模板里没有这个字段）`,
      })
    }
  })
}

/* ------------------------------------------------------------------ 拓扑 */

/** 边 → 依赖对（from 节点先于 to 节点）；槽位引用不是依赖，跳过。 */
export function dependencyPairs(doc: ChainDoc): Array<{ from: string; to: string }> {
  const pairs: Array<{ from: string; to: string }> = []
  for (const edge of doc.edges) {
    if (doc.kind === 'page-chain') {
      pairs.push({ from: edge.from, to: edge.to })
      continue
    }
    const from = splitBindingPath(edge.from)
    const to = splitBindingPath(edge.to)
    // 槽位边（`from: $inputs.x`）不是节点依赖。别看 `splitBindingPath` 会把它解析成
    // `{nodeId:'$inputs'}`，漏了这一句就会吐出 `{from:'$inputs'}` 的幻影依赖：拓扑那边
    // 靠 `indegree.has` 侥幸躲过，但任何直接用依赖对的消费者（执行引擎的调度/就绪队列）
    // 都会去等一个永不存在的上游节点。
    if (isInputSlotRef(edge.from)) continue
    if (from && to) pairs.push({ from: from.nodeId, to: to.nodeId })
  }
  return pairs
}

export type TopoResult = {
  /** 拓扑序（能排出来的节点；有环时是不含环的那部分）。 */
  order: string[]
  /** 排不进去的节点（即成环节点），无环为空。 */
  cycle: string[]
}

/** Kahn 排序：绑定即依赖，排不出来就是有环。 */
export function topoOrder(doc: ChainDoc): TopoResult {
  const ids = doc.nodes.map((node) => node.id).filter((id) => id.length > 0)
  const indegree = new Map<string, number>()
  const outgoing = new Map<string, string[]>()
  for (const id of ids) {
    indegree.set(id, indegree.get(id) ?? 0)
    outgoing.set(id, outgoing.get(id) ?? [])
  }
  for (const pair of dependencyPairs(doc)) {
    if (!indegree.has(pair.from) || !indegree.has(pair.to)) continue
    indegree.set(pair.to, (indegree.get(pair.to) ?? 0) + 1)
    outgoing.get(pair.from)?.push(pair.to)
  }
  const queue = ids.filter((id) => (indegree.get(id) ?? 0) === 0)
  const order: string[] = []
  while (queue.length > 0) {
    const id = queue.shift() as string
    order.push(id)
    for (const next of outgoing.get(id) ?? []) {
      const left = (indegree.get(next) ?? 0) - 1
      indegree.set(next, left)
      if (left === 0) queue.push(next)
    }
  }
  return { order, cycle: ids.filter((id) => !order.includes(id)) }
}

function cycleOf(doc: ChainDoc): string[] {
  return topoOrder(doc).cycle
}

/* ------------------------------------------------------- 凭证红线（提示项） */

/** 明显是凭证名的常量键（叶子名精确匹配，避免误杀 `body.token` 之类业务字段）。 */
const CREDENTIAL_LEAVES = new Set([
  'cookie',
  'cookies',
  'authorization',
  'token',
  'accesstoken',
  'password',
  'secret',
  'apikey',
  'sessionid',
])

/**
 * 常量里疑似凭证的键：**只提示不阻断**（FR-1.6 的硬保证来自格式本身没有凭证字段；
 * 这里防的是人手滑把 token 贴进 constants）。
 */
export function scanCredentialConstants(doc: ChainDoc): ChainIssue[] {
  const issues: ChainIssue[] = []
  doc.nodes.forEach((node, index) => {
    for (const key of Object.keys(node.constants ?? {})) {
      const leaf = fieldSegments(key).pop() ?? ''
      const flat = leaf.toLowerCase().replace(/[^a-z0-9]/g, '')
      if (CREDENTIAL_LEAVES.has(flat)) {
        issues.push({
          target: `nodes[${index}]`,
          code: 'credential-in-constants',
          reason: `节点 ${node.id} 的常量 ${key} 看着是凭证字段：链与接口库零凭证，凭证请走 R-4 的凭证注入`,
        })
      }
    }
  })
  return issues
}
