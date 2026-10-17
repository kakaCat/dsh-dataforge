/**
 * 编排三件套的端到端测试（R-1 M3）：手写链 → 校验 → 落盘 → 回读 → 导出。
 *
 * 走的是**真正的工具壳**（`defineXxxTool(...).execute`），所以参数归一、错误码折叠、
 * 回执渲染三条路都在一起被验到；库/链的单元语义在 test/library 与 test/chains 里。
 *
 * @module dsh-dataforge/test/orchestration
 */
import { expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CaptureStore } from '../src/capture/store.js'
import { chainFilePath } from '../src/chains/store.js'
import {
  defineChainGetTool, defineChainUpsertTool, defineLibraryImportTool,
} from '../src/tools.js'
import type { OrchestrationDeps } from '../src/orchestration/application.js'

const PAGE = 'https://scm.example.com/purchase/new'

type ToolValue = Record<string, unknown> & { ok: boolean }

function harness(): {
  deps: OrchestrationDeps
  dir: string
  dbPath: string
  exec: unknown
  seed: () => void
} {
  const dir = mkdtempSync(join(tmpdir(), 'orchestration-'))
  const dbPath = join(dir, 'capture.sqlite')
  const deps: OrchestrationDeps = { captureDbPath: dbPath, resolveWorkspaceRoot: async () => dir }
  return {
    deps,
    dir,
    dbPath,
    exec: {},
    seed: () => {
      const store = new CaptureStore(dbPath, join(dir, 'samples'), join(dir, 'events.ndjson'))
      store.upsertRun({ id: 'cap_1', taskType: 'single_page', entryUrl: PAGE, status: 'done', startedAt: 1, stats: { pages: 1, requests: 3, cards: 2, credentials: 0 } })
      // 搜索卡
      store.upsertCard('cap_1', {
        mergeKey: 'GET /api/materials:orgId,q',
        method: 'GET',
        urlTemplate: '/api/materials?orgId={o}&q={q}',
        relatedPageUrls: [PAGE],
        requestTemplate: {
          fields: [
            { field: 'q', type: 'string', sample: '2120', role: 'input', unverified: false, location: 'query' },
            { field: 'orgId', type: 'string', sample: '2120', role: 'input', unverified: false, location: 'query' },
          ],
        } as never,
        responseTemplate: { fields: [{ field: 'items[].internalId', type: 'string', sample: 'I-9', role: 'constant', unverified: true }] } as never,
        authType: 'cookie-session' as never,
        authEvidence: 'header:cookie:JSESSIONID',
      })
      // 下单卡
      store.upsertCard('cap_1', {
        mergeKey: 'POST /api/orders',
        method: 'POST',
        urlTemplate: '/api/orders',
        relatedPageUrls: [PAGE],
        requestTemplate: {
          fields: [
            { field: 'lines[].materialId', type: 'string', sample: 'M-1', role: 'input', unverified: false, location: 'body' },
            { field: 'orgId', type: 'string', sample: '2120', role: 'input', unverified: false, location: 'body' },
          ],
        } as never,
        responseTemplate: { fields: [{ field: 'orderNo', type: 'string', sample: 'SO-1', role: 'constant', unverified: true }] } as never,
        authType: 'cookie-session' as never,
      })
      // 提交卡：入参接上游单号，出参给状态——让链有第二跳，验到多级绑定的传递。
      store.upsertCard('cap_1', {
        mergeKey: 'POST /api/orders/submit',
        method: 'POST',
        urlTemplate: '/api/orders/submit',
        relatedPageUrls: [PAGE],
        requestTemplate: {
          fields: [
            { field: 'orderNo', type: 'string', sample: 'SO-1', role: 'input', unverified: false, location: 'body' },
          ],
        } as never,
        responseTemplate: { fields: [{ field: 'status', type: 'string', sample: 'SUBMITTED', role: 'constant', unverified: true }] } as never,
        authType: 'cookie-session' as never,
      })
      store.close()
    },
  }
}

const GOOD_CHAIN = `apiVersion: dataforge/v1
kind: interface-chain
meta:
  site: 智慧供应链 SCM
  flow: 采购下单
  version: 1
  created: 2026-10-17T12:00:00Z
inputs:
  - name: orgId
    type: string
    required: true
  - name: keyword
    type: string
    required: true
nodes:
  - id: query-material
    card: card_000001
    constants:
      query.q: $inputs.keyword
      query.orgId: $inputs.orgId
  - id: create-order
    card: card_000002
    constants:
      body.orgId: $inputs.orgId
  - id: submit-order
    card: card_000003
edges:
  - from: query-material.body.items[0].internalId
    to: create-order.body.lines[0].materialId
  - from: create-order.body.orderNo
    to: submit-order.body.orderNo
`

async function exec(tool: { execute: (a: never, e: never) => Promise<unknown> }, args: unknown, e: unknown): Promise<ToolValue> {
  return (await tool.execute(args as never, e as never)) as ToolValue
}

it('无采集数据：library_import 折成诚实回执，不抛异常', async () => {
  const h = harness()
  const value = await exec(defineLibraryImportTool(h.deps), {}, h.exec)
  expect(value.ok).toBe(false)
  expect(value.code).toBe('no-capture-data')
  expect(String(value.message)).toContain('采集库')
  expect((value.hints as string[]).length).toBeGreaterThan(0)
})

it('导入 → 写链 → 回读 → 导出：≥3 节点两跳绑定的手写链真正落盘，能被 R-3 消费', async () => {
  const h = harness()
  h.seed()

  const imported = await exec(defineLibraryImportTool(h.deps), {}, h.exec)
  expect(imported.ok).toBe(true)
  expect(imported.imported).toBe(3)
  expect(imported.cardIds).toEqual(['card_000001', 'card_000002', 'card_000003'])

  const upsert = defineChainUpsertTool(h.deps)
  const v1 = await exec(upsert, { site: '智慧供应链 SCM', flow: '采购下单', chain_yaml: GOOD_CHAIN }, h.exec)
  expect(v1.ok).toBe(true)
  expect(v1.version).toBe(1)
  expect(String(v1.path)).toContain('v1.yaml')

  // 再写一次 → 新版本；旧版本永远在（只增不删）。
  const v2 = await exec(upsert, { site: '智慧供应链 SCM', flow: '采购下单', chain_yaml: GOOD_CHAIN }, h.exec)
  expect(v2.version).toBe(2)

  const get = defineChainGetTool(h.deps)
  const latest = await exec(get, { site: '智慧供应链 SCM', flow: '采购下单' }, h.exec)
  expect(latest.ok).toBe(true)
  expect(latest.version).toBe(2)
  expect(String(latest.chainYaml)).toContain('query-material')
  expect(String(latest.chainYaml)).toContain('submit-order')
  expect(latest.versions).toEqual([1, 2])

  const old = await exec(get, { site: '智慧供应链 SCM', flow: '采购下单', version: 1 }, h.exec)
  expect(old.version).toBe(1)

  const exported = await exec(get, { site: '智慧供应链 SCM', flow: '采购下单', export: true }, h.exec)
  expect(exported.ok).toBe(true)
  // 导出即原文：天然零凭证，不需要剥除。
  expect(String(exported.chainYaml)).not.toContain('JSESSIONID')
})

it('坏定义被拒且错误指到 nodes[i]/edges[j]，不落盘', async () => {
  const h = harness()
  h.seed()
  await exec(defineLibraryImportTool(h.deps), {}, h.exec)
  const upsert = defineChainUpsertTool(h.deps)

  // 成环：两条反向边。
  const cyclic = GOOD_CHAIN.replace(
    'edges:\n  - from: query-material.body.items[0].internalId\n    to: create-order.body.lines[0].materialId\n',
    'edges:\n  - from: query-material.body.items[0].internalId\n    to: create-order.body.lines[0].materialId\n'
      + '  - from: create-order.body.orderNo\n    to: query-material.query.q\n',
  )
  const cycle = await exec(upsert, { site: 'S', flow: 'F', chain_yaml: cyclic }, h.exec)
  expect(cycle.ok).toBe(false)
  expect(cycle.code).toBe('invalid-chain')
  const cycleIssues = cycle.issues as Array<{ target: string; code: string }>
  expect(cycleIssues.some((issue) => issue.code === 'cycle')).toBe(true)
  // 逐条错误必须指到节点/边（成环是多条边的集合，诚实指向 `edges` 而不硬编某一条）。
  expect(cycleIssues.every((issue) => /^(nodes|edges|inputs|meta)(\[\d+])?$/.test(issue.target))).toBe(true)

  // 绑定到不存在的入参字段。
  const badField = GOOD_CHAIN.replace('to: create-order.body.lines[0].materialId', 'to: create-order.body.nope')
  const field = await exec(upsert, { site: 'S', flow: 'F', chain_yaml: badField }, h.exec)
  expect(field.code).toBe('invalid-chain')
  expect((field.issues as Array<{ code: string }>).some((issue) => issue.code === 'unknown-target-field')).toBe(true)

  // 校验失败一次都没落盘。
  const get = defineChainGetTool(h.deps)
  const missing = await exec(get, { site: 'S', flow: 'F' }, h.exec)
  expect(missing.ok).toBe(false)
  expect(missing.code).toBe('chain-not-found')
})

it('卡没导入就引卡 → card-not-imported（提示先跑 library_import）', async () => {
  const h = harness()
  h.seed()
  // 故意不调 library_import。
  const result = await exec(
    defineChainUpsertTool(h.deps),
    { site: '智慧供应链 SCM', flow: '采购下单', chain_yaml: GOOD_CHAIN },
    h.exec,
  )
  expect(result.ok).toBe(false)
  expect(result.code).toBe('card-not-imported')
  expect(String(result.message)).toContain('dataforge_library_import')
})

it('链文件被手改坏：默认读取报 invalid-chain 并给可用版本；export 仍能取原文', async () => {
  const h = harness()
  h.seed()
  await exec(defineLibraryImportTool(h.deps), {}, h.exec)
  const upsert = defineChainUpsertTool(h.deps)
  await exec(upsert, { site: '智慧供应链 SCM', flow: '采购下单', chain_yaml: GOOD_CHAIN }, h.exec)

  writeFileSync(chainFilePath(h.dir, '智慧供应链 SCM', '采购下单', 1), 'apiVersion: [坏\n', 'utf8')

  const get = defineChainGetTool(h.deps)
  const broken = await exec(get, { site: '智慧供应链 SCM', flow: '采购下单' }, h.exec)
  expect(broken.ok).toBe(false)
  expect(broken.code).toBe('invalid-chain')
  expect(broken.versions).toEqual([1])
  expect(String(broken.message)).toContain('旧版本')

  // 原文导出还能抢救出那半截内容（不校验）。
  const raw = await exec(get, { site: '智慧供应链 SCM', flow: '采购下单', export: true }, h.exec)
  expect(raw.ok).toBe(true)
  expect(String(raw.chainYaml)).toContain('apiVersion: [坏')

  const notFound = await exec(get, { site: '没有这个站', flow: '没有这个流程' }, h.exec)
  expect(notFound.code).toBe('chain-not-found')
  expect(notFound.versions).toEqual([])
})

it('参数兜底：site/flow 为空 → invalid-chain，不落盘', async () => {
  const h = harness()
  const result = await exec(defineChainUpsertTool(h.deps), { site: '  ', flow: 'F', chain_yaml: GOOD_CHAIN }, h.exec)
  expect(result.ok).toBe(false)
  expect(result.code).toBe('invalid-chain')
  expect(String(result.message)).toContain('不能为空')
})
