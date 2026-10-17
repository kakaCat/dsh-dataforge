/**
 * 覆盖判定：`normalizePath` / `coveredPaths` / `missingInputs` / `checkValueType`。
 *
 * 钉死的硬规则：判据不看卡上的 `required`；常量、绑定、credential 三种豁免各自成立。
 *
 * @module dsh-dataforge/test/execute/coverage
 */
import { describe, expect, it } from 'vitest'
import type { InterfaceCardDoc } from '../../src/chains/schema.js'
import {
  checkValueType,
  coveredPaths,
  missingInputs,
  normalizePath,
} from '../../src/execute/coverage.js'
import { chainDoc, createOrderCard, node, searchCard } from '../chains/fixtures.js'

describe('normalizePath 与 R-1 同一把尺', () => {
  it('[0] / [*] / [] 归一到同一个路径', () => {
    expect(normalizePath('body.items[0].internalId')).toBe('body.items[*].internalId')
    expect(normalizePath('body.items[*].internalId')).toBe('body.items[*].internalId')
    expect(normalizePath('body.items[].internalId')).toBe('body.items[*].internalId')
    expect(normalizePath('body.items[ 0 ].internalId')).toBe('body.items[*].internalId')
  })
})

describe('coveredPaths：常量 ∪ 入边', () => {
  it('节点常量键与以该节点为终点的绑定边都算覆盖，且路径已归一', () => {
    const doc = chainDoc()
    const covered = coveredPaths(doc, doc.nodes[1])

    expect(covered.has('body.lines[*].quantity')).toBe(true) // 常量 body.lines[0].quantity
    expect(covered.has('body.lines[*].materialId')).toBe(true) // 边 to: create-order.body.lines[0].materialId
    expect(covered.has('body.orgId')).toBe(false)
  })

  it('指向别的节点的边不污染本节点覆盖', () => {
    const doc = chainDoc()
    const covered = coveredPaths(doc, doc.nodes[0])

    expect(covered.has('query.orgId')).toBe(true)
    expect(covered.has('query.q')).toBe(false)
    expect(covered.has('body.lines[*].materialId')).toBe(false)
  })
})

describe('missingInputs：不看 required，只看覆盖与 credential', () => {
  it('body.orgId 既无常量也无绑定 → 报缺参，path/type 指到卡字段', () => {
    const target = node({ id: 'create-order', card: createOrderCard.cardId })
    const covered = new Set(['body.lines[*].materialId', 'body.lines[*].quantity'])

    const gaps = missingInputs(target, createOrderCard, covered)

    expect(gaps).toHaveLength(1)
    expect(gaps[0]).toMatchObject({
      nodeId: 'create-order',
      path: 'body.orgId',
      type: 'string',
    })
  })

  it('required: false 的字段照样报缺参（钉住「不看 required」）', () => {
    const card: InterfaceCardDoc = {
      cardId: 'card_optional',
      kind: 'interface-card',
      identity: { mergeKey: 'POST /api/orders', method: 'POST', urlTemplate: '/api/orders' },
      inputs: [{ path: 'query.keyword', type: 'string', required: false }],
      outputs: [],
    }
    const target = node({ id: 'search', card: card.cardId })

    const gaps = missingInputs(target, card, new Set())

    expect(gaps).toHaveLength(1)
    expect(gaps[0]).toMatchObject({ nodeId: 'search', path: 'query.keyword', type: 'string' })
  })

  it('有常量 → 不报缺参（[0]/[*] 写法差异不影响）', () => {
    // 常量用 [0] 写、卡模板用 [*] 写，归一后必须能对上
    const target = node({
      id: 'query-material',
      card: searchCard.cardId,
      constants: { 'query.q': '螺丝', 'query.orgId': '2120' },
    })
    const covered = coveredPaths(chainDoc({ edges: [] }), target)

    expect(missingInputs(target, searchCard, covered)).toEqual([])
  })

  it('有绑定 → 不报缺参', () => {
    const doc = chainDoc({
      nodes: [
        node({ id: 'query-material', card: 'card_000123', constants: { 'query.orgId': '2120' } }),
        node({
          id: 'create-order',
          card: 'card_000457',
          constants: { 'body.lines[0].quantity': '10', 'body.orgId': '2120' },
        }),
      ],
    })
    const gaps = missingInputs(doc.nodes[1], createOrderCard, coveredPaths(doc, doc.nodes[1]))

    expect(gaps).toEqual([])
  })

  it('role: credential → 不报缺参、也不要求有值', () => {
    const card: InterfaceCardDoc = {
      cardId: 'card_auth',
      kind: 'interface-card',
      identity: { mergeKey: 'GET /api/me', method: 'GET', urlTemplate: '/api/me' },
      inputs: [{ path: 'header.authorization', type: 'string', required: true, role: 'credential' }],
      outputs: [],
    }
    const target = node({ id: 'whoami', card: card.cardId })

    expect(missingInputs(target, card, new Set())).toEqual([])
  })
})

describe('checkValueType：槽位值的类型校验', () => {
  it('标量类型全部放行', () => {
    expect(checkValueType('inputs.s', 'string', 'a')).toBeUndefined()
    expect(checkValueType('inputs.n', 'number', 1)).toBeUndefined()
    expect(checkValueType('inputs.b', 'boolean', true)).toBeUndefined()
    expect(checkValueType('inputs.o', 'object', { a: 1 })).toBeUndefined()
    expect(checkValueType('inputs.a', 'array', [1, 2])).toBeUndefined()
    expect(checkValueType('inputs.z', 'null', null)).toBeUndefined()
  })

  it('array<T> 逐个元素校验', () => {
    expect(checkValueType('inputs.codes', 'array<string>', ['M-1', 'M-2'])).toBeUndefined()

    const reason = checkValueType('inputs.codes', 'array<string>', ['M-1', 2])
    expect(reason).toBeDefined()
    expect(reason).toContain('inputs.codes[1]')
    expect(reason).toContain('string')
  })

  it('类型不符返回中文原因并带路径', () => {
    expect(checkValueType('inputs.n', 'number', '10')).toContain('inputs.n')
    expect(checkValueType('inputs.o', 'object', [])).toContain('object')
    expect(checkValueType('inputs.z', 'null', 0)).toContain('null')
  })

  it('未知类型失败关闭', () => {
    expect(checkValueType('inputs.d', 'date', '2026-10-17')).toContain('未知的值类型')
  })
})
