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
import { readFileSync } from 'node:fs'
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
} from './tools.js'
import type { ChainRunToolDeps, OrchestrationDeps } from './orchestration/application.js'
import { openCapturingPage } from './capture/browser.js'
import { CaptureStore } from './capture/store.js'
import { createCaptureCredentialProvider } from './capture/credentials.js'
import { startCapture } from './capture/application.js'
import { PANEL_API_PREFIX, registerCapturePanelRoutes, type PanelRouteRegistrar } from './capture/panel-routes.js'
import { createOrchestrationPanelHandler } from './orchestration/panel-routes.js'
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
      // 编排子路由：同一前缀下由采集 handler 分派（见 CapturePanelDeps.orchestration 的说明）。
      orchestration: createOrchestrationPanelHandler({
        // 面板请求没有 exec 上下文：以注册时的工作区为准（面板本就属于当前工作区）。
        resolveWorkspaceRoot: async () => (await resolveWorkspaceRoot(undefined)) ?? process.cwd(),
      }),
    })
    if (typeof effect === 'function') {
      effect(install, `${name}: capture panel routes`)
    } else {
      install()
    }
    logger?.info?.(`采集面板数据路由已注册：${PANEL_API_PREFIX}（runs / cards / captures / orchestration）`)
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
    ]) {
      tools.register(tool)
    }
    logger?.info?.(`已注册 21 个工具：flows/run/status + capture/status/result/cancel + browser_open/act/snapshot/close`
      + ` + library_import/chain_upsert/chain_get/chain_bind/chain_run/chain_runs/chain_probe/chain_crystallize/chain_diagnose/chain_compare（引擎：${config.engineRoot}；数据根：${config.dataRoot}）`)
    if (!config.chainRunEnabled) logger?.info?.('执行开关 chainRunEnabled=false：dataforge_chain_run 一律 execution-disabled')
  })

  // 常驻策略段：工具自述只在「打算调工具」时被读到，三道闸纪律得每轮在场。
  if (config.injectPolicy) {
    try {
      const policy = loadPolicyText(config.engineRoot)
      const combined = `${policy.text}\n\n${CAPTURE_POLICY}\n\n${EXPLORE_POLICY}`
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
