/**
 * 单节点试探（R-5 M1）：链上某一个节点的一发请求 + 值来源 + 独立 run 留痕。
 *
 * 与整链执行（`run.ts`）的分工：
 *   - probe **不消费绑定边**、不写链文件、不做换票；它只回答「这个节点用这些值发一发，
 *     会发生什么、能取到哪些出参」；
 *   - 缺参不整链拒跑，而是在发请求前返回 `paused`：缺什么 + 卡模板长什么样；
 *   - 写方法没有 `confirm=true` 只出计划卡，一个请求都不发（R-5 的用户确认闸）。
 *
 * 安全面：
 *   - 敏感路径（password/token/secret/authorization/cookie/api-key…）的值一律写 `***`，
 *     不进 run.json / 事件 / 回执；
 *   - 请求头走 `redactHeaders`；正文与响应预览按敏感值再做一次文本脱敏；
 *   - probe 不处理凭证；需要登录态的节点由调用方装配的 R-4 provider 注入。
 *
 * @module dsh-dataforge/execute/probe
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ChainDoc, ChainNode, InterfaceCardDoc } from '../chains/schema.js'
import { inputSlotNameOf } from '../chains/schema.js'
import { slugOf } from '../chains/store.js'
import { appendEvent, runsRoot, startRunRecord } from '../runs/store.js'
import type { CredentialApplication, CredentialProvider } from './credentials.js'
import {
  cookieHeaderIn,
  mergeCredentialHeaders,
} from './credentials.js'
import type { StaticGap } from './coverage.js'
import { missingInputs, normalizePath } from './coverage.js'
import { httpRequest, redactHeaders } from './http.js'
import type { PlanNode } from './plan.js'
import { buildRequest } from './request.js'
import { previewText } from './run.js'
import { resolveBinding } from './binding.js'

/* ================================================================== 契约 */

export type ProbeValueSource = 'user' | 'agent-inferred' | 'upstream'

/** 工具入参里的一个值：值 + 来源 + 依据（agent-inferred/upstream 必须给依据）。 */
export type ProbeValueInput = {
  value: unknown
  source: ProbeValueSource
  evidence?: string
}

export type ProbeErrorCode =
  | 'probe-disabled'
  | 'workspace-unavailable'
  | 'chain-not-found'
  | 'invalid-chain'
  | 'invalid-source'
  | 'unknown-value'
  | 'node-not-found'
  | 'card-not-imported'
  | 'base-url-unresolved'
  | 'confirm-required'
  | 'missing-params'
  | 'param-missing'
  | 'param-type-mismatch'
  | 'bad-url-template'
  | 'body-type-unsupported'
  | 'node-timeout'
  | 'node-network-error'
  | 'node-http-error'
  | 'node-auth-required'
  | 'response-too-large'
  | 'cancelled'

export type ProbeCardInput = {
  path: string
  type: string
  required: boolean
  role?: string
}

export type ProbeGap = {
  path: string
  type: string
  target: string
}

/** 逐值来源：只留来源/依据/值预览，敏感值预览写 `***`。 */
export type ProbeProvenance = {
  path: string
  source: ProbeValueSource | 'constant'
  evidence?: string
  valuePreview?: string
  redacted?: boolean
}

/** 卡出参的实际值（给 agent 发现绑定边用）。 */
export type ProbeOutput = {
  path: string
  type: string
  valuePreview?: string
  redacted?: boolean
  /** 求值失败时的中文原因（不改探针成败，只影响这一个出参）。 */
  error?: string
}

export type ProbePlan = {
  nodeId: string
  method: string
  urlTemplate: string
  writes: boolean
  cardInputs: ProbeCardInput[]
}

export type ProbeResult = {
  ok: boolean
  gate: 'executed' | 'paused' | 'confirm-required' | 'failed' | 'blocked'
  code?: ProbeErrorCode
  message?: string
  runId?: string
  runDir?: string
  explorationId?: string
  nodeId: string
  cardId: string
  method: string
  gaps?: ProbeGap[]
  cardInputs?: ProbeCardInput[]
  plan?: ProbePlan
  request?: {
    method: string
    url: string
    headers: Record<string, string>
    bodyPreview?: string
  }
  response?: {
    status: number
    bytes: number
    truncated: boolean
    bodyPreview: string
  }
  outputs?: ProbeOutput[]
  provenance?: ProbeProvenance[]
  attempts?: number
  credentials?: CredentialApplication
}

export type ProbeInput = {
  dataRoot: string
  doc: ChainDoc
  node: ChainNode
  card: InterfaceCardDoc
  values?: Record<string, ProbeValueInput>
  /** 链级槽位运行值（给节点常量里的 `$inputs.x` 用）。 */
  chainInputs?: Record<string, unknown>
  baseUrl: string
  confirm?: boolean
  /** 仅幂等方法生效；0..3 封顶。 */
  retry?: number
  explorationId?: string
  config: {
    nodeTimeoutSeconds: number
    responseLimitBytes: number
  }
  /** R-4 凭证注入（可选；probe 不换票）。 */
  credentials?: CredentialProvider
  signal?: AbortSignal
}

/* ================================================================== 常量 */

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const MAX_PROBE_RETRY = 3
const SENSITIVE_PATH_RE = /(pass(word)?|pwd|secret|token|authorization|cookie|api[-_]?key|credential)/i

type PreparedValue = {
  rawPath: string
  path: string
  value: unknown
  source: ProbeValueSource
  evidence?: string
  sensitive: boolean
}

/* ================================================================== 小工具 */

function isSensitivePath(path: string): boolean {
  return SENSITIVE_PATH_RE.test(path)
}

function previewValue(value: unknown): string {
  if (typeof value === 'string') return value.length <= 512 ? value : `${value.slice(0, 512)}…`
  if (value === null) return 'null'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    const text = JSON.stringify(value)
    return text.length <= 512 ? text : `${text.slice(0, 512)}…`
  } catch {
    return '[不可序列化]'
  }
}

/** 文本脱敏：把已知敏感值替换成 `***`（防请求/响应回显）。 */
function redactText(text: string, sensitiveValues: unknown[]): string {
  if (sensitiveValues.length === 0) return text
  let out = text
  for (const value of sensitiveValues) {
    if (value === undefined || value === null) continue
    const raw = typeof value === 'string' ? value : previewValue(value)
    if (raw.length < 2) continue
    out = out.split(raw).join('***')
  }
  return out
}

function redactHeaderValues(headers: Record<string, string>, sensitiveValues: unknown[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) out[name] = redactText(value, sensitiveValues)
  return out
}

function cardInputsOf(card: InterfaceCardDoc): ProbeCardInput[] {
  return (card.inputs ?? [])
    .filter((field) => field.role !== 'credential')
    .map((field) => ({
      path: field.path,
      type: field.type,
      required: field.required === true,
      ...(field.role === undefined ? {} : { role: field.role }),
    }))
}

function newProbeRunId(dataRoot: string, flow: string, now: number): string {
  const base = `probe-${slugOf(flow) || 'flow'}-${now}`
  let candidate = base
  let suffix = 2
  while (existsSync(join(runsRoot(dataRoot), candidate))) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  return candidate
}

function gapOf(gap: StaticGap): ProbeGap {
  return { path: gap.path, type: gap.type, target: gap.target }
}

/* ================================================================== 值校验 */

type Prepared = {
  cardInputs: ProbeCardInput[]
  provided: Map<string, PreparedValue>
  provenance: ProbeProvenance[]
  valuesRecord: Record<string, unknown>
  sensitiveValues: unknown[]
  gaps: ProbeGap[]
}

type PrepareResult =
  | { ok: true; prepared: Prepared }
  | { ok: false; code: 'invalid-source' | 'unknown-value'; message: string }

/**
 * 值来源校验 + 缺参判定。
 *
 * 缺参不走错误：返回 `gaps` 让调用方 `paused`；值形状错误才是 blocked。
 * 常量的来源自动标 `constant`；`$inputs.x` 常量从 `chainInputs` 取，来源标 `user`。
 */
export function prepareProbeValues(input: ProbeInput): PrepareResult {
  const { card, node } = input
  const allInputs = new Map((card.inputs ?? []).map((field) => [normalizePath(field.path), field]))
  const cardInputs = cardInputsOf(card)
  const provided = new Map<string, PreparedValue>()

  for (const [rawPath, spec] of Object.entries(input.values ?? {})) {
    const path = normalizePath(rawPath)
    const field = allInputs.get(path)
    if (field === undefined) {
      const known = [...allInputs.keys()].join('、') || '（卡里没有入参）'
      return { ok: false, code: 'unknown-value', message: `${rawPath} 不在卡入参模板里；可用字段：${known}` }
    }
    if (field.role === 'credential') {
      return { ok: false, code: 'invalid-source', message: `${rawPath} 是凭证字段：probe 不接受凭证值，请走 R-4 凭证注入` }
    }
    if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
      return { ok: false, code: 'invalid-source', message: `${rawPath} 的值必须形如 { value, source, evidence? }` }
    }
    const source = (spec as ProbeValueInput).source
    if (source !== 'user' && source !== 'agent-inferred' && source !== 'upstream') {
      return { ok: false, code: 'invalid-source', message: `${rawPath} 的 source 非法：只允许 user / agent-inferred / upstream` }
    }
    const value = (spec as ProbeValueInput).value
    if (value === undefined) {
      return { ok: false, code: 'invalid-source', message: `${rawPath} 缺少 value` }
    }
    const evidence = typeof (spec as ProbeValueInput).evidence === 'string' ? ((spec as ProbeValueInput).evidence as string).trim() : ''
    if ((source === 'agent-inferred' || source === 'upstream') && evidence === '') {
      return {
        ok: false,
        code: 'invalid-source',
        message: `${rawPath} 的来源是 ${source}：必须给 evidence（推断依据/上游绑定证据）`,
      }
    }
    provided.set(path, {
      rawPath,
      path,
      value,
      source,
      ...(evidence === '' ? {} : { evidence }),
      sensitive: isSensitivePath(rawPath),
    })
  }

  const covered = new Set<string>()
  const provenance: ProbeProvenance[] = []
  const valuesRecord: Record<string, unknown> = {}
  const sensitiveValues: unknown[] = []

  const push = (
    field: { path: string; type: string; role?: string },
    value: unknown,
    source: ProbeValueSource | 'constant',
    evidence: string | undefined,
    sensitive: boolean,
  ): void => {
    covered.add(normalizePath(field.path))
    provenance.push({
      path: field.path,
      source,
      ...(evidence === undefined || evidence === '' ? {} : { evidence }),
      valuePreview: sensitive ? '***' : previewValue(value),
      ...(sensitive ? { redacted: true } : {}),
    })
    valuesRecord[field.path] = sensitive ? '***' : value
    if (sensitive) sensitiveValues.push(value)
  }

  for (const field of card.inputs ?? []) {
    if (field.role === 'credential') continue
    const key = normalizePath(field.path)
    const direct = provided.get(key)
    if (direct !== undefined) {
      push(field, direct.value, direct.source, direct.evidence, direct.sensitive)
      continue
    }
    const constantKey = Object.keys(node.constants ?? {}).find((candidate) => normalizePath(candidate) === key)
    if (constantKey === undefined) continue
    const raw = (node.constants ?? {})[constantKey]
    const slot = typeof raw === 'string' ? inputSlotNameOf(raw) : undefined
    if (slot !== undefined) {
      const slotValue = input.chainInputs?.[slot]
      if (slotValue === undefined) continue
      push(field, slotValue, 'user', `链级槽位 ${slot}`, isSensitivePath(field.path))
      continue
    }
    push(field, raw, 'constant', `节点常量 ${constantKey}`, isSensitivePath(field.path) || isSensitivePath(constantKey))
  }

  const gaps = missingInputs(node, card, covered).map(gapOf)
  return {
    ok: true,
    prepared: { cardInputs, provided, provenance, valuesRecord, sensitiveValues, gaps },
  }
}

/* ================================================================== 执行 */

/** 一次单节点试探。不抛异常：所有失败折成 `ProbeResult`。 */
export async function probeNode(input: ProbeInput): Promise<ProbeResult> {
  const { node, card, doc } = input
  const method = card.identity.method.toUpperCase()
  const writes = WRITE_METHODS.has(method)
  const preparedResult = prepareProbeValues(input)
  if (!preparedResult.ok) {
    return {
      ok: false,
      gate: 'blocked',
      code: preparedResult.code,
      message: preparedResult.message,
      nodeId: node.id,
      cardId: card.cardId,
      method,
    }
  }
  const prepared = preparedResult.prepared

  // R-5 用户确认闸：写方法没有 confirm 只出计划卡，不建 run、不发请求。
  if (writes && input.confirm !== true) {
    const plan: ProbePlan = {
      nodeId: node.id,
      method,
      urlTemplate: card.identity.urlTemplate,
      writes: true,
      cardInputs: prepared.cardInputs,
    }
    return {
      ok: true,
      gate: 'confirm-required',
      code: 'confirm-required',
      message: `节点 ${node.id} 是写操作（${method}）：向用户确认后带 confirm=true 重调；本次没有发出任何请求`,
      nodeId: node.id,
      cardId: card.cardId,
      method,
      cardInputs: prepared.cardInputs,
      plan,
      provenance: prepared.provenance,
    }
  }

  const now = Date.now()
  const explorationId = input.explorationId ?? `exp_${now}`
  const runId = newProbeRunId(input.dataRoot, doc.meta.flow, now)
  const runRecord: Record<string, unknown> = {
    kind: 'probe-run',
    flow: doc.meta.flow,
    flowName: doc.meta.flow,
    probe: {
      site: doc.meta.site,
      flow: doc.meta.flow,
      version: doc.meta.version,
      nodeId: node.id,
      cardId: card.cardId,
      method,
      urlTemplate: card.identity.urlTemplate,
      explorationId,
      writes,
      paused: prepared.gaps.length > 0,
    },
    params: prepared.valuesRecord,
    values: prepared.valuesRecord,
    provenance: prepared.provenance,
    baseUrl: input.baseUrl,
    startedAt: now,
  }
  const runDir = startRunRecord(input.dataRoot, runId, runRecord)
  appendEvent(input.dataRoot, runId, {
    event: 'meta',
    flow: doc.meta.flow,
    name: doc.meta.flow,
    steps: [node.id],
    dryRun: false,
  })

  // 缺参：停在节点前，一个请求都不发；仍留一条 run，供 R-6 看「首跑卡在哪」。
  if (prepared.gaps.length > 0) {
    const message = `暂停：节点 ${node.id} 缺 ${prepared.gaps.length} 个入参，未发送任何请求`
    appendEvent(input.dataRoot, runId, { event: 'terminal', success: false, cancelled: false, message })
    appendEvent(input.dataRoot, runId, {
      event: 'result',
      success: false,
      businessData: { probe: true, paused: true, gaps: prepared.gaps, provenance: prepared.provenance },
    })
    return {
      ok: true,
      gate: 'paused',
      code: 'missing-params',
      message,
      runId,
      runDir,
      explorationId,
      nodeId: node.id,
      cardId: card.cardId,
      method,
      gaps: prepared.gaps,
      cardInputs: prepared.cardInputs,
      provenance: prepared.provenance,
    }
  }

  const planNode: PlanNode = {
    nodeId: node.id,
    cardId: card.cardId,
    method,
    urlTemplate: card.identity.urlTemplate,
    dependsOn: [],
    constants: node.constants ?? {},
    gaps: [],
  }
  const providedValues = Object.fromEntries([...prepared.provided.values()].map((value) => [value.path, value.value]))
  const built = buildRequest({
    node: planNode,
    card,
    baseUrl: input.baseUrl,
    provided: providedValues,
    inputs: input.chainInputs ?? {},
  })
  if (!built.ok) {
    appendEvent(input.dataRoot, runId, {
      event: 'terminal',
      success: false,
      cancelled: false,
      message: `请求构造失败：${built.message}`,
    })
    appendEvent(input.dataRoot, runId, {
      event: 'result',
      success: false,
      businessData: { probe: true, code: built.code, provenance: prepared.provenance },
    })
    return {
      ok: false,
      gate: 'blocked',
      code: built.code,
      message: built.message,
      runId,
      runDir,
      explorationId,
      nodeId: node.id,
      cardId: card.cardId,
      method,
      cardInputs: prepared.cardInputs,
      provenance: prepared.provenance,
    }
  }

  let request = built.request
  let credentialApplication: CredentialApplication | undefined
  if (input.credentials !== undefined) {
    const resolution = input.credentials({ card, url: request.url, method, nodeId: node.id })
    credentialApplication = resolution.application
    if (Object.keys(resolution.headers).length > 0) {
      request = { ...request, headers: mergeCredentialHeaders(request.headers, resolution.headers) }
    }
  }
  const sessionCookie = cookieHeaderIn(request.headers)
  const sensitiveValues = [...prepared.sensitiveValues]
  if (sessionCookie !== undefined) {
    for (const part of sessionCookie.split(';')) {
      const at = part.indexOf('=')
      if (at > 0) {
        const value = part.slice(at + 1).trim()
        if (value.length >= 4) sensitiveValues.push(value)
      }
    }
  }
  const redactedHeaders = redactHeaderValues(redactHeaders(request.headers), sensitiveValues)
  const requestDigest = {
    method: request.method,
    url: request.url,
    headers: redactedHeaders,
    ...(request.body === undefined ? {} : { bodyPreview: previewText(redactText(request.body, sensitiveValues)) }),
  }

  appendEvent(input.dataRoot, runId, {
    event: 'step',
    id: node.id,
    action: `${request.method} ${request.url}`,
    status: 'start',
    data: {
      card: card.cardId,
      request: requestDigest,
      provenance: prepared.provenance,
      ...(credentialApplication === undefined ? {} : { credentials: credentialApplication }),
    },
  })

  const retry = IDEMPOTENT_METHODS.has(method) ? Math.max(0, Math.min(MAX_PROBE_RETRY, Math.floor(input.retry ?? 0))) : 0
  const outcome = await httpRequest({
    method: request.method,
    url: request.url,
    headers: request.headers,
    ...(request.body === undefined ? {} : { body: request.body }),
    timeoutMs: Math.max(1, Math.floor(input.config.nodeTimeoutSeconds)) * 1000,
    retry,
    limitBytes: Math.max(1, Math.floor(input.config.responseLimitBytes)),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  })

  if (!outcome.ok) {
    const code: ProbeErrorCode =
      outcome.code === 'aborted'
        ? 'cancelled'
        : outcome.code === 'timeout'
          ? 'node-timeout'
          : outcome.code === 'bad-url'
            ? 'bad-url-template'
            : 'node-network-error'
    const message = `节点 ${node.id}：${outcome.message}`
    appendEvent(input.dataRoot, runId, {
      event: 'step',
      id: node.id,
      status: 'error',
      elapsed: outcome.elapsedMs,
      error: message,
      data: { code, attempts: outcome.attempts },
    })
    appendEvent(input.dataRoot, runId, { event: 'terminal', success: false, cancelled: code === 'cancelled', message })
    appendEvent(input.dataRoot, runId, {
      event: 'result',
      success: false,
      businessData: { probe: true, code, provenance: prepared.provenance, attempts: outcome.attempts },
    })
    return {
      ok: false,
      gate: code === 'cancelled' ? 'blocked' : 'failed',
      code,
      message,
      runId,
      runDir,
      explorationId,
      nodeId: node.id,
      cardId: card.cardId,
      method,
      request: requestDigest,
      provenance: prepared.provenance,
      attempts: outcome.attempts,
      ...(credentialApplication === undefined ? {} : { credentials: credentialApplication }),
    }
  }

  const response = outcome.response
  const responseDigest = {
    status: response.status,
    bytes: response.bytes,
    truncated: response.truncated,
    bodyPreview: previewText(redactText(response.bodyText, sensitiveValues)),
  }
  const root = { body: response.json ?? response.bodyText, status: response.status, headers: response.headers }
  const outputs: ProbeOutput[] = []
  for (const field of card.outputs ?? []) {
    const bound = resolveBinding(root, field.path, field.type)
    const sensitive = isSensitivePath(field.path)
    if (!bound.ok) {
      outputs.push({ path: field.path, type: field.type, error: bound.message })
      continue
    }
    outputs.push({
      path: field.path,
      type: field.type,
      valuePreview: sensitive ? '***' : redactText(previewValue(bound.value), sensitiveValues),
      ...(sensitive ? { redacted: true } : {}),
    })
  }

  if (response.status < 200 || response.status >= 300) {
    const code: ProbeErrorCode =
      response.status === 401 || response.status === 403
        ? typeof card.auth === 'string' && card.auth !== 'none'
          ? 'node-auth-required'
          : 'node-http-error'
        : 'node-http-error'
    const message =
      code === 'node-auth-required'
        ? `HTTP ${response.status}：该卡声明了鉴权（${String(card.auth)}）；probe 不换票，请先确认凭证或走 dataforge_chain_run 的 relogin`
        : `HTTP ${response.status}`
    appendEvent(input.dataRoot, runId, {
      event: 'step',
      id: node.id,
      status: 'error',
      elapsed: outcome.response.elapsedMs,
      error: message,
      data: { code, response: responseDigest, outputs },
    })
    appendEvent(input.dataRoot, runId, { event: 'terminal', success: false, cancelled: false, message })
    appendEvent(input.dataRoot, runId, {
      event: 'result',
      success: false,
      businessData: { probe: true, code, provenance: prepared.provenance, outputs, attempts: response.attempts },
    })
    return {
      ok: false,
      gate: 'failed',
      code,
      message,
      runId,
      runDir,
      explorationId,
      nodeId: node.id,
      cardId: card.cardId,
      method,
      request: requestDigest,
      response: responseDigest,
      outputs,
      provenance: prepared.provenance,
      attempts: response.attempts,
      ...(credentialApplication === undefined ? {} : { credentials: credentialApplication }),
    }
  }

  appendEvent(input.dataRoot, runId, {
    event: 'step',
    id: node.id,
    status: 'done',
    elapsed: response.elapsedMs,
    data: { response: responseDigest, outputs },
  })
  appendEvent(input.dataRoot, runId, {
    event: 'terminal',
    success: true,
    cancelled: false,
    message: `节点 ${node.id} 试探完成：HTTP ${response.status}`,
  })
  appendEvent(input.dataRoot, runId, {
    event: 'result',
    success: true,
    businessData: { probe: true, provenance: prepared.provenance, outputs, attempts: response.attempts },
  })

  return {
    ok: true,
    gate: 'executed',
    runId,
    runDir,
    explorationId,
    nodeId: node.id,
    cardId: card.cardId,
    method,
    request: requestDigest,
    response: responseDigest,
    outputs,
    provenance: prepared.provenance,
    attempts: response.attempts,
    ...(credentialApplication === undefined ? {} : { credentials: credentialApplication }),
  }
}

/** 供应用层判断写方法（与工具回执的 writes 同源）。 */
export function isProbeWriteMethod(method: string): boolean {
  return WRITE_METHODS.has(method.toUpperCase())
}
