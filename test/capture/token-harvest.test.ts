/**
 * token 型凭证补采（R-4 M3）：从请求样本检测 Authorization / query token，落 credential_events。
 *
 * 两条通道分开验：
 *   - `detectTokenCredentials` 是纯函数，穷举 header/query/body 与去重；
 *   - `harvestTokenCredentials` 用真 `CaptureStore` 落 SQLite，验「只落 token 行、幂等、
 *     事件里只有名字/脱敏 URL、没有任何 token 原文」。
 *
 * @module dsh-dataforge/test/capture/token-harvest
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CaptureStore } from '../../src/capture/store.js'
import {
  detectTokenCredentials,
  harvestTokenCredentials,
  tokenValueOfJson,
  type TokenHarvestStore,
} from '../../src/capture/token-harvest.js'

/* ================================================================== 纯函数检测 */

describe('detectTokenCredentials：header / query / body 三处收割', () => {
  it('authorization / proxy-authorization 值全量保留（Bearer/Basic 原样）', () => {
    const drafts = detectTokenCredentials({
      url: 'https://a.example.com/api/x',
      method: 'GET',
      requestHeaders: {
        Authorization: 'Bearer SECRET-HEADER',
        'Proxy-Authorization': 'Basic dXNlcjpwYXNz',
        Accept: 'application/json',
      },
    })

    expect(drafts.map((draft) => draft.name).sort()).toEqual([
      'header:authorization',
      'header:proxy-authorization',
    ])
    const auth = drafts.find((draft) => draft.name === 'header:authorization')
    expect(auth?.value).toEqual({ location: 'header', name: 'authorization', value: 'Bearer SECRET-HEADER' })
    const proxy = drafts.find((draft) => draft.name === 'header:proxy-authorization')
    expect(proxy?.value.value).toBe('Basic dXNlcjpwYXNz')
    expect(proxy?.url).toBe('https://a.example.com/api/x')
  })

  it('query token 参数大小写不敏感；普通参数不采', () => {
    const drafts = detectTokenCredentials({
      url: 'https://a.example.com/api?ACCESS_TOKEN=SECRET-Q&page=2&api-key=KEY-2&jwt=JWT-3&q=x',
      method: 'GET',
      requestHeaders: {},
    })

    expect(drafts.map((draft) => draft.name).sort()).toEqual([
      'query:access_token',
      'query:api-key',
      'query:jwt',
    ])
    // value.name 保留采集时的原始参数名（拼 query 时用它才是原站的语义）。
    expect(drafts.find((draft) => draft.name === 'query:access_token')?.value.name).toBe('ACCESS_TOKEN')
    expect(drafts.find((draft) => draft.name === 'query:access_token')?.value.value).toBe('SECRET-Q')
  })

  it('JSON body 顶层 token 字段也检测（注入侧本期 unsupported，但先如实落库标记）', () => {
    const drafts = detectTokenCredentials({
      url: 'https://a.example.com/api/login',
      method: 'POST',
      requestHeaders: {},
      requestBodyPreview: '{"access_token":"SECRET-BODY","user":"alice","token_type":"Bearer"}',
      contentType: 'application/json',
    })

    expect(drafts).toHaveLength(1)
    expect(drafts[0]?.name).toBe('body:access_token')
    expect(drafts[0]?.value).toEqual({ location: 'body', name: 'access_token', value: 'SECRET-BODY' })
  })

  it('坏 JSON / 非 JSON 正文不炸，也不误采', () => {
    expect(
      detectTokenCredentials({
        url: 'https://a.example.com/api',
        method: 'POST',
        requestHeaders: {},
        requestBodyPreview: '{not json',
        contentType: 'application/json',
      }),
    ).toEqual([])
    expect(
      detectTokenCredentials({
        url: 'https://a.example.com/api',
        method: 'POST',
        requestHeaders: {},
        requestBodyPreview: 'access_token=SECRET-FORM',
        contentType: 'application/x-www-form-urlencoded',
      }),
    ).toEqual([])
  })

  it('同一 name+url+value 只产出一条（头名大小写重复也算同一条）', () => {
    const drafts = detectTokenCredentials({
      url: 'https://a.example.com/api',
      method: 'GET',
      requestHeaders: {
        Authorization: 'Bearer DUP-TOKEN',
        authorization: 'Bearer DUP-TOKEN',
      },
    })

    expect(drafts).toHaveLength(1)
  })
})

describe('tokenValueOfJson：坏行返回 undefined', () => {
  it('形状不对一律跳过', () => {
    expect(tokenValueOfJson(undefined)).toBeUndefined()
    expect(tokenValueOfJson('')).toBeUndefined()
    expect(tokenValueOfJson('{bad')).toBeUndefined()
    expect(tokenValueOfJson('[]')).toBeUndefined()
    expect(tokenValueOfJson(JSON.stringify({ location: 'cookie', name: 'x', value: 'y' }))).toBeUndefined()
    expect(tokenValueOfJson(JSON.stringify({ location: 'header', name: 'authorization', value: '' }))).toBeUndefined()
    expect(tokenValueOfJson(JSON.stringify({ location: 'header', name: 'authorization', value: 'Bearer x' }))).toEqual({
      location: 'header',
      name: 'authorization',
      value: 'Bearer x',
    })
  })
})

/* ================================================================== 真实采集库落库 */

function storeOf(): { store: CaptureStore; dir: string; dbPath: string; eventsPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'token-harvest-'))
  const dbPath = join(dir, 'capture.sqlite')
  const eventsPath = join(dir, 'events.ndjson')
  const store = new CaptureStore(dbPath, join(dir, 'samples'), eventsPath)
  store.upsertRun({
    id: 'cap_1',
    taskType: 'single_page',
    entryUrl: 'https://a.example.com/',
    status: 'done',
    startedAt: 1,
    stats: { pages: 0, requests: 0, cards: 0, credentials: 0 },
  })
  return { store, dir, dbPath, eventsPath }
}

function addSample(
  store: CaptureStore,
  url: string,
  requestHeaders: Record<string, string>,
  requestBody?: string,
): void {
  store.upsertSample('cap_1', undefined, {
    url,
    method: requestBody === undefined ? 'GET' : 'POST',
    status: 200,
    requestHeaders,
    responseHeaders: { 'content-type': 'application/json' },
    ...(requestBody === undefined ? {} : { requestBody }),
    bodyLimit: 4096,
  })
}

/** 只读 events.ndjson 里的 credential 事件（request 事件会带采集期原始 URL）。 */
function credentialEventText(eventsPath: string): string {
  return readFileSync(eventsPath, 'utf8')
    .split('\n')
    .filter((line) => line.includes('"credential"'))
    .join('\n')
}

describe('harvestTokenCredentials：只落 token 行、事件零值、幂等', () => {
  it('header + query token → kind=token；事件只有名字与脱敏 URL', () => {
    const { store, eventsPath } = storeOf()
    addSample(store, 'https://a.example.com/api/x', { Authorization: 'Bearer SECRET-HEADER' })
    addSample(store, 'https://a.example.com/api/list?access_token=SECRET-QUERY', {})

    const added = harvestTokenCredentials(store, 'cap_1')
    expect(added).toBe(2)

    const rows = store.listCredentials('cap_1', 50).filter((row) => row.kind === 'token')
    expect(rows.map((row) => row.name).sort()).toEqual(['header:authorization', 'query:access_token'])
    // 值只进 value_json（凭证库允许的落点）。
    const persisted = rows.map((row) => tokenValueOfJson(row.valueJson))
    expect(persisted.map((value) => value?.value).sort()).toEqual(['Bearer SECRET-HEADER', 'SECRET-QUERY'])

    // 事件里没有值：凭证事件只记 name/url，URL 里的 token 参数值已打码。
    const credentialEvents = credentialEventText(eventsPath)
    expect(credentialEvents).toContain('header:authorization')
    expect(credentialEvents).toContain('query:access_token')
    expect(credentialEvents).not.toContain('SECRET-HEADER')
    expect(credentialEvents).not.toContain('SECRET-QUERY')
    // 落库 URL 也打码，不在 credential_events.url 复写一份明文。
    expect(rows.every((row) => !row.url.includes('SECRET-QUERY'))).toBe(true)
    expect(rows.find((row) => row.name === 'query:access_token')?.url).toContain('access_token=***')
  })

  it('重复调用幂等：第二次新增 0 条', () => {
    const { store } = storeOf()
    addSample(store, 'https://a.example.com/api/x', { authorization: 'Bearer ONCE' })
    addSample(store, 'https://a.example.com/api/list?token=ONCE-Q', {})

    expect(harvestTokenCredentials(store, 'cap_1')).toBe(2)
    expect(harvestTokenCredentials(store, 'cap_1')).toBe(0)
    expect(store.listCredentials('cap_1', 50).filter((row) => row.kind === 'token')).toHaveLength(2)
  })

  it('坏 value_json 的既有行不炸批，也不阻断新的补采', () => {
    const { store } = storeOf()
    store.upsertCredential('cap_1', 'token', 'https://a.example.com/', 'header:authorization', 1, undefined)
    addSample(store, 'https://a.example.com/api/x', { authorization: 'Bearer GOOD' })

    expect(harvestTokenCredentials(store, 'cap_1')).toBe(1)
    expect(
      store.listCredentials('cap_1', 50).filter((row) => row.kind === 'token' && row.valueJson !== undefined),
    ).toHaveLength(1)
  })

  it('不同 captureId 的样本互不串（补采只扫当前 captureId）', () => {
    const { store } = storeOf()
    store.upsertRun({
      id: 'cap_2',
      taskType: 'single_page',
      entryUrl: 'https://b.example.com/',
      status: 'done',
      startedAt: 2,
      stats: { pages: 0, requests: 0, cards: 0, credentials: 0 },
    })
    addSample(store, 'https://a.example.com/api/x', { authorization: 'Bearer CAP-1' })
    store.upsertSample('cap_2', undefined, {
      url: 'https://b.example.com/api/x',
      method: 'GET',
      requestHeaders: { authorization: 'Bearer CAP-2' },
      responseHeaders: {},
      bodyLimit: 4096,
    })

    expect(harvestTokenCredentials(store, 'cap_1')).toBe(1)
    expect(harvestTokenCredentials(store, 'cap_2')).toBe(1)
    expect(store.listCredentials('cap_1', 50).filter((row) => row.kind === 'token')).toHaveLength(1)
    expect(store.listCredentials('cap_2', 50).filter((row) => row.kind === 'token')).toHaveLength(1)
  })

  it('store 面最小契约可注入（假 store 也能补采）', () => {
    const calls: string[] = []
    const fake: TokenHarvestStore = {
      listSamples: () => [
        {
          id: 'sm_1',
          captureId: 'cap_f',
          pageUrl: 'https://a.example.com/',
          seq: 1,
          url: 'https://a.example.com/api?access_token=SECRET-FAKE',
          method: 'GET',
          requestHeaders: { authorization: 'Bearer SECRET-FAKE-H' },
          responseHeaders: {},
          truncated: false,
          ts: 1,
        },
      ],
      listCredentials: () => [],
      upsertCredential: (_captureId, _kind, url, name) => {
        calls.push(`${name} ${url}`)
        return `cr_${calls.length}`
      },
    }

    expect(harvestTokenCredentials(fake, 'cap_f')).toBe(2)
    expect(calls.some((call) => call.startsWith('header:authorization '))).toBe(true)
    expect(calls.every((call) => !call.includes('SECRET-FAKE'))).toBe(true)
  })
})
