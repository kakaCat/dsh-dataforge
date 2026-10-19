import { expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CaptureStore } from '../../src/capture/store.js'
import { mergeKeyOf, normalizeUrlForTemplate } from '../../src/capture/normalizer.js'

function newStore(): { store: CaptureStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'capture-store-'))
  return {
    store: new CaptureStore(join(dir, 'capture.sqlite'), join(dir, 'samples'), join(dir, 'events.ndjson')),
    dir,
  }
}

it('全链路：run → page → sample → credential → card 去重归并 → finish → 查询', () => {
  const { store } = newStore()
  const captureId = 'cap_1'
  store.upsertRun({
    id: captureId, taskType: 'site_crawl', entryUrl: 'https://x.test',
    status: 'running', startedAt: 1, stats: { pages: 0, requests: 0, cards: 0, credentials: 0 },
  })
  const pageId = store.upsertPage(captureId, 'https://x.test/a', 0, 'ok')
  store.upsertSample(captureId, pageId, {
    url: 'https://x.api/a', method: 'GET', status: 200,
    requestHeaders: { 'a': '1' }, responseHeaders: { 'b': '2' },
    responseBody: '{"err_no":0}', ts: 9, bodyLimit: 262_144,
  })
  store.upsertCredential(captureId, 'cookie', 'https://x.test', 'HID', 9)

  const mk = (method: string, url: string): { mergeKey: string; urlTemplate: string } => {
    const urlTemplate = normalizeUrlForTemplate(url).urlTemplate
    return { urlTemplate, mergeKey: mergeKeyOf(method, urlTemplate) }
  }
  const { mergeKey } = mk('GET', 'https://x.api/a?page=1')
  const key1 = store.upsertCard(captureId, {
    mergeKey, method: 'GET', urlTemplate: normalizeUrlForTemplate('https://x.api/a?page=1').urlTemplate, relatedPageUrls: ['https://x.test/a'],
  })
  const key2 = store.upsertCard(captureId, {
    mergeKey, method: 'GET', urlTemplate: normalizeUrlForTemplate('https://x.api/a?page=1').urlTemplate, relatedPageUrls: ['https://x.test/a', 'https://x.test/b'],
    responseTemplate: { fields: [], codePath: 'err_no' },
  })
  expect(key2).toBe(key1)
  const card = store.getCard(key1)
  expect(card?.sampleCount).toBe(2)
  expect(card?.relatedPageUrls).toEqual(['https://x.test/a', 'https://x.test/b'])
  expect(card?.responseTemplate?.codePath).toBe('err_no')

  store.finishRun(captureId, 'done', undefined, { pages: 1, requests: 1, cards: 1, credentials: 1 })
  const run = store.getRun(captureId)
  expect(run?.status).toBe('done')
  expect(run?.stats.cards).toBe(1)
  expect(run?.endedAt).toBeGreaterThan(0)
  expect(store.listSamples(captureId)[0]?.url).toBe('https://x.api/a')
  expect(store.listPages(captureId)[0]?.url).toBe('https://x.test/a')
  expect(store.listCredentials(captureId)[0]?.name).toBe('HID')
  expect(store.listRuns(10)[0]?.id).toBe(captureId)
})

it('大响应体落文件（相对路径 samples/）', () => {
  const { store, dir } = newStore()
  store.upsertRun({
    id: 'cap_2', taskType: 'single_page', entryUrl: 'https://x.test',
    status: 'running', startedAt: 1, stats: { pages: 0, requests: 0, cards: 0, credentials: 0 },
  })
  store.upsertSample('cap_2', undefined, {
    url: 'https://x.api/big', method: 'POST', status: 200,
    requestHeaders: {}, responseHeaders: {},
    responseBody: Buffer.alloc(300_000, 'x'),
    bodyLimit: 262_144,
  })
  const rows = store.listSamples('cap_2')
  expect(rows[0]?.responseBodyPath).toContain('cap_2')
  expect(rows[0]?.responsePreview).toBeUndefined()
  expect(store.readBinary(rows[0]?.responseBodyPath ?? 'missing')).toHaveLength(300_000)
})

it('卡片身份按 run 隔离：跨 run 同接口各留各的卡，同 run 内仍归并', () => {
  const { store } = newStore()
  for (const id of ['cap_a', 'cap_b']) {
    store.upsertRun({
      id, taskType: 'action', entryUrl: 'https://x.test',
      status: 'running', startedAt: 1, stats: { pages: 0, requests: 0, cards: 0, credentials: 0 },
    })
  }
  const urlTemplate = normalizeUrlForTemplate('https://x.api/list?page=1').urlTemplate
  const mergeKey = mergeKeyOf('GET', urlTemplate)
  expect(mergeKey).toBe('GET /list:page')

  const c1 = store.upsertCard('cap_a', { mergeKey, method: 'GET', urlTemplate, relatedPageUrls: ['https://x.test/a'] })
  const c2 = store.upsertCard('cap_b', { mergeKey, method: 'GET', urlTemplate, relatedPageUrls: ['https://y.test/b'] })

  // 回归：merge_key 曾全库唯一 —— 第二张卡会被并进第一张，后一个 run 的 cards 视图直接是空的
  expect(c2).not.toBe(c1)
  expect(store.listCards('cap_a')).toHaveLength(1)
  expect(store.listCards('cap_b')).toHaveLength(1)
  expect(store.getCard(c1)?.captureId).toBe('cap_a')
  expect(store.getCard(c2)?.captureId).toBe('cap_b')
  expect(store.getCard(c1)?.sampleCount).toBe(1)
  expect(store.getCard(c2)?.relatedPageUrls).toEqual(['https://y.test/b'])

  // 同一 run 内同接口仍然归并：追加页面引用 + 样本计数
  const again = store.upsertCard('cap_a', { mergeKey, method: 'GET', urlTemplate, relatedPageUrls: ['https://x.test/a', 'https://x.test/c'] })
  expect(again).toBe(c1)
  expect(store.getCard(c1)?.sampleCount).toBe(2)
  expect(store.getCard(c1)?.relatedPageUrls).toEqual(['https://x.test/a', 'https://x.test/c'])
})

it('老库迁移：merge_key 全库唯一的历史表重建为 (capture_id, merge_key)，旧卡保留且不再串味', () => {
  const dir = mkdtempSync(join(tmpdir(), 'capture-legacy-'))
  const dbPath = join(dir, 'capture.sqlite')
  const legacy = new Database(dbPath)
  legacy.exec(`
    CREATE TABLE capture_runs (
      id TEXT PRIMARY KEY, task_type TEXT NOT NULL, entry_url TEXT NOT NULL,
      status TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER,
      stats_json TEXT NOT NULL DEFAULT '{}', error TEXT
    );
    CREATE TABLE interface_cards (
      id TEXT PRIMARY KEY, capture_id TEXT REFERENCES capture_runs(id), merge_key TEXT UNIQUE NOT NULL,
      name TEXT, url_template TEXT NOT NULL, method TEXT NOT NULL,
      request_template_json TEXT, response_template_json TEXT, auth_json TEXT,
      related_pages_json TEXT NOT NULL, sample_count INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    INSERT INTO capture_runs(id,task_type,entry_url,status,started_at,stats_json)
      VALUES('cap_old','action','https://old.test/','done',1,'{}');
    INSERT INTO interface_cards(id,capture_id,merge_key,name,url_template,method,related_pages_json,sample_count,created_at)
      VALUES('card_old','cap_old','GET /api/legacy:q','旧卡','/api/legacy?q=1','GET','["https://old.test/"]',1,1);
  `)
  legacy.close()

  const store = new CaptureStore(dbPath, join(dir, 'samples'), join(dir, 'events.ndjson'))
  expect(store.listAllCards()).toHaveLength(1)
  expect(store.getCard('card_old')?.name).toBe('旧卡')

  // 迁移后另一个 run 能拿同一个 merge_key 建自己的卡（旧约束下这里会并进 card_old）
  store.upsertRun({
    id: 'cap_new', taskType: 'action', entryUrl: 'https://new.test',
    status: 'running', startedAt: 2, stats: { pages: 0, requests: 0, cards: 0, credentials: 0 },
  })
  const fresh = store.upsertCard('cap_new', {
    mergeKey: 'GET /api/legacy:q', method: 'GET', urlTemplate: '/api/legacy?q=1', relatedPageUrls: ['https://new.test/'],
  })
  expect(fresh).not.toBe('card_old')
  expect(store.listAllCards()).toHaveLength(2)
  expect(store.getCard(fresh)?.captureId).toBe('cap_new')
  expect(store.getCard('card_old')?.sampleCount).toBe(1)
  store.close()
})

it('接口库分页：listAllCards LIMIT/OFFSET + countAllCards 与行数一致', async () => {
  const { store } = newStore()
  store.upsertRun({
    id: 'cap_p', taskType: 'action', entryUrl: 'https://x.test',
    status: 'running', startedAt: 1, stats: { pages: 0, requests: 0, cards: 0, credentials: 0 },
  })
  for (let i = 1; i <= 3; i += 1) {
    store.upsertCard('cap_p', {
      mergeKey: `GET /api/p${i}`, method: 'GET', urlTemplate: `/api/p${i}`,
      relatedPageUrls: [],
    })
    // created_at 毫秒粒度：退避让三张卡时间戳可区分（created_at DESC 排序才有确定性）
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  expect(store.countAllCards()).toBe(3)
  expect(store.listAllCards(1)).toHaveLength(1)
  expect(store.listAllCards(2).map((c) => c.urlTemplate)).toEqual(['/api/p3', '/api/p2'])
  expect(store.listAllCards(2, 1).map((c) => c.urlTemplate)).toEqual(['/api/p2', '/api/p1'])
  expect(store.listAllCards(2, 99)).toEqual([])
  store.close()
})

it('关系表：同 (card,page,指纹) 幂等聚一行；指纹不同新增一行；listRelations 可追溯', () => {
  const { store } = newStore()
  store.upsertRun({
    id: 'cap_r', taskType: 'single_page', entryUrl: 'https://x.test',
    status: 'running', startedAt: 1, stats: { pages: 0, requests: 0, cards: 0, credentials: 0 },
  })
  const cardId = store.upsertCard('cap_r', { mergeKey: 'GET /list:type', method: 'GET', urlTemplate: '/list?type=1', relatedPageUrls: [] })
  const pageId = store.upsertPage('cap_r', 'https://x.test/', 0, 'ok')

  const fp1 = store.upsertRelation('cap_r', cardId, 'https://x.test/', 'fp_type1', pageId)
  const fp1Again = store.upsertRelation('cap_r', cardId, 'https://x.test/', 'fp_type1')
  expect(fp1Again).toBe(fp1)
  const fp2 = store.upsertRelation('cap_r', cardId, 'https://x.test/', 'fp_type2')
  expect(fp2).not.toBe(fp1)

  const rels = store.listRelations('cap_r')
  expect(rels).toHaveLength(2)
  const first = rels.find((r) => r.id === fp1)
  expect(first).toMatchObject({
    cardId, pageId, pageUrl: 'https://x.test/', paramsFingerprint: 'fp_type1', sampleCount: 2,
  })
  expect(first?.lastSeenAt).toBeGreaterThanOrEqual(first?.firstSeenAt ?? 0)
  expect(first?.pageId).toBe(pageId)
  const second = rels.find((r) => r.id === fp2)
  expect(second?.paramsFingerprint).toBe('fp_type2')
  expect(second?.sampleCount).toBe(1)
})

it('样本回指关系行：attachSampleRelation 写 relation_id，listSamples/listRelationsByCard 可回溯', () => {
  const { store } = newStore()
  store.upsertRun({
    id: 'cap_s', taskType: 'single_page', entryUrl: 'https://x.test',
    status: 'running', startedAt: 1, stats: { pages: 0, requests: 0, cards: 0, credentials: 0 },
  })
  const pageId = store.upsertPage('cap_s', 'https://x.test/a', 0, 'ok')
  const cardId = store.upsertCard('cap_s', {
    mergeKey: 'GET /list:type', method: 'GET', urlTemplate: '/list?type=1', relatedPageUrls: ['https://x.test/a'],
  })
  const sampleId = store.upsertSample('cap_s', pageId, {
    url: 'https://x.test/list?type=1', method: 'GET', requestHeaders: {}, responseHeaders: {}, bodyLimit: 262_144,
  })
  const relationId = store.upsertRelation('cap_s', cardId, 'https://x.test/a', 'fp_a', pageId)
  expect(store.listSamples('cap_s')[0]?.relationId).toBeUndefined()

  store.attachSampleRelation(sampleId, relationId)
  expect(store.listSamples('cap_s')[0]?.relationId).toBe(relationId)
  const byCard = store.listRelationsByCard(cardId)
  expect(byCard.map((r) => r.id)).toEqual([relationId])
  expect(store.listRelationsByCard('card_none')).toEqual([])
})

it('老卡 legacy 关系回填：无关系行的历史卡按 related_pages_json 补 legacy 行，重复打开不重复', () => {
  const dir = mkdtempSync(join(tmpdir(), 'capture-legacy-rel-'))
  const dbPath = join(dir, 'capture.sqlite')
  const samplesDir = join(dir, 'samples')

  const first = new CaptureStore(dbPath, samplesDir)
  first.upsertRun({
    id: 'cap_old', taskType: 'single_page', entryUrl: 'https://old.test',
    status: 'done', startedAt: 1, stats: { pages: 0, requests: 0, cards: 0, credentials: 0 },
  })
  const pageId = first.upsertPage('cap_old', 'https://old.test/a', 0, 'ok')
  const cardId = first.upsertCard('cap_old', {
    mergeKey: 'GET /api/a:q', method: 'GET', urlTemplate: '/api/a?q=1',
    relatedPageUrls: ['https://old.test/a', 'https://old.test/not-recorded'],
  })
  expect(first.listRelations('cap_old')).toEqual([])
  first.close()

  // 关系模型上线前的库：开库时应自动补 legacy 关系行（页面能对上就带 pageId，对不上留空）
  const second = new CaptureStore(dbPath, samplesDir)
  const rels = second.listRelations('cap_old')
  expect(rels).toHaveLength(2)
  expect(rels.map((r) => r.paramsFingerprint)).toEqual(['legacy', 'legacy'])
  expect(rels.find((r) => r.pageUrl === 'https://old.test/a')?.pageId).toBe(pageId)
  expect(rels.find((r) => r.pageUrl === 'https://old.test/not-recorded')?.pageId).toBeUndefined()
  expect(rels.every((r) => r.cardId === cardId)).toBe(true)
  second.close()

  // 幂等：再开一次不重复补行
  const third = new CaptureStore(dbPath, samplesDir)
  expect(third.listRelations('cap_old')).toHaveLength(2)
  third.close()
})

it('鉴权标志写卡：authType/authEvidence 入 auth_json，读回时不丢 legacy authBinding', () => {
  const { store } = newStore()
  store.upsertRun({
    id: 'cap_auth', taskType: 'single_page', entryUrl: 'https://x.test',
    status: 'running', startedAt: 1, stats: { pages: 0, requests: 0, cards: 0, credentials: 0 },
  })
  const id = store.upsertCard('cap_auth', {
    mergeKey: 'GET /api', method: 'GET', urlTemplate: '/api', relatedPageUrls: [],
    authType: 'token-header', authEvidence: 'header:authorization',
  })
  const card = store.getCard(id)
  expect(card?.authType).toBe('token-header')
  expect(card?.authEvidence).toBe('header:authorization')

  const updated = store.upsertCard('cap_auth', {
    mergeKey: 'GET /api', method: 'GET', urlTemplate: '/api', relatedPageUrls: [],
    authBinding: { cookies: 2, storageKeys: 3 },
  })
  expect(updated).toBe(id)
  const merged = store.getCard(id)
  expect(merged?.authType).toBe('token-header')
  expect(merged?.authBinding).toEqual({ cookies: 2, storageKeys: 3 })
  expect(merged?.authEvidence).toBe('header:authorization')
})

it('notice：中途 setRunNotice 落取，finishRun 收口时保留', () => {
  const { store } = newStore()
  store.upsertRun({
    id: 'cap_n', taskType: 'single_page', entryUrl: 'https://x.test',
    status: 'running', startedAt: 1, stats: { pages: 0, requests: 0, cards: 0, credentials: 0 },
  })
  store.setRunNotice('cap_n', '样本上限 1000 已达，超出部分如实弃采')
  expect(store.getRun('cap_n')?.notice).toContain('样本上限')
  store.finishRun('cap_n', 'done')
  expect(store.getRun('cap_n')?.status).toBe('done')
  expect(store.getRun('cap_n')?.notice).toContain('样本上限')
})

it('notice 列迁移：无 notice 列的旧库打开后 ALTER 补齐，数据不丢', () => {
  const dir = mkdtempSync(join(tmpdir(), 'capture-legacy-notice-'))
  const dbPath = join(dir, 'capture.sqlite')
  const legacy = new Database(dbPath)
  legacy.exec(`
    CREATE TABLE capture_runs (
      id TEXT PRIMARY KEY, task_type TEXT NOT NULL, entry_url TEXT NOT NULL,
      status TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER,
      stats_json TEXT NOT NULL DEFAULT '{}', error TEXT
    );
    INSERT INTO capture_runs(id,task_type,entry_url,status,started_at,stats_json)
      VALUES('cap_old','single_page','https://old.test/','running',1,'{}');
  `)
  legacy.close()
  const store = new CaptureStore(dbPath, join(dir, 'samples'))
  store.setRunNotice('cap_old', '迁移后写入提醒')
  expect(store.getRun('cap_old')?.notice).toBe('迁移后写入提醒')
  store.close()
})


it('listPages：历史字面 URL 变体按页面身份归并（只影响投影；最近访问为准）', () => {
  const { store } = newStore()
  store.upsertRun({
    id: 'cap_pages', taskType: 'action', entryUrl: 'https://pan.baidu.com/disk/main',
    status: 'running', startedAt: 1, stats: { pages: 0, requests: 0, cards: 0, credentials: 0 },
  })
  // 关系模型引入前的历史库存的是字面 page.url()：同一 SPA 页面会有多行
  store.upsertPage('cap_pages', 'https://pan.baidu.com/disk/main#/index', 0, 'ok')
  store.upsertPage('cap_pages', 'https://pan.baidu.com/disk/main#/index?category=all', 0, 'ok')
  store.upsertPage('cap_pages', 'https://pan.baidu.com/disk/main?_at_=1792240465584#/index?category=all', 0, 'ok')
  store.upsertPage('cap_pages', 'https://pan.baidu.com/', 0, 'ok')

  const urls = store.listPages('cap_pages').map((p) => p.url)
  expect(urls).toHaveLength(2)
  expect(new Set(urls)).toEqual(new Set(['https://pan.baidu.com/', 'https://pan.baidu.com/disk/main#/index']))
  store.close()
})

it('listPages：先按身份归并再截断（历史多变体不会把后面的页面挤出 limit）', async () => {
  const { store } = newStore()
  store.upsertRun({
    id: 'cap_lim', taskType: 'action', entryUrl: 'https://x.test/',
    status: 'running', startedAt: 1, stats: { pages: 0, requests: 0, cards: 0, credentials: 0 },
  })
  store.upsertPage('cap_lim', 'https://x.test/older', 0, 'ok')
  await new Promise((resolve) => setTimeout(resolve, 3))
  store.upsertPage('cap_lim', 'https://x.test/dup#/a?x=1', 0, 'ok')
  await new Promise((resolve) => setTimeout(resolve, 3))
  store.upsertPage('cap_lim', 'https://x.test/dup#/a', 0, 'ok')

  // 最新两行是同一身份：先 LIMIT 2 再归并的旧实现只会返回 1 条、漏掉 older
  const pages = store.listPages('cap_lim', 2)
  expect(pages.map((p) => p.url)).toEqual(['https://x.test/dup#/a', 'https://x.test/older'])
  store.close()
})

it('pages 幂等：同 (capture_id,url) 重复写入只留一行、页数不重复计；非空 meta 增量补，空值不覆盖', () => {
  const { store } = newStore()
  store.upsertRun({
    id: 'cap_page_meta', taskType: 'single_page', entryUrl: 'https://x.test/',
    status: 'running', startedAt: 1, stats: { pages: 0, requests: 0, cards: 0, credentials: 0 },
  })
  const first = store.upsertPage('cap_page_meta', 'https://x.test/a', 0, 'ok', { title: '首页标题' })
  const again = store.upsertPage('cap_page_meta', 'https://x.test/a', 0, 'ok', { siteName: '示例站点' })
  expect(again).toBe(first)
  expect(store.getRun('cap_page_meta')?.stats.pages).toBe(1)
  expect(store.listPages('cap_page_meta')).toEqual([
    expect.objectContaining({ id: first, url: 'https://x.test/a', title: '首页标题', siteName: '示例站点' }),
  ])

  // 空串/未给 meta 不覆盖已有值（补抓只补缺）
  store.upsertPage('cap_page_meta', 'https://x.test/a', 0, 'ok', { title: '   ', siteName: '' })
  expect(store.listPages('cap_page_meta')[0]).toMatchObject({ title: '首页标题', siteName: '示例站点' })
  store.close()
})

it('listPageMeta：按页面身份去重（最新访问者胜）、跳过非 http(s)、空标题不造字段', async () => {
  const { store } = newStore()
  store.upsertRun({
    id: 'cap_meta', taskType: 'action', entryUrl: 'https://x.test/',
    status: 'running', startedAt: 1, stats: { pages: 0, requests: 0, cards: 0, credentials: 0 },
  })
  store.upsertPage('cap_meta', 'https://x.test/a#/list?tab=1', 0, 'ok', { title: '列表页' })
  await new Promise((resolve) => setTimeout(resolve, 3))
  store.upsertPage('cap_meta', 'https://x.test/a#/list', 0, 'ok', { siteName: '示例站点' })
  await new Promise((resolve) => setTimeout(resolve, 3))
  store.upsertPage('cap_meta', 'https://x.test/b', 0, 'ok')
  store.upsertPage('cap_meta', 'about:blank', 0, 'ok')

  // 最新访问者在前：b（最后一次访问）在 a#/list（同一身份的第二次访问）之前。
  // 之前没有等时间片，visited_at 同毫秒时排序退化成行顺序，并行跑测试会随机翻转。
  const rows = store.listPageMeta()
  expect(rows.map((row) => row.url)).toEqual(['https://x.test/b', 'https://x.test/a#/list'])
  const listPage = rows.find((row) => row.url === 'https://x.test/a#/list')
  expect(listPage).toMatchObject({ title: '列表页', siteName: '示例站点' })
  expect(typeof listPage?.visitedAt).toBe('number')
  // 无标题的页面：只缺该键，不出现空串字段
  expect(rows.find((row) => row.url === 'https://x.test/b')).not.toHaveProperty('title')
})

it('applyPageMeta：按页面身份匹配所有历史行、空值不覆盖、返回更新行数', () => {
  const { store } = newStore()
  store.upsertRun({
    id: 'cap_apply', taskType: 'action', entryUrl: 'https://x.test/',
    status: 'running', startedAt: 1, stats: { pages: 0, requests: 0, cards: 0, credentials: 0 },
  })
  // 历史字面 URL 变体两行，同一身份
  store.upsertPage('cap_apply', 'https://x.test/a#/list', 0, 'ok')
  store.upsertPage('cap_apply', 'https://x.test/a?_at_=1#/list?tab=1', 0, 'ok')
  store.upsertPage('cap_apply', 'https://x.test/other', 0, 'ok', { title: '别的页' })

  expect(store.applyPageMeta('https://x.test/a?_at_=2#/list', '补抓标题', '站点名')).toBe(2)
  const listPages = store.listPages('cap_apply').filter((page) => page.url === 'https://x.test/a#/list')
  expect(listPages).toHaveLength(1)
  expect(listPages[0]).toMatchObject({ title: '补抓标题', siteName: '站点名' })
  expect(store.listPages('cap_apply').find((page) => page.url === 'https://x.test/other')?.title).toBe('别的页')

  // 空值不覆盖旧值；无可用值时不更新任何行
  expect(store.applyPageMeta('https://x.test/a#/list', '', '')).toBe(0)
  store.applyPageMeta('https://x.test/a#/list', '  ', undefined)
  expect(store.listPages('cap_apply').find((page) => page.url === 'https://x.test/a#/list')?.title).toBe('补抓标题')
  // 不存在的身份：0 行
  expect(store.applyPageMeta('https://x.test/absent', '标题')).toBe(0)
})

it('pages.title/site_name 列迁移：旧库打开后 ALTER 补齐，历史行原样保留', () => {
  const dir = mkdtempSync(join(tmpdir(), 'capture-legacy-pages-'))
  const dbPath = join(dir, 'capture.sqlite')
  const legacy = new Database(dbPath)
  legacy.exec(`
    CREATE TABLE capture_runs (
      id TEXT PRIMARY KEY, task_type TEXT NOT NULL, entry_url TEXT NOT NULL,
      status TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER,
      stats_json TEXT NOT NULL DEFAULT '{}', error TEXT
    );
    CREATE TABLE pages (
      id TEXT PRIMARY KEY, capture_id TEXT REFERENCES capture_runs(id), url TEXT NOT NULL,
      depth INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'ok', visited_at INTEGER NOT NULL
    );
    INSERT INTO capture_runs(id,task_type,entry_url,status,started_at,stats_json)
      VALUES('cap_old','single_page','https://old.test/','done',1,'{"pages":1,"requests":0,"cards":0,"credentials":0}');
    INSERT INTO pages(id,capture_id,url,depth,status,visited_at)
      VALUES('pg_old','cap_old','https://old.test/a',0,'ok',1);
  `)
  legacy.close()

  const store = new CaptureStore(dbPath, join(dir, 'samples'))
  // 历史行保留（标题列新加，值为 NULL）；补抓可回写
  expect(store.listPageMeta()).toEqual([
    { url: 'https://old.test/a', visitedAt: 1 },
  ])
  expect(store.applyPageMeta('https://old.test/a', '补抓标题')).toBe(1)
  expect(store.listPageMeta()[0]).toMatchObject({ title: '补抓标题' })
  store.close()
})

it('listCookieJson：只回 kind=cookie 的 value_json 原文（补抓复用登录态）', () => {
  const { store } = newStore()
  store.upsertRun({
    id: 'cap_cookie', taskType: 'single_page', entryUrl: 'https://x.test/',
    status: 'running', startedAt: 1, stats: { pages: 0, requests: 0, cards: 0, credentials: 0 },
  })
  const cookieJson = JSON.stringify({ name: 'SID', value: 'v', domain: '.x.test', path: '/' })
  store.upsertCredential('cap_cookie', 'cookie', 'https://x.test/', 'SID', 1, JSON.parse(cookieJson))
  store.upsertCredential('cap_cookie', 'token', 'https://x.test/api', 'header:authorization', 2, { value: 'secret' })
  expect(store.listCookieJson()).toEqual([cookieJson])
})

it('卡片投影带 mergeKey（面板手工名的持久化键）', () => {
  const { store } = newStore()
  store.upsertRun({
    id: 'cap_mk', taskType: 'single_page', entryUrl: 'https://x.test/',
    status: 'running', startedAt: 1, stats: { pages: 0, requests: 0, cards: 0, credentials: 0 },
  })
  const mergeKey = mergeKeyOf('GET', '/api/list?page=1')
  const id = store.upsertCard('cap_mk', {
    mergeKey, method: 'GET', urlTemplate: '/api/list?page=1', relatedPageUrls: [],
  })
  expect(store.getCard(id)?.mergeKey).toBe(mergeKey)
  expect(store.listAllCards()[0]?.mergeKey).toBe(mergeKey)
})
