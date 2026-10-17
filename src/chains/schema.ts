/**
 * 链（chain）与项目接口卡的共享契约：YAML 形状 + 类型 + 解析入口。
 *
 * 全部用 type 别名：工具 output.schema 推断要求 Record 兼容（interface 会被
 * 没有 implicit index signature 的规则卡死，见 src/shared/capture-types.ts 的同款警告）。
 *
 * 边界（重要）：schemastery 的 object 既不报未知键、也不保留它们（实测：多余键被丢掉），
 * 所以它只负责形状与必填；悬空卡引用、成环、绑定字段存在性、绑定与常量互斥、
 * 僵尸槽位这些语义检查全在 validate.ts —— 严格性来自显式检查，不来自 schema。
 * 未知键的保留由 normalizeDoc 从原始映射里捞回（IF-3 承诺"未知字段原样保留不丢"）。
 *
 * 绑定路径用自定义点路径，不用 JSONPath：
 *   - `<节点 id>.<字段路径>`，如 `query-material.body.items[0].internalId`
 *   - 节点 id 因此不许带 `.`（validate 会报）
 *   - `[n]` / `[*]` / `[]` 在比对时视作同一个占位（卡模板用 `[*]`，手写常用 `[0]`）
 *
 * 链级入参槽位（FR-1.7）的引用语法：常量值或边的 from 写 `$inputs.<name>`。
 * 文档没定这条语法（见 r1 设计「开放问题」），这里定成显式前缀，便于 grep 与校验；
 * R-6 结晶只需把用户给的值替换成槽位引用即可。
 *
 * @module dsh-dataforge/chains/schema
 */
import Schema from '@deepseek-ai/schemastery'
import yaml from 'js-yaml'

/** 链文件格式版本；写进每份链文件，未来演进走它。 */
export const CHAIN_API_VERSION = 'dataforge/v1'

/** 链级入参槽位引用前缀：`$inputs.materialCodes`。 */
export const INPUT_SLOT_PREFIX = '$inputs.'

/** 链文件两种形态：可执行的接口链 与 需编译的页面链。 */
export type ChainKind = 'interface-chain' | 'page-chain'

/** 链级入参槽位的类型词表（与卡的字段类型同源，数组用 `array<T>` 写）。 */
export const CHAIN_VALUE_TYPES = [
  'string',
  'number',
  'boolean',
  'object',
  'array',
  'null',
  'array<string>',
  'array<number>',
  'array<boolean>',
  'array<object>',
] as const

export type ChainValueType = (typeof CHAIN_VALUE_TYPES)[number]

/** 链级入参槽位（FR-1.7）：声明即校验，R-6 结晶时写 example 值。 */
export type ChainInput = {
  name: string
  type: ChainValueType
  required: boolean
  /** 本次运行用户给的示例值（R-6 写入，供复跑时替换）。 */
  example?: string
}

/**
 * 链节点：interface-chain 用 `card:`，page-chain 用 `page:`（同一 id 命名空间）。
 * `constants` 是 R-6 结晶的常量写入点，键 = 卡字段路径，值 = 字面值或槽位引用。
 */
export type ChainNode = {
  id: string
  card?: string
  page?: string
  constants: Record<string, string>
  /** FR-1.2 节点级配置预留位（本期只落盘不执行，R-3 消费）。 */
  retry?: number
  timeoutSeconds?: number
}

/** 边 = 绑定声明（FR-1.3）；`suggested: true` 只出现在编译草稿里。 */
export type ChainEdge = {
  from: string
  to: string
  suggested?: boolean
}

export type ChainMeta = {
  site: string
  flow: string
  version: number
  created: string
}

/** 一份链文件（= 一个版本快照）。 */
export type ChainDoc = {
  apiVersion: string
  kind: ChainKind
  meta: ChainMeta
  inputs: ChainInput[]
  nodes: ChainNode[]
  edges: ChainEdge[]
}

/** 接口卡的一个字段（入参/出参同形）；`[n]` 与 `[*]` 等价。 */
export type CardIoField = {
  path: string
  /** 采集期投影的类型原样带着（string/number/... 或 array<string>）。 */
  type: string
  required?: boolean
  /** 一期变量角色标注原样带上（如 search-key）。 */
  role?: string
}

export type CardIdentity = {
  mergeKey: string
  method: string
  urlTemplate: string
}

export type CardSource = {
  captureId: string
  pages?: string[]
  relationIds?: string[]
}

/**
 * 项目接口库的卡（只取链校验要用的投影）。
 *
 * 刻意不 import `src/library/**`：library 是另一条写入线，链侧只认这份结构性契约，
 * 只要对象字段对得上就能当卡用（解耦缝 = 注入的 CardResolver）。
 */
export type InterfaceCardDoc = {
  cardId: string
  kind: 'interface-card'
  identity: CardIdentity
  inputs: CardIoField[]
  outputs: CardIoField[]
  /** 鉴权标志（如 cookie-session）——永不含凭证值。 */
  auth?: string
  sources?: CardSource[]
  name?: string
}

/** 卡引用解析器：注入式，返回 undefined 即"卡不在项目接口库"。 */
export type CardResolver = (cardId: string) => InterfaceCardDoc | undefined

/**
 * 校验/解析问题：`target` 指到 `nodes[i]` / `edges[j]` / `inputs[i]` / `meta`，
 * `reason` 是给人看的中文原因。
 */
export type ChainIssueCode =
  | 'invalid-chain'
  | 'card-not-imported'
  | 'bad-node-id'
  | 'duplicate-node-id'
  | 'node-kind-mismatch'
  | 'unknown-node'
  | 'cycle'
  | 'bad-binding-path'
  | 'unknown-source-field'
  | 'unknown-target-field'
  | 'binding-constant-conflict'
  | 'duplicate-input-slot'
  | 'unknown-input-slot'
  | 'unreferenced-input-slot'
  | 'invalid-input-type'
  | 'credential-in-constants'

export type ChainIssue = {
  target: string
  code: ChainIssueCode
  reason: string
}

export type ChainParseResult =
  | { ok: true; doc: ChainDoc }
  | { ok: false; issues: ChainIssue[] }

/* ------------------------------------------------------------------ schema */

const IoFieldSchema = Schema.object({
  path: Schema.string().required(),
  type: Schema.string().required(),
  required: Schema.boolean(),
  role: Schema.string(),
})

const CardSourceSchema = Schema.object({
  captureId: Schema.string().required(),
  pages: Schema.array(Schema.string()),
  relationIds: Schema.array(Schema.string()),
})

export const InterfaceCardSchema = Schema.object({
  cardId: Schema.string().required(),
  kind: Schema.const('interface-card' as const).required(),
  identity: Schema.object({
    mergeKey: Schema.string().required(),
    method: Schema.string().required(),
    urlTemplate: Schema.string().required(),
  }).required(),
  inputs: Schema.array(IoFieldSchema).default([]),
  outputs: Schema.array(IoFieldSchema).default([]),
  auth: Schema.string(),
  sources: Schema.array(CardSourceSchema),
  name: Schema.string(),
})

/** 常量值允许裸写数字/布尔（YAML 里 2120 不是字符串），落地时统一成字符串。 */
const ConstantValueSchema = Schema.union([Schema.string(), Schema.number(), Schema.boolean()])

const NodeSchema = Schema.object({
  id: Schema.string().required(),
  card: Schema.string(),
  page: Schema.string(),
  constants: Schema.dict(ConstantValueSchema).default({}),
  retry: Schema.number().min(0),
  timeoutSeconds: Schema.number().min(0),
})

const EdgeSchema = Schema.object({
  from: Schema.string().required(),
  to: Schema.string().required(),
  suggested: Schema.boolean(),
})

const InputSchema = Schema.object({
  name: Schema.string().required(),
  type: Schema.string().required(),
  required: Schema.boolean().default(false),
  example: Schema.string(),
})

const MetaSchema = Schema.object({
  site: Schema.string().required(),
  flow: Schema.string().required(),
  version: Schema.number().min(1).required(),
  created: Schema.string().required(),
})

export const ChainSchema = Schema.object({
  apiVersion: Schema.string().required(),
  kind: Schema.union([Schema.const('interface-chain' as const), Schema.const('page-chain' as const)]).required(),
  meta: MetaSchema.required(),
  inputs: Schema.array(InputSchema).default([]),
  nodes: Schema.array(NodeSchema).required(),
  edges: Schema.array(EdgeSchema).default([]),
})

/* ----------------------------------------------------------------- helpers */

/**
 * 从 schemastery 的报错里摘出字段路径。
 *
 * 实测：ValidationError 只有 `options`/`name` 两个自有键，`err.path`/`err.detail` 都是
 * undefined，路径只能从 message 里取（形如 `$.nodes[0].card missing required value`）。
 */
export function schemaErrorPath(message: string): string {
  const text = message.trim()
  if (!text.startsWith('$')) return ''
  return text.slice(1).replace(/^\./, '').split(/\s/)[0] ?? ''
}

/** 把路径收敛成 issue 的 target（`nodes[0].card` → `nodes[0]`）。 */
export function issueTargetOf(path: string): string {
  const hit = /^(nodes|edges|inputs|meta)(\[\d+\])?/.exec(path)
  if (hit) return `${hit[1]}${hit[2] ?? ''}`
  return path || 'chain'
}

/** 一条 issue 的文字形态（工具回执直接用）。 */
export function formatIssue(issue: ChainIssue): string {
  return `${issue.target}: ${issue.reason}`
}

/** 多行原因（IF-2 的 `invalid-chain` 回执用它拼错误数组）。 */
export function formatIssues(issues: ChainIssue[]): string {
  return issues.map(formatIssue).join('\n')
}

/**
 * IF-2 的错误码归类：整批问题都是"卡没导入"时给 `card-not-imported`（提示先跑 IF-1），
 * 其余一律 `invalid-chain`。混合时按 `invalid-chain` 报，但 issues 里逐条仍带各自 code。
 */
export function chainErrorCode(issues: ChainIssue[]): 'card-not-imported' | 'invalid-chain' {
  if (issues.length > 0 && issues.every((issue) => issue.code === 'card-not-imported')) return 'card-not-imported'
  return 'invalid-chain'
}

/** 字段路径 → 段数组；`[0]`/`[*]`/`[]` 都归一成 `[*]`（卡模板与手写路径才能对上）。 */
export function fieldSegments(path: string): string[] {
  return path
    .replace(/\[\s*\d*\s*\]/g, '[*]')
    .split('.')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
}

/** 路径的叶子名（`body.items[*].internalId` → `internalId`），编译建议用。 */
export function fieldLeaf(path: string): string {
  const segments = fieldSegments(path)
  return segments.length > 0 ? segments[segments.length - 1].replace(/\[\*\]$/, '') : ''
}

/** 字段名归一（大小写、下划线、连字符不参与比较）。 */
export function normalizeFieldName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** `<节点 id>.<字段路径>` → 两段；无 `.` 或 id 为空返回 undefined。 */
export function splitBindingPath(path: string): { nodeId: string; fieldPath: string } | undefined {
  const dot = path.indexOf('.')
  if (dot <= 0 || dot === path.length - 1) return undefined
  return { nodeId: path.slice(0, dot), fieldPath: path.slice(dot + 1) }
}

/** 是否是链级槽位引用（`$inputs.materialCodes`）。 */
export function isInputSlotRef(value: string): boolean {
  return value.startsWith(INPUT_SLOT_PREFIX) && value.length > INPUT_SLOT_PREFIX.length
}

/** 取槽位名；不是槽位引用返回 undefined。 */
export function inputSlotNameOf(value: string): string | undefined {
  return isInputSlotRef(value) ? value.slice(INPUT_SLOT_PREFIX.length) : undefined
}

/** 造一个槽位引用字面量。 */
export function inputSlotRef(name: string): string {
  return `${INPUT_SLOT_PREFIX}${name}`
}

/**
 * 绑定路径是否落在卡字段表里。
 *
 * 规则：归一段逐段相等；或绑定路径下钻到某个已声明的 object/array 字段内部
 * （卡模板只声明到容器时仍允许绑它下面的字段，别拿"模板粗"当"路径错"）。
 */
export function isFieldDeclared(bindingPath: string, fields: CardIoField[]): boolean {
  const target = fieldSegments(bindingPath)
  if (target.length === 0) return false
  const same = (left: string[], right: string[]): boolean =>
    left.length === right.length &&
    left.every((segment, index) => segment.replace(/\[\*\]$/, '') === right[index].replace(/\[\*\]$/, ''))
  for (const field of fields) {
    const declared = fieldSegments(field.path)
    if (declared.length === 0) continue
    if (same(declared, target)) return true
    // 模板只声明到容器（body.items）时，允许绑它下面的字段（别把"模板粗"当"路径错"）
    const descends =
      declared.length < target.length &&
      declared.every((segment, index) => segment.replace(/\[\*\]$/, '') === target[index].replace(/\[\*\]$/, ''))
    if (descends && (field.type === 'object' || field.type.startsWith('array'))) return true
  }
  return false
}

/** 卡字段表里找同路径的声明（constants 合法性提示用）。 */
export function findDeclaredField(bindingPath: string, fields: CardIoField[]): CardIoField | undefined {
  const target = fieldSegments(bindingPath)
  return fields.find((field) => {
    const declared = fieldSegments(field.path)
    return declared.length === target.length && declared.every((segment, index) => segment === target[index])
  })
}

/* ------------------------------------------------------------------- parse */

function issueOfSchemaFailure(error: unknown): ChainIssue {
  const message = error instanceof Error ? error.message : String(error)
  const path = schemaErrorPath(message)
  return {
    target: issueTargetOf(path),
    code: 'invalid-chain',
    reason: `schema 校验失败：${message}`,
  }
}

/** 把 schema 产物收敛成规范化的 ChainDoc（默认值补齐 + 常量统一成字符串）。 */
function normalizeDoc(raw: unknown): ChainDoc {
  const doc = raw as ChainDoc & {
    inputs?: Array<Omit<ChainInput, 'required'> & { required?: boolean }>
    nodes?: Array<Omit<ChainNode, 'constants'> & { constants?: Record<string, unknown> }>
    edges?: Array<Omit<ChainEdge, 'suggested'> & { suggested?: boolean }>
  }
  const docUnknown = unknownKeysOf(doc)
  return {
    ...docUnknown,
    apiVersion: doc.apiVersion,
    kind: doc.kind,
    meta: {
      ...unknownKeysOf(doc.meta),
      site: doc.meta.site,
      flow: doc.meta.flow,
      version: doc.meta.version,
      created: toIsoString(doc.meta.created),
    },
    inputs: (doc.inputs ?? []).map((input) => ({
      ...unknownKeysOf(input),
      name: input.name,
      type: input.type,
      required: input.required === true,
      ...(input.example === undefined ? {} : { example: input.example }),
    })),
    nodes: (doc.nodes ?? []).map((node) => ({
      ...unknownKeysOf(node),
      id: node.id,
      ...(node.card === undefined ? {} : { card: node.card }),
      ...(node.page === undefined ? {} : { page: node.page }),
      constants: Object.fromEntries(
        Object.entries(node.constants ?? {}).map(([key, value]) => [key, String(value)]),
      ),
      ...(node.retry === undefined ? {} : { retry: node.retry }),
      ...(node.timeoutSeconds === undefined ? {} : { timeoutSeconds: node.timeoutSeconds }),
    })),
    edges: (doc.edges ?? []).map((edge) => ({
      ...unknownKeysOf(edge),
      from: edge.from,
      to: edge.to,
      ...(edge.suggested === true ? { suggested: true } : {}),
    })),
  }
}

/**
 * 只留 schema 不认识的键：schemastery 的 object 会把未知键**丢掉**（不报错），
 * 所以从原始映射里把它们捞回来——IF-3 承诺"未知字段原样保留不丢"，靠这一步兑现。
 */
function unknownKeysOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {}
}

/** YAML 1.1 的时间戳可能被解析成 Date；链里的 created 统一成 ISO 字符串。 */
function toIsoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  return typeof value === 'string' ? value : String(value)
}

/**
 * 校验器调用壳：schemastery 的调用签名要求具体对象类型，而我们的输入来自
 * YAML/工具入参（unknown）——形状是否合法正是它要判的事，所以这里显式放宽。
 */
function callSchema<T>(schema: Schema<T>, value: unknown): T {
  return (schema as unknown as (input: unknown) => T)(value)
}

/** 已解析的 YAML 值 → ChainDoc；只做形状/必填（语义在 validate.ts）。 */
export function parseChainDoc(raw: unknown): ChainParseResult {
  try {
    return { ok: true, doc: normalizeDoc(callSchema(ChainSchema, raw)) }
  } catch (error) {
    return { ok: false, issues: [issueOfSchemaFailure(error)] }
  }
}

/** 链 YAML 文本 → ChainDoc；YAML 语法错也算 `invalid-chain`。 */
export function parseChainYaml(text: string): ChainParseResult {
  let raw: unknown
  try {
    raw = loadYamlValue(text)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      issues: [{ target: 'chain', code: 'invalid-chain', reason: `YAML 解析失败：${message}` }],
    }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      issues: [{ target: 'chain', code: 'invalid-chain', reason: '链文件必须是一个 YAML 映射（key: value）' }],
    }
  }
  return parseChainDoc(raw)
}

/** 卡 YAML 文本 → InterfaceCardDoc（undefined = 文件坏了/不是卡）。 */
export function parseCardDoc(raw: unknown): InterfaceCardDoc | undefined {
  try {
    const card = callSchema(InterfaceCardSchema, raw)
    return {
      ...card,
      inputs: card.inputs ?? [],
      outputs: card.outputs ?? [],
    }
  } catch {
    return undefined
  }
}

/**
 * YAML 文本 → JS 值（CORE schema：不把 `created: 2026-10-17T12:00:00Z` 解析成 Date）。
 *
 * 链/卡文件是给人手改的项目资产，时间戳就该是字符串；YAML 1.1 的 timestamp 类型
 * 会让 `Schema.string()` 报"expected string but got ..."，纯属坑人。
 */
export function loadYamlValue(text: string): unknown {
  return yaml.load(text, { schema: yaml.CORE_SCHEMA })
}

/** ChainDoc → 链 YAML 文本（读回时手改过的字段原样保留，不丢未知键）。 */
export function chainToYaml(doc: ChainDoc): string {
  return yaml.dump(doc, { lineWidth: 120, noRefs: true, sortKeys: false })
}

/** 原始 YAML 值（工具层要拿来做非链用途时用）。 */
export function chainFromYaml(text: string): unknown {
  return loadYamlValue(text)
}
