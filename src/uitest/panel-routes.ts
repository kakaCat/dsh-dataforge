/**
 * UI 测试面板数据面：`/dashboard/api/dataforge/ui-tests/*`。
 *
 * 与采集/编排同一前缀、同一套信封（200 {success:true,data} / 4xx {success:false,error,code}），
 * 由同一份 `PanelRouteRegistrar` 注册；入口在采集 handler 里分派（见 capture/panel-routes 的
 * 说明：同一前缀只注册一次，子路径在自己代码里分派）。
 *
 * 路由面（读为主 + 用户显式操作）：
 *   GET  /ui-tests/overview                     网站/流程/版本摘要 + 最近运行 + 录制会话
 *   GET  /ui-tests/script?site&flow&version     单版本脚本（doc + yaml + 版本列表）
 *   POST /ui-tests/script                       手写/导入脚本（只经 saveUiScript 落新版本）
 *   POST /ui-tests/record/open                  开可见 Chrome（不开始录，先登录）
 *   POST /ui-tests/record/start                 开始录制
 *   POST /ui-tests/record/stop                  停止录制（可选保存为脚本）
 *   POST /ui-tests/record/close                 关闭录制会话
 *   GET  /ui-tests/record/sessions              录制会话列表
 *   POST /ui-tests/run                          回放：不带 confirm 只回计划卡
 *   GET  /ui-tests/runs                         最近运行
 *   GET  /ui-tests/runs/:id                     运行详情（事件流）
 *   GET  /ui-tests/runs/:id/evidence?name=…     失败截图/现场 HTML（白名单文件名）
 *
 * 纪律：脚本落盘只经 saveUiScript（校验全过才落新版本）；cookie 值永不出壳；
 * 运行证据只允许 failure.png / failure.html（防路径穿越）。
 *
 * @module dsh-dataforge/uitest/panel-routes
 */
import { readFileSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isAbsolute } from 'node:path'
import {
  batchRunForTool, closeRecordingForTool, evidencePathOf, loadUiScriptForPanel,
  openRecordingForTool, pickSelectorForTool, recordingSessionsOf, runUiScriptForTool,
  saveUiScriptDocForPanel, saveUiScriptForPanel,
  startRecordingForTool, stopRecordingForTool, uiVersionInfosForPanel, type UiTestDeps,
} from './application.js'
import { batchReportPath, listUiBatches, readUiBatch } from './batch-store.js'
import { listUiScripts } from './store.js'
import { listUiRuns, readUiRunEvents, readUiRunRecord } from './run-store.js'

export const UI_TEST_API_PREFIX = '/ui-tests'

/** 脚本 YAML 可能不小；录制/回放请求都是小 JSON。 */
const MAX_SCRIPT_BODY_BYTES = 1024 * 1024
const MAX_SMALL_BODY_BYTES = 64 * 1024

/** 面板数据面依赖：应用层 deps + 工作区解析（面板请求没有 exec 上下文）。 */
export type UiTestPanelDeps = {
  deps: UiTestDeps
  /** 每次请求现取（面板可能切工作区）。 */
  resolveWorkspaceRoot: () => Promise<string>
}

/** 是否本模块的请求（两种 URL 形态都认）。 */
export function isUiTestRequest(url: string | undefined): boolean {
  const pathname = new URL(url ?? '/', 'http://panel.localhost').pathname
  return pathname.includes('/dataforge/ui-tests') || pathname.startsWith('/ui-tests')
}

/**
 * 构造 UI 测试面板 handler。
 *
 * 返回 true = 本 handler 已接管（含 405/404），false = 不是本模块路径，交回上层分派。
 */
export function createUiTestPanelHandler(deps: UiTestPanelDeps): (req: IncomingMessage, res: ServerResponse) => boolean {
  return (req, res) => {
    const url = new URL(req.url ?? '/', 'http://panel.localhost')
    if (!isUiTestRequest(req.url)) return false
    const suffix = stripPrefix(url.pathname)
    try {
      void dispatch(deps, req, res, url, suffix, (req.method ?? 'GET').toUpperCase())
    } catch (error) {
      fail(res, 500, String((error as Error)?.message ?? error), 'internal')
    }
    return true
  }
}

async function dispatch(
  panel: UiTestPanelDeps,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  suffix: string,
  method: string,
): Promise<void> {
  const workspaceRoot = await resolveRoot(panel, url)
  const deps: UiTestDeps = { ...panel.deps, resolveWorkspaceRoot: async () => workspaceRoot }

  if (method === 'POST') {
    if (suffix === '/script') {
      const body = await readJson(req, MAX_SCRIPT_BODY_BYTES)
      if (body === undefined) return fail(res, 400, '请求体不是合法 JSON', 'bad-json')
      const record = asRecord(body)
      const yamlRaw = record['yaml']
      const docRaw = record['doc']
      let saved
      if (typeof yamlRaw === 'string' && yamlRaw.trim() !== '') {
        saved = await saveUiScriptForPanel(deps, workspaceRoot, yamlRaw, 'agent')
      } else if (docRaw !== undefined) {
        // 面板编辑器回传整份 doc：来源标 canvas（代理手写/导入仍走 yaml，标 agent）
        saved = saveUiScriptDocForPanel(workspaceRoot, docRaw, 'canvas')
      } else {
        return fail(res, 400, '缺 yaml 或 doc 字段', 'bad-body')
      }
      if (!saved.ok) return fail(res, 400, `脚本未通过校验：${saved.issues.map((item) => `${item.target}：${item.reason}`).join('；')}`, 'invalid-ui-script')
      return ok(res, { site: saved.doc.meta.site, flow: saved.doc.meta.flow, version: saved.version, path: saved.path })
    }
    if (suffix === '/record/pick') {
      const body = await readJson(req, MAX_SMALL_BODY_BYTES)
      const record = asRecord(body)
      const sessionId = stringField(record, 'sessionId')
      if (sessionId === undefined) return fail(res, 400, '缺 sessionId', 'bad-body')
      const timeout = typeof record['timeoutMs'] === 'number' && record['timeoutMs'] > 0
        ? Math.min(record['timeoutMs'], 600_000)
        : undefined
      const picked = await pickSelectorForTool(deps, {
        sessionId,
        ...(timeout === undefined ? {} : { timeoutMs: timeout }),
      })
      // 点选失败（取消/超时）是操作用户可处理的结果，不进 4xx 异常：面板直接展示 message。
      return ok(res, picked)
    }
    if (suffix === '/record/open') {
      const body = await readJson(req, MAX_SMALL_BODY_BYTES)
      const record = asRecord(body)
      const startUrl = typeof record['startUrl'] === 'string' ? record['startUrl'] : ''
      if (startUrl === '') return fail(res, 400, '缺 startUrl', 'bad-body')
      const sessionOwner = url.searchParams.get('session')?.trim()
      const opened = await openRecordingForTool(deps, {
        startUrl,
        ...(typeof record['headless'] === 'boolean' ? { headless: record['headless'] } : {}),
        ...(sessionOwner === undefined || sessionOwner === '' ? {} : { ownerSessionId: sessionOwner }),
      })
      return opened.ok ? ok(res, opened) : fail(res, 400, opened.error ?? '打开录制会话失败', 'record-open-failed')
    }
    if (suffix === '/record/start') {
      const body = await readJson(req, MAX_SMALL_BODY_BYTES)
      const sessionId = stringField(asRecord(body), 'sessionId')
      if (sessionId === undefined) return fail(res, 400, '缺 sessionId', 'bad-body')
      const started = await startRecordingForTool(deps, { sessionId })
      return started.ok ? ok(res, started) : fail(res, 400, started.error ?? '开始录制失败', 'record-start-failed')
    }
    if (suffix === '/record/stop') {
      const body = await readJson(req, MAX_SMALL_BODY_BYTES)
      const record = asRecord(body)
      const sessionId = stringField(record, 'sessionId')
      if (sessionId === undefined) return fail(res, 400, '缺 sessionId', 'bad-body')
      const stopped = await stopRecordingForTool(deps, undefined, {
        sessionId,
        ...(stringField(record, 'site') === undefined ? {} : { site: stringField(record, 'site') }),
        ...(stringField(record, 'flow') === undefined ? {} : { flow: stringField(record, 'flow') }),
        ...(stringField(record, 'domain') === undefined ? {} : { domain: stringField(record, 'domain') }),
        ...(stringField(record, 'note') === undefined ? {} : { note: stringField(record, 'note') }),
        ...(typeof record['save'] === 'boolean' ? { save: record['save'] } : {}),
      })
      return stopped.ok ? ok(res, stopped) : fail(res, 400, stopped.error ?? '停止录制失败', 'record-stop-failed')
    }
    if (suffix === '/record/close') {
      const body = await readJson(req, MAX_SMALL_BODY_BYTES)
      const sessionId = stringField(asRecord(body), 'sessionId')
      if (sessionId === undefined) return fail(res, 400, '缺 sessionId', 'bad-body')
      const closed = await closeRecordingForTool(deps, { sessionId })
      return closed.ok ? ok(res, closed) : fail(res, 400, closed.error ?? '关闭失败', 'record-close-failed')
    }
    if (suffix === '/batch/run') {
      const body = await readJson(req, MAX_SMALL_BODY_BYTES)
      const record = asRecord(body)
      const inputsRaw = record['inputs']
      const inputs: Record<string, string> = {}
      if (typeof inputsRaw === 'object' && inputsRaw !== null && !Array.isArray(inputsRaw)) {
        for (const [key, value] of Object.entries(inputsRaw as Record<string, unknown>)) {
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') inputs[key] = String(value)
        }
      }
      const flowsRaw = record['flows']
      const flows = Array.isArray(flowsRaw) ? flowsRaw.filter((item): item is string => typeof item === 'string') : undefined
      const result = await batchRunForTool(deps, undefined, {
        ...(stringField(record, 'site') === undefined ? {} : { site: stringField(record, 'site') }),
        ...(flows === undefined ? {} : { flows }),
        inputs,
        ...(typeof record['limit'] === 'number' ? { limit: record['limit'] } : {}),
        confirm: record['confirm'] === true,
        ...(record['dryRun'] === true ? { dryRun: true } : {}),
      })
      return ok(res, result)
    }
    if (suffix === '/run') {
      const body = await readJson(req, MAX_SMALL_BODY_BYTES)
      const record = asRecord(body)
      const site = stringField(record, 'site')
      const flow = stringField(record, 'flow')
      if (site === undefined || flow === undefined) return fail(res, 400, '缺 site / flow', 'bad-body')
      const inputsRaw = record['inputs']
      const inputs: Record<string, string> = {}
      if (typeof inputsRaw === 'object' && inputsRaw !== null && !Array.isArray(inputsRaw)) {
        for (const [key, value] of Object.entries(inputsRaw as Record<string, unknown>)) {
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') inputs[key] = String(value)
        }
      }
      const sessionOwner = url.searchParams.get('session')?.trim()
      const result = await runUiScriptForTool(deps, undefined, {
        site,
        flow,
        ...(typeof record['version'] === 'number' ? { version: record['version'] } : {}),
        inputs,
        confirm: record['confirm'] === true,
        ...(record['dryRun'] === true ? { dryRun: true } : {}),
        ...(typeof record['headless'] === 'boolean' ? { headless: record['headless'] } : {}),
        ...(typeof record['slowMoMs'] === 'number' ? { slowMoMs: record['slowMoMs'] } : {}),
        ...(typeof record['highlightClicks'] === 'boolean' ? { highlightClicks: record['highlightClicks'] } : {}),
        ...(typeof record['holdMs'] === 'number' ? { holdMs: record['holdMs'] } : {}),
        ...(sessionOwner === undefined || sessionOwner === '' ? {} : { ownerSessionId: sessionOwner }),
      })
      return ok(res, result)
    }
    return fail(res, 405, `UI 测试面板不支持 ${method} ${suffix}`, 'method-not-allowed')
  }

  if (method !== 'GET') return fail(res, 405, `UI 测试面板只支持 GET 与 POST，收到 ${method}`, 'method-not-allowed')

  if (suffix === '/overview') {
    const scripts = listUiScripts(workspaceRoot)
    return ok(res, {
      generatedAt: Date.now(),
      scripts: scripts.map((script) => ({
        ...script,
        versions: uiVersionInfosForPanel(workspaceRoot, script.site, script.flow),
      })),
      runs: listUiRuns(deps.dataRoot, 10),
      sessions: recordingSessionsOf(deps),
      uiTestsRootHint: `${workspaceRoot}/.dsh/dataforge/ui-tests`,
      browser: (() => {
        const selection = deps.resolveEngine()
        return {
          engine: selection.engine.kind,
          label: selection.engine.label,
          available: selection.engine.available(),
          ...(selection.degraded === undefined ? {} : { degraded: selection.degraded }),
          installCommand: 'dsh plugin --profile desktop add dsh-builtin-browser@0.4.13',
        }
      })(),
    })
  }
  if (suffix === '/record/sessions') {
    return ok(res, { sessions: recordingSessionsOf(deps) })
  }
  if (suffix === '/runs') {
    return ok(res, { runs: listUiRuns(deps.dataRoot, clampLimit(url.searchParams.get('limit'), 20, 200)) })
  }
  if (suffix === '/batch/runs') {
    return ok(res, { batches: listUiBatches(deps.dataRoot, clampLimit(url.searchParams.get('limit'), 20, 100)) })
  }
  if (suffix.startsWith('/batch/')) {
    const rest = suffix.slice('/batch/'.length)
    const [idRaw, extra] = rest.split('/')
    const batchId = decodeURIComponent(idRaw ?? '')
    if (batchId === '') return fail(res, 404, '缺 batchId', 'unknown-path')
    if (extra === 'report') {
      const format = url.searchParams.get('format') === 'json' ? 'json' : 'md'
      const path = batchReportPath(deps.dataRoot, batchId, format)
      if (path === undefined) return fail(res, 404, '报告不存在', 'not-found')
      return serveReport(res, path, format)
    }
    if (extra !== undefined) return fail(res, 404, `不认识的路径：${suffix}`, 'unknown-path')
    const batch = readUiBatch(deps.dataRoot, batchId)
    if (batch === undefined) return fail(res, 404, `UI 批次 ${batchId} 不存在`, 'not-found')
    return ok(res, { batch })
  }
  if (suffix.startsWith('/runs/')) {
    const rest = suffix.slice('/runs/'.length)
    const [runIdRaw, extra] = rest.split('/')
    const runId = decodeURIComponent(runIdRaw ?? '')
    if (runId === '') return fail(res, 404, '缺 runId', 'unknown-path')
    if (extra === 'evidence') {
      const name = url.searchParams.get('name') ?? ''
      const path = evidencePathOf(deps.dataRoot, runId, name)
      if (path === undefined) return fail(res, 400, '证据文件名只支持 success.png / failure.png / failure.html', 'bad-evidence')
      return serveEvidence(res, path, name)
    }
    if (extra !== undefined) return fail(res, 404, `不认识的路径：${suffix}`, 'unknown-path')
    const run = readUiRunRecord(deps.dataRoot, runId)
    if (run === undefined) return fail(res, 404, `UI 运行 ${runId} 不存在`, 'not-found')
    return ok(res, { run, events: readUiRunEvents(deps.dataRoot, runId) })
  }
  if (suffix === '/script') {
    const site = url.searchParams.get('site') ?? ''
    const flow = url.searchParams.get('flow') ?? ''
    if (site === '' || flow === '') return fail(res, 400, '缺 site / flow', 'bad-query')
    const versionRaw = url.searchParams.get('version')
    const version = versionRaw === null ? undefined : Number(versionRaw)
    const loaded = loadUiScriptForPanel(workspaceRoot, site, flow, Number.isFinite(version) ? version : undefined)
    if (!loaded.ok) {
      return fail(res, 404, loaded.message, loaded.code, {
        availableVersions: loaded.availableVersions,
        ...(loaded.issues === undefined ? {} : { issues: loaded.issues }),
      })
    }
    return ok(res, {
      site,
      flow,
      version: loaded.version,
      availableVersions: loaded.availableVersions,
      yaml: loaded.yaml,
      doc: loaded.doc,
    })
  }

  return fail(res, 404, `不认识的路径：${suffix}`, 'unknown-path')
}

/** 前缀剥离：完整路径与剩余路径两种形态。 */
function stripPrefix(pathname: string): string {
  const full = `/dashboard/api/dataforge${UI_TEST_API_PREFIX}`
  if (pathname.startsWith(full)) return pathname.slice(full.length) || '/'
  if (pathname.startsWith(UI_TEST_API_PREFIX)) return pathname.slice(UI_TEST_API_PREFIX.length) || '/'
  return pathname
}

async function resolveRoot(panel: UiTestPanelDeps, url: URL): Promise<string> {
  const raw = url.searchParams.get('workspace')?.trim()
  if (raw !== undefined && raw.length > 0 && isAbsolute(raw)) {
    try {
      if (statSync(raw).isDirectory()) return raw
    } catch {
      // 不存在的路径：当没给，回落
    }
  }
  return panel.resolveWorkspaceRoot()
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function clampLimit(raw: string | null, fallback: number, max: number): number {
  const value = raw === null ? Number.NaN : Number(raw)
  if (!Number.isFinite(value) || value <= 0) return fallback
  return Math.min(Math.floor(value), max)
}

/* ── 证据文件（白名单 + 只读，不进 JSON 信封） ── */

function serveEvidence(res: ServerResponse, path: string, name: string): void {
  let data: Buffer
  try {
    data = readFileSync(path)
  } catch {
    fail(res, 404, '证据文件不存在', 'not-found')
    return
  }
  res.statusCode = 200
  res.setHeader('content-type', name.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(data)
}

/* ── 批量报告（md / json 原文，不进 JSON 信封） ── */

function serveReport(res: ServerResponse, path: string, format: 'md' | 'json'): void {
  let data: Buffer
  try {
    data = readFileSync(path)
  } catch {
    fail(res, 404, '报告不存在', 'not-found')
    return
  }
  res.statusCode = 200
  res.setHeader('content-type', format === 'md' ? 'text/markdown; charset=utf-8' : 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(data)
}

/* ── 信封（与采集/编排面板同款） ── */

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(text)
}

function ok(res: ServerResponse, data: unknown): void {
  send(res, 200, { success: true, data })
}

function fail(res: ServerResponse, status: number, error: string, code?: string, extra?: Record<string, unknown>): void {
  send(res, status, { success: false, error, ...(code === undefined ? {} : { code }), ...(extra ?? {}) })
}

class BodyTooLargeError extends Error {}

function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  return readBody(req, limit).then((text) => {
    try {
      return JSON.parse(text === '' ? '{}' : text)
    } catch {
      return undefined
    }
  }).catch(() => undefined)
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new BodyTooLargeError(`请求体超过 ${limit} 字节`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}
