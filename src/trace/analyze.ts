/**
 * Trace → 编排分析（S2）。
 *
 * 只用通用规则：HTTP 方法、采集序号、JSON 值匹配、路径提取；
 * 不出现业务系统名称、URL、字段名。业务语义留给 agent 与 lookup。
 *
 * 产出是“高置信度草稿 + warning”的输入：
 *   - nodes：按调用顺序（连续重复调用合并，短时间重复标 polling）；
 *   - bindings：后请求字段 ← 前响应字段（带 confidence）；
 *   - inputs/constants/outputs/assertions：候选，供 agent 审阅；
 *   - coverage/warnings：覆盖率、低置信度、无法解析的字段。
 *
 * @module dsh-dataforge/trace/analyze
 */
import type { Trace, TraceSample, TraceWarning } from './types.js'

export type TraceBinding = {
  from: { nodeId: string; path: string }
  to: { nodeId: string; path: string }
  valuePreview: string
  confidence: number
  reason: string
}

export type TraceInput = {
  name: string
  path: string
  /** 第一个出现该路径的节点（兼容旧字段）。 */
  nodeId: string
  /** 所有出现该路径的节点。 */
  nodeIds: string[]
  type: 'string' | 'number' | 'boolean'
  examplePreview: string
  required: boolean
  confidence: number
  reason: string
}

export type TraceConstant = {
  path: string
  valuePreview: string
  nodeIds: string[]
}

export type TraceOutput = {
  name: string
  path: string
  nodeId: string
  type: 'string' | 'number' | 'boolean'
  examplePreview: string
}

export type TraceAssertion = {
  nodeId: string
  path: string
  equals: string
  confidence: number
  reason: string
}

export type TraceNode = {
  id: string
  method: string
  url: string
  path: string
  pageUrl?: string
  status?: number
  ts: number
  write: boolean
  polling: boolean
  occurrences: number
  sampleIds: string[]
  requestBody?: string
  responseBody?: string
  cardId?: string
  mergeKey?: string
}

export type TraceAnalysis = {
  captureId: string
  entryUrl: string
  stats: {
    totalSamples: number
    analyzedSamples: number
    skippedSamples: number
    nodes: number
    writes: number
    pages: number
    truncatedBodies: number
    staticAssets: number
  }
  nodes: TraceNode[]
  bindings: TraceBinding[]
  inputs: TraceInput[]
  constants: TraceConstant[]
  outputs: TraceOutput[]
  assertions: TraceAssertion[]
  coverage: {
    candidateLeaves: number
    boundLeaves: number
    bindingCoverage: number
    callCoverage: number
  }
  warnings: TraceWarning[]
}

type Leaf = { path: string; value: string | number | boolean }
type ParsedBody = { kind: 'json' | 'form' | 'text' | 'empty'; value?: unknown }

type MutableNode = {
  key: string
  method: string
  path: string
  url: string
  pageUrl?: string
  status?: number
  ts: number
  lastTs: number
  sampleIds: string[]
  requestBody?: string
  responseBody?: string
  cardId?: string
  mergeKey?: string
}

const STATIC_EXT = /\.(?:js|mjs|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|map|txt|xml|mp4|webm|mp3|zip|gz)$/i
const VOLATILE_QUERY = /^(?:_|_t|ts|timestamp|dp-logid|dp_logid|callback|cb|nonce|sign|signature|token|_sign|rnd|random|request[-_]?id|trace[-_]?id)$/i
const SENSITIVE_KEY = /authorization|cookie|token|secret|password|api[-_]?key|session/i
const SUCCESS_KEY = /^(?:code|errno|error|status|success|ok)$/i
const SUCCESS_VALUES = new Set(['0', 'true', 'success', 'ok', '200'])
const POLL_WINDOW_MS = 5_000
const MAX_LEAVES_PER_BODY = 400
const MAX_BINDINGS = 300
const MAX_INPUTS = 80
const MAX_CONSTANTS = 80
const MAX_OUTPUTS = 50
const MAX_ASSERTIONS = 80

function mask(value: string): string {
  if (value.length <= 8) return `${value.slice(0, 2)}****${value.slice(-2)}`
  return `${value.slice(0, 4)}****${value.slice(-4)}`
}

function headerValue(headers: Record<string, string>, name: string): string {
  const wanted = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value
  }
  return ''
}

function parseBody(body: string | undefined, contentType: string): ParsedBody {
  if (body === undefined || body.trim() === '') return { kind: 'empty' }
  const type = contentType.toLowerCase()
  if (type.includes('application/x-www-form-urlencoded') || /^[^=&\s]+=[^&\s]*(?:&[^=&\s]+=[^&\s]*)*$/.test(body.trim())) {
    try {
      const params = new URLSearchParams(body)
      const out: Record<string, string> = {}
      for (const [key, value] of params.entries()) out[key] = value
      return { kind: 'form', value: out }
    } catch {
      // fall through to text
    }
  }
  if (type.includes('json') || /^[\s]*[\[{]/.test(body)) {
    try {
      return { kind: 'json', value: JSON.parse(body) }
    } catch {
      return { kind: 'text' }
    }
  }
  return { kind: 'text' }
}

function collectLeaves(value: unknown, base: string, out: Leaf[], depth = 0): void {
  if (out.length >= MAX_LEAVES_PER_BODY || depth > 8) return
  if (value === null || value === undefined) return
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    if (typeof value === 'string' && value === '') return
    out.push({ path: base, value })
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectLeaves(item, `${base}[${index}]`, out, depth + 1))
    return
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      collectLeaves(item, base === '' ? key : `${base}.${key}`, out, depth + 1)
    }
  }
}

function leavesOfBody(parsed: ParsedBody, prefix: 'body' | 'query'): Leaf[] {
  const out: Leaf[] = []
  if (parsed.kind === 'json' && parsed.value !== undefined) collectLeaves(parsed.value, prefix, out)
  else if (parsed.kind === 'form' && parsed.value !== undefined) collectLeaves(parsed.value, prefix, out)
  return out
}

function leafKeyValue(leaf: Leaf): string {
  return String(leaf.value)
}

function usableLeaf(leaf: Leaf): boolean {
  if (typeof leaf.value === 'boolean') return false
  const text = String(leaf.value)
  if (text.length < 4 || text.length > 200) return false
  if (SENSITIVE_KEY.test(leaf.path)) return false
  return true
}

function likelyDynamic(value: string): boolean {
  return (
    /^[0-9a-f]{16,}$/i.test(value)
    || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    || /^\d{10,13}$/.test(value)
    || /^[A-Za-z0-9+/]{24,}={0,2}$/.test(value)
  )
}

function bodyFingerprint(body: string | undefined): string {
  if (body === undefined || body === '') return ''
  let hash = 0
  for (let index = 0; index < body.length; index += 1) {
    hash = (hash * 31 + body.charCodeAt(index)) >>> 0
  }
  return `${body.length}:${hash.toString(36)}`
}

function normalizeQuery(query: Record<string, string>): string {
  const keys = Object.keys(query).filter((key) => !VOLATILE_QUERY.test(key)).sort()
  return keys.map((key) => `${key}=${query[key]}`).join('&')
}

function isStatic(sample: TraceSample): boolean {
  if (sample.method !== 'GET' && sample.method !== 'HEAD') return false
  return STATIC_EXT.test(sample.path)
}

function leafName(path: string): string {
  const parts = path.split('.')
  const last = (parts[parts.length - 1] ?? path).replace(/\[\d+\]/g, '')
  return last === '' || last === 'body' || last === 'query' ? 'value' : last
}

function uniqueName(base: string, used: Set<string>): string {
  const clean = base.replace(/[^A-Za-z0-9_\u4e00-\u9fa5-]/g, '_').slice(0, 50) || 'input'
  if (!used.has(clean)) {
    used.add(clean)
    return clean
  }
  let index = 2
  while (used.has(`${clean}_${index}`)) index += 1
  const name = `${clean}_${index}`
  used.add(name)
  return name
}

/**
 * 分析一条 trace；纯函数，不读写磁盘。
 *
 * @param trace - `readTrace` 的结果。
 */
export function analyzeTrace(trace: Trace): TraceAnalysis {
  const warnings: TraceWarning[] = []
  const nodes: TraceNode[] = []
  const mutable: MutableNode[] = []
  const skipped: TraceSample[] = []
  let staticAssets = 0

  for (const sample of trace.samples) {
    if (isStatic(sample)) {
      staticAssets += 1
      skipped.push(sample)
      continue
    }
    // 写操作的请求体不同 = 不是同一次调用，不能因为相邻就合并（避免把两笔 POST 合并成一个节点）。
    const write = sample.method !== 'GET' && sample.method !== 'HEAD' && sample.method !== 'OPTIONS'
    const key = `${sample.method} ${sample.path}?${normalizeQuery(sample.query)}${write ? `#${bodyFingerprint(sample.requestBody)}` : ''}`
    const previous = mutable[mutable.length - 1]
    if (previous !== undefined && previous.key === key && sample.ts - previous.lastTs <= POLL_WINDOW_MS) {
      previous.sampleIds.push(sample.id)
      previous.lastTs = sample.ts
      previous.ts = sample.ts
      if (sample.responseBody !== undefined) previous.responseBody = sample.responseBody
      if (sample.requestBody !== undefined && previous.requestBody === undefined) previous.requestBody = sample.requestBody
      if (sample.cardId !== undefined) previous.cardId = sample.cardId
      if (sample.mergeKey !== undefined) previous.mergeKey = sample.mergeKey
      if (sample.status !== undefined) previous.status = sample.status
      continue
    }
    mutable.push({
      key,
      method: sample.method,
      path: sample.path,
      url: sample.url,
      ...(sample.pageUrl === undefined ? {} : { pageUrl: sample.pageUrl }),
      ...(sample.status === undefined ? {} : { status: sample.status }),
      ts: sample.ts,
      lastTs: sample.ts,
      sampleIds: [sample.id],
      ...(sample.requestBody === undefined ? {} : { requestBody: sample.requestBody }),
      ...(sample.responseBody === undefined ? {} : { responseBody: sample.responseBody }),
      ...(sample.cardId === undefined ? {} : { cardId: sample.cardId }),
      ...(sample.mergeKey === undefined ? {} : { mergeKey: sample.mergeKey }),
    })
  }

  mutable.forEach((node, index) => {
    const id = `n${index + 1}`
    nodes.push({
      id,
      method: node.method,
      url: node.url,
      path: node.path,
      ...(node.pageUrl === undefined ? {} : { pageUrl: node.pageUrl }),
      ...(node.status === undefined ? {} : { status: node.status }),
      ts: node.ts,
      write: node.method !== 'GET' && node.method !== 'HEAD' && node.method !== 'OPTIONS',
      polling: node.sampleIds.length > 1,
      occurrences: node.sampleIds.length,
      sampleIds: node.sampleIds,
      ...(node.requestBody === undefined ? {} : { requestBody: node.requestBody }),
      ...(node.responseBody === undefined ? {} : { responseBody: node.responseBody }),
      ...(node.cardId === undefined ? {} : { cardId: node.cardId }),
      ...(node.mergeKey === undefined ? {} : { mergeKey: node.mergeKey }),
    })
    if (node.sampleIds.length > 1) {
      warnings.push({
        code: 'polling-merged',
        message: `${node.method} ${node.path} 连续调用 ${node.sampleIds.length} 次，已合并为一个节点（polling）；回放需配置重试/轮询。`,
      })
    }
  })

  // 每个节点的请求叶子（query + body）与响应叶子（body）。
  const nodeLeaves = new Map<string, { request: Leaf[]; response: Leaf[] }>()
  for (let index = 0; index < mutable.length; index += 1) {
    const node = mutable[index] as MutableNode
    const id = `n${index + 1}`
    const requestContentType = '' // request header content-type 不在 node 上；用 body 内容猜
    const requestBody = parseBody(node.requestBody, requestContentType)
    const responseContentType = ''
    const responseBody = parseBody(node.responseBody, responseContentType)
    const requestLeaves = leavesOfBody(requestBody, 'body')
    const responseLeaves = leavesOfBody(responseBody, 'body')
    nodeLeaves.set(id, { request: requestLeaves, response: responseLeaves })
    if (node.requestBody !== undefined && requestBody.kind === 'text') {
      warnings.push({ code: 'request-body-unparsed', message: `${node.method} ${node.path} 的请求正文不是 JSON/表单，字段流转无法推断。` })
    }
    if (node.responseBody !== undefined && responseBody.kind === 'text') {
      warnings.push({ code: 'response-body-unparsed', message: `${node.method} ${node.path} 的响应正文不是 JSON，字段流转无法推断。` })
    }
  }

  // 查询参数需要从原始 sample 的 query 取（node 上只存了归一化 key）。
  for (let index = 0; index < mutable.length; index += 1) {
    const node = mutable[index] as MutableNode
    const id = `n${index + 1}`
    const leaves = nodeLeaves.get(id)
    if (leaves === undefined) continue
    const sample = trace.samples.find((item) => item.id === node.sampleIds[0])
    if (sample === undefined) continue
    for (const [key, value] of Object.entries(sample.query)) {
      if (value !== '' && !VOLATILE_QUERY.test(key)) leaves.request.push({ path: `query.${key}`, value })
    }
  }

  const bindings: TraceBinding[] = []
  const boundTo = new Set<string>()
  const responseIndex = new Map<string, Array<{ nodeId: string; path: string }>>()
  for (let index = 0; index < mutable.length; index += 1) {
    const node = mutable[index] as MutableNode
    const id = `n${index + 1}`
    const leaves = nodeLeaves.get(id)
    if (leaves === undefined) continue
    for (const leaf of leaves.request) {
      if (!usableLeaf(leaf)) continue
      const value = leafKeyValue(leaf)
      const toKey = `${id}.${leaf.path}`
      if (boundTo.has(toKey)) continue
      const matches = responseIndex.get(value)
      if (matches === undefined || matches.length === 0) continue
      const chosen = matches[matches.length - 1] as { nodeId: string; path: string }
      const confidence = matches.length === 1 ? 0.9 : 0.65
      bindings.push({
        from: { nodeId: chosen.nodeId, path: chosen.path },
        to: { nodeId: id, path: leaf.path },
        valuePreview: mask(value),
        confidence,
        reason: matches.length === 1
          ? '值在之前响应中唯一出现（精确匹配）'
          : `值在之前 ${matches.length} 个响应中出现，取最近一个（精确匹配）`,
      })
      boundTo.add(toKey)
      if (confidence < 0.7) {
        warnings.push({
          code: 'low-confidence-binding',
          message: `${chosen.nodeId}.${chosen.path} → ${id}.${leaf.path} 置信度 ${confidence}：值在多个响应中出现，需 agent 确认来源。`,
        })
      }
      if (bindings.length >= MAX_BINDINGS) break
    }
    for (const leaf of leaves.response) {
      if (!usableLeaf(leaf)) continue
      const list = responseIndex.get(leafKeyValue(leaf)) ?? []
      list.push({ nodeId: id, path: leaf.path })
      responseIndex.set(leafKeyValue(leaf), list)
    }
  }

  // 输入/常量：未被绑定的请求叶子。同一个 path+value 在多个节点重复 → 常量候选。
  const inputMap = new Map<string, { path: string; nodeIds: Set<string>; values: Set<string>; example: string }>()
  for (let index = 0; index < mutable.length; index += 1) {
    const node = mutable[index] as MutableNode
    const id = `n${index + 1}`
    const leaves = nodeLeaves.get(id)
    if (leaves === undefined) continue
    for (const leaf of leaves.request) {
      if (!usableLeaf(leaf)) continue
      if (boundTo.has(`${id}.${leaf.path}`)) continue
      const value = leafKeyValue(leaf)
      const existing = inputMap.get(leaf.path)
      if (existing === undefined) {
        inputMap.set(leaf.path, { path: leaf.path, nodeIds: new Set([id]), values: new Set([value]), example: value })
      } else {
        existing.nodeIds.add(id)
        existing.values.add(value)
      }
    }
  }

  const inputs: TraceInput[] = []
  const constants: TraceConstant[] = []
  const usedNames = new Set<string>()
  let inputIndex = 0
  for (const item of inputMap.values()) {
    if (inputs.length >= MAX_INPUTS) break
    const dynamic = [...item.values].some((value) => likelyDynamic(value))
    if (dynamic) {
      warnings.push({ code: 'unresolved-dynamic', message: `${item.path} 的值像动态 ID/时间戳/编码，未作为输入（需 agent 确认派生来源）。` })
      continue
    }
    if (item.values.size === 1 && item.nodeIds.size > 1) {
      if (constants.length < MAX_CONSTANTS) {
        constants.push({ path: item.path, valuePreview: mask(item.example), nodeIds: [...item.nodeIds] })
      }
      continue
    }
    const type: TraceInput['type'] = typeof [...item.values][0] === 'number' ? 'number' : 'string'
    const base = leafName(item.path)
    const name = uniqueName(base === 'value' ? `input_${inputIndex + 1}` : base, usedNames)
    inputIndex += 1
    inputs.push({
      name,
      path: item.path,
      nodeId: [...item.nodeIds][0] as string,
      nodeIds: [...item.nodeIds],
      type,
      examplePreview: mask(item.example),
      required: item.nodeIds.size <= 1,
      confidence: item.values.size > 1 ? 0.8 : 0.55,
      reason: item.values.size > 1 ? '同一路径在不同节点取值不同，像业务入参' : '未在前序响应中找到来源',
    })
  }

  const lastNode = nodes[nodes.length - 1]
  const outputs: TraceOutput[] = []
  if (lastNode !== undefined) {
    const leaves = nodeLeaves.get(lastNode.id)?.response ?? []
    const usedOutputs = new Set<string>()
    for (const leaf of leaves) {
      if (outputs.length >= MAX_OUTPUTS) break
      if (SENSITIVE_KEY.test(leaf.path)) continue
      const name = uniqueName(leafName(leaf.path), usedOutputs)
      outputs.push({
        name,
        path: leaf.path,
        nodeId: lastNode.id,
        type: typeof leaf.value === 'number' ? 'number' : typeof leaf.value === 'boolean' ? 'boolean' : 'string',
        examplePreview: mask(String(leaf.value)),
      })
    }
  }

  const assertions: TraceAssertion[] = []
  for (const node of nodes) {
    if (node.status !== undefined) {
      assertions.push({
        nodeId: node.id,
        path: 'status',
        equals: String(node.status),
        confidence: 0.9,
        reason: '录制时 HTTP 状态码',
      })
    }
    const leaves = nodeLeaves.get(node.id)?.response ?? []
    for (const leaf of leaves) {
      if (assertions.length >= MAX_ASSERTIONS) break
      if (!SUCCESS_KEY.test(leafName(leaf.path))) continue
      const value = String(leaf.value)
      if (!SUCCESS_VALUES.has(value.toLowerCase())) continue
      if (assertions.some((item) => item.nodeId === node.id && item.path === leaf.path)) continue
      assertions.push({
        nodeId: node.id,
        path: leaf.path,
        equals: value,
        confidence: 0.7,
        reason: '响应中的成功标记字段（通用键名启发）',
      })
    }
  }

  const candidateLeaves = [...nodeLeaves.values()].reduce((sum, item) => sum + item.request.length, 0)
  const boundLeaves = bindings.length
  const analyzedSamples = trace.samples.length - skipped.length
  const stats = {
    totalSamples: trace.stats.totalSamples,
    analyzedSamples,
    skippedSamples: skipped.length,
    nodes: nodes.length,
    writes: nodes.filter((node) => node.write).length,
    pages: new Set(nodes.map((node) => node.pageUrl).filter((page): page is string => page !== undefined)).size,
    truncatedBodies: trace.stats.truncatedBodies,
    staticAssets,
  }
  if (nodes.length === 0) {
    warnings.push({ code: 'no-business-calls', message: '没有可分析的业务调用（全部被识别为静态资源或空 trace）。' })
  }
  if (bindings.length === 0 && nodes.length > 1) {
    warnings.push({ code: 'no-bindings', message: '没有推断出字段流转：可能是正文加密/截断，或接口之间没有值传递。' })
  }

  return {
    captureId: trace.captureId,
    entryUrl: trace.entryUrl,
    stats,
    nodes,
    bindings,
    inputs,
    constants,
    outputs,
    assertions,
    coverage: {
      candidateLeaves,
      boundLeaves,
      bindingCoverage: candidateLeaves === 0 ? 0 : Number((boundLeaves / candidateLeaves).toFixed(3)),
      callCoverage: trace.samples.length === 0 ? 0 : Number((analyzedSamples / trace.samples.length).toFixed(3)),
    },
    warnings: warnings.slice(0, 100),
  }
}
