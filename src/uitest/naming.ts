/**
 * 录制落盘时的自动命名（站点名 / 流程名留空时）。
 *
 * 规则（可预测、可手改）：
 *   - 站点名：优先页面 `og:site_name` / `application-name`；否则取 hostname（去 `www.`、去端口）。
 *   - 流程名：优先页面标题，去掉站点名/站名后缀与常见分隔符（` - `、`|`、`·`、`_`）；
 *     标题为空时取 URL 最后一个有意义的路径段；再不行用 `录制-MMDD-HHmm`。
 *
 * 生成的名字会写进脚本 `meta.site` / `meta.flow`（目录 slug 由 store 处理），
 * 面板/agent 回执会明确说“已自动命名”，用户之后可改 YAML 或另存。
 *
 * @module dsh-dataforge/uitest/naming
 */

/** 页面元信息：sourceUrl 是真实 URL；title/siteName 可能缺省。 */
export type UiPageMeta = {
  url?: string
  title?: string
  siteName?: string
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

/** hostname（去 www.、去端口、去末尾点）。非法 URL 返回空串。 */
export function hostOfUrl(url: string | undefined): string {
  if (url === undefined || url === '') return ''
  try {
    const parsed = new URL(url)
    return parsed.hostname.replace(/^www\./i, '').replace(/\.$/, '')
  } catch {
    return ''
  }
}

/** 站点名：og:site_name 优先，其次 hostname。 */
export function suggestSiteName(meta: UiPageMeta): string {
  const siteName = cleanText(meta.siteName)
  if (siteName !== '') return siteName.slice(0, 80)
  const host = hostOfUrl(meta.url)
  return host.slice(0, 80)
}

const TITLE_SEPARATORS = /\s*[-–—|·•/]\s*/g

/** 去掉标题里重复的站点名与首尾分隔符。 */
function stripSiteFromTitle(title: string, siteName: string): string {
  let text = title
  if (siteName !== '') {
    text = text.replace(new RegExp(siteName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ')
  }
  text = text.split(TITLE_SEPARATORS).map((part) => part.trim()).filter((part) => part !== '').join(' - ')
  return text.replace(/^[\s\-–—|·•/]+|[\s\-–—|·•/]+$/g, '').trim()
}

/** URL 最后一个有意义路径段（跳过纯数字/扩展名/id 形式的段）。 */
function lastPathSegment(url: string | undefined): string {
  if (url === undefined || url === '') return ''
  try {
    const segments = new URL(url).pathname.split('/').map((part) => decodeURIComponent(part).trim()).filter((part) => part !== '')
    for (let i = segments.length - 1; i >= 0; i -= 1) {
      const segment = segments[i] as string
      if (/^\d+$/.test(segment) || /^[0-9a-f-]{16,}$/i.test(segment)) continue
      return segment.replace(/\.[a-z0-9]{1,6}$/i, '')
    }
    return ''
  } catch {
    return ''
  }
}

/** 流程名：页面标题 → 路径段 → `录制-MMDD-HHmm` 兜底。 */
export function suggestFlowName(meta: UiPageMeta, now: Date = new Date()): string {
  const siteName = cleanText(meta.siteName)
  const fromTitle = stripSiteFromTitle(cleanText(meta.title), siteName !== '' ? siteName : hostOfUrl(meta.url))
  const candidate = fromTitle !== '' ? fromTitle : lastPathSegment(meta.url)
  const cleaned = candidate.replace(/\s+/g, ' ').trim().slice(0, 60)
  if (cleaned !== '') return cleaned
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `录制-${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
}

/** 一次生成站点/流程（只在调用方没有显式给名字时用）。 */
export function autoNameFor(meta: UiPageMeta, now: Date = new Date()): { site: string; flow: string } {
  return { site: suggestSiteName(meta), flow: suggestFlowName(meta, now) }
}
