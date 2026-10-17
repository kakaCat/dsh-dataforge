import { expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { CaptureStore } from '../../src/capture/store.js'
import { mergeKeyOf, normalizeUrlForTemplate } from '../../src/capture/normalizer.js'
import {
  cardIdOf,
  cardsDir,
  deleteCard,
  dumpCardFile,
  findCardByMergeKey,
  indexPath,
  libraryExists,
  libraryRoot,
  listCardIdsOnDisk,
  listCards,
  parseCardFile,
  readCard,
  readIndex,
  upsertIndexEntry,
  writeCard,
  writeIndex,
} from '../../src/library/store.js'
import type { LibraryCard } from '../../src/library/types.js'

const CARD: LibraryCard = {
  cardId: 'card_000001',
  kind: 'interface-card',
  name: '物料查询',
  identity: {
    mergeKey: 'GET /api/materials:q',
    method: 'GET',
    urlTemplate: '/api/materials?q={q}',
  },
  inputs: [
    { path: 'query.q', type: 'string', required: true, role: 'input' },
    { path: 'header.content-type', type: 'string', required: false, role: 'constant', unverified: true },
  ],
  outputs: [{ path: 'body.items[*].internalId', type: 'string' }],
  auth: 'cookie-session',
  authEvidence: 'header:cookie:JSESSIONID',
  sources: [{ captureId: 'cap_1', pages: ['https://scm.example.com/purchase/new'], relationIds: ['rel_1'] }],
}

function newWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'library-store-'))
}

it('卡文件落盘 → 索引登记 → 按归并键回查 → 站点从来源页面推导', () => {
  const root = newWorkspace()
  expect(libraryExists(root)).toBe(false)

  writeCard(root, CARD)
  writeIndex(root, upsertIndexEntry(readIndex(root), CARD))

  expect(existsSync(join(cardsDir(root), 'card_000001.yaml'))).toBe(true)
  expect(libraryExists(root)).toBe(true)

  const back = readCard(root, 'card_000001')
  expect(back).toEqual(CARD)

  const hit = findCardByMergeKey(root, 'GET /api/materials:q')
  expect(hit?.card.cardId).toBe('card_000001')
  expect(hit?.entry.site).toBe('scm.example.com')

  const raw = readFileSync(indexPath(root), 'utf8')
  expect(raw).toContain('card_000001')
  expect(raw).toContain('nextCardSeq')
})

it('卡文件不含凭证值：只投影 auth 标志与来源名', () => {
  const root = newWorkspace()
  writeCard(root, CARD)
  const text = readFileSync(join(cardsDir(root), 'card_000001.yaml'), 'utf8')
  // 来源名（cookie 名）可以在场；值不可能在场——采集卡本来就不带值，库卡更只留标志。
  expect(text).toContain('authEvidence: header:cookie:JSESSIONID')
  expect(text).toContain('auth: cookie-session')
  // 字段模板不冻结样本值（R-6 铁律在库层的落点）：卡文件里没有 sample 键。
  expect(text).not.toContain('sample:')
})

it('YAML 形状固定：cardId/identity/inputs/outputs/sources 都在，且可往返解析', () => {
  const root = newWorkspace()
  const text = dumpCardFile(CARD)
  const doc = yaml.load(text) as Record<string, unknown>
  expect(Object.keys(doc)).toEqual([
    'cardId',
    'kind',
    'name',
    'identity',
    'inputs',
    'outputs',
    'auth',
    'authEvidence',
    'sources',
  ])
  expect(parseCardFile(text)).toEqual(CARD)
})

it('坏卡不炸：YAML 语法坏、缺 identity、cardId 形状不对 → 都返回 undefined', () => {
  expect(parseCardFile('cardId: [unclosed')).toBeUndefined()
  expect(parseCardFile('cardId: card_000001\nkind: interface-card\n')).toBeUndefined()
  expect(
    parseCardFile(
      'cardId: card_x\nkind: interface-card\nidentity: {mergeKey: "GET /a", method: GET, urlTemplate: /a}\ninputs: []\noutputs: []\nsources: []\n',
    ),
  ).toBeUndefined()
})

it('索引只是加速器：索引缺失/被手改坏 → 按卡文件重建，绝不否认盘上的卡', () => {
  const root = newWorkspace()
  writeCard(root, CARD)
  const second: LibraryCard = { ...CARD, cardId: 'card_000002', identity: { ...CARD.identity, mergeKey: 'POST /api/orders:orgId' } }
  writeCard(root, second)

  // 完全没有 index.yaml
  const rebuilt = readIndex(root)
  expect(rebuilt.cards.map((entry) => entry.cardId)).toEqual(['card_000001', 'card_000002'])
  expect(rebuilt.nextCardSeq).toBe(3)

  // 索引被写成非对象
  writeIndex(root, rebuilt)
  writeFileSync(indexPath(root), '- 这不是索引\n', 'utf8')
  expect(readIndex(root).cards.map((entry) => entry.cardId)).toEqual(['card_000001', 'card_000002'])
})

it('索引不留在场但不存在的东西：卡被删了，条目跟着作废', () => {
  const root = newWorkspace()
  writeCard(root, CARD)
  const index = upsertIndexEntry(readIndex(root), CARD)
  writeIndex(root, index)
  expect(readIndex(root).cards).toHaveLength(1)

  expect(deleteCard(root, 'card_000001')).toBe(true)
  expect(readIndex(root).cards).toHaveLength(0)
  expect(readCard(root, 'card_000001')).toBeUndefined()
})

it('cardId 不复用：删卡后序号水位不回退（旧链引用不会被新卡顶替）', () => {
  const root = newWorkspace()
  writeCard(root, CARD)
  writeIndex(root, upsertIndexEntry(readIndex(root), CARD))
  expect(readIndex(root).nextCardSeq).toBe(2)

  deleteCard(root, 'card_000001')
  const after = readIndex(root)
  // 盘上没卡了，但水位已越过 1 —— 下一次分配不会拿回 card_000001。
  expect(after.nextCardSeq).toBe(2)
})

it('坏卡在目录里但不影响好卡的读取（坏卡跳过，好卡照常返回）', () => {
  const root = newWorkspace()
  writeCard(root, CARD)
  writeFileSync(join(cardsDir(root), 'card_000002.yaml'), 'cardId: [坏\n', 'utf8')

  expect(listCardIdsOnDisk(root)).toEqual(['card_000001', 'card_000002'])
  expect(listCards(root).map((card) => card.cardId)).toEqual(['card_000001'])
  // 坏卡占号但无内容：水位仍越过它，不撞号。
  expect(readIndex(root).nextCardSeq).toBe(3)
})

it('cardIdOf 补零到 6 位；库根固定在 .dsh/dataforge/library', () => {
  expect(cardIdOf(1)).toBe('card_000001')
  expect(cardIdOf(123456)).toBe('card_123456')
  expect(libraryRoot('/w')).toBe(join('/w', '.dsh', 'dataforge', 'library'))
})

it('与采集期归并键同口径：normalizeUrlForTemplate + mergeKeyOf 得同一把键', () => {
  const urlTemplate = normalizeUrlForTemplate('https://scm.example.com/api/materials?q=2120&page=1').urlTemplate
  expect(urlTemplate).toBe('/api/materials?page=1&q=2120')
  expect(mergeKeyOf('GET', urlTemplate)).toBe('GET /api/materials:page,q')
})

it('round-trip：writeCard → listCards 保留 unverified 与 notice 这类可选字段', () => {
  const root = newWorkspace()
  const withNotice: LibraryCard = { ...CARD, notice: ['入参 query.q 类型冲突：既有 string，新样本 number（保留既有）'] }
  writeCard(root, withNotice)
  expect(listCards(root)[0]).toEqual(withNotice)

  const plain: LibraryCard = { ...CARD, cardId: 'card_000003' }
  writeCard(root, plain)
  // 空的 notice 不落盘（不留 `notice: []` 噪音）。
  expect(readFileSync(join(cardsDir(root), 'card_000003.yaml'), 'utf8')).not.toContain('notice')
})

it('采集库缺席时不会因为"读库"留下半个库目录', () => {
  const root = newWorkspace()
  expect(existsSync(libraryRoot(root))).toBe(false)
  expect(libraryExists(root)).toBe(false)
})

// 引用一次 CaptureStore 类型，确保测试与采集库契约同源（编译期检查）。
export type _CaptureStore = CaptureStore
