/**
 * 运行时 lookup：业务值从接口（或后续页面）获取，带缓存与来源。
 *
 * 解决的是“生态链 → stockOrg/purchaseOrg”这类映射不能写死的问题：
 *   - YAML 只声明**怎么查**（源、路径、匹配字段、映射字段），不存业务值；
 *   - 运行时 fetch 接口 → 缓存 items → 按 query 匹配 → 返回值 + source/fetchedAt；
 *   - 代码里不出现任何业务名称/编码。
 *
 * 本期只实现 `source.kind: api`（GET/HEAD）；page 来源明确返回 unavailable，
 * 不伪造页面读取成功（后续 S5 可接 UiBrowserEngine / 无头页面读取）。
 *
 * @module dsh-dataforge/lookup/lookup
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import yaml from 'js-yaml'

type FetchLike = typeof fetch

export type LookupApiSource = {
  kind: 'api'
  /** 目标源；path 为绝对 URL 时可省略。支持 ${ENV}。 */
  baseUrl?: string
  path: string
  method?: 'GET' | 'HEAD'
  /** 查询参数模板；值里的 {{query}} 会替换成用户输入。 */
  query?: Record<string, string>
  /** 固定头；值支持 ${ENV}，不把凭证写进 YAML 明文。 */
  headers?: Record<string, string>
  /** items 的 JSON 路径（如 $.data）；缺省 $. */
  items?: string
  /** 与 query 比较的字段路径（任一命中即可）。 */
  match: string[]
  /** 候选值映射：字段名 → item 内的 JSON 路径。 */
  map: Record<string, string>
}

export type LookupPageSource = {
  kind: 'page'
  url: string
  /** CSS selector：每个匹配元素是一行候选（如 select option / table tbody tr）。 */
  items: string
  /** 标签取值：text 或 attr:<name>。 */
  label: string
  /** 候选值映射：字段名 → text / attr:<name>。 */
  map: Record<string, string>
}

export type LookupConfig = {
  kind: 'data-lookup'
  name: string
  site?: string
  source: LookupApiSource | LookupPageSource
  cache?: { ttlSeconds?: number }
}

export type LookupValue = Record<string, string | number | boolean>

export type LookupCandidate = {
  label: string
  values: LookupValue
}

export type LookupToolValue =
  | {
      ok: true
      name: string
      site: string
      query: string
      cache: 'hit' | 'miss'
      fetchedAt: string
      source: { kind: 'api' | 'page'; description: string }
      candidates: LookupCandidate[]
      warnings: string[]
    }
  | {
      ok: false
      code:
        | 'lookup-not-found' | 'lookup-invalid' | 'lookup-http-error' | 'lookup-items-not-array'
        | 'lookup-unusable' | 'page-lookup-unavailable' | 'no-workspace'
      error: string
      hints?: string[]
    }

export type LookupDeps = {
  dataRoot: string
  resolveWorkspaceRoot: (exec: unknown) => Promise<string | undefined>
  /** 测试注入；缺省用全局 fetch。 */
  fetch?: FetchLike
  /** 页面来源读取（Playwright 或测试假实现）；缺省时 page 来源如实 unavailable。 */
  pageReader?: (source: LookupPageSource) => Promise<LookupCandidate[]>
}

type CacheFile = {
  name: string
  site: string
  configHash: string
  fetchedAt: string
  source: { kind: 'api' | 'page'; description: string }
  items: unknown[]
}

function failure(
  code: Extract<LookupToolValue, { ok: false }>['code'],
  error: string,
  hints?: string[],
): LookupToolValue {
  return { ok: false, code, error, ...(hints === undefined ? {} : { hints }) }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function expandEnv(text: string): string {
  return text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
    const value = process.env[name]
    if (value === undefined) throw new Error(`lookup 配置引用的环境变量不存在：${name}`)
    return value
  })
}

/** 极简 JSON 路径：`$.a.b[0].c` / `a.b`；不支持通配，lookup 只需要标量/数组。 */
export function getByPath(value: unknown, path: string): unknown {
  const trimmed = path.trim()
  if (trimmed === '' || trimmed === '$' || trimmed === '.') return value
  const normalized = trimmed.replace(/^\$?\.?/, '')
  const tokens: Array<string | number> = []
  for (const part of normalized.split('.')) {
    const matches = [...part.matchAll(/([^[\]]+)|\[(\d+)\]/g)]
    for (const match of matches) {
      if (match[1] !== undefined && match[1] !== '') tokens.push(match[1])
      else if (match[2] !== undefined) tokens.push(Number(match[2]))
    }
  }
  let current: unknown = value
  for (const token of tokens) {
    if (typeof token === 'number') {
      if (!Array.isArray(current) || token < 0 || token >= current.length) return undefined
      current = current[token]
    } else {
      if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined
      current = (current as Record<string, unknown>)[token]
    }
  }
  return current
}

function parseConfig(raw: unknown, name: string): LookupConfig {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('lookup yaml 必须是映射')
  }
  const doc = raw as Record<string, unknown>
  if (doc['kind'] !== undefined && doc['kind'] !== 'data-lookup') throw new Error(`kind 必须是 data-lookup（收到 ${String(doc['kind'])}）`)
  const source = doc['source']
  if (source === null || typeof source !== 'object' || Array.isArray(source)) throw new Error('source 必须是映射')
  const s = source as Record<string, unknown>
  const kind = s['kind']
  if (kind !== 'api' && kind !== 'page') throw new Error('source.kind 必须是 api 或 page')
  const mapRaw = s['map']
  if (mapRaw === null || typeof mapRaw !== 'object' || Array.isArray(mapRaw)) throw new Error('source.map 必须是字段映射')
  const map: Record<string, string> = {}
  for (const [key, value] of Object.entries(mapRaw as Record<string, unknown>)) {
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`source.map.${key} 必须是 JSON 路径`)
    map[key] = value.trim()
  }
  if (Object.keys(map).length === 0) throw new Error('source.map 不能为空')
  const site = optionalString(doc['site'])
  const cacheRaw = doc['cache']
  const ttl = cacheRaw !== null && typeof cacheRaw === 'object' && !Array.isArray(cacheRaw)
    ? Number((cacheRaw as Record<string, unknown>)['ttlSeconds'])
    : undefined
  const common = {
    kind: 'data-lookup' as const,
    name: optionalString(doc['name']) ?? name,
    ...(site === undefined ? {} : { site }),
    cache: ttl !== undefined && Number.isFinite(ttl) && ttl >= 0 ? { ttlSeconds: Math.floor(ttl) } : { ttlSeconds: 86_400 },
  }
  if (kind === 'api') {
    const matchRaw = s['match']
    const match = Array.isArray(matchRaw)
      ? matchRaw.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
      : typeof matchRaw === 'string' && matchRaw.trim() !== '' ? [matchRaw.trim()] : []
    if (match.length === 0) throw new Error('api lookup 的 source.match 至少给一个字段路径')
    return {
      ...common,
      source: {
        kind: 'api',
        ...(optionalString(s['baseUrl']) === undefined ? {} : { baseUrl: expandEnv(String(s['baseUrl'])) }),
        path: optionalString(s['path']) ?? (() => { throw new Error('api lookup 缺 source.path') })(),
        method: s['method'] === 'HEAD' ? 'HEAD' : 'GET',
        ...(s['query'] !== null && typeof s['query'] === 'object' && !Array.isArray(s['query'])
          ? { query: Object.fromEntries(Object.entries(s['query'] as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) }
          : {}),
        ...(s['headers'] !== null && typeof s['headers'] === 'object' && !Array.isArray(s['headers'])
          ? { headers: Object.fromEntries(Object.entries(s['headers'] as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) }
          : {}),
        ...(optionalString(s['items']) === undefined ? {} : { items: optionalString(s['items']) }),
        match,
        map,
      },
    }
  }
  const items = optionalString(s['items'])
  const label = optionalString(s['label'])
  if (items === undefined) throw new Error('page lookup 缺 source.items（CSS selector）')
  if (label === undefined) throw new Error('page lookup 缺 source.label（text 或 attr:<name>）')
  const mapSpec: Record<string, string> = {}
  for (const [key, value] of Object.entries(map)) {
    if (value !== 'text' && !/^attr:.+/.test(value)) throw new Error(`page lookup 的 map.${key} 必须是 text 或 attr:<name>`)
    mapSpec[key] = value
  }
  return {
    ...common,
    source: {
      kind: 'page',
      url: optionalString(s['url']) ?? (() => { throw new Error('page lookup 缺 source.url') })(),
      items,
      label: label === 'text' || /^attr:.+/.test(label) ? label : (() => { throw new Error('page lookup 的 source.label 必须是 text 或 attr:<name>') })(),
      map: mapSpec,
    },
  }
}

function cachePath(dataRoot: string, site: string, name: string): string {
  const safeSite = site.replace(/[^A-Za-z0-9._-]/g, '_') || 'default'
  const safeName = name.replace(/[^A-Za-z0-9._-]/g, '_') || 'lookup'
  return join(dataRoot, 'lookups', safeSite, `${safeName}.json`)
}

function configHash(config: LookupConfig): string {
  return JSON.stringify(config.source)
}

function readCache(path: string): CacheFile | undefined {
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const file = parsed as CacheFile
    if (!Array.isArray(file.items) || typeof file.fetchedAt !== 'string' || typeof file.configHash !== 'string') return undefined
    return file
  } catch {
    return undefined
  }
}

function writeCache(path: string, file: CacheFile): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(file, null, 2), 'utf8')
  renameSync(tmp, path)
}

function valueOf(item: unknown, path: string): string | number | boolean | undefined {
  const value = getByPath(item, path)
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : undefined
}

function matchItem(item: unknown, match: string[], query: string): string | undefined {
  const wanted = query.trim().toLowerCase()
  for (const path of match) {
    const value = valueOf(item, path)
    if (value === undefined) continue
    const text = String(value).trim()
    if (text.toLowerCase() === wanted || text.toLowerCase().includes(wanted)) return text
  }
  return undefined
}

async function fetchItems(
  config: LookupConfig,
  query: string,
  fetchImpl: FetchLike,
): Promise<{ items: unknown[]; description: string }> {
  if (config.source.kind !== 'api') throw new Error('page source 不能走 fetchItems')
  const source = config.source
  const base = source.baseUrl === undefined ? undefined : expandEnv(source.baseUrl)
  let url: URL
  try {
    url = base === undefined ? new URL(source.path) : new URL(source.path, base.endsWith('/') ? base : `${base}/`)
  } catch {
    throw new Error(`lookup URL 不合法：${source.path}`)
  }
  for (const [key, template] of Object.entries(source.query ?? {})) {
    url.searchParams.set(key, template.replaceAll('{{query}}', query))
  }
  const headers: Record<string, string> = { accept: 'application/json' }
  for (const [key, value] of Object.entries(source.headers ?? {})) headers[key] = expandEnv(value)
  const response = await fetchImpl(url.toString(), {
    method: source.method ?? 'GET',
    headers,
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`lookup 接口返回 HTTP ${response.status}`)
  const json: unknown = await response.json()
  const itemsValue = getByPath(json, source.items ?? '$')
  if (!Array.isArray(itemsValue)) throw new Error('lookup items 路径没有返回数组')
  return {
    items: itemsValue,
    description: `${source.method ?? 'GET'} ${url.pathname}`,
  }
}

async function loadConfig(workspaceRoot: string, dataRoot: string, name: string): Promise<LookupConfig | undefined> {
  const candidates = [
    join(workspaceRoot, '.dsh', 'dataforge', 'lookups', `${name}.yaml`),
    join(workspaceRoot, '.dsh', 'dataforge', 'lookups', `${name}.yml`),
    join(dataRoot, 'lookups', `${name}.yaml`),
  ]
  const path = candidates.find((candidate) => existsSync(candidate))
  if (path === undefined) return undefined
  const raw = yaml.load(readFileSync(path, 'utf8'), { schema: yaml.CORE_SCHEMA })
  return parseConfig(raw, name)
}

/**
 * 运行时 lookup：查缓存 → 过期则 fetch → 按 match 过滤 → map 出候选值。
 *
 * @param deps - dataRoot + 工作区解析 + 可注入 fetch。
 * @param exec - 工具执行上下文（解析工作区）。
 * @param args - name/query/site/refresh。
 */
export async function lookupForTool(
  deps: LookupDeps,
  exec: unknown,
  args: { name: string; query: string; site?: string; refresh?: boolean },
): Promise<LookupToolValue> {
  const name = args.name.trim()
  const query = args.query.trim()
  if (name === '') return failure('lookup-not-found', 'lookup name 不能为空', ['lookup 配置放 <workspace>/.dsh/dataforge/lookups/<name>.yaml'])
  if (query === '') return failure('lookup-unusable', 'lookup query 不能为空', ['给 query 传业务词，例如生态链'])
  const workspaceRoot = await deps.resolveWorkspaceRoot(exec)
  if (workspaceRoot === undefined) return failure('no-workspace', '无法解析工作区根：lookup 配置按工作区落盘')
  let config: LookupConfig | undefined
  try {
    config = await loadConfig(workspaceRoot, deps.dataRoot, name)
  } catch (error) {
    return failure('lookup-invalid', `lookup 配置无效：${(error as Error).message}`)
  }
  if (config === undefined) {
    return failure('lookup-not-found', `没有 lookup 配置：${name}`, ['在 <workspace>/.dsh/dataforge/lookups/ 下新增 YAML；只声明怎么查，不写业务值'])
  }
  const site = (args.site ?? config.site ?? 'default').trim()
  const path = cachePath(deps.dataRoot, site, name)
  const hash = configHash(config)
  const cached = readCache(path)
  const ttl = config.cache?.ttlSeconds ?? 86_400
  const fresh = cached !== undefined && cached.configHash === hash && ttl > 0
    && Date.now() - Date.parse(cached.fetchedAt) < ttl * 1000
  let items: unknown[]
  let fetchedAt: string
  let source: { kind: 'api' | 'page'; description: string }
  let cache: 'hit' | 'miss'
  let warnings: string[] = []
  if (config.source.kind === 'page') {
    if (!args.refresh && fresh && cached !== undefined) {
      items = cached.items
      fetchedAt = cached.fetchedAt
      source = cached.source
      cache = 'hit'
    } else {
      const reader = deps.pageReader
      if (reader === undefined) {
        return failure('page-lookup-unavailable', 'page 来源 lookup 需要页面读取器（Playwright）；当前未装配', ['先用 api 来源；或启用 pageReader'])
      }
      try {
        const read = await reader(config.source)
        items = read
        fetchedAt = new Date().toISOString()
        source = { kind: 'page', description: `PAGE ${new URL(config.source.url).pathname}` }
        cache = 'miss'
        writeCache(path, { name, site, configHash: hash, fetchedAt, source, items })
      } catch (error) {
        if (cached !== undefined && cached.configHash === hash) {
          items = cached.items
          fetchedAt = cached.fetchedAt
          source = cached.source
          cache = 'hit'
          warnings = [`page lookup 读取失败，降级使用缓存：${(error as Error).message}`]
        } else {
          return failure('lookup-http-error', `page lookup 失败：${(error as Error).message}`)
        }
      }
    }
    const candidates = items
      .filter((item): item is LookupCandidate => item !== null && typeof item === 'object' && !Array.isArray(item))
      .filter((item) => item.label !== undefined && item.values !== undefined && String(item.label).toLowerCase().includes(query.toLowerCase()))
    return {
      ok: true,
      name,
      site,
      query,
      cache,
      fetchedAt,
      source,
      candidates,
      warnings,
    }
  }
  if (!args.refresh && fresh && cached !== undefined) {
    items = cached.items
    fetchedAt = cached.fetchedAt
    source = cached.source
    cache = 'hit'
  } else {
    try {
      const fetched = await fetchItems(config, query, deps.fetch ?? globalThis.fetch)
      items = fetched.items
      source = { kind: 'api', description: fetched.description }
      fetchedAt = new Date().toISOString()
      cache = 'miss'
      writeCache(path, { name, site, configHash: hash, fetchedAt, source, items })
    } catch (error) {
      // 过期缓存可降级使用；明确 warning，不假装 freshness。
      if (cached !== undefined && cached.configHash === hash) {
        items = cached.items
        fetchedAt = cached.fetchedAt
        source = cached.source
        cache = 'hit'
        warnings = [`lookup 刷新失败，降级使用缓存：${(error as Error).message}`]
      } else {
        return failure('lookup-http-error', `lookup 查询失败：${(error as Error).message}`, ['检查 source.baseUrl/path/headers；凭证用 ${ENV} 注入，不要写进 YAML'])
      }
    }
  }
  const candidates: LookupCandidate[] = []
  for (const item of items) {
    const label = matchItem(item, config.source.match, query)
    if (label === undefined) continue
    const values: LookupValue = {}
    for (const [key, itemPath] of Object.entries(config.source.map)) {
      const value = valueOf(item, itemPath)
      if (value !== undefined) values[key] = value
    }
    if (Object.keys(values).length === 0) continue
    if (candidates.some((candidate) => candidate.label === label && JSON.stringify(candidate.values) === JSON.stringify(values))) continue
    candidates.push({ label, values })
  }
  return {
    ok: true,
    name,
    site,
    query,
    cache,
    fetchedAt,
    source,
    candidates,
    warnings,
  }
}
