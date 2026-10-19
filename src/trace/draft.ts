/**
 * S3：TraceAnalysis → interface-chain 草稿。
 *
 * 只做“草稿”：不落正式版本、不执行、不碰目标系统。
 * 业务值不写死：未绑定的请求字段变成链级 input（`$inputs.<name>`），由 agent/用户填写；
 * 绑定边来自 S2 推断；卡片必须已在项目接口库，否则该节点跳过并 warning。
 *
 * @module dsh-dataforge/trace/draft
 */
import {
  CHAIN_API_VERSION, chainToYaml, findDeclaredField, isFieldDeclared,
  type CardResolver, type ChainDoc, type ChainEdge, type ChainExpect, type ChainInput, type ChainIssue,
  type ChainNode, type InterfaceCardDoc,
} from '../chains/schema.js'
import { validateChain } from '../chains/validate.js'
import type { LibraryCard } from '../library/types.js'
import type { TraceAnalysis, TraceInput } from './analyze.js'

export type ChainDraftWarning = {
  code: string
  message: string
  nodeId?: string
  path?: string
}

export type ChainDraftResult = {
  ok: true
  site: string
  flow: string
  domain?: string
  chain: ChainDoc
  yaml: string
  warnings: ChainDraftWarning[]
  validation: { ok: boolean; issues: ChainIssue[] }
  /** 草稿输出候选：现有 chain schema 没有顶层 outputs，先作为草稿元数据交给 agent。 */
  outputs: TraceAnalysis['outputs']
  /** 草稿覆盖率（来自 S2，供 agent 判断还缺什么）。 */
  coverage: TraceAnalysis['coverage']
}

export type ChainDraftFailure = {
  ok: false
  code: 'no-workspace' | 'no-cards' | 'no-nodes'
  error: string
  hints?: string[]
}

export type ChainDraftOptions = {
  site?: string
  flow?: string
  domain?: string
  note?: string
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

function safeFlow(captureId: string): string {
  return `trace-${captureId.replace(/[^A-Za-z0-9_-]/g, '-').slice(-24)}`
}

function safeName(raw: string, used: Set<string>, fallback: string): string {
  const clean = raw.replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+/, '').slice(0, 50)
  const base = clean === '' ? fallback : clean
  if (!used.has(base)) {
    used.add(base)
    return base
  }
  let index = 2
  while (used.has(`${base}_${index}`)) index += 1
  used.add(`${base}_${index}`)
  return `${base}_${index}`
}

function warn(warnings: ChainDraftWarning[], code: string, message: string, nodeId?: string, path?: string): void {
  warnings.push({ code, message, ...(nodeId === undefined ? {} : { nodeId }), ...(path === undefined ? {} : { path }) })
}

function inputTypeOf(input: TraceInput): ChainInput['type'] {
  return input.type === 'number' ? 'number' : input.type === 'boolean' ? 'boolean' : 'string'
}

function expectsOf(analysis: TraceAnalysis, nodeId: string): ChainExpect[] {
  return analysis.assertions
    .filter((item) => item.nodeId === nodeId && item.path !== 'status' && item.path.startsWith('body.'))
    .map((item) => ({ path: item.path, equals: item.equals }))
}

/**
 * 由分析结果 + 项目接口库生成草稿。
 *
 * @param analysis - S2 结果。
 * @param cards - 当前工作区接口库卡片。
 * @param options - site/flow/domain/note；缺省 site=entryUrl host、flow=trace-<captureId>。
 */
export function buildChainDraft(
  analysis: TraceAnalysis,
  cards: readonly LibraryCard[],
  options: ChainDraftOptions = {},
): ChainDraftResult | ChainDraftFailure {
  if (cards.length === 0) {
    return {
      ok: false,
      code: 'no-cards',
      error: '项目接口库为空：先 dataforge_library_import 导入采集卡，再生成链草稿',
      hints: ['接口库在 <workspace>/.dsh/dataforge/library，不读取目标系统数据库'],
    }
  }
  const byMergeKey = new Map<string, LibraryCard>()
  for (const card of cards) byMergeKey.set(card.identity.mergeKey, card)
  const byCardId = new Map<string, LibraryCard>()
  for (const card of cards) byCardId.set(card.cardId, card)
  const resolveCard: CardResolver = (cardId) => byCardId.get(cardId) as InterfaceCardDoc | undefined

  const warnings: ChainDraftWarning[] = []
  const nodeByTraceId = new Map<string, ChainNode>()
  const cardByTraceId = new Map<string, LibraryCard>()
  for (const node of analysis.nodes) {
    const mergeKey = node.mergeKey
    const card = mergeKey === undefined ? undefined : byMergeKey.get(mergeKey)
    if (card === undefined) {
      warn(
        warnings,
        'card-not-imported',
        `${node.method} ${node.path} 没有匹配的接口库卡；该节点未进入草稿（先导入采集卡，或让 agent 补卡）`,
        node.id,
      )
      continue
    }
    const chainNode: ChainNode = { id: node.id, card: card.cardId, constants: {} }
    const expects = expectsOf(analysis, node.id)
    if (expects.length === 1) chainNode.expect = expects[0]
    else if (expects.length > 1) chainNode.expects = expects
    nodeByTraceId.set(node.id, chainNode)
    cardByTraceId.set(node.id, card)
  }

  if (nodeByTraceId.size === 0) {
    return {
      ok: false,
      code: 'no-nodes',
      error: 'trace 里没有任何节点能匹配到接口库卡，无法生成链草稿',
      hints: ['先把该 capture 的接口卡导入接口库（dataforge_library_import），再重试'],
    }
  }

  const usedInputNames = new Set<string>()
  const inputs: ChainInput[] = []
  const inputByPath = new Map<string, ChainInput>()
  for (const input of analysis.inputs) {
    const name = safeName(input.name, usedInputNames, 'input')
    const chainInput: ChainInput = {
      name,
      type: inputTypeOf(input),
      required: input.required,
    }
    inputs.push(chainInput)
    inputByPath.set(input.path, chainInput)
  }

  // 未绑定的请求字段 → 节点常量 $inputs.<slot>（只在卡片确实声明该入参时落）。
  for (const input of analysis.inputs) {
    const chainInput = inputByPath.get(input.path)
    if (chainInput === undefined) continue
    for (const nodeId of input.nodeIds) {
      const card = cardByTraceId.get(nodeId)
      const node = nodeByTraceId.get(nodeId)
      if (card === undefined || node === undefined) continue
      if (!isFieldDeclared(input.path, card.inputs)) {
        warn(warnings, 'input-not-in-card', `${nodeId}.${input.path} 不在卡 ${card.cardId} 的入参模板里；未写入常量`, nodeId, input.path)
        continue
      }
      const field = findDeclaredField(input.path, card.inputs)
      const key = field?.path ?? input.path
      node.constants[key] = `$inputs.${chainInput.name}`
    }
  }
  // 没有任何常量引用的槽位是僵尸槽位：从草稿 inputs 中移除并 warning。
  const referenced = new Set<string>()
  for (const node of nodeByTraceId.values()) {
    for (const value of Object.values(node.constants)) {
      const match = /^\$inputs\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(value)
      if (match !== null) referenced.add(match[1] as string)
    }
  }
  const filteredInputs = inputs.filter((input) => {
    if (referenced.has(input.name)) return true
    warn(warnings, 'unreferenced-input', `输入 ${input.name} 在卡入参里找不到落点，已从草稿移除`, undefined, input.name)
    return false
  })

  const edges: ChainEdge[] = []
  for (const binding of analysis.bindings) {
    const fromNode = nodeByTraceId.get(binding.from.nodeId)
    const toNode = nodeByTraceId.get(binding.to.nodeId)
    const fromCard = cardByTraceId.get(binding.from.nodeId)
    const toCard = cardByTraceId.get(binding.to.nodeId)
    if (fromNode === undefined || toNode === undefined || fromCard === undefined || toCard === undefined) continue
    if (!isFieldDeclared(binding.from.path, fromCard.outputs)) {
      warn(warnings, 'binding-source-not-in-card', `${binding.from.nodeId}.${binding.from.path} 不在卡 ${fromCard.cardId} 的出参模板里；跳过该边`, binding.from.nodeId, binding.from.path)
      continue
    }
    if (!isFieldDeclared(binding.to.path, toCard.inputs)) {
      warn(warnings, 'binding-target-not-in-card', `${binding.to.nodeId}.${binding.to.path} 不在卡 ${toCard.cardId} 的入参模板里；跳过该边`, binding.to.nodeId, binding.to.path)
      continue
    }
    edges.push({
      from: `${binding.from.nodeId}.${binding.from.path}`,
      to: `${binding.to.nodeId}.${binding.to.path}`,
    })
  }

  // 卡上 required 的入参没有常量/绑定 → runtime 会 missing-params，草稿先提示。
  for (const [traceId, card] of cardByTraceId) {
    const node = nodeByTraceId.get(traceId)
    if (node === undefined) continue
    const covered = new Set(Object.keys(node.constants))
    for (const edge of edges) {
      if (edge.to.startsWith(`${traceId}.`)) covered.add(edge.to.slice(traceId.length + 1))
    }
    for (const field of card.inputs) {
      if (field.required !== true) continue
      if ([...covered].some((path) => isFieldDeclared(path, [field]))) continue
      warn(warnings, 'missing-required-input', `${traceId}.${field.path} 是必填入参，但 trace 里没有值/绑定；草稿会缺参`, traceId, field.path)
    }
  }

  const site = (options.site ?? '').trim() || hostOf(analysis.entryUrl) || 'unknown-site'
  const flow = (options.flow ?? '').trim() || safeFlow(analysis.captureId)
  const chain: ChainDoc = {
    apiVersion: CHAIN_API_VERSION,
    kind: 'interface-chain',
    meta: {
      site,
      flow,
      version: 1,
      created: new Date().toISOString(),
      source: 'agent',
      ...(options.domain === undefined || options.domain.trim() === '' ? {} : { domain: options.domain.trim() }),
      ...(options.note === undefined || options.note.trim() === '' ? {} : { note: options.note.trim() }),
    },
    inputs: filteredInputs,
    nodes: [...nodeByTraceId.values()],
    edges,
  }
  const validation = validateChain(chain, { resolveCard })
  const validationOk = validation.ok
  if (!validationOk) {
    for (const issue of validation.issues) {
      warn(warnings, issue.code, `${issue.target}：${issue.reason}`)
    }
  }
  const finalChain = validationOk ? validation.doc : chain
  return {
    ok: true,
    site,
    flow,
    ...(chain.meta.domain === undefined ? {} : { domain: chain.meta.domain }),
    chain: finalChain,
    yaml: chainToYaml(finalChain),
    warnings,
    validation: validationOk ? { ok: true, issues: [] } : { ok: false, issues: validation.issues },
    outputs: analysis.outputs,
    coverage: analysis.coverage,
  }
}
