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
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CardResolver, ChainDoc, ChainIssue, ChainKind, ChainSource, InterfaceCardDoc } from './schema.js'
import { chainToYaml, loadYamlValue, parseCardDoc, parseChainYaml } from './schema.js'
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

/** 单个版本的文件头摘要（编排页的版本列表用；坏文件不抛，带 unreadable）。 */
export type ChainVersionInfo = {
  version: number
  created?: string
  source?: ChainSource
  domain?: string
  note?: string
  nodeCount?: number
  edgeCount?: number
  unreadable?: string
}

/**
 * 逐版本读文件头。编排页要显示「v3 · 当前 / v2 已被 v3 取代 / 来源 / 更新时间」，
 * 这些只有打开每个版本文件才知道；文件坏了照常给出行，只是带 unreadable。
 */
export function listChainVersionInfos(workspaceRoot: string, site: string, flow: string): ChainVersionInfo[] {
  return listChainVersions(workspaceRoot, site, flow).map((version) => {
    try {
      const doc = parseChainYaml(readFileSync(chainFilePath(workspaceRoot, site, flow, version), 'utf8'))
      if (!doc.ok) {
        return { version, unreadable: doc.issues.map((issue) => `${issue.target}：${issue.reason}`).join('；') }
      }
      const { meta, nodes, edges } = doc.doc
      return {
        version,
        ...(meta.created === undefined ? {} : { created: meta.created }),
        ...(meta.source === undefined ? {} : { source: meta.source }),
        ...(meta.domain === undefined ? {} : { domain: meta.domain }),
        ...(meta.note === undefined ? {} : { note: meta.note }),
        nodeCount: nodes.length,
        edgeCount: edges.length,
      }
    } catch (error) {
      return { version, unreadable: `读取失败：${error instanceof Error ? error.message : String(error)}` }
    }
  })
}

export type ChainRef = {
  /** 目录名（slug 形态；原始名字以文件里的 meta.site / meta.flow 为准）。 */
  site: string
  flow: string
  versions: number[]
  latest?: number
  /** 以下取自**最新版本**的文件头（编排页列表用）；文件坏了就只有目录信息。 */
  kind?: ChainKind
  domain?: string
  note?: string
  /** 最新版本的 meta.created（ISO）。 */
  updatedAt?: string
  nodeCount?: number
  edgeCount?: number
  /**
   * 最新版本里节点引用的卡/页面所属 host（去重、保序）。
   * 只给面板「网站卡」展示用：host 属于卡/页面的采集来源，不是链的语义字段。
   */
  hosts?: string[]
  /** 最新版本文件读不出来时的中文原因（列表照常展示，不因一份坏文件整页空白）。 */
  unreadable?: string
}

/**
 * 列工作区里所有链（两层目录扫描；坏 slug 的目录跳过）。
 *
 * 会读一遍最新版本的头部来补 kind/domain/updatedAt/节点边数——编排页要按这三样
 * 分组与排序。坏文件不抛：整条链照常出现，只是带 `unreadable` 说明。
 */
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
      const latest = versions[versions.length - 1]
      result.push({ site, flow, versions, latest, ...summarize(workspaceRoot, site, flow, latest) })
    }
  }
  return result
}

/** 最新版本文件头 → 列表要的元数据（读失败返回 unreadable，不抛）。 */
function summarize(
  workspaceRoot: string,
  site: string,
  flow: string,
  version: number,
): Pick<ChainRef, 'kind' | 'domain' | 'note' | 'updatedAt' | 'nodeCount' | 'edgeCount' | 'hosts' | 'unreadable'> {
  try {
    const doc = parseChainYaml(readFileSync(chainFilePath(workspaceRoot, site, flow, version), 'utf8'))
    if (!doc.ok) {
      return { unreadable: doc.issues.map((issue) => `${issue.target}：${issue.reason}`).join('；') }
    }
    const { meta, nodes, edges } = doc.doc
    const hosts = hostsOfDoc(workspaceRoot, doc.doc)
    return {
      kind: doc.doc.kind,
      ...(meta.domain === undefined ? {} : { domain: meta.domain }),
      ...(meta.note === undefined ? {} : { note: meta.note }),
      ...(meta.created === undefined ? {} : { updatedAt: meta.created }),
      nodeCount: nodes.length,
      edgeCount: edges.length,
      ...(hosts.length === 0 ? {} : { hosts }),
    }
  } catch (error) {
    return { unreadable: `读取失败：${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * 链节点引用的卡/页面的 host（去重、保序）。
 *
 * 用途只限面板「网站卡」展示（原型的新增字段）：host 不在链 schema 里，
 * 它是卡的采集来源；卡/页面缺失时静默跳过，不因展示信息失败影响列表。
 */
function hostsOfDoc(workspaceRoot: string, doc: ChainDoc): string[] {
  const hosts = new Set<string>()
  const addUrl = (url: unknown): void => {
    if (typeof url !== 'string' || url === '') return
    try {
      const parsed = new URL(url, 'http://placeholder.invalid')
      if (parsed.host !== '' && parsed.host !== 'placeholder.invalid') hosts.add(parsed.host)
    } catch {
      // 不是 URL 就跳过：展示信息不值得为坏数据报错。
    }
  }
  for (const node of doc.nodes ?? []) {
    if (typeof node.card === 'string' && node.card !== '') {
      const card = readCard(workspaceRoot, node.card)
      for (const source of card?.sources ?? []) {
        for (const page of source.pages ?? []) addUrl(page)
      }
    }
    addUrl(node.page)
  }
  return [...hosts]
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

/* ------------------------------------------------------------------ 重命名 */

/**
 * 业务域 / 流程改名（R-2 M5 的「重命名」部分）。
 *
 * 语义（刻意写在这里，因为它是唯一会修改**历史版本文件**的操作）：
 *   - 流程改名 = 目录改名 + 每个版本文件的 `meta.flow` 同步改名；
 *   - 业务域改名 = 组内每个流程的每个版本里 `meta.domain` 同步改名；
 *   - 节点/边/常量/槽位等内容一个字节都不改，版本号也不变——这是元数据修正，
 *     不是重新保存（与 saveChain「只增版本」的纪律区分开）；
 *   - 全部文件先读+校验+生成新文本，写盘走「临时文件 → rename 覆盖」，
 *     坏文件、目标冲突、空名一律整次拒绝，不产生半改状态的目录。
 *
 * 已知取舍：会破坏「版本文件不可变」的字面承诺（设计文档 r2 M5 已记录该风险）。
 */
export type ChainRenameErrorCode = 'rename-invalid' | 'rename-conflict' | 'rename-not-found' | 'invalid-chain'

export type ChainRenameResult =
  | { ok: true; site: string; flow?: string; updatedFlows?: number; updatedVersions?: number }
  | { ok: false; code: ChainRenameErrorCode; message: string; issues?: ChainIssue[] }

type PreparedVersion = { version: number; text: string }

/** 读一个版本并生成改写后的文本；坏文件返回可读错误（整次改名拒绝）。 */
function prepareVersionText(
  workspaceRoot: string,
  site: string,
  flow: string,
  version: number,
  patch: (doc: ChainDoc) => ChainDoc,
): { ok: true; text: string } | { ok: false; message: string; issues: ChainIssue[] } {
  let parsed: ReturnType<typeof parseChainYaml>
  try {
    parsed = parseChainYaml(readFileSync(chainFilePath(workspaceRoot, site, flow, version), 'utf8'))
  } catch (error) {
    return { ok: false, message: `v${version} 读取失败：${error instanceof Error ? error.message : String(error)}`, issues: [] }
  }
  if (!parsed.ok) {
    return { ok: false, message: `v${version} 校验不过，先修好再改名`, issues: parsed.issues }
  }
  return { ok: true, text: chainToYaml(patch(parsed.doc)) }
}

/** 先写临时文件、再逐个 rename 覆盖：尽量把「写到一半」的窗口压到最小。 */
function writePreparedVersions(dir: string, versions: PreparedVersion[]): void {
  const pending: Array<{ tmp: string; final: string }> = []
  try {
    for (const version of versions) {
      const final = join(dir, `v${version.version}.yaml`)
      const tmp = `${final}.tmp-${process.pid}-${Date.now()}`
      writeFileSync(tmp, version.text, 'utf8')
      pending.push({ tmp, final })
    }
    for (const file of pending) renameSync(file.tmp, file.final)
  } catch (error) {
    for (const file of pending) {
      try {
        unlinkSync(file.tmp)
      } catch {
        // 临时文件可能已被 rename 掉；清理失败不覆盖原始错误。
      }
    }
    throw error
  }
}

/** 流程改名：目录 + 每个版本的 meta.flow；同名（slug 相同）时只改展示名。 */
export function renameChainFlow(
  workspaceRoot: string,
  site: string,
  flow: string,
  newFlow: string,
): ChainRenameResult {
  const trimmed = String(newFlow ?? '').trim()
  if (trimmed === '' || slugOf(trimmed) === '') {
    return { ok: false, code: 'rename-invalid', message: '流程名称不能为空（或只含路径分隔符）' }
  }
  const oldDir = chainDir(workspaceRoot, site, flow)
  if (!existsSync(oldDir)) {
    return { ok: false, code: 'rename-not-found', message: `流程「${flow}」不存在` }
  }
  const versions = listChainVersions(workspaceRoot, site, flow)
  if (versions.length === 0) {
    return { ok: false, code: 'rename-not-found', message: `流程「${flow}」没有可改名的版本` }
  }

  const prepared: PreparedVersion[] = []
  for (const version of versions) {
    const text = prepareVersionText(workspaceRoot, site, flow, version, (doc) => ({
      ...doc,
      meta: { ...doc.meta, flow: trimmed },
    }))
    if (!text.ok) {
      return { ok: false, code: 'invalid-chain', message: text.message, issues: text.issues }
    }
    prepared.push({ version, text: text.text })
  }

  const oldSlug = slugOf(flow)
  const newSlug = slugOf(trimmed)
  const newDir = join(chainsRoot(workspaceRoot), slugOf(site), newSlug)
  if (newDir !== oldDir && existsSync(newDir)) {
    return { ok: false, code: 'rename-conflict', message: `目标流程目录已存在：${newSlug}` }
  }

  let moved = false
  try {
    if (newDir !== oldDir) {
      renameSync(oldDir, newDir)
      moved = true
    }
    writePreparedVersions(newDir, prepared)
  } catch (error) {
    if (moved) {
      try {
        renameSync(newDir, oldDir)
      } catch {
        // 回滚失败时保留原错误：目录至少还在新位置，不会消失。
      }
    }
    throw error
  }
  return { ok: true, site, flow: trimmed, updatedVersions: prepared.length }
}

/**
 * 业务域改名：把该网站下「最新版 domain = old」的所有流程的所有版本里
 * `meta.domain === old` 的版本改写为新名字。
 */
export function renameChainDomain(
  workspaceRoot: string,
  site: string,
  domain: string,
  newDomain: string,
): ChainRenameResult {
  const oldName = String(domain ?? '').trim()
  const trimmed = String(newDomain ?? '').trim()
  if (oldName === '') {
    return { ok: false, code: 'rename-invalid', message: '原业务域名称不能为空' }
  }
  if (trimmed === '') {
    return { ok: false, code: 'rename-invalid', message: '业务域名称不能为空' }
  }
  if (trimmed === oldName) return { ok: true, site, updatedFlows: 0, updatedVersions: 0 }

  const siteDir = join(chainsRoot(workspaceRoot), slugOf(site))
  if (!existsSync(siteDir)) {
    return { ok: false, code: 'rename-not-found', message: `网站「${site}」不存在` }
  }

  let updatedFlows = 0
  let updatedVersions = 0
  for (const flow of safeDirs(siteDir)) {
    const versions = listChainVersions(workspaceRoot, site, flow)
    if (versions.length === 0) continue
    const latestVersion = versions[versions.length - 1]
    // 以最新版判断该流程属于哪个业务域（与 overview 的分组口径一致）；读不出来就跳过。
    let latestDoc: ReturnType<typeof parseChainYaml>
    try {
      latestDoc = parseChainYaml(readFileSync(chainFilePath(workspaceRoot, site, flow, latestVersion), 'utf8'))
    } catch {
      continue
    }
    if (!latestDoc.ok || latestDoc.doc.meta.domain !== oldName) continue

    const prepared: PreparedVersion[] = []
    for (const version of versions) {
      const candidate = parseChainYaml(readFileSync(chainFilePath(workspaceRoot, site, flow, version), 'utf8'))
      if (!candidate.ok) {
        return {
          ok: false,
          code: 'invalid-chain',
          message: `流程「${flow}」的 v${version} 校验不过，先修好再改名`,
          issues: candidate.issues,
        }
      }
      if (candidate.doc.meta.domain !== oldName) continue
      prepared.push({
        version,
        text: chainToYaml({ ...candidate.doc, meta: { ...candidate.doc.meta, domain: trimmed } }),
      })
    }
    if (prepared.length === 0) continue
    writePreparedVersions(chainDir(workspaceRoot, site, flow), prepared)
    updatedFlows += 1
    updatedVersions += prepared.length
  }

  if (updatedFlows === 0) {
    return { ok: false, code: 'rename-not-found', message: `没有业务域「${oldName}」可改名` }
  }
  return { ok: true, site, updatedFlows, updatedVersions }
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
 *
 * `source` 是**版本来源**（编排图列表要显示「agent 会话保存 / 画布保存 / 导入」）：
 * 由调用方声明，不猜。调用方没声明就保留输入里已有的值，都没有则该版本无来源标注。
 */
export function saveChain(
  workspaceRoot: string,
  input: ChainDoc | string,
  options: Partial<ValidateOptions> & { source?: ChainSource } = {},
): ChainSaveResult {
  const resolveCard = options.resolveCard ?? defaultCardResolver(workspaceRoot)
  const parsed = typeof input === 'string' ? validateChainYaml(input, { resolveCard }) : validateChain(input, { resolveCard })
  if (!parsed.ok) return { ok: false, issues: parsed.issues }

  const { doc } = parsed
  const version = nextChainVersion(workspaceRoot, doc.meta.site, doc.meta.flow)
  const created = isIsoInstant(doc.meta.created) ? doc.meta.created : new Date().toISOString()
  const source = options.source ?? doc.meta.source
  const finalDoc: ChainDoc = {
    ...doc,
    meta: { ...doc.meta, version, created, ...(source === undefined ? {} : { source }) },
  }

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
