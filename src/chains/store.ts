/**
 * 链文件存取：版本快照、回读、导出。
 *
 * 落点（项目资产，进 git、可手改）：
 *   <workspaceRoot>/.dsh/dataforge/chains/<siteSlug>/<flowSlug>/v<n>.yaml
 *
 * 纪律：
 *   - 一个版本一个文件，**版本即不可变快照**：写入永远分配 max+1，不覆盖旧版本、不删旧版本；
 *   - 写入前先校验（schema + 语义），全过才落盘——不存在"部分写入"；
 *   - 读时重新校验（文件可能被手改坏），坏文件如实报 `invalid-chain` 并列出可用版本；
 *   - 落盘 IO 失败原样上抛（沿用插件纪律）。
 *
 * 卡解析器默认读 `.dsh/dataforge/library/cards/<cardId>.yaml`——只认卡 ID 到文件名的
 * 直映射，**不 import `src/library/**`**（那条线归 library 模块，链侧只做结构性读取）。
 *
 * @module dsh-dataforge/chains/store
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CardResolver, ChainDoc, ChainIssue, InterfaceCardDoc } from './schema.js'
import { chainToYaml, loadYamlValue, parseCardDoc } from './schema.js'
import type { ValidateOptions } from './validate.js'
import { scanCredentialConstants, validateChain, validateChainYaml } from './validate.js'

/** 工作区里的项目资产根：`.dsh/dataforge`。 */
export function dataforgeRoot(workspaceRoot: string): string {
  return join(workspaceRoot, '.dsh', 'dataforge')
}

/** 链根目录：`.dsh/dataforge/chains`。 */
export function chainsRoot(workspaceRoot: string): string {
  return join(dataforgeRoot(workspaceRoot), 'chains')
}

/** 接口库卡目录：`.dsh/dataforge/library/cards`。 */
export function cardsRoot(workspaceRoot: string): string {
  return join(dataforgeRoot(workspaceRoot), 'library', 'cards')
}

/** 名字 → 目录名（保留中日韩字符，其余分隔符折叠成 '-'）。 */
export function slugOf(name: string): string {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
}

function requireSlug(name: string, what: string): string {
  const slug = slugOf(name)
  if (slug.length === 0) {
    throw Object.assign(
      new Error(`${what} "${String(name)}" 不能作为目录名（为空或只含路径分隔符）`) as Error & { code: string },
      { code: 'invalid-chain' },
    )
  }
  return slug
}

/** 链版本目录：`chains/<siteSlug>/<flowSlug>`。 */
export function chainDir(workspaceRoot: string, site: string, flow: string): string {
  return join(chainsRoot(workspaceRoot), requireSlug(site, 'site'), requireSlug(flow, 'flow'))
}

/** 单个版本文件路径：`.../v<n>.yaml`。 */
export function chainFilePath(workspaceRoot: string, site: string, flow: string, version: number): string {
  return join(chainDir(workspaceRoot, site, flow), `v${version}.yaml`)
}

/** 已有版本号（升序）；目录不存在返回空数组。 */
export function listChainVersions(workspaceRoot: string, site: string, flow: string): number[] {
  const dir = chainDir(workspaceRoot, site, flow)
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
export function latestChainVersion(workspaceRoot: string, site: string, flow: string): number | undefined {
  const versions = listChainVersions(workspaceRoot, site, flow)
  return versions.length > 0 ? versions[versions.length - 1] : undefined
}

/** 下一个版本号 = max+1（没有历史则 1）。 */
export function nextChainVersion(workspaceRoot: string, site: string, flow: string): number {
  return (latestChainVersion(workspaceRoot, site, flow) ?? 0) + 1
}

export type ChainRef = {
  /** 目录名（slug 形态；原始名字以文件里的 meta.site / meta.flow 为准）。 */
  site: string
  flow: string
  versions: number[]
  latest?: number
}

/** 列工作区里所有链（两层目录扫描；坏 slug 的目录跳过）。 */
export function listChains(workspaceRoot: string): ChainRef[] {
  const root = chainsRoot(workspaceRoot)
  if (!existsSync(root)) return []
  const result: ChainRef[] = []
  for (const site of safeDirs(root)) {
    for (const flow of safeDirs(join(root, site))) {
      let versions: number[] = []
      try {
        versions = listChainVersions(workspaceRoot, site, flow)
      } catch {
        continue
      }
      if (versions.length === 0) continue
      result.push({ site, flow, versions, latest: versions[versions.length - 1] })
    }
  }
  return result
}

function safeDirs(dir: string): string[] {
  try {
    return readdirSync(dir).filter((entry) => {
      try {
        return statSync(join(dir, entry)).isDirectory()
      } catch {
        return false
      }
    })
  } catch {
    return []
  }
}

/* ------------------------------------------------------------------ 读取 */

export type ChainLoadResult =
  | {
      ok: true
      doc: ChainDoc
      /** 文件原文——`export: true` 时它就是导出物（链天然零凭证）。 */
      text: string
      path: string
      version: number
      /** 非阻断提示（如常量里疑似凭证的键）。 */
      warnings: ChainIssue[]
    }
  | { ok: false; code: 'chain-not-found'; message: string; availableVersions: number[] }
  | {
      ok: false
      code: 'invalid-chain'
      message: string
      issues: ChainIssue[]
      path: string
      availableVersions: number[]
    }

export type ChainReadOptions = Partial<ValidateOptions> & {
  /** 缺省最新版本。 */
  version?: number
}

/** 读某个版本（缺省最新）；文件被手改坏也如实报 invalid-chain。 */
export function loadChain(
  workspaceRoot: string,
  site: string,
  flow: string,
  options: ChainReadOptions = {},
): ChainLoadResult {
  const availableVersions = listChainVersions(workspaceRoot, site, flow)
  const version = options.version ?? availableVersions[availableVersions.length - 1]
  if (version === undefined || !availableVersions.includes(version)) {
    return {
      ok: false,
      code: 'chain-not-found',
      message:
        version === undefined
          ? `没有找到 ${site} / ${flow} 的任何链版本`
          : `${site} / ${flow} 没有 v${version}`,
      availableVersions,
    }
  }
  const path = chainFilePath(workspaceRoot, site, flow, version)
  const text = readFileSync(path, 'utf8')
  const parsed = validateChainYaml(text, {
    resolveCard: options.resolveCard ?? defaultCardResolver(workspaceRoot),
  })
  if (!parsed.ok) {
    return {
      ok: false,
      code: 'invalid-chain',
      message: `${path} 未通过校验（可能被手改坏）：可回读旧版本或修好再试`,
      issues: parsed.issues,
      path,
      availableVersions,
    }
  }
  return {
    ok: true,
    doc: parsed.doc,
    text,
    path,
    version,
    warnings: scanCredentialConstants(parsed.doc),
  }
}

/** 原文读取（不校验）：导出用，坏文件也照原样给出。 */
export function readChainText(
  workspaceRoot: string,
  site: string,
  flow: string,
  version?: number,
): { text: string; path: string; version: number } | undefined {
  const versions = listChainVersions(workspaceRoot, site, flow)
  const target = version ?? versions[versions.length - 1]
  if (target === undefined || !versions.includes(target)) return undefined
  const path = chainFilePath(workspaceRoot, site, flow, target)
  return { text: readFileSync(path, 'utf8'), path, version: target }
}

/* ------------------------------------------------------------------ 写入 */

export type ChainSaveResult =
  | { ok: true; version: number; path: string; doc: ChainDoc; warnings: ChainIssue[] }
  | { ok: false; issues: ChainIssue[] }

/**
 * 落盘为**新版本**（version 取 max+1，输入里的 meta.version 会被覆盖成实际版本号）。
 *
 * `input` 可以是已解析的 ChainDoc（画布/编译草稿确认后）或链 YAML 文本（agent 手写）。
 * 校验不过一律不落盘，把 issues 原样给回去。
 */
export function saveChain(
  workspaceRoot: string,
  input: ChainDoc | string,
  options: Partial<ValidateOptions> = {},
): ChainSaveResult {
  const resolveCard = options.resolveCard ?? defaultCardResolver(workspaceRoot)
  const parsed = typeof input === 'string' ? validateChainYaml(input, { resolveCard }) : validateChain(input, { resolveCard })
  if (!parsed.ok) return { ok: false, issues: parsed.issues }

  const { doc } = parsed
  const version = nextChainVersion(workspaceRoot, doc.meta.site, doc.meta.flow)
  const created = isIsoInstant(doc.meta.created) ? doc.meta.created : new Date().toISOString()
  const finalDoc: ChainDoc = { ...doc, meta: { ...doc.meta, version, created } }

  const dir = chainDir(workspaceRoot, finalDoc.meta.site, finalDoc.meta.flow)
  mkdirSync(dir, { recursive: true })
  const path = chainFilePath(workspaceRoot, finalDoc.meta.site, finalDoc.meta.flow, version)
  writeFileSync(path, chainToYaml(finalDoc), 'utf8')

  return { ok: true, version, path, doc: finalDoc, warnings: scanCredentialConstants(finalDoc) }
}

function isIsoInstant(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0) return false
  return !Number.isNaN(Date.parse(value))
}

/* -------------------------------------------------------------- 卡引用读取 */

/** 读一张卡（`library/cards/<cardId>.yaml|yml`）；不存在/坏文件返回 undefined。 */
export function readCard(workspaceRoot: string, cardId: string): InterfaceCardDoc | undefined {
  if (!/^[A-Za-z0-9._-]+$/.test(cardId)) return undefined
  const dir = cardsRoot(workspaceRoot)
  for (const name of [`${cardId}.yaml`, `${cardId}.yml`]) {
    const path = join(dir, name)
    if (!existsSync(path)) continue
    try {
      const parsed = loadYamlValue(readFileSync(path, 'utf8'))
      const card = parseCardDoc(parsed)
      if (card) return card
    } catch {
      return undefined
    }
  }
  return undefined
}

/**
 * 默认卡解析器：按 cardId 直读接口库，单次校验内缓存（同一张卡不被读多次）。
 * 集成侧若已有 library 模块，可改用它的 reader 注入（结构契约见 InterfaceCardDoc）。
 */
export function defaultCardResolver(workspaceRoot: string): CardResolver {
  const cache = new Map<string, InterfaceCardDoc | undefined>()
  return (cardId: string) => {
    if (cache.has(cardId)) return cache.get(cardId)
    const card = readCard(workspaceRoot, cardId)
    cache.set(cardId, card)
    return card
  }
}
