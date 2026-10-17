/**
 * 链模块测试夹具：假卡 + 链文档构造器（内存，不碰磁盘）。
 *
 * @module dsh-dataforge/test/chains/fixtures
 */
import type { CardResolver, ChainDoc, ChainNode, InterfaceCardDoc } from '../../src/chains/schema.js'

/** 搜索材料：出参是数组形态（`[*]` 与 `[0]` 必须能对上）。 */
export const searchCard: InterfaceCardDoc = {
  cardId: 'card_000123',
  kind: 'interface-card',
  identity: { mergeKey: 'GET /api/materials:q', method: 'GET', urlTemplate: '/api/materials?q={q}' },
  inputs: [
    { path: 'query.q', type: 'string', required: true, role: 'search-key' },
    { path: 'query.orgId', type: 'string', required: true },
  ],
  outputs: [
    { path: 'body.items[*].internalId', type: 'string' },
    { path: 'body.items[*].materialCode', type: 'string' },
  ],
}

/** 创建采购单：入参是嵌套数组形态。 */
export const createOrderCard: InterfaceCardDoc = {
  cardId: 'card_000457',
  kind: 'interface-card',
  identity: { mergeKey: 'POST /api/orders', method: 'POST', urlTemplate: '/api/orders' },
  inputs: [
    { path: 'body.lines[0].materialId', type: 'string', required: true },
    { path: 'body.lines[0].quantity', type: 'number', required: true },
    { path: 'body.orgId', type: 'string', required: true },
  ],
  outputs: [{ path: 'body.orderNo', type: 'string' }],
}

/** 材料详情：出参叶子名与搜索卡出参同名（编译建议要能匹配上）。 */
export const detailCard: InterfaceCardDoc = {
  cardId: 'card_000999',
  kind: 'interface-card',
  identity: { mergeKey: 'GET /api/materials/detail:id', method: 'GET', urlTemplate: '/api/materials/detail/{id}' },
  inputs: [{ path: 'body.internalId', type: 'string', required: true }],
  outputs: [{ path: 'body.stockQty', type: 'number' }],
}

export function resolverOf(...cards: InterfaceCardDoc[]): CardResolver {
  const map = new Map(cards.map((card) => [card.cardId, card]))
  return (cardId: string) => map.get(cardId)
}

export const allCards = resolverOf(searchCard, createOrderCard, detailCard)

export function node(overrides: Partial<ChainNode> & { id: string }): ChainNode {
  return { constants: {}, ...overrides }
}

/** 一份默认合法的两节点链（搜索 → 下单）。 */
export function chainDoc(overrides: Partial<ChainDoc> = {}): ChainDoc {
  return {
    apiVersion: 'dataforge/v1',
    kind: 'interface-chain',
    meta: { site: '智慧供应链 SCM', flow: '采购下单', version: 1, created: '2026-10-17T12:00:00Z' },
    inputs: [],
    nodes: [
      node({ id: 'query-material', card: 'card_000123', constants: { 'query.orgId': '2120' } }),
      node({ id: 'create-order', card: 'card_000457', constants: { 'body.lines[0].quantity': '10' } }),
    ],
    edges: [
      {
        from: 'query-material.body.items[0].internalId',
        to: 'create-order.body.lines[0].materialId',
      },
    ],
    ...overrides,
  }
}

/** 页面链：两个页面节点 + 一条动线。 */
export function pageChainDoc(overrides: Partial<ChainDoc> = {}): ChainDoc {
  return {
    apiVersion: 'dataforge/v1',
    kind: 'page-chain',
    meta: { site: '智慧供应链 SCM', flow: '采购下单', version: 1, created: '2026-10-17T12:00:00Z' },
    inputs: [],
    nodes: [
      node({ id: 'page-search', page: '/materials' }),
      node({ id: 'page-detail', page: '/materials/detail' }),
    ],
    edges: [{ from: 'page-search', to: 'page-detail' }],
    ...overrides,
  }
}
