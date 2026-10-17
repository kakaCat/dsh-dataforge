/**
 * 面板数据面访问器：唯一决定「服务端说了什么 vs 本地异常」的分层（对齐 pm board 纪律）——
 * 服务端信封的 error 直接透出（含可读中文），网络层/解析层的异常包一层带上下文。
 *
 * @module dsh-dataforge/client/api
 */
import type {
  CaptureStartResult, CardRow, ChainDocLike, ChainGraph, ChainSaveResult, OrchestrationOverview,
  OrchestrationPalette, RunDetail, RunRow,
} from './types.js'

export const PANEL_API_PREFIX = '/dashboard/api/dataforge'

export class PanelApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

interface Envelope<T> {
  success: boolean
  data?: T
  error?: string
}

export async function fetchPanelData<T>(suffix: string): Promise<T> {
  const url = `${PANEL_API_PREFIX}${suffix}`
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
  const url = `${PANEL_API_PREFIX}${suffix}`
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
