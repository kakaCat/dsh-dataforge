/**
 * 面板共用的展示格式化（零 import，client 半自包含）。
 *
 * 抽出来是因为编排页与画布都要显示「更新于 …」：复制两份必然漂移，
 * 而让画布去 import 编排页会形成循环（编排页已经 import 画布）。
 *
 * @module dsh-dataforge/client/format
 */

/** ISO 时间 → `MM-DD HH:mm`（本地时区）；非法/缺失给 `—`。 */
export function formatTime(iso: string | undefined): string {
  if (iso === undefined) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
