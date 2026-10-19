import { describe, expect, it } from 'vitest'
import {
  assignRoles,
  buildRequestTemplate,
  buildResponseTemplate,
  captureHost,
  classifyAuth,
  extractLinks,
  formPairsOf,
  jsonToTemplate,
  mergeKeyOf,
  newRequestSamplesAcc,
  normalizeUrlForTemplate,
  paramsFingerprintOf,
  pathSegmentsOf,
  queryPairsOf,
  semanticName,
} from '../../src/capture/normalizer.js'
import type { RawJson } from '../../src/shared/types.js'

describe('normalizeUrlForTemplate / mergeKeyOf', () => {
  it('数字与长随机段抽成 {p}，query 排序并滤易变键', () => {
    const t = normalizeUrlForTemplate('/mrp/pr/ordinary/171000031?q=1&sid=9&ts=3&q=1')
    expect(t.urlTemplate).toBe('/mrp/pr/ordinary/{p}?q=1')
    // 归并键只看路径 + query 键集合：page=1/page=2 是同一接口
    expect(mergeKeyOf('GET', t.urlTemplate)).toBe('GET /mrp/pr/ordinary/{p}:q')
  })

  it('同接口跨页（query 值不同、键相同）→ 同归并键', () => {
    const a = mergeKeyOf('GET', normalizeUrlForTemplate('/api/list?page=1&uid=88').urlTemplate)
    const b = mergeKeyOf('GET', normalizeUrlForTemplate('/api/list?page=2&uid=88').urlTemplate)
    expect(a).toBe(b)
  })

  it('模板占位符的花括号原样保留（回归：new URL 会把 {p} 转义成 %7Bp%7D）', () => {
    // 入库的模板已经是归一化产物；再归一化一次必须幂等，否则 {p} 变成 %7Bp%7D，
    // 执行期就再也替换不回来（链上写的 path.p1 找不到落点）。
    const once = normalizeUrlForTemplate('/api/orders/{p}/items').urlTemplate
    expect(once).toBe('/api/orders/{p}/items')
    expect(normalizeUrlForTemplate(once).urlTemplate).toBe(once)

    // 具名占位符同理；且路径里数字段仍会被抽成 {p}。
    expect(normalizeUrlForTemplate('/api/orders/{orderId}/items/12345').urlTemplate).toBe(
      '/api/orders/{orderId}/items/{p}',
    )
    // 别的百分号转义不许被顺手解码（那可能是业务语义）。
    expect(normalizeUrlForTemplate('/api/files/a%2Fb').urlTemplate).toBe('/api/files/a%2Fb')
  })

  it('模板是合法 URL：query 用 ? 拼接（回归：曾用 : 拼成不可回放的串）', () => {
    const t = normalizeUrlForTemplate('https://x.test/api/s?wd=a&_t=1792172519230#frag')
    expect(t.urlTemplate).toBe('/api/s?wd=a')
    const u = new URL(t.urlTemplate, 'https://x.test')
    expect(u.searchParams.get('wd')).toBe('a')
  })

  it('易变键补齐：_t/isid/时间戳被滤，语义参数一个不吞', () => {
    const t = normalizeUrlForTemplate('/sugrec?prod=pc_his&_t=1792172519230&isid=160A73&req=2&wd=数据')
    // prod/req/wd 是真实入参（哪怕值多变）必须留；_t/isid 是每变无回放价值的噪声
    expect(t.urlTemplate).toBe('/sugrec?prod=pc_his&req=2&wd=数据')
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

describe('paramsFingerprintOf / queryPairsOf / semanticName（A7/A8）', () => {
  it('指纹：同形态稳定、跨形态可区分，幂等调用同指纹', () => {
    const a = paramsFingerprintOf('https://x.test/list?page=1&sid=9&_t=3', undefined)
    const b = paramsFingerprintOf('https://x.test/list?page=1&sid=7&_t=999', undefined)
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{16}$/)
    const c = paramsFingerprintOf('https://x.test/list?page=2')
    expect(c).not.toBe(a)
    const d = paramsFingerprintOf('https://x.test/list?page=1', '{"code":1}')
    expect(d).not.toBe(a)
  })

  it('指纹：query 键序与键大小写无关、易变键不出现在指纹里', () => {
    expect(paramsFingerprintOf('https://x.test/s?a=1&b=2')).toBe(paramsFingerprintOf('https://x.test/s?b=2&a=1'))
    expect(paramsFingerprintOf('https://x.test/s?_t=5')).toBe(paramsFingerprintOf('https://x.test/s?_t=6'))
  })

  it('指纹：body 键序无关、易变键（ts/sid）滤除', () => {
    const a = paramsFingerprintOf('https://x.test/api', '{"ts":999,"qty":2}')
    const b = paramsFingerprintOf('https://x.test/api', '{"qty":2,"ts":5}')
    expect(a).toBe(b)
  })

  it('queryPairsOf：滤易变键、重复键首值、排序输出', () => {
    expect(queryPairsOf('https://x.test/s?q=b&a=2&q=a&sid=x&_t=1')).toEqual([
      ['a', '2'],
      ['q', 'b'],
    ])
  })

  it('semanticName v2：去噪后取最后两段 humanize，不带方法前缀', () => {
    // 契约示例：接口前缀 / 版本段 / 纯数字段都被剥掉
    expect(semanticName('POST', '/aichat/api/messages/list')).toBe('messages · list')
    expect(semanticName('GET', '/sapi/v1/financelsegmacro/hotmetrics')).toBe('financelsegmacro · hotmetrics')
    expect(semanticName('GET', '/mrp/pr/ordinary/171000031?q=1')).toBe('pr · ordinary')
    // 什么都没有可读段：退回 method + host（没有 host 用 capture.local）
    expect(semanticName('GET', '/{p}')).toBe('GET capture.local')
    // 驼峰/下划线/连字符拆词 + 小写化；版本段 v2 剥掉后只剩 orders
    expect(semanticName('GET', '/api/getUserList')).toBe('get user list')
    expect(semanticName('POST', 'https://api.x.test/v2/orders')).toBe('orders')
    expect(semanticName('GET', '/rest/api/order_detail/DETAIL-1')).toBe('order detail · detail 1')
    // 只有一段可读时就是那一段（不是空串）
    expect(semanticName('DELETE', '/api/v1/sessions/{id}')).toBe('sessions')
  })

  it('semanticName v2：纯噪声路径（api/rest/index.html…）不参与命名', () => {
    expect(semanticName('GET', '/api/rest/index.html')).toBe('GET capture.local')
    expect(semanticName('GET', '/web/assets/app.js')).toBe('app js')
  })

  it('pathSegmentsOf：照实保留原始段', () => {
    expect(pathSegmentsOf('https://x.test/mrp/pr/171000031')).toEqual(['mrp', 'pr', '171000031'])
  })
})

describe('classifyAuth（FR-3.7，v1.3）', () => {
  it('token-header > token-param(query) > token-param(body) > cookie-session > none > unknown', () => {
    expect(classifyAuth('https://x.test/a', { Authorization: 'Bearer x' })).toEqual({
      authType: 'token-header', evidence: 'header:authorization',
    })
    expect(classifyAuth('https://x.test/a?access_token=tk', {})).toEqual({
      authType: 'token-param', evidence: 'query:access_token',
    })
    expect(classifyAuth('https://x.test/a', { 'content-type': 'json' }, '{"apiKey":"k"}')).toEqual({
      authType: 'token-param', evidence: 'body:apiKey',
    })
    expect(classifyAuth('https://x.test/a', { Cookie: 'sid=1' })).toEqual({
      authType: 'cookie-session', evidence: 'header:cookie:sid',
    })
    // 只有埋点/偏好类 cookie（会话名一个不中）→ 不算鉴权，避免「所有浏览器请求都是 cookie-session」
    expect(classifyAuth('https://x.test/a', { Cookie: '_ga=1; _gid=2; theme=dark' })).toEqual({ authType: 'none' })
    expect(classifyAuth('https://x.test/a', { 'user-agent': 'x' })).toEqual({ authType: 'none' })
    expect(classifyAuth('https://x.test/a', {})).toEqual({ authType: 'unknown' })
  })

  it('不在 VOLATILE 影响范围内：token 键在 raw query 上探测（易变键滤不吞鉴权线）', () => {
    expect(classifyAuth('https://x.test/a?_t=1&token=tk', {})).toEqual({
      authType: 'token-param', evidence: 'query:token',
    })
  })
})

describe('buildRequestTemplate / buildResponseTemplate（多形态模板）', () => {
  it('三段并集：query+body+头契约，位置标注正确；凭证头只以 credential 角色出现', () => {
    const acc = newRequestSamplesAcc()
    acc.querySamples.push([['page', '1']])
    acc.bodySamples.push({ qty: 2, ts: 9 })
    acc.headerSamples.push({ 'content-type': 'application/json', Cookie: 'sid=1', 'x-trace': 't1' })
    const t = buildRequestTemplate({ acc, sampleTotal: 3 })
    const byField = new Map(t.fields.map((f) => [f.field, f]))
    expect(byField.get('page')?.location).toBe('query')
    expect(byField.get('qty')?.location).toBe('body')
    expect(byField.get('ts')).toBeUndefined()
    expect(byField.get('content-type')?.location).toBe('header')
    expect(byField.get('cookie')?.role).toBe('credential')
    expect(byField.get('cookie')?.sample).toBe('')
    expect(byField.get('x-trace')?.location).toBe('header')
  })

  it('单样本保 unverified：sampleTotal=1 时全部未验证（诚实标注）', () => {
    const acc = newRequestSamplesAcc()
    acc.querySamples.push([['page', '1'], ['type', 'a']])
    const t = buildRequestTemplate({ acc, sampleTotal: 1 })
    for (const f of t.fields) expect(f.unverified).toBe(true)
  })

  it('query 跨样本值变化 → input 非未验证', () => {
    const acc = newRequestSamplesAcc()
    acc.querySamples.push([['page', '1']])
    acc.querySamples.push([['page', '2']])
    const t = buildRequestTemplate({ acc, sampleTotal: 2 })
    const page = t.fields.find((f) => f.field === 'page')
    expect(page?.role).toBe('input')
    expect(page?.unverified).toBe(false)
  })

  it('出参模板：多形态 diff 出 codePath 与 input 角色；非 JSON 文本返 undefined', () => {
    const t = buildResponseTemplate(['{"code":0,"wd":"a"}', '{"code":0,"wd":"b"}'])
    expect(t?.codePath).toBe('code')
    expect(t?.fields.find((f) => f.field === 'wd')?.role).toBe('input')
    expect(buildResponseTemplate(['<html>not json</html>'])).toBeUndefined()
  })

  it('数组入参进模板：对象数组按 [] 展开首元素，跨样本值变 → input（物料清单场景）', () => {
    const acc = newRequestSamplesAcc()
    acc.bodySamples.push({ materials: [{ sku: 'A1', qty: 1 }] })
    acc.bodySamples.push({ materials: [{ sku: 'B2', qty: 9 }] })
    const t = buildRequestTemplate({ acc, sampleTotal: 2 })
    const sku = t.fields.find((f) => f.field === 'materials[].sku')
    expect(sku?.location).toBe('body')
    expect(sku?.role).toBe('input')
    expect(sku?.unverified).toBe(false)
  })

  it('基本量数组成 field[] 字段（保序样本值）', () => {
    const t = jsonToTemplate({ ids: [1, 2, 3] })
    const field = t.fields.find((f) => f.field === 'ids[]')
    expect(field?.sample).toBe('[1,2,3]')
    expect(field?.type).toBe('number')
  })
})

describe('指纹覆盖数组与表单体（回归：物料清单/表单提交曾等于没有入参）', () => {
  it('数组内容不同 → 指纹不同', () => {
    const a = paramsFingerprintOf('https://x.test/api/pr', '{"materials":[{"sku":"A1","qty":1}]}')
    const b = paramsFingerprintOf('https://x.test/api/pr', '{"materials":[{"sku":"B2","qty":9}]}')
    expect(a).not.toBe(b)
  })

  it('数组元素顺序不同 → 指纹不同（保序）', () => {
    const a = paramsFingerprintOf('https://x.test/api/pr', '{"ids":[1,2]}')
    const b = paramsFingerprintOf('https://x.test/api/pr', '{"ids":[2,1]}')
    expect(a).not.toBe(b)
  })

  it('数组内容相同、键序不同 → 同指纹', () => {
    const a = paramsFingerprintOf('https://x.test/api/pr', '{"materials":[{"sku":"A1","qty":1}],"code":1}')
    const b = paramsFingerprintOf('https://x.test/api/pr', '{"code":1,"materials":[{"qty":1,"sku":"A1"}]}')
    expect(a).toBe(b)
  })

  it('表单体（urlencoded）内容不同 → 指纹不同；键序不同 → 同指纹', () => {
    const a = paramsFingerprintOf('https://x.test/api/pr', 'sku=A1&qty=1')
    const b = paramsFingerprintOf('https://x.test/api/pr', 'sku=B2&qty=9')
    const c = paramsFingerprintOf('https://x.test/api/pr', 'qty=1&sku=A1')
    expect(a).not.toBe(b)
    expect(a).toBe(c)
  })

  it('表单体解析不了（multipart）→ 如实不留配对，不抛错', () => {
    expect(formPairsOf('------boundary\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n------boundary--')).toBeUndefined()
    expect(paramsFingerprintOf('https://x.test/api', '------boundary--')).toMatch(/^[0-9a-f]{16}$/)
  })
})
