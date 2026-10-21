/**
 * UI 测试域的应用层：录制生命周期、脚本读写、回放闸门与回执折叠。
 *
 * 分层与编排域一致：工具壳（`src/tools.ts`）只声明参数/渲染回执，判定与 IO 都在这里，
 * 面板路由复用同一批函数（不重新实现闸门）。
 *
 * 三道闸（沿用链路执行纪律，不另造一套）：
 *   1. 必填：脚本声明的 required 入参缺一即 `missing-inputs`，一个请求/浏览器都不起；
 *   2. 确认：不带 confirm 只给计划卡（步骤 + 写操作数 + 起点 host），不起浏览器；
 *   3. 开关：`uiTestEnabled=false` 时一律 `ui-test-disabled`（脚本读写/历史回看照常）。
 *
 * 凭证纪律：录制结束把会话 cookie 写进本地凭证 jar（0600、按 origin 隔离），回放按起点域名
 * 读回；cookie 值只在内存/context 里过手，事件、回执、摘要只有条数。
 *
 * @module dsh-dataforge/uitest/application
 */
import { join } from 'node:path'
import { domainMatches } from '../execute/credentials.js'
import { originOfUrl, persistCookies, readStore } from '../capture/credential-store.js'
import {
  AgentRecordingSessions,
  type AgentActResult, type AgentActSpec, type AgentSessionView,
} from './agentrec.js'
import {
  listUiScripts, listUiVersionInfos, loadUiScript, saveUiScript,
  type UiScriptLoadResult, type UiScriptRef, type UiScriptSaveResult,
} from './store.js'
import {
  formatUiIssues, inputRefsOf, loadYamlValue, missingInputsOf, parseUiScriptDoc, type UiIssue, type UiScriptDoc,
  type UiScriptSource, type UiStep,
} from './schema.js'
import { planUiRun, type UiCookie, type UiRunPlan, type UiRunResult } from './run.js'
import {
  executeUiBatch, planUiBatch,
  type UiBatchArgs, type UiBatchPlan, type UiBatchResult,
} from './batch.js'
import {
  listUiRuns, readUiRunEvents, readUiRunRecord, uiRunDir, type UiRunEvent, type UiRunRecord,
} from './run-store.js'
import type { UiRecordingResult } from './recorder.js'
import type { UiRecordingSessionView } from './sessions.js'
import type { PickedElement } from './selector-script.js'
import type { UiBrowserEngine, UiEngineSelection } from './engines.js'
import { ownerOf } from '../application.js'
import { autoNameFor, suggestFlowName, suggestSiteName } from './naming.js'

/** UI 测试域依赖（工具/面板共用）。 */
export type UiTestDeps = {
  /** 工作区根解析：与链/流程发现同一套（session cwd → process.cwd()）。 */
  resolveWorkspaceRoot: (exec: unknown) => Promise<string | undefined>
  /** 运行留痕根（`config.dataRoot`）。 */
  dataRoot: string
  /** 回放开关。 */
  enabled: boolean
  /** 凭证持久化文件；缺省 = 不读不写（Playwright 引擎的登录态兜底）。 */
  credentialStorePath?: string
  /**
   * 当前生效的浏览器引擎（录制 + 单条回放）。
   *
   * 惰性解析：宿主可能晚于本插件挂载 `ctx.browser`（共享浏览器插件），
   * 且配置切换是实时的。`cdp` 引擎未来实现同一 `UiBrowserEngine` 契约后在此返回即可。
   */
  resolveEngine: () => UiEngineSelection
  /**
   * 批量回归固定使用的引擎（默认 Playwright 无头）：
   * 共享浏览器一次只适合一条、会抢窗口，批量回归不能依赖它。
   */
  batchEngine: UiBrowserEngine
  /**
   * AI 代办录制的会话注册表（agentrec）：AI 自主操作页面、动作同步录步。
   * 与录制会话（resolveEngine）相互独立——代办录制需要直接持有 Playwright Page。
   */
  agentSessions: AgentRecordingSessions
  /**
   * 服务端密钥表（配置 uiAgentCredentials）：act 的 valueFrom 在这里取值。
   * 模型上下文只见键名（open 回执的 credentialKeys），永远不见值。
   */
  agentSecrets: Record<string, string>
  /** 可注入时钟（测试用）。 */
  now?: () => number
}

async function workspaceOf(deps: UiTestDeps, exec: unknown): Promise<string> {
  return (await deps.resolveWorkspaceRoot(exec)) ?? process.cwd()
}

function messageOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, 1_000)
}

/* ────────────────────────────────────────────────
 * 脚本读写
 * ──────────────────────────────────────────────── */

/** 脚本列表/详情回执。 */
export type UiScriptToolValue = {
  ok: boolean
  code?: string
  message?: string
  /** 列表模式：脚本引用（site/flow/latest/versions）。 */
  scripts?: UiScriptRef[]
  /** 详情模式：脚本本体 + YAML 原文 + 可用版本。 */
  site?: string
  flow?: string
  version?: number
  availableVersions?: number[]
  yaml?: string
  doc?: UiScriptDoc
  issues?: UiIssue[]
}

/**
 * 读脚本：给 site+flow 回详情（缺省最新版本），否则回列表。
 *
 * `yaml: true` 时详情附 YAML 原文（agent 要改脚本时先读原文，避免重写丢字段）。
 */
export async function getUiScriptForTool(
  deps: UiTestDeps,
  exec: unknown,
  args: { site?: string; flow?: string; version?: number },
): Promise<UiScriptToolValue> {
  const workspaceRoot = await workspaceOf(deps, exec)
  const site = args.site?.trim()
  const flow = args.flow?.trim()
  if (site === undefined || site === '' || flow === undefined || flow === '') {
    return { ok: true, scripts: listUiScripts(workspaceRoot) }
  }
  const loaded = loadUiScript(workspaceRoot, site, flow, args.version)
  if (!loaded.ok) {
    return {
      ok: false,
      code: loaded.code,
      message: loaded.message,
      availableVersions: loaded.availableVersions,
      ...(loaded.issues === undefined ? {} : { issues: loaded.issues }),
    }
  }
  return {
    ok: true,
    site,
    flow,
    version: loaded.version,
    availableVersions: loaded.availableVersions,
    yaml: loaded.yaml,
    doc: loaded.doc,
  }
}

/** 写入脚本回执。 */
export type UiScriptUpsertToolValue = {
  ok: boolean
  site?: string
  flow?: string
  version?: number
  path?: string
  issues?: UiIssue[]
  message?: string
}

/** agent 手写/导入脚本：YAML 进、校验过才落新版本。 */
export async function upsertUiScriptForTool(
  deps: UiTestDeps,
  exec: unknown,
  args: { yaml: string; source?: 'agent' | 'canvas' | 'record' },
): Promise<UiScriptUpsertToolValue> {
  const workspaceRoot = await workspaceOf(deps, exec)
  let parsed
  try {
    parsed = parseUiScriptDoc(safeYaml(args.yaml))
  } catch (error) {
    return { ok: false, message: messageOf(error) }
  }
  if (!parsed.ok) {
    return { ok: false, message: `脚本未通过校验：${formatUiIssues(parsed.issues)}`, issues: parsed.issues }
  }
  const saved: UiScriptSaveResult = saveUiScript(workspaceRoot, parsed.doc, {
    source: args.source ?? 'agent',
  })
  if (!saved.ok) return { ok: false, issues: saved.issues, message: `脚本未通过校验：${formatUiIssues(saved.issues)}` }
  return {
    ok: true,
    site: saved.doc.meta.site,
    flow: saved.doc.meta.flow,
    version: saved.version,
    path: saved.path,
  }
}

function safeYaml(text: string): unknown {
  // 交给 store/schema 的 YAML 解析；这里只做 JavaScript 对象直传的兜底（测试/面板可能直接给对象）。
  try {
    // 延迟 import 避免顶层 js-yaml 依赖（schema 模块已经用它，重复 import 无害）
    return parseYaml(text)
  } catch (error) {
    throw new Error(`YAML 解析失败：${messageOf(error)}`)
  }
}

function parseYaml(text: string): unknown {
  return loadYamlValue(text)
}

/* ────────────────────────────────────────────────
 * 录制
 * ──────────────────────────────────────────────── */

/** 打开录制会话回执。 */
export type UiRecordOpenToolValue = {
  ok: boolean
  sessionId?: string
  pageUrl?: string
  /** 实际使用的浏览器引擎（面板据此决定是否打开侧栏录制控制 tab）。 */
  engine?: string
  notice?: string
  /** 从当前页面推断的站点名（站点名留空时用于预填/自动命名）。 */
  suggestedSite?: string
  /** 从当前页面标题推断的流程名（流程名留空时用于预填/自动命名）。 */
  suggestedFlow?: string
  error?: string
}

/**
 * 打开一个可见 Chrome（不开始录制）：先让用户登录/导航到起点，再 start。
 *
 * 为什么分成 open/start 两步：登录动作不该进脚本。用户先登录，再点"开始录制"，
 * 脚本里就只剩业务操作；回放靠录制时持久化的 cookie 直接进登录态。
 */
export async function openRecordingForTool(
  deps: UiTestDeps,
  args: { startUrl: string; headless?: boolean; ownerSessionId?: string },
): Promise<UiRecordOpenToolValue> {
  let url: string
  try {
    const parsed = new URL(args.startUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('protocol')
    url = parsed.toString()
  } catch {
    return { ok: false, error: `startUrl 必须是 http/https 的合法 URL：${args.startUrl}` }
  }
  const selection = deps.resolveEngine()
  const engine = selection.engine
  if (!engine.available()) {
    return { ok: false, error: `浏览器引擎 ${engine.label} 不可用：${selection.degraded ?? '宿主未提供共享浏览器（安装/启用 dsh-builtin-browser 或把 uiTestBrowser 设为 playwright）'}` }
  }
  const cookies = engine.managesCookies ? undefined : await loadCookiesForStart(deps, url)
  const opened = await engine.open({
    startUrl: url,
    ...(args.headless === undefined ? {} : { headless: args.headless }),
    ...(cookies === undefined ? {} : { cookies }),
    ...(args.ownerSessionId === undefined || args.ownerSessionId === '' ? {} : { owner: args.ownerSessionId }),
  })
  if (!opened.ok) return { ok: false, error: opened.error }
  // 预填建议：此时页面可能还是登录页，所以只作为「留空自动命名」的起点；停止时会用当时的真实页面重算。
  const meta = opened.sessionId === undefined ? {} : await engine.pageMeta(opened.sessionId).catch(() => ({}))
  const suggestedSite = suggestSiteName(meta)
  const suggestedFlow = suggestFlowName(meta)
  return {
    ok: true,
    sessionId: opened.sessionId,
    pageUrl: opened.pageUrl,
    engine: engine.kind,
    ...(suggestedSite === '' ? {} : { suggestedSite }),
    ...(suggestedFlow === '' ? {} : { suggestedFlow }),
    notice: engine.kind === 'shared'
      ? '共享浏览器已打开（未开始录制）：页面在该对话的右侧栏浏览器面板里——没看到就点会话右上角的展开侧栏按钮。站点名/流程名留空会自动命名。'
      : '浏览器已打开（未开始录制）：先完成登录/导航，再开始录制；站点名/流程名留空会自动命名。',
  }
}

/** 开始录制回执。 */
export type UiRecordStartToolValue = {
  ok: boolean
  sessionId?: string
  pageUrl?: string
  alreadyRecording?: boolean
  error?: string
}

export async function startRecordingForTool(
  deps: UiTestDeps,
  args: { sessionId: string },
): Promise<UiRecordStartToolValue> {
  const { engine } = deps.resolveEngine()
  if (!engine.available()) return { ok: false, error: `浏览器引擎 ${engine.label} 不可用` }
  const started = await engine.start(args.sessionId)
  if (!started.ok) return { ok: false, error: started.error }
  return {
    ok: true,
    sessionId: args.sessionId,
    pageUrl: started.pageUrl,
    ...(started.alreadyRecording === true ? { alreadyRecording: true } : {}),
  }
}

/** 停止录制回执。 */
export type UiRecordStopToolValue = {
  ok: boolean
  sessionId?: string
  startUrl?: string
  steps?: UiRecordingResult['steps']
  stepCount?: number
  skippedSecrets?: number
  skippedUploads?: number
  notice?: string
  /** 保存结果（给了 site+flow 且 save=true 时）。 */
  saved?: { site: string; flow: string; version: number; path: string }
  /** 已持久化的 cookie 条数（只有条数，没有值）。 */
  persistedCookies?: number
  error?: string
}

/**
 * 停止录制：生成步骤 → 持久化会话 cookie → （可选）落新脚本版本。
 *
 * 没给 site/flow 就只回步骤（agent 先看再决定怎么落盘）；给了默认保存。
 * 空步骤不落盘（脚本 schema 要求至少 1 步），如实回 notice。
 */
export async function stopRecordingForTool(
  deps: UiTestDeps,
  exec: unknown,
  args: {
    sessionId: string
    site?: string
    flow?: string
    domain?: string
    note?: string
    save?: boolean
  },
): Promise<UiRecordStopToolValue> {
  const { engine } = deps.resolveEngine()
  if (!engine.available()) return { ok: false, sessionId: args.sessionId, error: `浏览器引擎 ${engine.label} 不可用` }
  const stopped = await engine.stop(args.sessionId)
  if (!stopped.ok || stopped.result === undefined) {
    return { ok: false, sessionId: args.sessionId, error: stopped.error ?? '没有录到步骤' }
  }
  const result = stopped.result
  // 共享浏览器自己管登录态（插件 profile）；只有 Playwright 引擎需要把 cookie 写进 dataforge jar。
  const persistedCookies = engine.managesCookies ? undefined : await persistSessionCookies(deps, engine, args.sessionId)

  const base: UiRecordStopToolValue = {
    ok: true,
    sessionId: args.sessionId,
    startUrl: result.startUrl,
    steps: result.steps,
    stepCount: result.steps.length,
    skippedSecrets: result.skippedSecrets,
    skippedUploads: result.skippedUploads,
    ...(result.notice === undefined ? {} : { notice: result.notice }),
    ...(persistedCookies === undefined ? {} : { persistedCookies }),
  }
  let site = args.site?.trim()
  let flow = args.flow?.trim()
  const save = args.save ?? true
  let autoNamed = false
  if (save && result.steps.length > 0 && (site === undefined || site === '' || flow === undefined || flow === '')) {
    const meta = await engine.pageMeta(args.sessionId).catch(() => ({}))
    const auto = autoNameFor(meta)
    if (site === undefined || site === '') {
      site = auto.site === '' ? '未命名站点' : auto.site
      autoNamed = true
    }
    if (flow === undefined || flow === '') {
      flow = auto.flow
      autoNamed = true
    }
  }
  if (save && site !== undefined && site !== '' && flow !== undefined && flow !== '' && result.steps.length > 0) {
    const saved = saveUiScript(await workspaceOf(deps, exec), {
      apiVersion: 'dataforge/v1',
      kind: 'ui-script',
      meta: {
        site,
        flow,
        version: 1,
        created: new Date().toISOString(),
        source: 'record',
        startUrl: result.startUrl,
        viewport: result.viewport,
        ...(args.domain === undefined || args.domain.trim() === '' ? {} : { domain: args.domain.trim() }),
        ...(args.note === undefined || args.note.trim() === '' ? {} : { note: args.note.trim() }),
      },
      inputs: [],
      steps: result.steps,
    }, { source: 'record' })
    if (saved.ok) {
      base.saved = { site: saved.doc.meta.site, flow: saved.doc.meta.flow, version: saved.version, path: saved.path }
      if (autoNamed) {
        base.notice = [base.notice, `站点/流程名留空，已自动命名：${saved.doc.meta.site} / ${saved.doc.meta.flow}（可在脚本 YAML 里改）`]
          .filter((item) => item !== undefined && item !== '').join('；')
      }
    } else {
      base.notice = [base.notice, `脚本未保存：${formatUiIssues(saved.issues)}`].filter((item) => item !== undefined && item !== '').join('；')
    }
  } else if (save && result.steps.length === 0) {
    base.notice = [base.notice, '没有可保存的步骤（未落盘）'].filter((item) => item !== undefined && item !== '').join('；')
  }
  return base
}

/** 关闭录制会话回执。 */
export async function closeRecordingForTool(
  deps: UiTestDeps,
  args: { sessionId: string },
): Promise<{ ok: boolean; error?: string }> {
  const { engine } = deps.resolveEngine()
  const closed = await engine.close(args.sessionId)
  return closed.ok ? { ok: true } : { ok: false, error: `会话 ${args.sessionId} 不存在或已关闭` }
}

/** 录制会话列表（面板轮询用）。 */
export function recordingSessionsOf(deps: UiTestDeps): UiRecordingSessionView[] {
  return deps.resolveEngine().engine.list()
}

/** 点选元素回执（页面候选选择器 + 元素摘要）。 */
export type UiPickToolValue = PickedElement & { ok: boolean; sessionId?: string; error?: string }

/** 在录制会话页面上点选一个元素（面板补断言/改步骤用；agent 无此工具，避免误触）。 */
export async function pickSelectorForTool(
  deps: UiTestDeps,
  args: { sessionId: string; timeoutMs?: number },
): Promise<UiPickToolValue> {
  return deps.resolveEngine().engine.pickSelector(args.sessionId, args.timeoutMs)
}

/* ────────────────────────────────────────────────
 * AI 代办录制（agentrec）：AI 自主操作 + 同步录步 + 待审查落盘
 * ──────────────────────────────────────────────── */

/** 打开代办录制会话回执。 */
export type UiAgentOpenToolValue = {
  ok: boolean
  /** confirm-required = 只回了计划卡，还没起浏览器。 */
  gate?: string
  plan?: { card: string; task: string; startUrl: string; headless: boolean; credentialKeys: string[] }
  sessionId?: string
  runId?: string
  pageUrl?: string
  /** 服务端密钥表的键名（只有名字，没有值）。 */
  credentialKeys?: string[]
  notice?: string
  error?: string
}

/**
 * 打开 AI 代办录制会话（可见 Chrome，人能围观/随时接管）。
 *
 * 三道闸之闸2：不带 confirm 只回计划卡（任务/起点/密钥键名/写操作提示），
 * 一个浏览器都不起；确认后才真开。AI 随后用 agent_act 自主操作，动作同步录步。
 *
 * 引擎说明：代办录制用自己的浏览器工厂（AgentRecordingSessions，playwright-core +
 * 系统 Chrome），与 uiTestBrowser 配置的录制/回放引擎相互独立——shared 引擎下
 * 人录走侧栏共享浏览器，代办录制仍拉自己的可见窗口，互不影响。
 */
export async function openAgentSessionForTool(
  deps: UiTestDeps,
  exec: unknown,
  args: { task: string; startUrl: string; headless?: boolean; confirm?: boolean },
): Promise<UiAgentOpenToolValue> {
  const task = args.task.trim()
  if (task === '') return { ok: false, error: 'task 不能为空：写清楚要 AI 完成什么（审查比对的基准）' }
  let url: string
  try {
    const parsed = new URL(args.startUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('protocol')
    url = parsed.toString()
  } catch {
    return { ok: false, error: `startUrl 必须是 http/https 的合法 URL：${args.startUrl}` }
  }
  const headless = args.headless ?? false
  const credentialKeys = Object.keys(deps.agentSecrets).sort()
  const card = [
    `🤖 AI 代办录制计划`,
    `任务：${task}`,
    `起点：${url}（${headless ? '无头' : '可见'} Chrome）`,
    credentialKeys.length > 0
      ? `服务端密钥（valueFrom 可用键名）：${credentialKeys.join('、')}`
      : '未配置服务端密钥（uiAgentCredentials）：fill 只能给明文值，密码字段将无法执行',
    '⚠️ AI 将自主操作真实页面（点击/输入可能产生真实写入），期间检测到验证码会暂停叫人。',
    '确认后带 confirm=true 重调才会打开浏览器。',
  ].join('\n')
  if (args.confirm !== true) {
    return { ok: true, gate: 'confirm-required', plan: { card, task, startUrl: url, headless, credentialKeys } }
  }
  const cookies = await loadCookiesForStart(deps, url)
  const opened = await deps.agentSessions.open({
    startUrl: url,
    task,
    headless,
    cookies,
  })
  if (!opened.ok) return { ok: false, error: opened.error }
  return {
    ok: true,
    sessionId: opened.sessionId,
    runId: opened.runId,
    pageUrl: opened.pageUrl,
    credentialKeys,
    notice: headless
      ? '会话已打开（无头）。建议可见窗口以便围观与人工过验证码；如要切换，关闭后重开。'
      : '会话已打开（可见 Chrome）：你可围观 AI 操作，随时人工接管；AI 应用 dataforge_ui_agent_act 逐步执行，动作会同步录成步骤。',
  }
}

/** 代办动作回执（脱敏后）。 */
export type UiAgentActToolValue = AgentActResult

/** 执行一个代办动作：动作进页面，步骤进缓冲；challenge 检测到就如实报（AI 应暂停叫人）。 */
export async function agentActForTool(
  deps: UiTestDeps,
  args: { sessionId: string; act: AgentActSpec },
): Promise<UiAgentActToolValue> {
  return deps.agentSessions.act(args.sessionId, args.act, deps.agentSecrets)
}

/** 停止代办录制回执。 */
export type UiAgentStopToolValue = {
  ok: boolean
  sessionId?: string
  stepCount?: number
  /** 落盘结果（review=pending 的待审查版本）。 */
  saved?: { site: string; flow: string; version: number; path: string; review: 'pending' }
  /** 已持久化的 cookie 条数（只有条数）。 */
  persistedCookies?: number
  /** 录到的步骤（未落盘时也给，便于排查）。 */
  steps?: UiStep[]
  notice?: string
  error?: string
}

/**
 * 停止代办录制：步骤缓冲 → ui-script v1（review=pending + 原始任务描述）→ cookie 落 jar → 关会话。
 *
 * 没录到步骤不落盘（如实回 notice）。站点/流程名留空时按当前页面自动命名（与录制器同口径）。
 * 回放不消费 review：待审查版本确认前也可以直接回放，只是面板会一直挂「待审查」角标。
 */
export async function stopAgentSessionForTool(
  deps: UiTestDeps,
  exec: unknown,
  args: { sessionId: string; site?: string; flow?: string; domain?: string; note?: string },
): Promise<UiAgentStopToolValue> {
  const steps = deps.agentSessions.stepsOf(args.sessionId)
  if (steps === undefined) return { ok: false, error: `会话 ${args.sessionId} 不存在（可能已关闭）` }
  const task = deps.agentSessions.taskOf(args.sessionId) ?? ''
  const startUrl = deps.agentSessions.startUrlOf(args.sessionId) ?? ''
  const viewport = deps.agentSessions.viewportOf(args.sessionId)
  const secretSlots = deps.agentSessions.secretSlotsOf(args.sessionId)

  if (steps.length === 0) {
    await deps.agentSessions.close(args.sessionId)
    return { ok: true, sessionId: args.sessionId, stepCount: 0, notice: '没有录到任何步骤（未落盘）' }
  }

  let site = args.site?.trim()
  let flow = args.flow?.trim()
  let autoNamed = false
  if (site === undefined || site === '' || flow === undefined || flow === '') {
    const meta = await deps.agentSessions.pageMetaOf(args.sessionId).catch(() => ({}))
    const auto = autoNameFor(meta)
    if (site === undefined || site === '') {
      site = auto.site === '' ? '未命名站点' : auto.site
      autoNamed = true
    }
    if (flow === undefined || flow === '') {
      flow = auto.flow
      autoNamed = true
    }
  }

  const doc: UiScriptDoc = {
    apiVersion: 'dataforge/v1',
    kind: 'ui-script',
    meta: {
      site: site as string,
      flow: flow as string,
      version: 1,
      created: new Date().toISOString(),
      source: 'agent',
      startUrl,
      review: 'pending',
      task,
      ...(viewport === undefined ? {} : { viewport }),
      ...(args.domain === undefined || args.domain.trim() === '' ? {} : { domain: args.domain.trim() }),
      ...(args.note === undefined || args.note.trim() === '' ? {} : { note: args.note.trim() }),
    },
    inputs: secretSlots.map((name) => ({ name, type: 'string' as const, required: true, example: '回放时由人提供' })),
    steps,
  }
  const saved = saveUiScript(await workspaceOf(deps, exec), doc, { source: 'agent' })
  const persistedCookies = await persistCookiesOf(deps, await deps.agentSessions.cookiesOf(args.sessionId)).catch(() => undefined)
  await deps.agentSessions.close(args.sessionId)
  if (!saved.ok) {
    return {
      ok: false,
      sessionId: args.sessionId,
      stepCount: steps.length,
      steps,
      persistedCookies,
      notice: `步骤已录到 ${steps.length} 条，但脚本未通过校验未落盘：${formatUiIssues(saved.issues)}`,
    }
  }
  return {
    ok: true,
    sessionId: args.sessionId,
    stepCount: steps.length,
    saved: {
      site: saved.doc.meta.site,
      flow: saved.doc.meta.flow,
      version: saved.version,
      path: saved.path,
      review: 'pending',
    },
    persistedCookies,
    steps,
    notice: [
      `已落盘为 v${saved.version}（待审查）：人在面板比对任务描述与步骤，确认后转 confirmed。`,
      autoNamed ? `站点/流程名留空，已自动命名：${saved.doc.meta.site} / ${saved.doc.meta.flow}` : '',
      secretSlots.length > 0 ? `${secretSlots.length} 个字段经服务端密钥注入，已脱敏为入参槽位：${secretSlots.join('、')}（回放前提供）。` : '',
      '待审查不影响回放：确认前也可直接 dataforge_ui_run 验证。',
    ].filter((item) => item !== '').join('；'),
  }
}

/** 代办录制会话列表（面板轮询用）。 */
export function agentSessionsOf(deps: UiTestDeps): AgentSessionView[] {
  return deps.agentSessions.list()
}

/** 人工审查回执：把某版本标记为已确认（落新版本的语义，旧版本不可变）。 */
export type UiAgentReviewToolValue = {
  ok: boolean
  site?: string
  flow?: string
  version?: number
  review?: 'confirmed'
  message?: string
  availableVersions?: number[]
  error?: string
}

/**
 * 审查确认（面板用）：把指定版本确认为「与任务一致」。
 *
 * 版本不可变：确认不是改旧文件，而是落一个 review=confirmed 的新版本（沿用原 source/task）。
 * 驳回不需要工具：人直接编辑步骤/断言后另存新版本即可（pending 角标随最新版本走）。
 */
export async function confirmAgentReviewForTool(
  workspaceRoot: string,
  args: { site: string; flow: string; version?: number; note?: string },
): Promise<UiAgentReviewToolValue> {
  const loaded = loadUiScript(workspaceRoot, args.site, args.flow, args.version)
  if (!loaded.ok) {
    return {
      ok: false,
      error: loaded.message,
      availableVersions: loaded.availableVersions,
    }
  }
  const note = args.note?.trim()
  const doc: UiScriptDoc = {
    ...loaded.doc,
    meta: {
      ...loaded.doc.meta,
      created: new Date().toISOString(),
      review: 'confirmed',
      ...(note === undefined || note === '' ? {} : { note }),
    },
  }
  const saved = saveUiScript(workspaceRoot, doc, { source: loaded.doc.meta.source })
  if (!saved.ok) {
    return { ok: false, error: `确认版本未通过校验：${formatUiIssues(saved.issues)}` }
  }
  return {
    ok: true,
    site: saved.doc.meta.site,
    flow: saved.doc.meta.flow,
    version: saved.version,
    review: 'confirmed',
    message: `已确认：v${saved.version} 标记为 review=confirmed（任务：${saved.doc.meta.task ?? '（无）'}）`,
  }
}

/* ────────────────────────────────────────────────
 * 回放
 * ──────────────────────────────────────────────── */

/** 回放闸门回执。 */
export type UiRunToolValue = {
  ok: boolean
  /** 失败码 / 闸码：ui-test-disabled / missing-inputs / confirm-required / executed / ui-script-not-found / invalid-ui-script / ui-run-failed。 */
  gate?: string
  code?: string
  message?: string
  plan?: UiRunPlan & { card?: string }
  result?: {
    runId: string
    success: boolean
    site: string
    flow: string
    version: number
    startUrl: string
    totalSteps: number
    stepsDone: number
    steps: UiRunResult['steps']
    failedStep?: UiRunResult['failedStep']
    screenshot?: string
    dom?: string
    error?: string
    elapsedMs: number
    cookiesApplied: number
  }
  missing?: string[]
  issues?: UiIssue[]
  availableVersions?: number[]
}

/**
 * 回放一个脚本：三道闸 + 执行。
 *
 * 不带 confirm / dry_run=true 只回计划卡；带 confirm 才起浏览器。
 * 写操作提示：click/submit/upload 可能产生业务写入，计划卡里如实计数，不替用户担保。
 */
export async function runUiScriptForTool(
  deps: UiTestDeps,
  exec: unknown,
  args: {
    site: string
    flow: string
    version?: number
    inputs?: Record<string, string>
    confirm?: boolean
    dryRun?: boolean
    headless?: boolean
    /** 每步之间的慢放延迟（毫秒，0..10000）。 */
    slowMoMs?: number
    /** 点击时画脉冲光圈（缺省 true）。 */
    highlightClicks?: boolean
    /** 回放结束后停留多久再关浏览器（毫秒，0..30000；缺省 1200）。 */
    holdMs?: number
    /** 面板请求的对话 id（agent 工具走 ownerOf(exec)）。 */
    ownerSessionId?: string
  },
): Promise<UiRunToolValue> {
  if (!deps.enabled) {
    return {
      ok: false,
      gate: 'ui-test-disabled',
      code: 'ui-test-disabled',
      message: 'UI 回放开关关闭（uiTestEnabled=false）：脚本读写与历史回看照常，回放不执行。',
    }
  }
  const inputs = normalizeInputsMap(args.inputs)
  const workspaceRoot = await workspaceOf(deps, exec)
  const loaded = loadUiScript(workspaceRoot, args.site, args.flow, args.version)
  if (!loaded.ok) {
    return {
      ok: false,
      gate: loaded.code,
      code: loaded.code,
      message: loaded.message,
      availableVersions: loaded.availableVersions,
      ...(loaded.issues === undefined ? {} : { issues: loaded.issues }),
    }
  }
  const missing = missingInputsOf(loaded.doc, inputs)
  if (missing.length > 0) {
    return {
      ok: false,
      gate: 'missing-inputs',
      code: 'missing-inputs',
      message: `缺必填入参：${missing.join('、')}`,
      missing,
    }
  }
  const plan = planUiRun(loaded.doc, inputs)
  const writeHint = plan.writeSteps > 0
    ? `其中 ${plan.writeSteps} 步是 click/submit/upload，可能产生真实业务写入`
    : '没有写操作步骤（只读）'
  const card = [
    `🧪 UI 回放计划：${plan.site} / ${plan.flow} v${plan.version}`,
    `起点：${plan.startUrl}`,
    `步骤 ${plan.stepCount} 条（${writeHint}）`,
    ...plan.steps.slice(0, 20).map((step, index) => `${index + 1}. ${step.kind}${step.target === undefined ? '' : ` ${step.target}`}`),
    plan.steps.length > 20 ? `… 还有 ${plan.steps.length - 20} 步` : '',
    '确认后带 confirm=true 重调才会起浏览器。',
  ].filter((line) => line !== '').join('\n')

  if (args.dryRun === true || args.confirm !== true) {
    return {
      ok: true,
      gate: args.dryRun === true ? 'dry-run' : 'confirm-required',
      plan: { ...plan, card },
    }
  }

  const selection = deps.resolveEngine()
  const engine = selection.engine
  if (!engine.available()) {
    return {
      ok: false,
      gate: 'ui-engine-unavailable',
      code: 'ui-engine-unavailable',
      message: `浏览器引擎 ${engine.label} 不可用：${selection.degraded ?? '宿主未提供共享浏览器；请安装/启用 dsh-builtin-browser 或把 uiTestBrowser 设为 playwright'}`,
    }
  }
  const owner = args.ownerSessionId ?? ownerOf(exec)
  const result = await engine.run(loaded.doc, inputs, {
    ...(args.headless === undefined ? {} : { headless: args.headless }),
    ...(args.slowMoMs === undefined ? {} : { slowMoMs: args.slowMoMs }),
    ...(args.highlightClicks === undefined ? {} : { highlightClicks: args.highlightClicks }),
    // agent 工具没显式给停留时给 1.2s（人看得见末尾）；面板/批处理各自显式传。
    holdMs: args.holdMs ?? 1_200,
    ...(owner === undefined ? {} : { owner }),
  })
  return {
    ok: true,
    gate: 'executed',
    plan: { ...plan, card },
    result: {
      runId: result.runId,
      success: result.success,
      site: result.site,
      flow: result.flow,
      version: result.version,
      startUrl: result.startUrl,
      totalSteps: result.totalSteps,
      stepsDone: result.stepsDone,
      steps: result.steps,
      ...(result.failedStep === undefined ? {} : { failedStep: result.failedStep }),
      ...(result.screenshot === undefined ? {} : { screenshot: result.screenshot }),
      ...(result.dom === undefined ? {} : { dom: result.dom }),
      ...(result.error === undefined ? {} : { error: result.error }),
      elapsedMs: result.elapsedMs,
      cookiesApplied: result.cookiesApplied,
    },
  }
}

function normalizeInputsMap(raw: Record<string, string> | undefined): Record<string, string> {
  if (raw === undefined) return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = String(value)
    }
  }
  return out
}

/** 运行列表行（工具 output.schema 推断要 JSON 标量，不能直接透 UiRunRecord 的 unknown 索引）。 */
export type UiRunRow = {
  runId: string
  status: string
  site: string
  flow: string
  version: number
  startUrl: string
  startedAt: number
  finishedAt?: number
  totalSteps?: number
  stepsDone?: number
  failedStep?: string
  error?: string
  screenshot?: string
}

/** 运行事件行（扁平投影：够回执展示，不把嵌套 unknown 灌进 schema）。 */
export type UiRunEventRow = {
  event: string
  ts?: number
  id?: string
  kind?: string
  status?: string
  stepId?: string
  selector?: string
  expected?: string
  actual?: string
  elapsed?: number
  error?: string
  success?: boolean
  message?: string
  screenshot?: string
  dom?: string
  site?: string
  flow?: string
  version?: number
  startUrl?: string
  totalSteps?: number
}

/** 运行列表/详情回执。 */
export type UiRunsToolValue = {
  ok: boolean
  runs?: UiRunRow[]
  run?: UiRunRow
  events?: UiRunEventRow[]
  message?: string
}

function runRowOf(record: UiRunRecord): UiRunRow {
  return {
    runId: record.runId,
    status: record.status,
    site: record.site,
    flow: record.flow,
    version: record.version,
    startUrl: record.startUrl,
    startedAt: record.startedAt,
    ...(record.finishedAt === undefined ? {} : { finishedAt: record.finishedAt }),
    ...(record.totalSteps === undefined ? {} : { totalSteps: record.totalSteps }),
    ...(record.stepsDone === undefined ? {} : { stepsDone: record.stepsDone }),
    ...(record.failedStep === undefined ? {} : { failedStep: record.failedStep }),
    ...(record.error === undefined ? {} : { error: record.error }),
    ...(record.screenshot === undefined ? {} : { screenshot: record.screenshot }),
  }
}

function eventRowsOf(events: Array<UiRunEvent & { ts?: number }>): UiRunEventRow[] {
  return events.map((event) => {
    if (event.event === 'step') {
      return {
        event: 'step',
        ...(event.ts === undefined ? {} : { ts: event.ts }),
        id: event.id,
        kind: event.kind,
        status: event.status,
        ...(event.elapsed === undefined ? {} : { elapsed: event.elapsed }),
        ...(event.error === undefined ? {} : { error: event.error }),
      }
    }
    if (event.event === 'assert') {
      return {
        event: 'assert',
        ...(event.ts === undefined ? {} : { ts: event.ts }),
        stepId: event.stepId,
        kind: event.kind,
        status: event.status,
        ...(event.selector === undefined ? {} : { selector: event.selector }),
        ...(event.expected === undefined ? {} : { expected: event.expected }),
        ...(event.actual === undefined ? {} : { actual: event.actual }),
        ...(event.elapsed === undefined ? {} : { elapsed: event.elapsed }),
        ...(event.error === undefined ? {} : { error: event.error }),
      }
    }
    if (event.event === 'terminal') {
      return {
        event: 'terminal',
        ...(event.ts === undefined ? {} : { ts: event.ts }),
        success: event.success,
        ...(event.message === undefined ? {} : { message: event.message }),
        ...(event.screenshot === undefined ? {} : { screenshot: event.screenshot }),
        ...(event.dom === undefined ? {} : { dom: event.dom }),
        ...(event.elapsed === undefined ? {} : { elapsed: event.elapsed }),
      }
    }
    return {
      event: 'meta',
      ...(event.ts === undefined ? {} : { ts: event.ts }),
      site: event.site,
      flow: event.flow,
      version: event.version,
      startUrl: event.startUrl,
    }
  })
}

export function runsForTool(deps: UiTestDeps, args: { runId?: string; limit?: number }): UiRunsToolValue {
  if (args.runId !== undefined && args.runId.trim() !== '') {
    const runId = args.runId.trim()
    const run = readUiRunRecord(deps.dataRoot, runId)
    if (run === undefined) return { ok: false, message: `UI 运行 ${runId} 不存在` }
    return { ok: true, run: runRowOf(run), events: eventRowsOf(readUiRunEvents(deps.dataRoot, runId)) }
  }
  return { ok: true, runs: listUiRuns(deps.dataRoot, args.limit ?? 20).map(runRowOf) }
}

/* ────────────────────────────────────────────────
 * 批量回归
 * ──────────────────────────────────────────────── */

/** 批量回执：计划卡 或 执行结果。 */
export type UiBatchToolValue = {
  ok: boolean
  gate?: 'ui-test-disabled' | 'confirm-required' | 'dry-run' | 'executed' | 'batch-plan-failed'
  code?: string
  message?: string
  plan?: UiBatchPlan & { card?: string }
  result?: UiBatchResult
}

function renderBatchPlanCard(plan: UiBatchPlan): string {
  const scope = plan.selection === 'all' ? '全部脚本' : plan.selection === 'site' ? `站点 ${plan.site ?? ''}` : '指定流程'
  const lines = plan.items.map((item) => {
    const version = item.version === undefined ? '' : ` v${item.version}`
    const tail = item.error !== undefined ? `（✗ ${item.error}）` : item.missing.length > 0 ? `（缺参 ${item.missing.join('、')}）` : ''
    return `${item.index + 1}. ${item.site} / ${item.flow}${version} ｜ ${item.stepCount} 步${tail}`
  })
  const missing = plan.missingInputs.length === 0 ? '' : `\n缺必填入参：${plan.missingInputs.join('、')}（补齐后重调）`
  const writes = plan.writeSteps === 0 ? '无写操作步骤' : `${plan.writeSteps} 步 click/submit/upload 可能产生真实业务写入`
  return [
    `🧪 UI 批量回放计划：${scope}，${plan.total} 条脚本（${writes}）`,
    ...lines,
    missing,
    '确认后带 confirm=true 重调才会逐条起浏览器。',
  ].filter((line) => line !== '').join('\n')
}

/**
 * 批量回放：计划（确认前）/ 执行（confirm=true）。
 *
 * 与单次回放同款纪律：`uiTestEnabled=false` 拒跑；缺参不静默跳过（计划卡列出，执行记跳过）；
 * 默认串行；每条脚本的回放/断言/截图复用单次执行，报告落 `dataRoot/ui-batches/<id>/`。
 */
export async function batchRunForTool(
  deps: UiTestDeps,
  exec: unknown,
  args: UiBatchArgs & { confirm?: boolean; dryRun?: boolean },
): Promise<UiBatchToolValue> {
  if (!deps.enabled) {
    return {
      ok: false,
      gate: 'ui-test-disabled',
      code: 'ui-test-disabled',
      message: 'UI 回放开关关闭（uiTestEnabled=false）：批量回放不执行，脚本与历史留痕照常。',
    }
  }
  const workspaceRoot = await workspaceOf(deps, exec)
  const planned = planUiBatch(workspaceRoot, args, args.inputs)
  if (!planned.ok) {
    return { ok: false, gate: 'batch-plan-failed', code: 'batch-plan-failed', message: planned.message }
  }
  if (planned.plan.total === 0) {
    return {
      ok: false,
      gate: 'batch-plan-failed',
      code: 'batch-plan-failed',
      message: args.flows !== undefined && args.flows.length > 0
        ? '指定的流程没有找到 UI 脚本'
        : '没有选中任何 UI 脚本（先录制或用 ui_script_upsert 写入）',
    }
  }
  const plan: UiBatchPlan & { card?: string } = { ...planned.plan, card: renderBatchPlanCard(planned.plan) }
  if (args.dryRun === true || args.confirm !== true) {
    return { ok: true, gate: args.dryRun === true ? 'dry-run' : 'confirm-required', plan }
  }
  if (!deps.batchEngine.available()) {
    return {
      ok: false,
      gate: 'batch-plan-failed',
      code: 'ui-engine-unavailable',
      message: `批量回放引擎 ${deps.batchEngine.label} 不可用`,
    }
  }
  const result = await executeUiBatch(
    {
      dataRoot: deps.dataRoot,
      run: (doc, inputs) => deps.batchEngine.run(doc, inputs, { headless: true, highlightClicks: false, holdMs: 0 }),
    },
    { plan: planned.plan, entries: planned.entries },
  )
  return { ok: true, gate: 'executed', plan, result }
}

/* ────────────────────────────────────────────────
 * 凭证（cookie jar）
 * ──────────────────────────────────────────────── */

/** 按起点 URL 从本地凭证 jar 读 cookie（值只进内存，供 context.addCookies）。 */
export async function loadCookiesForStart(deps: UiTestDeps, startUrl: string): Promise<UiCookie[]> {
  if (deps.credentialStorePath === undefined) return []
  let host: string
  try {
    host = new URL(startUrl).hostname
  } catch {
    return []
  }
  const store = readStore(deps.credentialStorePath)
  const out: UiCookie[] = []
  for (const [origin, entry] of Object.entries(store.origins)) {
    let originHost: string
    try {
      originHost = new URL(origin).hostname
    } catch {
      continue
    }
    if (!domainMatches(host, originHost)) continue
    const secure = origin.startsWith('https:')
    for (const cookie of entry.cookies) {
      out.push({
        name: cookie.name,
        value: cookie.value,
        domain: originHost,
        path: '/',
        secure,
        ...(cookie.expiresAt === undefined ? {} : { expires: cookie.expiresAt }),
      })
    }
  }
  return out
}

/**
 * 录制结束后把会话 cookie 写进本地 jar（0600、按 origin 隔离）。
 *
 * 只报写入条数，cookie 值不经过任何回执/日志。落盘失败不抛（录制本身已成功）。
 */
/**
 * 把一组 cookie 写进本地 jar（0600、按 origin 隔离）。只报写入条数，值不经过任何回执/日志。
 * 落盘失败不抛（录制/代办本身已成功）。
 */
export async function persistCookiesOf(deps: UiTestDeps, cookies: UiCookie[]): Promise<number | undefined> {
  if (deps.credentialStorePath === undefined) return undefined
  if (cookies.length === 0) return 0
  const now = deps.now?.() ?? Date.now()
  // 按 cookie 的 domain 分组 → origin；persistCookies 的入参是 Set-Cookie 字符串。
  const byOrigin = new Map<string, string[]>()
  for (const cookie of cookies) {
    const domain = cookie.domain.replace(/^\./, '')
    const origin = `${cookie.secure === true ? 'https' : 'http'}://${domain}`
    const expires = cookie.expires === undefined ? '' : `; Max-Age=${Math.max(0, Math.floor((cookie.expires - now) / 1000))}`
    const line = `${cookie.name}=${cookie.value}; Path=${cookie.path ?? '/'}${expires}`
    byOrigin.set(origin, [...(byOrigin.get(origin) ?? []), line])
  }
  let persisted = 0
  for (const [origin, lines] of byOrigin) {
    if (originOfUrl(origin) === undefined) continue
    persisted += persistCookies(deps.credentialStorePath, origin, lines, now)
  }
  return persisted
}

async function persistSessionCookies(deps: UiTestDeps, engine: UiBrowserEngine, sessionId: string): Promise<number | undefined> {
  return persistCookiesOf(deps, await engine.cookiesOf(sessionId))
}

/* ────────────────────────────────────────────────
 * 面板辅助
 * ──────────────────────────────────────────────── */

/** 运行证据文件（面板 GET 用）：只允许运行目录内的白名单文件名。 */
export function evidencePathOf(dataRoot: string, runId: string, name: string): string | undefined {
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(name)) return undefined
  if (name !== 'failure.png' && name !== 'failure.html' && name !== 'success.png') return undefined
  return join(uiRunDir(dataRoot, runId), name)
}

/** 保存脚本（面板导入/手写用）。 */
export async function saveUiScriptForPanel(
  deps: UiTestDeps,
  workspaceRoot: string,
  yaml: string,
  source: UiScriptSource = 'agent',
): Promise<UiScriptSaveResult> {
  void deps
  let parsed
  try {
    parsed = parseUiScriptDoc(safeYaml(yaml))
  } catch (error) {
    return { ok: false, issues: [{ target: 'script', code: 'invalid-script', reason: messageOf(error) }] }
  }
  if (!parsed.ok) return { ok: false, issues: parsed.issues }
  return saveUiScript(workspaceRoot, parsed.doc, { source })
}

/**
 * 保存脚本（面板编辑器用）：客户端回传**完整 doc**（含未知字段）而不是 YAML。
 *
 * 客户端没有 YAML 序列化器（不为它把 js-yaml 打进 bundle）；回传整份 doc 也能保证
 * 编辑过程中未被前端理解的字段零丢失（与服务端 `parseUiScriptDoc` 的"保留未知键"口径一致）。
 */
export function saveUiScriptDocForPanel(
  workspaceRoot: string,
  docRaw: unknown,
  source: UiScriptSource = 'canvas',
): UiScriptSaveResult {
  const parsed = parseUiScriptDoc(docRaw)
  if (!parsed.ok) return { ok: false, issues: parsed.issues }
  // 面板编辑产生的是"现在这一刻"的新版本：created 用当前时间，别沿用被编辑旧版本的创建时间。
  const doc = { ...parsed.doc, meta: { ...parsed.doc.meta, created: new Date().toISOString() } }
  return saveUiScript(workspaceRoot, doc, { source })
}

/** 脚本详情（面板用；缺省最新）。 */
export function loadUiScriptForPanel(
  workspaceRoot: string,
  site: string,
  flow: string,
  version?: number,
): UiScriptLoadResult {
  return loadUiScript(workspaceRoot, site, flow, version)
}

/** 版本摘要（面板用）。 */
export function uiVersionInfosForPanel(workspaceRoot: string, site: string, flow: string) {
  return listUiVersionInfos(workspaceRoot, site, flow)
}

/** 输入引用（面板展示"这个脚本用了哪些入参"用；纯函数转出）。 */
export function inputRefsOfStep(value: string): string[] {
  return inputRefsOf(value)
}
