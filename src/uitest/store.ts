/**
 * ui-script 存取：版本快照、回读、列表。
 *
 * 落点（项目资产，进 git、可手改）：
 *   <workspaceRoot>/.dsh/dataforge/ui-tests/<siteSlug>/<flowSlug>/v<n>.yaml
 *
 * 纪律与链完全一致：
 *   - 一个版本一个文件，**版本即不可变快照**：写入永远分配 max+1，不覆盖旧版本；
 *   - 写入前先校验（形状 + 入参引用），全过才落盘——不存在"部分写入"；
 *   - 读时重新校验（文件可能被手改坏），坏文件如实报 `invalid-ui-script` 并列出可用版本；
 *   - 路径参数一律经 slug 校验，不把用户输入直接拼进文件路径。
 *
 * 与链的差异：ui-script 没有跨文件引用（不解析接口卡），所以没有 CardResolver 这类注入缝。
 *
 * @module dsh-dataforge/uitest/store
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataforgeRoot, slugOf } from '../chains/store.js'
import {
  parseUiScriptDoc, parseUiScriptYaml, uiScriptToYaml,
  type UiIssue, type UiScriptDoc, type UiScriptMeta, type UiScriptSource,
} from './schema.js'

/** ui-script 根目录：`.dsh/dataforge/ui-tests`。 */
export function uiTestsRoot(workspaceRoot: string): string {
  return join(dataforgeRoot(workspaceRoot), 'ui-tests')
}

function requireSlug(name: string, what: string): string {
  const slug = slugOf(name)
  if (slug.length === 0) {
    throw Object.assign(
      new Error(`${what} "${String(name)}" 不能作为目录名（为空或只含路径分隔符）`) as Error & { code: string },
      { code: 'invalid-ui-script' },
    )
  }
  return slug
}

/** 流程版本目录：`ui-tests/<siteSlug>/<flowSlug>`。 */
export function uiScriptDir(workspaceRoot: string, site: string, flow: string): string {
  return join(uiTestsRoot(workspaceRoot), requireSlug(site, 'site'), requireSlug(flow, 'flow'))
}

/** 单个版本文件路径：`.../v<n>.yaml`。 */
export function uiScriptPath(workspaceRoot: string, site: string, flow: string, version: number): string {
  return join(uiScriptDir(workspaceRoot, site, flow), `v${version}.yaml`)
}

/** 已有版本号（升序）；目录不存在返回空数组。 */
export function listUiScriptVersions(workspaceRoot: string, site: string, flow: string): number[] {
  const dir = uiScriptDir(workspaceRoot, site, flow)
  if (!existsSync(dir)) return []
  const versions: number[] = []
  for (const entry of readdirSync(dir)) {
    const hit = /^v(\d+)\.ya?ml$/.exec(entry)
    if (!hit) continue
    const version = Number(hit[1])
    if (Number.isInteger(version) && version >= 1) versions.push(version)
  }
  return versions.sort((left, right) => left - right)
}

/** 最新版本号；没有任何版本返回 undefined。 */
export function latestUiScriptVersion(workspaceRoot: string, site: string, flow: string): number | undefined {
  const versions = listUiScriptVersions(workspaceRoot, site, flow)
  return versions.length > 0 ? versions[versions.length - 1] : undefined
}

/** 下一个版本号 = max+1（没有历史则 1）。 */
export function nextUiScriptVersion(workspaceRoot: string, site: string, flow: string): number {
  return (latestUiScriptVersion(workspaceRoot, site, flow) ?? 0) + 1
}

/** 流程的版本文件头摘要（列表用；坏文件不抛，带 unreadable）。 */
export type UiVersionInfo = {
  version: number
  created?: string
  source?: UiScriptSource
  stepCount?: number
  startUrl?: string
  note?: string
  unreadable?: string
}

/** 一个流程（site + flow）及其版本。 */
export type UiScriptRef = {
  site: string
  flow: string
  latest: number
  versions: number[]
  domain?: string
  updatedAt?: string
  unreadable?: string
}

function dirOfSite(root: string): string[] {
  if (!existsSync(root)) return []
  try {
    return readdirSync(root).filter((entry) => {
      try {
        return statSync(join(root, entry)).isDirectory()
      } catch {
        return false
      }
    })
  } catch {
    return []
  }
}

/** 逐版本读文件头：面板要显示「v3 · 3 步 · 更新时间」。 */
export function listUiVersionInfos(workspaceRoot: string, site: string, flow: string): UiVersionInfo[] {
  return listUiScriptVersions(workspaceRoot, site, flow).map((version) => {
    try {
      const doc = parseUiScriptYaml(readFileSync(uiScriptPath(workspaceRoot, site, flow, version), 'utf8'))
      if (!doc.ok) {
        return { version, unreadable: doc.issues.map((item) => `${item.target}：${item.reason}`).join('；') }
      }
      return {
        version,
        created: doc.doc.meta.created,
        ...(doc.doc.meta.source === undefined ? {} : { source: doc.doc.meta.source }),
        stepCount: doc.doc.steps.length,
        startUrl: doc.doc.meta.startUrl,
        ...(doc.doc.meta.note === undefined ? {} : { note: doc.doc.meta.note }),
      }
    } catch (error) {
      return { version, unreadable: String((error as Error)?.message ?? error) }
    }
  })
}

/** 列全部流程（面板一级/二级列表用；坏目录跳过）。 */
export function listUiScripts(workspaceRoot: string): UiScriptRef[] {
  const root = uiTestsRoot(workspaceRoot)
  const refs: UiScriptRef[] = []
  for (const site of dirOfSite(root)) {
    for (const flow of dirOfSite(join(root, site))) {
      let versions: number[] = []
      try {
        versions = listUiScriptVersions(workspaceRoot, site, flow)
      } catch {
        continue
      }
      if (versions.length === 0) continue
      const latest = versions[versions.length - 1]
      let domain: string | undefined
      let unreadable: string | undefined
      let updatedAt: string | undefined
      try {
        const doc = parseUiScriptYaml(readFileSync(uiScriptPath(workspaceRoot, site, flow, latest), 'utf8'))
        if (doc.ok) {
          domain = doc.doc.meta.domain
          updatedAt = doc.doc.meta.created
        } else {
          unreadable = doc.issues.map((item) => `${item.target}：${item.reason}`).join('；')
        }
      } catch (error) {
        unreadable = String((error as Error)?.message ?? error)
      }
      refs.push({
        site,
        flow,
        latest,
        versions,
        ...(domain === undefined ? {} : { domain }),
        ...(updatedAt === undefined ? {} : { updatedAt }),
        ...(unreadable === undefined ? {} : { unreadable }),
      })
    }
  }
  return refs.sort((left, right) => `${left.site}/${left.flow}`.localeCompare(`${right.site}/${right.flow}`))
}

/** 单版本回读结果。 */
export type UiScriptLoadResult =
  | {
    ok: true
    doc: UiScriptDoc
    yaml: string
    path: string
    version: number
    availableVersions: number[]
  }
  | {
    ok: false
    code: 'ui-script-not-found' | 'invalid-ui-script'
    message: string
    issues?: UiIssue[]
    availableVersions: number[]
  }

/** 读一个版本（缺省最新）；文件坏了不静默，返回 issues + 可用版本。 */
export function loadUiScript(
  workspaceRoot: string,
  site: string,
  flow: string,
  version?: number,
): UiScriptLoadResult {
  const availableVersions = listUiScriptVersions(workspaceRoot, site, flow)
  const target = version ?? availableVersions[availableVersions.length - 1]
  if (target === undefined || !availableVersions.includes(target)) {
    return {
      ok: false,
      code: 'ui-script-not-found',
      message: target === undefined
        ? `没有找到 ${site} / ${flow} 的任何 UI 脚本版本`
        : `${site} / ${flow} 没有 v${target}`,
      availableVersions,
    }
  }
  const path = uiScriptPath(workspaceRoot, site, flow, target)
  const text = readFileSync(path, 'utf8')
  const parsed = parseUiScriptYaml(text)
  if (!parsed.ok) {
    return {
      ok: false,
      code: 'invalid-ui-script',
      message: `${path} 未通过校验（可能被手改坏）：可回读旧版本或修好再试`,
      issues: parsed.issues,
      availableVersions,
    }
  }
  return { ok: true, doc: parsed.doc, yaml: text, path, version: target, availableVersions }
}

/** 写一个版本 → YAML 文本 + 路径（不落盘；落盘由调用方决定，测试用）。 */
export function renderUiScript(doc: UiScriptDoc): string {
  return uiScriptToYaml(doc)
}

/** 落盘结果。 */
export type UiScriptSaveResult =
  | { ok: true; version: number; path: string; doc: UiScriptDoc }
  | { ok: false; issues: UiIssue[] }

/**
 * 落盘为**新版本**（version 取 max+1，输入里的 meta.version 会被覆盖成实际版本号）。
 *
 * `input` 可以是已解析的 UiScriptDoc，也可以是 YAML 文本（agent 手写/面板导入）。
 * 校验不过一律不落盘。`source` 由调用方声明（record/agent/canvas），不猜。
 */
export function saveUiScript(
  workspaceRoot: string,
  input: UiScriptDoc | string,
  options: { source?: UiScriptSource } = {},
): UiScriptSaveResult {
  const parsed = typeof input === 'string' ? parseUiScriptYaml(input) : parseUiScriptDoc(input)
  if (!parsed.ok) return { ok: false, issues: parsed.issues }

  const doc = parsed.doc
  const version = nextUiScriptVersion(workspaceRoot, doc.meta.site, doc.meta.flow)
  const meta: UiScriptMeta = {
    ...doc.meta,
    version,
    // created 来源：录制/agent 给的时刻保留（ISO 字符串），非法或缺省就用当前时刻。
    created: isValidInstant(doc.meta.created) ? doc.meta.created : new Date().toISOString(),
    ...(options.source === undefined ? {} : { source: options.source }),
  }
  const finalDoc: UiScriptDoc = { ...doc, meta }
  const path = uiScriptPath(workspaceRoot, meta.site, meta.flow, version)
  mkdirSync(uiScriptDir(workspaceRoot, meta.site, meta.flow), { recursive: true })
  writeFileSync(path, uiScriptToYaml(finalDoc), 'utf8')
  return { ok: true, version, path, doc: finalDoc }
}

function isValidInstant(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0) return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed)
}
