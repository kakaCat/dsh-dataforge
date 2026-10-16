import { describe, expect, it } from 'vitest'
import {
  assignRoles,
  captureHost,
  extractLinks,
  jsonToTemplate,
  mergeKeyOf,
  normalizeUrlForTemplate,
} from '../../src/capture/normalizer.js'
import type { RawJson } from '../../src/shared/types.js'

describe('normalizeUrlForTemplate / mergeKeyOf', () => {
  it('数字与长随机段抽成 {p}，query 排序并滤易变键', () => {
    const t = normalizeUrlForTemplate('/mrp/pr/ordinary/171000031?q=1&sid=9&ts=3&q=1')
    expect(t.urlTemplate).toBe('/mrp/pr/ordinary/{p}:q=1')
    // 归并键只看路径 + query 键集合：page=1/page=2 是同一接口
    expect(mergeKeyOf('GET', t.urlTemplate)).toBe('GET /mrp/pr/ordinary/{p}:q')
  })

  it('同接口跨页（query 值不同、键相同）→ 同归并键', () => {
    const a = mergeKeyOf('GET', normalizeUrlForTemplate('/api/list?page=1&uid=88').urlTemplate)
    const b = mergeKeyOf('GET', normalizeUrlForTemplate('/api/list?page=2&uid=88').urlTemplate)
    expect(a).toBe(b)
  })
})

describe('jsonToTemplate / assignRoles', () => {
  it('嵌套 JSON 递归成模板字段，探测 code 路径', () => {
    const body: RawJson = { code: 0, msg: 'ok', data: { prNo: 'PR001', qty: 2 } }
    const t = jsonToTemplate(body)
    expect(t.codePath).toBe('code')
    expect(t.fields.map((f) => f.field)).toEqual(['code', 'msg', 'data.prNo', 'data.qty'])
  })

  it('assignRoles：两样本值变→input（非 unverified），单样本保持 unverified', () => {
    const s1: RawJson = { code: 0, wd: 'a' }
    const s2: RawJson = { code: 0, wd: 'b' }
    const t = assignRoles([s1, s2])
    const wd = t.fields.find((f) => f.field === 'wd')
    expect(wd?.role).toBe('input')
    expect(wd?.unverified).toBe(false)
    const single = assignRoles([{ code: 0, wd: 'a' }])
    expect(single.fields.find((f) => f.field === 'wd')?.unverified).toBe(true)
  })
})

describe('extractLinks', () => {
  it('同域绝对化去重，外域/非法链接剔除', () => {
    const links = extractLinks(
      '<a href="/b"></a><a href="/b"></a><a href="https://external.test/c"></a><a href="javascript:void(0)"></a>',
      'https://x.test/a',
      'x.test',
    )
    expect(links).toEqual(['https://x.test/b'])
  })

  it('captureHost 提取 host', () => {
    expect(captureHost('https://www.baidu.com/s')).toBe('www.baidu.com')
  })
})
