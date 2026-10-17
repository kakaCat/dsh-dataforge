/**
 * 编排面板数据面：`/dashboard/api/dataforge/orchestration/*`
 *
 * 与采集数据面同一个前缀、同一套信封（200 {success:true,data} / 4xx|500 {success:false,error,code}），
 * 由同一份 `PanelRouteRegistrar` 注册；分成两个模块只是因为域不同，不是因为协议不同。
 *
 * 路由面（只读为主，唯一写入口 POST /orchestration/graph = 画布「保存为新版本」）：
 *   GET  /orchestration/overview          网站 + 流程 + 逐版本摘要（编排页一次拿够）
 *   GET  /orchestration/graph?site&flow&version   单个版本的完整链文档（画布渲染用）
 *   POST /orchestration/graph             画布保存：链 YAML → saveChain 落新版本
 *
 * 纪律：
 *   - 链文件是项目资产，读侧**不静默吞坏文件**：坏版本在 versions[] 里带 unreadable 说明；
 *   - 写侧只有 saveChain 一条路（schema + 语义校验全过才落盘），这里不重复实现校验；
 *   - 路径参数一律经 slug 校验（store 层做），不拼接用户输入到文件路径。
 *
 * @module dsh-dataforge/orchestration/panel-routes
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { listChainVersionInfos, listChainVersions, listChains, loadChain, readCard, readChainText, saveChain } from '../chains/store.js'
import type { ChainDoc, ChainIssue, ChainKind, ChainSource } from '../chains/schema.js'

export const ORCHESTRATION_API_PREFIX = '/orchestration'

/** 画布保存请求体上限：链 YAML 可能不小，但也不该是任意大。 */
const MAX_SAVE_BODY_BYTES = 512 * 1024

/** 宿主 webServer 的最小投影（与 capture/panel-routes 同构）。 */
export interface OrchestrationRouteRegistrar {
  register(route: {
    kind: 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void
  }): () => void
}

export interface OrchestrationPanelDeps {
  /** 工作区根：链落在 `<root>/.dsh/dataforge/chains`。每次请求现取（面板可能切工作区）。 */
  resolveWorkspaceRoot: () => Promise<string>
}

/** 卡投影：画布显示用（方法/地址/名称）+ 连线绑定下拉用（字段路径表）。零凭证。 */
export type CardProjection = {
  name?: string
  method: string
  urlTemplate: string
  /** 入参字段路径表（FR-2.3 的「下游入参 ←」候选）。 */
  inputs: Array<{ path: string; type: string; required?: boolean }>
  /** 出参字段路径表（FR-2.3 的「上游出参 →」候选）。 */
  outputs: Array<{ path: string; type: string; required?: boolean }>
}

/** 网站行：编排页一级列表。 */
export type SiteRow = {
  site: string
  pageFlows: number
  apiFlows: number
  flows: number
  /** 该网站下最新的更新时间（ISO）。 */
  updatedAt?: string
  domains: string[]
}

/** 版本行：编排页三级列表。 */
export type VersionRow = {
  version: number
  created?: string
  source?: ChainSource
  nodeCount?: number
  edgeCount?: number
  /** 是否被更新的版本取代（非最新版）。 */
  superseded: boolean
  unreadable?: string
}

/** 流程行：编排页二级列表。 */
export type FlowRow = {
  site: string
  flow: string
  kind?: ChainKind
  domain?: string
  note?: string
  latest?: number
  updatedAt?: string
  nodeCount?: number
  edgeCount?: number
  versions: VersionRow[]
  unreadable?: string
}

export type OverviewValue = {
  sites: SiteRow[]
  flows: FlowRow[]
  /** 数据根（给「链没找到时」的排查提示用；不含凭证）。 */
  chainsRootHint: string
}

export type GraphValue = {
  site: string
  flow: string
  version: number
  kind: ChainKind
  domain?: string
  note?: string
  source?: ChainSource
  created?: string
  chainYaml: string
  /**
   * 画布的**可编辑副本**（完整链文档，JSON）。
   *
   * 为什么整份给：画布保存时要把 inputs / constants / 未知键原样带回去。只给 nodes/edges
   * 会让画布保存或覆盖掉链级入参槽位——那是 R-1 的契约，不是可丢的展示字段。
   * 客户端因此不需要 YAML 解析器（不把 js-yaml 打进 client bundle）。
   */
  doc: ChainDoc
  /**
   * 节点引用的接口卡身份（只 method/url/name 三项，零凭证）。
   *
   * 画布要显示「POST /api/purchase/order/create」这类标签，但那些字段属于**卡**，
   * 不属于链——复制进链文件会立刻产生两处事实源。所以链只存 cardId，显示时按 id 解析。
   */
  cards: Record<string, CardProjection>
  versions: number[]
}

/** 构造编排面板 handler。 */
export function createOrchestrationPanelHandler(
  deps: OrchestrationPanelDeps,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    void handle(deps, req, res)
  }
}

async function handle(deps: OrchestrationPanelDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const method = (req.method ?? 'GET').toUpperCase()
    const url = new URL(req.url ?? '/', 'http://panel.localhost')
    const suffix = stripPrefix(url.pathname)

    if (method === 'POST') {
      if (suffix === '/graph') {
        await handleSave(deps, req, res)
        return
      }
      fail(res, 405, `编排路由不支持 POST ${suffix}（写入口仅 POST /orchestration/graph）`, 'method-not-allowed')
      return
    }
    if (method !== 'GET') {
      fail(res, 405, `编排路由只支持 GET/POST，收到 ${method}`, 'method-not-allowed')
      return
    }

    if (suffix === '/overview') {
      ok(res, await buildOverview(deps, url))
      return
    }

    if (suffix === '/graph') {
      await handleGraph(deps, url, res)
      return
    }

    fail(res, 404, `不认识的路径：${suffix}`, 'unknown-path')
  } catch (error) {
    fail(res, 500, error instanceof Error ? error.message : String(error), 'internal')
  }
}

/** 前缀剥离：宿主可能传含前缀的完整路径，也可能传已剥好的剩余路径。 */
function stripPrefix(pathname: string): string {
  const full = `/dashboard/api/dataforge${ORCHESTRATION_API_PREFIX}`
  if (pathname.startsWith(full)) return pathname.slice(full.length) || '/'
  if (pathname.startsWith(ORCHESTRATION_API_PREFIX)) return pathname.slice(ORCHESTRATION_API_PREFIX.length) || '/'
  return pathname
}

async function buildOverview(deps: OrchestrationPanelDeps, url: URL): Promise<OverviewValue> {
  const workspaceRoot = await deps.resolveWorkspaceRoot()
  const siteFilter = url.searchParams.get('site')
  const chains = listChains(workspaceRoot)

  const flows: FlowRow[] = []
  for (const chain of chains) {
    if (siteFilter !== null && siteFilter.length > 0 && chain.site !== siteFilter) continue
    const infos = listChainVersionInfos(workspaceRoot, chain.site, chain.flow)
    const latest = chain.latest
    flows.push({
      site: chain.site,
      flow: chain.flow,
      ...(chain.kind === undefined ? {} : { kind: chain.kind }),
      ...(chain.domain === undefined ? {} : { domain: chain.domain }),
      ...(chain.note === undefined ? {} : { note: chain.note }),
      ...(latest === undefined ? {} : { latest }),
      ...(chain.updatedAt === undefined ? {} : { updatedAt: chain.updatedAt }),
      ...(chain.nodeCount === undefined ? {} : { nodeCount: chain.nodeCount }),
      ...(chain.edgeCount === undefined ? {} : { edgeCount: chain.edgeCount }),
      ...(chain.unreadable === undefined ? {} : { unreadable: chain.unreadable }),
      versions: infos.map((info) => ({
        version: info.version,
        ...(info.created === undefined ? {} : { created: info.created }),
        ...(info.source === undefined ? {} : { source: info.source }),
        ...(info.nodeCount === undefined ? {} : { nodeCount: info.nodeCount }),
        ...(info.edgeCount === undefined ? {} : { edgeCount: info.edgeCount }),
        superseded: latest !== undefined && info.version < latest,
        ...(info.unreadable === undefined ? {} : { unreadable: info.unreadable }),
      })),
    })
  }

  return { sites: foldSites(flows), flows, chainsRootHint: `${workspaceRoot}/.dsh/dataforge/chains` }
}

/**
 * 流程行 → 网站行。
 *
 * 站点名取链文件里的 meta.site（目录是 slug，可能与原名不同）——这里用目录名做 key、
 * 用任一版本的 meta 原名做展示名；两者不同时以文件为准（与 store 的说明一致）。
 */
function foldSites(flows: FlowRow[]): SiteRow[] {
  const bySite = new Map<string, SiteRow>()
  for (const flow of flows) {
    const row = bySite.get(flow.site) ?? { site: flow.site, pageFlows: 0, apiFlows: 0, flows: 0, domains: [] }
    row.flows += 1
    if (flow.kind === 'page-chain') row.pageFlows += 1
    if (flow.kind === 'interface-chain') row.apiFlows += 1
    if (flow.domain !== undefined && !row.domains.includes(flow.domain)) row.domains.push(flow.domain)
    if (flow.updatedAt !== undefined && (row.updatedAt === undefined || flow.updatedAt > row.updatedAt)) {
      row.updatedAt = flow.updatedAt
    }
    bySite.set(flow.site, row)
  }
  return [...bySite.values()].sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''))
}

async function handleGraph(deps: OrchestrationPanelDeps, url: URL, res: ServerResponse): Promise<void> {
  const site = url.searchParams.get('site') ?? ''
  const flow = url.searchParams.get('flow') ?? ''
  const rawVersion = url.searchParams.get('version')
  const version = rawVersion === null || rawVersion.length === 0 ? undefined : Number.parseInt(rawVersion, 10)

  if (site.length === 0 || flow.length === 0) {
    fail(res, 400, '缺少 site / flow 查询参数（链按「站点 / 流程」归档）', 'missing-param')
    return
  }
  if (version !== undefined && (!Number.isInteger(version) || version < 1)) {
    fail(res, 400, `version 必须是正整数，收到 ${rawVersion}`, 'bad-param')
    return
  }

  const workspaceRoot = await deps.resolveWorkspaceRoot()
  const loaded = loadChain(workspaceRoot, site, flow, version === undefined ? {} : { version })
  if (!loaded.ok) {
    fail(res, loaded.code === 'chain-not-found' ? 404 : 422, loaded.message, loaded.code)
    return
  }

  const text = readChainText(workspaceRoot, site, flow, loaded.version)
  const { meta } = loaded.doc
  const value: GraphValue = {
    site: loaded.doc.meta.site,
    flow: loaded.doc.meta.flow,
    version: loaded.version,
    kind: loaded.doc.kind,
    ...(meta.domain === undefined ? {} : { domain: meta.domain }),
    ...(meta.note === undefined ? {} : { note: meta.note }),
    ...(meta.source === undefined ? {} : { source: meta.source }),
    ...(meta.created === undefined ? {} : { created: meta.created }),
    chainYaml: text?.text ?? '',
    doc: loaded.doc,
    cards: resolveCardIdentities(workspaceRoot, loaded.doc),
    versions: listChainVersions(workspaceRoot, site, flow),
  }
  ok(res, value)
}

/** 节点引用的卡身份投影（读不到的卡不出现在表里，画布降级显示 cardId）。 */
function resolveCardIdentities(workspaceRoot: string, doc: ChainDoc): Record<string, CardProjection> {
  const cards: Record<string, CardProjection> = {}
  for (const node of doc.nodes) {
    if (node.card === undefined || cards[node.card] !== undefined) continue
    const card = readCard(workspaceRoot, node.card)
    if (card === undefined) continue
    cards[node.card] = {
      ...(card.name === undefined ? {} : { name: card.name }),
      method: card.identity.method,
      urlTemplate: card.identity.urlTemplate,
      inputs: card.inputs.map((field) => ({
        path: field.path,
        type: field.type,
        ...(field.required === undefined ? {} : { required: field.required }),
      })),
      outputs: card.outputs.map((field) => ({
        path: field.path,
        type: field.type,
        ...(field.required === undefined ? {} : { required: field.required }),
      })),
    }
  }
  return cards
}

/** 画布保存：只接受链 YAML 文本，交给 saveChain（唯一写入口），来源标 canvas。 */
async function handleSave(deps: OrchestrationPanelDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req)
  if (body === undefined) {
    fail(res, 413, `请求体超过 ${MAX_SAVE_BODY_BYTES} 字节上限`, 'payload-too-large')
    return
  }

  let input: ChainDoc | string
  let source: ChainSource = 'canvas'
  try {
    const parsed = JSON.parse(body) as { chainYaml?: unknown; doc?: unknown; source?: unknown }
    if (typeof parsed.chainYaml === 'string' && parsed.chainYaml.trim().length > 0) {
      input = parsed.chainYaml
    } else if (parsed.doc !== null && typeof parsed.doc === 'object') {
      input = parsed.doc as ChainDoc
    } else {
      fail(res, 400, '请求体必须形如 {"doc": {…链文档…}} 或 {"chainYaml": "<链 YAML 文本>"}', 'bad-param')
      return
    }
    // 来源由调用方声明：画布保存 vs YAML 导入。别的值一律不认（避免写入不可解释的来源）。
    if (parsed.source === 'import') source = 'import'
    else if (parsed.source !== undefined && parsed.source !== 'canvas') {
      fail(res, 400, `source 只接受 canvas / import，收到 ${String(parsed.source)}`, 'bad-param')
      return
    }
  } catch {
    fail(res, 400, '请求体不是合法 JSON', 'bad-json')
    return
  }

  const workspaceRoot = await deps.resolveWorkspaceRoot()
  const saved = saveChain(workspaceRoot, input, { source })
  if (!saved.ok) {
    ok(res, {
      ok: false,
      code: saved.issues.some((issue) => issue.code === 'card-not-imported') ? 'card-not-imported' : 'invalid-chain',
      issues: toIssues(saved.issues),
    })
    return
  }
  ok(res, { ok: true, version: saved.version, path: saved.path, warnings: toIssues(saved.warnings) })
}

function toIssues(issues: ChainIssue[]): Array<{ target: string; code: string; reason: string }> {
  return issues.map((issue) => ({ target: issue.target, code: issue.code, reason: issue.reason }))
}

function readBody(req: IncomingMessage): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_SAVE_BODY_BYTES) {
        resolve(undefined)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function ok(res: ServerResponse, data: unknown): void {
  send(res, 200, { success: true, data })
}

function fail(res: ServerResponse, status: number, error: string, code?: string): void {
  send(res, status, code === undefined ? { success: false, error } : { success: false, error, code })
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

/** 注册编排路由（与采集路由共用同一个前缀，靠子路径区分）。 */
export function registerOrchestrationPanelRoutes(
  webServer: OrchestrationRouteRegistrar,
  deps: OrchestrationPanelDeps,
): () => void {
  const dispose = webServer.register({
    kind: 'prefix',
    // 与采集面板共用前缀：一个 register 挂一个 handler，宿主按最长前缀路由；
    // 这里注册更长的前缀，保证 /orchestration/* 不被采集 handler 抢先吃掉。
    path: '/dashboard/api/dataforge/orchestration',
    handler: createOrchestrationPanelHandler(deps),
  })
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    dispose()
  }
}
