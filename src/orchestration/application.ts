/**
 * 编排域的应用层：把 IF-1/2/3 的判定与错误折叠收在一处，工具壳（`src/tools.ts`）
 * 只做参数声明与回执渲染。
 *
 * 为什么单独一层而不是塞进工具壳：`src/tools.ts` 的自述纪律是"判定全在 application 层"。
 * 这三个工具的判定不是三道闸那种业务规则，而是「错误码 → 诚实回执」的折叠——
 * 但它同样需要被单测直接打到（不经过 defineTool 的 schema 校验），所以放这里。
 *
 * @module dsh-dataforge/orchestration/application
 */

import { importLibrary, type LibraryError } from '../library/import.js'
import { saveChain } from '../chains/store.js'
import { loadChain, readChainText, listChainVersions } from '../chains/store.js'
import type { ChainIssue } from '../chains/schema.js'

export type OrchestrationDeps = {
  /** 采集库 SQLite 路径（导入侧只读打开，绝不建表/写事件）。 */
  captureDbPath: string
  /** 工作区根解析：与流程发现同一套（session cwd → process.cwd()）。 */
  resolveWorkspaceRoot: (exec: unknown) => Promise<string | undefined>
}

/** 逐条问题时给模型看的行：`nodes[0]: reason`。 */
function issueLines(issues: ChainIssue[]): string[] {
  return issues.map((issue) => `${issue.target}：${issue.reason}`)
}

function toChainIssues(issues: ChainIssue[]): Array<{ target: string; code: string; reason: string }> {
  return issues.map((issue) => ({ target: issue.target, code: issue.code, reason: issue.reason }))
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isLibraryError(error: unknown): error is LibraryError {
  return error instanceof Error && typeof (error as { code?: unknown }).code === 'string' && Array.isArray((error as { hints?: unknown }).hints)
}

// ────────────────────────────────────────────────
// IF-1 dataforge_library_import
// ────────────────────────────────────────────────

export type ImportLibraryToolValue = {
  ok: boolean
  /** 失败码：no-capture-data / capture-unreadable / library-unavailable。 */
  code?: string
  message?: string
  hints?: string[]
  imported?: number
  merged?: number
  unchanged?: number
  skipped?: number
  /** 本次触达的卡 ID（升序）。 */
  cardIds?: string[]
  /** 逐张坏卡的中文原因。 */
  skippedReasons?: string[]
  captures?: string[]
  libraryRoot?: string
}

export type ImportLibraryToolArgs = { captureId?: string }

/**
 * 导入接口库。失败一律折成回执（**不抛**）：无采集数据是常态空态，agent 该据此
 * 引导用户去采集，而不是拿到一个异常。
 */
export async function importLibraryForTool(
  deps: OrchestrationDeps,
  exec: unknown,
  args: ImportLibraryToolArgs,
): Promise<ImportLibraryToolValue> {
  let workspaceRoot: string
  try {
    workspaceRoot = (await deps.resolveWorkspaceRoot(exec)) ?? process.cwd()
  } catch (error) {
    return { ok: false, code: 'library-unavailable', message: `解析工作区根失败：${messageOf(error)}`, hints: [] }
  }
  try {
    const result = importLibrary({
      workspaceRoot,
      captureDbPath: deps.captureDbPath,
      ...(args.captureId === undefined ? {} : { captureId: args.captureId }),
    })
    return {
      ok: true,
      imported: result.imported,
      merged: result.merged,
      unchanged: result.unchanged,
      skipped: result.skipped,
      cardIds: result.cardIds,
      skippedReasons: result.skippedDetails.map((item) => `${item.mergeKey}：${item.reason}`),
      captures: result.captureIds,
      libraryRoot: result.libraryRoot,
    }
  } catch (error) {
    if (isLibraryError(error)) {
      return { ok: false, code: error.code, message: error.message, hints: error.hints }
    }
    return { ok: false, code: 'library-unavailable', message: `导入接口库失败：${messageOf(error)}`, hints: [] }
  }
}

// ────────────────────────────────────────────────
// IF-2 dataforge_chain_upsert
// ────────────────────────────────────────────────

export type ChainUpsertToolValue = {
  ok: boolean
  code?: string
  message?: string
  version?: number
  path?: string
  /** 校验不过时逐条问题（指向 nodes[i] / edges[j]）。 */
  issues?: Array<{ target: string; code: string; reason: string }>
  /** 通过但值得提醒（例如常量里疑似凭证）。 */
  warnings?: string[]
}

export type ChainUpsertToolArgs = { site: string; flow: string; chainYaml: string }

/** 唯一的链写入口：先 schema、再语义校验，全过才落盘为新版本（不存在部分写入）。 */
export async function upsertChainForTool(
  deps: OrchestrationDeps,
  exec: unknown,
  args: ChainUpsertToolArgs,
): Promise<ChainUpsertToolValue> {
  const workspaceRoot = (await deps.resolveWorkspaceRoot(exec)) ?? process.cwd()
  if (args.site.trim() === '' || args.flow.trim() === '') {
    return { ok: false, code: 'invalid-chain', message: 'site 与 flow 不能为空：链按「站点 / 流程」归档' }
  }
  try {
    // 来源标注由写入方声明：这是 agent 会话保存的版本（画布保存走面板路由，标 canvas）。
    const saved = saveChain(workspaceRoot, args.chainYaml, { source: 'agent' })
    if (!saved.ok) {
      return {
        ok: false,
        code: saved.issues.some((issue) => issue.code === 'card-not-imported') ? 'card-not-imported' : 'invalid-chain',
        message: saved.issues.some((issue) => issue.code === 'card-not-imported')
          ? '链引用的接口卡不在项目接口库：先跑 dataforge_library_import'
          : `链未通过校验（${saved.issues.length} 条）：修好再提交，没有落盘`,
        issues: toChainIssues(saved.issues),
      }
    }
    return {
      ok: true,
      version: saved.version,
      path: saved.path,
      ...(saved.warnings.length === 0 ? {} : { warnings: issueLines(saved.warnings) }),
    }
  } catch (error) {
    return { ok: false, code: 'invalid-chain', message: `落盘链失败：${messageOf(error)}` }
  }
}

// ────────────────────────────────────────────────
// IF-3 dataforge_chain_get
// ────────────────────────────────────────────────

export type ChainGetToolValue = {
  ok: boolean
  code?: string
  message?: string
  /** 链 YAML 全文：导出即原文，天然零凭证。 */
  chainYaml?: string
  version?: number
  path?: string
  /** 可用版本（升序）：chain-not-found 时调用方据此重试或放弃。 */
  versions?: number[]
  issues?: Array<{ target: string; code: string; reason: string }>
}

export type ChainGetToolArgs = { site: string; flow: string; version?: number; export?: boolean }

/**
 * 读链。`export: true` 走原文读取（不校验，坏文件也照原样导出，便于人工抢救）；
 * 缺省走校验读取——文件被手改坏就如实报 invalid-chain 并提示可回读旧版本。
 */
export async function getChainForTool(
  deps: OrchestrationDeps,
  exec: unknown,
  args: ChainGetToolArgs,
): Promise<ChainGetToolValue> {
  const workspaceRoot = (await deps.resolveWorkspaceRoot(exec)) ?? process.cwd()
  if (args.export === true) {
    const found = readChainText(workspaceRoot, args.site, args.flow, args.version)
    if (found === undefined) {
      return {
        ok: false,
        code: 'chain-not-found',
        message: `没有找到 ${args.site} / ${args.flow} 的链${args.version === undefined ? '' : ` v${args.version}`}`,
        versions: listChainVersions(workspaceRoot, args.site, args.flow),
      }
    }
    return { ok: true, chainYaml: found.text, version: found.version, path: found.path }
  }

  const loaded = loadChain(workspaceRoot, args.site, args.flow, {
    ...(args.version === undefined ? {} : { version: args.version }),
  })
  if (!loaded.ok) {
    return {
      ok: false,
      code: loaded.code,
      message: loaded.message,
      versions: loaded.availableVersions,
      ...('issues' in loaded && loaded.issues !== undefined ? { issues: toChainIssues(loaded.issues) } : {}),
      ...('path' in loaded && loaded.path !== undefined ? { path: loaded.path } : {}),
    }
  }
  return {
    ok: true,
    chainYaml: loaded.text,
    version: loaded.version,
    path: loaded.path,
    versions: listChainVersions(workspaceRoot, args.site, args.flow),
  }
}
