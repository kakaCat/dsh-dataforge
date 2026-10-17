/**
 * 链 YAML 契约：形状校验、默认值、路径语法。
 *
 * @module dsh-dataforge/test/chains/schema
 */
import { describe, expect, it } from 'vitest'
import {
  CHAIN_API_VERSION,
  chainErrorCode,
  chainToYaml,
  fieldLeaf,
  fieldSegments,
  inputSlotNameOf,
  inputSlotRef,
  isFieldDeclared,
  isInputSlotRef,
  issueTargetOf,
  parseCardDoc,
  parseChainDoc,
  parseChainYaml,
  splitBindingPath,
} from '../../src/chains/schema.js'
import { chainDoc } from './fixtures.js'

const VALID_YAML = `apiVersion: dataforge/v1
kind: interface-chain
meta:
  site: 智慧供应链 SCM
  flow: 采购下单
  version: 3
  created: 2026-10-17T12:00:00Z
inputs:
  - name: materialCodes
    type: array<string>
    required: true
nodes:
  - id: query-material
    card: card_000123
    constants:
      query.orgId: 2120
  - id: create-order
    card: card_000457
edges:
  - from: query-material.body.items[0].internalId
    to: create-order.body.lines[0].materialId
`

describe('parseChainYaml', () => {
  it('吃下设计文档里那份链 YAML，并补默认值', () => {
    const parsed = parseChainYaml(VALID_YAML)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.doc.apiVersion).toBe(CHAIN_API_VERSION)
    expect(parsed.doc.kind).toBe('interface-chain')
    expect(parsed.doc.meta).toMatchObject({ site: '智慧供应链 SCM', flow: '采购下单', version: 3 })
    expect(parsed.doc.inputs).toEqual([
      { name: 'materialCodes', type: 'array<string>', required: true },
    ])
    expect(parsed.doc.nodes).toHaveLength(2)
    expect(parsed.doc.edges).toEqual([
      {
        from: 'query-material.body.items[0].internalId',
        to: 'create-order.body.lines[0].materialId',
      },
    ])
  })

  it('常量裸写数字也收（常量统一成字符串，避免 YAML 类型踩坑）', () => {
    const parsed = parseChainYaml(VALID_YAML)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.doc.nodes[0].constants).toEqual({ 'query.orgId': '2120' })
  })

  it('缺必填字段时把错误指到对应节点上', () => {
    const parsed = parseChainYaml(`apiVersion: dataforge/v1
kind: interface-chain
meta:
  site: s
  flow: f
  version: 1
  created: 2026-10-17T12:00:00Z
nodes:
  - id: query-material
    card: 123
`)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.issues[0]).toMatchObject({ target: 'nodes[0]', code: 'invalid-chain' })
    expect(parsed.issues[0].reason).toContain('expected string')
  })

  it('缺 meta.version 指到 meta，kind 写错指到 chain', () => {
    const missingVersion = parseChainYaml(`apiVersion: dataforge/v1
kind: interface-chain
meta:
  site: s
  flow: f
  created: 2026-10-17
nodes: []
`)
    expect(missingVersion.ok).toBe(false)
    if (!missingVersion.ok) expect(missingVersion.issues[0].target).toBe('meta')

    const badKind = parseChainYaml(`apiVersion: dataforge/v1
kind: zzz
meta: { site: s, flow: f, version: 1, created: '2026-10-17' }
nodes: []
`)
    expect(badKind.ok).toBe(false)
    if (!badKind.ok) expect(badKind.issues[0].target).toBe('kind')
  })

  it('YAML 语法坏掉 / 不是映射时都报 invalid-chain', () => {
    const broken = parseChainYaml('apiVersion: [')
    expect(broken.ok).toBe(false)
    if (!broken.ok) expect(broken.issues[0].reason).toContain('YAML 解析失败')

    const scalar = parseChainYaml('hello')
    expect(scalar.ok).toBe(false)
    if (!scalar.ok) expect(scalar.issues[0].reason).toContain('映射')
  })

  it('未知字段原样留着（schemastery 的 object 不拒未知键，如实记录这条性质）', () => {
    const parsed = parseChainDoc({
      ...chainDoc(),
      futureField: { note: '留给 v2' },
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect((parsed.doc as unknown as Record<string, unknown>).futureField).toEqual({ note: '留给 v2' })
  })
})

describe('chainToYaml', () => {
  it('落盘再读回，语义等价（suggested 只在该出现时出现）', () => {
    const doc = chainDoc({ edges: [{ from: 'query-material.body.items[0].internalId', to: 'create-order.body.lines[0].materialId', suggested: true }] })
    const text = chainToYaml(doc)
    expect(text).toContain('apiVersion: dataforge/v1')
    expect(text).toContain('suggested: true')
    const parsed = parseChainYaml(text)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.doc).toEqual(doc)
  })

  it('不写 suggested 就不产生这个键（旧文件回读后不会被补成 false）', () => {
    const parsed = parseChainYaml(chainToYaml(chainDoc()))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.doc.edges[0]).not.toHaveProperty('suggested')
  })
})

describe('绑定路径语法', () => {
  it('节点 id 与字段路径按第一个点分开', () => {
    expect(splitBindingPath('query-material.body.items[0].internalId')).toEqual({
      nodeId: 'query-material',
      fieldPath: 'body.items[0].internalId',
    })
    expect(splitBindingPath('no-dot')).toBeUndefined()
    expect(splitBindingPath('node.')).toBeUndefined()
    expect(splitBindingPath('.field')).toBeUndefined()
  })

  it('[0] / [*] / [] 视作同一个占位', () => {
    expect(fieldSegments('body.items[0].internalId')).toEqual(['body', 'items[*]', 'internalId'])
    expect(fieldSegments('body.items[*].internalId')).toEqual(['body', 'items[*]', 'internalId'])
    expect(fieldSegments('body.items[].internalId')).toEqual(['body', 'items[*]', 'internalId'])
  })

  it('卡模板用 [*]，手写绑定用 [0] 也认', () => {
    const outputs = [{ path: 'body.items[*].internalId', type: 'string' }]
    expect(isFieldDeclared('body.items[0].internalId', outputs)).toBe(true)
    expect(isFieldDeclared('body.items[7].internalId', outputs)).toBe(true)
    expect(isFieldDeclared('body.items[0].materialCode', outputs)).toBe(false)
  })

  it('模板只声明到容器时允许绑它下面的字段', () => {
    expect(isFieldDeclared('body.items[0].internalId', [{ path: 'body.items', type: 'array' }])).toBe(true)
    expect(isFieldDeclared('body.items', [{ path: 'body.items', type: 'array' }])).toBe(true)
    // 标量字段不许下钻
    expect(isFieldDeclared('query.q.deeper', [{ path: 'query.q', type: 'string' }])).toBe(false)
  })

  it('叶子名与槽位引用', () => {
    expect(fieldLeaf('body.items[*].internalId')).toBe('internalId')
    expect(fieldLeaf('query.q')).toBe('q')
    expect(inputSlotRef('materialCodes')).toBe('$inputs.materialCodes')
    expect(isInputSlotRef('$inputs.materialCodes')).toBe(true)
    expect(inputSlotNameOf('$inputs.materialCodes')).toBe('materialCodes')
    expect(inputSlotNameOf('$inputs.')).toBeUndefined()
    expect(inputSlotNameOf('query.q')).toBeUndefined()
  })
})

describe('issueTargetOf / chainErrorCode', () => {
  it('路径收敛成 issue target', () => {
    expect(issueTargetOf('nodes[0].card')).toBe('nodes[0]')
    expect(issueTargetOf('edges[12].to')).toBe('edges[12]')
    expect(issueTargetOf('inputs[1].name')).toBe('inputs[1]')
    expect(issueTargetOf('meta.version')).toBe('meta')
    expect(issueTargetOf('')).toBe('chain')
  })

  it('全是"卡没导入"才归 card-not-imported，混合按 invalid-chain', () => {
    expect(chainErrorCode([{ target: 'nodes[0]', code: 'card-not-imported', reason: 'x' }])).toBe('card-not-imported')
    expect(
      chainErrorCode([
        { target: 'nodes[0]', code: 'card-not-imported', reason: 'x' },
        { target: 'edges[0]', code: 'cycle', reason: 'y' },
      ]),
    ).toBe('invalid-chain')
    expect(chainErrorCode([])).toBe('invalid-chain')
  })
})

describe('parseCardDoc', () => {
  it('读得进设计文档里那张卡；坏文件返回 undefined', () => {
    const card = parseCardDoc({
      cardId: 'card_000123',
      kind: 'interface-card',
      identity: { mergeKey: 'GET /api/materials?q={q}', method: 'GET', urlTemplate: '/api/materials?q={q}' },
      inputs: [{ path: 'query.q', type: 'string', required: true, role: 'search-key' }],
      outputs: [{ path: 'body.items[*].internalId', type: 'string' }],
      auth: 'cookie-session',
      sources: [{ captureId: 'cap_20261016_01' }],
    })
    expect(card?.cardId).toBe('card_000123')
    expect(card?.outputs).toHaveLength(1)
    expect(parseCardDoc({ cardId: 'x' })).toBeUndefined()
    expect(parseCardDoc(null)).toBeUndefined()
  })
})
