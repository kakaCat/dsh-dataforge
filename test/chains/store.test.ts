/**
 * 链文件存取：版本快照、回读、导出、卡解析器。
 *
 * @module dsh-dataforge/test/chains/store
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ChainDoc } from '../../src/chains/schema.js'
import {
  cardsRoot,
  chainDir,
  chainFilePath,
  defaultCardResolver,
  listChainVersions,
  listChains,
  loadChain,
  nextChainVersion,
  readCard,
  readChainText,
  saveChain,
  slugOf,
} from '../../src/chains/store.js'
import { allCards, chainDoc, createOrderCard, node, searchCard } from './fixtures.js'

const SITE = '智慧供应链 SCM'
const FLOW = '采购下单'

let dir: string | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'df-chain-'))
})

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

function workspace(): string {
  return dir as string
}

function save(doc: ChainDoc) {
  return saveChain(workspace(), doc, { resolveCard: allCards })
}

/** 把假卡按接口库的落盘形状写进工作区（YAML 是 JSON 的超集，直接写 JSON）。 */
function writeCard(card: typeof searchCard): void {
  const dirPath = cardsRoot(workspace())
  mkdirSync(dirPath, { recursive: true })
  writeFileSync(join(dirPath, `${card.cardId}.yaml`), JSON.stringify(card, null, 2), 'utf8')
}

describe('版本快照', () => {
  it('第一次落盘是 v1，路径按 site/flow 分目录', () => {
    const result = save(chainDoc())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.version).toBe(1)
    expect(result.path).toBe(join(workspace(), '.dsh', 'dataforge', 'chains', '智慧供应链-scm', '采购下单', 'v1.yaml'))
    expect(existsSync(result.path)).toBe(true)
    expect(readFileSync(result.path, 'utf8')).toContain('version: 1')
  })

  it('再落一次是 v2（版本只增不覆盖）', () => {
    save(chainDoc())
    const second = save(chainDoc())
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.version).toBe(2)
    expect(listChainVersions(workspace(), SITE, FLOW)).toEqual([1, 2])
    expect(nextChainVersion(workspace(), SITE, FLOW)).toBe(3)
  })

  it('输入里的 meta.version 被覆盖成实际分配到的版本号', () => {
    const result = save(chainDoc({ meta: { ...chainDoc().meta, version: 7 } }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.version).toBe(1)
    expect(result.doc.meta.version).toBe(1)
  })

  it('旧的 created 保留，坏掉的 created 换成写入时刻', () => {
    const keep = save(chainDoc())
    expect(keep.ok).toBe(true)
    if (!keep.ok) return
    expect(keep.doc.meta.created).toBe('2026-10-17T12:00:00Z')

    const replaced = save(chainDoc({ meta: { ...chainDoc().meta, created: 'not-a-date' } }))
    expect(replaced.ok).toBe(true)
    if (!replaced.ok) return
    expect(Number.isNaN(Date.parse(replaced.doc.meta.created))).toBe(false)
  })
})

describe('回读', () => {
  it('缺省读最新，指定版本读指定版本', () => {
    save(chainDoc())
    save(chainDoc({ nodes: [chainDoc().nodes[0]], edges: [] }))

    const latest = loadChain(workspace(), SITE, FLOW, { resolveCard: allCards })
    expect(latest.ok).toBe(true)
    if (!latest.ok) return
    expect(latest.version).toBe(2)
    expect(latest.doc.nodes).toHaveLength(1)

    const first = loadChain(workspace(), SITE, FLOW, { version: 1, resolveCard: allCards })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.doc.nodes).toHaveLength(2)
    expect(first.doc.edges).toHaveLength(1)
  })

  it('版本不存在 → chain-not-found，并列出可用版本', () => {
    save(chainDoc())
    const missing = loadChain(workspace(), SITE, FLOW, { version: 9, resolveCard: allCards })
    expect(missing.ok).toBe(false)
    if (missing.ok) return
    expect(missing.code).toBe('chain-not-found')
    expect(missing.availableVersions).toEqual([1])

    const empty = loadChain(workspace(), '没有这个站', FLOW, { resolveCard: allCards })
    expect(empty.ok).toBe(false)
    if (!empty.ok && empty.code === 'chain-not-found') expect(empty.availableVersions).toEqual([])
  })

  it('文件被手改坏 → invalid-chain，旧版本照样能读', () => {
    save(chainDoc())
    save(chainDoc())
    writeFileSync(chainFilePath(workspace(), SITE, FLOW, 2), 'apiVersion: [ broken', 'utf8')

    const broken = loadChain(workspace(), SITE, FLOW, { resolveCard: allCards })
    expect(broken.ok).toBe(false)
    if (broken.ok) return
    expect(broken.code).toBe('invalid-chain')
    if (broken.code !== 'invalid-chain') return
    expect(broken.availableVersions).toEqual([1, 2])
    expect(broken.message).toContain('可回读旧版本')

    expect(loadChain(workspace(), SITE, FLOW, { version: 1, resolveCard: allCards }).ok).toBe(true)
  })

  it('语义坏掉（卡没导入）也在读时拦下', () => {
    const result = saveChain(workspace(), chainDoc(), { resolveCard: allCards })
    expect(result.ok).toBe(true)
    const loaded = loadChain(workspace(), SITE, FLOW, { resolveCard: () => undefined })
    expect(loaded.ok).toBe(false)
    if (loaded.ok || loaded.code !== 'invalid-chain') return
    expect(loaded.issues[0].code).toBe('card-not-imported')
  })

  it('导出即原文（零凭证不需要再剥一层）', () => {
    const saved = save(chainDoc())
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    const raw = readChainText(workspace(), SITE, FLOW)
    expect(raw?.text).toBe(readFileSync(saved.path, 'utf8'))
    expect(raw?.version).toBe(1)
    expect(readChainText(workspace(), SITE, FLOW, 9)).toBeUndefined()
  })

  it('读回后未知字段不丢（IF-3 的兼容承诺）', () => {
    const doc = chainDoc() as ChainDoc & { futureField?: unknown }
    doc.futureField = { note: '留给 v2' }
    expect(save(doc).ok).toBe(true)
    const loaded = loadChain(workspace(), SITE, FLOW, { resolveCard: allCards })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect((loaded.doc as unknown as Record<string, unknown>).futureField).toEqual({ note: '留给 v2' })
  })
})

describe('写入前校验', () => {
  it('链 YAML 文本也能落盘', () => {
    const text = `apiVersion: dataforge/v1
kind: interface-chain
meta:
  site: ${SITE}
  flow: ${FLOW}
  version: 1
  created: 2026-10-17T12:00:00Z
nodes:
  - id: query-material
    card: card_000123
edges: []
`
    const result = saveChain(workspace(), text, { resolveCard: allCards })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.version).toBe(1)
  })

  it('校验不过一律不落盘（不存在"部分写入"）', () => {
    const result = saveChain(
      workspace(),
      chainDoc({ nodes: [node({ id: 'query-material', card: 'card_999999' })], edges: [] }),
      { resolveCard: allCards },
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues[0].code).toBe('card-not-imported')
    expect(existsSync(chainDir(workspace(), SITE, FLOW))).toBe(false)
  })
})

describe('路径与目录名', () => {
  it('site/flow 变成可当目录名的 slug，保留中文', () => {
    expect(slugOf('智慧供应链 SCM')).toBe('智慧供应链-scm')
    expect(slugOf('  a / b  ')).toBe('a-b')
    expect(slugOf('...')).toBe('')
  })

  it('不能当目录名的 site 直接拒绝（防路径穿越）', () => {
    expect(() => chainDir(workspace(), '../..', FLOW)).toThrowError(/不能作为目录名/)
    try {
      chainDir(workspace(), '', FLOW)
    } catch (error) {
      expect((error as Error & { code?: string }).code).toBe('invalid-chain')
    }
  })

  it('listChains 列出两层目录里的链', () => {
    save(chainDoc())
    save(chainDoc())
    const chains = listChains(workspace())
    expect(chains).toHaveLength(1)
    expect(chains[0]).toMatchObject({ site: '智慧供应链-scm', flow: '采购下单', versions: [1, 2], latest: 2 })
  })

  it('没有链目录时 listChains 是空数组', () => {
    expect(listChains(workspace())).toEqual([])
  })
})

describe('卡解析器（默认读接口库）', () => {
  it('按 cardId 直读 library/cards，未知卡返回 undefined', () => {
    writeCard(searchCard)
    writeCard(createOrderCard)
    const resolver = defaultCardResolver(workspace())
    expect(resolver('card_000123')?.cardId).toBe('card_000123')
    expect(resolver('card_000123')?.outputs).toHaveLength(2)
    expect(resolver('card_000000')).toBeUndefined()
    expect(readCard(workspace(), 'card_000457')?.identity.method).toBe('POST')
  })

  it('卡文件坏掉就当卡不存在（不炸整条链的校验）', () => {
    const dirPath = cardsRoot(workspace())
    mkdirSync(dirPath, { recursive: true })
    writeFileSync(join(dirPath, 'card_000123.yaml'), 'not-a-card: true', 'utf8')
    expect(readCard(workspace(), 'card_000123')).toBeUndefined()
  })

  it('不认带路径分隔符的 cardId', () => {
    expect(readCard(workspace(), '../etc/passwd')).toBeUndefined()
  })

  it('saveChain 不注入解析器时用接口库读盘（端到端）', () => {
    writeCard(searchCard)
    writeCard(createOrderCard)
    const result = saveChain(workspace(), chainDoc())
    expect(result.ok).toBe(true)
    const loaded = loadChain(workspace(), SITE, FLOW)
    expect(loaded.ok).toBe(true)
  })
})
