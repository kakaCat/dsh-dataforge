/**
 * 绑定求值（IF-5）：从上游响应根按 R-1 绑定路径取出参值。
 *
 * 纯函数：不修改 `root`、不读磁盘、不联网；同输入同输出。
 *
 * 路径语法（R-1 的子集，不引 JSONPath）：
 *   - 首段是 `body` / `status` / `headers` 时按信封取；否则整条路径对 `root.body` 求值
 *     （兼容早期只写 `items[0].id` 的手写链）；
 *   - `[n]` 取数组第 n 项，越界 → `path-not-found`；
 *   - `[*]` / `[]` 对数组做投影，结果为数组；多级 `[*]` 如实产出嵌套数组；
 *   - 投影结果 0 个元素 → `empty-wildcard`；目标为标量且恰好 1 个元素 → 解包并记
 *     `unwrapped: true`；目标为数组时保持数组（`array<T>` 同理）。多于 1 个而目标为
 *     标量 → `type-mismatch`（提示改用 `[0]` 或把目标声明成数组）。
 *   - `null` / `undefined` 一律视为缺值 → `null-value`，不静默塞给下游；
 *   - 路径不存在 / 结构不符（该是数组却不是、下标越界）→ `path-not-found`。
 *
 * `matched` 用 R-1 的 `fieldSegments` 归一（`[0]` / `[]` / `[*]` 都收敛成 `[*]`），
 * 这样运行记录里的绑定值能回指到链上的绑定边。
 *
 * @module dsh-dataforge/execute/binding
 */
import { fieldSegments } from '../chains/schema.js'

/** 求值根：上游响应信封（`body` 已按 JSON 解析，`headers` 是拼接后的头表）。 */
export type BindingRoot = { body: unknown; status: number; headers: Record<string, string> }

/** 绑定失败码（与 IF-5 一致）。 */
export type BindingFailureCode = 'path-not-found' | 'type-mismatch' | 'null-value' | 'empty-wildcard'

/** 绑定求值结果：成功带值与归一化命中路径，失败带码与中文原因。 */
export type BindingResult =
  | { ok: true; value: unknown; matched: string; unwrapped?: boolean }
  | { ok: false; code: BindingFailureCode; message: string; path: string }

type Envelope = 'body' | 'status' | 'headers'
type IndexToken = number | 'wildcard'
type PathSegment = { name: string; indexes: IndexToken[] }
type ParsedPath = { envelope?: Envelope; segments: PathSegment[] }
type EvalFailure = { code: BindingFailureCode; message: string }
type EvalResult = { ok: true; value: unknown } | { ok: false; failure: EvalFailure }

const ENVELOPES: ReadonlySet<string> = new Set(['body', 'status', 'headers'])

/** `items[0][*]` → 字段名 `items` + 两个下标；字段名本身不含方括号。 */
const SEGMENT_PATTERN = /^([^[\]]*)((?:\[[^[\]]*\])*)$/

/**
 * 解析一个可带下标的段；非法（如 `[abc]`）返回 undefined。
 *
 * 注意这里保留 `[n]` 的 n —— `fieldSegments` 会把 `[0]` 与 `[*]` 归一成同一个占位，
 * 求值时必须知道到底取第几项，只有 `matched` 才走归一化。
 */
function parseSegment(raw: string): PathSegment | undefined {
  const hit = SEGMENT_PATTERN.exec(raw)
  if (!hit) return undefined
  const name = (hit[1] ?? '').trim()
  const brackets = (hit[2] ?? '').match(/\[[^[\]]*\]/g) ?? []
  const indexes: IndexToken[] = []
  for (const bracket of brackets) {
    const inner = bracket.slice(1, -1).trim()
    if (inner === '' || inner === '*') {
      indexes.push('wildcard')
    } else if (/^\d+$/.test(inner)) {
      indexes.push(Number(inner))
    } else {
      return undefined
    }
  }
  if (name.length === 0 && indexes.length === 0) return undefined
  return { name, indexes }
}

/** 路径 → 信封 + 段数组；空路径/非法段返回 undefined。 */
function parsePath(path: string): ParsedPath | undefined {
  const raws = path
    .split('.')
    .map((raw) => raw.trim())
    .filter((raw) => raw.length > 0)
  if (raws.length === 0) return undefined

  let envelope: Envelope | undefined
  let start = 0
  const first = raws[0] ?? ''
  if (ENVELOPES.has(first)) {
    envelope = first as Envelope
    start = 1
  }

  const segments: PathSegment[] = []
  for (const raw of raws.slice(start)) {
    const segment = parseSegment(raw)
    if (!segment) return undefined
    segments.push(segment)
  }
  return { envelope, segments }
}

/** 段的中文定位（错误信息指出断在第几段）。 */
function segmentLabel(segment: PathSegment, step: number): string {
  const suffix = segment.indexes
    .map((index) => (index === 'wildcard' ? '[*]' : `[${index}]`))
    .join('')
  return `第 ${step} 段「${segment.name}${suffix}」`
}

function whereOf(segments: PathSegment[], step: number): string {
  const segment = segments[step]
  return segment ? segmentLabel(segment, step + 1) : '路径末尾'
}

/** 运行记录里给人看的实际类型。 */
function typeName(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function isPlainObject(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value) as unknown
  return proto === Object.prototype || proto === null
}

/** 有限数字，或可无损往返的数字字符串（`"12"` 可以，`"12abc"` / `"1.0"` 不行）。 */
function isNumericString(value: string): boolean {
  const text = value.trim()
  if (text.length === 0) return false
  const parsed = Number(text)
  return Number.isFinite(parsed) && String(parsed) === text
}

function isArrayType(expectedType: string): boolean {
  const base = expectedType.trim().toLowerCase()
  return base === 'array' || (base.startsWith('array<') && base.endsWith('>'))
}

/**
 * 类型匹配（与卡模板同词表）。返回实际类型用于错误信息；
 * `array<T>` 逐元素校验，元素的第一个不符点写进 actual（如 `array<string>`）。
 */
function matchType(value: unknown, expectedType: string): { ok: boolean; actual: string } {
  const expected = expectedType.trim()
  const base = expected.toLowerCase()

  if (base.startsWith('array<') && base.endsWith('>')) {
    if (!Array.isArray(value)) return { ok: false, actual: typeName(value) }
    const inner = expected.slice('array<'.length, -1).trim()
    if (inner.length === 0) return { ok: true, actual: 'array' }
    for (const item of value) {
      const result = matchType(item, inner)
      if (!result.ok) return { ok: false, actual: `array<${result.actual}>` }
    }
    return { ok: true, actual: 'array' }
  }

  switch (base) {
    case 'string':
      return { ok: typeof value === 'string', actual: typeName(value) }
    case 'number':
      return {
        ok: (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && isNumericString(value)),
        actual: typeName(value),
      }
    case 'boolean':
      return {
        ok: typeof value === 'boolean' || value === 'true' || value === 'false',
        actual: typeName(value),
      }
    case 'object':
      return { ok: isPlainObject(value), actual: typeName(value) }
    case 'array':
      return { ok: Array.isArray(value), actual: typeName(value) }
    case 'null':
      return { ok: value === null, actual: typeName(value) }
    default:
      // 未知类型词不阻断：卡片词表演进时执行器保持前向兼容。
      return { ok: true, actual: typeName(value) }
  }
}

/* ---------------------------------------------------------------- 求值核心 */

function failureOf(code: BindingFailureCode, message: string): EvalResult {
  return { ok: false, failure: { code, message } }
}

function nullFailure(path: string, where: string): EvalResult {
  return failureOf('null-value', `绑定路径「${path}」在${where}处取到 null/undefined，不能把空值传给下游`)
}

/** 路径求值里的每个中间值都不许是 null/undefined（显式缺值要如实报）。 */
function guardNull(value: unknown, path: string, where: string): EvalResult | undefined {
  return value === null || value === undefined ? nullFailure(path, where) : undefined
}

/** 读对象字段；字段不存在才是 `path-not-found`，字段存在但值是 null 交给 guard。 */
function readProperty(value: unknown, name: string, path: string, where: string): EvalResult {
  if (value === null || value === undefined) return nullFailure(path, where)
  if (typeof value !== 'object' || Array.isArray(value)) {
    return failureOf(
      'path-not-found',
      `绑定路径「${path}」在${where}处期望对象，实际类型 ${typeName(value)}`,
    )
  }
  if (!(name in value)) {
    return failureOf('path-not-found', `绑定路径「${path}」在${where}处未命中：字段「${name}」不存在`)
  }
  return { ok: true, value: (value as Record<string, unknown>)[name] }
}

/** 依次应用段内下标；`[*]` 投影到每个元素，并继续求后续段（多级通配得到嵌套数组）。 */
function applyIndexes(
  value: unknown,
  indexes: IndexToken[],
  segments: PathSegment[],
  step: number,
  where: string,
  path: string,
): EvalResult {
  const head = indexes[0]
  if (head === undefined) return evalSegments(value, segments, step + 1, path)

  if (!Array.isArray(value)) {
    return failureOf(
      'path-not-found',
      `绑定路径「${path}」在${where}处期望数组，实际类型 ${typeName(value)}`,
    )
  }

  if (head === 'wildcard') {
    const rest = indexes.slice(1)
    const projected: unknown[] = []
    for (const element of value) {
      const result = applyIndexes(element, rest, segments, step, where, path)
      if (!result.ok) return result
      projected.push(result.value)
    }
    return { ok: true, value: projected }
  }

  if (head >= value.length) {
    return failureOf(
      'path-not-found',
      `绑定路径「${path}」在${where}处下标 ${head} 越界（数组长度 ${value.length}）`,
    )
  }
  const element = value[head]
  const missing = guardNull(element, path, where)
  if (missing) return missing
  return applyIndexes(element, indexes.slice(1), segments, step, where, path)
}

/** 对当前值求第 step 段：先取字段，再应用段内下标，最后进入下一段。 */
function evalSegments(value: unknown, segments: PathSegment[], step: number, path: string): EvalResult {
  const where = whereOf(segments, step)
  const missing = guardNull(value, path, where)
  if (missing) return missing
  if (step >= segments.length) return { ok: true, value }

  const segment = segments[step] as PathSegment
  let current = value
  if (segment.name.length > 0) {
    const read = readProperty(current, segment.name, path, where)
    if (!read.ok) return read
    current = read.value
    const bad = guardNull(current, path, where)
    if (bad) return bad
  }
  return applyIndexes(current, segment.indexes, segments, step, where, path)
}

/** HTTP 头名大小写不敏感：lower-case 视图只影响求值，不改调用方的 headers。 */
function lowerCaseHeaders(headers: Record<string, string> | undefined): Record<string, unknown> {
  const view: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(headers ?? {})) {
    view[name.toLowerCase()] = value
  }
  return view
}

/* ------------------------------------------------------------------ 入口 */

/**
 * 按绑定路径从响应根取值。
 *
 * @param root 上游响应信封 `{ body, status, headers }`（不会被修改）
 * @param path R-1 绑定路径，如 `body.items[0].internalId` / `body.items[*].code` / `headers.x-total`
 * @param expectedType 可选目标类型（`string` / `number` / `boolean` / `object` / `array` / `null`，也接受 `array<T>`）
 */
export function resolveBinding(root: BindingRoot, path: string, expectedType?: string): BindingResult {
  const matched = fieldSegments(path).join('.')
  const fail = (code: BindingFailureCode, message: string): BindingResult => ({
    ok: false,
    code,
    message,
    path,
  })

  if (typeof path !== 'string' || path.trim().length === 0) {
    return fail('path-not-found', '绑定路径为空')
  }

  const parsed = parsePath(path)
  if (!parsed) {
    return fail('path-not-found', `绑定路径「${path}」无法解析：只支持字段名与 [n] / [*] / [] 下标`)
  }

  let segments = parsed.segments
  let current: unknown
  if (parsed.envelope === 'status') {
    current = root.status
  } else if (parsed.envelope === 'headers') {
    current = root.headers
    if (segments.length > 0) {
      const [first] = segments
      if (first && first.name.length > 0 && first.indexes.length === 0) {
        segments = [{ ...first, name: first.name.toLowerCase() }, ...segments.slice(1)]
      }
      current = lowerCaseHeaders(root.headers)
    }
  } else {
    current = root.body
  }

  const evaluated = evalSegments(current, segments, 0, path)
  if (!evaluated.ok) return fail(evaluated.failure.code, evaluated.failure.message)

  let value = evaluated.value
  let unwrapped = false
  const projected = segments.some((segment) => segment.indexes.includes('wildcard'))

  if (projected) {
    if (!Array.isArray(value)) {
      // 理论上不会发生：出现过通配就一定是投影数组。
      return fail('path-not-found', `绑定路径「${path}」的通配未产出数组`)
    }
    if (value.length === 0) {
      return fail(
        'empty-wildcard',
        `绑定路径「${path}」的通配（[*]）未匹配到任何元素；通常是上游查询为空，先确认上游请求参数`,
      )
    }

    const arrayTarget = expectedType !== undefined && expectedType.trim().length > 0 && isArrayType(expectedType)
    if (value.length === 1 && !arrayTarget) {
      // 目标为标量（或未声明）时解包；目标声明成数组则保持数组形状。
      value = value[0]
      unwrapped = true
    } else if (value.length > 1 && expectedType !== undefined && expectedType.trim().length > 0 && !arrayTarget) {
      return fail(
        'type-mismatch',
        `绑定路径「${path}」期望类型 ${expectedType}，但通配展开得到 ${value.length} 个元素的数组（实际类型 array）；请改用 [0] 或把目标声明成数组`,
      )
    }
  }

  if (expectedType !== undefined && expectedType.trim().length > 0) {
    const checked = matchType(value, expectedType)
    if (!checked.ok) {
      return fail(
        'type-mismatch',
        `绑定路径「${path}」期望类型 ${expectedType}，实际类型 ${checked.actual}`,
      )
    }
  }

  return unwrapped
    ? { ok: true, value, matched, unwrapped: true }
    : { ok: true, value, matched }
}
