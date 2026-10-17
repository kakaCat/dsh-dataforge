/**
 * 绑定回写便捷入口（R-5 M2）：只在「边」层面改链，节点/常量/槽位原样保留。
 *
 * 这一组验的是合并语义与失败面：
 *   - 新增一条 upstream 出参边 → 落成新版本且回读得到；
 *   - 重复同一 bind 幂等（边集不变，unchanged 计数；版本按 saveChain 快照纪律递增）；
 *   - 同 `to` 的既有边被替换（旧边不在新版本）；
 *   - transform / pick 经 YAML 落盘后原样回读；
 *   - 字段/节点不存在 → 一次把 issues 全报出来，且不落新版本；
 *   - 多边 + `$inputs.<slot>` 槽位边一次落盘；
 *   - page-chain / 空 edges / 链不存在等入口闸。
 *
 * @module dsh-dataforge/test/orchestration/bind
 */
import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChainDoc, ChainEdge, InterfaceCardDoc } from '../../src/chains/schema.js'
import { chainToYaml } from '../../src/chains/schema.js'
import { cardsRoot, chainFilePath, listChainVersions, loadChain, saveChain } from '../../src/chains/store.js'
import type { OrchestrationDeps } from '../../src/orchestration/application.js'
import { bindChainForTool } from '../../src/orchestration/bind.js'

const SITE = '测试站点'
const FLOW = '绑定回写'

const queryCard: InterfaceCardDoc = {
  cardId: 'card_query',
  kind: 'interface-card',
  identity: { mergeKey: 'GET /api/materials', method: 'GET', urlTemplate: '/api/materials' },
  inputs: [{ path: 'query.q', type: 'string' }],
  outputs: [
    { path: 'body.items[0].internalId', type: 'string' },
    { path: 'body.items[0].materialCode', type: 'string' },
    { path: 'body.total', type: 'number' },
  ],
}

const orderCard: InterfaceCardDoc = {
  cardId: 'card_order',
  kind: 'interface-card',
  identity: { mergeKey: 'POST /api/orders', method: 'POST', urlTemplate: '/api/orders' },
  inputs: [
    { path: 'body.materialId', type: 'string' },
    { path: 'body.materialCode', type: 'string' },
    { path: 'body.quantity', type: 'number' },
    { path: 'body.remark', type: 'string' },
  ],
  outputs: [{ path: 'body.orderNo', type: 'string' }],
}

/** 临时工作区 + 两张卡（卡走 library/cards 落点，bind 的 saveChain 会按它做语义校验）。 */
function workspaceOf(): string {
  const workspace = mkdtempSync(join(tmpdir(), 'bind-'))
  const dir = cardsRoot(workspace)
  mkdirSync(dir, { recursive: true })
  for (const card of [queryCard, orderCard]) {
    writeFileSync(join(dir, `${card.cardId}.yaml`), JSON.stringify(card, null, 2), 'utf8')
  }
  return workspace
}

function depsOf(workspace: string): OrchestrationDeps {
  return { captureDbPath: join(workspace, 'capture.sqlite'), resolveWorkspaceRoot: async () => workspace }
}

type SeedOptions = {
  inputs?: ChainDoc['inputs']
  nodes?: ChainDoc['nodes']
  edges?: ChainEdge[]
}

/** 直接经 saveChain 造 v1（不走 bind，保证「初始链」是被 R-1 认过的合法链）。 */
function seedChain(workspace: string, options: SeedOptions = {}): void {
  const doc: ChainDoc = {
    apiVersion: 'dataforge/v1',
    kind: 'interface-chain',
    meta: { site: SITE, flow: FLOW, version: 1, created: '2026-10-17T00:00:00Z' },
    inputs: options.inputs ?? [],
    nodes: options.nodes ?? [
      { id: 'query', card: 'card_query', constants: { 'query.q': 'A' } },
      { id: 'order', card: 'card_order', constants: { 'body.quantity': '1' } },
    ],
    edges: options.edges ?? [],
  }
  const saved = saveChain(workspace, chainToYaml(doc), { source: 'agent' })
  if (!saved.ok) {
    throw new Error(`夹具链落盘失败：${saved.issues.map((issue) => `${issue.target}：${issue.reason}`).join('；')}`)
  }
}

async function readChain(workspace: string): Promise<ChainDoc> {
  const loaded = loadChain(workspace, SITE, FLOW)
  if (!loaded.ok) throw new Error(`回读链失败：${loaded.message}`)
  return loaded.doc
}

describe('bindChainForTool：把边合入链', () => {
  it('初始链无绑定边 → bind 一条 upstream 出参边 → v2 落盘且可回读', async () => {
    const workspace = workspaceOf()
    seedChain(workspace)

    const value = await bindChainForTool(depsOf(workspace), {}, {
      site: SITE,
      flow: FLOW,
      edges: [{ from: 'query.body.items[0].internalId', to: 'order.body.materialId' }],
    })

    expect(value.ok).toBe(true)
    expect(value.version).toBe(2)
    expect(value.path).toBe(chainFilePath(workspace, SITE, FLOW, 2))
    expect(value.added).toBe(1)
    expect(value.replaced).toBe(0)
    expect(value.unchanged).toBe(0)
    expect(value.edges).toEqual([{ from: 'query.body.items[0].internalId', to: 'order.body.materialId' }])

    // 回读的是磁盘上的新版本，不是内存里拼出来的 doc。
    const doc = await readChain(workspace)
    expect(doc.meta.version).toBe(2)
    // 版本来源由写入方声明：bind 回写 = agent 保存。
    expect(doc.meta.source).toBe('agent')
    expect(doc.edges).toHaveLength(1)
    expect(doc.edges[0]).toMatchObject({
      from: 'query.body.items[0].internalId',
      to: 'order.body.materialId',
    })
    // 版本只增不删：v1 快照仍在。
    expect(listChainVersions(workspace, SITE, FLOW)).toEqual([1, 2])
  })

  it('重复同一 bind 幂等：边集不变、unchanged 计数；版本按 saveChain 快照语义递增', async () => {
    const workspace = workspaceOf()
    seedChain(workspace)
    const edges = [{ from: 'query.body.items[0].internalId', to: 'order.body.materialId' }]
    const first = await bindChainForTool(depsOf(workspace), {}, { site: SITE, flow: FLOW, edges })
    expect(first.version).toBe(2)

    const again = await bindChainForTool(depsOf(workspace), {}, { site: SITE, flow: FLOW, edges })

    expect(again.ok).toBe(true)
    expect(again.added).toBe(0)
    expect(again.replaced).toBe(0)
    // 完全相同的 from/to/transform/pick → 不改边集，只计数。
    expect(again.unchanged).toBe(1)
    // saveChain 的纪律是「每次落盘都是 max+1 的新快照」（没有内容去重），
    // 所以幂等调用的结果是 v3：边集与 v2 相同，但版本号照样前进，旧版本可回读。
    expect(again.version).toBe(3)
    expect(listChainVersions(workspace, SITE, FLOW)).toEqual([1, 2, 3])
    const doc = await readChain(workspace)
    expect(doc.edges.map((edge) => `${edge.from} → ${edge.to}`)).toEqual([
      'query.body.items[0].internalId → order.body.materialId',
    ])
    // 无变化时给一句人话，避免「明明没变为什么多了个版本」的困惑。
    expect(again.hints?.some((hint) => hint.includes('绑定无变化'))).toBe(true)
  })

  it('to 已有另一条边 → 被替换（replaced=1），旧边不在新版本', async () => {
    const workspace = workspaceOf()
    seedChain(workspace, {
      edges: [{ from: 'query.body.items[0].materialCode', to: 'order.body.materialId' }],
    })

    const value = await bindChainForTool(depsOf(workspace), {}, {
      site: SITE,
      flow: FLOW,
      edges: [{ from: 'query.body.items[0].internalId', to: 'order.body.materialId' }],
    })

    expect(value.ok).toBe(true)
    expect(value.added).toBe(0)
    expect(value.replaced).toBe(1)
    expect(value.unchanged).toBe(0)
    const doc = await readChain(workspace)
    expect(doc.edges).toHaveLength(1)
    expect(doc.edges[0].from).toBe('query.body.items[0].internalId')
    const stale = loadChain(workspace, SITE, FLOW, { version: 1 })
    expect(stale.ok).toBe(true)
    if (!stale.ok) return
    // 旧版本快照不被改写：v1 里还是旧边。
    expect(stale.doc.edges[0].from).toBe('query.body.items[0].materialCode')
  })

  it('边的 transform / pick 经 YAML 落盘后原样回读', async () => {
    const workspace = workspaceOf()
    seedChain(workspace)

    const value = await bindChainForTool(depsOf(workspace), {}, {
      site: SITE,
      flow: FLOW,
      edges: [
        {
          from: 'query.body.items',
          to: 'order.body.materialId',
          transform: 'array-json',
          pick: { match: { field: 'internalId', equals: 'A-ID' }, field: 'internalId' },
        },
      ],
    })

    expect(value.ok).toBe(true)
    const doc = await readChain(workspace)
    expect(doc.edges).toHaveLength(1)
    expect(doc.edges[0]).toMatchObject({
      from: 'query.body.items',
      to: 'order.body.materialId',
      transform: 'array-json',
      pick: { match: { field: 'internalId', equals: 'A-ID' }, field: 'internalId' },
    })
  })

  it('字段/节点不存在 → issues 逐条指到 edges，且不落新版本', async () => {
    const workspace = workspaceOf()
    seedChain(workspace)

    const value = await bindChainForTool(depsOf(workspace), {}, {
      site: SITE,
      flow: FLOW,
      edges: [
        // 目标字段不在卡入参模板里
        { from: 'query.body.items[0].internalId', to: 'order.body.nope' },
        // 源字段不在卡出参模板里
        { from: 'query.body.nope', to: 'order.body.materialId' },
        // 起点节点不存在
        { from: 'ghost.body.items[0].internalId', to: 'order.body.materialCode' },
      ],
    })

    expect(value.ok).toBe(false)
    expect(value.code).toBe('invalid-chain')
    expect(value.issues).toHaveLength(3)
    expect(value.issues?.map((issue) => issue.target)).toEqual(['edges[0]', 'edges[1]', 'edges[2]'])
    expect(value.issues?.map((issue) => issue.code)).toEqual([
      'unknown-target-field',
      'unknown-source-field',
      'unknown-node',
    ])
    // 校验失败一律不落盘（saveChain 的「全过才写」）。
    expect(listChainVersions(workspace, SITE, FLOW)).toEqual([1])
    expect(value.version).toBeUndefined()
  })

  it('一次 bind 多边 + $inputs 槽位边 → 一起落盘', async () => {
    const workspace = workspaceOf()
    // 槽位必须在 v1 就被引用，否则 v1 自己会因「僵尸槽位」校验失败；
    // 这里用 query.q 常量引用 $inputs.q，bind 再加一条 $inputs.q → order.body.remark 的边。
    seedChain(workspace, {
      inputs: [{ name: 'q', type: 'string', required: true }],
      nodes: [
        { id: 'query', card: 'card_query', constants: { 'query.q': '$inputs.q' } },
        { id: 'order', card: 'card_order', constants: { 'body.quantity': '1' } },
      ],
    })

    const value = await bindChainForTool(depsOf(workspace), {}, {
      site: SITE,
      flow: FLOW,
      edges: [
        { from: 'query.body.items[0].internalId', to: 'order.body.materialId' },
        { from: '$inputs.q', to: 'order.body.remark' },
      ],
    })

    expect(value.ok).toBe(true)
    expect(value.added).toBe(2)
    expect(value.version).toBe(2)
    const doc = await readChain(workspace)
    expect(doc.edges.map((edge) => `${edge.from} → ${edge.to}`)).toEqual([
      'query.body.items[0].internalId → order.body.materialId',
      '$inputs.q → order.body.remark',
    ])
    // 节点/常量/槽位原样保留（bind 只改 edges）。
    expect(doc.inputs.map((input) => input.name)).toEqual(['q'])
    expect(doc.nodes.find((node) => node.id === 'query')?.constants['query.q']).toBe('$inputs.q')
    expect(doc.nodes.find((node) => node.id === 'order')?.constants['body.quantity']).toBe('1')
  })

  it('链不存在 / 指定版本不存在 → chain-not-found，并给可用版本提示', async () => {
    const workspace = workspaceOf()
    const missing = await bindChainForTool(depsOf(workspace), {}, {
      site: SITE,
      flow: FLOW,
      edges: [{ from: 'query.body.items[0].internalId', to: 'order.body.materialId' }],
    })
    expect(missing.ok).toBe(false)
    expect(missing.code).toBe('chain-not-found')
    expect(missing.hints?.some((hint) => hint.includes('dataforge_chain_upsert'))).toBe(true)

    seedChain(workspace)
    const noVersion = await bindChainForTool(depsOf(workspace), {}, {
      site: SITE,
      flow: FLOW,
      version: 9,
      edges: [{ from: 'query.body.items[0].internalId', to: 'order.body.materialId' }],
    })
    expect(noVersion.code).toBe('chain-not-found')
    expect(noVersion.hints?.some((hint) => hint.includes('可用版本：v1'))).toBe(true)
    // 没有落任何新版本。
    expect(listChainVersions(workspace, SITE, FLOW)).toEqual([1])
  })

  it('page-chain 拒绝绑定边（动线不是字段绑定）', async () => {
    const workspace = workspaceOf()
    const pageDoc: ChainDoc = {
      apiVersion: 'dataforge/v1',
      kind: 'page-chain',
      meta: { site: SITE, flow: FLOW, version: 1, created: '2026-10-17T00:00:00Z' },
      inputs: [],
      nodes: [
        { id: 'page-search', page: '/materials', constants: {} },
        { id: 'page-detail', page: '/materials/detail', constants: {} },
      ],
      edges: [{ from: 'page-search', to: 'page-detail' }],
    }
    const saved = saveChain(workspace, chainToYaml(pageDoc), { source: 'agent' })
    expect(saved.ok).toBe(true)

    const value = await bindChainForTool(depsOf(workspace), {}, {
      site: SITE,
      flow: FLOW,
      edges: [{ from: 'page-search.body.items', to: 'page-detail.body.id' }],
    })

    expect(value.ok).toBe(false)
    expect(value.code).toBe('invalid-chain')
    expect(String(value.message)).toContain('interface-chain')
    expect(listChainVersions(workspace, SITE, FLOW)).toEqual([1])
  })

  it('参数兜底：空 edges / 空 site → invalid-chain，不读写链', async () => {
    const workspace = workspaceOf()
    seedChain(workspace)
    const deps = depsOf(workspace)

    const noEdges = await bindChainForTool(deps, {}, { site: SITE, flow: FLOW, edges: [] })
    expect(noEdges.code).toBe('invalid-chain')
    expect(String(noEdges.message)).toContain('edges 不能为空')

    const blankSite = await bindChainForTool(deps, {}, {
      site: '  ',
      flow: FLOW,
      edges: [{ from: 'query.body.items[0].internalId', to: 'order.body.materialId' }],
    })
    expect(blankSite.code).toBe('invalid-chain')
    expect(String(blankSite.message)).toContain('不能为空')

    // 坏 pick 形状必须被挡下（否则 R-1 的 normalizePick 会静默丢掉它）。
    const badPick = await bindChainForTool(deps, {}, {
      site: SITE,
      flow: FLOW,
      edges: [
        {
          from: 'query.body.items',
          to: 'order.body.materialId',
          pick: { match: { field: '', equals: 1 } },
        },
      ],
    })
    expect(badPick.code).toBe('invalid-chain')
    expect(badPick.issues?.[0]?.target).toBe('edges[0]')
    expect(listChainVersions(workspace, SITE, FLOW)).toEqual([1])
  })
})
