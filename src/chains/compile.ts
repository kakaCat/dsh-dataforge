/**
 * 页面编排编译：`page-chain` → `interface-chain` 草稿。
 *
 * 决策 Q2（2026-10-17）：页面编排最终编译成接口编排——执行模型只有一种，
 * 浏览器只活在采集期。编译产物**不落盘为正式版本**：它只是草稿，绑定确认权在人
 * （确认后走 IF-2 落盘）。所以这里不保证产物可执行，只保证"该给的建议给了、
 * 拿不准的如实说"。
 *
 * 四步（对应设计「页面编排编译」）：
 *   1. 每个 `page:` 节点 → 查该页面触发的接口卡（按入参指纹分形态）；
 *   2. 页面动线边 → 展开为接口级先后约束（接口链格式没有"纯先后边"，单列在结果里）；
 *   3. 跨节点匹配"上游出参 ≈ 下游入参"（名字 + 类型）生成候选绑定，标 `suggested: true`；
 *   4. 产出 interface-chain 草稿。
 *
 * 依赖注入：页面关系由 `relationsForPage` 提供、卡由 `resolveCard` 提供，
 * 本模块**不 import** `src/capture/` 与 `src/library/`。
 *
 * @module dsh-dataforge/chains/compile
 */
import type { CardIoField, CardResolver, ChainDoc, ChainEdge, ChainNode } from './schema.js'
import {
  CHAIN_API_VERSION,
  fieldLeaf,
  fieldSegments,
  normalizeFieldName,
  splitBindingPath,
} from './schema.js'

/** 一条页面—接口关系（采集期 `page_card_relations` 的结构投影）。 */
export type PageCardRelation = {
  pageUrl: string
  cardId: string
  /** 入参指纹：同页面同卡的不同入参形态各算一条关系。 */
  paramsFingerprint?: string
  relationId?: string
}

export type CompileOptions = {
  /** 页面 URL 模板 → 该页面触发的接口卡关系。 */
  relationsForPage: (pageUrl: string) => PageCardRelation[]
  /** 卡解析器（缺省则不给绑定建议，只做页面展开）。 */
  resolveCard?: CardResolver
}

/** 页面动线展开出的接口级先后约束（草稿里不落成边，因为接口链只有"绑定边"）。 */
export type CompiledPrecedence = {
  from: string
  to: string
  viaPageEdge: { from: string; to: string }
}

export type CompiledChainDraft = {
  /** 接口级草稿；`edges` 全是 `suggested: true` 的候选绑定。 */
  doc: ChainDoc
  /** 采集关系里没有任何接口卡、编译不出接口的页面节点 id。 */
  unresolvedPages: string[]
  /** 接口级先后约束（草稿确认时参考；不是绑定）。 */
  precedence: CompiledPrecedence[]
  /** 编译过程中的如实说明：形态有几种、哪些卡缺席、丢了几条成环建议。 */
  notices: string[]
}

/** 编译入口：输入 page-chain（或任意链，非 page-chain 原样返回并提示）。 */
export function compilePageChain(doc: ChainDoc, options: CompileOptions): CompiledChainDraft {
  const notices: string[] = []
  if (doc.kind !== 'page-chain') {
    notices.push(`输入不是 page-chain（kind=${doc.kind}）：不需要编译，原样返回`)
    return { doc, unresolvedPages: [], precedence: [], notices }
  }

  const resolveCard: CardResolver = options.resolveCard ?? (() => undefined)

  // --- 1. 页面节点 → 接口节点（同页同卡按 cardId 归并；形态多于一种只提示）
  const interfaceIdsOfPage = new Map<string, string[]>()
  const nodes: ChainNode[] = []
  const cardOfNode = new Map<string, string>()
  const unresolvedPages: string[] = []

  for (const pageNode of doc.nodes) {
    const page = pageNode.page ?? ''
    const relations = options.relationsForPage(page) ?? []
    if (relations.length === 0) {
      unresolvedPages.push(pageNode.id)
      interfaceIdsOfPage.set(pageNode.id, [])
      notices.push(`页面节点 ${pageNode.id}（${page}）在采集关系里没有任何接口卡：编译不出接口，留给人补`)
      continue
    }

    const byCard = new Map<string, Set<string>>()
    for (const relation of relations) {
      const fingerprints = byCard.get(relation.cardId) ?? new Set<string>()
      if (relation.paramsFingerprint) fingerprints.add(relation.paramsFingerprint)
      byCard.set(relation.cardId, fingerprints)
    }

    const ids: string[] = []
    for (const [cardId, fingerprints] of byCard) {
      const baseId = `${pageNode.id}--${cardId}`
      let id = baseId
      let suffix = 2
      while (nodes.some((node) => node.id === id)) {
        id = `${baseId}-${suffix}`
        suffix += 1
      }
      nodes.push({ id, card: cardId, constants: {} })
      cardOfNode.set(id, cardId)
      ids.push(id)
      if (fingerprints.size > 1) {
        notices.push(
          `页面 ${page} 上的卡 ${cardId} 有 ${fingerprints.size} 种入参形态（${[...fingerprints].join(' / ')}）：草稿只出一份节点，形态差异需人工确认`,
        )
      }
    }
    interfaceIdsOfPage.set(pageNode.id, ids)
  }

  // --- 2. 动线边 + 同页多卡 → 先后约束
  const precedence: CompiledPrecedence[] = []
  for (const edge of doc.edges) {
    const upstream = interfaceIdsOfPage.get(edge.from) ?? []
    const downstream = interfaceIdsOfPage.get(edge.to) ?? []
    if (upstream.length === 0 || downstream.length === 0) {
      notices.push(`动线 ${edge.from} → ${edge.to} 有一端编译不出接口，先后约束未落地`)
      continue
    }
    for (const from of upstream) {
      for (const to of downstream) {
        precedence.push({ from, to, viaPageEdge: { from: edge.from, to: edge.to } })
      }
    }
  }
  // 同一页面上的多张卡：按关系返回顺序定先后（采集不保证顺序，草稿需人确认）
  for (const [, ids] of interfaceIdsOfPage) {
    if (ids.length < 2) continue
    notices.push(`同一页面上有 ${ids.length} 张卡（${ids.join(' / ')}）：按关系返回顺序排了先后，需人工确认`)
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        precedence.push({
          from: ids[i],
          to: ids[j],
          viaPageEdge: { from: ids[i].split('--')[0], to: ids[j].split('--')[0] },
        })
      }
    }
  }

  // --- 3. 绑定建议（名字 + 类型匹配；增量建图，保证不成环）
  const edges: ChainEdge[] = []
  const takenTargets = new Set<string>()
  let droppedForCycle = 0
  const missingCards = new Set<string>()

  for (const pair of precedence) {
    const upstreamCardId = cardOfNode.get(pair.from)
    const downstreamCardId = cardOfNode.get(pair.to)
    if (!upstreamCardId || !downstreamCardId) continue
    const upstream = resolveCard(upstreamCardId)
    const downstream = resolveCard(downstreamCardId)
    if (!upstream || !downstream) {
      if (!upstream) missingCards.add(upstreamCardId)
      if (!downstream) missingCards.add(downstreamCardId)
      continue
    }
    const downstreamNode = nodes.find((node) => node.id === pair.to)
    for (const output of upstream.outputs ?? []) {
      for (const input of downstream.inputs ?? []) {
        if (!nameAndTypeMatch(output, input)) continue
        const targetKey = `${pair.to}|${fieldSegments(input.path).join('.')}`
        if (takenTargets.has(targetKey)) continue
        if (downstreamNode && Object.prototype.hasOwnProperty.call(downstreamNode.constants, input.path)) continue
        const candidate: ChainEdge = {
          from: `${pair.from}.${output.path}`,
          to: `${pair.to}.${input.path}`,
          suggested: true,
        }
        if (wouldCycle(edges, candidate)) {
          droppedForCycle += 1
          continue
        }
        edges.push(candidate)
        takenTargets.add(targetKey)
      }
    }
  }

  if (missingCards.size > 0) {
    notices.push(`卡 ${[...missingCards].join(' / ')} 不在接口库：跳过它们的绑定建议`)
  }
  if (droppedForCycle > 0) {
    notices.push(`有 ${droppedForCycle} 条候选绑定会让依赖成环，已丢弃（页面动线双向时常见）`)
  }
  if (edges.length === 0) {
    notices.push('没有生成任何候选绑定：要么没有可匹配的字段，要么关系缺失——草稿需要人工绑定')
  }

  // --- 4. 草稿（不落盘）
  const draft: ChainDoc = {
    apiVersion: CHAIN_API_VERSION,
    kind: 'interface-chain',
    meta: { ...doc.meta },
    inputs: doc.inputs.map((input) => ({ ...input })),
    nodes,
    edges,
  }

  return { doc: draft, unresolvedPages, precedence, notices }
}

/** 上游出参 ≈ 下游入参：叶子名相同（或一段是另一段的后缀/包含）且类型相容。 */
function nameAndTypeMatch(output: CardIoField, input: CardIoField): boolean {
  const outName = normalizeFieldName(fieldLeaf(output.path))
  const inName = normalizeFieldName(fieldLeaf(input.path))
  if (outName.length === 0 || inName.length === 0) return false
  const nameHit =
    outName === inName ||
    (outName.length >= 4 &&
      inName.length >= 4 &&
      (outName.endsWith(inName) || inName.endsWith(outName) || outName.includes(inName) || inName.includes(outName)))
  if (!nameHit) return false
  return typesCompatible(output.type, input.type)
}

function typesCompatible(left: string, right: string): boolean {
  const a = String(left ?? '').toLowerCase()
  const b = String(right ?? '').toLowerCase()
  if (a === b) return true
  if (a === 'any' || b === 'any' || a === 'null' || b === 'null' || a === '' || b === '') return true
  return false
}

/** 加这条边会不会成环：从边的终点能不能走回起点。 */
function wouldCycle(edges: ChainEdge[], candidate: ChainEdge): boolean {
  const from = splitBindingPath(candidate.from)?.nodeId
  const to = splitBindingPath(candidate.to)?.nodeId
  if (!from || !to) return false
  if (from === to) return true
  const adjacency = new Map<string, string[]>()
  for (const edge of [...edges, candidate]) {
    const tail = splitBindingPath(edge.from)?.nodeId
    const head = splitBindingPath(edge.to)?.nodeId
    if (!tail || !head) continue
    adjacency.set(tail, [...(adjacency.get(tail) ?? []), head])
  }
  const seen = new Set<string>([to])
  const queue: string[] = [to]
  while (queue.length > 0) {
    const current = queue.shift() as string
    if (current === from) return true
    for (const next of adjacency.get(current) ?? []) {
      if (seen.has(next)) continue
      seen.add(next)
      queue.push(next)
    }
  }
  return false
}
