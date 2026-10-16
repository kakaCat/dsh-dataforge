/**
 * URL/JSON 归一化与模板合成：纯函数、零 I/O。
 *
 * 归并规则（与测试对齐的两层命令）：
 *   - urlTemplate：路径数字/长随机段抽 {p}；query 去重、滤易变键、排序、保值 —— 留全值是为了回放；
 *   - mergeKey：method + 路径 + ':' + query 键集合 —— 值不入键，跨页同键归并。
 *
 * @module dsh-dataforge/capture/normalizer
 */
import type { RawJson } from '../shared/types.js'
import type { FieldRole, Template, TemplateField } from '../shared/capture-types.js'

/** 每次必变不参与归并与模板比对的 query 键。 */
const VOLATILE = new Set(['sid', 'ts', 't', 'token', 'nonce', 'cb', 'callback', 'rsv_t', 'rsv_pq'])

const SEGMENT_PARAM = /\/(?:\d+|[a-f0-9][a-f0-9-]{19,})(?=\/|$)/gi

export function normalizeUrlForTemplate(rawUrl: string): { urlTemplate: string } {
  const u = new URL(rawUrl, 'http://capture.local')
  const seen = new Map<string, string>()
  for (const [k, v] of u.searchParams.entries()) {
    if (VOLATILE.has(k)) continue
    if (!seen.has(k)) seen.set(k, v)
  }
  const path = u.pathname.replace(SEGMENT_PARAM, '/{p}')
  const pairs = [...seen.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const query = sortedParamsToString(pairs)
  return { urlTemplate: query === '' ? path : `${path}:${query}` }
}

function sortedParamsToString(pairs: Array<[string, string]>): string {
  return pairs.map(([k, v]) => (v === '' ? k : `${k}=${v}`)).join('&')
}

/** 归并键：值不入键（键集合排序），同接口跨参数值变化可归并。 */
export function mergeKeyOf(method: string, urlTemplate: string): string {
  const colon = urlTemplate.lastIndexOf(':')
  if (colon === -1) return `${method} ${urlTemplate}`
  const path = urlTemplate.slice(0, colon)
  const queryPart = urlTemplate.slice(colon + 1)
  const keys = queryPart.split('&').map((kv) => kv.split('=')[0]).sort()
  return `${method} ${path}:${keys.join(',')}`
}

const LINK_RE = /href\s*=\s*["']([^"'#]+)["']/gi

/** 提取页面同域绝对链接（去重；javascript:/非法剔除）。 */
export function extractLinks(html: string, baseUrl: string, ownHost: string): string[] {
  return extractAllLinks(html, baseUrl).filter((u) => captureHost(u) === ownHost)
}

/** 同上但不做 host 过滤——crawler 调用方自持 host 过滤并统计被跳过的外域。 */
export function extractAllLinks(html: string, baseUrl: string): string[] {
  const out = new Set<string>()
  let match: RegExpExecArray | null
  while ((match = LINK_RE.exec(html)) !== null) {
    try {
      const u = new URL(match[1], baseUrl)
      if (u.protocol.startsWith('http')) out.add(u.href)
    } catch {
      // 非法链接跳过
    }
  }
  return [...out]
}

/** 站点归并域：host（协议差异不出域，https/http 视为同站点）。 */
export function captureHost(url: string): string {
  return new URL(url).host
}

const MAX_TEMPLATE_DEPTH = 2
const SAMPLE_MAX = 120

export function jsonToTemplate(body: RawJson): Template {
  const fields: TemplateField[] = []
  const walk = (obj: RawJson, prefix: string, depth: number): void => {
    for (const [key, value] of Object.entries(obj)) {
      const field = prefix === '' ? key : `${prefix}.${key}`
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        if (depth < MAX_TEMPLATE_DEPTH) walk(value as RawJson, field, depth + 1)
        continue
      }
      if (Array.isArray(value)) {
        const first = value[0]
        if (depth < MAX_TEMPLATE_DEPTH && first !== null && typeof first === 'object' && !Array.isArray(first)) {
          walk(first as RawJson, `${field}[]`, depth + 1)
        }
        continue
      }
      fields.push({
        field,
        type: value === null ? 'null' : typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string',
        sample: value === null ? 'null' : String(value).slice(0, SAMPLE_MAX),
        role: 'constant',
        unverified: true,
      })
    }
  }
  walk(body, '', 0)
  const hasCode = fields.find((f) => f.field === 'code')
  const hasErrNo = fields.find((f) => f.field === 'err_no')
  const codePath = hasCode !== undefined ? 'code' : hasErrNo !== undefined ? 'err_no' : undefined
  return { fields, ...(codePath === undefined ? {} : { codePath }) }
}

/**
 * role diff：n≥2 样本里同字段值变 → input（unverified=false）；
 * 值恒 → constant；n==1 整体保持 unverified（诚实标注"未验证"）。
 */
export function assignRoles(samples: RawJson[]): Template {
  const base = jsonToTemplate(samples[0] ?? {})
  if (samples.length <= 1) return base
  const fields = base.fields.map((f0) => {
    const bag = new Set<string>()
    for (const s of samples) {
      const v = pathAt(s, f0.field)
      bag.add(v === undefined ? '<undef>' : String(v))
    }
    const role: FieldRole = bag.size > 1 ? 'input' : f0.role
    return { ...f0, role, unverified: bag.size <= 1 }
  })
  return { fields, ...(base.codePath === undefined ? {} : { codePath: base.codePath }) }
}

function pathAt(obj: RawJson, path: string): unknown {
  let current: unknown = obj
  for (const seg of path.replace(/\[\]$/, '').split('.')) {
    if (current !== null && typeof current === 'object') {
      current = (current as RawJson)[seg]
    } else {
      return undefined
    }
  }
  return current
}
