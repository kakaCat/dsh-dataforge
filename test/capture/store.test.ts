import { expect, it } from 'vitest'
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
    responseBody: '{"err_no":0}', ts: 9,
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

