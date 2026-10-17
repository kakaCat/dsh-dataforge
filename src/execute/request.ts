/**
 * 请求构造（R-3 IF-3 的 `buildRequest`）：计划节点 + 接口卡 + 已求值的入参 → 一条可发的请求。
 *
 * 纯函数：不联网、不读盘、不改入参。
 *
 * **值的来源**（③ 类，缺失即报错，绝不发空值）：
 *   ① `provided`：上游绑定求值结果，键是**归一化**后的字段路径（`body.lines[*].materialId`）；
 *   ② 节点 `constants`：值可能是字面量，也可能是 `$inputs.<name>` 槽位引用（取 `inputs` 里的运行值）；
 *   ③ path 参数（`path.p1` / `path.id`）只能来自 ① 或 ②，用于替换 URL 模板里的占位符。
 *
 * **URL**：模板里的 `{name}` 是占位符。采集期把数字/长随机段抽成**匿名** `{p}`，库投影时按
 * 出现次序命名为 `p1`/`p2`…（见 `library/import.ts` 的 `pathParamNamesOf`），所以 `{p}` 第 k 个
 * 对应 `path.pk`。query 部分：模板里的键序原样保留，`query.*` 入参覆盖同名键；空值写成裸键
 * （`&market`），与采集期的写法一致——`market=` 与 `market` 在有些服务端不是一回事。
 *
 * **body**：卡只记字段路径、不记样本值（R-1 红线），所以请求体是从零拼出来的。
 * `[*]` 一律落到第 0 行：卡里没有「行模板」，凭空展开多行只能是猜；要发多行请在链上写
 * `body.lines[0]`、`body.lines[1]` 这样的显式下标。给 `[*]` 字段喂数组会明确报错，不静默拼错。
 *
 * @module dsh-dataforge/execute/request
 */
import type { InterfaceCardDoc } from '../chains/schema.js'
import { inputSlotNameOf } from '../chains/schema.js'
import { normalizePath } from './coverage.js'
import type { PlanNode } from './plan.js'

/** 构造失败的分类（都可指到具体字段路径）。 */
export type RequestFailureCode = 'param-missing' | 'param-type-mismatch' | 'bad-url-template'

export type BuiltRequest = {
  method: string
  url: string
  headers: Record<string, string>
  /** JSON 序列化后的正文；GET/HEAD 无正文。 */
  body?: string
}

export type RequestBuildResult =
  | { ok: true; request: BuiltRequest; notices: string[] }
  | { ok: false; code: RequestFailureCode; message: string; path?: string }

export type BuildRequestInput = {
  node: PlanNode
  card: InterfaceCardDoc
  /** 运行根：`baseUrl` + `urlTemplate`。 */
  baseUrl: string
  /** 已求值的绑定值（键 = 归一化路径）。 */
  provided?: Record<string, unknown>
  /** 链级槽位运行值（常量里的 `$inputs.x` 从这里取）。 */
  inputs?: Record<string, unknown>
}

/** 一个已经拿到值的入参。 */
type ResolvedField = { path: string; type: string; value: unknown }

const JSON_CONTENT_TYPE = 'application/json'

function hasOwn(record: Record<string, unknown> | undefined, key: string): boolean {
  return record !== undefined && Object.prototype.hasOwnProperty.call(record, key) && record[key] !== undefined
}

/**
 * 把卡入参逐个解析出值：绑定优先，其次节点常量（含 `$inputs.x` 槽位引用）。
 *
 * 没解析出值的字段不在这里报错——`plan.buildPlan` 已经做过静态缺参判定，
 * 走到这里还缺就是运行期漏传，由 {@link buildRequest} 统一报 `param-missing`。
 */
function resolveFields(input: BuildRequestInput): { fields: ResolvedField[]; missing: ResolvedField[] } {
  const provided = input.provided ?? {}
  const inputs = input.inputs ?? {}
  const constants = input.node.constants ?? {}
  const constantKeys = Object.keys(constants)
  const fields: ResolvedField[] = []
  const missing: ResolvedField[] = []

  for (const field of input.card.inputs ?? []) {
    // 凭证由 R-4 注入（卡里今天也不会有该角色）：不报缺参、更不发空值。
    if (field.role === 'credential') continue
    const key = normalizePath(field.path)

    if (hasOwn(provided, key)) {
      fields.push({ path: field.path, type: field.type, value: provided[key] })
      continue
    }

    const constantKey = constantKeys.find((candidate) => normalizePath(candidate) === key)
    if (constantKey !== undefined) {
      const raw = constants[constantKey]
      const slot = typeof raw === 'string' ? inputSlotNameOf(raw) : undefined
      if (slot === undefined) {
        fields.push({ path: field.path, type: field.type, value: raw })
        continue
      }
      if (hasOwn(inputs, slot)) {
        fields.push({ path: field.path, type: field.type, value: inputs[slot] })
        continue
      }
    }

    missing.push({ path: field.path, type: field.type, value: undefined })
  }

  return { fields, missing }
}

/** 值 → 字符串（URL/请求头/路径参数只接受标量；对象/数组在这里是错的用法）。 */
function scalarText(field: ResolvedField): string | undefined {
  const value = field.value
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null) return undefined
  return undefined
}

/** 路径段：属性名或数组下标（`[*]` 归一成 0）。 */
type PathSegment = { kind: 'prop'; name: string } | { kind: 'index'; index: number; wildcard: boolean }

function parseBodyPath(path: string): PathSegment[] {
  const segments: PathSegment[] = []
  const pattern = /([^.[\]]+)|\[(\d+|\*)\]/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(path)) !== null) {
    if (match[1] !== undefined) {
      segments.push({ kind: 'prop', name: match[1] })
      continue
    }
    const raw = match[2] ?? ''
    segments.push(raw === '*' ? { kind: 'index', index: 0, wildcard: true } : { kind: 'index', index: Number(raw), wildcard: false })
  }
  return segments
}

/** 往请求体骨架里写一个值（中途按下一段是属性还是下标决定建对象还是建数组）。 */
function assignBody(root: Record<string, unknown>, path: string, value: unknown): string | undefined {
  const segments = parseBodyPath(path)
  if (segments.length === 0) return `空的 body 字段路径`
  let cursor: Record<string, unknown> | unknown[] = root

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i] as PathSegment
    const isLast = i === segments.length - 1
    const next = segments[i + 1]

    if (isLast) {
      if (segment.kind === 'index') return `body 字段路径不能以下标结尾：${path}`
      if (Array.isArray(value) && path.includes('[*]')) {
        return `字段 ${path} 是通配行（[*]），不能直接喂数组：请在链上写显式下标（如 body.lines[0].materialId）`
      }
      ;(cursor as Record<string, unknown>)[segment.name] = value
      return undefined
    }

    const wantsArray = next !== undefined && next.kind === 'index'
    if (segment.kind === 'prop') {
      const holder = cursor as Record<string, unknown>
      if (holder[segment.name] === undefined) holder[segment.name] = wantsArray ? [] : {}
      cursor = holder[segment.name] as Record<string, unknown> | unknown[]
      continue
    }

    const holder = cursor as unknown[]
    const index = segment.wildcard ? 0 : segment.index
    if (holder[index] === undefined) holder[index] = wantsArray ? [] : {}
    cursor = holder[index] as Record<string, unknown> | unknown[]
  }

  return undefined
}

/** 模板 query 段 → 有序键值对（值为空表示裸键）。 */
function parseTemplateQuery(query: string): Array<[string, string]> {
  if (query === '') return []
  return query
    .split('&')
    .filter((pair) => pair !== '')
    .map((pair) => {
      const at = pair.indexOf('=')
      return at === -1 ? ([pair, ''] as [string, string]) : ([pair.slice(0, at), pair.slice(at + 1)] as [string, string])
    })
}

function serializeQuery(pairs: Array<[string, string]>): string {
  return pairs.map(([name, value]) => (value === '' ? name : `${name}=${encodeURIComponent(value)}`)).join('&')
}

/**
 * 构造一条请求。
 *
 * 失败一律带 `path`（能指到具体字段就指），让回执能直接告诉 agent 该改链上的哪个位置。
 */
export function buildRequest(input: BuildRequestInput): RequestBuildResult {
  const { fields, missing } = resolveFields(input)
  const notices: string[] = []

  if (missing.length > 0) {
    const first = missing[0] as ResolvedField
    return {
      ok: false,
      code: 'param-missing',
      message: `节点 ${input.node.nodeId} 缺入参：${missing.map((field) => `${field.path}（${field.type}）`).join('、')}`,
      path: first.path,
    }
  }

  const template = input.card.identity.urlTemplate
  const mark = template.indexOf('?')
  const rawPath = mark === -1 ? template : template.slice(0, mark)
  const rawQuery = mark === -1 ? '' : template.slice(mark + 1)

  // ── path 参数：{p} 第 k 个 ↔ path.pk ──
  const pathValues = new Map<string, string>()
  const queryPairs = parseTemplateQuery(rawQuery)
  const headers: Record<string, string> = {}
  const body: Record<string, unknown> = {}
  let hasBodyField = false

  for (const field of fields) {
    const at = field.path.indexOf('.')
    const location = at === -1 ? field.path : field.path.slice(0, at)
    const rest = at === -1 ? '' : field.path.slice(at + 1)

    if (location === 'path') {
      const text = scalarText(field)
      if (text === undefined) {
        return { ok: false, code: 'param-type-mismatch', message: `path 参数 ${field.path} 必须是标量`, path: field.path }
      }
      pathValues.set(rest, text)
      continue
    }
    if (location === 'header') {
      const text = scalarText(field)
      if (text === undefined) {
        return { ok: false, code: 'param-type-mismatch', message: `请求头 ${field.path} 必须是标量`, path: field.path }
      }
      headers[rest] = text
      continue
    }
    if (location === 'body') {
      const failure = assignBody(body, rest, field.value)
      if (failure !== undefined) return { ok: false, code: 'param-type-mismatch', message: failure, path: field.path }
      hasBodyField = true
      continue
    }
    if (location === 'query') {
      const text = scalarText(field)
      if (text === undefined) {
        return { ok: false, code: 'param-type-mismatch', message: `query 参数 ${field.path} 必须是标量`, path: field.path }
      }
      const hit = queryPairs.find(([name]) => name === rest)
      if (hit === undefined) queryPairs.push([rest, text])
      else hit[1] = text
      continue
    }

    notices.push(`未知的入参位置前缀「${location}」（字段 ${field.path}），已忽略`)
  }

  // ── URL 模板占位符替换 ──
  // `{p}` 是采集期抽出来的**匿名**占位符，按出现次序对应 `path.p1`、`path.p2`…
  // （与 library/import.ts 的 pathParamNamesOf 同一套命名）；`{id}` 这类具名占位符按名字取。
  let anonymousSeen = 0
  let missingPlaceholder: { key: string; anonymous: boolean } | undefined
  const resolvedPath = rawPath.replace(/\{([A-Za-z0-9_]+)\}/g, (_match, name: string) => {
    const anonymous = name === 'p'
    const key = anonymous ? `p${(anonymousSeen += 1)}` : name
    const value = pathValues.get(key)
    if (value === undefined) {
      missingPlaceholder = missingPlaceholder ?? { key, anonymous }
      return ''
    }
    return encodeURIComponent(value)
  })
  if (missingPlaceholder !== undefined) {
    const shown = missingPlaceholder.anonymous ? 'p' : missingPlaceholder.key
    return {
      ok: false,
      code: 'param-missing',
      message: `URL 模板占位符 {${shown}} 没有值：在链上给 path.${missingPlaceholder.key} 常量或绑定（匿名 {p} 按次序对应 path.p1、path.p2…）`,
      path: `path.${missingPlaceholder.key}`,
    }
  }

  // ── query 里残留的占位符：`?q={q}` 这种写法要由 `query.q` 覆盖掉 ──
  // 采集期的模板写的是字面值（`q=2120`），但手写链/老夹具会出现 `{q}`；覆盖到就没事，
  // 覆盖不到就必须报错——把 `{q}` 原样发出去是最难查的一类错。
  const leftover = queryPairs.find(([, value]) => /^\{[A-Za-z0-9_]+\}$/.test(value))
  if (leftover !== undefined) {
    const name = leftover[1].slice(1, -1)
    return {
      ok: false,
      code: 'param-missing',
      message: `query 模板占位符 {${name}} 没有值：在链上给 query.${name} 常量或绑定`,
      path: `query.${name}`,
    }
  }

  // 不在场却出现在模板里的 path.* 值：不是错，只是没用到（占位符可能少于字段）。
  const base = input.baseUrl.replace(/\/+$/, '')
  const query = serializeQuery(queryPairs)
  const url = query === '' ? `${base}${resolvedPath}` : `${base}${resolvedPath}?${query}`
  try {
    // 只做合法性校验：拼接错（比如模板里混进绝对 URL）必须当场暴露。
    new URL(url)
  } catch {
    return { ok: false, code: 'bad-url-template', message: `拼出来的 URL 不合法：${url}` }
  }

  const method = input.node.method.toUpperCase()
  const sendsBody = method !== 'GET' && method !== 'HEAD' && hasBodyField
  if (sendsBody) {
    const hasContentType = Object.keys(headers).some((name) => name.toLowerCase() === 'content-type')
    if (!hasContentType) headers['content-type'] = JSON_CONTENT_TYPE
  }

  return {
    ok: true,
    request: {
      method,
      url,
      headers,
      ...(sendsBody ? { body: JSON.stringify(body) } : {}),
    },
    notices,
  }
}
