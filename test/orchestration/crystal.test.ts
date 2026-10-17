/**
 * 结晶到复跑的端到端（R-6 M1）：A/B 首跑 probe → 结晶 v2 → C/D 复跑。
 *
 * 这一组是 R-6 的验收主路径：
 *   - 结晶前不写链；铁律/未确认在写前拒；
 *   - 结晶后链含 inputs + `$inputs.<name>`，upstream 值不冻常量；
 *   - 复跑换 C/D 时，内部 ID 由上游重新查出来（不是首跑 A/B 的值）；
 *   - 无效 C 的失败指到绑定边。
 *
 * @module dsh-dataforge/test/orchestration/crystal
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChainDoc, InterfaceCardDoc } from '../../src/chains/schema.js'
import { chainToYaml } from '../../src/chains/schema.js'
import { cardsRoot, defaultCardResolver, loadChain, saveChain } from '../../src/chains/store.js'
import { chainRunForTool, type ChainRunToolDeps } from '../../src/orchestration/application.js'
import { probeForTool } from '../../src/orchestration/explore.js'
import { crystalForTool } from '../../src/orchestration/crystal.js'
import { listRunIds } from '../../src/runs/store.js'

const CHAIN_CONFIG = {
  enabled: true,
  nodeTimeoutSeconds: 5,
  concurrency: 2,
  responseLimitBytes: 2_097_152,
  foregroundTimeoutSeconds: 60,
}

let server: Server
let base = ''
let queries: string[] = []
let orders: string[] = []

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const url = new URL(req.url ?? '/', base)
      const body = Buffer.concat(chunks).toString('utf8')
      if (url.pathname === '/api/materials') {
        const q = url.searchParams.get('q') ?? ''
        queries.push(q)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(q === 'Z' ? '{"items":[]}' : JSON.stringify({ items: [{ internalId: `${q}-ID` }] }))
        return
      }
      if (url.pathname === '/api/orders') {
        const parsed = JSON.parse(body || '{}') as { materialId?: string; quantity?: number }
        orders.push(parsed.materialId ?? '')
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ orderNo: `PO-${parsed.materialId ?? '?'}` }))
        return
      }
      res.writeHead(404)
      res.end('nope')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function workspaceOf(): string {
  return mkdtempSync(join(tmpdir(), 'crystal-e2e-'))
}

function depsOf(workspace: string): ChainRunToolDeps {
  return {
    captureDbPath: join(workspace, 'capture.sqlite'),
    resolveWorkspaceRoot: async () => workspace,
    dataRoot: join(workspace, 'data'),
    chain: CHAIN_CONFIG,
    resolveJobs: () => undefined,
  }
}

function cardOf(cardId: string, method: string, urlTemplate: string, inputs: InterfaceCardDoc['inputs'], outputs: InterfaceCardDoc['outputs']): InterfaceCardDoc {
  return {
    cardId,
    kind: 'interface-card',
    identity: { mergeKey: `${method} ${urlTemplate}`, method, urlTemplate },
    inputs,
    outputs,
    sources: [{ captureId: 'cap_1', pages: [`${base}/page`] }],
  }
}

function writeCard(workspace: string, card: InterfaceCardDoc): void {
  const dir = cardsRoot(workspace)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${card.cardId}.yaml`), JSON.stringify(card, null, 2), 'utf8')
}

function seedChain(workspace: string): void {
  const doc: ChainDoc = {
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
  const saved = saveChain(workspace, chainToYaml(doc), { source: 'agent' })
  if (!saved.ok) throw new Error(`夹具链落盘失败：${saved.issues.map((issue) => issue.reason).join('；')}`)
}

function queryCardOf(): InterfaceCardDoc {
  return cardOf('card_query', 'GET', '/api/materials?q={q}', [
    { path: 'query.q', type: 'string' },
  ], [{ path: 'body.items[0].internalId', type: 'string' }])
}

function orderCardOf(): InterfaceCardDoc {
  return cardOf('card_order', 'POST', '/api/orders', [
    { path: 'body.materialId', type: 'string' },
    { path: 'body.quantity', type: 'number' },
  ], [{ path: 'body.orderNo', type: 'string' }])
}

async function seedProbes(deps: ChainRunToolDeps): Promise<void> {
  const query = await probeForTool(deps, {}, {
    site: '测试站点',
    flow: '首跑',
    node: 'query',
    explorationId: 'exp_ab',
    values: { 'query.q': { value: 'A', source: 'user', evidence: '用户：先用 A 试' } },
  })
  expect(query.gate).toBe('executed')
  expect(query.outputs?.find((output) => output.path === 'body.items[0].internalId')?.valuePreview).toBe('A-ID')

  const order = await probeForTool(deps, {}, {
    site: '测试站点',
    flow: '首跑',
    node: 'order',
    explorationId: 'exp_ab',
    confirm: true,
    values: {
      'body.materialId': { value: 'A-ID', source: 'upstream', evidence: 'probe:probe-query · body.items[0].internalId' },
      'body.quantity': { value: 1, source: 'user' },
    },
  })
  expect(order.gate).toBe('executed')
}

describe('A/B 首跑 → 结晶 → C/D 复跑', () => {
  it('草案不写链；铁律拒绝；写回后换入参复跑，链生成值重新求解', async () => {
    queries = []
    orders = []
    const workspace = workspaceOf()
    writeCard(workspace, queryCardOf())
    writeCard(workspace, orderCardOf())
    seedChain(workspace)
    const deps = depsOf(workspace)
    await seedProbes(deps)

    // 1) 草案：不写链。
    const draft = await crystalForTool(deps, {}, { site: '测试站点', flow: '首跑', explorationId: 'exp_ab' })
    expect(draft.gate).toBe('draft')
    expect(draft.draft?.rows.map((row) => `${row.nodeId}:${row.path}:${row.suggestion}`).sort()).toEqual([
      'order:body.materialId:chain',
      'order:body.quantity:input',
      'query:query.q:input',
    ])
    expect(loadChain(workspace, '测试站点', '首跑').ok).toBe(true)
    const before = loadChain(workspace, '测试站点', '首跑')
    if (before.ok) expect(before.version).toBe(1)

    // 2) 铁律：upstream 想冻常量 → 拒，且不写新版本。
    const iron = await crystalForTool(deps, {}, {
      site: '测试站点',
      flow: '首跑',
      explorationId: 'exp_ab',
      confirm: true,
      decisions: { 'order:body.materialId': { as: 'constant' } },
    })
    expect(iron.gate).toBe('blocked')
    expect(iron.code).toBe('crystal-iron-rule')
    const stillOne = loadChain(workspace, '测试站点', '首跑')
    if (stillOne.ok) expect(stillOne.version).toBe(1)

    // 3) 写回 v2：inputs + $inputs，upstream 不冻常量。
    const written = await crystalForTool(deps, {}, {
      site: '测试站点',
      flow: '首跑',
      explorationId: 'exp_ab',
      confirm: true,
    })
    expect(written.gate).toBe('written')
    expect(written.version).toBe(2)
    expect(written.inputs?.map((slot) => `${slot.name}:${slot.type}`).sort()).toEqual(['q:string', 'quantity:number'])

    const loaded = loadChain(workspace, '测试站点', '首跑')
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    const query = loaded.doc.nodes.find((node) => node.id === 'query')
    const order = loaded.doc.nodes.find((node) => node.id === 'order')
    expect(query?.constants['query.q']).toBe('$inputs.q')
    expect(order?.constants['body.quantity']).toBe('$inputs.quantity')
    expect(order?.constants['body.materialId']).toBeUndefined()

    // 4) 换 C/2 复跑：上游内部 ID 必须重新查出来。
    orders = []
    queries = []
    const rerun = await chainRunForTool(deps, {}, {
      site: '测试站点',
      flow: '首跑',
      confirm: true,
      inputs: { q: 'C', quantity: 2 },
    })
    expect(rerun.summary?.status).toBe('completed')
    expect(queries).toContain('C')
    expect(orders).toContain('C-ID')
    expect(orders).not.toContain('A-ID')

    // 5) 无效 C（Z）：失败指到绑定边。
    const failed = await chainRunForTool(deps, {}, {
      site: '测试站点',
      flow: '首跑',
      confirm: true,
      inputs: { q: 'Z', quantity: 1 },
    })
    expect(failed.summary?.status).toBe('failed')
    expect(failed.failedNode).toBe('order')
    const orderNode = failed.nodes?.find((node) => node.nodeId === 'order')
    expect(orderNode?.errorCode).toBe('binding-path-not-found')
    expect(orderNode?.error).toContain('query.body.items[0].internalId → order.body.materialId')

    // 6) crystal-run 审计。
    const crystalRuns = listRunIds(deps.dataRoot, 50).filter((runId) => runId.startsWith('crystal-'))
    expect(crystalRuns.length).toBeGreaterThanOrEqual(1)
  })

  it('agent-inferred 未在 decisions 里确认 → 拒绝写回', async () => {
    const workspace = workspaceOf()
    writeCard(workspace, queryCardOf())
    writeCard(workspace, orderCardOf())
    seedChain(workspace)
    const deps = depsOf(workspace)

    const order = await probeForTool(deps, {}, {
      site: '测试站点',
      flow: '首跑',
      node: 'order',
      explorationId: 'exp_infer',
      confirm: true,
      values: {
        'body.materialId': { value: 'A-ID', source: 'upstream', evidence: 'probe:1 · body.items[0].internalId' },
        'body.quantity': { value: 1, source: 'agent-inferred', evidence: '按 1 件试' },
      },
    })
    expect(order.gate).toBe('executed')

    const rejected = await crystalForTool(deps, {}, {
      site: '测试站点',
      flow: '首跑',
      explorationId: 'exp_infer',
      confirm: true,
    })
    expect(rejected.gate).toBe('blocked')
    expect(rejected.code).toBe('crystal-confirmation-required')
    const loaded = loadChain(workspace, '测试站点', '首跑')
    if (loaded.ok) expect(loaded.version).toBe(1)

    const accepted = await crystalForTool(deps, {}, {
      site: '测试站点',
      flow: '首跑',
      explorationId: 'exp_infer',
      confirm: true,
      decisions: { 'order:body.quantity': { as: 'input', confirmed: true } },
    })
    expect(accepted.gate).toBe('written')
    expect(accepted.version).toBe(2)
  })
})
