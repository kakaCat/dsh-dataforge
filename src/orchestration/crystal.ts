/**
 * 结晶的应用层（R-6 M1）：载链/卡 → 草案 → 决策 → saveChain 新版本 + crystal-run。
 *
 * 写回只走 `saveChain`（R-1 校验 + 版本快照）；本模块不直接写 YAML。
 * 复跑不在这里：结晶后的链直接交给 `dataforge_chain_run` 代入新槽位。
 *
 * @module dsh-dataforge/orchestration/crystal
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ChainDoc } from '../chains/schema.js'
import { saveChain, slugOf } from '../chains/store.js'
import { loadChain } from '../chains/store.js'
import {
  type ChainRunToolDeps,
  cardsForChain,
} from './application.js'
import {
  applyCrystalDraft,
  buildCrystalDraft,
  type CrystalDecision,
  type CrystalDraft,
  type CrystalDraftRow,
} from '../execute/crystal.js'
import { appendEvent, runsRoot, startRunRecord } from '../runs/store.js'
import type { JsonLike } from '../shared/types.js'

type JsonObject = { [key: string]: JsonLike }

export type CrystalToolArgs = {
  site: string
  flow: string
  version?: number
  /** 缺省 = 该 site/flow 最近一组 probe。 */
  explorationId?: string
  /** 没有 confirm=true 只返回草案，绝不写链。 */
  confirm?: boolean
  /** 键 `${nodeId}:${path}`；agent-inferred 行必须带 confirmed:true。 */
  decisions?: Record<string, CrystalDecision>
}

export type CrystalToolValue = {
  ok: boolean
  gate: 'draft' | 'written' | 'blocked'
  code?: string
  message?: string
  draft?: CrystalDraft
  rows?: CrystalDraftRow[]
  inputs?: ChainDoc['inputs']
  version?: number
  path?: string
  runId?: string
  runDir?: string
  issues?: Array<{ target: string; code: string; reason: string }>
  warnings?: string[]
}

/** 工具回执的 JSON 安全投影（CrystalDraft 内部含 unknown 值，不能直接进工具出口）。 */
export type CrystalToolOutput = {
  ok: boolean
  gate: 'draft' | 'written' | 'blocked'
  code?: string
  message?: string
  draft?: JsonObject
  rows?: JsonObject[]
  inputs?: JsonObject[]
  version?: number
  path?: string
  runId?: string
  runDir?: string
  issues?: JsonObject[]
  warnings?: string[]
}

const toJsonObject = (value: unknown): JsonObject => JSON.parse(JSON.stringify(value)) as JsonObject
const toJsonArray = (value: unknown): JsonObject[] => JSON.parse(JSON.stringify(value)) as JsonObject[]

/** 把内部回执转成工具出口可校验的 JSON（递归丢 undefined 由 lossless 再做一次）。 */
export function crystalOutputOf(value: CrystalToolValue): CrystalToolOutput {
  return {
    ok: value.ok,
    gate: value.gate,
    ...(value.code === undefined ? {} : { code: value.code }),
    ...(value.message === undefined ? {} : { message: value.message }),
    ...(value.draft === undefined ? {} : { draft: toJsonObject(value.draft) }),
    ...(value.rows === undefined ? {} : { rows: toJsonArray(value.rows) }),
    ...(value.inputs === undefined ? {} : { inputs: toJsonArray(value.inputs) }),
    ...(value.version === undefined ? {} : { version: value.version }),
    ...(value.path === undefined ? {} : { path: value.path }),
    ...(value.runId === undefined ? {} : { runId: value.runId }),
    ...(value.runDir === undefined ? {} : { runDir: value.runDir }),
    ...(value.issues === undefined ? {} : { issues: toJsonArray(value.issues) }),
    ...(value.warnings === undefined ? {} : { warnings: value.warnings }),
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function newCrystalRunId(dataRoot: string, flow: string, now: number): string {
  const base = `crystal-${slugOf(flow) || 'flow'}-${now}`
  let candidate = base
  let suffix = 2
  while (existsSync(join(runsRoot(dataRoot), candidate))) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  return candidate
}

function auditRow(row: CrystalDraftRow): CrystalDraftRow {
  return row.excluded === undefined ? row : { ...row, value: '***' }
}

/** 结晶工具入口：草案 → 确认 → 写回 → crystal-run。所有失败折成回执，不抛。 */
export async function crystalForTool(
  deps: ChainRunToolDeps,
  exec: unknown,
  args: CrystalToolArgs,
): Promise<CrystalToolValue> {
  if (deps.chain.enabled !== true) {
    return { ok: false, gate: 'blocked', code: 'execution-disabled', message: '执行开关已关闭（config.chainRunEnabled=false）：结晶也拒绝，避免在停执行时改资产' }
  }

  let workspaceRoot: string
  try {
    workspaceRoot = (await deps.resolveWorkspaceRoot(exec)) ?? process.cwd()
  } catch (error) {
    return { ok: false, gate: 'blocked', code: 'crystal-no-source', message: `解析工作区根失败：${messageOf(error)}` }
  }

  const loaded = loadChain(workspaceRoot, args.site, args.flow, {
    ...(args.version === undefined ? {} : { version: args.version }),
  })
  if (!loaded.ok) {
    return {
      ok: false,
      gate: 'blocked',
      code: 'invalid-chain',
      message: loaded.message,
    }
  }
  const doc = loaded.doc
  if (doc.kind !== 'interface-chain') {
    return { ok: false, gate: 'blocked', code: 'invalid-chain', message: `结晶只支持 interface-chain（当前 ${doc.kind}）` }
  }
  const cards = cardsForChain(workspaceRoot, doc)

  const built = buildCrystalDraft({
    dataRoot: deps.dataRoot,
    site: args.site,
    flow: args.flow,
    ...(args.version === undefined ? {} : { version: args.version }),
    ...(args.explorationId === undefined ? {} : { explorationId: args.explorationId }),
    cards,
  })
  if (!built.ok) {
    return {
      ok: false,
      gate: 'blocked',
      code: built.code,
      message: built.message,
      ...(built.row === undefined ? {} : { rows: [built.row] }),
    }
  }
  const draft = built.draft

  // 确认闸：没有 confirm 只返回草案。
  if (args.confirm !== true) {
    return {
      ok: true,
      gate: 'draft',
      code: 'crystal-confirmation-required',
      message: `结晶草案已生成（${draft.rows.length} 行，exploration ${draft.explorationId}）：向用户确认后带 confirm=true 重调；本次没有写链`,
      draft,
      inputs: doc.inputs,
      warnings: draft.warnings,
    }
  }

  const applied = applyCrystalDraft({
    doc,
    cards,
    draft,
    ...(args.decisions === undefined ? {} : { decisions: args.decisions }),
  })
  if (!applied.ok) {
    return {
      ok: false,
      gate: 'blocked',
      code: applied.code,
      message: applied.message,
      ...(applied.row === undefined ? {} : { rows: [applied.row] }),
      draft,
      warnings: draft.warnings,
    }
  }

  const saved = saveChain(workspaceRoot, applied.doc, { source: 'agent' })
  if (!saved.ok) {
    return {
      ok: false,
      gate: 'blocked',
      code: 'invalid-chain',
      message: `结晶后的链未通过 R-1 校验（${saved.issues.length} 条）：没有落盘`,
      issues: saved.issues.map((issue) => ({ target: issue.target, code: issue.code, reason: issue.reason })),
      draft,
      warnings: draft.warnings,
    }
  }

  // 审计留痕：crystal-run（不参与链执行，只回答「谁确认了什么、写了哪一版」）。
  const now = Date.now()
  const runId = newCrystalRunId(deps.dataRoot, args.flow, now)
  const runRecord: Record<string, unknown> = {
    kind: 'crystal-run',
    flow: args.flow,
    flowName: args.flow,
    crystal: {
      site: args.site,
      flow: args.flow,
      explorationId: draft.explorationId,
      decisions: args.decisions ?? {},
      writtenVersion: saved.version,
      path: saved.path,
    },
    draft: draft.rows.map(auditRow),
    startedAt: now,
  }
  const runDir = startRunRecord(deps.dataRoot, runId, runRecord)
  appendEvent(deps.dataRoot, runId, {
    event: 'meta',
    flow: args.flow,
    name: args.flow,
    steps: [],
    dryRun: false,
  })
  appendEvent(deps.dataRoot, runId, {
    event: 'terminal',
    success: true,
    cancelled: false,
    message: `结晶写回 ${args.site}/${args.flow} v${saved.version}`,
  })
  appendEvent(deps.dataRoot, runId, {
    event: 'result',
    success: true,
    businessData: {
      crystal: true,
      explorationId: draft.explorationId,
      version: saved.version,
      path: saved.path,
      inputs: applied.inputs,
    },
  })

  return {
    ok: true,
    gate: 'written',
    message: `结晶已写回 ${args.site}/${args.flow} v${saved.version}（${applied.inputs.length} 个槽位）`,
    draft,
    inputs: applied.inputs,
    version: saved.version,
    path: saved.path,
    runId,
    runDir,
    warnings: applied.warnings,
  }
}
