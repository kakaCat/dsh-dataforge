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
import { defineFlowsTool, defineRunTool, defineStatusTool } from './tools.js'
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
    ]) {
      tools.register(tool)
    }
    logger?.info?.(`已注册 3 个工具：dataforge_flows / dataforge_run / dataforge_status`
      + `（引擎：${config.engineRoot}；数据根：${config.dataRoot}）`)
  })

  // 常驻策略段：工具自述只在「打算调工具」时被读到，三道闸纪律得每轮在场。
  if (config.injectPolicy) {
    try {
      const policy = loadPolicyText(config.engineRoot)
      const sectionName = 'tool:dataforge'
      anyCtx.systemPrompt?.section?.({
        name: sectionName,
        order: anyCtx.systemPrompt?.getSectionOrder?.('TOOL_GOAL'),
        text: policy.text,
      })
      logger?.info?.(`策略段 ${sectionName} 已注入（来源 ${policy.source}）`)
    } catch (err) {
      logger?.warn?.(`策略段注入失败（工具面照常）：${String((err as Error)?.message ?? err)}`)
    }
  }
}

export { discoverFlows } from './flows/discover.js'
export { foldSummary, loadRunEvents } from './runs/store.js'
