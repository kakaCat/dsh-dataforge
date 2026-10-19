/**
 * Trace 工具应用层：读 trace / 分析 trace。
 *
 * 与工具壳分离：这里只做参数收口、只读读取、分析结果合并与错误返回；
 * 工具壳负责 schema 与模型可见的渲染。
 *
 * @module dsh-dataforge/trace/application
 */
import { analyzeTrace, type TraceAnalysis } from './analyze.js'
import { buildChainDraft, type ChainDraftFailure, type ChainDraftResult, type ChainDraftWarning } from './draft.js'
import { readTrace, type TraceReadDeps } from './read.js'
import { listCards } from '../library/store.js'
import type { TraceFailure, TraceGetToolValue } from './types.js'

export type TraceDeps = TraceReadDeps

export type ChainDraftDeps = TraceDeps & {
  /** 工作区根：接口库在 `<workspace>/.dsh/dataforge/library`。 */
  resolveWorkspaceRoot: (exec: unknown) => Promise<string | undefined>
}

export type TraceAnalyzeToolValue =
  | {
      ok: true
      captureId: string
      entryUrl: string
      analysis: TraceAnalysis
    }
  | TraceFailure

export type TraceGetArgs = {
  capture_id: string
  limit?: number
  body_limit?: number
}

export type TraceAnalyzeArgs = {
  capture_id: string
  limit?: number
}

export type ChainDraftToolArgs = {
  capture_id: string
  site?: string
  flow?: string
  domain?: string
  note?: string
  limit?: number
}

export type ChainDraftToolValue =
  | {
      ok: true
      captureId: string
      site: string
      flow: string
      domain?: string
      yaml: string
      chain: ChainDraftResult['chain']
      warnings: ChainDraftWarning[]
      validation: ChainDraftResult['validation']
      outputs: ChainDraftResult['outputs']
      coverage: ChainDraftResult['coverage']
    }
  | ChainDraftFailure
  | TraceFailure

export function traceGetForTool(deps: TraceDeps, args: TraceGetArgs): TraceGetToolValue {
  const trace = readTrace(deps, args.capture_id, {
    ...(args.limit === undefined ? {} : { limit: args.limit }),
    ...(args.body_limit === undefined ? {} : { bodyLimit: args.body_limit }),
    redactBodies: true,
    includeBodies: true,
  })
  if ('ok' in trace) return trace
  return {
    ok: true,
    captureId: trace.captureId,
    entryUrl: trace.entryUrl,
    ...(trace.status === undefined ? {} : { status: trace.status }),
    stats: trace.stats,
    samples: trace.samples,
    warnings: trace.warnings,
  }
}

export async function chainDraftForTool(
  deps: ChainDraftDeps,
  exec: unknown,
  args: ChainDraftToolArgs,
): Promise<ChainDraftToolValue> {
  const trace = readTrace(deps, args.capture_id, {
    limit: args.limit ?? 1_000,
    bodyLimit: 65_536,
    redactBodies: false,
    includeBodies: true,
  })
  if ('ok' in trace) return trace
  const workspaceRoot = await deps.resolveWorkspaceRoot(exec)
  if (workspaceRoot === undefined) {
    return { ok: false, code: 'no-workspace', error: '无法解析工作区根：接口库/链文件都按工作区落盘' }
  }
  const analysis = analyzeTrace(trace)
  const cards = listCards(workspaceRoot)
  const built = buildChainDraft(analysis, cards, {
    ...(args.site === undefined ? {} : { site: args.site }),
    ...(args.flow === undefined ? {} : { flow: args.flow }),
    ...(args.domain === undefined ? {} : { domain: args.domain }),
    ...(args.note === undefined ? {} : { note: args.note }),
  })
  if (built.ok !== true) return built
  return {
    ok: true,
    captureId: trace.captureId,
    site: built.site,
    flow: built.flow,
    ...(built.domain === undefined ? {} : { domain: built.domain }),
    yaml: built.yaml,
    chain: built.chain,
    warnings: [...trace.warnings.map((warning) => ({ code: warning.code, message: warning.message })), ...built.warnings],
    validation: built.validation,
    outputs: built.outputs,
    coverage: built.coverage,
  }
}

export function traceAnalyzeForTool(deps: TraceDeps, args: TraceAnalyzeArgs): TraceAnalyzeToolValue {
  const trace = readTrace(deps, args.capture_id, {
    limit: args.limit ?? 1_000,
    bodyLimit: 65_536,
    redactBodies: false,
    includeBodies: true,
  })
  if ('ok' in trace) return trace
  const analysis = analyzeTrace(trace)
  return {
    ok: true,
    captureId: trace.captureId,
    entryUrl: trace.entryUrl,
    analysis: {
      ...analysis,
      warnings: [...trace.warnings, ...analysis.warnings].slice(0, 100),
    },
  }
}
