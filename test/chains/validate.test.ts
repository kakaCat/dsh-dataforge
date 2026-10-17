/**
 * 链语义校验：每类坏定义都能被点名，且指到 nodes[i] / edges[j]。
 *
 * @module dsh-dataforge/test/chains/validate
 */
import { describe, expect, it } from 'vitest'
import type { ChainDoc, ChainIssue, ChainValueType } from '../../src/chains/schema.js'
import { chainErrorCode } from '../../src/chains/schema.js'
import {
  dependencyPairs,
  scanCredentialConstants,
  topoOrder,
  validateChain,
  validateChainYaml,
} from '../../src/chains/validate.js'
import { allCards, chainDoc, node, pageChainDoc, resolverOf, searchCard } from './fixtures.js'

function issuesOf(doc: ChainDoc): ChainIssue[] {
  const result = validateChain(doc, { resolveCard: allCards })
  return result.ok ? [] : result.issues
}

function codesOf(doc: ChainDoc): string[] {
  return issuesOf(doc).map((issue) => issue.code)
}

describe('validateChain 放行合法链', () => {
  it('两节点一绑定的接口链通过校验', () => {
    const result = validateChain(chainDoc(), { resolveCard: allCards })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.doc.edges).toHaveLength(1)
  })

  it('page-chain 用节点 id 当动线两端，不要求卡', () => {
    expect(validateChain(pageChainDoc(), { resolveCard: allCards }).ok).toBe(true)
  })

  it('链级槽位被节点常量引用时合法', () => {
    const doc = chainDoc({
      inputs: [{ name: 'materialCodes', type: 'array<string>', required: true }],
      nodes: [
        node({ id: 'query-material', card: 'card_000123', constants: { 'query.q': '$inputs.materialCodes' } }),
        node({ id: 'create-order', card: 'card_000457', constants: { 'body.lines[0].quantity': '10' } }),
      ],
    })
    expect(issuesOf(doc)).toEqual([])
  })

  it('槽位也可以从边的 from 直接接进来', () => {
    const doc = chainDoc({
      inputs: [{ name: 'materialCode', type: 'string', required: true }],
      edges: [
        { from: '$inputs.materialCode', to: 'query-material.query.q' },
        { from: 'query-material.body.items[0].internalId', to: 'create-order.body.lines[0].materialId' },
      ],
    })
    expect(issuesOf(doc)).toEqual([])
  })
})

describe('悬空卡引用', () => {
  it('卡不在接口库 → card-not-imported，点名节点与卡', () => {
    const doc = chainDoc({
      nodes: [node({ id: 'query-material', card: 'card_999999' }), node({ id: 'create-order', card: 'card_000457' })],
      edges: [],
    })
    const issues = issuesOf(doc)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ target: 'nodes[0]', code: 'card-not-imported' })
    expect(issues[0].reason).toContain('card_999999')
    expect(issues[0].reason).toContain('dataforge_library_import')
    expect(chainErrorCode(issues)).toBe('card-not-imported')
  })
})

describe('绑定字段存在性', () => {
  it('from 不在源卡出参模板里 → unknown-source-field', () => {
    const issues = issuesOf(
      chainDoc({ edges: [{ from: 'query-material.body.nope', to: 'create-order.body.lines[0].materialId' }] }),
    )
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ target: 'edges[0]', code: 'unknown-source-field' })
    expect(issues[0].reason).toContain('出参模板')
  })

  it('to 不在目标卡入参模板里 → unknown-target-field', () => {
    const issues = issuesOf(
      chainDoc({ edges: [{ from: 'query-material.body.items[0].internalId', to: 'create-order.body.nope' }] }),
    )
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ target: 'edges[0]', code: 'unknown-target-field' })
    expect(issues[0].reason).toContain('入参模板')
  })

  it('边路径少写节点前缀 → bad-binding-path', () => {
    const issues = issuesOf(chainDoc({ edges: [{ from: 'query-material', to: 'create-order.body.lines[0].materialId' }] }))
    expect(issues[0]).toMatchObject({ target: 'edges[0]', code: 'bad-binding-path' })
    expect(issues[0].reason).toContain('<节点 id>')
  })

  it('绑定与常量互斥：同一入参既给常量又被绑定 → binding-constant-conflict', () => {
    const issues = issuesOf(
      chainDoc({
        edges: [
          { from: 'query-material.body.items[0].internalId', to: 'create-order.body.lines[0].quantity' },
        ],
      }),
    )
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ target: 'edges[0]', code: 'binding-constant-conflict' })
    expect(issues[0].reason).toContain('互斥')
  })
})

describe('成环', () => {
  it('两条边互相依赖 → cycle，列出环上的节点', () => {
    const issues = issuesOf(
      chainDoc({
        edges: [
          { from: 'query-material.body.items[0].internalId', to: 'create-order.body.lines[0].materialId' },
          { from: 'create-order.body.orderNo', to: 'query-material.query.q' },
        ],
      }),
    )
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ target: 'edges', code: 'cycle' })
    expect(issues[0].reason).toContain('query-material')
    expect(issues[0].reason).toContain('create-order')
  })

  it('topoOrder 排得出无环链，排不出有环链', () => {
    expect(topoOrder(chainDoc())).toEqual({ order: ['query-material', 'create-order'], cycle: [] })
    const cyclic = chainDoc({
      edges: [
        { from: 'query-material.body.items[0].internalId', to: 'create-order.body.lines[0].materialId' },
        { from: 'create-order.body.orderNo', to: 'query-material.query.q' },
      ],
    })
    const result = topoOrder(cyclic)
    expect(result.order).toEqual([])
    expect(result.cycle.sort()).toEqual(['create-order', 'query-material'])
  })

  it('page-chain 动线自指也算环', () => {
    const issues = issuesOf(
      pageChainDoc({
        nodes: [node({ id: 'page-search', page: '/a' })],
        edges: [{ from: 'page-search', to: 'page-search' }],
      }),
    )
    expect(issues.map((issue) => issue.code)).toEqual(['cycle'])
  })
})

describe('节点身份与形态', () => {
  it('节点 id 重复 → duplicate-node-id', () => {
    const issues = issuesOf(
      chainDoc({
        nodes: [
          node({ id: 'query-material', card: 'card_000123' }),
          node({ id: 'query-material', card: 'card_000457' }),
        ],
        edges: [],
      }),
    )
    expect(issues[0]).toMatchObject({ target: 'nodes[1]', code: 'duplicate-node-id' })
  })

  it("节点 id 带 '.' → bad-node-id（绑定路径靠点分隔）", () => {
    const issues = issuesOf(chainDoc({ nodes: [node({ id: 'query.material', card: 'card_000123' })], edges: [] }))
    expect(issues[0]).toMatchObject({ target: 'nodes[0]', code: 'bad-node-id' })
    expect(issues[0].reason).toContain('.')
  })

  it('interface-chain 的节点必须写 card', () => {
    const issues = issuesOf(
      chainDoc({ nodes: [node({ id: 'query-material', page: '/materials' })], edges: [] }),
    )
    expect(issues[0]).toMatchObject({ target: 'nodes[0]', code: 'node-kind-mismatch' })
  })

  it('card 与 page 同时写 → node-kind-mismatch', () => {
    const issues = issuesOf(
      chainDoc({ nodes: [node({ id: 'x', card: 'card_000123', page: '/materials' })], edges: [] }),
    )
    expect(issues[0].code).toBe('node-kind-mismatch')
    expect(issues[0].reason).toContain('同时写了')
  })

  it('page-chain 的节点必须写 page', () => {
    const issues = issuesOf(pageChainDoc({ nodes: [node({ id: 'page-search', card: 'card_000123' })], edges: [] }))
    expect(issues[0]).toMatchObject({ target: 'nodes[0]', code: 'node-kind-mismatch' })
  })

  it('动线指向不存在的页面 → unknown-node', () => {
    const issues = issuesOf(pageChainDoc({ edges: [{ from: 'page-search', to: 'page-ghost' }] }))
    expect(issues[0]).toMatchObject({ target: 'edges[0]', code: 'unknown-node' })
  })

  it('空链直接被拒', () => {
    const issues = issuesOf(chainDoc({ nodes: [], edges: [] }))
    expect(issues.map((issue) => issue.code)).toContain('invalid-chain')
  })

  it('apiVersion 不对 → 指到 chain', () => {
    const issues = issuesOf(chainDoc({ apiVersion: 'dataforge/v2' }))
    expect(issues[0]).toMatchObject({ target: 'chain', code: 'invalid-chain' })
  })
})

describe('入参槽位', () => {
  it('声明了没人用 → unreferenced-input-slot（僵尸槽位）', () => {
    const issues = issuesOf(chainDoc({ inputs: [{ name: 'materialCodes', type: 'array<string>', required: true }] }))
    expect(issues[0]).toMatchObject({ target: 'inputs[0]', code: 'unreferenced-input-slot' })
    expect(issues[0].reason).toContain('僵尸槽位')
  })

  it('引用了没声明 → unknown-input-slot', () => {
    const doc = chainDoc({
      nodes: [
        node({ id: 'query-material', card: 'card_000123', constants: { 'query.q': '$inputs.ghost' } }),
        node({ id: 'create-order', card: 'card_000457' }),
      ],
      edges: [],
    })
    expect(codesOf(doc)).toEqual(['unknown-input-slot'])
  })

  it('槽位名重复 → duplicate-input-slot', () => {
    const doc = chainDoc({
      inputs: [
        { name: 'codes', type: 'string', required: true },
        { name: 'codes', type: 'string', required: true },
      ],
      nodes: [
        node({ id: 'query-material', card: 'card_000123', constants: { 'query.q': '$inputs.codes' } }),
        node({ id: 'create-order', card: 'card_000457' }),
      ],
      edges: [],
    })
    expect(codesOf(doc)).toEqual(['duplicate-input-slot'])
    expect(issuesOf(doc)[0].target).toBe('inputs[1]')
  })

  it('类型不在词表内 → invalid-input-type', () => {
    const doc = chainDoc({
      // 手写 YAML 才会出现的坏类型：类型系统不让写，运行时必须拦
      inputs: [{ name: 'codes', type: 'array<' as ChainValueType, required: true }],
      nodes: [
        node({ id: 'query-material', card: 'card_000123', constants: { 'query.q': '$inputs.codes' } }),
        node({ id: 'create-order', card: 'card_000457' }),
      ],
      edges: [],
    })
    expect(codesOf(doc)).toEqual(['invalid-input-type'])
    expect(issuesOf(doc)[0].reason).toContain('string')
  })
})

describe('一次报全（不 fail-fast）', () => {
  it('多处坏定义一起返回，每条各自点名', () => {
    const doc = chainDoc({
      nodes: [node({ id: 'a', card: 'card_999998' }), node({ id: 'a', card: 'card_999999' })],
      edges: [{ from: 'ghost.body.x', to: 'a.body.lines[0].materialId' }],
    })
    const issues = issuesOf(doc)
    const targets = issues.map((issue) => issue.target)
    expect(targets).toContain('nodes[0]')
    expect(targets).toContain('nodes[1]')
    expect(targets).toContain('edges[0]')
    expect(issues.length).toBeGreaterThanOrEqual(3)
  })
})

describe('YAML 入口', () => {
  it('validateChainYaml 与 validateChain 同纪律', () => {
    const text = `apiVersion: dataforge/v1
kind: interface-chain
meta:
  site: s
  flow: f
  version: 1
  created: 2026-10-17T12:00:00Z
nodes:
  - id: query-material
    card: card_999999
edges: []
`
    const result = validateChainYaml(text, { resolveCard: allCards })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues[0].code).toBe('card-not-imported')
  })
})

describe('凭证红线（提示不阻断）', () => {
  it('常量里出现凭证字段名时给出提示，但不拦校验', () => {
    const doc = chainDoc({
      nodes: [
        node({ id: 'query-material', card: 'card_000123', constants: { 'header.cookie': 'SESSION=abc' } }),
        node({ id: 'create-order', card: 'card_000457' }),
      ],
      edges: [{ from: 'query-material.body.items[0].internalId', to: 'create-order.body.lines[0].materialId' }],
    })
    expect(validateChain(doc, { resolveCard: allCards }).ok).toBe(true)
    const warnings = scanCredentialConstants(doc)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ target: 'nodes[0]', code: 'credential-in-constants' })
    expect(warnings[0].reason).toContain('R-4')
  })

  it('业务字段 body.token 不误报（叶子名精确匹配）', () => {
    const doc = chainDoc({
      nodes: [node({ id: 'query-material', card: 'card_000123', constants: { 'body.tokenType': 'bearer' } })],
      edges: [],
    })
    expect(scanCredentialConstants(doc)).toEqual([])
  })
})

describe('卡解析器可注入（解耦缝）', () => {
  it('换一份卡集合就换一套判定，不需要碰磁盘', () => {
    const onlySearch = resolverOf(searchCard)
    const result = validateChain(
      chainDoc({ edges: [] }),
      { resolveCard: onlySearch },
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues[0]).toMatchObject({ target: 'nodes[1]', code: 'card-not-imported' })
  })
})

describe('依赖对（拓扑消费者）', () => {
  /** 槽位边 + 一条真绑定边：槽位边不该出现在依赖对里。 */
  const withSlotEdge = (): ChainDoc => chainDoc({
    inputs: [{ name: 'orgId', type: 'string', required: true }],
    nodes: [
      node({ id: 'query-material', card: 'card_000123', constants: { 'query.orgId': '$inputs.orgId' } }),
      node({ id: 'create-order', card: 'card_000457', constants: { 'body.lines[0].quantity': '10' } }),
    ],
    edges: [
      { from: 'query-material.body.items[0].internalId', to: 'create-order.body.lines[0].materialId' },
      { from: '$inputs.orgId', to: 'create-order.body.orgId' },
    ],
  })

  it('槽位边不产出依赖对：splitBindingPath 会把 $inputs 当节点名，必须显式跳过', () => {
    const pairs = dependencyPairs(withSlotEdge())
    expect(pairs).toEqual([{ from: 'query-material', to: 'create-order' }])
    // 幻影边（from='$inputs'）会让执行引擎的调度去等一个不存在的上游节点。
    expect(pairs.some((pair) => pair.from === '$inputs')).toBe(false)
  })

  it('槽位边不影响拓扑序，链本身仍然合法', () => {
    const doc = withSlotEdge()
    expect(validateChain(doc, { resolveCard: allCards }).ok).toBe(true)
    expect(topoOrder(doc)).toEqual({ order: ['query-material', 'create-order'], cycle: [] })
  })

  it('只有槽位边时依赖对为空，两节点都不进环', () => {
    const doc = chainDoc({
      inputs: [{ name: 'orgId', type: 'string', required: true }],
      nodes: [
        node({ id: 'query-material', card: 'card_000123', constants: { 'query.orgId': '$inputs.orgId' } }),
        node({ id: 'create-order', card: 'card_000457', constants: { 'body.lines[0].quantity': '10' } }),
      ],
      edges: [{ from: '$inputs.orgId', to: 'create-order.body.orgId' }],
    })
    expect(dependencyPairs(doc)).toEqual([])
    const topo = topoOrder(doc)
    expect(topo.cycle).toEqual([])
    expect(topo.order.sort()).toEqual(['create-order', 'query-material'])
  })
})
