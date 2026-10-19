/**
 * 页面身份归一（shared/page-url）：SPA hash 路由 / 反缓存戳 / hash query 不换页。
 *
 * @module test/page-url
 */
import { expect, it } from 'vitest'
import { pageIdentityOf } from '../src/shared/page-url.js'

it('SPA：hash 路由 + hash query + 反缓存戳变体归为同一个页面身份', () => {
  const expected = 'https://pan.baidu.com/disk/main#/index'
  expect(pageIdentityOf('https://pan.baidu.com/disk/main#/index?category=all')).toBe(expected)
  expect(pageIdentityOf('https://pan.baidu.com/disk/main#/index')).toBe(expected)
  expect(pageIdentityOf('https://pan.baidu.com/disk/main?_at_=1792240465584#/index?category=all')).toBe(expected)
  expect(pageIdentityOf('https://pan.baidu.com/disk/main?_at_=1&t=2#/index/')).toBe(expected)
})

it('不同 hash 路由 / 不同路径仍是不同页面；根路径保留 `/`', () => {
  expect(pageIdentityOf('https://pan.baidu.com/disk/main#/index')).not.toBe(
    pageIdentityOf('https://pan.baidu.com/disk/main#/share'),
  )
  expect(pageIdentityOf('https://pan.baidu.com/disk/main#/index')).not.toBe(
    pageIdentityOf('https://pan.baidu.com/disk/home#/index'),
  )
  expect(pageIdentityOf('https://pan.baidu.com/')).toBe('https://pan.baidu.com/')
  expect(pageIdentityOf('https://pan.baidu.com/disk/main')).toBe('https://pan.baidu.com/disk/main')
})

it('协议 / host 大小写 / 默认端口 / 结尾斜杠 / 外层 query 归一', () => {
  expect(pageIdentityOf('HTTPS://EXAMPLE.com:443/a/?x=1')).toBe('https://example.com/a')
  expect(pageIdentityOf('http://example.com:8080')).toBe('http://example.com:8080/')
  expect(pageIdentityOf('https://example.com/a//')).toBe('https://example.com/a')
  expect(pageIdentityOf('https://example.com/a?tab=2')).toBe('https://example.com/a')
})

it('普通锚点不是另一个页面；hashbang 路由归一成 `#/route`', () => {
  expect(pageIdentityOf('https://x.test/doc#section-2')).toBe('https://x.test/doc')
  expect(pageIdentityOf('https://x.test/doc#section-3')).toBe('https://x.test/doc')
  expect(pageIdentityOf('https://x.test/app#!/list?page=2')).toBe('https://x.test/app#/list')
  expect(pageIdentityOf('https://x.test/app#/')).toBe('https://x.test/app')
})

it('非法 URL / 非 http(s) / 空串 trim 后原样返回（采集旁路不因归一化失败丢样本）', () => {
  expect(pageIdentityOf('')).toBe('')
  expect(pageIdentityOf('not-a-url')).toBe('not-a-url')
  expect(pageIdentityOf('ftp://x.test/a?b=1')).toBe('ftp://x.test/a?b=1')
  expect(pageIdentityOf('  https://x.test/a  ')).toBe('https://x.test/a')
})

it('幂等：身份串再归一一次不变（落库/读取两侧可安全复用）', () => {
  const samples = [
    'https://pan.baidu.com/disk/main#/index?category=all',
    'https://pan.baidu.com/disk/main?_at_=1792240465584#/index?category=all',
    'HTTPS://EXAMPLE.com:443/a/?x=1',
    'https://x.test/app#!/list?page=2',
    'https://x.test/doc#section-2',
    'https://x.test/%7Bp%7D/a',
    'not-a-url',
    '',
  ]
  for (const sample of samples) {
    const once = pageIdentityOf(sample)
    expect(pageIdentityOf(once)).toBe(once)
  }
})

it('百分号编码不做解码/重编码（%7Eu 与 ~u 视为不同，宁可少并不误并）', () => {
  expect(pageIdentityOf('https://x.test/%7Eu')).toBe('https://x.test/%7Eu')
  expect(pageIdentityOf('https://x.test/%7Eu')).not.toBe(pageIdentityOf('https://x.test/~u'))
  expect(pageIdentityOf('https://x.test/a%2Fb')).toBe('https://x.test/a%2Fb')
  expect(pageIdentityOf('https://x.test/a%2Fb')).not.toBe(pageIdentityOf('https://x.test/a%2fb'))
})
