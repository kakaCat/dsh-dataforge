import { expect, it } from 'vitest'
import { responseToRawSample, type WireSample } from '../../src/capture/browser.js'

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
