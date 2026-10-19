/**
 * UI 批量回放留痕：`dataRoot/ui-batches/<batchId>/`。
 *
 * 与单次运行（`ui-runs/`）分目录：
 *   - 单次运行回答「这条脚本哪一步断了」；
 *   - 批次回答「这一轮回归整体过没过、报告在哪」。
 * 报告同时落 `report.md`（人看）与 `report.json`（CI/后续工具消费），
 * 两者都由 `batch.json` 的 items 生成，不引入第二份事实源。
 *
 * @module dsh-dataforge/uitest/batch-store
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 批次根目录。 */
export function uiBatchesRoot(dataRoot: string): string {
  return join(dataRoot, 'ui-batches')
}

/** 单批次目录。 */
export function uiBatchDir(dataRoot: string, batchId: string): string {
  return join(uiBatchesRoot(dataRoot), batchId)
}

/** 批次里单条脚本的结果（与 batch.json / report.json 共用）。 */
export type UiBatchItemResult = {
  index: number
  site: string
  flow: string
  version?: number
  /** 单次运行 id（跳过/预检失败时可能没有）。 */
  runId?: string
  success: boolean
  /** 预检失败（缺参/脚本坏）没起浏览器。 */
  skipped?: boolean
  error?: string
  stepsDone?: number
  totalSteps?: number
  failedStep?: string
  screenshot?: string
  elapsedMs?: number
}

/** 批次记录（batch.json）。 */
export type UiBatchRecord = {
  batchId: string
  status: 'running' | 'done'
  startedAt: number
  finishedAt?: number
  /** 选择口径：显式 flows / 按站点 / 全部。 */
  selection: 'flows' | 'site' | 'all'
  site?: string
  total: number
  passed: number
  failed: number
  skipped: number
  elapsedMs?: number
  items: UiBatchItemResult[]
  report?: string
  reportJson?: string
  [key: string]: unknown
}

/** 新建批次目录 + 初始 batch.json；返回目录。 */
export function startUiBatch(dataRoot: string, batchId: string, meta: Record<string, unknown>): string {
  const dir = uiBatchDir(dataRoot, batchId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'batch.json'), JSON.stringify({
    batchId,
    status: 'running',
    startedAt: Date.now(),
    ...meta,
  }, null, 2), 'utf8')
  return dir
}

/** 读 batch.json；坏文件/不存在 → undefined。 */
export function readUiBatch(dataRoot: string, batchId: string): UiBatchRecord | undefined {
  const path = join(uiBatchDir(dataRoot, batchId), 'batch.json')
  if (!existsSync(path)) return undefined
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    return parsed as UiBatchRecord
  } catch {
    return undefined
  }
}

/** 合并写 batch.json（执行完写终态）。 */
export function finishUiBatch(dataRoot: string, batchId: string, patch: Partial<UiBatchRecord>): UiBatchRecord | undefined {
  const current = readUiBatch(dataRoot, batchId)
  if (current === undefined) return undefined
  const next = { ...current, ...patch }
  writeFileSync(join(uiBatchDir(dataRoot, batchId), 'batch.json'), JSON.stringify(next, null, 2), 'utf8')
  return next
}

/** 列最近批次（按目录名倒序 = 创建时间倒序）。 */
export function listUiBatches(dataRoot: string, limit = 20): UiBatchRecord[] {
  const root = uiBatchesRoot(dataRoot)
  if (!existsSync(root)) return []
  const dirs = readdirSync(root)
    .filter((entry) => {
      try {
        return statSync(join(root, entry)).isDirectory()
      } catch {
        return false
      }
    })
    .sort()
    .reverse()
    .slice(0, Math.max(1, limit))
  const records: UiBatchRecord[] = []
  for (const dir of dirs) {
    const record = readUiBatch(dataRoot, dir)
    if (record !== undefined) records.push(record)
  }
  return records
}

/** 报告文件白名单解析（面板/工具读取出口）。 */
export function batchReportPath(dataRoot: string, batchId: string, format: 'md' | 'json'): string | undefined {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(batchId)) return undefined
  const name = format === 'md' ? 'report.md' : 'report.json'
  const path = join(uiBatchDir(dataRoot, batchId), name)
  return existsSync(path) ? path : undefined
}

/**
 * 生成并落盘报告（md + json），返回相对 dataRoot 的路径。
 *
 * md 是给人/PR 贴的；json 给 CI 判断退出码与看明细。
 */
export function writeUiBatchReport(dataRoot: string, record: UiBatchRecord): { report: string; reportJson: string } {
  const dir = uiBatchDir(dataRoot, record.batchId)
  const finishedAt = record.finishedAt ?? Date.now()
  const summary = {
    batchId: record.batchId,
    generatedAt: new Date(finishedAt).toISOString(),
    selection: record.selection,
    ...(record.site === undefined ? {} : { site: record.site }),
    total: record.total,
    passed: record.passed,
    failed: record.failed,
    skipped: record.skipped,
    elapsedMs: record.elapsedMs ?? 0,
    success: record.failed === 0,
    items: record.items,
  }
  // md 表格：结果/站点流程/版本/步骤/耗时/断点；失败证据单列一段。
  const lines: string[] = [
    '# UI 批量回归报告',
    '',
    `- 批次：\`${record.batchId}\``,
    `- 时间：${summary.generatedAt}`,
    `- 范围：${record.selection === 'all' ? '全部脚本' : record.selection === 'site' ? `站点 ${record.site ?? ''}` : '指定流程'}`,
    `- 结果：**${record.passed} 通过 / ${record.failed} 失败 / ${record.skipped} 跳过**（共 ${record.total}，${Math.round((record.elapsedMs ?? 0) / 1000)}s）`,
    '',
    '| # | 站点 / 流程 | 版本 | 步骤 | 结果 | 耗时 | 失败点 / 原因 |',
    '|---|---|---|---|---|---|---|',
  ]
  for (const item of record.items) {
    const version = item.version === undefined ? '—' : `v${item.version}`
    const steps = item.totalSteps === undefined ? '—' : `${item.stepsDone ?? 0}/${item.totalSteps}`
    const elapsed = item.elapsedMs === undefined ? '—' : `${item.elapsedMs}ms`
    const verdict = item.skipped === true ? '⏭ 跳过' : item.success ? '✅ 通过' : '❌ 失败'
    const reason = item.error === undefined ? '' : item.error.replace(/\|/g, '\\|').replace(/\n/g, ' ')
    lines.push(`| ${item.index + 1} | ${item.site} / ${item.flow} | ${version} | ${steps} | ${verdict} | ${elapsed} | ${reason} |`)
  }
  const failures = record.items.filter((item) => item.success !== true)
  if (failures.length > 0) {
    lines.push('', '## 失败证据', '')
    for (const item of failures) {
      if (item.runId === undefined) {
        lines.push(`- ${item.site} / ${item.flow}：${item.error ?? '未执行'}（未产生运行记录）`)
        continue
      }
      lines.push(`- ${item.site} / ${item.flow}（run \`${item.runId}\`）${item.failedStep === undefined ? '' : `断在 ${item.failedStep}`}${item.screenshot === undefined ? '' : `；截图 \`${item.screenshot}\``}`)
    }
  }
  lines.push('')
  writeFileSync(join(dir, 'report.md'), lines.join('\n'), 'utf8')
  writeFileSync(join(dir, 'report.json'), JSON.stringify(summary, null, 2), 'utf8')
  return {
    report: join('ui-batches', record.batchId, 'report.md'),
    reportJson: join('ui-batches', record.batchId, 'report.json'),
  }
}
