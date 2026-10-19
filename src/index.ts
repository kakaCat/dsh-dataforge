/**
 * dsh-dataforge —— Cordis 插件入口。
 *
 * 职责一句话：**把声明式造数流程包，变成 agent 可调用的三个工具**。
 *
 * 分层（与 DSH 家族插件同款约定）：
 *   ① 工具壳（tools.ts）—— 参数声明 / 回执渲染 / 三道闸收口，全部本地纯逻辑；
 *   ② 流程发现（flows/discover.ts）—— engineRoot 内置包 + dataRoot 包 + 工作区包，
 *      「工作区 > dataRoot > 引擎内置」，改 yaml 即生效；
 *   ③ 引擎桥（engine/bridge.ts）—— spawn python dsh_bridge.py，stdout 纯 NDJSON 事件流。
 *      凭证不经过本插件；引擎在自己的 checkout 里加载 .env；
 *   ④ 运行留痕（runs/store.ts）—— dataRoot/runs/<runId>/events.ndjson，唯一事实源。
 *
 * 长跑：造数 2-8 分钟，走宿主 ctx.jobs 后台任务（复选 dsh-jobs + dsh-tool-jobs）；
 * jobs 不在场时 std 工具放行前台执行（如实标 foreground）。
 *
 * @module dsh-dataforge
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { Config, normalizeConfig, type Config as ConfigType } from './config.js'
import { discoverFlows, type PackRoots } from './flows/discover.js'
import { DataforgeError } from './shared/errors.js'
import {
  defineBrowserActTool, defineBrowserCloseTool, defineBrowserOpenTool, defineBrowserSnapshotTool,
  defineCaptureCancelTool, defineCaptureResultTool, defineCaptureStatusTool, defineCaptureTool,
  defineChainCrystalTool, defineChainDiagnoseTool, defineChainCompareTool, defineChainGetTool, defineChainBindTool, defineChainProbeTool, defineChainRunsTool, defineChainRunTool, defineChainUpsertTool,
  defineFlowsTool, defineLibraryImportTool, defineRunTool, defineStatusTool,
  defineChainDraftTool, defineDatasetExportTool, defineLookupTool, defineTraceAnalyzeTool, defineTraceGetTool,
  defineUiBatchRunTool, defineUiRecordCloseTool, defineUiRecordOpenTool, defineUiRecordStartTool,
  defineUiRecordStopTool, defineUiRunTool, defineUiRunsTool, defineUiScriptGetTool, defineUiScriptUpsertTool,
} from './tools.js'
import type { ChainRunToolDeps, OrchestrationDeps } from './orchestration/application.js'
import type { ChainDraftDeps, TraceDeps } from './trace/application.js'
import type { LookupDeps } from './lookup/lookup.js'
import { createPageLookupReader } from './lookup/page-reader.js'
import { openCapturingPage } from './capture/browser.js'
import { CaptureStore } from './capture/store.js'
import { createCaptureCredentialProvider } from './capture/credentials.js'
import { startCapture } from './capture/application.js'
import { PANEL_API_PREFIX, registerCapturePanelRoutes, type PanelRouteRegistrar } from './capture/panel-routes.js'
import { CaptureNamesStore } from './capture/names.js'
import { TitleBackfillService } from './capture/retitle.js'
import { createOrchestrationPanelHandler } from './orchestration/panel-routes.js'
import { createUiTestPanelHandler } from './uitest/panel-routes.js'
import { createArtifactsPanelHandler } from './datasets/panel-routes.js'
import { UiRecordingSessions } from './uitest/sessions.js'
import { loadCookiesForStart, runUiScriptForTool, type UiTestDeps } from './uitest/application.js'
import { runUiScript } from './uitest/run.js'
import { PlaywrightBrowserEngine } from './uitest/engines/playwright.js'
import { SharedBrowserEngine } from './uitest/engines/shared.js'
import type { BrowserSeam } from './uitest/browser-seam.js'
import type { UiBrowserEngine, UiEngineSelection } from './uitest/engines.js'
import { SessionRegistry } from './capture/session.js'
import type { CaptureDeps } from './capture/application.js'
import type { DataforgeDeps } from './application.js'
import { buildDataforgeDeps } from './application.js'

export const name = 'dsh-dataforge'

/** 工具注册表必依赖；jobs / systemPrompt / workingDirectory 惰性解析。 */
export const inject = ['tools']
export { Config, DataforgeError, normalizeConfig }

interface LoggerLike {
  info?: (message: string) => void
  warn?: (message: string) => void
  debug?: (message: string) => void
}

/** 从执行上下文解析当前工作区根（工作区流程包的锚点；对齐 dsh-file-enhance resolveRoot）。 */
async function resolveWorkspaceRoot(exec: unknown): Promise<string | undefined> {
  const id = (exec as { agent?: { session?: { header?: { cwd?: unknown } } } } | undefined)?.agent
  const cwd = id?.session?.header?.cwd
  if (typeof cwd === 'string' && cwd.length > 0) return cwd
  return process.cwd()
}

/** policy 文本来源：流程包 policy.md（权威），缺省给一段最小纪律（诚实标注缺省）。 */
function loadPolicyText(engineRoot: string): { text: string; source: string } {
  try {
    const text = readFileSync(join(engineRoot, 'policy.md'), 'utf8').trim()
    if (text.length > 0) return { text, source: 'policy.md' }
  } catch {
    // 无 policy.md → 缺省纪律
  }
  return {
    source: 'builtin-minimal',
    text: [
      '## dataforge（声明式造数流程）',
      '- 调 dataforge_run 前必须先 dataforge_flows 选定流程并核对必填参数；缺参数先向用户追问，不要瞎编。',
      '- 必须三闸齐备才执行：参数齐全（闸1）→ 用户确认（闸2，confirm=true）→ 业务词映射为编码（闸3，凭流程包说明）。',
      '- 结果只报业务字段（单号/状态/耗时），不暴露 HTTP 原文、token、数据库连接串。',
      '- 造数最终必须拿到完整单号链；只跑一半就该如实报失败步骤。',
    ].join('\n'),
  }
}

/** 采集域纪律：追加到 policy 文本末尾的常驻段。 */
const CAPTURE_POLICY = [
  '## dataforge-capture（接口采集）',
  '- 采集目标站任何写操作只经 dataforge_capture(task_type=action) 且用户明确 confirm；禁止用 browser_act 未确认直接提交表单。',
  '- site_crawl 是后台任务：dataforge_capture 返回 captureId 后用 dataforge_capture_status 轮询，不要凭空报结果。',
  '- 采集结果用 dataforge_capture_result(scope=cards|samples|credentials|pages) 取回，报给用户时只说接口名/用途/出入参要点，不贴 token/cookie 原文。',
  '- 诚实边界：遇风控/验证码/超限截断/外部域名跳过，如实转述 capture_status/capture_result 里的 notice，不隐瞒。',
].join('\n')

/** UI 测试纪律：录制/回放都是真浏览器操作，写操作必须用户确认。 */
const UI_TEST_POLICY = [
  '## dataforge-ui-test（浏览器录制 + 回放）',
  '- 录制分两步：先 dataforge_ui_record_open 让用户登录/导航，再 dataforge_ui_record_start；登录动作不要进脚本。',
  '- 停止录制用 dataforge_ui_record_stop（给 site/flow 默认落新版本）；密码/上传不进脚本，如实转述回执里的跳过计数。',
  '- 回放 dataforge_ui_run 不带 confirm 只出计划卡；click/submit/upload 可能产生真实业务写入，必须用户确认后带 confirm=true。',
  '- 失败先 dataforge_ui_runs(run_id) 看断在哪个步骤/断言，截图与现场 HTML 在回执里；不要盲目重跑写操作。',
  '- UI 脚本是项目资产（工作区 .dsh/dataforge/ui-tests），改脚本只经 dataforge_ui_script_upsert，不手改运行记录。',
].join('\n')

/** Trace → 自动编排纪律：草稿不执行，业务值不写死。 */
const TRACE_POLICY = [
  '## dataforge-trace（采集 → 自动编排草稿）',
  '- 自动编排先 dataforge_trace_get / dataforge_trace_analyze；低置信度绑定、动态值、正文截断都按 warning 如实转述。',
  '- dataforge_chain_draft 只生成草稿，不落盘、不执行；先审阅 warnings/validation，再让用户确认。',
  '- 保存用 dataforge_chain_upsert；执行用 dataforge_chain_run，不带 confirm 只出计划卡，写操作必须用户确认。',
  '- 业务值不写死：未绑定字段用 $inputs.<name>；组织/供应商/物料等映射走 dataforge_lookup，不手编编码。',
  '- 运行成功后用 dataforge_dataset_export(run_id) 导出 dataset/evidence；失败也要导出已有摘要。',
  '- UI 验收先 dataforge_ui_run（成功 success.png / 失败 failure.png+failure.html），再 dataset_export(ui_run_id) 生成截图证据。',
].join('\n')

/** 探索执行纪律：值来源必须诚实标注，写操作必须用户确认。 */
const EXPLORE_POLICY = [
  '## dataforge-explore（首跑试探）',
  '- 首跑用 dataforge_chain_probe 单节点试探；不要把整条不完整的链反复整链重跑。',
  '- probe 的 values 必须带 source：user / agent-inferred / upstream；agent-inferred 与 upstream 必须写 evidence，禁止把猜测标成 user。',
  '- 写操作（POST/PUT/PATCH/DELETE）必须经用户确认后带 confirm=true；没有确认只出计划卡。',
  '- probe 返回的 outputs 用来发现绑定边；回写只走 dataforge_chain_bind（只给边，自增版本；仍过 R-1 校验），不要手抄整份 YAML。',
  '- 复跑前后要对照时用 dataforge_chain_compare(runIds) 看入参/节点出参/状态差异，先对照再解释。',
  '- 结晶只经 dataforge_chain_crystallize：upstream 值绝不冻常量；agent-inferred 必须用户确认；复跑用 dataforge_chain_run.inputs。',
  '- 复跑失败先用 dataforge_chain_diagnose(run_id) 读断点/绑定边，再决定 probe 还是修链；不要盲目重跑写链。',
].join('\n')

/** 装载插件。 */
export function apply(ctx: Context, rawConfig: ConfigType): void {
  const anyCtx = ctx as unknown as {
    logger?: (name: string) => LoggerLike
    inject?: (services: string[], callback: (svc: Record<string, unknown>) => void) => void
    systemPrompt?: {
      section?: (spec: { name: string; order: unknown; text: string }) => void
      getSectionOrder?: (slot: string) => unknown
    }
    tools?: { register?: (tool: unknown) => unknown }
  }
  const logger = anyCtx.logger?.(name)
  const config = normalizeConfig(rawConfig)

  // jobs 服务：run 工具运行时经 ctx.get('jobs') 现取（装配缺失时诚实降级前台执行）。
  let jobsService: unknown
  anyCtx.inject?.(['jobs'], (svc) => {
    jobsService = svc['jobs']
  })

  // 共享真实浏览器（dsh-builtin-browser 的 `ctx.browser`）：UI 测试的执行面依赖它。
  // 这里用「软注入」只探测可用性（不阻塞插件加载），面板/日志如实显示装没装；
  // 执行后端切换是下一步重构，装与不装都不会让采集/流程功能失效。
  let browserService: unknown
  anyCtx.inject?.(['browser'], (svc) => {
    browserService = svc['browser']
  })
  // 当前对话 id：共享浏览器的桌面载体按对话挂右侧栏面板，必须传真实 session id。
  let agentsService: { list?: () => Array<{ id?: unknown }> } | undefined
  anyCtx.inject?.(['agents'], (svc) => {
    agentsService = svc['agents'] as typeof agentsService
  })
  const currentConversationId = (): string | undefined => {
    try {
      const list = agentsService?.list?.()
      const first = Array.isArray(list) ? list[0] : undefined
      return typeof first?.id === 'string' && first.id !== '' ? first.id : undefined
    } catch {
      return undefined
    }
  }

  /**
   * 面板工作区的服务端兜底（R-2 编排页「白板」修复）。
   *
   * 面板请求没有 session 上下文；客户端会尽量带 `?workspace=`，但工作区快照到达前
   * （或宿主未注入 useWorkspaces 时）会缺参。此时不能回落到 DSH 进程 cwd（那是
   * profile 目录，永远没有链），而是取工作区注册表里最近更新的那个。
   */
  let workspaceRegistryService: { list?: () => Array<{ path?: unknown; updatedAt?: unknown }> } | undefined
  anyCtx.inject?.(['workspaceRegistry'], (svc) => {
    workspaceRegistryService = svc['workspaceRegistry'] as typeof workspaceRegistryService
  })
  const latestWorkspacePath = (): string | undefined => {
    const rows = workspaceRegistryService?.list?.()
    if (!Array.isArray(rows) || rows.length === 0) return undefined
    const valid = rows.filter((row) => typeof row?.path === 'string' && row.path !== '')
    if (valid.length === 0) return undefined
    // 最近更新的排前面：用户刚用过的那个通常就是当前工作区。
    valid.sort((left, right) => String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')))
    return typeof valid[0]?.path === 'string' ? valid[0].path : undefined
  }
  /**
   * 面板兜底工作区：优先最近更新、且真的存在 dataforge 数据目录的工作区。
   *
   * 只取“最近更新”会把刚有活动的其他项目当成当前工作区，面板于是全空。
   * 这里只在兜底路径使用（客户端正常会带 workspace）；找不到 dataforge 数据时
   * 才退回最新工作区，保持诚实而不是猜。
   */
  const latestDataforgeWorkspacePath = (): string | undefined => {
    const rows = workspaceRegistryService?.list?.()
    if (!Array.isArray(rows) || rows.length === 0) return latestWorkspacePath()
    const valid = rows
      .filter((row) => typeof row?.path === 'string' && row.path !== '')
      .filter((row) => existsSync(join(row.path as string, '.dsh', 'dataforge')))
    if (valid.length === 0) return latestWorkspacePath()
    valid.sort((left, right) => String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')))
    return typeof valid[0]?.path === 'string' ? valid[0].path : latestWorkspacePath()
  }

  const dataforgeDeps: DataforgeDeps = buildDataforgeDeps({
    config,
    resolveJobs: () => jobsService,
    resolveWorkspaceRoot,
  })

  const captureDeps: CaptureDeps = {
    config,
    resolveJobs: () => jobsService,
    store: new CaptureStore(
      join(config.dataRoot, 'capture', 'capture.sqlite'),
      join(config.dataRoot, 'capture', 'samples'),
      join(config.dataRoot, 'capture', 'events.ndjson'),
    ),
    registry: new SessionRegistry({ openCapturingPage, bodyLimit: config.captureBodyLimitBytes }),
    openCapturingPage,
  }

  // Trace 面：只读采集库，给自动编排提供请求/响应序列（S1/S2）。
  const traceDeps: TraceDeps = {
    captureDbPath: join(config.dataRoot, 'capture', 'capture.sqlite'),
    samplesDir: join(config.dataRoot, 'capture', 'samples'),
  }
  const chainDraftDeps: ChainDraftDeps = {
    ...traceDeps,
    resolveWorkspaceRoot,
  }
  const lookupDeps: LookupDeps = {
    dataRoot: config.dataRoot,
    resolveWorkspaceRoot,
    pageReader: createPageLookupReader({ channel: config.captureChromeChannel, timeoutMs: 15_000 }),
  }

  // 名称数据面：三级手工名覆盖（site/page/interface）落 dataRoot/capture/names.yaml；
  // 旧页面补抓复用采集库里的 cookie 重访（无头 Chrome），只回填标题/站点名，不动样本与卡。
  const captureNames = new CaptureNamesStore(join(config.dataRoot, 'capture', 'names.yaml'))
  const titleBackfill = new TitleBackfillService({
    store: captureDeps.store,
    openPage: openCapturingPage,
    channel: config.captureChromeChannel,
  })

  // 编排域：接口库导入 + 链读写（卡与链都落在工作区 .dsh/dataforge/ 下，按 exec 解析工作区）。
  const orchestrationDeps: OrchestrationDeps = {
    captureDbPath: join(config.dataRoot, 'capture', 'capture.sqlite'),
    resolveWorkspaceRoot,
  }

  // R-4 M3：换票结果持久化（0600，按 origin）。关闭后换票只活一次运行。
  const credentialStorePath = config.chainCredentialPersistence
    ? join(config.dataRoot, 'credentials', 'cookies.json')
    : undefined

  // 执行域：运行留痕复用 dataRoot/runs（与流程造数同一套投影），配置走四个执行开关。
  const chainRunDeps: ChainRunToolDeps = {
    ...orchestrationDeps,
    dataRoot: config.dataRoot,
    chain: {
      enabled: config.chainRunEnabled,
      nodeTimeoutSeconds: config.chainNodeTimeoutSeconds,
      concurrency: config.chainConcurrency,
      responseLimitBytes: config.chainResponseLimitBytes,
      // 前台降级时的整链兜底超时：沿用桥进程的同一个开关，不新造一个。
      foregroundTimeoutSeconds: config.timeoutSeconds,
    },
    resolveJobs: () => jobsService,
    // R-4 M1/M3：执行期按卡的来源 captureId 只读采集库注入 cookie / token；
    // 采集库缺席/坏库由 provider 自己降级，不阻断无鉴权链。
    // cache:true = 运行级缓存（按 db/jar 文件签名失效；节点多时少开几百次 SQLite）。
    credentials: createCaptureCredentialProvider({
      dbPath: orchestrationDeps.captureDbPath,
      ...(credentialStorePath === undefined ? {} : { storePath: credentialStorePath }),
      cache: true,
    }),
    ...(credentialStorePath === undefined ? {} : { credentialStorePath }),
  }

  // UI 测试域：两套实现同一 `UiBrowserEngine` 契约的引擎，按配置切换（未来 cdp 引擎同此）。
  //   - playwright：dataforge 自己拉起系统 Chrome（可见窗口录制 / 无头回放；upload 可用）
  //   - shared：dsh-builtin-browser 的 ctx.browser seam（人机同页、可人工接管；upload 不支持）
  // 批量回归固定用 playwright（共享浏览器一次只适合一条，会抢窗口）。
  const uiSessions = new UiRecordingSessions()
  const playwrightEngine: UiBrowserEngine = new PlaywrightBrowserEngine({
    sessions: uiSessions,
    channel: config.captureChromeChannel,
    run: (doc, inputs, options) => runUiScript(
      {
        dataRoot: config.dataRoot,
        channel: config.captureChromeChannel,
        stepTimeoutMs: config.uiStepTimeoutSeconds * 1_000,
        loadCookies: (startUrl) => loadCookiesForStart(uiTestDeps, startUrl),
      },
      {
        doc,
        inputs,
        ...(options?.headless === undefined ? {} : { headless: options.headless }),
        ...(options?.slowMoMs === undefined ? {} : { slowMoMs: options.slowMoMs }),
        ...(options?.highlightClicks === undefined ? {} : { highlightClicks: options.highlightClicks }),
        ...(options?.holdMs === undefined ? {} : { holdMs: options.holdMs }),
      },
    ),
  })
  const sharedEngine: UiBrowserEngine = new SharedBrowserEngine({
    resolveSeam: () => browserService as BrowserSeam | undefined,
    resolveOwner: currentConversationId,
    dataRoot: config.dataRoot,
    stepTimeoutMs: config.uiStepTimeoutSeconds * 1_000,
  })
  /** 按配置选当前引擎；显式选择不可用/未实现时带回退说明（application 会如实报错或降级）。 */
  const resolveUiEngine = (): UiEngineSelection => {
    if (config.uiTestBrowser === 'playwright') return { engine: playwrightEngine }
    if (config.uiTestBrowser === 'shared') {
      return sharedEngine.available()
        ? { engine: sharedEngine }
        : { engine: sharedEngine, degraded: '共享浏览器不可用：安装/启用 dsh-builtin-browser，或把 uiTestBrowser 改为 playwright' }
    }
    if (config.uiTestBrowser === 'cdp') {
      return { engine: playwrightEngine, degraded: 'cdp 引擎尚未实现：已回退 Playwright（实现同一 UiBrowserEngine 契约后在此切换）' }
    }
    return sharedEngine.available()
      ? { engine: sharedEngine }
      : { engine: playwrightEngine }
  }
  // 闭包引用：engines 在 deps 之前构造，loadCookiesForStart 只在运行时读 uiTestDeps。
  let uiTestDeps: UiTestDeps
  uiTestDeps = {
    resolveWorkspaceRoot,
    dataRoot: config.dataRoot,
    enabled: config.uiTestEnabled,
    ...(credentialStorePath === undefined ? {} : { credentialStorePath }),
    resolveEngine: resolveUiEngine,
    batchEngine: playwrightEngine,
  }

  // 链级 verify：主链确认后由 chain_run 调用；UI 回放失败只挂 verify 结果，不改主链终态。
  chainRunDeps.verifyUi = async (request) => {
    const value = await runUiScriptForTool(uiTestDeps, undefined, {
      site: request.site,
      flow: request.flow,
      ...(request.version === undefined ? {} : { version: request.version }),
      inputs: request.inputs,
      confirm: true,
      headless: true,
    })
    const result = value.result
    return {
      ...(result?.runId === undefined ? {} : { runId: result.runId }),
      ...(result === undefined ? {} : { success: result.success }),
      status: value.ok ? (result?.success === true ? 'success' : 'failed') : 'failed',
      ...(result?.screenshot === undefined ? {} : { screenshot: result.screenshot }),
      ...(value.message === undefined ? {} : { message: value.message }),
    }
  }

  // 面板数据面：/dashboard/api/dataforge 只读路由（webServer 惰性注入；服务缺席 → 工具面照常）。
  anyCtx.inject?.(['webServer'], (webSvc) => {
    const effect = webSvc['effect'] as ((fn: () => (() => void) | void, label?: string) => void) | undefined
    const webServer = webSvc['webServer'] as PanelRouteRegistrar | undefined
    if (webServer === undefined || typeof webServer.register !== 'function') {
      logger?.info?.('webServer 服务不可用：采集面板数据路由未注册（工具面照常）')
      return
    }
    const install = (): (() => void) => registerCapturePanelRoutes(webServer, {
      store: captureDeps.store,
      // FR-7.6：面板唯一写入口 = 单页采集；action/爬取只走 agent 会话入口。
      startCapture: (args) => startCapture(captureDeps, args),
      names: captureNames,
      retitle: titleBackfill,
      // 编排子路由：同一前缀下由采集 handler 分派（见 CapturePanelDeps.orchestration 的说明）。
      orchestration: createOrchestrationPanelHandler({
        // 面板请求没有 exec 上下文：优先用有 dataforge 数据的最近工作区；
        // 注册表缺席才回落到宿主 cwd（诚实但可能是 profile 目录）。
        resolveWorkspaceRoot: async () => latestDataforgeWorkspacePath() ?? (await resolveWorkspaceRoot(undefined)) ?? process.cwd(),
        fallbackWorkspaceRoot: async () => latestDataforgeWorkspacePath(),
      }),
      uiTest: createUiTestPanelHandler({
        deps: uiTestDeps,
        resolveWorkspaceRoot: async () => latestDataforgeWorkspacePath() ?? (await resolveWorkspaceRoot(undefined)) ?? process.cwd(),
      }),
      artifacts: createArtifactsPanelHandler({ dataRoot: config.dataRoot }),
    })
    if (typeof effect === 'function') {
      effect(install, `${name}: capture panel routes`)
    } else {
      install()
    }
    logger?.info?.(`采集面板数据路由已注册：${PANEL_API_PREFIX}（runs / cards / page-meta / names / retitle / captures / orchestration）`)
  })

  anyCtx.inject?.(['tools'], (toolsService) => {
    const tools = toolsService['tools'] as { register?: (tool: unknown) => unknown } | undefined
    if (typeof tools?.register !== 'function') {
      logger?.warn?.('tools 服务不可用：dataforge 工具未注册')
      return
    }
    const packRoots: PackRoots = {
      builtinConfigsDir: join(config.engineRoot, 'configs'),
      dataRootFlows: join(config.dataRoot, 'flows'),
      workspaceFlows: undefined, // 运行时按 exec 解析（见 dataforge_deps）
    }
    void packRoots // 流程发现按 exec 需要 workspace 根，因此由工具内动态构建（deps.discover）
    for (const tool of [
      defineFlowsTool(dataforgeDeps),
      defineRunTool(dataforgeDeps),
      defineStatusTool(dataforgeDeps),
      defineCaptureTool(captureDeps),
      defineCaptureStatusTool(captureDeps),
      defineCaptureResultTool(captureDeps),
      defineCaptureCancelTool(captureDeps),
      defineTraceGetTool(traceDeps),
      defineTraceAnalyzeTool(traceDeps),
      defineChainDraftTool(chainDraftDeps),
      defineLookupTool(lookupDeps),
      defineDatasetExportTool(config.dataRoot),
      defineBrowserOpenTool(captureDeps),
      defineBrowserActTool(captureDeps),
      defineBrowserSnapshotTool(captureDeps),
      defineBrowserCloseTool(captureDeps),
      defineLibraryImportTool(orchestrationDeps),
      defineChainUpsertTool(orchestrationDeps),
      defineChainGetTool(orchestrationDeps),
      defineChainBindTool(orchestrationDeps),
      defineChainRunTool(chainRunDeps),
      defineChainRunsTool(chainRunDeps),
      defineChainProbeTool(chainRunDeps),
      defineChainCrystalTool(chainRunDeps),
      defineChainDiagnoseTool(chainRunDeps),
      defineChainCompareTool(chainRunDeps),
      defineUiScriptGetTool(uiTestDeps),
      defineUiScriptUpsertTool(uiTestDeps),
      defineUiRecordOpenTool(uiTestDeps),
      defineUiRecordStartTool(uiTestDeps),
      defineUiRecordStopTool(uiTestDeps),
      defineUiRecordCloseTool(uiTestDeps),
      defineUiRunTool(uiTestDeps),
      defineUiRunsTool(uiTestDeps),
      defineUiBatchRunTool(uiTestDeps),
    ]) {
      tools.register(tool)
    }
    logger?.info?.(`已注册 35 个工具：flows/run/status + capture/status/result/cancel + trace_get/trace_analyze/chain_draft/lookup/dataset_export + browser_open/act/snapshot/close`
      + ` + library_import/chain_upsert/chain_get/chain_bind/chain_run/chain_runs/chain_probe/chain_crystallize/chain_diagnose/chain_compare`
      + ` + ui_script_get/ui_script_upsert/ui_record_open/ui_record_start/ui_record_stop/ui_record_close/ui_run/ui_runs/ui_batch_run（引擎：${config.engineRoot}；数据根：${config.dataRoot}）`)
    if (!config.uiTestEnabled) logger?.info?.('UI 回放开关 uiTestEnabled=false：dataforge_ui_run 一律 ui-test-disabled')
    const selected = resolveUiEngine()
    logger?.info?.(`UI 测试浏览器引擎：${selected.engine.label}${selected.degraded === undefined ? '' : `（${selected.degraded}）`}`
      + `；共享浏览器${sharedEngine.available() ? '已就绪' : '未启用（安装/启用 dsh-builtin-browser 可切换）'}；批量回归固定 Playwright 无头`)
    if (!config.chainRunEnabled) logger?.info?.('执行开关 chainRunEnabled=false：dataforge_chain_run 一律 execution-disabled')
  })

  // 常驻策略段：工具自述只在「打算调工具」时被读到，三道闸纪律得每轮在场。
  if (config.injectPolicy) {
    try {
      const policy = loadPolicyText(config.engineRoot)
      const combined = `${policy.text}\n\n${CAPTURE_POLICY}\n\n${TRACE_POLICY}\n\n${EXPLORE_POLICY}\n\n${UI_TEST_POLICY}`
      const sectionName = 'tool:dataforge'
      anyCtx.systemPrompt?.section?.({
        name: sectionName,
        order: anyCtx.systemPrompt?.getSectionOrder?.('TOOL_GOAL'),
        text: combined,
      })
      logger?.info?.(`策略段 ${sectionName} 已注入（来源 ${policy.source}）`)
    } catch (err) {
      logger?.warn?.(`策略段注入失败（工具面照常）：${String((err as Error)?.message ?? err)}`)
    }
  }
}

export { discoverFlows } from './flows/discover.js'
export { foldSummary, loadRunEvents } from './runs/store.js'
