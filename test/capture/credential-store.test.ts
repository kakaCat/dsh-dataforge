/**
 * 换票结果持久化（R-4 M3）：0600、按 origin 隔离、过期过滤、坏文件不炸。
 *
 * 这一组直接操作真实文件系统：权限位与原子写是安全面的一部分，mock 掉就没有意义了。
 *
 * @module dsh-dataforge/test/capture/credential-store
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  persistCookies,
  readPersistedCookies,
  readStore,
  writeStore,
} from '../../src/capture/credential-store.js'

const NOW = 1_700_000_000_000

function storePathOf(): string {
  return join(mkdtempSync(join(tmpdir(), 'cred-store-')), 'credentials', 'cookies.json')
}

describe('persistCookies / readPersistedCookies', () => {
  it('落盘 0600、目录 0700；读回带 origin 域与 secure', () => {
    const storePath = storePathOf()
    const written = persistCookies(storePath, 'https://a.example.com', ['sid=fresh; Path=/; HttpOnly'], NOW)
    expect(written).toBe(1)

    expect(statSync(storePath).mode & 0o777).toBe(0o600)
    expect(statSync(join(storePath, '..')).mode & 0o777).toBe(0o700)

    const cookies = readPersistedCookies(storePath, 'https://a.example.com', NOW)
    expect(cookies).toHaveLength(1)
    expect(cookies[0]).toMatchObject({
      name: 'sid',
      value: 'fresh',
      domain: 'a.example.com',
      path: '/',
      secure: true,
      captureId: 'persisted',
    })
  })

  it('按 origin 严格隔离：A 站 cookie 读不到 B 站', () => {
    const storePath = storePathOf()
    persistCookies(storePath, 'https://a.example.com', ['sid=a'], NOW)
    persistCookies(storePath, 'https://b.example.com', ['sid=b'], NOW)

    expect(readPersistedCookies(storePath, 'https://a.example.com', NOW).map((cookie) => cookie.value)).toEqual(['a'])
    expect(readPersistedCookies(storePath, 'https://b.example.com', NOW).map((cookie) => cookie.value)).toEqual(['b'])
    expect(readPersistedCookies(storePath, 'https://c.example.com', NOW)).toEqual([])
  })

  it('同名覆盖，其它 cookie 保留', () => {
    const storePath = storePathOf()
    persistCookies(storePath, 'https://a.example.com', ['sid=old; Path=/', 'locale=zh; Path=/'], NOW)
    persistCookies(storePath, 'https://a.example.com', ['sid=new; Path=/'], NOW + 1)
    const cookies = readPersistedCookies(storePath, 'https://a.example.com', NOW + 2)
    expect(cookies.map((cookie) => `${cookie.name}=${cookie.value}`).sort()).toEqual(['locale=zh', 'sid=new'])
  })

  it('Max-Age 优先于 Expires；Max-Age=0 立即过期，不写入', () => {
    const storePath = storePathOf()
    persistCookies(storePath, 'https://a.example.com', ['sid=old; Max-Age=3600; Expires=Wed, 21 Oct 2015 07:28:00 GMT'], NOW)
    const [cookie] = readPersistedCookies(storePath, 'https://a.example.com', NOW)
    expect(cookie?.expiresAt).toBe(NOW + 3_600_000)

    const written = persistCookies(storePath, 'https://a.example.com', ['dead=x; Max-Age=0'], NOW)
    expect(written).toBe(0)
  })

  it('已过期的持久化 cookie 不返回', () => {
    const storePath = storePathOf()
    persistCookies(storePath, 'https://a.example.com', ['sid=old; Max-Age=1'], NOW)
    expect(readPersistedCookies(storePath, 'https://a.example.com', NOW + 2_000)).toEqual([])
  })

  it('坏 JSON / 超大文件 → 空库，不抛', () => {
    const storePath = storePathOf()
    writeStore(storePath, { version: 1, origins: {} })
    writeFileSync(storePath, '{bad json', 'utf8')
    expect(readStore(storePath).origins).toEqual({})
    expect(readPersistedCookies(storePath, 'https://a.example.com', NOW)).toEqual([])

    const huge = join(mkdtempSync(join(tmpdir(), 'cred-store-huge-')), 'cookies.json')
    writeFileSync(huge, 'x'.repeat(600 * 1024), 'utf8')
    expect(readStore(huge).origins).toEqual({})
  })

  it('写入文件内容是 JSON，值只在文件里（不写日志/回执）', () => {
    const storePath = storePathOf()
    persistCookies(storePath, 'https://a.example.com', ['sid=TOP-SECRET'], NOW)
    const text = readFileSync(storePath, 'utf8')
    expect(text).toContain('TOP-SECRET')
    expect(JSON.parse(text)).toMatchObject({ version: 1 })
  })
})
