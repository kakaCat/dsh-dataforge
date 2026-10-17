/**
 * 面板身份与常量。PANEL_ID 是「侧栏条目」与「主列占用者」的同源键（MainPanelId 契约），
 * 改动会同时出现在两端 —— 只许在这里改。侧栏收敛为插件**单入口**（未来新增视图一律走
 * 面板内标签页，不再加侧栏条目）；TAB 常量只在本插件内部使用。
 *
 * @module dsh-dataforge/client/dom
 */
import type { TemplateField } from './types.js'

/** 插件在 DSH 侧栏的唯一入口 id（= main 插槽 key）。 */
export const PANEL_ID = 'dataforge'
export const PANEL_LABEL = '数据采集'
export const PANEL_ORDER = 120

/** 面板内标签页身份（tab key / aria 用，不进 DSH 侧栏）。 */
export const RUNS_TAB_ID = 'dataforge-capture'
export const RUNS_TAB_LABEL = '采集运行'
export const CAPTURE_TAB_ID = 'dataforge-new-capture'
export const CAPTURE_TAB_LABEL = '快速采集'
export const CARDS_TAB_ID = 'dataforge-interfaces'
export const CARDS_TAB_LABEL = '接口库'
export const SITES_TAB_ID = 'dataforge-sites'
export const SITES_TAB_LABEL = '采集网站'

export const REFRESH_MS = 15_000
/** 采集页的进度轮询（进行中才 2 秒一次；收口即停）。 */
export const CAPTURE_POLL_MS = 2_000
export const CARDS_PAGE_SIZE = 20
/** 采集网站页聚合的卡数上限：超过则如实标注「仅按最近 N 张卡聚合」。 */
export const SITES_MAX_AGGREGATE_CARDS = 5_000
/** 采集网站页聚合的 run 上限（/runs 单请求拉满；超出由服务端截断）。 */
export const SITES_MAX_RUNS = 500
export const SAMPLES_DISPLAY_CAP = 50
export const RELATED_PAGES_DISPLAY_CAP = 10
export const SAMPLE_TEXT_CAP = 300

export const STATUS_LABELS: Record<string, string> = {
  running: '进行中', done: '完成', failed: '失败', cancelled: '已取消',
  ok: 'ok', error: 'error', 'skipped-external': '外部跳过',
}

/** 鉴权标志（A8）→ 展示名。 */
export const AUTH_TYPE_LABELS: Record<string, string> = {
  'token-header': 'Token 请求头',
  'token-param': 'Token 入参',
  'cookie-session': 'Cookie 会话',
  none: '无鉴权',
  unknown: '未识别',
}

/** 入参位置（A8）→ 展示名。 */
export const LOCATION_LABELS: Record<string, string> = {
  path: '路径', query: '查询串', header: '请求头', body: '请求体',
}

/** 语义名 + 位置的入参展示名（A8：location 缺省为旧数据，只显字段名）。 */
export function fieldDisplayLabel(field: TemplateField): string {
  if (field.location === undefined) return field.field
  const locationLabel = LOCATION_LABELS[field.location] ?? field.location
  return `${field.field} · ${locationLabel}`
}

export function methodClass(method: string): string {
  return method === 'GET' || method === 'POST' ? method : 'dsh-df-method-other'
}

export function shortSample(text: string): string {
  return text.length <= SAMPLE_TEXT_CAP ? text : `${text.slice(0, SAMPLE_TEXT_CAP)}…`
}

/** unverified 字段照实标注「样本未验证」——面板不替样本背书。 */
export function fieldRoleLabel(input: TemplateField): string {
  return input.unverified ? `${input.role}（样本未验证）` : input.role
}
