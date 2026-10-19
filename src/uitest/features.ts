/**
 * 录制期收集的元素特征 + 回放备用定位。
 *
 * 为什么单独一层：
 *   - 结构选择器（`div:nth-of-type(2) > ...`）改版必坏；
 *   - testid/id/name/aria/placeholder/role/文本 这些语义特征跨布局、跨引擎更稳；
 *   - 回放先走候选链，全失败时用特征生成备用定位再试一轮。
 *
 * 注意：特征只做"备用"，不改变已有候选链的优先级；旧脚本没有 features 时行为不变。
 *
 * @module dsh-dataforge/uitest/features
 */

/** 一个目标元素的语义特征（全部可选，能取到才录）。 */
export type UiTargetFeatures = {
  tag: string
  id?: string
  testId?: string
  name?: string
  ariaLabel?: string
  placeholder?: string
  role?: string
  type?: string
  text?: string
  title?: string
  alt?: string
  href?: string
  /** 关联 <label> 的文本（输入框用）。 */
  label?: string
  /** 页面内第几个 canvas（图表兜底用，0 起）。 */
  canvasIndex?: number
}

const MAX_FEATURE_TEXT = 80

function clean(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.replace(/\s+/g, ' ').trim()
  return text === '' ? undefined : text.slice(0, MAX_FEATURE_TEXT)
}

/** 收口任意来源的 features（录制载荷 / YAML）；非法字段丢弃。 */
export function normalizeFeatures(raw: unknown): UiTargetFeatures | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const value = raw as Record<string, unknown>
  const tag = clean(value['tag'])
  if (tag === undefined) return undefined
  const out: UiTargetFeatures = { tag: tag.toLowerCase() }
  for (const key of ['id', 'testId', 'name', 'ariaLabel', 'placeholder', 'role', 'type', 'text', 'title', 'alt', 'href', 'label'] as const) {
    const item = clean(value[key])
    if (item !== undefined) out[key] = item
  }
  const index = value['canvasIndex']
  if (typeof index === 'number' && Number.isInteger(index) && index >= 0 && index <= 10_000) out.canvasIndex = index
  return out
}

/** CSS 属性值转义（只处理引号/反斜杠，特征来自真实 DOM，够用）。 */
function quote(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * 由特征生成备用候选（按稳定性排序）。
 * 返回的字符串同时兼容 Playwright 选择器与共享引擎的映射（text= / :has-text）。
 */
export function featureCandidates(features: UiTargetFeatures | undefined): string[] {
  if (features === undefined) return []
  const out: string[] = []
  const add = (selector: string): void => {
    if (selector !== '' && !out.includes(selector) && out.length < 8) out.push(selector)
  }
  const tag = features.tag
  if (features.testId !== undefined) add(`[data-testid="${quote(features.testId)}"]`)
  if (features.id !== undefined) add(`#${features.id.replace(/([^\w-])/g, '\\$1')}`)
  if (features.name !== undefined) add(`${tag}[name="${quote(features.name)}"]`)
  if (features.ariaLabel !== undefined) add(`${tag}[aria-label="${quote(features.ariaLabel)}"]`)
  if (features.placeholder !== undefined) add(`${tag}[placeholder="${quote(features.placeholder)}"]`)
  if (features.title !== undefined) add(`${tag}[title="${quote(features.title)}"]`)
  if (features.alt !== undefined) add(`${tag}[alt="${quote(features.alt)}"]`)
  if (features.href !== undefined) add(`${tag}[href="${quote(features.href)}"]`)
  if (features.role !== undefined && features.text !== undefined) {
    add(`[role="${quote(features.role)}"]:has-text("${quote(features.text)}")`)
  }
  if (features.text !== undefined && /^(BUTTON|A|LABEL|SUMMARY)$/i.test(tag)) {
    add(`${tag}:has-text("${quote(features.text)}")`)
    add(`text="${quote(features.text)}"`)
  }
  if (features.role !== undefined) add(`[role="${quote(features.role)}"]`)
  return out
}
