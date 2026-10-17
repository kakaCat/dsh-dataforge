import { expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CaptureStore } from '../../src/capture/store.js'
import { importLibrary, mergeCard, type LibraryError } from '../../src/library/import.js'
import { cardsDir, libraryRoot, readCard, readIndex } from '../../src/library/store.js'
import type { LibraryCard } from '../../src/library/types.js'

const PAGE = 'https://scm.example.com/purchase/new'

const REQUEST_TEMPLATE = {
  fields: [
    { field: 'q', type: 'string', sample: '2120', role: 'input', unverified: false, location: 'query' },
    { field: 'lines[].materialId', type: 'string', sample: 'M-1', role: 'input', unverified: false, location: 'body' },
    { field: 'lines[].qty', type: 'number', sample: '3', role: 'input', unverified: false, location: 'body' },
    { field: 'content-type', type: 'string', sample: 'application/json', role: 'constant', unverified: false, location: 'header' },
    // 凭证角色字段：绝不入卡。
    { field: 'cookie', type: 'string', sample: 'JSESSIONID=deadbeef', role: 'credential', unverified: false, location: 'header' },
  ],
} as const

const RESPONSE_TEMPLATE = {
  fields: [
    { field: 'items[].internalId', type: 'string', sample: 'I-9', role: 'constant', unverified: true },
    { field: 'code', type: 'number', sample: '0', role: 'constant', unverified: true },
  ],
  codePath: 'code',
} as const

type Fixture = { dir: string; dbPath: string; store: CaptureStore }

function fixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'library-import-'))
  const dbPath = join(dir, 'capture.sqlite')
  const store = new CaptureStore(dbPath, join(dir, 'samples'), join(dir, 'events.ndjson'))
  return { dir, dbPath, store }
}

function addCard(
  store: CaptureStore,
  input: { captureId: string; mergeKey: string; method?: string; urlTemplate?: string; name?: string; authType?: string; pages?: string[] },
): string {
  return store.upsertCard(input.captureId, {
    mergeKey: input.mergeKey,
    method: input.method ?? 'GET',
    urlTemplate: input.urlTemplate ?? '/api/materials?q={q}',
    relatedPageUrls: input.pages ?? [PAGE],
    requestTemplate: REQUEST_TEMPLATE as never,
    responseTemplate: RESPONSE_TEMPLATE as never,
    authType: (input.authType ?? 'cookie-session') as never,
    authEvidence: 'header:cookie:JSESSIONID',
    ...(input.name === undefined ? {} : { name: input.name }),
  })
}

function run(store: CaptureStore, id: string): void {
  store.upsertRun({ id, taskType: 'single_page', entryUrl: PAGE, status: 'done', startedAt: 1, stats: { pages: 1, requests: 3, cards: 1, credentials: 0 } })
}

/** 导入前必须关掉写连接：导入只读打开采集库，测试里不留并发写者。 */
function closeAndImport(fx: Fixture, captureId?: string) {
  fx.store.close()
  return importLibrary({ workspaceRoot: fx.dir, captureDbPath: fx.dbPath, ...(captureId === undefined ? {} : { captureId }) })
}

it('首跑导入：采集卡 → 卡文件 + 索引，路径按位置加前缀，凭证字段不入卡', () => {
  const fx = fixture()
  run(fx.store, 'cap_1')
  const captureCardId = addCard(fx.store, { captureId: 'cap_1', mergeKey: 'GET /api/materials:q', name: '物料查询' })
  fx.store.upsertRelation('cap_1', captureCardId, PAGE, 'fp-1')

  const result = closeAndImport(fx)

  expect(result.imported).toBe(1)
  expect(result.skipped).toBe(0)
  expect(result.cardIds).toEqual(['card_000001'])
  expect(result.captureIds).toEqual(['cap_1'])
  expect(result.libraryRoot).toBe(libraryRoot(fx.dir))

  const card = readCard(fx.dir, 'card_000001')
  expect(card?.identity).toEqual({
    mergeKey: 'GET /api/materials:q',
    method: 'GET',
    urlTemplate: '/api/materials?q={q}',
  })
  expect(card?.name).toBe('物料查询')
  expect(card?.inputs).toEqual([
    { path: 'query.q', type: 'string', required: true, role: 'input' },
    { path: 'body.lines[*].materialId', type: 'string', required: true, role: 'input' },
    { path: 'body.lines[*].qty', type: 'number', required: true, role: 'input' },
    { path: 'header.content-type', type: 'string', required: false, role: 'constant' },
  ])
  expect(card?.outputs).toEqual([
    { path: 'body.items[*].internalId', type: 'string' },
    { path: 'body.code', type: 'number' },
  ])
  expect(card?.auth).toBe('cookie-session')
  expect(card?.authEvidence).toBe('header:cookie:JSESSIONID')
  expect(card?.sources).toEqual([{ captureId: 'cap_1', pages: [PAGE], relationIds: [expect.any(String)] }])

  const text = readFileSync(join(cardsDir(fx.dir), 'card_000001.yaml'), 'utf8')
  expect(text).not.toContain('deadbeef')
  expect(text).not.toContain('sample')
  expect(readIndex(fx.dir).cards.map((entry) => entry.cardId)).toEqual(['card_000001'])
})

it('重复导入同一 run：收敛到同一卡集合，sources 不重复、索引不重写', () => {
  const fx = fixture()
  run(fx.store, 'cap_1')
  addCard(fx.store, { captureId: 'cap_1', mergeKey: 'GET /api/materials:q' })
  const first = closeAndImport(fx)
  expect(first.imported).toBe(1)

  const before = readFileSync(join(cardsDir(fx.dir), 'card_000001.yaml'), 'utf8')
  const second = importLibrary({ workspaceRoot: fx.dir, captureDbPath: fx.dbPath })
  expect(second.imported).toBe(0)
  expect(second.merged).toBe(0)
  expect(second.unchanged).toBe(1)
  expect(readFileSync(join(cardsDir(fx.dir), 'card_000001.yaml'), 'utf8')).toBe(before)

  const card = readCard(fx.dir, 'card_000001')
  expect(card?.sources).toHaveLength(1)
  expect(readIndex(fx.dir).cards).toHaveLength(1)
})

it('第二次采集同接口：不新建卡，sources 累积两条，字段做并集', () => {
  const fx = fixture()
  run(fx.store, 'cap_1')
  addCard(fx.store, { captureId: 'cap_1', mergeKey: 'GET /api/materials:q' })
  expect(closeAndImport(fx).imported).toBe(1)

  // 第二次采集：同一接口，但多了个入参字段（并集要能长出来），页面也不同。
  const store = new CaptureStore(fx.dbPath, join(fx.dir, 'samples'), join(fx.dir, 'events.ndjson'))
  store.upsertRun({ id: 'cap_2', taskType: 'single_page', entryUrl: PAGE, status: 'done', startedAt: 2, stats: { pages: 1, requests: 2, cards: 1, credentials: 0 } })
  store.upsertCard('cap_2', {
    mergeKey: 'GET /api/materials:q',
    method: 'GET',
    urlTemplate: '/api/materials?q={q}',
    relatedPageUrls: ['https://scm.example.com/purchase/other'],
    requestTemplate: {
      fields: [
        { field: 'q', type: 'string', sample: '3300', role: 'input', unverified: false, location: 'query' },
        { field: 'orgId', type: 'string', sample: '2120', role: 'input', unverified: false, location: 'query' },
      ],
    } as never,
    responseTemplate: RESPONSE_TEMPLATE as never,
    authType: 'cookie-session' as never,
  })
  store.close()

  const result = importLibrary({ workspaceRoot: fx.dir, captureDbPath: fx.dbPath })
  expect(result.imported).toBe(0)
  expect(result.merged).toBe(1)
  expect(result.cardIds).toEqual(['card_000001'])

  const card = readCard(fx.dir, 'card_000001')
  expect(card?.sources.map((source) => source.captureId).sort()).toEqual(['cap_1', 'cap_2'])
  expect(card?.sources.find((source) => source.captureId === 'cap_2')?.pages).toEqual([
    'https://scm.example.com/purchase/other',
  ])
  expect(card?.inputs.map((field) => field.path)).toContain('query.orgId')
  // 归并后序号水位不变：没有新卡。
  expect(readIndex(fx.dir).cards.map((entry) => entry.cardId)).toEqual(['card_000001'])
})

it('坏卡跳过不炸批：坏模板那张计入 skipped，好卡照常导入', () => {
  const fx = fixture()
  run(fx.store, 'cap_1')
  addCard(fx.store, { captureId: 'cap_1', mergeKey: 'GET /api/materials:q' })
  const broken = addCard(fx.store, {
    captureId: 'cap_1',
    mergeKey: 'POST /api/orders:orgId',
    method: 'POST',
    urlTemplate: '/api/orders?orgId={x}',
  })
  fx.store.close()

  // 模拟采集期写坏的一行：模板 JSON 不是对象。
  const handle = new Database(fx.dbPath)
  handle.prepare('UPDATE interface_cards SET request_template_json=? WHERE id=?').run('"not-a-template"', broken)
  handle.close()

  const result = importLibrary({ workspaceRoot: fx.dir, captureDbPath: fx.dbPath })
  expect(result.imported).toBe(1)
  expect(result.skipped).toBe(1)
  expect(result.skippedDetails[0]?.reason).toContain('请求模板')
  expect(result.cardIds).toEqual(['card_000001'])
})

it('采集库缺席 → no-capture-data（且不在工作区造出半个库）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'library-import-'))
  let caught: LibraryError | undefined
  try {
    importLibrary({ workspaceRoot: dir, captureDbPath: join(dir, 'missing.sqlite') })
  } catch (error) {
    caught = error as LibraryError
  }
  expect(caught?.code).toBe('no-capture-data')
  expect(caught?.hints.length).toBeGreaterThan(0)
  expect(existsSync(libraryRoot(dir))).toBe(false)
})

it('采集库有表但没卡 → no-capture-data；指定 captureId 无卡 → 同码', () => {
  const fx = fixture()
  let caught: LibraryError | undefined
  try {
    closeAndImport(fx)
  } catch (error) {
    caught = error as LibraryError
  }
  expect(caught?.code).toBe('no-capture-data')

  const fx2 = fixture()
  run(fx2.store, 'cap_empty')
  let caught2: LibraryError | undefined
  try {
    fx2.store.close()
    importLibrary({ workspaceRoot: fx2.dir, captureDbPath: fx2.dbPath, captureId: 'cap_nope' })
  } catch (error) {
    caught2 = error as LibraryError
  }
  expect(caught2?.code).toBe('no-capture-data')
})

it('指定 captureId 只导入那一次采集', () => {
  const fx = fixture()
  run(fx.store, 'cap_1')
  addCard(fx.store, { captureId: 'cap_1', mergeKey: 'GET /api/materials:q' })
  run(fx.store, 'cap_2')
  addCard(fx.store, { captureId: 'cap_2', mergeKey: 'POST /api/orders:orgId', method: 'POST', urlTemplate: '/api/orders?orgId={x}' })
  fx.store.close()

  const result = importLibrary({ workspaceRoot: fx.dir, captureDbPath: fx.dbPath, captureId: 'cap_2' })
  expect(result.captureIds).toEqual(['cap_2'])
  expect(result.cardIds).toEqual(['card_000001'])
  expect(readCard(fx.dir, 'card_000001')?.identity.method).toBe('POST')
})

it('序号不复用：删卡重导拿到新号，旧号不会被顶替', () => {
  const fx = fixture()
  run(fx.store, 'cap_1')
  addCard(fx.store, { captureId: 'cap_1', mergeKey: 'GET /api/materials:q' })
  fx.store.close()
  importLibrary({ workspaceRoot: fx.dir, captureDbPath: fx.dbPath })

  rmSync(join(cardsDir(fx.dir), 'card_000001.yaml'))
  const again = importLibrary({ workspaceRoot: fx.dir, captureDbPath: fx.dbPath })
  expect(again.imported).toBe(1)
  expect(again.cardIds).toEqual(['card_000002'])
  expect(readCard(fx.dir, 'card_000001')).toBeUndefined()
  expect(existsSync(join(cardsDir(fx.dir), 'card_000002.yaml'))).toBe(true)
})

// ── 归并纯函数 ────────────────────────────────────────────────────────────────

const BASE: LibraryCard = {
  cardId: 'card_000001',
  kind: 'interface-card',
  identity: { mergeKey: 'GET /api/materials:q', method: 'GET', urlTemplate: '/api/materials?q={q}' },
  inputs: [{ path: 'query.q', type: 'string', required: true, role: 'input' }],
  outputs: [{ path: 'body.items[*].internalId', type: 'string' }],
  auth: 'unknown',
  sources: [{ captureId: 'cap_1', pages: [PAGE], relationIds: ['rel_1'] }],
}

it('归并：字段类型冲突记 notice 并保留既有值；鉴权从 unknown 升级', () => {
  const { card, changed } = mergeCard(BASE, {
    kind: 'interface-card',
    identity: BASE.identity,
    inputs: [{ path: 'query.q', type: 'number', required: true, role: 'input' }],
    outputs: [],
    auth: 'cookie-session',
    authEvidence: 'header:cookie:JSESSIONID',
    sources: [{ captureId: 'cap_2', pages: ['https://scm.example.com/b'], relationIds: ['rel_2'] }],
  })
  expect(changed).toBe(true)
  expect(card.inputs[0]).toEqual({ path: 'query.q', type: 'string', required: true, role: 'input' })
  expect(card.notice?.[0]).toContain('类型冲突')
  expect(card.auth).toBe('cookie-session')
  expect(card.authEvidence).toBe('header:cookie:JSESSIONID')
  expect(card.sources.map((source) => source.captureId)).toEqual(['cap_1', 'cap_2'])
})

it('归并：完全相同 → changed=false（不写文件，保住幂等与 git 干净）', () => {
  const { changed } = mergeCard(BASE, {
    kind: 'interface-card',
    identity: BASE.identity,
    inputs: BASE.inputs,
    outputs: BASE.outputs,
    auth: 'unknown',
    sources: [{ captureId: 'cap_1', pages: [PAGE], relationIds: ['rel_1'] }],
  })
  expect(changed).toBe(false)
})

it('归并：同一 captureId 再导 → 页面/关系取并集，不新增 source 行', () => {
  const { card } = mergeCard(BASE, {
    kind: 'interface-card',
    identity: BASE.identity,
    inputs: [],
    outputs: [],
    auth: 'unknown',
    sources: [{ captureId: 'cap_1', pages: ['https://scm.example.com/another'], relationIds: ['rel_9'] }],
  })
  expect(card.sources).toHaveLength(1)
  expect(card.sources[0]?.pages).toEqual([PAGE, 'https://scm.example.com/another'])
  expect(card.sources[0]?.relationIds).toEqual(['rel_1', 'rel_9'])
})
