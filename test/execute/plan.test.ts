/**
 * 执行计划编译：预检失败码、静态缺参、槽位、拓扑序与写方法清单。
 *
 * @module dsh-dataforge/test/execute/plan
 */
import { describe, expect, it } from 'vitest'
import type { ChainDoc, InterfaceCardDoc } from '../../src/chains/schema.js'
import type { ExecutionPlan, PlanResult } from '../../src/execute/plan.js'
import { buildPlan } from '../../src/execute/plan.js'
import {
  chainDoc,
  createOrderCard,
  detailCard,
  node,
  pageChainDoc,
  searchCard,
} from '../chains/fixtures.js'

const BASE = 'https://scm.example.com'

function cardsOf(...cards: InterfaceCardDoc[]): Map<string, InterfaceCardDoc> {
  return new Map(cards.map((card) => [card.cardId, card]))
}

function successOf(result: PlanResult): { plan: ExecutionPlan; notices: string[] } {
  if (!result.ok) throw new Error(`期望计划成功，实际是 ${result.code}：${result.message}`)
  return { plan: result.plan, notices: result.notices }
}

function failureOf(result: PlanResult): Extract<PlanResult, { ok: false }> {
  if (result.ok) throw new Error('期望预检失败，实际计划成功')
  return result
}

/** 无入参的 GET 卡：用来隔离 baseUrl / 环 / 卡缺失这些前置判定。 */
const pingCard: InterfaceCardDoc = {
  cardId: 'card_ping',
  kind: 'interface-card',
  identity: { mergeKey: 'GET /api/ping', method: 'GET', urlTemplate: '/api/ping' },
  inputs: [],
  outputs: [],
}

/** 只有一个入参的 POST 卡：缺参用例的最小夹具。 */
const orgCard: InterfaceCardDoc = {
  cardId: 'card_org',
  kind: 'interface-card',
  identity: { mergeKey: 'POST /api/orders', method: 'POST', urlTemplate: '/api/orders' },
  inputs: [{ path: 'body.orgId', type: 'string', required: true }],
  outputs: [],
}

describe('静态缺参：missing-params', () => {
  it('卡有 body.orgId 且既无常量也无绑定 → 指到该字段', () => {
    const doc = chainDoc({
      nodes: [node({ id: 'create-order', card: orgCard.cardId })],
      edges: [],
    })

    const failure = failureOf(buildPlan(doc, cardsOf(orgCard), {}, BASE))

    expect(failure.code).toBe('missing-params')
    expect(failure.gaps).toHaveLength(1)
    expect(failure.gaps[0]).toMatchObject({
      nodeId: 'create-order',
      path: 'body.orgId',
      type: 'string',
    })
    expect(failure.message).toContain('body.orgId')
  })

  it('缺参与 baseUrl 同时不满足时先报 missing-params（链定义先修，再谈 baseUrl）', () => {
    const doc = chainDoc({
      nodes: [node({ id: 'create-order', card: orgCard.cardId })],
      edges: [],
    })

    // 没传 baseUrl 也一样：静态缺参是链定义问题，优先于运行期配置
    expect(failureOf(buildPlan(doc, cardsOf(orgCard), {})).code).toBe('missing-params')
  })

  it('required: false 的字段照样报缺参（判据不看 required）', () => {
    const card: InterfaceCardDoc = {
      cardId: 'card_keyword',
      kind: 'interface-card',
      identity: { mergeKey: 'GET /api/materials', method: 'GET', urlTemplate: '/api/materials?q={q}' },
      inputs: [{ path: 'query.keyword', type: 'string', required: false }],
      outputs: [],
    }
    const doc = chainDoc({
      nodes: [node({ id: 'query-material', card: card.cardId })],
      edges: [],
    })

    const failure = failureOf(buildPlan(doc, cardsOf(card), {}, BASE))

    expect(failure.code).toBe('missing-params')
    expect(failure.gaps.map((gap) => gap.path)).toContain('query.keyword')
  })
})

describe('有值/绑定的节点不报缺参', () => {
  it('有常量 → ok', () => {
    const doc = chainDoc({
      nodes: [node({ id: 'query-material', card: searchCard.cardId, constants: { 'query.q': '螺丝', 'query.orgId': '2120' } })],
      edges: [],
    })

    const { plan } = successOf(buildPlan(doc, cardsOf(searchCard), {}, BASE))

    expect(plan.gaps).toEqual([])
    expect(plan.nodes[0]?.gaps).toEqual([])
  })

  it('有绑定 → ok，且 dependsOn 指到上游', () => {
    const sourceCard: InterfaceCardDoc = {
      cardId: 'card_source',
      kind: 'interface-card',
      identity: { mergeKey: 'GET /api/org', method: 'GET', urlTemplate: '/api/org' },
      inputs: [],
      outputs: [{ path: 'body.orgId', type: 'string' }],
    }
    const doc = chainDoc({
      nodes: [
        node({ id: 'query-org', card: sourceCard.cardId }),
        node({ id: 'create-order', card: orgCard.cardId }),
      ],
      edges: [{ from: 'query-org.body.orgId', to: 'create-order.body.orgId' }],
    })

    const { plan } = successOf(buildPlan(doc, cardsOf(sourceCard, orgCard), {}, BASE))

    expect(plan.order).toEqual(['query-org', 'create-order'])
    expect(plan.nodes.find((entry) => entry.nodeId === 'create-order')?.dependsOn).toEqual(['query-org'])
  })

  it('role: credential → 不报缺参，只记一条 auth-not-injected 提示', () => {
    const authCard: InterfaceCardDoc = {
      cardId: 'card_auth',
      kind: 'interface-card',
      identity: { mergeKey: 'GET /api/me', method: 'GET', urlTemplate: '/api/me' },
      inputs: [{ path: 'header.authorization', type: 'string', required: true, role: 'credential' }],
      outputs: [],
    }
    const doc = chainDoc({
      nodes: [node({ id: 'whoami', card: authCard.cardId })],
      edges: [],
    })

    const { plan, notices } = successOf(buildPlan(doc, cardsOf(authCard), {}, BASE))

    expect(plan.gaps).toEqual([])
    expect(notices).toHaveLength(1)
    expect(notices[0]).toContain('auth-not-injected')
    expect(notices[0]).toContain('whoami')
  })
})

describe('链级槽位：缺运行值即 missing-params', () => {
  it('常量值引用 $inputs.x，没给值 → 缺参；给了值 → ok', () => {
    const doc = chainDoc({
      inputs: [{ name: 'materialCodes', type: 'array<string>', required: false }],
      nodes: [
        node({
          id: 'query-material',
          card: searchCard.cardId,
          constants: { 'query.q': '$inputs.materialCodes', 'query.orgId': '2120' },
        }),
      ],
      edges: [],
    })

    // required: false 也不作为判据：被引用就需要值
    const failure = failureOf(buildPlan(doc, cardsOf(searchCard), {}, BASE))
    expect(failure.code).toBe('missing-params')
    expect(failure.gaps).toHaveLength(1)
    expect(failure.gaps[0]).toMatchObject({
      nodeId: 'query-material',
      path: '$inputs.materialCodes',
      type: 'array<string>',
    })

    const { plan } = successOf(buildPlan(doc, cardsOf(searchCard), { materialCodes: ['M-1'] }, BASE))
    expect(plan.gaps).toEqual([])
  })

  it('边 from 引用 $inputs.x 同样要运行值，且不产生幻影依赖', () => {
    const doc = chainDoc({
      inputs: [{ name: 'materialCode', type: 'string', required: true }],
      nodes: [node({ id: 'query-detail', card: detailCard.cardId })],
      edges: [{ from: '$inputs.materialCode', to: 'query-detail.body.internalId' }],
    })

    const failure = failureOf(buildPlan(doc, cardsOf(detailCard), {}, BASE))
    expect(failure.code).toBe('missing-params')
    expect(failure.gaps[0]).toMatchObject({
      nodeId: 'query-detail',
      path: '$inputs.materialCode',
      type: 'string',
    })

    const { plan } = successOf(buildPlan(doc, cardsOf(detailCard), { materialCode: 'M-1' }, BASE))
    expect(plan.nodes[0]?.dependsOn).toEqual([])
  })
})

describe('前置预检失败码', () => {
  it('page-chain → not-executable（不在执行段补页面语义）', () => {
    const failure = failureOf(buildPlan(pageChainDoc(), new Map(), {}, BASE))

    expect(failure.code).toBe('not-executable')
    expect(failure.message).toContain('page-chain')
  })

  it('baseUrl 缺省 → base-url-unresolved', () => {
    const doc = chainDoc({ nodes: [node({ id: 'ping', card: pingCard.cardId })], edges: [] })

    const failure = failureOf(buildPlan(doc, cardsOf(pingCard), {}))

    expect(failure.code).toBe('base-url-unresolved')
  })

  it('baseUrl 非 http(s) / 非法 URL → base-url-unresolved', () => {
    const doc = chainDoc({ nodes: [node({ id: 'ping', card: pingCard.cardId })], edges: [] })

    expect(failureOf(buildPlan(doc, cardsOf(pingCard), {}, 'ftp://scm.example.com')).code).toBe(
      'base-url-unresolved',
    )
    expect(failureOf(buildPlan(doc, cardsOf(pingCard), {}, 'scm.example.com')).code).toBe(
      'base-url-unresolved',
    )
  })

  it('成环 → cycle，回执带环上的节点', () => {
    const doc = chainDoc({
      nodes: [
        node({ id: 'ping-a', card: pingCard.cardId }),
        node({ id: 'ping-b', card: pingCard.cardId }),
      ],
      edges: [
        { from: 'ping-a.body.x', to: 'ping-b.body.y' },
        { from: 'ping-b.body.y', to: 'ping-a.body.x' },
      ],
    })

    const failure = failureOf(buildPlan(doc, cardsOf(pingCard), {}, BASE))

    expect(failure.code).toBe('cycle')
    expect(failure.cycle).toEqual(expect.arrayContaining(['ping-a', 'ping-b']))
    expect(failure.gaps).toEqual([])
  })

  it('卡不在项目接口库 → card-not-imported', () => {
    const doc = chainDoc({
      nodes: [node({ id: 'ping', card: 'card_000404' })],
      edges: [],
    })

    const failure = failureOf(buildPlan(doc, cardsOf(pingCard), {}, BASE))

    expect(failure.code).toBe('card-not-imported')
    expect(failure.message).toContain('card_000404')
    expect(failure.message).toContain('dataforge_library_import')
  })
})

describe('合法三节点链', () => {
  function threeNodeDoc(): ChainDoc {
    return chainDoc({
      nodes: [
        node({
          id: 'query-material',
          card: searchCard.cardId,
          constants: { 'query.q': '螺丝', 'query.orgId': '2120' },
        }),
        node({ id: 'query-detail', card: detailCard.cardId }),
        node({
          id: 'create-order',
          card: createOrderCard.cardId,
          constants: { 'body.lines[0].quantity': '10', 'body.orgId': '2120' },
        }),
      ],
      edges: [
        { from: 'query-material.body.items[0].internalId', to: 'query-detail.body.internalId' },
        { from: 'query-material.body.items[0].materialCode', to: 'create-order.body.lines[0].materialId' },
      ],
    })
  }

  it('ok: true，order 是合法拓扑序，writeNodes 只含写方法节点', () => {
    const doc = threeNodeDoc()
    const { plan } = successOf(buildPlan(doc, cardsOf(searchCard, detailCard, createOrderCard), {}, BASE))

    expect(plan.totalNodes).toBe(3)
    expect(plan.order).toHaveLength(3)
    expect(new Set(plan.order)).toEqual(new Set(['query-material', 'query-detail', 'create-order']))
    expect(plan.nodes.map((entry) => entry.nodeId)).toEqual(plan.order)

    const position = new Map(plan.order.map((id, index) => [id, index]))
    for (const [upstream, downstream] of [
      ['query-material', 'query-detail'],
      ['query-material', 'create-order'],
    ]) {
      expect(position.get(upstream) as number).toBeLessThan(position.get(downstream) as number)
    }

    expect(plan.writeNodes).toEqual(['create-order'])
    expect(plan.baseUrl).toBe(BASE)
    expect(plan.gaps).toEqual([])

    const orderNode = plan.nodes.find((entry) => entry.nodeId === 'create-order')
    expect(orderNode).toMatchObject({
      cardId: createOrderCard.cardId,
      method: 'POST',
      urlTemplate: '/api/orders',
      dependsOn: ['query-material'],
    })
  })

  it('同一输入两次编译的计划完全一致（dry-run 可重复）', () => {
    const doc = threeNodeDoc()
    const first = successOf(buildPlan(doc, cardsOf(searchCard, detailCard, createOrderCard), {}, BASE))
    const second = successOf(buildPlan(doc, cardsOf(searchCard, detailCard, createOrderCard), {}, BASE))

    expect(first.plan).toEqual(second.plan)
    expect(first.notices).toEqual(second.notices)
  })
})
