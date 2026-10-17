/**
 * 面板数据面访问器：唯一决定「服务端说了什么 vs 本地异常」的分层（对齐 pm board 纪律）——
 * 服务端信封的 error 直接透出（含可读中文），网络层/解析层的异常包一层带上下文。
 *
 * @module dsh-dataforge/client/api
 */
import type { CaptureStartResult, CardRow, RunDetail, RunRow } from './types.js'

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
