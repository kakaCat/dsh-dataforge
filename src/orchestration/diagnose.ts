/**
 * 复跑诊断（R-6 M2）：读一条失败的链运行，回答「断在哪个节点、哪条绑定边、
 * 上游是什么状态、下一步该改什么」。
 *
 * 只读：不重跑、不改链、不碰凭证。R-3 已经把失败节点/错误码/响应摘要写进事件，
 * 这里只做投影与定位，不发明第二套执行语义。
 *
 * @module dsh-dataforge/orchestration/diagnose
 */
import type { ChainDoc } from '../chains/schema.js'
import { splitBindingPath } from '../chains/schema.js'
import { loadChain } from '../chains/store.js'
import { foldSummary, loadRunEvents, readRunRecord } from '../runs/store.js'
import type { BridgeEvent } from '../shared/types.js'
import type { ChainRunToolDeps } from './application.js'
import type { JsonLike } from '../shared/types.js'

type JsonObject = { [key: string]: JsonLike }

export type DiagnoseToolArgs = { runId: string }

export type DiagnoseNode = {
  nodeId: string
  status: 'done' | 'error' | 'started' | 'skipped'
  httpStatus?: number
  attempts?: number
  elapsedMs?: number
  errorCode?: string
  error?: string
}

export type DiagnoseEdge = {
  from: string
  to: string
  sourceNode: string
  sourceStatus: string
  suspect: boolean
  reason?: string
}

export type DiagnoseToolValue = {
  ok: boolean
  code?: string
  message?: string
  runId: string
  status?: string
  chain?: { site: string; flow: string; version: number }
  params?: Record<string, unknown>
  failedNode?: string
  errorCode?: string
  error?: string
  nodes?: DiagnoseNode[]
  failed?: {
    action?: string
    request?: Record<string, unknown>
    response?: Record<string, unknown>
  }
  edges?: DiagnoseEdge[]
  hints?: string[]
}

/** 工具回执的 JSON 安全投影（内部事件的 unknown 值不能直接进工具出口）。 */
export type DiagnoseToolOutput = {
  ok: boolean
  code?: string
  message?: string
  runId: string
  status?: string
  chain?: JsonObject
  params?: JsonObject
  failedNode?: string
  errorCode?: string
  error?: string
  nodes?: JsonObject[]
  failed?: JsonObject
  edges?: JsonObject[]
  hints?: string[]
}

export function diagnoseOutputOf(value: DiagnoseToolValue): DiagnoseToolOutput {
  return JSON.parse(JSON.stringify(value)) as DiagnoseToolOutput
}

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

function nodeSummaries(events: BridgeEvent[]): DiagnoseNode[] {
  const map = new Map<string, DiagnoseNode>()
  for (const event of events) {
    if (event.event !== 'step' || event.id === undefined) continue
    const nodeId = event.id
    const data = plainRecord(event.data)
    const existing = map.get(nodeId) ?? { nodeId, status: 'started' }
    if (event.status === 'start') {
      map.set(nodeId, { ...existing, status: 'started' })
      continue
    }
    if (event.status === 'done') {
      const response = plainRecord(data?.['response'])
      map.set(nodeId, {
        nodeId,
        status: 'done',
        ...(numberOrUndefined(response?.['status']) === undefined ? {} : { httpStatus: numberOrUndefined(response?.['status']) }),
        ...(numberOrUndefined(data?.['attempts']) === undefined ? {} : { attempts: numberOrUndefined(data?.['attempts']) }),
        ...(numberOrUndefined(event.elapsed) === undefined ? {} : { elapsedMs: numberOrUndefined(event.elapsed) }),
      })
      continue
    }
    if (event.status === 'error') {
      const response = plainRecord(data?.['response'])
      map.set(nodeId, {
        nodeId,
        status: 'error',
        ...(numberOrUndefined(response?.['status']) === undefined ? {} : { httpStatus: numberOrUndefined(response?.['status']) }),
        ...(numberOrUndefined(data?.['attempts']) === undefined ? {} : { attempts: numberOrUndefined(data?.['attempts']) }),
        ...(numberOrUndefined(event.elapsed) === undefined ? {} : { elapsedMs: numberOrUndefined(event.elapsed) }),
        ...(stringOf(data?.['code']) === undefined ? {} : { errorCode: stringOf(data?.['code']) }),
        ...(event.error === undefined ? {} : { error: event.error }),
      })
    }
  }
  return [...map.values()]
}

function hintsOf(errorCode: string | undefined): string[] {
  if (errorCode === undefined) return []
  if (errorCode.startsWith('binding-') || errorCode === 'empty-wildcard') {
    return [
      '绑定断点：先 probe 上游节点，核对 outputs 里该路径是否真的存在',
      '确认 from 路径（[*]/[0]）与上游响应结构一致；必要时重新采集刷新卡模板',
    ]
  }
  if (errorCode === 'node-auth-required') {
    return [
      '鉴权失败：确认 cookie/token 是否注入；过期时用 dataforge_chain_run 的 relogin 换票',
      '仍失败就重新采集登录态，不要把凭证手写进链',
    ]
  }
  if (errorCode.startsWith('relogin-')) {
    return ['换票失败：检查登录链（site/flow/inputs）与账号权限；修好后用新 run 重跑']
  }
  if (errorCode === 'node-http-error' || errorCode === 'node-timeout' || errorCode === 'node-network-error') {
    return ['看 response.bodyPreview 与状态码；改入参/补绑定后重跑，不自动重放写请求']
  }
  if (errorCode === 'missing-params' || errorCode === 'inputs-invalid') {
    return ['补齐链级 inputs/节点常量；结晶后的链应只有槽位和常量，不应再有裸值']
  }
  return []
}

/** 诊断一条链运行（只读）。 */
export async function diagnoseForTool(
  deps: ChainRunToolDeps,
  exec: unknown,
  args: DiagnoseToolArgs,
): Promise<DiagnoseToolValue> {
  const runId = args.runId.trim()
  if (runId === '') return { ok: false, code: 'invalid-run-id', message: 'runId 不能为空', runId }

  const record = readRunRecord(deps.dataRoot, runId)
  if (record === undefined) {
    return { ok: false, code: 'run-not-found', message: `没有找到运行 ${runId}`, runId }
  }
  if (record['kind'] !== 'chain-run') {
    return {
      ok: false,
      code: 'not-a-chain-run',
      message: `运行 ${runId} 不是链运行（kind=${String(record['kind'])}）：诊断只针对 dataforge_chain_run 的留痕`,
      runId,
    }
  }
  const events = loadRunEvents(deps.dataRoot, runId)
  if (events === undefined || events.length === 0) {
    return { ok: false, code: 'run-not-found', message: `运行 ${runId} 还没有事件留痕`, runId }
  }

  const summary = foldSummary(runId, events)
  const chain = summary.chain
  const chainRecord = plainRecord(record['chain'])
  const site = chain?.site ?? stringOf(chainRecord?.['site']) ?? ''
  const flow = chain?.flow ?? stringOf(chainRecord?.['flow']) ?? ''
  const version = chain?.version ?? numberOrUndefined(chainRecord?.['version'])
  const failedNode = chain?.failedNode ?? summary.lastStepId
  const nodes = nodeSummaries(events)
  const failedNodeInfo = nodes.find((node) => node.nodeId === failedNode)
  const errorCode = failedNodeInfo?.errorCode
  const error = failedNodeInfo?.error ?? summary.lastError

  // 从事件里取失败节点的请求/响应摘要（R-3 已写；没有就留空）。
  const failedStart = events.find(
    (event) => event.event === 'step' && event.id === failedNode && event.status === 'start',
  )
  const failedEnd = events.find(
    (event) => event.event === 'step' && event.id === failedNode && event.status !== 'start',
  )
  const startData = plainRecord(failedStart?.data)
  const endData = plainRecord(failedEnd?.data)
  const request = plainRecord(startData?.['request'])
  const response = plainRecord(endData?.['response'])

  // 绑定边：链文件可读时列出入边，标出可疑的那条。
  let edges: DiagnoseEdge[] = []
  const hints = hintsOf(errorCode)
  if (failedNode !== undefined && site !== '' && flow !== '' && version !== undefined) {
    const workspaceRoot = (await deps.resolveWorkspaceRoot(exec)) ?? process.cwd()
    const loaded = loadChain(workspaceRoot, site, flow, { version })
    if (!loaded.ok) {
      hints.push(`链文件不可读（v${version}）：${loaded.message}；只能按事件留痕诊断`)
    } else {
      edges = edgesInto(loaded.doc, failedNode, nodes, error)
      if (edges.length === 0) hints.push(`节点 ${failedNode} 没有入边：失败不是绑定造成的，先看请求/响应`)
    }
  }

  return {
    ok: true,
    runId,
    status: summary.status,
    ...(site === '' ? {} : { chain: { site, flow, version: version ?? 0 } }),
    ...(plainRecord(record['params']) === undefined ? {} : { params: plainRecord(record['params']) }),
    ...(failedNode === undefined ? {} : { failedNode }),
    ...(errorCode === undefined ? {} : { errorCode }),
    ...(error === undefined ? {} : { error }),
    nodes,
    ...(failedNode === undefined
      ? {}
      : {
          failed: {
            ...(typeof failedStart?.action === 'string' ? { action: failedStart.action } : {}),
            ...(request === undefined ? {} : { request }),
            ...(response === undefined ? {} : { response }),
          },
        }),
    edges,
    ...(hints.length === 0 ? {} : { hints }),
  }
}

function edgesInto(doc: ChainDoc, failedNode: string, nodes: DiagnoseNode[], error: string | undefined): DiagnoseEdge[] {
  const statusOf = new Map(nodes.map((node) => [node.nodeId, node.status]))
  const edges: DiagnoseEdge[] = []
  for (const edge of doc.edges) {
    const to = splitBindingPath(edge.to)
    if (to === undefined || to.nodeId !== failedNode) continue
    const from = splitBindingPath(edge.from)
    const sourceNode = from?.nodeId ?? ''
    const sourceStatus = statusOf.get(sourceNode) ?? 'unknown'
    const suspect = error !== undefined && (error.includes(edge.from) || error.includes(`${edge.from} → ${edge.to}`))
    const reason =
      sourceStatus === 'error'
        ? `上游节点 ${sourceNode} 失败`
        : suspect
          ? '错误消息指向这条绑定边'
          : undefined
    edges.push({
      from: edge.from,
      to: edge.to,
      sourceNode,
      sourceStatus,
      suspect,
      ...(reason === undefined ? {} : { reason }),
    })
  }
  return edges
}
