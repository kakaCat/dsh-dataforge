/**
 * 运行产物导出：dataset（业务数据）+ evidence（HTML 报告）。
 *
 * 只读 run 留痕，不重新执行；业务数据来自 foldSummary 的 businessData（result 事件）。
 * 不写凭证、不写请求头原文。
 *
 * @module dsh-dataforge/datasets/export
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { foldSummary, loadRunEvents, readRunRecord } from '../runs/store.js'
import { readUiRunEvents, readUiRunRecord, uiRunDir } from '../uitest/run-store.js'
import type { JsonLike, RunSummary } from '../shared/types.js'

export type DatasetExportToolValue =
  | {
      ok: true
      runId: string
      datasetPath: string
      reportPath: string
      kind: 'chain' | 'ui'
      status: string
      businessData: Record<string, JsonLike>
      chain?: Record<string, JsonLike>
      ui?: Record<string, JsonLike>
    }
  | {
      ok: false
      code: 'run-not-found' | 'run-unreadable'
      error: string
      hints?: string[]
    }

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string))
}

function textOf(value: unknown): string {
  if (value === undefined) return ''
  try {
    return typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * 导出一次运行的 dataset + evidence。
 *
 * @param dataRoot - 插件数据根（runs/datasets/evidence 同级）。
 * @param runId - 运行 id。
 */
export function exportRunArtifacts(dataRoot: string, runId: string): DatasetExportToolValue {
  const id = runId.trim()
  if (id === '') return { ok: false, code: 'run-not-found', error: 'run_id 不能为空' }
  const record = readRunRecord(dataRoot, id)
  const events = loadRunEvents(dataRoot, id)
  if (record === undefined || events === undefined) {
    const uiRecord = readUiRunRecord(dataRoot, id)
    if (uiRecord === undefined) {
      return { ok: false, code: 'run-not-found', error: `没有这个运行留痕：${id}`, hints: ['先跑一次 dataforge_chain_run / dataforge_ui_run'] }
    }
    return exportUiRun(dataRoot, id, uiRecord)
  }
  let summary: RunSummary
  try {
    summary = foldSummary(id, events)
  } catch (error) {
    return { ok: false, code: 'run-unreadable', error: `运行留痕折叠失败：${(error as Error).message}` }
  }
  const rawChain = record['chain']
  const chain = rawChain !== null && typeof rawChain === 'object' && !Array.isArray(rawChain)
    ? rawChain as Record<string, JsonLike>
    : undefined
  const chainSite = chain?.['site']
  const chainVersion = chain?.['version']
  const businessData = (summary.businessData ?? {}) as Record<string, JsonLike>
  const dataset = {
    apiVersion: 'dataforge/v1',
    kind: 'run-dataset',
    runId: id,
    createdAt: new Date().toISOString(),
    status: summary.status,
    site: typeof record['site'] === 'string' ? record['site'] : (typeof chainSite === 'string' ? chainSite : undefined),
    flow: typeof record['flow'] === 'string' ? record['flow'] : summary.flow,
    version: typeof record['version'] === 'number' ? record['version'] : (typeof chainVersion === 'number' ? chainVersion : undefined),
    businessData,
    chain,
    run: {
      startedAt: summary.startedAt,
      updatedAt: summary.updatedAt,
      stepsDone: summary.stepsDone,
      totalSteps: summary.totalSteps,
      lastError: summary.lastError,
    },
  }
  const datasetPath = join(dataRoot, 'datasets', `${id}.json`)
  mkdirSync(dirname(datasetPath), { recursive: true })
  writeFileSync(datasetPath, JSON.stringify(dataset, null, 2), 'utf8')

  const reportPath = join(dataRoot, 'evidence', id, 'report.html')
  mkdirSync(dirname(reportPath), { recursive: true })
  const businessLines = Object.entries(businessData).length === 0
    ? '<p class="muted">本次运行没有 businessData</p>'
    : `<table><thead><tr><th>字段</th><th>值</th></tr></thead><tbody>${Object.entries(businessData).map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td><code>${escapeHtml(textOf(value))}</code></td></tr>`).join('')}</tbody></table>`
  const chainText = chain === undefined ? '' : `<h2>链身份</h2><pre>${escapeHtml(JSON.stringify(chain, null, 2))}</pre>`
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>运行报告 ${escapeHtml(id)}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:920px;margin:32px auto;padding:0 20px;color:#111827;line-height:1.6}h1{font-size:24px}h2{font-size:17px;margin-top:24px}.muted{color:#6b7280}code,pre{background:#f3f4f6;padding:2px 5px;border-radius:4px}pre{padding:12px;overflow:auto}table{border-collapse:collapse;width:100%}th,td{border:1px solid #e5e7eb;padding:7px 9px;text-align:left;vertical-align:top}th{background:#f9fafb}.status{padding:2px 9px;border-radius:999px;background:#e8f7ee;color:#166534}.failed{background:#fdecea;color:#b91c1c}</style></head><body>
<h1>运行报告 <code>${escapeHtml(id)}</code></h1>
<p>状态：<span class="status ${summary.status === 'failed' ? 'failed' : ''}">${escapeHtml(summary.status)}</span> ｜ 步骤 ${summary.stepsDone}/${summary.totalSteps} ｜ 更新 ${new Date(summary.updatedAt).toISOString()}</p>
${summary.lastError === undefined ? '' : `<p class="failed">错误：${escapeHtml(summary.lastError)}</p>`}
<h2>业务数据</h2>${businessLines}
${chainText}
<p class="muted">由 dsh-dataforge 生成；本报告只含运行摘要与 businessData，不含请求头/凭证原文。</p>
</body></html>`
  writeFileSync(reportPath, html, 'utf8')
  return {
    ok: true,
    runId: id,
    datasetPath,
    reportPath,
    kind: 'chain',
    status: summary.status,
    businessData,
    ...(chain === undefined ? {} : { chain }),
  }
}


/** UI 回放证据：dataset 记录步骤/断言，report.html 引截图（success/failure）。 */
function exportUiRun(dataRoot: string, runId: string, record: Record<string, unknown> & { status?: string; screenshot?: string }): DatasetExportToolValue {
  const evidenceDir = join(dataRoot, 'evidence', runId)
  mkdirSync(evidenceDir, { recursive: true })
  let copied: string | undefined
  if (typeof record.screenshot === 'string') {
    const name = record.screenshot.split('/').pop() ?? ''
    if (name === 'success.png' || name === 'failure.png') {
      const source = join(uiRunDir(dataRoot, runId), name)
      if (existsSync(source)) {
        copyFileSync(source, join(evidenceDir, name))
        copied = name
      }
    }
  }
  const events = readUiRunEvents(dataRoot, runId)
  const steps = events
    .filter((event) => event.event === 'step')
    .map((event) => ({ id: (event as { id?: string }).id, kind: (event as { kind?: string }).kind, status: (event as { status?: string }).status, error: (event as { error?: string }).error }))
  const dataset = {
    apiVersion: 'dataforge/v1',
    kind: 'ui-run-dataset',
    runId,
    createdAt: new Date().toISOString(),
    status: record.status ?? 'unknown',
    site: record.site,
    flow: record.flow,
    version: record.version,
    ui: record as unknown as Record<string, JsonLike>,
    steps,
    screenshot: copied,
  }
  const datasetPath = join(dataRoot, 'datasets', `${runId}.json`)
  mkdirSync(dirname(datasetPath), { recursive: true })
  writeFileSync(datasetPath, JSON.stringify(dataset, null, 2), 'utf8')
  const rows = steps.length === 0
    ? '<p class="muted">没有步骤事件</p>'
    : `<table><thead><tr><th>步骤</th><th>状态</th><th>错误</th></tr></thead><tbody>${steps.map((step) => `<tr><td>${escapeHtml(step.id ?? '')}（${escapeHtml(step.kind ?? '')}）</td><td>${escapeHtml(step.status ?? '')}</td><td>${escapeHtml(step.error ?? '')}</td></tr>`).join('')}</tbody></table>`
  const image = copied === undefined ? '' : `<h2>末态截图</h2><p><img src="${escapeHtml(copied)}" alt="UI run ${escapeHtml(runId)}" style="max-width:100%;border:1px solid #e5e7eb;border-radius:6px"></p>`
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>UI 运行报告 ${escapeHtml(runId)}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:920px;margin:32px auto;padding:0 20px;color:#111827;line-height:1.6}h1{font-size:24px}h2{font-size:17px;margin-top:24px}.muted{color:#6b7280}code{background:#f3f4f6;padding:2px 5px;border-radius:4px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #e5e7eb;padding:7px 9px;text-align:left}th{background:#f9fafb}.status{padding:2px 9px;border-radius:999px;background:#e8f7ee;color:#166534}.failed{background:#fdecea;color:#b91c1c}</style></head><body>
<h1>UI 运行报告 <code>${escapeHtml(runId)}</code></h1>
<p>状态：<span class="status ${record.status === 'failed' ? 'failed' : ''}">${escapeHtml(record.status ?? 'unknown')}</span> ｜ ${escapeHtml(String(record.site ?? ''))} / ${escapeHtml(String(record.flow ?? ''))}</p>
${typeof record.error === 'string' ? `<p class="failed">错误：${escapeHtml(record.error)}</p>` : ''}
<h2>步骤</h2>${rows}
${image}
<p class="muted">由 dsh-dataforge 生成；本报告只含 UI 运行摘要/步骤/截图，不含登录凭证。</p>
</body></html>`
  const reportPath = join(evidenceDir, 'report.html')
  writeFileSync(reportPath, html, 'utf8')
  return {
    ok: true,
    runId,
    datasetPath,
    reportPath,
    kind: 'ui',
    status: record.status ?? 'unknown',
    businessData: {},
    ui: record as unknown as Record<string, JsonLike>,
  }
}
