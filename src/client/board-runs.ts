/**
 * 采集运行页面 —— 命令式视图：运行列表 + 行内详情（页面/凭据/样本三个子标签）。
 *
 * 呈现纪律：加载/空/失败三态诚实；失败态区分「服务端说了什么」（信封 error）
 * 与「本地异常」；凭据只列名字与种类——原文在服务端路由层已剥除。
 * 所有站点数据一律 textContent，零 innerHTML（注入面为零）。
 *
 * @module dsh-dataforge/client/board-runs
 */
import { fetchRunDetail, fetchRuns } from './api.js'
import { REFRESH_MS, SAMPLES_DISPLAY_CAP, STATUS_LABELS } from './dom.js'
import { clearChildren, el, fmtTime } from './el.js'
import { createBlockTabs } from './tabs.js'
import type { RunDetail, RunRow } from './types.js'

/** 挂上面板即取数 + 进入 15s 轮询；isActive 假时跳过 tick（可见性门闩）。 */
export function attachRunsBoard(
  container: HTMLElement,
  opts: { isActive: () => boolean },
): () => void {
  let disposed = false
  let generation = 0
  let expandedRunId: string | undefined

  container.replaceChildren()
  const listEl = el('div', { class: 'dsh-df-runs' })
  const lastSync = el('span', { class: 'dsh-df-last' })
  const refreshBtn = el('button', { class: 'dsh-df-btn', type: 'button' }, '刷新')
  refreshBtn.addEventListener('click', () => { void render() })
  container.append(
    el('div', { class: 'dsh-df-head' },
      el('div', {},
        el('h2', {}, '采集运行'),
        el('p', { class: 'dsh-df-sub' }, 'dataforge_capture / site_crawl / action 的留痕；15 秒自动刷新'),
      ),
      el('div', { class: 'dsh-df-sync' }, lastSync, refreshBtn),
    ),
    listEl,
  )

  const timer = setInterval(tick, REFRESH_MS)
  void render()
  return () => {
    disposed = true
    generation += 1
    clearInterval(timer)
  }

  function tick(): void {
    if (!opts.isActive()) return
    void render()
  }

  async function render(): Promise<void> {
    const gen = generation
    try {
      const { runs } = await fetchRuns()
      if (disposed || gen !== generation) return
      lastSync.textContent = `刷新于 ${new Date().toLocaleTimeString()}`
      clearChildren(listEl)
      if (runs.length === 0) {
        listEl.append(stateBlock('暂无采集运行 —— 先用 dataforge_capture 起一次采集，或用 agent 触发后回来查看。', false))
        return
      }
      for (const run of runs) listEl.append(buildRunItem(run))
    } catch (err) {
      if (disposed || gen !== generation) return
      clearChildren(listEl)
      listEl.append(stateBlock(`取数失败：${errText(err)}\n点「刷新」重试。`, true))
    }
  }

  function buildRunItem(run: RunRow): HTMLElement {
    const item = el('div', { class: 'dsh-df-item' })
    item.append(
      el('div', { class: 'dsh-df-row' },
        el('span', { class: `dsh-df-badge ${run.status}` }, STATUS_LABELS[run.status] ?? run.status),
        el('span', { class: 'dsh-df-mono dsh-df-grow' }, run.entryUrl),
        el('span', { class: 'dsh-df-cap' }, run.taskType),
      ),
      el('div', { class: 'dsh-df-row', style: 'margin-top:4px' },
        el('span', { class: 'dsh-df-chips' },
          `${run.stats.pages} 页 · ${run.stats.requests} 样本 · ${run.stats.cards} 卡 · ${run.stats.credentials} 凭证`,
          fmtTime(run.startedAt),
          run.endedAt === undefined ? '仍在进行' : `结束于 ${fmtTime(run.endedAt)}`,
        ),
      ),
    )
    if (run.error !== undefined && run.error.length > 0) {
      item.append(el('div', { class: 'dsh-df-errline' }, run.error))
    }
    if (run.notice !== undefined && run.notice.length > 0) {
      item.append(el('div', { class: 'dsh-df-noticeline' }, run.notice))
    }
    const detailBox = el('div', { class: 'dsh-df-detail' })
    // 详情内部点击不冒泡到条目（否则点样本行会连带折叠整个详情）
    detailBox.addEventListener('click', (event) => { event.stopPropagation() })
    if (run.id === expandedRunId) {
      item.classList.add('open')
      detailBox.append(el('div', { class: 'dsh-df-cap' }, '详情加载中…'))
      void fillDetail(detailBox, run.id)
    }
    item.append(detailBox)
    item.addEventListener('click', () => {
      expandedRunId = expandedRunId === run.id ? undefined : run.id
      void render()
    })
    return item
  }

  async function fillDetail(detailBox: HTMLElement, runId: string): Promise<void> {
    const gen = generation
    try {
      const detail = await fetchRunDetail(runId)
      if (disposed || gen !== generation) return
      detailBox.replaceChildren(buildDetail(detail))
    } catch (err) {
      if (disposed || gen !== generation) return
      detailBox.replaceChildren(el('div', { class: 'dsh-df-errline' }, `详情取数失败：${errText(err)}`))
    }
  }
}

function buildDetail(detail: RunDetail): HTMLElement {
  return createBlockTabs([
    { id: 'pages', label: `页面 ${detail.pages.length}`, build: () => buildPagesBlock(detail) },
    { id: 'credentials', label: `凭据 ${detail.credentials.length}`, build: () => buildCredentialsBlock(detail) },
    { id: 'samples', label: `样本 ${detail.samples.length}`, build: () => buildSamplesBlock(detail) },
  ])
}

function buildPagesBlock(detail: RunDetail): HTMLElement {
  const block = el('div', { class: 'dsh-df-block' })
  const list = el('div', { class: 'dsh-df-list' })
  if (detail.pages.length === 0) {
    list.append(el('div', { class: 'dsh-df-cap' }, '本运行没有页面记录'))
  }
  detail.pages.slice(0, SAMPLES_DISPLAY_CAP).forEach((page) => {
    list.append(el('div', { class: 'dsh-df-line' },
      el('span', { class: 'dsh-df-badge ' + page.status }, STATUS_LABELS[page.status] ?? page.status),
      el('span', { class: 'dsh-df-mono dsh-df-grow' }, page.url),
      el('span', { class: 'dsh-df-cap' }, `depth ${page.depth}`),
    ))
  })
  if (detail.pages.length > SAMPLES_DISPLAY_CAP) {
    list.append(el('div', { class: 'dsh-df-cap' }, `…共 ${detail.pages.length} 条，仅展示前 ${SAMPLES_DISPLAY_CAP} 条`))
  }
  block.append(list)
  return block
}

function buildCredentialsBlock(detail: RunDetail): HTMLElement {
  const block = el('div', { class: 'dsh-df-block' })
  block.append(el('div', { class: 'dsh-df-cap' }, '仅名字与种类；原文不出服务端'))
  const list = el('div', { class: 'dsh-df-list' })
  if (detail.credentials.length === 0) {
    list.append(el('div', { class: 'dsh-df-cap' }, '本运行未入库凭据'))
  }
  for (const credential of detail.credentials) {
    list.append(el('div', { class: 'dsh-df-line' },
      el('span', { class: 'dsh-df-badge cancelled' }, credential.kind),
      el('span', { class: 'dsh-df-mono dsh-df-grow' }, credential.name),
      el('span', { class: 'dsh-df-cap' }, fmtTime(credential.obtainedAt)),
    ))
  }
  block.append(list)
  return block
}

function buildSamplesBlock(detail: RunDetail): HTMLElement {
  const block = el('div', { class: 'dsh-df-block' })
  block.append(el('div', { class: 'dsh-df-cap' }, '点击行展开请求/响应预览'))
  const list = el('div', { class: 'dsh-df-list' })
  if (detail.samples.length === 0) {
    list.append(el('div', { class: 'dsh-df-cap' }, '本运行没有样本'))
  }
  detail.samples.slice(0, SAMPLES_DISPLAY_CAP).forEach((sample) => {
    const line = el('div', { class: 'dsh-df-line dsh-df-sample' },
      el('span', { class: `dsh-df-method ${sample.method === 'GET' || sample.method === 'POST' ? sample.method : 'dsh-df-method-other'}` }, sample.method),
      el('span', { class: 'dsh-df-mono dsh-df-grow' }, sample.url),
      el('span', { class: 'dsh-df-cap' }, sample.status === undefined ? '—' : String(sample.status)),
    )
    const pre = el('pre', { class: 'dsh-df-pre', style: 'display:none' },
      samplePreviewText(sample))
    line.addEventListener('click', () => {
      pre.style.display = pre.style.display === 'none' ? '' : 'none'
    })
    list.append(line, pre)
  })
  if (detail.samples.length > SAMPLES_DISPLAY_CAP) {
    list.append(el('div', { class: 'dsh-df-cap' }, `…共 ${detail.samples.length} 条，仅展示前 ${SAMPLES_DISPLAY_CAP} 条`))
  }
  block.append(list)
  return block
}

function samplePreviewText(sample: RunDetail['samples'][number]): string {
  const parts: string[] = []
  if (sample.requestBodyPreview !== undefined) parts.push(`请求体：\n${sample.requestBodyPreview}`)
  if (sample.responsePreview !== undefined) parts.push(`响应体：\n${sample.responsePreview}`)
  if (parts.length === 0) {
    return sample.truncated ? '正文超过留痕上限已落盘（服务端不给预览）' : '该样本没有正文'
  }
  return parts.join('\n\n')
}

function stateBlock(message: string, isErr: boolean): HTMLElement {
  return el('div', { class: isErr ? 'dsh-df-state err' : 'dsh-df-state' }, message)
}

function errText(err: unknown): string {
  return (err as Error)?.message ?? String(err)
}
