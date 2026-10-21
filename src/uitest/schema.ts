/**
 * UI 测试脚本（ui-script）的契约：YAML 形状 + 类型 + 解析/校验入口。
 *
 * 定位：这是**浏览器回放**的资产，不是接口链（interface-chain）的变体。
 *   - 链走纯 HTTP，断言的是响应字段；
 *   - ui-script 走真浏览器，断言的是页面状态（元素/文本/URL），步骤就是"人怎么点"。
 * 两者共享的只有项目资产目录与运行留痕习惯，执行面互不依赖（见 README 的架构守卫）。
 *
 * 为什么用 YAML + 版本快照：
 *   - 与链/卡同款：`.dsh/dataforge/ui-tests/<site>/<flow>/vN.yaml`，进 git、可手改、可评审；
 *   - 一个版本一个文件，版本不可变（写入永远 max+1），回放记录里存版本号即快照身份。
 *
 * 选择器纪律：
 *   - `selector` 是主选择器；`candidates` 是录制器给的有序候选（优先级从高到低），
 *     回放时取**第一个在该页面唯一命中**的候选——录制期的 DOM 与回放期不完全相同，
 *     单条选择器一旦失效就整步失败，候选链让回放有容错但不猜。
 *   - `{{input}}` 是链级入参槽位引用（与链同款语法），可出现在 url / value / key / files / 断言文本里。
 *
 * @module dsh-dataforge/uitest/schema
 */
import yaml from 'js-yaml'

/** ui-script 文件格式版本；写进每份脚本，未来演进走它。 */
export const UI_SCRIPT_API_VERSION = 'dataforge/v1'
export const UI_SCRIPT_KIND = 'ui-script'

/** 步骤动作词表：录得出来的、回放得回去的。 */
export const UI_STEP_KINDS = [
  'goto', 'click', 'fill', 'press', 'select', 'submit', 'wait', 'upload', 'scroll',
] as const
export type UiStepKind = (typeof UI_STEP_KINDS)[number]

/** 页面断言词表：回放判定只看页面，不看响应（响应断言走接口链）。 */
export const UI_EXPECT_KINDS = ['visible', 'hidden', 'text', 'value', 'url', 'count'] as const
export type UiExpectKind = (typeof UI_EXPECT_KINDS)[number]

/** 入参槽位类型词表（与链的标量词表对齐，数组在 UI 步里没有落点）。 */
export const UI_INPUT_TYPES = ['string', 'number', 'boolean'] as const
export type UiInputType = (typeof UI_INPUT_TYPES)[number]

/** 版本来源：谁写下的这一版（列表展示用，由写入方声明，不猜）。 */
export type UiScriptSource = 'record' | 'agent' | 'canvas'

/**
 * 人工审查状态：AI 代办录制（agentrec）落下的版本缺省是 `pending`——
 * 步骤是 AI 自主操作生成的，人在面板逐步比对原始任务描述确认后才转 `confirmed`。
 * 纯元信息：回放/批量回归不消费它。
 */
export type UiReviewState = 'pending' | 'confirmed'

/** 一条页面断言。`text` 用 equals/contains；`url` 用 equals/contains；`count` 用 equals。 */
export type UiExpect = {
  kind: UiExpectKind
  /** 目标元素；`url` 断言不需要。 */
  selector?: string
  /** 期望值（文本/值/URL/计数按字符串比较；count 也接受 number）。 */
  equals?: string | number
  /** 包含子串（text/url）。 */
  contains?: string
}

/** 回放时"选中目标"的规则：selector 优先，candidates 是录制期给的候选链。 */
export type UiTarget = {
  selector?: string
  candidates?: string[]
}

/**
 * 点击落点：录制时的真实坐标，用于 canvas 图表这类"元素只能定位、点击要靠坐标"的目标。
 *   - fx/fy：元素内相对坐标（0..1，响应式布局下按比例换算）；
 *   - x/y：录制时视口坐标（selector 失效/元素尺寸变化时的兜底）；
 *   - vw/vh：录制时视口尺寸（与 x/y 配合做等比缩放）。
 */
export type UiClickPoint = {
  fx: number
  fy: number
  x: number
  y: number
  vw: number
  vh: number
  /** 录制时目标标签名（CANVAS 时回放优先走坐标）。 */
  tag?: string
  /** 录制时元素 rect（用于判断"特征还在且位置没变"→ 直接用录制坐标）。 */
  bx?: number
  by?: number
  bw?: number
  bh?: number
  /** 被点击控件的名字（aria-label/文本/按钮 value…），用于可读诊断与文本兜底。 */
  name?: string
}

import { normalizeFeatures, type UiTargetFeatures } from './features.js'

/** 一个回放步骤。字段按 kind 取用，校验器负责"该有的必须有、不该有的不猜"。 */
export type UiStep = UiTarget & {
  id: string
  kind: UiStepKind
  /** fill/select 的值；upload 不用。可含 `{{input}}`。 */
  value?: string
  /** press 的键（Enter/Escape/Tab/ArrowDown…）。 */
  key?: string
  /** goto 的目标地址；可含 `{{input}}`。 */
  url?: string
  /** wait 的毫秒数（0..60000）。 */
  ms?: number
  /** scroll 步骤：无 selector 时滚动的像素（-10000..10000，正数向下）。 */
  deltaY?: number
  /** upload 的本地文件路径（回放机器上必须存在）；可含 `{{input}}`。 */
  files?: string[]
  /** 动作完成后要校验的页面断言（按顺序执行，任一失败即该步失败）。 */
  expect?: UiExpect[]
  /** 录制期所在页面 URL（诊断用，回放不消费）。 */
  at?: string
  /** 点击落点（仅 click；canvas 图表必需，普通元素作为兜底）。 */
  clickPoint?: UiClickPoint
  /** 录制期收集的元素语义特征（选择器失效时的备用定位）。 */
  features?: UiTargetFeatures
}

/** 脚本级入参槽位：回放时用 inputs 替换 `{{name}}`。 */
export type UiScriptInput = {
  name: string
  type: UiInputType
  required: boolean
  /** 上次运行/录制时的示例值（展示用，不参与替换）。 */
  example?: string
}

export type UiScriptMeta = {
  site: string
  flow: string
  version: number
  created: string
  /** 版本来源。 */
  source?: UiScriptSource
  /** 回放起点；录制时取开始录制那一刻的 page.url()。 */
  startUrl: string
  /** 业务域（与链的 meta.domain 同义，列表分组用）。 */
  domain?: string
  /** 版本说明。 */
  note?: string
  /** AI 代办录制的原始任务描述（审查比对用；人录的版本没有）。 */
  task?: string
  /** 人工审查状态（agentrec 落盘为 pending，面板确认后新版本转 confirmed）。 */
  review?: UiReviewState
  /** 录制/回放视图尺寸（缺省 1280×720；布局敏感断言靠它稳定）。 */
  viewport?: { width: number; height: number }
}

/** 一份 ui-script（= 一个版本快照）。 */
export type UiScriptDoc = {
  apiVersion: string
  kind: typeof UI_SCRIPT_KIND
  meta: UiScriptMeta
  inputs: UiScriptInput[]
  steps: UiStep[]
}

/* ------------------------------------------------------------------ 上限 */

/** 单个脚本最多步骤数（再多就该拆流程，或者干脆写代码）。 */
export const MAX_UI_STEPS = 300
/** 单脚本最多入参槽位。 */
export const MAX_UI_INPUTS = 20
/** selector / 值 / 文件路径的长度上限（防手滑把整段 HTML 塞进来）。 */
const MAX_SELECTOR_CHARS = 2_000
const MAX_VALUE_CHARS = 8_000
const MAX_FILE_CHARS = 1_000
/** 单个步骤最多候选/断言数。 */
const MAX_CANDIDATES = 8
const MAX_EXPECTS = 10
/** upload 单步最多文件数。 */
const MAX_UPLOAD_FILES = 10
/** wait 上限（毫秒）。 */
export const MAX_WAIT_MS = 60_000

/* ------------------------------------------------------------------ 问题词表 */

export type UiIssueCode =
  | 'invalid-script'
  | 'bad-meta'
  | 'bad-start-url'
  | 'bad-metadata'
  | 'no-steps'
  | 'too-many-steps'
  | 'bad-step-id'
  | 'duplicate-step-id'
  | 'bad-step-kind'
  | 'missing-target'
  | 'bad-step-field'
  | 'bad-expect'
  | 'bad-input'
  | 'duplicate-input'
  | 'unreferenced-input'
  | 'unknown-input-ref'

/** 校验问题：target 指到 `steps[i]` / `inputs[i]` / `meta`，reason 是给人看的中文原因。 */
export type UiIssue = { target: string; code: UiIssueCode; reason: string }

export type UiScriptParseResult =
  | { ok: true; doc: UiScriptDoc }
  | { ok: false; issues: UiIssue[] }

/* ------------------------------------------------------------------ 工具 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** 空白裁掉；非字符串或空串 → undefined。 */
function textOf(value: unknown): string | undefined {
  const text = asString(value)
  if (text === undefined) return undefined
  const trimmed = text.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

/** 入参引用语法：`{{name}}`（名字与链的槽位规则一致：字母/数字/下划线，字母开头）。 */
const INPUT_REF_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g

/** 一段文本里引用了哪些入参（去重保序）。 */
export function inputRefsOf(text: string | undefined): string[] {
  if (text === undefined) return []
  const refs: string[] = []
  for (const match of text.matchAll(INPUT_REF_RE)) {
    if (!refs.includes(match[1])) refs.push(match[1])
  }
  return refs
}

/** 用入参值替换 `{{name}}`；未提供的槽位原样保留（由缺参闸在运行前拦）。 */
export function substituteInputs(text: string, inputs: Record<string, string>): string {
  return text.replace(INPUT_REF_RE, (whole, name: string) => {
    const value = inputs[name]
    return value === undefined ? whole : value
  })
}

/** 一个步骤里所有可替换文本（校验引用与运行期替换共用同一入口）。 */
export function substitutableTextsOf(step: UiStep): string[] {
  const texts: string[] = []
  if (step.url !== undefined) texts.push(step.url)
  if (step.value !== undefined) texts.push(step.value)
  if (step.key !== undefined) texts.push(step.key)
  for (const file of step.files ?? []) texts.push(file)
  for (const expect of step.expect ?? []) {
    if (expect.equals !== undefined) texts.push(String(expect.equals))
    if (expect.contains !== undefined) texts.push(expect.contains)
  }
  return texts
}

/** 页面地址合法性：只收 http/https（file: 留给单测，不进项目脚本）。 */
export function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ 解析 */

function issue(target: string, code: UiIssueCode, reason: string): UiIssue {
  return { target, code, reason }
}

function normalizeExpect(raw: unknown, target: string, issues: UiIssue[]): UiExpect | undefined {
  if (!isRecord(raw)) {
    issues.push(issue(target, 'bad-expect', '断言必须是对象（kind + selector/equals/contains）'))
    return undefined
  }
  const kind = asString(raw['kind'])
  if (kind === undefined || !(UI_EXPECT_KINDS as readonly string[]).includes(kind)) {
    issues.push(issue(target, 'bad-expect', `断言 kind 非法：${String(raw['kind'])}（可选 ${UI_EXPECT_KINDS.join('/')}）`))
    return undefined
  }
  const expectKind = kind as UiExpectKind
  const selector = textOf(raw['selector'])
  if (expectKind !== 'url' && selector === undefined) {
    issues.push(issue(target, 'bad-expect', `${expectKind} 断言缺 selector`))
    return undefined
  }
  if (selector !== undefined && selector.length > MAX_SELECTOR_CHARS) {
    issues.push(issue(target, 'bad-expect', `断言 selector 超过 ${MAX_SELECTOR_CHARS} 字符`))
    return undefined
  }
  const equalsRaw = raw['equals']
  const equals = typeof equalsRaw === 'number' ? equalsRaw : textOf(equalsRaw)
  const contains = textOf(raw['contains'])

  if (expectKind === 'visible' || expectKind === 'hidden') {
    // 存在性断言只看 selector；给 equals/contains 是配置错误（写的人以为会比对什么）。
    if (equals !== undefined || contains !== undefined) {
      issues.push(issue(target, 'bad-expect', `${expectKind} 断言不接受 equals/contains（只判元素是否可见）`))
      return undefined
    }
    return { kind: expectKind, selector: selector as string }
  }

  if (equals === undefined && contains === undefined) {
    issues.push(issue(target, 'bad-expect', `${expectKind} 断言必须给 equals 或 contains`))
    return undefined
  }
  if (equals !== undefined && typeof equals === 'number' && expectKind !== 'count') {
    issues.push(issue(target, 'bad-expect', '只有 count 断言允许数字 equals（其他按字符串比较）'))
    return undefined
  }
  if (equals === undefined && expectKind === 'count') {
    issues.push(issue(target, 'bad-expect', 'count 断言必须给 equals（数字）'))
    return undefined
  }
  return {
    kind: expectKind,
    ...(selector === undefined ? {} : { selector }),
    ...(equals === undefined ? {} : { equals }),
    ...(contains === undefined ? {} : { contains }),
  }
}

function normalizeStep(raw: unknown, index: number, issues: UiIssue[]): UiStep | undefined {
  const target = `steps[${index}]`
  if (!isRecord(raw)) {
    issues.push(issue(target, 'bad-step-field', '步骤必须是对象'))
    return undefined
  }
  const id = textOf(raw['id'])
  if (id === undefined) {
    issues.push(issue(target, 'bad-step-id', '步骤缺 id'))
    return undefined
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    issues.push(issue(target, 'bad-step-id', `步骤 id 只能用字母/数字/下划线/连字符：${id}`))
    return undefined
  }
  const kindRaw = asString(raw['kind'])
  if (kindRaw === undefined || !(UI_STEP_KINDS as readonly string[]).includes(kindRaw)) {
    issues.push(issue(target, 'bad-step-kind', `步骤 kind 非法：${String(raw['kind'])}（可选 ${UI_STEP_KINDS.join('/')}）`))
    return undefined
  }
  const kind = kindRaw as UiStepKind

  // 选择器候选：selector 与 candidates 至少一个；candidates 去空去重。
  const selector = textOf(raw['selector'])
  const candidatesRaw = Array.isArray(raw['candidates']) ? raw['candidates'] : []
  const candidates: string[] = []
  for (const item of candidatesRaw) {
    const candidate = textOf(item)
    if (candidate === undefined || candidates.includes(candidate)) continue
    if (candidate.length > MAX_SELECTOR_CHARS) {
      issues.push(issue(target, 'bad-step-field', `candidate 超过 ${MAX_SELECTOR_CHARS} 字符`))
      return undefined
    }
    candidates.push(candidate)
  }
  if (selector !== undefined && selector.length > MAX_SELECTOR_CHARS) {
    issues.push(issue(target, 'bad-step-field', `selector 超过 ${MAX_SELECTOR_CHARS} 字符`))
    return undefined
  }
  if (candidates.length > MAX_CANDIDATES) {
    issues.push(issue(target, 'bad-step-field', `candidates 最多 ${MAX_CANDIDATES} 条`))
    return undefined
  }
  const hasTarget = selector !== undefined || candidates.length > 0
  const needsTarget = kind === 'click' || kind === 'fill' || kind === 'press' || kind === 'select' || kind === 'submit' || kind === 'upload'
  if (needsTarget && !hasTarget && kind !== 'press') {
    issues.push(issue(target, 'missing-target', `${kind} 步骤缺 selector/candidates`))
    return undefined
  }

  const value = asString(raw['value'])
  const url = textOf(raw['url'])
  const key = textOf(raw['key'])
  const msRaw = raw['ms']
  const step: UiStep = { id, kind }

  if (selector !== undefined) step.selector = selector
  if (candidates.length > 0) step.candidates = candidates

  if (kind === 'click') {
    const point = parseClickPoint(raw['clickPoint'], target, issues)
    if (point !== undefined) step.clickPoint = point
  }
  const features = normalizeFeatures(raw['features'])
  if (features !== undefined) step.features = features

  if (kind === 'goto') {
    if (url === undefined) {
      issues.push(issue(target, 'bad-step-field', 'goto 步骤缺 url'))
      return undefined
    }
    if (!isHttpUrl(substituteInputs(url, {})) && !url.includes('{{')) {
      issues.push(issue(target, 'bad-step-field', `goto url 必须是 http/https：${url}`))
      return undefined
    }
    step.url = url
  }
  if (kind === 'fill') {
    if (value === undefined) {
      issues.push(issue(target, 'bad-step-field', 'fill 步骤缺 value（密码类输入不录制，见录制器说明）'))
      return undefined
    }
    if (value.length > MAX_VALUE_CHARS) {
      issues.push(issue(target, 'bad-step-field', `fill value 超过 ${MAX_VALUE_CHARS} 字符`))
      return undefined
    }
    step.value = value
  }
  if (kind === 'select') {
    if (value === undefined) {
      issues.push(issue(target, 'bad-step-field', 'select 步骤缺 value（选项值）'))
      return undefined
    }
    step.value = value
  }
  if (kind === 'press') {
    if (key === undefined) {
      issues.push(issue(target, 'bad-step-field', 'press 步骤缺 key（如 Enter/Escape/Tab）'))
      return undefined
    }
    step.key = key
  }
  if (kind === 'wait') {
    if (typeof msRaw !== 'number' || !Number.isFinite(msRaw) || msRaw < 0 || msRaw > MAX_WAIT_MS) {
      issues.push(issue(target, 'bad-step-field', `wait 步骤的 ms 必须是 0..${MAX_WAIT_MS} 的数字`))
      return undefined
    }
    step.ms = Math.round(msRaw)
  }
  if (kind === 'scroll') {
    // 两种形态：给 selector = 滚到该元素（滚翻页加载更多）；只给 deltaY = 窗口滚动像素。
    const deltaYRaw = raw['deltaY']
    if (selector === undefined && candidates.length === 0) {
      if (typeof deltaYRaw !== 'number' || !Number.isFinite(deltaYRaw) || Math.round(deltaYRaw) !== deltaYRaw || Math.abs(deltaYRaw) > 10_000) {
        issues.push(issue(target, 'bad-step-field', 'scroll 步骤需要 selector（滚到元素）或 deltaY（窗口滚动像素，-10000..10000 整数）'))
        return undefined
      }
      step.deltaY = Math.round(deltaYRaw)
    } else if (deltaYRaw !== undefined) {
      issues.push(issue(target, 'bad-step-field', 'scroll 步骤的 selector 与 deltaY 二选一'))
      return undefined
    }
  }
  if (kind === 'upload') {
    const filesRaw = Array.isArray(raw['files']) ? raw['files'] : []
    const files: string[] = []
    for (const item of filesRaw) {
      const file = textOf(item)
      if (file === undefined) continue
      if (file.length > MAX_FILE_CHARS) {
        issues.push(issue(target, 'bad-step-field', `upload 文件路径超过 ${MAX_FILE_CHARS} 字符`))
        return undefined
      }
      files.push(file)
    }
    if (files.length === 0) {
      issues.push(issue(target, 'bad-step-field', 'upload 步骤缺 files（本地路径数组）'))
      return undefined
    }
    if (files.length > MAX_UPLOAD_FILES) {
      issues.push(issue(target, 'bad-step-field', `upload 最多 ${MAX_UPLOAD_FILES} 个文件`))
      return undefined
    }
    step.files = files
  }

  const at = textOf(raw['at'])
  if (at !== undefined) step.at = at

  const expectRaw = raw['expect']
  if (expectRaw !== undefined) {
    if (!Array.isArray(expectRaw)) {
      issues.push(issue(target, 'bad-expect', 'expect 必须是数组'))
      return undefined
    }
    if (expectRaw.length > MAX_EXPECTS) {
      issues.push(issue(target, 'bad-expect', `单步断言最多 ${MAX_EXPECTS} 条`))
      return undefined
    }
    const expects: UiExpect[] = []
    for (const [i, item] of expectRaw.entries()) {
      const normalized = normalizeExpect(item, `${target}.expect[${i}]`, issues)
      if (normalized === undefined) return undefined
      expects.push(normalized)
    }
    if (expects.length > 0) step.expect = expects
  }

  return step
}

function normalizeMeta(raw: unknown, issues: UiIssue[]): UiScriptMeta | undefined {
  if (!isRecord(raw)) {
    issues.push(issue('meta', 'bad-meta', '缺 meta（site/flow/version/created/startUrl）'))
    return undefined
  }
  const site = textOf(raw['site'])
  const flow = textOf(raw['flow'])
  const versionRaw = raw['version']
  if (site === undefined) issues.push(issue('meta', 'bad-meta', 'meta.site 不能为空'))
  if (flow === undefined) issues.push(issue('meta', 'bad-meta', 'meta.flow 不能为空'))
  if (typeof versionRaw !== 'number' || !Number.isInteger(versionRaw) || versionRaw < 1) {
    issues.push(issue('meta', 'bad-meta', 'meta.version 必须是 ≥1 的整数'))
  }
  const startUrl = textOf(raw['startUrl'])
  if (startUrl === undefined) {
    issues.push(issue('meta', 'bad-start-url', 'meta.startUrl 不能为空（回放要一个起点）'))
  } else if (!isHttpUrl(startUrl)) {
    issues.push(issue('meta', 'bad-start-url', `meta.startUrl 必须是 http/https：${startUrl}`))
  }
  if (issues.length > 0) return undefined

  const created = raw['created'] instanceof Date
    ? (raw['created'] as Date).toISOString()
    : textOf(raw['created'])
  const sourceRaw = asString(raw['source'])
  const source = sourceRaw === 'record' || sourceRaw === 'agent' || sourceRaw === 'canvas' ? sourceRaw : undefined
  const viewportRaw = raw['viewport']
  let viewport: { width: number; height: number } | undefined
  if (isRecord(viewportRaw)) {
    const width = viewportRaw['width']
    const height = viewportRaw['height']
    if (typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0) {
      viewport = { width: Math.round(width), height: Math.round(height) }
    }
  }
  return {
    site: site as string,
    flow: flow as string,
    version: versionRaw as number,
    created: created ?? new Date().toISOString(),
    startUrl: startUrl as string,
    ...(source === undefined ? {} : { source }),
    ...(textOf(raw['domain']) === undefined ? {} : { domain: textOf(raw['domain']) as string }),
    ...(textOf(raw['note']) === undefined ? {} : { note: textOf(raw['note']) as string }),
    ...(textOf(raw['task']) === undefined ? {} : { task: (textOf(raw['task']) as string).slice(0, 4_000) }),
    ...(raw['review'] === 'pending' || raw['review'] === 'confirmed' ? { review: raw['review'] } : {}),
    ...(viewport === undefined ? {} : { viewport }),
  }
}

function normalizeInputs(raw: unknown, issues: UiIssue[]): UiScriptInput[] | undefined {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    issues.push(issue('inputs', 'bad-input', 'inputs 必须是数组'))
    return undefined
  }
  if (raw.length > MAX_UI_INPUTS) {
    issues.push(issue('inputs', 'bad-input', `入参槽位最多 ${MAX_UI_INPUTS} 个`))
    return undefined
  }
  const inputs: UiScriptInput[] = []
  for (const [i, item] of raw.entries()) {
    const target = `inputs[${i}]`
    if (!isRecord(item)) {
      issues.push(issue(target, 'bad-input', '入参槽位必须是对象（name/type/required）'))
      return undefined
    }
    const name = textOf(item['name'])
    if (name === undefined || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      issues.push(issue(target, 'bad-input', `入参名非法：${String(item['name'])}`))
      return undefined
    }
    if (inputs.some((input) => input.name === name)) {
      issues.push(issue(target, 'duplicate-input', `入参名重复：${name}`))
      return undefined
    }
    const typeRaw = asString(item['type'])
    if (typeRaw === undefined || !(UI_INPUT_TYPES as readonly string[]).includes(typeRaw)) {
      issues.push(issue(target, 'bad-input', `入参类型非法：${String(item['type'])}（可选 ${UI_INPUT_TYPES.join('/')}）`))
      return undefined
    }
    const required = item['required'] === undefined ? false : item['required']
    if (typeof required !== 'boolean') {
      issues.push(issue(target, 'bad-input', 'required 必须是布尔'))
      return undefined
    }
    const example = textOf(item['example'])
    inputs.push({
      name,
      type: typeRaw as UiInputType,
      required,
      ...(example === undefined ? {} : { example }),
    })
  }
  return inputs
}

/** 解析点击落点：非法值忽略（不让旧脚本因坐标脏值整份失败）。 */
function parseClickPoint(raw: unknown, target: string, issues: UiIssue[]): UiClickPoint | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const value = raw as Record<string, unknown>
  const num = (key: string): number | undefined => {
    const item = value[key]
    return typeof item === 'number' && Number.isFinite(item) ? item : undefined
  }
  const fx = num('fx')
  const fy = num('fy')
  const x = num('x')
  const y = num('y')
  const vw = num('vw')
  const vh = num('vh')
  if (fx === undefined || fy === undefined || x === undefined || y === undefined) {
    issues.push(issue(target, 'bad-step-field', 'clickPoint 需要数字 fx/fy/x/y'))
    return undefined
  }
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1 || (vw !== undefined && vw <= 0) || (vh !== undefined && vh <= 0)) {
    issues.push(issue(target, 'bad-step-field', 'clickPoint 的 fx/fy 必须在 0..1、vw/vh 必须为正'))
    return undefined
  }
  const tag = textOf(value['tag'])
  const box = ['bx', 'by', 'bw', 'bh'].map((key) => num(key))
  const hasBox = box.every((item) => item !== undefined)
  const name = textOf(value['name'])
  return {
    fx, fy, x, y,
    vw: vw ?? 0,
    vh: vh ?? 0,
    ...(tag === undefined ? {} : { tag }),
    ...(hasBox ? { bx: box[0] as number, by: box[1] as number, bw: box[2] as number, bh: box[3] as number } : {}),
    ...(name === undefined ? {} : { name: name.slice(0, 120) }),
  }
}

/**
 * 已解析的 YAML 值 → UiScriptDoc。
 *
 * 只做形状与"该有的字段必须有"，语义（入参引用是否都声明了、是否有人用）在同一遍
 * 校验里做完——ui-script 没有卡引用那种跨文件语义，不需要像链那样拆两段。
 */
export function parseUiScriptDoc(raw: unknown): UiScriptParseResult {
  if (!isRecord(raw)) {
    return { ok: false, issues: [issue('script', 'invalid-script', '脚本必须是一个 YAML 映射（key: value）')] }
  }
  const issues: UiIssue[] = []
  const apiVersion = asString(raw['apiVersion'])
  if (apiVersion !== UI_SCRIPT_API_VERSION) {
    issues.push(issue('script', 'invalid-script', `apiVersion 必须是 ${UI_SCRIPT_API_VERSION}（收到 ${String(raw['apiVersion'])}）`))
  }
  if (raw['kind'] !== UI_SCRIPT_KIND) {
    issues.push(issue('script', 'invalid-script', `kind 必须是 ${UI_SCRIPT_KIND}（收到 ${String(raw['kind'])}）`))
  }
  const meta = normalizeMeta(raw['meta'], issues)
  const inputs = normalizeInputs(raw['inputs'], issues)
  const stepsRaw = raw['steps']
  const steps: UiStep[] = []
  if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) {
    issues.push(issue('steps', 'no-steps', '脚本至少要有 1 个步骤'))
  } else if (stepsRaw.length > MAX_UI_STEPS) {
    issues.push(issue('steps', 'too-many-steps', `步骤最多 ${MAX_UI_STEPS} 个`))
  } else {
    const ids = new Set<string>()
    for (const [i, item] of stepsRaw.entries()) {
      const step = normalizeStep(item, i, issues)
      if (step === undefined) continue
      if (ids.has(step.id)) {
        issues.push(issue(`steps[${i}]`, 'duplicate-step-id', `步骤 id 重复：${step.id}`))
        continue
      }
      ids.add(step.id)
      steps.push(step)
    }
  }
  if (issues.length > 0 || meta === undefined || inputs === undefined) {
    return { ok: false, issues }
  }

  // 入参引用的双向校验：引用了没声明的槽位 / 声明了没人用的槽位，都是配置错误。
  const used = new Set<string>()
  const unknownRefs = new Set<string>()
  const declared = new Set(inputs.map((input) => input.name))
  for (const step of steps) {
    for (const text of substitutableTextsOf(step)) {
      for (const ref of inputRefsOf(text)) {
        used.add(ref)
        if (!declared.has(ref)) unknownRefs.add(ref)
      }
    }
  }
  for (const ref of unknownRefs) {
    issues.push(issue('steps', 'unknown-input-ref', `步骤里引用了未声明的入参槽位 {{${ref}}}`))
  }
  for (const input of inputs) {
    if (!used.has(input.name)) {
      issues.push(issue('inputs', 'unreferenced-input', `入参槽位 ${input.name} 没有被任何步骤引用（\\{\\{${input.name}\\}\\}）`))
    }
  }
  if (issues.length > 0) return { ok: false, issues }

  return { ok: true, doc: { apiVersion: UI_SCRIPT_API_VERSION, kind: UI_SCRIPT_KIND, meta, inputs, steps } }
}

/** YAML 文本 → UiScriptDoc；YAML 语法错也算 invalid-script。 */
export function parseUiScriptYaml(text: string): UiScriptParseResult {
  let raw: unknown
  try {
    raw = loadYamlValue(text)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, issues: [issue('script', 'invalid-script', `YAML 解析失败：${message}`)] }
  }
  return parseUiScriptDoc(raw)
}

/**
 * YAML 文本 → JS 值（CORE schema：时间戳保持字符串，与链/卡同款，避免 YAML 1.1 把
 * `created` 变 Date 再被 schema 判成非字符串）。
 */
export function loadYamlValue(text: string): unknown {
  return yaml.load(text, { schema: yaml.CORE_SCHEMA })
}

/** UiScriptDoc → YAML 文本。 */
export function uiScriptToYaml(doc: UiScriptDoc): string {
  return yaml.dump(doc, { lineWidth: 120, noRefs: true, sortKeys: false })
}

/** 缺参闸：回放前检查 required 槽位是否给了值；返回缺的槽位名（类型按 string 传入）。 */
export function missingInputsOf(doc: UiScriptDoc, provided: Record<string, string>): string[] {
  return doc.inputs
    .filter((input) => input.required)
    .filter((input) => (provided[input.name] ?? '').length === 0)
    .map((input) => input.name)
}

/** 统一格式化成一行可读问题（工具回执/面板展示共用）。 */
export function formatUiIssues(issues: UiIssue[]): string {
  return issues.map((item) => `${item.target}：${item.reason}`).join('；')
}
