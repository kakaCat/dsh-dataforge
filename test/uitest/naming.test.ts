/**
 * 自动命名：站点名（站点名/域名）与流程名（标题/路径/时间兜底）。
 *
 * @module dsh-dataforge/test/uitest/naming
 */
import { describe, expect, it } from 'vitest'
import { autoNameFor, hostOfUrl, suggestFlowName, suggestSiteName } from '../../src/uitest/naming.js'

describe('suggestSiteName', () => {
  it('优先 og:site_name，其次域名（去 www./端口）', () => {
    expect(suggestSiteName({ url: 'https://pan.baidu.com/disk/main', siteName: '百度网盘' })).toBe('百度网盘')
    expect(suggestSiteName({ url: 'https://www.example.com:8443/x' })).toBe('example.com')
    expect(suggestSiteName({ url: 'not-a-url' })).toBe('')
  })
})

describe('suggestFlowName', () => {
  it('标题去掉站点名与分隔符，取第一段', () => {
    expect(suggestFlowName({ title: '百度网盘 - 我的文件', siteName: '百度网盘' })).toBe('我的文件')
    expect(suggestFlowName({ title: '登录 | 示例站', siteName: '示例站' })).toBe('登录')
  })

  it('标题为空 → 路径段；路径也没有 → 录制-时间兜底', () => {
    expect(suggestFlowName({ url: 'https://example.com/purchase/create' })).toBe('create')
    const fallback = suggestFlowName({ url: '' }, new Date('2026-10-18T15:56:00'))
    expect(fallback).toBe('录制-1018-1556')
  })
})

describe('autoNameFor / hostOfUrl', () => {
  it('一次生成站点+流程；hostOfUrl 处理非法值', () => {
    const name = autoNameFor({ url: 'https://www.example.com/orders', title: '订单列表 - 示例站', siteName: '示例站' })
    expect(name.site).toBe('示例站')
    expect(name.flow).toBe('订单列表')
    expect(hostOfUrl(undefined)).toBe('')
  })
})
