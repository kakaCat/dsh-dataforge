/**
 * 绑定回写便捷入口（R-5 M2）：把 probe 发现的边合入链 → saveChain 落新版本。
 *
 * 为什么单独一个入口：M1 的回写路径是「把整份链 YAML 重抄一遍再 upsert」，agent 每发现
 * 一条上游出参就要重抄节点/常量/槽位，链一长就抄丢或抄错，而真正新增的往往只有一条边。
 * 这里只收「边」，节点/常量/槽位原样保留，并把合并语义收在一处：
 *   - `to` 相同 = 对同一条绑定的重写（替换，不在链里叠加两条指向同一入参的边）；
 *   - `to` 不同 = 新增；
 *   - 完全相同的 from/to/transform/pick = 无变化（只计数，边集不动）；
 *   - 同一次调用里 `to` 重复，以后者为准（先按 to 去重再合并）。
 *
 * 写链纪律不打折：仍然只经 `saveChain`（R-1 schema + 语义校验全过才落盘为 max+1 快照，
 * 旧版本永远可回读）；本模块自己不碰文件、不复制一遍语义校验（卡引用/字段存在性/成环/
 * 常量互斥全交给 saveChain），也不新增错误码——失败折成既有 `invalid-chain` /
 * `card-not-imported` / `chain-not-found` 回执。
 *
 * 为什么先把改好的 doc 序列化成 YAML 再交给 saveChain：工具与磁盘之间的契约就是 YAML 文件，
 * 走一遍 chainToYaml → saveChain 的往返，等于顺带验证了「序列化后仍能通过 R-1」，
 * 与 agent 手写 YAML 走的是同一条校验路径。
 *
 * @module dsh-dataforge/orchestration/bind
 */
import type { ChainDoc, ChainEdge, ChainEdgePick, ChainIssue } from '../chains/schema.js'
import { chainErrorCode, chainToYaml } from '../chains/schema.js'
import type { ChainLoadResult, ChainSaveResult } from '../chains/store.js'
import { loadChain, saveChain } from '../chains/store.js'
import type { OrchestrationDeps } from './application.js'

/** 一条要回写的绑定边（工具入参形态；与 ChainEdge 的差异仅在于不写 `suggested`）。 */
export type BindEdgeSpec = {
  from: string
  to: string
  transform?: 'string' | 'json' | 'array-json'
  pick?: { match: { field: string; equals: string | number | boolean }; field?: string }
}

export type ChainBindToolArgs = {
  site: string
  flow: string
  /** 以哪个版本为基（缺省最新）；落盘永远是 max+1 的新版本。 */
  version?: number
  edges: BindEdgeSpec[]
}

/** 工具回执：失败码只复用既有（chain-not-found / invalid-chain / card-not-imported）。 */
export type ChainBindToolValue = {
  ok: boolean
  code?: string
  message?: string
  hints?: string[]
  site?: string
  flow?: string
  version?: number
  path?: string
  added?: number
  replaced?: number
  unchanged?: number
  edges?: Array<{ from: string; to: string }>
  issues?: Array<{ target: string; code: string; reason: string }>
}

type MergeTally = { added: number; replaced: number; unchanged: number }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function toChainIssues(issues: ChainIssue[]): Array<{ target: string; code: string; reason: string }> {
  return issues.map((issue) => ({ target: issue.target, code: issue.code, reason: issue.reason }))
}

/**
 * 入参边的形状兜底。
 *
 * 为什么不把这些也交给 saveChain：`from`/`to` 不是字符串时合并逻辑自身会崩，`pick` 形状坏
 * 时 R-1 的 normalizePick 会**静默丢掉** pick（schema 里是 Schema.any），agent 会以为
 * 「按字段选元素」生效了。这里只挡形状（不是语义：字段是否存在、卡是否存在仍由 saveChain 判），
 * 并且一次把坏边全报完，沿用 validate.ts 的「报全不 fail-fast」纪律。
 */
function specShapeIssues(specs: BindEdgeSpec[]): ChainIssue[] {
  const issues: ChainIssue[] = []
  specs.forEach((spec, index) => {
    const target = `edges[${index}]`
    const from = typeof spec?.from === 'string' ? spec.from : ''
    const to = typeof spec?.to === 'string' ? spec.to : ''
    if (from.trim() === '' || to.trim() === '') {
      issues.push({
        target,
        code: 'invalid-chain',
        reason:
          'from/to 必须是非空字符串：from 是 <节点 id>.<出参路径> 或 $inputs.<槽位名>，to 是 <节点 id>.<入参路径>',
      })
      return
    }
    const pickProblem = pickShapeProblemOf(spec.pick)
    if (pickProblem !== undefined) {
      issues.push({ target, code: 'invalid-chain', reason: pickProblem })
    }
  })
  return issues
}

/** pick 的形状检查（语义解释见 specShapeIssues 的注释）。 */
function pickShapeProblemOf(pick: unknown): string | undefined {
  if (pick === undefined) return undefined
  if (typeof pick !== 'object' || pick === null || Array.isArray(pick)) {
    return 'pick 必须是对象：{ match: { field, equals }, field? }'
  }
  const record = pick as Record<string, unknown>
  const match = record['match']
  if (typeof match !== 'object' || match === null || Array.isArray(match)) {
    return 'pick.match 必须是对象：{ field, equals }'
  }
  const matchRecord = match as Record<string, unknown>
  const field = matchRecord['field']
  if (typeof field !== 'string' || field.trim() === '') {
    return 'pick.match.field 必须是非空字符串（从数组元素里按哪个字段匹配）'
  }
  const equals = matchRecord['equals']
  if (typeof equals !== 'string' && typeof equals !== 'number' && typeof equals !== 'boolean') {
    return 'pick.match.equals 必须是 string / number / boolean'
  }
  const take = record['field']
  if (take !== undefined && (typeof take !== 'string' || take.trim() === '')) {
    return 'pick.field 若给出必须是非空字符串（命中后取哪个字段；缺省取整个元素）'
  }
  return undefined
}

/** 入参边 → 链边（不写 `suggested`：这是明确绑定，不是编译期的建议）。 */
function edgeOf(spec: BindEdgeSpec): ChainEdge {
  return {
    from: spec.from,
    to: spec.to,
    ...(spec.transform === undefined ? {} : { transform: spec.transform }),
    ...(spec.pick === undefined ? {} : { pick: spec.pick }),
  }
}

/** 同一次调用里 `to` 重复时以后者为准；保留各个 to 最后一次出现的位置。 */
function lastWinsByTo(specs: BindEdgeSpec[]): BindEdgeSpec[] {
  const lastIndex = new Map<string, number>()
  specs.forEach((spec, index) => lastIndex.set(spec.to, index))
  return specs.filter((spec, index) => lastIndex.get(spec.to) === index)
}

function samePick(left: ChainEdgePick | undefined, right: ChainEdgePick | undefined): boolean {
  if (left === undefined || right === undefined) return left === right
  return left.match.field === right.match.field && left.match.equals === right.match.equals && left.field === right.field
}

/** 两条边是否「完全相同的绑定」（比较 from/to/transform/pick；`suggested` 不参与）。 */
function sameEdge(left: ChainEdge, right: ChainEdge): boolean {
  return (
    left.from === right.from &&
    left.to === right.to &&
    left.transform === right.transform &&
    samePick(left.pick, right.pick)
  )
}

/**
 * 把入参边合入现有边集。
 *
 * 同 `to` 的既有边被整体替换（即使历史上有重复 to 也收敛成一条），新边占第一条旧边的位置，
 * 其余边的相对顺序不变——这样版本 diff 只显示真正的绑定变化。
 */
function mergeEdges(current: ChainEdge[], specs: BindEdgeSpec[]): { edges: ChainEdge[]; tally: MergeTally } {
  let edges = current.map((edge) => ({ ...edge }))
  const tally: MergeTally = { added: 0, replaced: 0, unchanged: 0 }
  for (const spec of lastWinsByTo(specs)) {
    const incoming = edgeOf(spec)
    const firstIndex = edges.findIndex((edge) => edge.to === incoming.to)
    if (firstIndex === -1) {
      edges.push(incoming)
      tally.added += 1
      continue
    }
    const sameTo = edges.filter((edge) => edge.to === incoming.to)
    if (sameTo.length === 1 && sameEdge(sameTo[0], incoming)) {
      tally.unchanged += 1
      continue
    }
    edges = edges.filter((edge) => edge.to !== incoming.to)
    edges.splice(firstIndex, 0, incoming)
    tally.replaced += 1
  }
  return { edges, tally }
}

/**
 * 绑定回写工具入口：载链 → 合并边 → saveChain 新版本 → 回读。
 *
 * 所有链相关的失败都折成回执（不抛）：语义校验失败原样带 issues（逐条指到 edges[j]），
 * 且一定没有落盘——saveChain 的「全过才写」保证了这一点。
 */
export async function bindChainForTool(
  deps: OrchestrationDeps,
  exec: unknown,
  args: ChainBindToolArgs,
): Promise<ChainBindToolValue> {
  const site = typeof args.site === 'string' ? args.site : ''
  const flow = typeof args.flow === 'string' ? args.flow : ''
  if (site.trim() === '' || flow.trim() === '') {
    return { ok: false, code: 'invalid-chain', message: 'site 与 flow 不能为空：链按「站点 / 流程」归档' }
  }

  const specs: BindEdgeSpec[] = Array.isArray(args.edges) ? args.edges : []
  if (specs.length === 0) {
    return {
      ok: false,
      code: 'invalid-chain',
      message: 'edges 不能为空：至少给一条要回写的绑定边（from → to）',
      site,
      flow,
    }
  }
  const shapeIssues = specShapeIssues(specs)
  if (shapeIssues.length > 0) {
    return {
      ok: false,
      code: 'invalid-chain',
      message: `绑定边入参不合法（${shapeIssues.length} 条）：没有读写链`,
      issues: toChainIssues(shapeIssues),
      site,
      flow,
    }
  }

  // 与 upsertChainForTool 同一套工作区解析：会话 cwd 优先，缺省 process.cwd()。
  const workspaceRoot = (await deps.resolveWorkspaceRoot(exec)) ?? process.cwd()

  let loaded: ChainLoadResult
  try {
    loaded = loadChain(workspaceRoot, site, flow, {
      ...(args.version === undefined ? {} : { version: args.version }),
    })
  } catch (error) {
    return { ok: false, code: 'invalid-chain', message: `读取链失败：${messageOf(error)}`, site, flow }
  }
  if (!loaded.ok) {
    if (loaded.code === 'chain-not-found') {
      const hints =
        loaded.availableVersions.length === 0
          ? ['该站点/流程还没有任何链版本：先跑 dataforge_chain_upsert 建一份链，再用本入口回写绑定边']
          : [`可用版本：${loaded.availableVersions.map((version) => `v${version}`).join('、')}；不传 version 即取最新`]
      return { ok: false, code: 'chain-not-found', message: loaded.message, hints, site, flow }
    }
    return {
      ok: false,
      code: 'invalid-chain',
      message: loaded.message,
      issues: toChainIssues(loaded.issues),
      path: loaded.path,
      site,
      flow,
    }
  }

  // 绑定边只对 interface-chain 有意义：page-chain 的边是页面动线（节点 → 节点），
  // 用字段路径去写只会得到一串 confusing 的 unknown-node，不如在这里直接说清楚。
  if (loaded.doc.kind !== 'interface-chain') {
    return {
      ok: false,
      code: 'invalid-chain',
      message: `绑定边只适用于 interface-chain（当前 ${loaded.doc.kind}）：页面动线是节点到节点的顺序，请直接 dataforge_chain_upsert`,
      site,
      flow,
    }
  }

  const merged = mergeEdges(loaded.doc.edges, specs)
  const nextDoc: ChainDoc = { ...loaded.doc, edges: merged.edges }

  let saved: ChainSaveResult
  try {
    saved = saveChain(workspaceRoot, chainToYaml(nextDoc), { source: 'agent' })
  } catch (error) {
    return { ok: false, code: 'invalid-chain', message: `落盘链失败：${messageOf(error)}`, site, flow }
  }
  if (!saved.ok) {
    const code = chainErrorCode(saved.issues)
    return {
      ok: false,
      code,
      message:
        code === 'card-not-imported'
          ? '链引用的接口卡不在项目接口库：先跑 dataforge_library_import'
          : `绑定后的链未通过校验（${saved.issues.length} 条）：修好再提交，没有落盘`,
      issues: toChainIssues(saved.issues),
      site,
      flow,
    }
  }

  // 回读磁盘上的新版本（不是拿内存里的 nextDoc 冒充落盘结果）：
  // 回执里的 edges 必须就是下一版文件里真实存在的边。
  let persisted: ChainLoadResult
  try {
    persisted = loadChain(workspaceRoot, saved.doc.meta.site, saved.doc.meta.flow, { version: saved.version })
  } catch (error) {
    return {
      ok: false,
      code: 'invalid-chain',
      message: `绑定已落盘为 v${saved.version}，但回读失败：${messageOf(error)}`,
      version: saved.version,
      path: saved.path,
      site,
      flow,
    }
  }
  if (!persisted.ok) {
    return {
      ok: false,
      code: 'invalid-chain',
      message: `绑定已落盘为 v${saved.version}，但回读失败：${persisted.message}`,
      version: saved.version,
      path: saved.path,
      site,
      flow,
    }
  }

  const hints: string[] = []
  if (merged.tally.added === 0 && merged.tally.replaced === 0) {
    hints.push(
      `绑定无变化（unchanged ${merged.tally.unchanged}）：本入口仍按 saveChain 的「每次落盘即新快照」纪律写成新版本，旧版本可回读`,
    )
  }
  if (saved.warnings.length > 0) {
    hints.push(...saved.warnings.map((issue) => `${issue.target}：${issue.reason}`))
  }

  return {
    ok: true,
    site: saved.doc.meta.site,
    flow: saved.doc.meta.flow,
    version: saved.version,
    path: saved.path,
    added: merged.tally.added,
    replaced: merged.tally.replaced,
    unchanged: merged.tally.unchanged,
    edges: persisted.doc.edges.map((edge) => ({ from: edge.from, to: edge.to })),
    ...(hints.length === 0 ? {} : { hints }),
  }
}
