/**
 * CaptureNamesStore：三级手工名覆盖的持久化与键归一。
 *
 * @module test/capture/names
 */
import { expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import yaml from 'js-yaml'
import { CaptureNamesStore } from '../../src/capture/names.js'

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'df-names-'))
}

function namesPathOf(root: string): string {
  return join(root, 'capture', 'names.yaml')
}

it('缺文件：快照是空对象，不抛错', () => {
  const store = new CaptureNamesStore(namesPathOf(tempRoot()))
  expect(store.snapshot()).toEqual({ sites: {}, pages: {}, interfaces: {} })
})

it('键归一：site 小写、page 走页面身份、interface 原样 trim；返回值是最新快照', () => {
  const store = new CaptureNamesStore(namesPathOf(tempRoot()))
  expect(store.set('site', 'Example.COM', ' 示例 站点 ').sites).toEqual({ 'example.com': '示例 站点' })
  expect(
    store.set('page', 'https://pan.baidu.com/disk/main?_at_=1#/index?category=all', '网盘首页').pages,
  ).toEqual({ 'https://pan.baidu.com/disk/main#/index': '网盘首页' })
  expect(store.set('interface', '  GET /api/list:page  ', '列表接口').interfaces).toEqual({
    'GET /api/list:page': '列表接口',
  })
})

it('落盘 YAML 可被重新加载（跨进程/重启不丢），目录自动创建', () => {
  const path = namesPathOf(tempRoot())
  const store = new CaptureNamesStore(path)
  store.set('site', 'x.test', '测试站')
  store.set('interface', 'GET /a', '接口A')

  // 同一路径新实例 = 冷启动重读
  expect(new CaptureNamesStore(path).snapshot()).toEqual({
    sites: { 'x.test': '测试站' },
    pages: {},
    interfaces: { 'GET /a': '接口A' },
  })
  const doc = yaml.load(readFileSync(path, 'utf8')) as Record<string, unknown>
  expect(doc).toMatchObject({ sites: { 'x.test': '测试站' }, interfaces: { 'GET /a': '接口A' } })
})

it('空串 = 删除该条覆盖（其余条目保留）', () => {
  const path = namesPathOf(tempRoot())
  const store = new CaptureNamesStore(path)
  store.set('site', 'a.test', 'A')
  store.set('site', 'b.test', 'B')
  expect(store.set('site', 'a.test', '   ').sites).toEqual({ 'b.test': 'B' })
  expect(new CaptureNamesStore(path).snapshot().sites).toEqual({ 'b.test': 'B' })
})

it('坏文件：YAML 解析失败/形状不对一律降级为空，不抛错（坏段丢弃、好段保留）', () => {
  const root = tempRoot()
  const path = namesPathOf(root)
  mkdirSync(dirname(path), { recursive: true })

  writeFileSync(path, '{{{{ not yaml', 'utf8')
  expect(new CaptureNamesStore(path).snapshot()).toEqual({ sites: {}, pages: {}, interfaces: {} })

  writeFileSync(path, yaml.dump({ sites: 'not-a-record', pages: { 'https://x.test/': '页面名' } }), 'utf8')
  expect(new CaptureNamesStore(path).snapshot()).toEqual({
    sites: {},
    pages: { 'https://x.test/': '页面名' },
    interfaces: {},
  })
  rmSync(root, { recursive: true, force: true })
})
