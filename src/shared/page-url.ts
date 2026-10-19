/**
 * 页面身份归一（采集域「同一个页面」的唯一判定口径，纯函数、零 I/O）。
 *
 * 背景：旁路采集记的是每个请求发生时的 `page.url()`，而 SPA（百度网盘这类 hash 路由）
 * 会在同一个页面上产出多个字面 URL：
 *
 *   https://pan.baidu.com/disk/main#/index?category=all
 *   https://pan.baidu.com/disk/main#/index
 *   https://pan.baidu.com/disk/main?_at_=1792240465584#/index?category=all
 *
 * 三者是同一个页面（同一路由、同一批接口），按字面 URL 分组会把它们拆成三行。
 *
 * 口径：**页面身份 = 协议 + host + 端口 + 路径 + hash 路由段**。
 *
 * - 外层 query 与 hash 内 query **都不参与身份**：它们是页面状态/筛选条件（`_at_` 这类
 *   反缓存戳、`category=all` 这类筛选），同一页面换状态不该换身份；
 * - hash 只有形如 `#/route` / `#!/route` 时才当路由保留（SPA 的页面路由就在 hash 里；
 *   hashbang 归一成 `#/route`）；普通锚点（`#section`）不构成另一个页面，丢弃；
 * - 路径空 → `/`，非根路径去掉结尾 `/`（`/a/` 与 `/a` 是同一页）；host 大小写与默认端口由 URL 归一；
 * - 非 http(s) / 非法 URL 去首尾空白后**原样返回**：采集旁路不允许因为归一化失败丢样本
 *   （与指纹口径一致）；
 * - 百分号编码不做解码/重编码（`/%7Eu` 与 `/~u`、`%2f` 与 `%2F` 视为不同）：这些差异在
 *   真实站点上可能是业务语义，宁可不并也不误并；同一字面写法下函数幂等（`f(f(x)) === f(x)`）。
 *
 * 落库口径：`pages.url` / 关系行 `page_url` 存身份串；卡上的页面引用与
 * `request_samples.page_url` 保留真实访问过的原始 URL（展示/打开/重采与逐请求证据），
 * 分组时各消费方再归一一遍。
 *
 * @module dsh-dataforge/shared/page-url
 */

const HTTP_PROTOCOLS = new Set(['http:', 'https:'])

/** 原始页面 URL → 页面身份（可用作 Map key / 落库的 page_url）。 */
export function pageIdentityOf(rawUrl: string): string {
  const raw = rawUrl.trim()
  if (raw === '') return ''
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return raw
  }
  if (!HTTP_PROTOCOLS.has(parsed.protocol)) return raw
  return `${parsed.origin}${normalizePath(parsed.pathname)}${hashRouteOf(parsed.hash)}`
}

/** 路径归一：空路径与只有斜杠都是 `/`；其余去掉结尾斜杠。查询串已在上游丢弃。 */
function normalizePath(pathname: string): string {
  if (pathname === '' || pathname === '/') return '/'
  const stripped = pathname.replace(/\/+$/, '')
  return stripped === '' ? '/' : stripped
}

/**
 * hash → 路由段（含 `#`，不含 query）。
 *
 * 只认 `#/…` 与 `#!/…`：普通锚点（`#top`）不是页面，返回空串；
 * 根路由（`#/`）等同于无 hash，也返回空串。
 */
function hashRouteOf(hash: string): string {
  if (!hash.startsWith('#')) return ''
  let rest = hash.slice(1)
  if (rest.startsWith('!')) rest = rest.slice(1)
  if (!rest.startsWith('/')) return ''
  const queryAt = rest.indexOf('?')
  if (queryAt !== -1) rest = rest.slice(0, queryAt)
  const route = rest.length > 1 ? rest.replace(/\/+$/, '') : rest
  return route === '' || route === '/' ? '' : `#${route}`
}
