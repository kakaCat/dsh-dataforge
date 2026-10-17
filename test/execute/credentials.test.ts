/**
 * 凭证匹配纯函数（R-4 M1）：domain / path / secure / expires 四道门 + 去重 + 头合并。
 *
 * 这一组不读采集库、不起服务：只验证「给定这些 cookie，这一发请求该带哪几个」。
 * 采集库到 provider 的翻译在 `test/capture/credentials.test.ts`，真实注入在 `run.test.ts`。
 *
 * @module dsh-dataforge/test/execute/credentials
 */
import { describe, expect, it } from 'vitest'
import type { CredentialCookie } from '../../src/execute/credentials.js'
import {
  appliedCredentialApplication,
  cookieHeaderFromSetCookies,
  cookieHeaderIn,
  cookieHeaderOf,
  cookieNamesOf,
  domainMatches,
  mergeCookieValues,
  mergeCredentialHeaders,
  pathMatches,
  selectCookies,
  setCookiePairsOf,
  withCookieHeader,
} from '../../src/execute/credentials.js'

const NOW = 1_700_000_000_000

function cookie(overrides: Partial<CredentialCookie> = {}): CredentialCookie {
  return {
    name: 'sid',
    value: 'SECRET-1',
    domain: '.example.com',
    path: '/',
    secure: false,
    captureId: 'cap_1',
    obtainedAt: 1,
    ...overrides,
  }
}

describe('domainMatches：不做后缀裸匹配', () => {
  it('父域命中子域与自身，不命中看起来像的别的域', () => {
    expect(domainMatches('a.example.com', '.example.com')).toBe(true)
    expect(domainMatches('example.com', '.example.com')).toBe(true)
    expect(domainMatches('badexample.com', '.example.com')).toBe(false)
    expect(domainMatches('example.com.evil.test', '.example.com')).toBe(false)
    expect(domainMatches('a.example.com', '')).toBe(false)
  })
})

describe('pathMatches：按路径段边界，不按字符串前缀', () => {
  it('/api 命中 /api/x，不命中 /apix；/ 恒命中', () => {
    expect(pathMatches('/api/x', '/api')).toBe(true)
    expect(pathMatches('/api', '/api')).toBe(true)
    expect(pathMatches('/apix', '/api')).toBe(false)
    expect(pathMatches('/anything', '/')).toBe(true)
    expect(pathMatches('/api/x', '/api/')).toBe(true)
  })
})

describe('selectCookies：匹配、过期、去重与排序', () => {
  it('只选同域、同路径、未过期且 secure 与协议匹配的 cookie', () => {
    const entries = [
      cookie({ name: 'a', domain: '.example.com', path: '/' }),
      cookie({ name: 'b', domain: 'other.test', path: '/' }),
      cookie({ name: 'c', domain: '.example.com', path: '/api' }),
      cookie({ name: 'd', domain: '.example.com', path: '/other' }),
      cookie({ name: 'e', domain: '.example.com', path: '/', secure: true }),
    ]
    const selection = selectCookies(entries, 'http://a.example.com/api/x', NOW)
    expect(selection.selected.map((item) => item.name)).toEqual(['c', 'a'])
    expect(selection.expired).toHaveLength(0)
    expect(selection.matched.map((item) => item.name).sort()).toEqual(['a', 'c'])
  })

  it('过期与已过期的会话 cookie 分开：expiresAt 缺失视为会话 cookie', () => {
    const selection = selectCookies(
      [
        cookie({ name: 'live', expiresAt: NOW + 60_000 }),
        cookie({ name: 'dead', expiresAt: NOW - 1 }),
        cookie({ name: 'session' }),
      ],
      'https://a.example.com/',
      NOW,
    )
    expect(selection.selected.map((item) => item.name).sort()).toEqual(['live', 'session'])
    expect(selection.expired.map((item) => item.name)).toEqual(['dead'])
    expect(selection.matched).toHaveLength(3)
  })

  it('同名同路径去重：优先更具体的域，其次更新的 obtainedAt', () => {
    const selection = selectCookies(
      [
        cookie({ name: 'sid', domain: '.example.com', value: 'parent', obtainedAt: 2 }),
        cookie({ name: 'sid', domain: 'a.example.com', value: 'child', obtainedAt: 1 }),
      ],
      'https://a.example.com/',
      NOW,
    )
    expect(selection.selected).toHaveLength(1)
    expect(selection.selected[0]?.value).toBe('child')
  })

  it('排序：path 长的在前，同长按 name', () => {
    const selection = selectCookies(
      [
        cookie({ name: 'z', path: '/' }),
        cookie({ name: 'b', path: '/api' }),
        cookie({ name: 'a', path: '/api' }),
      ],
      'https://a.example.com/api/x',
      NOW,
    )
    expect(selection.selected.map((item) => item.name)).toEqual(['a', 'b', 'z'])
  })

  it('非法 URL / 非 http(s) → 空结果，不抛', () => {
    const entries = [cookie()]
    expect(selectCookies(entries, 'not a url', NOW).selected).toEqual([])
    expect(selectCookies(entries, 'ftp://a.example.com/', NOW).selected).toEqual([])
  })
})

describe('cookieHeaderOf / mergeCredentialHeaders', () => {
  it('没有 cookie 就不造空头；有则按 name=value; ... 拼', () => {
    expect(cookieHeaderOf([])).toBeUndefined()
    const selection = selectCookies([cookie({ name: 'a', value: '1' }), cookie({ name: 'b', value: '2' })], 'https://a.example.com/', NOW)
    expect(cookieHeaderOf(selection.selected)).toBe('a=1; b=2')
  })

  it('cookie 与已有头拼接，其它同名头以注入值为准，大小写不敏感，且不改入参', () => {
    const existing = { Accept: 'application/json', cookie: 'manual=1' }
    const merged = mergeCredentialHeaders(existing, { Cookie: 'sid=2', accept: 'text/plain' })
    // 已有键保留原大小写（cookie），注入值拼在它后面；不会多造一个 Cookie 键。
    expect(merged['cookie']).toBe('manual=1; sid=2')
    expect(merged['Cookie']).toBeUndefined()
    // 已有键保留原大小写，值被注入值覆盖。
    expect(merged['Accept']).toBe('text/plain')
    expect(merged['accept']).toBeUndefined()
    // 大小写不敏感地看，只有一个 cookie 头。
    expect(Object.keys(merged).filter((name) => name.toLowerCase() === 'cookie')).toHaveLength(1)
    expect(existing).toEqual({ Accept: 'application/json', cookie: 'manual=1' })
  })
})

describe('M2 换票：Set-Cookie 解析与 cookie 头合并', () => {
  it('解析 name=value，丢属性；无等号/空值跳过', () => {
    expect(
      setCookiePairsOf([
        'sid=fresh; Path=/; HttpOnly',
        'locale=zh; Path=/; SameSite=Lax',
        'bad; Path=/',
        'empty=; Path=/',
      ]),
    ).toEqual([
      { name: 'sid', value: 'fresh' },
      { name: 'locale', value: 'zh' },
    ])
    expect(cookieHeaderFromSetCookies(['sid=fresh; Path=/', 'locale=zh'])).toBe('sid=fresh; locale=zh')
    expect(cookieHeaderFromSetCookies([])).toBeUndefined()
  })

  it('mergeCookieValues：fresh 覆盖同名，保留其它 cookie', () => {
    expect(mergeCookieValues('sid=old; locale=zh; theme=dark', 'sid=new; csrf=abc')).toBe(
      'sid=new; locale=zh; theme=dark; csrf=abc',
    )
    expect(mergeCookieValues(undefined, 'sid=new')).toBe('sid=new')
    expect(mergeCookieValues('sid=old', undefined)).toBe('sid=old')
    expect(mergeCookieValues(undefined, undefined)).toBeUndefined()
  })

  it('withCookieHeader：大小写不敏感替换，不修改入参', () => {
    const headers = { Cookie: 'sid=old', accept: 'application/json' }
    const next = withCookieHeader(headers, 'sid=new')
    expect(next['Cookie']).toBe('sid=new')
    expect(headers['Cookie']).toBe('sid=old')
    expect(withCookieHeader({}, 'sid=new')).toEqual({ cookie: 'sid=new' })
    expect(cookieHeaderIn({ Cookie: 'sid=new' })).toBe('sid=new')
  })

  it('cookieNamesOf：只给名字、去重保序', () => {
    expect(cookieNamesOf('sid=a; locale=zh; sid=b')).toEqual(['sid', 'locale'])
    expect(cookieNamesOf(undefined)).toEqual([])
  })
})

describe('appliedCredentialApplication：摘要只留名字/域，不含值', () => {
  it('names/domains 有，序列化全文没有 value', () => {
    const selection = selectCookies(
      [cookie({ name: 'sid', value: 'TOP-SECRET', domain: '.example.com' })],
      'https://a.example.com/',
      NOW,
    )
    const application = appliedCredentialApplication(selection, ['cap_1'])
    expect(application.status).toBe('applied')
    expect(application.names).toEqual(['sid'])
    expect(application.domains).toEqual(['example.com'])
    expect(application.header).toBe('cookie')
    expect(JSON.stringify(application)).not.toContain('TOP-SECRET')
  })
})
