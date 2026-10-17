/**
 * 探索执行的应用层（R-5 M1）：把「链 + 节点 + 带来源的值」拼成一次 probe。
 *
 * 工具壳只做参数声明与回执；载链、找节点/卡、baseUrl 解析、错误折叠都收在这里。
 * 与整链执行共用同一套 `loadChain` / `cardsForChain` / `resolveChainBaseUrl`，
 * 不另造第二套链读取规则。
 *
 * @module dsh-dataforge/orchestration/explore
 */
import { loadChain } from '../chains/store.js'
import type { ChainDoc } from '../chains/schema.js'
import {
  cardsForChain,
  resolveChainBaseUrl,
  type ChainRunToolDeps,
} from './application.js'
import type { ProbeGap, ProbeResult, ProbeValueInput } from '../execute/probe.js'
import { probeNode } from '../execute/probe.js'

export type ChainProbeToolArgs = {
  site: string
  flow: string
  version?: number
  /** 链上的节点 id。 */
  node: string
  /**
   * 卡字段路径 → { value, source, evidence? }。
   * source 只允许 user / agent-inferred / upstream；后两者必须给 evidence。
   */
  values?: Record<string, ProbeValueInput>
  /** 链级槽位运行值（给节点常量里的 `$inputs.x` 用）。 */
  inputs?: Record<string, unknown>
  baseUrl?: string
  /** 写方法必须显式确认，否则只出计划卡。 */
  confirm?: boolean
  /** 仅幂等方法生效；0..3 封顶。 */
  retry?: number
  explorationId?: string
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function blocked(
  code: ProbeResult['code'],
  message: string,
  extra: Partial<ProbeResult> = {},
): ProbeResult {
  return {
    ok: false,
    gate: 'blocked',
    code,
    message,
    nodeId: '',
    cardId: '',
    method: '',
    ...extra,
  }
}

/** 一次单节点试探（工具入口）。所有失败折成 `ProbeResult`，不抛。 */
export async function probeForTool(
  deps: ChainRunToolDeps,
  exec: unknown,
  args: ChainProbeToolArgs,
): Promise<ProbeResult> {
  if (deps.chain.enabled !== true) {
    return blocked('probe-disabled', '执行开关已关闭（config.chainRunEnabled=false）：probe 一律拒绝')
  }

  let workspaceRoot: string
  try {
    workspaceRoot = (await deps.resolveWorkspaceRoot(exec)) ?? process.cwd()
  } catch (error) {
    return blocked('workspace-unavailable', `解析工作区根失败：${messageOf(error)}`)
  }

  const loaded = loadChain(workspaceRoot, args.site, args.flow, {
    ...(args.version === undefined ? {} : { version: args.version }),
  })
  if (!loaded.ok) {
    return {
      ok: false,
      gate: 'blocked',
      code: loaded.code === 'chain-not-found' ? 'chain-not-found' : 'invalid-chain',
      message: loaded.message,
      nodeId: args.node,
      cardId: '',
      method: '',
    }
  }
  const doc: ChainDoc = loaded.doc
  if (doc.kind !== 'interface-chain') {
    return blocked('invalid-chain', `链 ${doc.meta.site}/${doc.meta.flow} 是 ${doc.kind}：probe 只支持 interface-chain`)
  }

  const node = doc.nodes.find((candidate) => candidate.id === args.node)
  if (node === undefined) {
    const known = doc.nodes.map((candidate) => candidate.id).join('、')
    return blocked('node-not-found', `链上没有节点「${args.node}」；可用节点：${known || '（无）'}`)
  }
  if (typeof node.card !== 'string' || node.card === '') {
    return blocked('card-not-imported', `节点 ${node.id} 没有 card 引用（page-chain 需先编译）`)
  }
  const cards = cardsForChain(workspaceRoot, doc)
  const card = cards.get(node.card)
  if (card === undefined) {
    return blocked('card-not-imported', `节点 ${node.id} 引用的卡 ${node.card} 不在项目接口库：先 dataforge_library_import`)
  }

  const base = resolveChainBaseUrl(doc, cards, args.baseUrl)
  const baseUrl = node.baseUrl ?? (base.ok ? base.baseUrl : undefined)
  if (baseUrl === undefined) {
    return blocked(
      'base-url-unresolved',
      base.ok ? '推不出目标站点源：显式传 baseUrl（卡的来源页面跨多个 origin 时只能人来定）' : base.message,
    )
  }

  return probeNode({
    dataRoot: deps.dataRoot,
    doc,
    node,
    card,
    ...(args.values === undefined ? {} : { values: args.values }),
    ...(args.inputs === undefined ? {} : { chainInputs: args.inputs }),
    baseUrl,
    ...(args.confirm === undefined ? {} : { confirm: args.confirm }),
    ...(args.retry === undefined ? {} : { retry: args.retry }),
    ...(args.explorationId === undefined ? {} : { explorationId: args.explorationId }),
    config: {
      nodeTimeoutSeconds: deps.chain.nodeTimeoutSeconds,
      responseLimitBytes: deps.chain.responseLimitBytes,
    },
    ...(deps.credentials === undefined ? {} : { credentials: deps.credentials }),
  })
}

/** 给工具回执用的缺参行（与 `ProbeGap` 同形，导出便于测试）。 */
export type ProbeGapRow = ProbeGap
