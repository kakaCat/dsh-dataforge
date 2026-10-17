/**
 * 契约测试：接口库写出的卡文件，必须能被**链侧**（`src/chains/schema.ts` 的
 * `parseCardDoc` / `defaultCardResolver`）原样读懂。
 *
 * library 与 chains 是两条独立写入线（链侧刻意不 import library，只认结构性契约），
 * 所以这条缝必须有测试盯着：库改了卡文件形状而链侧读不动，这里先红。
 *
 * @module dsh-dataforge/test/library/contract
 */

import { expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { CaptureStore } from '../../src/capture/store.js'
import { defaultCardResolver, readCard as readChainCard } from '../../src/chains/store.js'
import { parseCardDoc, loadYamlValue, type InterfaceCardDoc } from '../../src/chains/schema.js'
import { checkChain } from '../../src/chains/validate.js'
import { importLibrary } from '../../src/library/import.js'
import { dumpCardFile, readCard } from '../../src/library/store.js'

const PAGE = 'https://scm.example.com/purchase/new'
const REQUEST_TEMPLATE = {
  fields: [
    { field: 'q', type: 'string', sample: '2120', role: 'input', unverified: false, location: 'query' },
    { field: 'orgId', type: 'string', sample: '2120', role: 'input', unverified: false, location: 'query' },
  ],
}
const RESPONSE_TEMPLATE = {
  fields: [{ field: 'items[].internalId', type: 'string', sample: 'I-9', role: 'constant', unverified: true }],
}

function seed(): { dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'library-contract-'))
  const dbPath = join(dir, 'capture.sqlite')
  const store = new CaptureStore(dbPath, join(dir, 'samples'), join(dir, 'events.ndjson'))
  store.upsertRun({ id: 'cap_1', taskType: 'single_page', entryUrl: PAGE, status: 'done', startedAt: 1, stats: { pages: 1, requests: 2, cards: 2, credentials: 0 } })

  // 搜索卡：出参数组形态，链侧要用 `[*]` / `[0]` 对上。
  store.upsertCard('cap_1', {
    mergeKey: 'GET /api/materials:orgId,q',
    method: 'GET',
    urlTemplate: '/api/materials?orgId={o}&q={q}',
    relatedPageUrls: [PAGE],
    requestTemplate: REQUEST_TEMPLATE as never,
    responseTemplate: RESPONSE_TEMPLATE as never,
    authType: 'cookie-session' as never,
    authEvidence: 'header:cookie:JSESSIONID',
  })
  // 下单卡：入参嵌套数组形态。
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
  store.close()

  const result = importLibrary({ workspaceRoot: dir, captureDbPath: dbPath })
  expect(result.imported).toBe(2)
  return { dir }
}

it('库写出的卡文件被链侧 parseCardDoc 原样读懂（含未知键容忍）', () => {
  const { dir } = seed()
  const card = readCard(dir, 'card_000001')
  expect(card).toBeDefined()

  const text = dumpCardFile(card!)
  const chainSide = parseCardDoc(loadYamlValue(text))
  expect(chainSide).toBeDefined()

  const doc = chainSide as InterfaceCardDoc
  expect(doc.cardId).toBe('card_000001')
  expect(doc.kind).toBe('interface-card')
  expect(doc.identity).toEqual(card!.identity)
  expect(doc.auth).toBe('cookie-session')
  // 入参：`required` 与 `role` 都被链侧收下。
  expect(doc.inputs.map((field) => field.path)).toEqual(['query.q', 'query.orgId'])
  expect(doc.inputs.every((field) => field.required === true && field.role === 'input')).toBe(true)
  // 出参：数组形态原样保留 `[*]`。
  expect(doc.outputs.map((field) => field.path)).toEqual(['body.items[*].internalId'])
})

it('defaultCardResolver 走盘上卡文件：链校验能解析到库里的卡', () => {
  const { dir } = seed()
  const resolve = defaultCardResolver(dir)
  expect(resolve('card_000001')?.cardId).toBe('card_000001')
  expect(resolve('card_000002')?.identity.method).toBe('POST')
  expect(resolve('card_999999')).toBeUndefined()
  // 链侧读到的 name/来源与库侧一致。
  expect(readChainCard(dir, 'card_000001')?.sources?.[0]?.captureId).toBe('cap_1')
})

it('端到端：库里两张卡拼成两节点链，链校验通过（无悬空卡引用）', () => {
  const { dir } = seed()
  const resolve = defaultCardResolver(dir)
  const issues = checkChain(
    {
      apiVersion: 'dataforge/v1',
      kind: 'interface-chain',
      meta: { site: '智慧供应链 SCM', flow: '采购下单', version: 1, created: '2026-10-17T12:00:00Z' },
      inputs: [
        { name: 'orgId', type: 'string', required: true },
        { name: 'keyword', type: 'string', required: true },
      ],
      nodes: [
        {
          id: 'query-material',
          card: 'card_000001',
          // 槽位靠常量值引用（`$inputs.<name>`）才算"有人用"，否则是僵尸槽位。
          constants: { 'query.q': '$inputs.keyword', 'query.orgId': '$inputs.orgId' },
          retry: 0,
          timeoutSeconds: 0,
        },
        {
          id: 'create-order',
          card: 'card_000002',
          constants: { 'body.orgId': '$inputs.orgId' },
          retry: 0,
          timeoutSeconds: 0,
        },
      ],
      edges: [{ from: 'query-material.body.items[0].internalId', to: 'create-order.body.lines[0].materialId' }],
    } as never,
    resolve,
  )
  expect(issues).toEqual([])
})
