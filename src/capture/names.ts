/**
 * 面板三级手工名覆盖（网站 / 页面 / 接口）的持久化。
 *
 * 自动名是「采集时记录 + URL 规则生成」的兜底；用户手工改名要跨重采存活，所以单独落在
 * `dataRoot/capture/names.yaml`（不写采集库：采集库按 run 隔离，重采会生成新行）。
 *
 * 键口径（与面板数据面契约一致）：
 *   - site → 小写 host（`Example.COM` 与 `example.com` 是同一个网站）；
 *   - page → `pageIdentityOf` 页面身份（hash 路由/反缓存戳变体同名）；
 *   - interface → `mergeKey` 原样 trim（值不入键，跨参数值/跨采集稳定）。
 *
 * 写路径：tmp + rename 原子写（半截文件不会被下一次读取当真）；缺文件/坏文件一律降级为空快照，
 * 绝不因为名称覆盖文件坏掉而让面板接口 500 —— 覆盖是可再生的展示增强，不是事实源。
 *
 * @module dsh-dataforge/capture/names
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import yaml from 'js-yaml'
import { pageIdentityOf } from '../shared/page-url.js'

export type CaptureNameKind = 'site' | 'page' | 'interface'

/** 三级名称快照：只有手工覆盖，缺省空对象。 */
export type CaptureNamesSnapshot = {
  sites: Record<string, string>
  pages: Record<string, string>
  interfaces: Record<string, string>
}

/** 手工名长度上限（与面板 POST /names 的 400 校验同一口径）。 */
export const NAME_MAX_CHARS = 80

const KINDS: readonly CaptureNameKind[] = ['site', 'page', 'interface']

export function isCaptureNameKind(value: unknown): value is CaptureNameKind {
  return typeof value === 'string' && (KINDS as readonly string[]).includes(value)
}

/** 键归一：site → 小写 host；page → 页面身份；interface → 原样 trim。 */
export function normalizeNameKey(kind: CaptureNameKind, key: string): string {
  const trimmed = key.trim()
  if (kind === 'site') return trimmed.toLowerCase()
  if (kind === 'page') return pageIdentityOf(trimmed)
  return trimmed
}

/** 名称清洗：压空白、去首尾（空串 = 删除该条覆盖）。 */
export function cleanName(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function emptySnapshot(): CaptureNamesSnapshot {
  return { sites: {}, pages: {}, interfaces: {} }
}

function bucketOf(snapshot: CaptureNamesSnapshot, kind: CaptureNameKind): Record<string, string> {
  if (kind === 'site') return snapshot.sites
  if (kind === 'page') return snapshot.pages
  return snapshot.interfaces
}

/** YAML 文档 → 快照：非对象/坏段如实丢弃（逐段降级，不整份作废）。 */
function sanitizeSnapshot(doc: unknown): CaptureNamesSnapshot {
  const snapshot = emptySnapshot()
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return snapshot
  const record = doc as Record<string, unknown>
  const sections: Array<[keyof CaptureNamesSnapshot, unknown]> = [
    ['sites', record['sites']],
    ['pages', record['pages']],
    ['interfaces', record['interfaces']],
  ]
  for (const [section, raw] of sections) {
    if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) continue
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (key.trim() === '' || typeof value !== 'string') continue
      const name = cleanName(value)
      if (name === '') continue
      snapshot[section][key] = name.slice(0, NAME_MAX_CHARS)
    }
  }
  return snapshot
}

export class CaptureNamesStore {
  private data: CaptureNamesSnapshot

  constructor(private readonly filePath: string) {
    this.data = this.load()
  }

  /** 最新快照（深拷贝：调用方改返回值不会污染存储）。 */
  snapshot(): CaptureNamesSnapshot {
    return {
      sites: { ...this.data.sites },
      pages: { ...this.data.pages },
      interfaces: { ...this.data.interfaces },
    }
  }

  /**
   * 写一条覆盖：`name` trim 后为空 = 删除该键；否则覆盖。返回**最新**快照。
   *
   * 先算下一份再落盘、成功后才替换内存态：写失败不会留下「内存已改、盘上没改」的半态。
   */
  set(kind: CaptureNameKind, key: string, name: string): CaptureNamesSnapshot {
    const normalizedKey = normalizeNameKey(kind, key)
    if (normalizedKey === '') return this.snapshot()
    const next = this.snapshot()
    const clean = cleanName(name)
    if (clean === '') delete bucketOf(next, kind)[normalizedKey]
    else bucketOf(next, kind)[normalizedKey] = clean.slice(0, NAME_MAX_CHARS)
    this.persist(next)
    this.data = next
    return this.snapshot()
  }

  /** 读文件：缺文件/坏文件/坏形状一律空快照（不抛）。 */
  private load(): CaptureNamesSnapshot {
    let text: string
    try {
      text = readFileSync(this.filePath, 'utf8')
    } catch {
      return emptySnapshot()
    }
    try {
      return sanitizeSnapshot(yaml.load(text))
    } catch {
      return emptySnapshot()
    }
  }

  /** 原子写：同目录 tmp 文件写完再 rename（跨进程读取不会看到半截 YAML）。 */
  private persist(snapshot: CaptureNamesSnapshot): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const text = yaml.dump(snapshot, { lineWidth: 120, noRefs: true, sortKeys: true })
    const tmp = `${this.filePath}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
    writeFileSync(tmp, text, 'utf8')
    renameSync(tmp, this.filePath)
  }
}
