/**
 * 结晶（R-6 M1）：把 probe 留痕里的「值 + 来源」翻译成链资产的三分类草案。
 *
 * 铁律（改代码前先读）：
 *   - `upstream` 来源的值是**响应值**，只能走绑定边重新求解，**永不允许冻成常量或入参**；
 *   - `agent-inferred` 的值必须经用户确认（decisions.confirmed === true）才能写回；
 *   - 敏感值（probe 已标 redacted / `***`）不参与结晶。
 *
 * 本模块不写盘：草案生成读 runs；写回由 orchestration 层走 `saveChain`（R-1 校验）。
 *
 * @module dsh-dataforge/execute/crystal
 */
import type { ChainDoc, ChainNode, InterfaceCardDoc } from '../chains/schema.js'
import { CHAIN_VALUE_TYPES, splitBindingPath } from '../chains/schema.js'
import { listRunIds, readRunRecord } from '../runs/store.js'
import { normalizePath } from './coverage.js'
import type { JsonLike } from '../shared/types.js'

/* ================================================================== 契约 */

export type CrystalValueSource = 'user' | 'agent-inferred' | 'upstream' | 'constant'
export type CrystalSuggestion = 'constant' | 'input' | 'chain'

export type CrystalDraftRow = {
  nodeId: string
  path: string
  value: JsonLike
  source: CrystalValueSource
  suggestion: CrystalSuggestion
  slotName?: string
  type: string
  evidence?: string
  requiresUserConfirmation: boolean
  conflict?: boolean
  /** 敏感/卡模板缺失等不可结晶原因；有值即跳过写回。 */
  excluded?: string
}

export type CrystalDraft = {
  site: string
  flow: string
  version?: number
  explorationId: string
  probeRunIds: string[]
  rows: CrystalDraftRow[]
  warnings: string[]
}

export type CrystalDecision = {
  /** 只允许在 constant / input 之间改；upstream 行不能出现在这里。 */
  as?: 'constant' | 'input'
  slotName?: string
  /** agent-inferred 行必须显式确认。 */
  confirmed?: boolean
}

export type CrystalErrorCode =
  | 'crystal-no-source'
  | 'crystal-confirmation-required'
  | 'crystal-iron-rule'
  | 'crystal-chain-without-binding'
  | 'crystal-unsupported-value'
  | 'crystal-slot-conflict'
  | 'crystal-conflict'
  | 'crystal-invalid-decision'

export type CrystalFailure = { ok: false; code: CrystalErrorCode; message: string; row?: CrystalDraftRow }

/* ================================================================== 草案 */

export type BuildCrystalDraftInput = {
  dataRoot: string
  site: string
  flow: string
  version?: number
  /** 缺省 = 该 site/flow 最近一组 probe 的 explorationId。 */
  explorationId?: string
  cards: Map<string, InterfaceCardDoc>
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function stringifyValue(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return String(value)
  }
}

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function sourceOf(value: unknown): CrystalValueSource | undefined {
  return value === 'user' || value === 'agent-inferred' || value === 'upstream' || value === 'constant'
    ? value
    : undefined
}

function suggestionOf(source: CrystalValueSource): CrystalSuggestion {
  if (source === 'constant') return 'constant'
  if (source === 'upstream') return 'chain'
  return 'input'
}

/** 字段叶子名 → 槽位候选（`body.lines[0].quantity` → `quantity`）。 */
export function slotNameOf(path: string): string {
  const leaf = path.split(/[.[\]]/).filter((part) => part !== '' && part !== '*').pop() ?? 'value'
  const safe = leaf.replace(/[^\p{L}\p{N}_]/gu, '_')
  return /^[0-9]/.test(safe) ? `v_${safe}` : safe === '' ? 'value' : safe
}

type ProbeRun = {
  runId: string
  startedAt: number
  explorationId: string
  nodeId: string
  cardId: string
  provenance: Array<Record<string, unknown>>
  values: Record<string, unknown>
}

function probeRunsOf(input: BuildCrystalDraftInput): ProbeRun[] {
  const runs: ProbeRun[] = []
  for (const runId of listRunIds(input.dataRoot, 200)) {
    const record = readRunRecord(input.dataRoot, runId)
    if (record === undefined || record['kind'] !== 'probe-run') continue
    const probe = plainRecord(record['probe'])
    if (probe === undefined) continue
    if (probe['site'] !== input.site || probe['flow'] !== input.flow) continue
    if (input.version !== undefined && probe['version'] !== input.version) continue
    const explorationId = typeof probe['explorationId'] === 'string' ? probe['explorationId'] : ''
    if (explorationId === '') continue
    if (input.explorationId !== undefined && explorationId !== input.explorationId) continue
    const nodeId = typeof probe['nodeId'] === 'string' ? probe['nodeId'] : ''
    const cardId = typeof probe['cardId'] === 'string' ? probe['cardId'] : ''
    if (nodeId === '' || cardId === '') continue
    const provenanceRaw = record['provenance']
    const provenance = Array.isArray(provenanceRaw)
      ? provenanceRaw.filter((item): item is Record<string, unknown> => plainRecord(item) !== undefined)
      : []
    if (provenance.length === 0) continue
    const values = plainRecord(record['values']) ?? {}
    runs.push({
      runId,
      startedAt: typeof record['startedAt'] === 'number' ? record['startedAt'] : 0,
      explorationId,
      nodeId,
      cardId,
      provenance,
      values,
    })
  }
  runs.sort((left, right) => left.startedAt - right.startedAt)
  return runs
}

function fieldTypeOf(card: InterfaceCardDoc | undefined, path: string): { type: string; exists: boolean } {
  if (card === undefined) return { type: 'unknown', exists: false }
  const key = normalizePath(path)
  const field = (card.inputs ?? []).find((candidate) => normalizePath(candidate.path) === key)
  return field === undefined ? { type: 'unknown', exists: false } : { type: field.type, exists: true }
}

/**
 * 读 probe 留痕 → 三分类草案。
 *
 * 同一 `nodeId + path` 出现多次：值/来源不一致标 `conflict`，保留最新一次的值/来源。
 */
export function buildCrystalDraft(
  input: BuildCrystalDraftInput,
): { ok: true; draft: CrystalDraft } | CrystalFailure {
  const all = probeRunsOf(input)
  if (all.length === 0) {
    return {
      ok: false,
      code: 'crystal-no-source',
      message: `没有找到 ${input.site}/${input.flow} 的 probe 留痕${input.explorationId === undefined ? '' : `（explorationId ${input.explorationId}）`}：先跑 dataforge_chain_probe`,
    }
  }
  const explorationId = input.explorationId ?? (all[all.length - 1] as ProbeRun).explorationId
  const runs = all.filter((run) => run.explorationId === explorationId)

  const warnings: string[] = []
  const byKey = new Map<string, CrystalDraftRow>()
  for (const run of runs) {
    const card = input.cards.get(run.cardId)
    for (const item of run.provenance) {
      const path = typeof item['path'] === 'string' ? item['path'] : ''
      const source = sourceOf(item['source'])
      if (path === '' || source === undefined) continue
      const redacted = item['redacted'] === true || run.values[path] === '***'
      const { type, exists } = fieldTypeOf(card, path)
      const rawValue = run.values[path]
      const value: JsonLike = redacted ? '***' : rawValue === undefined ? null : (rawValue as JsonLike)
      const row: CrystalDraftRow = {
        nodeId: run.nodeId,
        path,
        value,
        source,
        suggestion: suggestionOf(source),
        ...(suggestionOf(source) === 'input' ? { slotName: slotNameOf(path) } : {}),
        type,
        ...(typeof item['evidence'] === 'string' && item['evidence'] !== '' ? { evidence: item['evidence'] } : {}),
        requiresUserConfirmation: source === 'agent-inferred',
        ...(redacted ? { excluded: '敏感值不参与结晶' } : {}),
        ...(!exists && !redacted ? { excluded: '卡模板里没有这个入参' } : {}),
      }
      const key = `${run.nodeId}\u0000${path}`
      const existing = byKey.get(key)
      if (existing === undefined) {
        byKey.set(key, row)
        continue
      }
      if (existing.source !== row.source || stringifyValue(existing.value) !== stringifyValue(row.value)) {
        // 保留最新值/来源，但把冲突显式标出来；确认时必须由 decisions 选一个。
        byKey.set(key, { ...row, conflict: true })
      }
    }
  }

  const rows = [...byKey.values()]
  if (rows.length === 0) {
    return { ok: false, code: 'crystal-no-source', message: 'probe 留痕里没有可结晶的 provenance 行' }
  }
  const excluded = rows.filter((row) => row.excluded !== undefined)
  if (excluded.length > 0) warnings.push(`${excluded.length} 行被排除（敏感/卡模板缺失），不写回`)
  return {
    ok: true,
    draft: {
      site: input.site,
      flow: input.flow,
      ...(input.version === undefined ? {} : { version: input.version }),
      explorationId,
      probeRunIds: runs.map((run) => run.runId),
      rows,
      warnings,
    },
  }
}

/* ================================================================== 铁律 */

/**
 * 铁律校验：响应值（upstream）不能出现在 decisions 的 `as` 里。
 *
 * 即使调用方硬写 `as:'constant'`，也在写链前拒绝——工具不提供这条路径。
 */
export function assertNoResponseConstant(
  draft: CrystalDraft,
  decisions: Record<string, CrystalDecision> = {},
): { ok: true } | CrystalFailure {
  for (const row of draft.rows) {
    if (row.source !== 'upstream') continue
    const decision = decisions[`${row.nodeId}:${row.path}`]
    if (decision?.as !== undefined) {
      return {
        ok: false,
        code: 'crystal-iron-rule',
        message: `${row.nodeId}.${row.path} 是 upstream 响应值：只能走绑定边重新求解，不能冻成 ${decision.as}`,
        row,
      }
    }
  }
  return { ok: true }
}

/* ================================================================== 写回 */

export type ApplyCrystalInput = {
  doc: ChainDoc
  cards: Map<string, InterfaceCardDoc>
  draft: CrystalDraft
  decisions?: Record<string, CrystalDecision>
}

export type ApplyCrystalResult =
  | {
      ok: true
      doc: ChainDoc
      inputs: ChainDoc['inputs']
      warnings: string[]
    }
  | CrystalFailure

function exampleOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

function hasBindingTo(doc: ChainDoc, nodeId: string, path: string): boolean {
  return doc.edges.some((edge) => {
    const to = splitBindingPath(edge.to)
    return to !== undefined && to.nodeId === nodeId && normalizePath(to.fieldPath) === normalizePath(path)
  })
}

/**
 * 草案 + 决策 → 新链 doc。纯函数：不写盘、不改入参。
 *
 * 写回规则：
 *   - constant → `node.constants[path] = value`（只接受 string/number/boolean）；
 *   - input → 链级 inputs 槽位 + `node.constants[path] = "$inputs.<name>"`；
 *   - chain → 不写常量，只校验已有绑定边；
 *   - excluded → 跳过。
 */
export function applyCrystalDraft(input: ApplyCrystalInput): ApplyCrystalResult {
  const { doc, draft } = input
  const decisions = input.decisions ?? {}
  const iron = assertNoResponseConstant(draft, decisions)
  if (!iron.ok) return iron

  const warnings = [...draft.warnings]
  const nodes: ChainNode[] = doc.nodes.map((node) => ({
    ...node,
    constants: { ...(node.constants ?? {}) },
  }))
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const inputs = doc.inputs.map((slot) => ({ ...slot }))
  const inputByName = new Map(inputs.map((slot) => [slot.name, slot]))
  const usedSlotNames = new Set(inputs.map((slot) => slot.name))

  for (const row of draft.rows) {
    if (row.excluded !== undefined) continue
    const node = nodeById.get(row.nodeId)
    if (node === undefined) {
      warnings.push(`节点 ${row.nodeId} 已不在链上，跳过 ${row.path}`)
      continue
    }
    const decision = decisions[`${row.nodeId}:${row.path}`]
    if (decision !== undefined && decision.as !== undefined && decision.as !== 'constant' && decision.as !== 'input') {
      return { ok: false, code: 'crystal-invalid-decision', message: `${row.nodeId}.${row.path} 的决策非法：只允许 constant / input`, row }
    }
    if (row.source === 'agent-inferred' && decision?.confirmed !== true) {
      return {
        ok: false,
        code: 'crystal-confirmation-required',
        message: `${row.nodeId}.${row.path} 来自 agent-inferred：必须在 decisions 里 confirmed:true（用户确认过）`,
        row,
      }
    }
    if (row.conflict === true && decision === undefined) {
      return {
        ok: false,
        code: 'crystal-conflict',
        message: `${row.nodeId}.${row.path} 在多条 probe 里值/来源不一致：在 decisions 里明确选一个`,
        row,
      }
    }

    const as: CrystalSuggestion = row.source === 'upstream' ? 'chain' : (decision?.as ?? row.suggestion)
    if (as === 'chain') {
      if (!hasBindingTo(doc, row.nodeId, row.path)) {
        return {
          ok: false,
          code: 'crystal-chain-without-binding',
          message: `${row.nodeId}.${row.path} 是响应值，但链上没有指向它的绑定边：先用 dataforge_chain_upsert 补边`,
          row,
        }
      }
      continue
    }

    if (as === 'constant') {
      const value = row.value
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        return {
          ok: false,
          code: 'crystal-unsupported-value',
          message: `${row.nodeId}.${row.path} 的值不是标量，不能冻成常量；请改成入参槽位`,
          row,
        }
      }
      node.constants[row.path] = String(value)
      continue
    }

    // as === 'input'
    if (!(CHAIN_VALUE_TYPES as readonly string[]).includes(row.type)) {
      return {
        ok: false,
        code: 'crystal-unsupported-value',
        message: `${row.nodeId}.${row.path} 的类型 ${row.type} 不在链槽位类型词表里`,
        row,
      }
    }
    let slotName = decision?.slotName ?? row.slotName ?? slotNameOf(row.path)
    const existing = inputByName.get(slotName)
    if (existing !== undefined && existing.type !== row.type) {
      return {
        ok: false,
        code: 'crystal-slot-conflict',
        message: `槽位 ${slotName} 已存在且类型是 ${existing.type}，与 ${row.type} 冲突：换一个 slotName`,
        row,
      }
    }
    if (existing === undefined) {
      let candidate = slotName
      let suffix = 2
      while (usedSlotNames.has(candidate)) {
        candidate = `${slotName}_${suffix}`
        suffix += 1
      }
      slotName = candidate
      const slot = { name: slotName, type: row.type as ChainDoc['inputs'][number]['type'], required: true, example: exampleOf(row.value) }
      inputs.push(slot)
      inputByName.set(slotName, slot)
      usedSlotNames.add(slotName)
    }
    node.constants[row.path] = `$inputs.${slotName}`
  }

  return { ok: true, doc: { ...doc, inputs, nodes }, inputs, warnings }
}
