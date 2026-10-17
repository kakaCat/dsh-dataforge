/**
 * provider 运行级缓存（R-4 M3）：按 db/jar 文件 mtime+size 失效。
 *
 * 这组直接动真实文件系统：缓存语义里「文件变了要失效、文件没了沿用上次」是安全面
 * 的一部分（不能把跨 run 的陈旧凭证一直发出去），mock 掉就没有意义了。
 *
 * @module dsh-dataforge/test/capture/credentials-cache
 */
import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CaptureStore } from '../../src/capture/store.js'
import { createCaptureCredentialProvider } from '../../src/capture/credentials.js'
import { persistCookies } from '../../src/capture/credential-store.js'
import type { InterfaceCardDoc } from '../../src/chains/schema.js'

const NOW = 1_700_000_000_000

function cardOf(overrides: Partial<InterfaceCardDoc> = {}): InterfaceCardDoc {
  return {
    cardId: 'card_1',
    kind: 'interface-card',
    identity: { mergeKey: 'GET /api/x', method: 'GET', urlTemplate: '/api/x' },
    inputs: [],
    outputs: [],
    auth: 'cookie-session',
    sources: [{ captureId: 'cap_1', pages: ['https://a.example.com/page'] }],
    ...overrides,
  }
}

function storeOf(): { store: CaptureStore; dir: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'cred-cache-'))
  const dbPath = join(dir, 'capture.sqlite')
  const store = new CaptureStore(dbPath, join(dir, 'samples'), join(dir, 'events.ndjson'))
  store.upsertRun({
    id: 'cap_1',
    taskType: 'single_page',
    entryUrl: 'https://a.example.com/',
    status: 'done',
    startedAt: 1,
    stats: { pages: 0, requests: 0, cards: 0, credentials: 0 },
  })
  return { store, dir, dbPath }
}

function addCookie(store: CaptureStore, name: string, value: string): void {
  store.upsertCredential('cap_1', 'cookie', '.example.com', name, NOW, {
    name,
    value,
    domain: '.example.com',
    path: '/',
    secure: false,
    expires: -1,
  })
}

/** 删库（含 WAL/SHM 边车文件），模拟运行中途采集库消失。 */
function removeDatabase(dbPath: string): void {
  for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (existsSync(path)) rmSync(path, { force: true })
  }
}

describe('createCaptureCredentialProvider：cache=false 是缺省行为', () => {
  it('不传 cache：每次查询都重新打开采集库，库没了就降级', () => {
    const { store, dbPath } = storeOf()
    addCookie(store, 'sid', 'SECRET-1')
    const provider = createCaptureCredentialProvider({ dbPath, now: () => NOW })

    const first = provider({ card: cardOf(), url: 'https://a.example.com/api/x', method: 'GET', nodeId: 'n1' })
    expect(first.headers.cookie).toBe('sid=SECRET-1')

    store.close()
    removeDatabase(dbPath)

    const second = provider({ card: cardOf(), url: 'https://a.example.com/api/x', method: 'GET', nodeId: 'n1' })
    expect(second.headers).toEqual({})
    expect(second.application.status).toBe('none')
    expect(second.application.reason).toContain('采集库不可用')
  })
})

describe('createCaptureCredentialProvider：cache=true 运行级缓存', () => {
  it('首查后删库，带 cache 再查仍返回缓存行（同一运行内不因中途删库丢凭证）', () => {
    const { store, dbPath } = storeOf()
    addCookie(store, 'sid', 'SECRET-CACHED')
    const provider = createCaptureCredentialProvider({ dbPath, now: () => NOW, cache: true })

    const first = provider({ card: cardOf(), url: 'https://a.example.com/api/x', method: 'GET', nodeId: 'n1' })
    expect(first.headers.cookie).toBe('sid=SECRET-CACHED')

    store.close()
    removeDatabase(dbPath)

    const second = provider({ card: cardOf(), url: 'https://a.example.com/api/x', method: 'GET', nodeId: 'n1' })
    expect(second.headers.cookie).toBe('sid=SECRET-CACHED')
    expect(second.application.status).toBe('applied')
    // 摘要依旧只留名字，不含值。
    expect(JSON.stringify(second.application)).not.toContain('SECRET-CACHED')
  })

  it('采集库文件变化 → 缓存自动失效，读到新行（不缓存跨 run 陈旧数据）', () => {
    const { store, dbPath } = storeOf()
    addCookie(store, 'sid', 'OLD-VALUE')
    const provider = createCaptureCredentialProvider({ dbPath, now: () => NOW, cache: true })

    expect(
      provider({ card: cardOf(), url: 'https://a.example.com/api/x', method: 'GET', nodeId: 'n1' }).headers.cookie,
    ).toBe('sid=OLD-VALUE')

    // 新采集/换票写入新 cookie 并 checkpoint（关闭连接把 WAL 落回主库）。
    addCookie(store, 'fresh', 'NEW-VALUE')
    store.close()

    const after = provider({ card: cardOf(), url: 'https://a.example.com/api/x', method: 'GET', nodeId: 'n1' })
    expect(after.application.status).toBe('applied')
    expect(after.application.names).toContain('fresh')
    expect(after.headers.cookie).toContain('fresh=NEW-VALUE')
  })

  it('采集库连接未关闭时的 WAL 写入也失效（主库 mtime 可能不变，-wal 参与签名）', () => {
    const { store, dbPath } = storeOf()
    addCookie(store, 'sid', 'OLD-WAL')
    const provider = createCaptureCredentialProvider({ dbPath, now: () => NOW, cache: true })

    expect(
      provider({ card: cardOf(), url: 'https://a.example.com/api/x', method: 'GET', nodeId: 'n1' }).headers.cookie,
    ).toBe('sid=OLD-WAL')

    // 不关连接：SQLite WAL 提交只写 -wal 边车文件，主库文件的 mtime/size 不变。
    addCookie(store, 'fresh', 'NEW-WAL')

    const after = provider({ card: cardOf(), url: 'https://a.example.com/api/x', method: 'GET', nodeId: 'n1' })
    expect(after.headers.cookie).toContain('fresh=NEW-WAL')
    store.close()
  })

  it('持久化 jar 变化 → 重读并返回换票后的新值（storePath 参与缓存签名）', () => {
    const { store, dir, dbPath } = storeOf()
    addCookie(store, 'sid', 'from-capture')
    const storePath = join(dir, 'credentials', 'cookies.json')
    const provider = createCaptureCredentialProvider({ dbPath, storePath, now: () => NOW, cache: true })

    expect(
      provider({ card: cardOf(), url: 'https://a.example.com/api/x', method: 'GET', nodeId: 'n1' }).headers.cookie,
    ).toBe('sid=from-capture')

    persistCookies(storePath, 'https://a.example.com', ['sid=from-relogin'], NOW)

    const after = provider({ card: cardOf(), url: 'https://a.example.com/api/x', method: 'GET', nodeId: 'n1' })
    expect(after.headers.cookie).toBe('sid=from-relogin')
    expect(after.application.persisted).toBe(1)
  })

  it('读失败不缓存：库先缺席（none）、随后建好即读到', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cred-cache-late-'))
    const dbPath = join(dir, 'capture.sqlite')
    const provider = createCaptureCredentialProvider({ dbPath, now: () => NOW, cache: true })

    const before = provider({ card: cardOf(), url: 'https://a.example.com/api/x', method: 'GET', nodeId: 'n1' })
    expect(before.application.status).toBe('none')

    const store = new CaptureStore(dbPath, join(dir, 'samples'), join(dir, 'events.ndjson'))
    store.upsertRun({
      id: 'cap_1',
      taskType: 'single_page',
      entryUrl: 'https://a.example.com/',
      status: 'done',
      startedAt: 1,
      stats: { pages: 0, requests: 0, cards: 0, credentials: 0 },
    })
    addCookie(store, 'sid', 'LATE-VALUE')

    const after = provider({ card: cardOf(), url: 'https://a.example.com/api/x', method: 'GET', nodeId: 'n1' })
    expect(after.headers.cookie).toBe('sid=LATE-VALUE')
  })

  it('缓存按 captureId 隔离：不同来源不会互相串用', () => {
    const { store, dbPath } = storeOf()
    store.upsertRun({
      id: 'cap_2',
      taskType: 'single_page',
      entryUrl: 'https://b.example.com/',
      status: 'done',
      startedAt: 2,
      stats: { pages: 0, requests: 0, cards: 0, credentials: 0 },
    })
    addCookie(store, 'sid', 'A-SITE')
    store.upsertCredential('cap_2', 'cookie', '.example.com', 'sid2', NOW, {
      name: 'sid2',
      value: 'B-SITE',
      domain: '.example.com',
      path: '/',
      secure: false,
      expires: -1,
    })
    const provider = createCaptureCredentialProvider({ dbPath, now: () => NOW, cache: true })

    const a = provider({
      card: cardOf({ sources: [{ captureId: 'cap_1', pages: [] }] }),
      url: 'https://a.example.com/api/x', method: 'GET', nodeId: 'n1',
    })
    const b = provider({
      card: cardOf({ sources: [{ captureId: 'cap_2', pages: [] }] }),
      url: 'https://a.example.com/api/x', method: 'GET', nodeId: 'n2',
    })
    expect(a.headers.cookie).toBe('sid=A-SITE')
    expect(b.headers.cookie).toBe('sid2=B-SITE')
  })
})
