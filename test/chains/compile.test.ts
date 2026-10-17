/**
 * 页面编排编译：page-chain → interface-chain 草稿。
 *
 * @module dsh-dataforge/test/chains/compile
 */
import { describe, expect, it } from 'vitest'
import type { InterfaceCardDoc } from '../../src/chains/schema.js'
import { compilePageChain } from '../../src/chains/compile.js'
import type { PageCardRelation } from '../../src/chains/compile.js'
import { topoOrder, validateChain } from '../../src/chains/validate.js'
import { allCards, chainDoc, pageChainDoc, resolverOf, searchCard } from './fixtures.js'

/** 按页面 URL 给关系的假采集库。 */
function relations(map: Record<string, PageCardRelation[]>): (pageUrl: string) => PageCardRelation[] {
  return (pageUrl: string) => map[pageUrl] ?? []
}

const TWO_PAGES = relations({
  '/materials': [{ pageUrl: '/materials', cardId: 'card_000123', paramsFingerprint: 'q' }],
  '/materials/detail': [{ pageUrl: '/materials/detail', cardId: 'card_000999', paramsFingerprint: 'id' }],
})

describe('编译成接口草稿', () => {
  it('页面节点展开成接口节点，动线落成先后约束', () => {
    const result = compilePageChain(pageChainDoc(), { relationsForPage: TWO_PAGES, resolveCard: allCards })
    expect(result.doc.kind).toBe('interface-chain')
    expect(result.doc.nodes.map((node) => node.id)).toEqual([
      'page-search--card_000123',
      'page-detail--card_000999',
    ])
    expect(result.doc.nodes[0].card).toBe('card_000123')
    expect(result.doc.nodes[0].page).toBeUndefined()
    expect(result.precedence).toEqual([
      {
        from: 'page-search--card_000123',
        to: 'page-detail--card_000999',
        viaPageEdge: { from: 'page-search', to: 'page-detail' },
      },
    ])
    expect(result.unresolvedPages).toEqual([])
  })

  it('跨节点同名字段给出候选绑定，并标 suggested', () => {
    const result = compilePageChain(pageChainDoc(), { relationsForPage: TWO_PAGES, resolveCard: allCards })
    expect(result.doc.edges).toEqual([
      {
        from: 'page-search--card_000123.body.items[*].internalId',
        to: 'page-detail--card_000999.body.internalId',
        suggested: true,
      },
    ])
  })

  it('草稿本身过得了校验（候选绑定都是合法绑定）', () => {
    const result = compilePageChain(pageChainDoc(), { relationsForPage: TWO_PAGES, resolveCard: allCards })
    const checked = validateChain(result.doc, { resolveCard: allCards })
    expect(checked.ok).toBe(true)
  })

  it('草稿带上了源链的 inputs 声明（R-6 结晶要用的槽位）', () => {
    const doc = pageChainDoc({ inputs: [{ name: 'materialCodes', type: 'array<string>', required: true }] })
    const result = compilePageChain(doc, { relationsForPage: TWO_PAGES, resolveCard: allCards })
    expect(result.doc.inputs).toEqual([{ name: 'materialCodes', type: 'array<string>', required: true }])
  })

  it('不改输入（编译是纯函数）', () => {
    const doc = pageChainDoc()
    const before = JSON.stringify(doc)
    compilePageChain(doc, { relationsForPage: TWO_PAGES, resolveCard: allCards })
    expect(JSON.stringify(doc)).toBe(before)
  })
})

describe('拿不准的如实说', () => {
  it('页面没有采集关系 → unresolvedPages 点名，不假装编译成功', () => {
    const result = compilePageChain(pageChainDoc(), {
      relationsForPage: relations({ '/materials': [{ pageUrl: '/materials', cardId: 'card_000123' }] }),
      resolveCard: allCards,
    })
    expect(result.unresolvedPages).toEqual(['page-detail'])
    expect(result.notices.join('\n')).toContain('编译不出接口')
  })

  it('同页同卡多种入参形态：只出一个节点，并提示形态差异', () => {
    const result = compilePageChain(pageChainDoc(), {
      relationsForPage: relations({
        '/materials': [
          { pageUrl: '/materials', cardId: 'card_000123', paramsFingerprint: 'q' },
          { pageUrl: '/materials', cardId: 'card_000123', paramsFingerprint: 'q+org' },
        ],
        '/materials/detail': [{ pageUrl: '/materials/detail', cardId: 'card_000999' }],
      }),
      resolveCard: allCards,
    })
    expect(result.doc.nodes).toHaveLength(2)
    expect(result.notices.join('\n')).toContain('2 种入参形态')
  })

  it('卡不在接口库 → 跳过建议并提示', () => {
    const result = compilePageChain(pageChainDoc(), {
      relationsForPage: TWO_PAGES,
      resolveCard: resolverOf(searchCard),
    })
    expect(result.doc.edges).toEqual([])
    expect(result.notices.join('\n')).toContain('card_000999')
    expect(result.notices.join('\n')).toContain('不在接口库')
  })

  it('没给卡解析器时只做页面展开，不给绑定建议', () => {
    const result = compilePageChain(pageChainDoc(), { relationsForPage: TWO_PAGES })
    expect(result.doc.nodes).toHaveLength(2)
    expect(result.doc.edges).toEqual([])
    expect(result.notices.join('\n')).toContain('人工绑定')
  })

  it('输入不是 page-chain 时原样返回并提示', () => {
    const doc = chainDoc()
    const result = compilePageChain(doc, { relationsForPage: TWO_PAGES, resolveCard: allCards })
    expect(result.doc).toBe(doc)
    expect(result.notices[0]).toContain('不是 page-chain')
  })
})

describe('建议不成环', () => {
  const cardA: InterfaceCardDoc = {
    cardId: 'card_A',
    kind: 'interface-card',
    identity: { mergeKey: 'POST /a', method: 'POST', urlTemplate: '/a' },
    inputs: [{ path: 'body.b', type: 'string' }],
    outputs: [{ path: 'body.a', type: 'string' }],
  }
  const cardB: InterfaceCardDoc = {
    cardId: 'card_B',
    kind: 'interface-card',
    identity: { mergeKey: 'POST /b', method: 'POST', urlTemplate: '/b' },
    inputs: [{ path: 'body.a', type: 'string' }],
    outputs: [{ path: 'body.b', type: 'string' }],
  }

  it('双向动线只留不会成环的那条建议', () => {
    const doc = pageChainDoc({
      nodes: [
        { id: 'p1', page: '/p1', constants: {} },
        { id: 'p2', page: '/p2', constants: {} },
      ],
      edges: [
        { from: 'p1', to: 'p2' },
        { from: 'p2', to: 'p1' },
      ],
    })
    const result = compilePageChain(doc, {
      relationsForPage: relations({
        '/p1': [{ pageUrl: '/p1', cardId: 'card_A' }],
        '/p2': [{ pageUrl: '/p2', cardId: 'card_B' }],
      }),
      resolveCard: resolverOf(cardA, cardB),
    })
    expect(result.doc.edges).toHaveLength(1)
    expect(result.notices.join('\n')).toContain('成环')
    expect(topoOrder(result.doc).cycle).toEqual([])
    expect(validateChain(result.doc, { resolveCard: resolverOf(cardA, cardB) }).ok).toBe(true)
  })

  it('同页多卡按关系顺序排先后（并提示需人工确认）', () => {
    const result = compilePageChain(pageChainDoc({ nodes: [{ id: 'p1', page: '/p1', constants: {} }], edges: [] }), {
      relationsForPage: relations({
        '/p1': [
          { pageUrl: '/p1', cardId: 'card_A' },
          { pageUrl: '/p1', cardId: 'card_B' },
        ],
      }),
      resolveCard: resolverOf(cardA, cardB),
    })
    expect(result.doc.nodes.map((node) => node.id)).toEqual(['p1--card_A', 'p1--card_B'])
    expect(result.doc.edges).toEqual([
      { from: 'p1--card_A.body.a', to: 'p1--card_B.body.a', suggested: true },
    ])
    expect(result.notices.join('\n')).toContain('人工确认')
  })
})
