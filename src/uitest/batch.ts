/**
 * UI 批量回归：选脚本 → 逐条回放 → 汇总通过/失败 → 落报告。
 *
 * 与单次 `runUiScript` 的关系：批次不重新实现回放，只做「选哪些、按什么顺序、怎么汇总」；
 * 每条脚本的回放/断言/截图/run 留痕完全复用单次执行（runId 一一对应）。
 *
 * 为什么默认串行：一个 Chrome 实例 = 一份内存/CPU；并发回放很容易把同一台机器打满，
 * 而 UI 回归的价值在"稳定"不在"快"。并发留给后续版本（要配合队列与资源上限）。
 *
 * 设计取舍：缺必填入参的脚本**不静默跳过**——在计划卡里列出，执行时记 `skipped + 原因`，
 * 最终计入 failed/skipped 而不是从总数里消失。
 *
 * @module dsh-dataforge/uitest/batch
 */
import { listUiScripts, loadUiScript } from './store.js'
import { missingInputsOf, type UiScriptDoc } from './schema.js'
import {
  finishUiBatch, startUiBatch, writeUiBatchReport,
  type UiBatchItemResult, type UiBatchRecord,
} from './batch-store.js'
import type { UiRunResult } from './run.js'

/** 批次选择口径。 */
export type UiBatchSelection = 'flows' | 'site' | 'all'

/** 批量入口参数。 */
export type UiBatchArgs = {
  /** 按站点过滤（与 flows 互斥，flows 优先）。 */
  site?: string
  /** 显式流程列表：`site/flow` 或 `site/flow@3`。 */
  flows?: string[]
  /** 所有脚本共用的入参槽位值。 */
  inputs?: Record<string, string>
  /** 最多跑多少条（缺省 20，硬上限 50）。 */
  limit?: number
}

/** 计划里的一条脚本（不含 doc，工具回执可安全透出）。 */
export type UiBatchPlanItem = {
  index: number
  site: string
  flow: string
  version?: number
  stepCount: number
  /** 可能写业务的步骤数（click/submit/upload）。 */
  writeSteps: number
  /** 缺的必填入参（非空则执行时跳过并记失败原因）。 */
  missing: string[]
  error?: string
}

/** 计划卡。 */
export type UiBatchPlan = {
  selection: UiBatchSelection
  site?: string
  total: number
  limit: number
  items: UiBatchPlanItem[]
  /** 所有条目缺参的并集（去重保序）。 */
  missingInputs: string[]
  /** 本次选中的脚本里可能写业务的步骤总数。 */
  writeSteps: number
}

type PlanEntry = { item: UiBatchPlanItem; doc?: UiScriptDoc; inputs: Record<string, string> }

export type UiBatchPlanResult =
  | { ok: true; plan: UiBatchPlan; entries: PlanEntry[] }
  | { ok: false; message: string }

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

/** `site/flow` 或 `site/flow@3` → {site, flow, version?}（站点名里可能有空格，取最后一个 `/`）。 */
function parseFlowRef(text: string): { site: string; flow: string; version?: number } | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  const at = trimmed.lastIndexOf('@')
  let version: number | undefined
  let base = trimmed
  if (at > 0) {
    const parsed = Number(trimmed.slice(at + 1))
    if (Number.isInteger(parsed) && parsed >= 1) {
      version = parsed
      base = trimmed.slice(0, at)
    }
  }
  const slash = base.lastIndexOf('/')
  if (slash <= 0 || slash === base.length - 1) return undefined
  return { site: base.slice(0, slash).trim(), flow: base.slice(slash + 1).trim(), ...(version === undefined ? {} : { version }) }
}

function normalizeInputs(raw: Record<string, string> | undefined): Record<string, string> {
  if (raw === undefined) return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') out[key] = value
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = String(value)
  }
  return out
}

/**
 * 选脚本并生成计划（不跑浏览器）。
 *
 * 缺参/坏文件不抛，写进条目的 `missing` / `error`，由执行阶段记为跳过/失败——
 * 计划卡里先让用户看到"这轮会跑什么、哪些跑不了"。
 */
export function planUiBatch(workspaceRoot: string, args: UiBatchArgs, inputsOverride?: Record<string, string>): UiBatchPlanResult {
  const inputs = normalizeInputs(inputsOverride ?? args.inputs)
  const limit = Math.min(Math.max(Math.floor(args.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)
  const refs: Array<{ site: string; flow: string; version?: number }> = []
  let selection: UiBatchSelection = 'all'
  const flowArgs = (args.flows ?? []).map((item) => item.trim()).filter((item) => item !== '')
  if (flowArgs.length > 0) {
    selection = 'flows'
    for (const text of flowArgs) {
      const parsed = parseFlowRef(text)
      if (parsed === undefined) return { ok: false, message: `flows 里的条目格式不对：${text}（应为 site/flow 或 site/flow@3）` }
      refs.push(parsed)
    }
  } else if (args.site !== undefined && args.site.trim() !== '') {
    selection = 'site'
    for (const script of listUiScripts(workspaceRoot)) {
      if (script.site !== args.site.trim()) continue
      refs.push({ site: script.site, flow: script.flow, version: script.latest })
    }
  } else {
    for (const script of listUiScripts(workspaceRoot)) {
      refs.push({ site: script.site, flow: script.flow, version: script.latest })
    }
  }

  const limited = refs.slice(0, limit)
  const entries: PlanEntry[] = []
  const missingUnion: string[] = []
  let writeSteps = 0
  for (const [index, ref] of limited.entries()) {
    const loaded = loadUiScript(workspaceRoot, ref.site, ref.flow, ref.version)
    if (!loaded.ok) {
      entries.push({
        item: {
          index, site: ref.site, flow: ref.flow,
          ...(ref.version === undefined ? {} : { version: ref.version }),
          stepCount: 0, writeSteps: 0, missing: [],
          error: loaded.message,
        },
        inputs,
      })
      continue
    }
    const doc = loaded.doc
    const missing = missingInputsOf(doc, inputs)
    const item: UiBatchPlanItem = {
      index,
      site: doc.meta.site,
      flow: doc.meta.flow,
      version: loaded.version,
      stepCount: doc.steps.length,
      writeSteps: doc.steps.filter((step) => step.kind === 'click' || step.kind === 'submit' || step.kind === 'upload').length,
      missing,
    }
    for (const name of missing) if (!missingUnion.includes(name)) missingUnion.push(name)
    writeSteps += item.writeSteps
    entries.push({ item, doc, inputs })
  }

  return {
    ok: true,
    entries,
    plan: {
      selection,
      ...(args.site === undefined || args.site.trim() === '' || selection !== 'site' ? {} : { site: args.site.trim() }),
      total: entries.length,
      limit,
      items: entries.map((entry) => entry.item),
      missingInputs: missingUnion,
      writeSteps,
    },
  }
}

/** 执行一条脚本的缝（应用层注入 runUiScript；单测注入假实现）。 */
export type UiBatchRunner = (doc: UiScriptDoc, inputs: Record<string, string>) => Promise<UiRunResult>

/** 批次执行依赖。 */
export type UiBatchRunDeps = {
  dataRoot: string
  run: UiBatchRunner
}

/** 批次结果（工具/面板回执）。 */
export type UiBatchResult = {
  batchId: string
  selection: UiBatchSelection
  site?: string
  total: number
  passed: number
  failed: number
  skipped: number
  elapsedMs: number
  items: UiBatchItemResult[]
  /** 相对 dataRoot 的路径。 */
  report: string
  reportJson: string
}

/**
 * 执行计划：逐条调用 `deps.run`，汇总后写 batch.json + report.md/json。
 *
 * 某条脚本回放抛错不会中断整批（捕获成该条失败）；预检失败（缺参/脚本坏）不跑浏览器。
 */
export async function executeUiBatch(deps: UiBatchRunDeps, planned: { plan: UiBatchPlan; entries: PlanEntry[] }): Promise<UiBatchResult> {
  const startedAt = Date.now()
  const batchId = `uibatch_${startedAt.toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const items: UiBatchItemResult[] = []
  startUiBatch(deps.dataRoot, batchId, {
    selection: planned.plan.selection,
    ...(planned.plan.site === undefined ? {} : { site: planned.plan.site }),
    total: planned.entries.length,
    passed: 0,
    failed: 0,
    skipped: 0,
    items: [],
  })

  for (const entry of planned.entries) {
    const { item, doc, inputs } = entry
    const base: UiBatchItemResult = {
      index: item.index,
      site: item.site,
      flow: item.flow,
      ...(item.version === undefined ? {} : { version: item.version }),
      success: false,
    }
    if (item.error !== undefined || item.missing.length > 0 || doc === undefined) {
      const reason = item.error ?? `缺必填入参：${item.missing.join('、')}`
      items.push({ ...base, skipped: true, error: reason })
      continue
    }
    try {
      const run = await deps.run(doc, inputs)
      items.push({
        ...base,
        runId: run.runId,
        success: run.success,
        stepsDone: run.stepsDone,
        totalSteps: run.totalSteps,
        ...(run.failedStep === undefined ? {} : { failedStep: run.failedStep.id }),
        ...(run.screenshot === undefined ? {} : { screenshot: run.screenshot }),
        ...(run.error === undefined ? {} : { error: run.error }),
        elapsedMs: run.elapsedMs,
      })
    } catch (error) {
      items.push({ ...base, error: String((error as Error)?.message ?? error).slice(0, 800) })
    }
  }

  const passed = items.filter((item) => item.success).length
  const failed = items.filter((item) => item.success !== true && item.skipped !== true).length
  const skipped = items.filter((item) => item.skipped === true).length
  const elapsedMs = Date.now() - startedAt
  const record = finishUiBatch(deps.dataRoot, batchId, {
    status: 'done',
    finishedAt: Date.now(),
    total: items.length,
    passed,
    failed,
    skipped,
    elapsedMs,
    items,
  })
  if (record === undefined) throw new Error(`批次 ${batchId} 的 batch.json 写入失败`)
  const paths = writeUiBatchReport(deps.dataRoot, record)
  finishUiBatch(deps.dataRoot, batchId, paths)
  return {
    batchId,
    selection: record.selection,
    ...(record.site === undefined ? {} : { site: record.site }),
    total: items.length,
    passed,
    failed,
    skipped,
    elapsedMs,
    items,
    report: paths.report,
    reportJson: paths.reportJson,
  }
}
