/**
 * 命令式 DOM 构建的最小 helper：所有用户数据一律走 textContent，
 * 不做任何 innerHTML 拼接——页面里展示的是采集站 HTTP 数据，注入面必须为零。
 *
 * @module dsh-dataforge/client/el
 */
export type ElAttrs = Partial<Record<string, string | boolean | number>>

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: ElAttrs = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue
    node.setAttribute(key, value === true ? '' : String(value))
  }
  for (const child of children) {
    if (child === null || child === undefined) continue
    node.append(child instanceof Node ? child : document.createTextNode(child))
  }
  return node
}

export function clearChildren(node: Element): void {
  while (node.firstChild !== null) node.removeChild(node.firstChild)
}

export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString()
}

/** 紧凑时间（MM-DD HH:mm）：时间行 / 卡片摘要用，避免 fmtTime 的年份噪声。 */
export function fmtShort(ts: number): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const at = new Date(ts)
  return `${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}
