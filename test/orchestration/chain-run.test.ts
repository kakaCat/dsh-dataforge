/**
 * 执行入口的闸门（IF-1）：所有预检失败都必须在**第一个请求之前**发生。
 *
 * 这一组不启 http server——正因为预检期一个请求都不该发，跑得通就证明没发。
 * 真打网络的路径在 `test/execute/{run,failure,job}.test.ts`。
 *
 * @module dsh-dataforge/test/orchestration/chain-run
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChainDoc, InterfaceCardDoc } from '../../src/chains/schema.js'
import { chainToYaml } from '../../src/chains/schema.js'
import { cardsRoot, chainFilePath, saveChain } from '../../src/chains/store.js'
import {
  chainRunForTool,
  type ChainRunToolDeps,
  type ChainRunsToolValue,
  type ChainRunToolValue,
} from '../../src/orchestration/application.js'
import { defineChainRunTool, defineChainRunsTool } from '../../src/tools.js'
import { listRunIds } from '../../src/runs/store.js'

/* ================================================================== 夹具 */

const CHAIN_CONFIG = {
  enabled: true,
  nodeTimeoutSeconds: 5,
  concurrency: 4,
  responseLimitBytes: 2_097_152,
  foregroundTimeoutSeconds: 60,
}

function workspaceOf(): string {
  return mkdtempSync(join(tmpdir(), 'chain-gate-'))
}

function depsOf(workspace: string, overrides: Partial<ChainRunToolDeps['chain']> = {}): ChainRunToolDeps {
  return {
    captureDbPath: join(workspace, 'capture.sqlite'),
    resolveWorkspaceRoot: async () => workspace,
    dataRoot: join(workspace, 'data'),
    chain: { ...CHAIN_CONFIG, ...overrides },
    resolveJobs: () => undefined,
  }
}

function cardOf(
  cardId: string,
  method: string,
  urlTemplate: string,
  inputs: InterfaceCardDoc['inputs'] = [],
  origin?: string,
): InterfaceCardDoc {
  return {
    cardId,
    kind: 'interface-card',
    identity: { mergeKey: `${method} ${urlTemplate}`, method, urlTemplate },
    inputs,
    outputs: [],
    ...(origin === undefined ? {} : { sources: [{ captureId: 'cap_1', pages: [`${origin}/page`] }] }),
  }
}

function writeCard(workspace: string, card: InterfaceCardDoc): void {
  const dir = cardsRoot(workspace)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${card.cardId}.yaml`), JSON.stringify(card, null, 2), 'utf8')
}

function seedChain(workspace: string, flow: string, doc: Omit<ChainDoc, 'meta'> & { meta?: Partial<ChainDoc['meta']> }): ChainDoc {
  const full: ChainDoc = {
    ...doc,
    // site/flow 以夹具参数为准（chainOf 给的占位 meta 不能反向覆盖）。
    meta: { ...(doc.meta ?? {}), site: '测试站点', flow, version: 1, created: doc.meta?.created ?? '2026-10-17T00:00:00Z' },
  } as ChainDoc
  const saved = saveChain(workspace, chainToYaml(full), { source: 'agent' })
  if (!saved.ok) throw new Error(`夹具链落盘失败：${saved.issues.map((issue) => `${issue.target}：${issue.reason}`).join('；')}`)
  return saved.doc
}

function chainOf(nodes: ChainDoc['nodes'], edges: ChainDoc['edges'] = [], inputs: ChainDoc['inputs'] = []): ChainDoc {
  return { apiVersion: 'dataforge/v1', kind: 'interface-chain', meta: { site: '', flow: '', version: 1, created: '' }, inputs, nodes, edges }
}

/* ================================================================== 用例 */

describe('执行开关：execution-disabled', () => {
  it('关掉后一律拒跑，且不建运行留痕', async () => {
    const workspace = workspaceOf()
    writeCard(workspace, cardOf('card_ok', 'GET', '/api/ok'))
    seedChain(workspace, '关着的链', chainOf([{ id: 'node-1', card: 'card_ok', constants: {} }]))
    const deps = depsOf(workspace, { enabled: false })

    const value = await chainRunForTool(deps, {}, { site: '测试站点', flow: '关着的链', confirm: true })

    expect(value.ok).toBe(false)
    expect(value.accepted).toBe(false)
    expect(value.code).toBe('execution-disabled')
    expect(value.message).toContain('chainRunEnabled')
    expect(listRunIds(deps.dataRoot, 10)).toEqual([])
  })
})

describe('确认闸：confirm-required', () => {
  it('不带 confirm 只出计划卡：拓扑序、写方法清单、目标 host，且不建运行', async () => {
    const workspace = workspaceOf()
    writeCard(workspace, {
      ...cardOf('card_read', 'GET', '/api/items', [], 'https://scm.example.com'),
      outputs: [{ path: 'body.id', type: 'string' }],
    })
    writeCard(workspace, cardOf('card_write', 'POST', '/api/orders', [
      { path: 'body.ref', type: 'string' },
    ], 'https://scm.example.com'))
    seedChain(workspace, '采购下单', chainOf(
      [
        { id: 'list-items', card: 'card_read', constants: {} },
        { id: 'place-order', card: 'card_write', constants: {} },
      ],
      [{ from: 'list-items.body.id', to: 'place-order.body.ref' }],
    ))
    const deps = depsOf(workspace)

    const value = await chainRunForTool(deps, {}, { site: '测试站点', flow: '采购下单' })

    expect(value.ok).toBe(true)
    expect(value.accepted).toBe(false)
    expect(value.gate).toBe('confirm-required')
    expect(value.code).toBe('confirm-required')
    expect(value.plan?.order).toEqual(['list-items', 'place-order'])
    expect(value.plan?.writeNodes).toEqual(['place-order'])
    expect(value.plan?.host).toBe('scm.example.com')
    expect(value.plan?.nodes.find((node) => node.nodeId === 'place-order')?.writes).toBe(true)
    expect(value.plan?.nodes.find((node) => node.nodeId === 'list-items')?.dependsOn).toEqual([])
    expect(value.card).toContain('scm.example.com')
    expect(value.card).toContain('place-order')
    expect(value.card).toContain('已发出的写请求无法撤销')
    expect(listRunIds(deps.dataRoot, 10)).toEqual([])
  })
})

describe('预检：缺参 / 槽位值 / 环 / 非可执行链', () => {
  it('静态缺参逐条给「节点 · 卡字段路径 · 类型」，整链不执行', async () => {
    const workspace = workspaceOf()
    writeCard(workspace, cardOf('card_needs', 'POST', '/api/orders', [
      { path: 'body.orgId', type: 'string' },
      { path: 'body.lines[0].quantity', type: 'number' },
    ], 'https://scm.example.com'))
    seedChain(workspace, '缺参链', chainOf([{ id: 'create-order', card: 'card_needs', constants: {} }]))
    const deps = depsOf(workspace)

    const value = await chainRunForTool(deps, {}, { site: '测试站点', flow: '缺参链', confirm: true })

    expect(value.ok).toBe(false)
    expect(value.code).toBe('missing-params')
    expect(value.gaps).toHaveLength(2)
    expect(value.gaps?.[0]).toMatchObject({ nodeId: 'create-order', path: 'body.orgId', type: 'string' })
    expect(value.message).toContain('create-order')
    expect(listRunIds(deps.dataRoot, 10)).toEqual([])
  })

  it('给全常量后不再缺参（required 不参与判据：卡里 required 是 false 也一样判）', async () => {
    const workspace = workspaceOf()
    writeCard(workspace, cardOf('card_needs', 'GET', '/api/items', [
      { path: 'query.orgId', type: 'string', required: false },
    ], 'https://scm.example.com'))
    seedChain(workspace, '常量链', chainOf([
      { id: 'list-items', card: 'card_needs', constants: { 'query.orgId': '2120' } },
    ]))
    const value = await chainRunForTool(depsOf(workspace), {}, { site: '测试站点', flow: '常量链' })
    expect(value.gate).toBe('confirm-required')
    expect(value.plan?.totalNodes).toBe(1)
  })

  it('未知槽位 / 槽位类型不符 → inputs-invalid', async () => {
    const workspace = workspaceOf()
    writeCard(workspace, cardOf('card_ok', 'GET', '/api/ok', [], 'https://scm.example.com'))
    seedChain(workspace, '槽位链', chainOf([{ id: 'node-1', card: 'card_ok', constants: {} }]))
    const deps = depsOf(workspace)

    const unknown = await chainRunForTool(deps, {}, {
      site: '测试站点', flow: '槽位链', inputs: { bogus: 'x' }, confirm: true,
    })
    expect(unknown.code).toBe('inputs-invalid')
    expect(unknown.message).toContain('bogus')

    const wrongType = await chainRunForTool(deps, {}, {
      site: '测试站点', flow: '槽位链', inputs: { keyword: 12 }, confirm: true,
    })
    // 槽位没声明过 → 还是「未知槽位」；这里验的是一条通道（不存在静默接受）。
    expect(wrongType.code).toBe('inputs-invalid')
  })

  it('baseUrl 缺失 → base-url-unresolved（不发请求）', async () => {
    const workspace = workspaceOf()
    // 卡没有 sources：推断不出 origin。
    writeCard(workspace, cardOf('card_bare', 'GET', '/api/ok'))
    seedChain(workspace, '无源链', chainOf([{ id: 'node-1', card: 'card_bare', constants: {} }]))
    const value = await chainRunForTool(depsOf(workspace), {}, { site: '测试站点', flow: '无源链', confirm: true })
    expect(value.code).toBe('base-url-unresolved')
    expect(value.message).toContain('baseUrl')
  })

  it('卡来源跨 origin → base-url-unresolved 并列出候选', async () => {
    const workspace = workspaceOf()
    writeCard(workspace, cardOf('card_a', 'GET', '/api/a', [], 'https://a.example.com'))
    writeCard(workspace, cardOf('card_b', 'POST', '/api/b', [], 'https://b.example.com'))
    seedChain(workspace, '跨域链', chainOf([
      { id: 'node-a', card: 'card_a', constants: {} },
      { id: 'node-b', card: 'card_b', constants: {} },
    ]))
    const value = await chainRunForTool(depsOf(workspace), {}, { site: '测试站点', flow: '跨域链', confirm: true })
    expect(value.code).toBe('base-url-unresolved')
    expect(value.message).toContain('https://a.example.com')
    expect(value.message).toContain('https://b.example.com')
  })

  it('page-chain → not-executable（执行模型只有一套）', async () => {
    const workspace = workspaceOf()
    const saved = saveChain(workspace, chainToYaml({
      apiVersion: 'dataforge/v1',
      kind: 'page-chain',
      meta: { site: '测试站点', flow: '页面链', version: 1, created: '2026-10-17T00:00:00Z' },
      inputs: [],
      nodes: [
        { id: 'page-search', page: '/materials', constants: {} },
        { id: 'page-detail', page: '/materials/detail', constants: {} },
      ],
      edges: [{ from: 'page-search', to: 'page-detail' }],
    }), { source: 'agent' })
    expect(saved.ok).toBe(true)

    const value = await chainRunForTool(depsOf(workspace), {}, { site: '测试站点', flow: '页面链', confirm: true })
    expect(value.code).toBe('not-executable')
    expect(value.message).toContain('page-chain')
  })

  it('链文件被手改坏 → invalid-chain，带 R-1 的 issues 原文', async () => {
    const workspace = workspaceOf()
    writeCard(workspace, cardOf('card_ok', 'GET', '/api/ok', [], 'https://scm.example.com'))
    seedChain(workspace, '坏文件链', chainOf([{ id: 'node-1', card: 'card_ok', constants: {} }]))
    // 落盘后手改成不合法的链（缺 apiVersion）。
    writeFileSync(chainFilePath(workspace, '测试站点', '坏文件链', 1), 'nodes: []\n', 'utf8')

    const value = await chainRunForTool(depsOf(workspace), {}, { site: '测试站点', flow: '坏文件链', confirm: true })
    expect(value.code).toBe('invalid-chain')
    expect(value.issues?.length ?? 0).toBeGreaterThan(0)
    expect(value.versions).toEqual([1])
  })

  it('chain-not-found 带可用版本清单', async () => {
    const workspace = workspaceOf()
    writeCard(workspace, cardOf('card_ok', 'GET', '/api/ok', [], 'https://scm.example.com'))
    seedChain(workspace, '存在的链', chainOf([{ id: 'node-1', card: 'card_ok', constants: {} }]))
    seedChain(workspace, '存在的链', chainOf([{ id: 'node-1', card: 'card_ok', constants: {} }]))

    const value = await chainRunForTool(depsOf(workspace), {}, {
      site: '测试站点', flow: '存在的链', version: 9, confirm: true,
    })
    expect(value.code).toBe('chain-not-found')
    expect(value.versions).toEqual([1, 2])
  })
})

describe('dry-run：同一份计划，永不发请求', () => {
  it('accepted + kind=dry-run，落一条 dryRun 留痕', async () => {
    const workspace = workspaceOf()
    writeCard(workspace, cardOf('card_ok', 'GET', '/api/ok', [], 'https://scm.example.com'))
    seedChain(workspace, '演练链', chainOf([{ id: 'node-1', card: 'card_ok', constants: {} }]))
    const deps = depsOf(workspace)

    const value = await chainRunForTool(deps, {}, { site: '测试站点', flow: '演练链', dryRun: true })

    expect(value.ok).toBe(true)
    expect(value.accepted).toBe(true)
    expect(value.kind).toBe('dry-run')
    expect(value.summary?.dryRun).toBe(true)
    expect(value.summary?.totalSteps).toBe(1)
    expect(value.summary?.stepsDone).toBe(0)
    const runs = listRunIds(deps.dataRoot, 10)
    expect(runs).toHaveLength(1)
    expect(runs[0]).toBe(value.runId)
  })

  it('dry-run 不需要 confirm，也不需要网络能力', async () => {
    const workspace = workspaceOf()
    writeCard(workspace, cardOf('card_ok', 'GET', '/api/ok', [], 'https://scm.example.com'))
    seedChain(workspace, '演练链', chainOf([{ id: 'node-1', card: 'card_ok', constants: {} }]))
    const value = await chainRunForTool(depsOf(workspace), {}, { site: '测试站点', flow: '演练链', dryRun: true })
    expect(value.kind).toBe('dry-run')
  })
})

/* ================================================================== 工具壳 */

describe('工具壳：参数归一与回执渲染', () => {
  /** 走真工具壳：验的是 schema 校验 + 蛇形参数映射 + render 折叠，不走应用层捷径。 */
  function toolHarness(workspace: string): { run: ReturnType<typeof defineChainRunTool>; runs: ReturnType<typeof defineChainRunsTool> } {
    const deps = depsOf(workspace)
    return { run: defineChainRunTool(deps), runs: defineChainRunsTool(deps) }
  }

  function setup(): { workspace: string; tools: ReturnType<typeof toolHarness> } {
    const workspace = workspaceOf()
    writeCard(workspace, cardOf('card_ok', 'GET', '/api/ok', [], 'https://scm.example.com'))
    seedChain(workspace, '工具链', chainOf([{ id: 'node-1', card: 'card_ok', constants: {} }]))
    return { workspace, tools: toolHarness(workspace) }
  }

  it('dry_run 参数被映射成 dryRun（蛇形 → 驼峰），回执是 dry-run 卡', async () => {
    const { tools } = setup()
    const value = await tools.run.execute({ site: '测试站点', flow: '工具链', dry_run: true } as never, {} as never) as unknown as ChainRunToolValue
    expect(value.accepted).toBe(true)
    expect(value.kind).toBe('dry-run')
    expect(value.summary?.dryRun).toBe(true)

    const [text] = tools.run.output.render({} as never, value) as Array<{ text: string }>
    expect(text.text).toContain('dry-run')
    expect(text.text).toContain('scm.example.com')
  })

  it('不带 confirm 的回执是计划卡（模型照着转述就能让人确认）', async () => {
    const { tools } = setup()
    const value = await tools.run.execute({ site: '测试站点', flow: '工具链' } as never, {} as never) as unknown as ChainRunToolValue
    expect(value.accepted).toBe(false)
    expect(value.gate).toBe('confirm-required')

    const [text] = tools.run.output.render({} as never, value) as Array<{ text: string }>
    expect(text.text).toContain('执行计划')
    expect(text.text).toContain('node-1')
    expect(text.text).toContain('GET /api/ok')
    expect(text.text).toContain('confirm=true')
  })

  it('dataforge_chain_runs：空态 notice，跑过之后列出运行', async () => {
    const { tools } = setup()
    const empty = await tools.runs.execute({ site: '测试站点', flow: '工具链' } as never, {} as never) as unknown as ChainRunsToolValue
    expect(empty.ok).toBe(true)
    expect(empty.notice).toBe('该链暂无运行留痕')
    const [emptyText] = tools.runs.output.render({} as never, empty) as Array<{ text: string }>
    expect(emptyText.text).toContain('该链暂无运行留痕')

    await tools.run.execute({ site: '测试站点', flow: '工具链', dry_run: true } as never, {} as never)
    const listed = await tools.runs.execute({ site: '测试站点', flow: '工具链' } as never, {} as never) as unknown as ChainRunsToolValue
    expect(listed.runs).toHaveLength(1)
    expect(listed.runs?.[0]?.dryRun).toBe(true)
    const [text] = tools.runs.output.render({} as never, listed) as Array<{ text: string }>
    expect(text.text).toContain('dry-run')
  })
})
