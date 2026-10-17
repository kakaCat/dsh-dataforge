/**
 * 结晶的纯函数（R-6 M1）：来源→分类、冲突、铁律、槽位/常量写回。
 *
 * 不写盘：probe run 用临时目录里的 run.json 模拟；写回只验证 doc 形状。
 *
 * @module dsh-dataforge/test/execute/crystal
 */
import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChainDoc, InterfaceCardDoc } from '../../src/chains/schema.js'
import { runsRoot } from '../../src/runs/store.js'
import {
  applyCrystalDraft,
  assertNoResponseConstant,
  buildCrystalDraft,
  slotNameOf,
  type CrystalDraft,
} from '../../src/execute/crystal.js'

type ProbeFixture = {
  runId?: string
  site?: string
  flow?: string
  version?: number
  explorationId?: string
  nodeId?: string
  cardId?: string
  startedAt?: number
  provenance: Array<Record<string, unknown>>
  values: Record<string, unknown>
}

function writeProbeRun(dataRoot: string, fixture: ProbeFixture): string {
  const runId = fixture.runId ?? `probe-${Math.random().toString(36).slice(2, 8)}`
  const dir = join(runsRoot(dataRoot), runId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'run.json'), JSON.stringify({
    runId,
    kind: 'probe-run',
    flow: fixture.flow ?? '首跑',
    flowName: fixture.flow ?? '首跑',
    probe: {
      site: fixture.site ?? '测试站点',
      flow: fixture.flow ?? '首跑',
      version: fixture.version ?? 1,
      nodeId: fixture.nodeId ?? 'query',
      cardId: fixture.cardId ?? 'card_query',
      explorationId: fixture.explorationId ?? 'exp_1',
    },
    values: fixture.values,
    provenance: fixture.provenance,
    startedAt: fixture.startedAt ?? 1,
  }, null, 2), 'utf8')
  return runId
}

function cardOf(cardId: string, inputs: InterfaceCardDoc['inputs']): InterfaceCardDoc {
  return {
    cardId,
    kind: 'interface-card',
    identity: { mergeKey: `GET /${cardId}`, method: 'GET', urlTemplate: `/${cardId}` },
    inputs,
    outputs: [],
    sources: [],
  }
}

const queryCard = cardOf('card_query', [
  { path: 'query.q', type: 'string' },
  { path: 'query.orgId', type: 'string' },
])
const orderCard = cardOf('card_order', [
  { path: 'body.materialId', type: 'string' },
  { path: 'body.quantity', type: 'number' },
])

function cardsOf(...cards: InterfaceCardDoc[]): Map<string, InterfaceCardDoc> {
  return new Map(cards.map((card) => [card.cardId, card]))
}

function docOf(): ChainDoc {
  return {
    apiVersion: 'dataforge/v1',
    kind: 'interface-chain',
    meta: { site: '测试站点', flow: '首跑', version: 1, created: '2026-10-17T00:00:00Z' },
    inputs: [],
    nodes: [
      { id: 'query', card: 'card_query', constants: {} },
      { id: 'order', card: 'card_order', constants: {} },
    ],
    edges: [{ from: 'query.body.items[0].internalId', to: 'order.body.materialId' }],
  }
}

describe('slotNameOf', () => {
  it('取字段叶子名并做安全化', () => {
    expect(slotNameOf('query.q')).toBe('q')
    expect(slotNameOf('body.lines[0].quantity')).toBe('quantity')
    expect(slotNameOf('body.lines[*].materialId')).toBe('materialId')
    expect(slotNameOf('query.采购组织')).toBe('采购组织')
    expect(slotNameOf('body.1st')).toBe('v_1st')
  })
})

describe('buildCrystalDraft：来源 → 三分类', () => {
  it('user→input、constant→constant、upstream→chain、agent-inferred→input+需确认', () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'crystal-draft-'))
    writeProbeRun(dataRoot, {
      runId: 'probe-query',
      nodeId: 'query',
      cardId: 'card_query',
      startedAt: 1,
      provenance: [
        { path: 'query.q', source: 'user', evidence: '用户原话' },
        { path: 'query.orgId', source: 'constant', evidence: '节点常量' },
      ],
      values: { 'query.q': 'A', 'query.orgId': '2120' },
    })
    writeProbeRun(dataRoot, {
      runId: 'probe-order',
      nodeId: 'order',
      cardId: 'card_order',
      startedAt: 2,
      provenance: [
        { path: 'body.materialId', source: 'upstream', evidence: 'probe:probe-query · body.items[0].internalId' },
        { path: 'body.quantity', source: 'agent-inferred', evidence: '按 1 件试' },
      ],
      values: { 'body.materialId': 'A-ID', 'body.quantity': 1 },
    })

    const built = buildCrystalDraft({ dataRoot, site: '测试站点', flow: '首跑', cards: cardsOf(queryCard, orderCard) })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const byPath = new Map(built.draft.rows.map((row) => [row.path, row]))
    expect(byPath.get('query.q')?.suggestion).toBe('input')
    expect(byPath.get('query.q')?.slotName).toBe('q')
    expect(byPath.get('query.orgId')?.suggestion).toBe('constant')
    expect(byPath.get('body.materialId')?.suggestion).toBe('chain')
    expect(byPath.get('body.materialId')?.type).toBe('string')
    expect(byPath.get('body.quantity')?.suggestion).toBe('input')
    expect(byPath.get('body.quantity')?.requiresUserConfirmation).toBe(true)
    expect(built.draft.explorationId).toBe('exp_1')
  })

  it('同一 path 多条 probe 值不同 → conflict；敏感行 excluded', () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'crystal-conflict-'))
    writeProbeRun(dataRoot, { runId: 'probe-a', startedAt: 1, provenance: [{ path: 'query.q', source: 'user' }], values: { 'query.q': 'A' } })
    writeProbeRun(dataRoot, { runId: 'probe-b', startedAt: 2, provenance: [{ path: 'query.q', source: 'user' }], values: { 'query.q': 'B' } })
    writeProbeRun(dataRoot, {
      runId: 'probe-c',
      startedAt: 3,
      provenance: [{ path: 'query.orgId', source: 'user', redacted: true }],
      values: { 'query.orgId': '***' },
    })

    const built = buildCrystalDraft({ dataRoot, site: '测试站点', flow: '首跑', cards: cardsOf(queryCard, orderCard) })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const q = built.draft.rows.find((row) => row.path === 'query.q')
    expect(q?.conflict).toBe(true)
    expect(q?.value).toBe('B')
    const org = built.draft.rows.find((row) => row.path === 'query.orgId')
    expect(org?.excluded).toContain('敏感')
  })

  it('没有 probe 留痕 → crystal-no-source', () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'crystal-empty-'))
    const built = buildCrystalDraft({ dataRoot, site: '测试站点', flow: '首跑', cards: cardsOf(queryCard, orderCard) })
    expect(built.ok).toBe(false)
    if (built.ok) return
    expect(built.code).toBe('crystal-no-source')
  })
})

describe('铁律：响应值不能冻结', () => {
  const draft: CrystalDraft = {
    site: '测试站点',
    flow: '首跑',
    explorationId: 'exp_1',
    probeRunIds: ['probe-1'],
    rows: [
      {
        nodeId: 'order',
        path: 'body.materialId',
        value: 'A-ID',
        source: 'upstream',
        suggestion: 'chain',
        type: 'string',
        requiresUserConfirmation: false,
      },
    ],
    warnings: [],
  }

  it('upstream 决策 as=constant → crystal-iron-rule', () => {
    const result = assertNoResponseConstant(draft, { 'order:body.materialId': { as: 'constant' } })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('crystal-iron-rule')
  })

  it('upstream 没有决策 → 通过（只走绑定边）', () => {
    expect(assertNoResponseConstant(draft, {}).ok).toBe(true)
  })
})

describe('applyCrystalDraft：写回槽位/常量/校验绑定', () => {
  function draftOf(): CrystalDraft {
    return {
      site: '测试站点',
      flow: '首跑',
      explorationId: 'exp_1',
      probeRunIds: ['probe-1'],
      rows: [
        { nodeId: 'query', path: 'query.q', value: 'A', source: 'user', suggestion: 'input', slotName: 'q', type: 'string', requiresUserConfirmation: false },
        { nodeId: 'query', path: 'query.orgId', value: '2120', source: 'constant', suggestion: 'constant', type: 'string', requiresUserConfirmation: false },
        { nodeId: 'order', path: 'body.quantity', value: 1, source: 'user', suggestion: 'input', slotName: 'quantity', type: 'number', requiresUserConfirmation: false },
        { nodeId: 'order', path: 'body.materialId', value: 'A-ID', source: 'upstream', suggestion: 'chain', type: 'string', requiresUserConfirmation: false },
      ],
      warnings: [],
    }
  }

  it('user→inputs+$inputs、constant→constants、upstream 不写常量', () => {
    const applied = applyCrystalDraft({ doc: docOf(), cards: cardsOf(queryCard, orderCard), draft: draftOf() })
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.inputs).toEqual([
      { name: 'q', type: 'string', required: true, example: 'A' },
      { name: 'quantity', type: 'number', required: true, example: '1' },
    ])
    const query = applied.doc.nodes.find((node) => node.id === 'query')
    const order = applied.doc.nodes.find((node) => node.id === 'order')
    expect(query?.constants).toEqual({ 'query.q': '$inputs.q', 'query.orgId': '2120' })
    expect(order?.constants).toEqual({ 'body.quantity': '$inputs.quantity' })
    expect(order?.constants['body.materialId']).toBeUndefined()
  })

  it('upstream 行没有绑定边 → crystal-chain-without-binding', () => {
    const doc = docOf()
    doc.edges = []
    const applied = applyCrystalDraft({ doc, cards: cardsOf(queryCard, orderCard), draft: draftOf() })
    expect(applied.ok).toBe(false)
    if (applied.ok) return
    expect(applied.code).toBe('crystal-chain-without-binding')
  })

  it('agent-inferred 未 confirmed → 拒绝；confirmed 后写成入参', () => {
    const draft = draftOf()
    draft.rows.push({
      nodeId: 'query',
      path: 'query.q',
      value: 'B',
      source: 'agent-inferred',
      suggestion: 'input',
      slotName: 'q2',
      type: 'string',
      requiresUserConfirmation: true,
    })
    const rejected = applyCrystalDraft({ doc: docOf(), cards: cardsOf(queryCard, orderCard), draft })
    expect(rejected.ok).toBe(false)
    if (rejected.ok) return
    expect(rejected.code).toBe('crystal-confirmation-required')

    const accepted = applyCrystalDraft({
      doc: docOf(),
      cards: cardsOf(queryCard, orderCard),
      draft,
      decisions: { 'query:query.q': { as: 'input', confirmed: true } },
    })
    expect(accepted.ok).toBe(true)
    if (!accepted.ok) return
    expect(accepted.inputs.some((slot) => slot.name === 'q2')).toBe(true)
  })

  it('object 常量 → crystal-unsupported-value', () => {
    const draft = draftOf()
    draft.rows = [{
      nodeId: 'query',
      path: 'query.q',
      value: { a: 1 },
      source: 'user',
      suggestion: 'constant',
      type: 'object',
      requiresUserConfirmation: false,
    }]
    const applied = applyCrystalDraft({ doc: docOf(), cards: cardsOf(queryCard, orderCard), draft })
    expect(applied.ok).toBe(false)
    if (applied.ok) return
    expect(applied.code).toBe('crystal-unsupported-value')
  })
})
