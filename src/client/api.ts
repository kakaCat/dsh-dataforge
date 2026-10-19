/**
 * 面板数据面访问器：唯一决定「服务端说了什么 vs 本地异常」的分层（对齐 pm board 纪律）——
 * 服务端信封的 error 直接透出（含可读中文），网络层/解析层的异常包一层带上下文。
 *
 * @module dsh-dataforge/client/api
 */
import type {
  CaptureStartResult, CardRow, ChainDocLike, ChainGraph, ChainSaveResult, NameKind, NameMaps,
  OrchestrationOverview, OrchestrationPalette, PageMetaRow, RetitleStartResult, RetitleStatus,
  RunDetail, RunRow, UiBatchRecord, UiBatchResponse, UiOverview, UiPickResult, UiRecordStopResult,
  UiRecordingSessionView, UiRunDetail, UiRunResponse, UiRunRow, UiScriptDetail, UiScriptDocLike, ArtifactList,
} from './types.js'

export const PANEL_API_PREFIX = '/dashboard/api/dataforge'

export class PanelApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

/**
 * 面板所属工作区（绝对路径）。
 *
 * 为什么必须由面板显式告诉服务端：宿主进程的 cwd 是 **profile 目录**
 * （`~/.dsh/profiles/desktop`），服务端拿它当工作区会把 `.dsh/dataforge/chains`
 * 指到空目录——面板就会永远显示「还没有任何编排流程」。面板从插槽的
 * `useWorkspaces` 拿到当前工作区路径，写在这里，所有请求带上 `?workspace=`。
 */
let panelWorkspace: string | undefined
let panelSession: string | undefined

/** 设置当前对话 id（共享浏览器按对话挂右侧栏面板；`app.tsx` 在渲染期写入）。 */
export function setPanelSession(sessionId: string | undefined): void {
  panelSession = sessionId !== undefined && sessionId.length > 0 ? sessionId : undefined
}

/** 设置本面板的工作区根（`app.tsx` 在渲染期写入；缺省 = 服务端自己回落）。 */
export function setPanelWorkspace(path: string | undefined): void {
  panelWorkspace = path !== undefined && path.length > 0 ? path : undefined
}

/** 把工作区拼进 URL（保留已有 query）。 */
function withWorkspace(url: string): string {
  const params: string[] = []
  if (panelWorkspace !== undefined) params.push(`workspace=${encodeURIComponent(panelWorkspace)}`)
  if (panelSession !== undefined) params.push(`session=${encodeURIComponent(panelSession)}`)
  if (params.length === 0) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}${params.join('&')}`
}

interface Envelope<T> {
  success: boolean
  data?: T
  error?: string
}

export async function fetchPanelData<T>(suffix: string): Promise<T> {
  const url = withWorkspace(`${PANEL_API_PREFIX}${suffix}`)
  let resp: Response
  try {
    resp = await fetch(url, { headers: { accept: 'application/json' } })
  } catch (err) {
    throw new PanelApiError(`面板数据服务不可达（${String((err as Error)?.message ?? err)}）`, 0)
  }
  if (!resp.ok) {
    throw new PanelApiError(`面板数据服务 HTTP ${resp.status}（${url}）`, resp.status)
  }
  let envelope: Envelope<T>
  try {
    envelope = (await resp.json()) as Envelope<T>
  } catch {
    throw new PanelApiError(`面板响应不是 JSON（HTTP ${resp.status}）：${url}`, resp.status)
  }
  if (envelope.success !== true || envelope.data === undefined) {
    throw new PanelApiError(envelope.error ?? `面板信封异常：${url}`, resp.status)
  }
  return envelope.data
}

export async function fetchRuns(limit = 30): Promise<{ runs: RunRow[] }> {
  return fetchPanelData<{ runs: RunRow[] }>(`/runs?limit=${limit}`)
}

export async function fetchRunDetail(runId: string): Promise<RunDetail> {
  return fetchPanelData<RunDetail>(`/runs/${encodeURIComponent(runId)}`)
}

export async function fetchCards(limit = 200, offset = 0): Promise<{ cards: CardRow[]; total: number }> {
  return fetchPanelData<{ cards: CardRow[]; total: number }>(`/cards?limit=${limit}&offset=${offset}`)
}

/**
 * 写入口只有 POST /captures（快速采集页）。与只读版不同：4xx/5xx 的信封 error
 * 往往是给用户看的操作反馈（缺 entryUrl / 非 single_page），必须取回信封再抛，
 * 不能像 GET 那样在 HTTP 非 200 时直接丢掉 error 文案。
 */
export async function postPanelData<T>(suffix: string, body: unknown): Promise<T> {
  const url = withWorkspace(`${PANEL_API_PREFIX}${suffix}`)
  let resp: Response
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
  } catch (err) {
    throw new PanelApiError(`面板数据服务不可达（${String((err as Error)?.message ?? err)}）`, 0)
  }
  let envelope: Envelope<T>
  try {
    envelope = (await resp.json()) as Envelope<T>
  } catch {
    throw new PanelApiError(`面板响应不是 JSON（HTTP ${resp.status}）：${url}`, resp.status)
  }
  if (envelope.success !== true || envelope.data === undefined) {
    throw new PanelApiError(envelope.error ?? `面板信封异常：${url}`, resp.status)
  }
  return envelope.data
}

export function postCapture(taskType: 'single_page', entryUrl: string): Promise<CaptureStartResult> {
  return postPanelData<CaptureStartResult>('/captures', { taskType, entryUrl })
}

/* ───────────────────────── 三级名称（网站 / 页面 / 接口） ───────────────────────── */

/**
 * 采集时记录的页面元数据（标题 / 站点名）。
 *
 * 这是**新增接口**：宿主里的旧服务端还没有这条路由（404）。调用方必须降级
 * （空集合 + 名称退回 host/URL），不能让整页进 error 态 —— 名称是增强，不是数据面。
 */
export async function fetchPageMeta(limit = 500): Promise<{ pages: PageMetaRow[] }> {
  return fetchPanelData<{ pages: PageMetaRow[] }>(`/page-meta?limit=${limit}`)
}

/** 手工名称覆盖（只有手工名，不含自动名；空表 = 没改过名）。 */
export async function fetchNames(): Promise<NameMaps> {
  return fetchPanelData<NameMaps>('/names')
}

/**
 * 写一条手工名称：name 为空串 = 删除覆盖（退回自动名 / host）。
 * 返回值里的 name 缺省即已删除。
 */
export async function postName(kind: NameKind, key: string, name: string): Promise<{ kind: NameKind; key: string; name?: string }> {
  return postPanelData<{ kind: NameKind; key: string; name?: string }>('/names', { kind, key, name })
}

/**
 * 发起「补抓名称」：服务端重访缺名称的已采页面，补 document.title / og:site_name。
 * accepted=false 用 reason 说明原因（busy / no-targets / capture-running）。
 */
export async function startRetitle(): Promise<RetitleStartResult> {
  return postPanelData<RetitleStartResult>('/retitle', {})
}

/** 补抓进度（1.5 秒轮询；running=false 即收口）。 */
export async function fetchRetitleStatus(): Promise<RetitleStatus> {
  return fetchPanelData<RetitleStatus>('/retitle/status')
}

/* ───────────────────────────── 编排页（R-2） ───────────────────────────── */

export async function fetchOrchestrationOverview(): Promise<OrchestrationOverview> {
  return fetchPanelData<OrchestrationOverview>('/orchestration/overview')
}

export async function fetchPalette(): Promise<OrchestrationPalette> {
  return fetchPanelData<OrchestrationPalette>('/orchestration/palette')
}

export async function fetchChainGraph(site: string, flow: string, version?: number): Promise<ChainGraph> {
  const query = new URLSearchParams({ site, flow })
  if (version !== undefined) query.set('version', String(version))
  return fetchPanelData<ChainGraph>(`/orchestration/graph?${query.toString()}`)
}

/**
 * 画布保存：走 POST 而不是又一条只读 GET。回执用 `ok:false + issues` 表达「校验不过」——
 * 那是**用户可修的操作反馈**，不是异常，所以不抛（与 postPanelData 的采集入口同款取舍）。
 *
 * 传 `doc` 而不是 YAML：客户端没有 YAML 序列化器（不为它把 js-yaml 打进 bundle），
 * 且整份 doc 回传能保证 inputs / 未知键零丢失。
 */
export async function saveChainGraph(doc: ChainDocLike): Promise<ChainSaveResult> {
  return postPanelData<ChainSaveResult>('/orchestration/graph', { doc })
}

/**
 * YAML 导入：同一写入口，只是 source 声明成 import（版本列表会显示「YAML 导入」）。
 *
 * 为什么导入也用 JSON 信封而不是表单上传：链 YAML 是纯文本、体积极小，JSON 里带一个
 * 字符串就够；表单 multipart 只会多一层解析。校验完全交给服务端 saveChain。
 */
export async function importChainYaml(chainYaml: string): Promise<ChainSaveResult> {
  return postPanelData<ChainSaveResult>('/orchestration/graph', { chainYaml, source: 'import' })
}

/* ───────────────────────── 业务域 / 流程改名（R-2 M5） ───────────────────────── */

export type ChainRenameArgs = {
  kind: 'flow' | 'domain'
  site: string
  flow?: string
  domain?: string
  newName: string
}

export type ChainRenameResult = {
  ok: boolean
  site: string
  flow?: string
  updatedFlows?: number
  updatedVersions?: number
}

/**
 * 改名：同步改写各版本 meta 的元数据修正（不改节点/边/内容，版本号不变）。
 * 失败（重名/不存在/坏文件）走 HTTP 错误信封，由 postPanelData 抛出可读 message。
 */
export async function renameChainEntry(args: ChainRenameArgs): Promise<ChainRenameResult> {
  return postPanelData<ChainRenameResult>('/orchestration/rename', args)
}


/* ───────────────────────── UI 测试（浏览器录制 + 回放） ───────────────────────── */

export async function fetchUiOverview(): Promise<UiOverview> {
  return fetchPanelData<UiOverview>('/ui-tests/overview')
}

export async function fetchUiScript(site: string, flow: string, version?: number): Promise<UiScriptDetail> {
  const query = new URLSearchParams({ site, flow })
  if (version !== undefined) query.set('version', String(version))
  return fetchPanelData<UiScriptDetail>(`/ui-tests/script?${query.toString()}`)
}

export async function saveUiScriptYaml(yaml: string): Promise<{ site: string; flow: string; version: number; path: string }> {
  return postPanelData<{ site: string; flow: string; version: number; path: string }>('/ui-tests/script', { yaml })
}

export type UiRecordOpenResult = {
  ok: boolean
  sessionId?: string
  pageUrl?: string
  engine?: string
  notice?: string
  suggestedSite?: string
  suggestedFlow?: string
  error?: string
}

/** 打开可见 Chrome（不开始录，先登录/导航）。 */
export async function openUiRecording(startUrl: string, headless = false): Promise<UiRecordOpenResult> {
  return postPanelData<UiRecordOpenResult>('/ui-tests/record/open', { startUrl, headless })
}

export async function startUiRecording(sessionId: string): Promise<{ ok: boolean; sessionId?: string; pageUrl?: string; alreadyRecording?: boolean; error?: string }> {
  return postPanelData('/ui-tests/record/start', { sessionId })
}

export type UiRecordStopArgs = {
  sessionId: string
  site?: string
  flow?: string
  domain?: string
  note?: string
  save?: boolean
}

export async function stopUiRecording(args: UiRecordStopArgs): Promise<UiRecordStopResult> {
  return postPanelData<UiRecordStopResult>('/ui-tests/record/stop', args)
}

export async function closeUiRecording(sessionId: string): Promise<{ ok: boolean; error?: string }> {
  return postPanelData('/ui-tests/record/close', { sessionId })
}

export type UiRunArgs = {
  site: string
  flow: string
  version?: number
  inputs?: Record<string, string>
  confirm?: boolean
  dryRun?: boolean
  /** 每步之间的慢放延迟（毫秒，0..10000）。 */
  slowMoMs?: number
  /** 点击时画脉冲光圈。 */
  highlightClicks?: boolean
  /** 回放结束后停留毫秒（0..30000）。 */
  holdMs?: number
  /** Playwright 引擎：false = 可见窗口。 */
  headless?: boolean
}

/** 回放：不带 confirm 只回计划卡；带 confirm 才起浏览器。 */
export async function runUiTest(args: UiRunArgs): Promise<UiRunResponse> {
  return postPanelData<UiRunResponse>('/ui-tests/run', args)
}

export async function fetchUiRuns(limit = 20): Promise<{ runs: UiRunRow[] }> {
  return fetchPanelData<{ runs: UiRunRow[] }>(`/ui-tests/runs?limit=${limit}`)
}

export async function fetchUiSessions(): Promise<{ sessions: UiRecordingSessionView[] }> {
  return fetchPanelData<{ sessions: UiRecordingSessionView[] }>('/ui-tests/record/sessions')
}

export async function fetchUiRunDetail(runId: string): Promise<UiRunDetail> {
  return fetchPanelData<UiRunDetail>(`/ui-tests/runs/${encodeURIComponent(runId)}`)
}

/** 失败截图 / 现场 HTML 的直链（证据文件名由服务端白名单校验）。 */
export function uiEvidenceUrl(runId: string, name: 'failure.png' | 'failure.html'): string {
  return withWorkspace(`${PANEL_API_PREFIX}/ui-tests/runs/${encodeURIComponent(runId)}/evidence?name=${name}`)
}


/** 面板编辑器保存：回传整份 doc（服务端校验全过才落新版本）。 */
export async function saveUiScriptDoc(doc: UiScriptDocLike): Promise<{ site: string; flow: string; version: number; path: string }> {
  return postPanelData<{ site: string; flow: string; version: number; path: string }>('/ui-tests/script', { doc })
}

/** 在录制会话页面上点选元素（返回候选选择器）。 */
export async function pickUiSelector(sessionId: string, timeoutMs = 120_000): Promise<UiPickResult> {
  return postPanelData<UiPickResult>('/ui-tests/record/pick', { sessionId, timeoutMs })
}


/* ───────────────────────── UI 批量回归（M3） ───────────────────────── */

export type UiBatchRunArgs = {
  site?: string
  flows?: string[]
  inputs?: Record<string, string>
  limit?: number
  confirm?: boolean
  dryRun?: boolean
}

/** 批量回放：不带 confirm 只回计划卡；带 confirm 才逐条起浏览器。 */
export async function runUiBatch(args: UiBatchRunArgs): Promise<UiBatchResponse> {
  return postPanelData<UiBatchResponse>('/ui-tests/batch/run', args)
}

export async function fetchUiBatches(limit = 20): Promise<{ batches: UiBatchRecord[] }> {
  return fetchPanelData<{ batches: UiBatchRecord[] }>(`/ui-tests/batch/runs?limit=${limit}`)
}

export async function fetchUiBatch(batchId: string): Promise<{ batch: UiBatchRecord }> {
  return fetchPanelData<{ batch: UiBatchRecord }>(`/ui-tests/batch/${encodeURIComponent(batchId)}`)
}

/** 批量报告直链（md 人看 / json 给 CI）。 */
export function uiBatchReportUrl(batchId: string, format: 'md' | 'json' = 'md'): string {
  return withWorkspace(`${PANEL_API_PREFIX}/ui-tests/batch/${encodeURIComponent(batchId)}/report?format=${format}`)
}


/** 只读运行产物列表（dataset + evidence），支持筛选/分页。 */
export async function fetchArtifacts(args: { limit?: number; offset?: number; kind?: string; status?: string; q?: string } = {}): Promise<ArtifactList> {
  const params = new URLSearchParams()
  params.set('limit', String(args.limit ?? 20))
  params.set('offset', String(args.offset ?? 0))
  if (args.kind !== undefined && args.kind !== '') params.set('kind', args.kind)
  if (args.status !== undefined && args.status !== '') params.set('status', args.status)
  if (args.q !== undefined && args.q.trim() !== '') params.set('q', args.q.trim())
  return fetchPanelData<ArtifactList>(`/artifacts?${params.toString()}`)
}

/** 产物文件直链：report / dataset / asset（asset 需带 name 查询）。 */
export function artifactUrl(runId: string, kind: 'report' | 'dataset', name?: string): string {
  const suffix = name === undefined ? '' : `?name=${encodeURIComponent(name)}`
  return withWorkspace(`${PANEL_API_PREFIX}/artifacts/${encodeURIComponent(runId)}/${kind}${suffix}`)
}
