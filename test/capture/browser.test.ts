import { expect, it } from 'vitest'
import { readPageMeta, responseToRawSample, type WireSample } from '../../src/capture/browser.js'

const small: WireSample = {
  url: 'https://www.baidu.com/sugrec?prod=pc_his&json=1',
  method: 'GET',
  status: 200,
  resourceType: 'xhr',
  contentType: 'application/json; charset=utf-8',
  requestHeaders: { 'accept': 'application/json' },
  requestPostData: undefined,
  responseText: '{"q":"","err_no":0,"g":[{"q":"数据链测试"}]}',
  pageUrl: 'https://www.baidu.com/',
  ts: 1,
}

it('小 JSON 体：全量保留不截断，头与状态透传', () => {
  const out = responseToRawSample(small, 262_144)
  expect(out).not.toBeUndefined()
  expect(out?.status).toBe(200)
  expect(out?.responseBody).toContain('err_no')
  expect(out?.truncated).toBe(false)
})

it('超大体：不再挂预览，truncated 如实标 true', () => {
  const big = { ...small, responseText: 'x'.repeat(300_000) }
  const out = responseToRawSample(big, 262_144)
  expect(out?.responseBody).toBeUndefined()
  expect(out?.truncated).toBe(true)
})

it('fetch POST：请求体进 requestBody', () => {
  const post: WireSample = { ...small, method: 'POST', resourceType: 'fetch', requestPostData: '{"a":1}' }
  const out = responseToRawSample(post, 262_144)
  expect(out?.requestBody).toBe('{"a":1}')
})

it('xhr POST：请求体同样进 requestBody（回归：曾只对 fetch 取，业务 POST 入参全丢）', () => {
  const post: WireSample = { ...small, method: 'POST', resourceType: 'xhr', requestPostData: '{"prNo":"PR001","items":[1,2]}' }
  const out = responseToRawSample(post, 262_144)
  expect(out?.requestBody).toBe('{"prNo":"PR001","items":[1,2]}')
  expect(out?.truncated).toBe(false)
})

it('超限请求体：不挂正文，但 truncated 如实置 true（不假装没有入参）', () => {
  const post: WireSample = { ...small, method: 'POST', resourceType: 'xhr', requestPostData: 'x'.repeat(300_000) }
  const out = responseToRawSample(post, 262_144)
  expect(out?.requestBody).toBeUndefined()
  expect(out?.truncated).toBe(true)
})

/** readPageMeta 的页面替身：真浏览器里由 page.evaluate 执行取标题脚本，这里直接返回脚本结果。 */
function metaPage(raw: unknown): Parameters<typeof readPageMeta>[0] {
  return {
    url: () => 'https://x.test/a',
    evaluate: async () => raw,
  } as unknown as Parameters<typeof readPageMeta>[0]
}

it('readPageMeta：标题/站点名压空白，站点名按 og:site_name → application-name → apple 顺序取首个非空', async () => {
  const meta = await readPageMeta(metaPage({ title: '  示例 \n 站点 ', siteTags: ['', ' 示例 公司 ', '备用名'] }))
  expect(meta).toEqual({ url: 'https://x.test/a', title: '示例 站点', siteName: '示例 公司' })
})

it('readPageMeta：title ≤300、siteName ≤80 字符', async () => {
  const meta = await readPageMeta(metaPage({ title: 't'.repeat(400), siteTags: ['s'.repeat(120)] }))
  expect(meta.title).toHaveLength(300)
  expect(meta.siteName).toHaveLength(80)
})

it('readPageMeta：取值抛错（页面已销毁）→ 只回 url，不抛错', async () => {
  const page = {
    url: () => 'https://x.test/a',
    evaluate: async () => { throw new Error('target closed') },
  } as unknown as Parameters<typeof readPageMeta>[0]
  expect(await readPageMeta(page)).toEqual({ url: 'https://x.test/a' })
})

it('readPageMeta：没有标题/站点名时只回 url（不造空串字段）', async () => {
  expect(await readPageMeta(metaPage({ title: '  ', siteTags: [] }))).toEqual({ url: 'https://x.test/a' })
})
