/**
 * 执行期的入参覆盖判定与值类型校验（纯函数，无 IO、不发请求）。
 *
 * 覆盖判定是 R-3 的硬规则，来自 r3 设计「数据模型·缺参判据」：
 *
 * ```text
 * covered(node) = { normalize(k) | k ∈ node.constants } ∪ { normalize(e.to 的字段路径) | e.to.nodeId = node.id }
 * missing(node) = card.inputs.filter(f =>
 *       f.role !== 'credential'            // 凭证由 R-4 注入，引擎不发空值
 *    && !covered(node).has(normalize(f.path))
 * )
 * ```
 *
 * **`required` 绝不参与判据**：R-1 的卡投影里 `required = (role === 'input')`，
 * 而真实单样本卡的字段几乎全是 `required: false`；拿它判缺参会把「必须给值的入参」
 * 全部放行，进而静默发空值。判据只看「模板里有这个入参 + 无常量 + 无绑定 + 不是 credential」。
 *
 * 路径归一统一走 `fieldSegments(path).join('.')`（与 R-1 校验同一把尺）：
 * `body.lines[0].quantity` 与 `body.lines[*].quantity` 是同一个字段。
 *
 * @module dsh-dataforge/execute/coverage
 */
import type { CardIoField, ChainDoc, ChainNode, InterfaceCardDoc } from '../chains/schema.js'
import { fieldSegments, splitBindingPath } from '../chains/schema.js'

/**
 * 绑定/常量/卡模板路径的归一形式：`fieldSegments(path).join('.')`。
 *
 * `[0]` / `[*]` / `[]` 一律收敛成 `[*]`，所以覆盖判定不再需要关心写法差异。
 */
export function normalizePath(path: string): string {
  return fieldSegments(path).join('.')
}

/**
 * 一个节点已被静态赋值的入参路径集合（归一后）。
 *
 * 两个来源：
 *   - 节点 `constants` 的键（R-6 结晶的常量写入点）；
 *   - 以该节点为终点的绑定边 `to` 的字段路径（边只表示「上游产出填这里」，
 *     值在执行期由 `resolveBinding` 取得）。
 *
 * 槽位引用 `$inputs.<name>` 不在这里展开：它仍是常量值，键已经被覆盖；
 * 槽位有没有运行值是 `buildPlan()` 的事（缺值是链级缺参，不是节点覆盖问题）。
 */
export function coveredPaths(doc: ChainDoc, node: ChainNode): Set<string> {
  const covered = new Set<string>()
  for (const key of Object.keys(node.constants ?? {})) {
    const normalized = normalizePath(key)
    if (normalized.length > 0) covered.add(normalized)
  }
  for (const edge of doc.edges) {
    const to = splitBindingPath(edge.to)
    if (!to || to.nodeId !== node.id) continue
    const normalized = normalizePath(to.fieldPath)
    if (normalized.length > 0) covered.add(normalized)
  }
  return covered
}

/**
 * 一条静态缺参：按设计回执「节点 + 卡字段路径 + 类型」逐条给。
 *
 * `target` 是给 agent 的补值指向（与 `path` 不同：path 是卡字段路径）：
 *   - 卡入参缺值 → `node:<节点 id>`（去补 constants 或加绑定边）；
 *   - 链级槽位缺值 → `$inputs.<槽位名>`（去 `inputs` 里给运行值）。
 */
export type StaticGap = {
  nodeId: string
  path: string
  type: string
  target: string
}

/**
 * 卡模板里有、但节点既无常量也无绑定、且不是凭证字段的入参。
 *
 * 不看 `f.required`（见模块头注释）。`covered` 必须来自 {@link coveredPaths}
 * （已归一）；未归一的集合会让 `[n]`/`[*]` 的差异漏判。
 *
 * 凭证字段（`role === 'credential'`）直接跳过：凭证由 R-4 注入，引擎既不发空值
 * 也不报缺参；调用方需要自己记一条 `auth-not-injected` 提示（plan.ts 负责）。
 */
export function missingInputs(node: ChainNode, card: InterfaceCardDoc, covered: Set<string>): StaticGap[] {
  const gaps: StaticGap[] = []
  for (const field of card.inputs ?? []) {
    if (field.role === 'credential') continue
    if (covered.has(normalizePath(field.path))) continue
    gaps.push(gapOf(node, field))
  }
  return gaps
}

function gapOf(node: ChainNode, field: CardIoField): StaticGap {
  return {
    nodeId: node.id,
    path: field.path,
    type: field.type,
    target: `node:${node.id}`,
  }
}

/* ------------------------------------------------------------------ 类型 */

const SCALAR_CHECKS: Record<string, (value: unknown) => boolean> = {
  string: (value) => typeof value === 'string',
  number: (value) => typeof value === 'number',
  boolean: (value) => typeof value === 'boolean',
  object: (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
  array: (value) => Array.isArray(value),
  null: (value) => value === null,
}

/**
 * 运行值是否符合链/卡声明的类型；符合返回 `undefined`，不符返回中文原因（带路径）。
 *
 * 用于链级槽位值（`dataforge_chain_run` 的 `inputs`）与后续请求构造的入参校验。
 * 类型词表与 R-1 的 `CHAIN_VALUE_TYPES` 同源：`string` / `number` / `boolean` /
 * `object` / `array` / `null` 与 `array<T>`。
 */
export function checkValueType(path: string, expected: string, value: unknown): string | undefined {
  const want = expected.trim()
  const nested = /^array<(.+)>$/.exec(want)
  if (nested) {
    if (!Array.isArray(value)) {
      return `${path}: 期望 ${want}，实际是 ${actualTypeOf(value)}`
    }
    const inner = nested[1].trim()
    for (let index = 0; index < value.length; index += 1) {
      const reason = checkValueType(`${path}[${index}]`, inner, value[index])
      if (reason !== undefined) return reason
    }
    return undefined
  }
  const check = SCALAR_CHECKS[want]
  if (!check) return `${path}: 未知的值类型 ${want}`
  return check(value) ? undefined : `${path}: 期望 ${want}，实际是 ${actualTypeOf(value)}`
}

function actualTypeOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') return 'object'
  if (value === undefined) return 'undefined'
  return typeof value
}
