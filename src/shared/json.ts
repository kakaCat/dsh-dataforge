/**
 * 工具回执的无损 JSON 投影。
 *
 * 工具的 output 走无损 JSON 校验：值里只要有一个 `undefined` 键，整次调用就会被判
 * 「value is not lossless JSON」而失败——而存储层/查询面的行映射器习惯把「缺省的列」
 * 直接映射成 undefined（可选字段）。在工具出口统一收口一次，比要求每个查询面各自
 * 记住这条纪律更可靠。
 *
 * 只递归纯对象与数组：Date/Buffer/类实例原样返回（它们不参与工具回执，也不该被拆平）。
 *
 * @module dsh-dataforge/shared/json
 */

/** 递归丢掉值为 undefined 的对象键（数组按元素递归；非纯对象原样返回）。 */
export function lossless<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => lossless(item)) as unknown as T
  if (value === null || typeof value !== 'object') return value
  const proto: unknown = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return value
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item === undefined) continue
    out[key] = lossless(item)
  }
  return out as T
}
