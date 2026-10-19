/**
 * 旧页面标题补抓（TitleBackfillService）：重访历史页面并回填 pages.title / pages.site_name。
 *
 * 为什么需要它：名称数据面上线前采的页面只有 URL，没有 `document.title` / `og:site_name`。
 * 面板的「补抓名称」动作重访这些页面，按存下来的 cookie 恢复登录态后读标题并回写；
 * 只是展示增强，不改变任何事实（样本/卡/关系一律不动）。
 *
 * 安全边界（最重要的一条）：**身份校验**。补抓用的 cookie 可能已过期，页面会被重定向到
 * 登录页/首页 —— 若最终 URL 的 `pageIdentityOf` 不等于目标页面身份，只记 failed，
 * 绝不把登录页的标题写到目标页上。
 *
 * 计数口径（status）：
 *   - targets：本轮计划补抓的目标页数（身份去重后）；
 *   - tried：实际发起重访的目标数；
 *   - updated：成功回写且落库成功的目标数；
 *   - failed：身份不符 / 读不到标题 / 导航异常 / 找不到可归属的 capture；
 *   - skipped：因前序致命错误中断而**没有尝试**的剩余目标（targets - tried）。
 *
 * 单飞：进程内同一时刻只允许一轮补抓（防两个无头浏览器互相抢登录态）。
 *
 * 采集闸按 **host** 而非全局：正在采集的 host 上的目标本轮跳过（不和同站采集抢浏览器/登录态），
 * 其余 host 照常补抓；只有全部目标都被挡下时才回 capture-running。
 * （全局拒绝会让一条遗留 running 行永久堵死名称补抓，而它可能只是历史僵尸 run。）
 *
 * @module dsh-dataforge/capture/retitle
 */
import type { Cookie } from 'playwright-core'
import { pageIdentityOf } from '../shared/page-url.js'
import type { CaptureStore } from './store.js'
import { openCapturingPage, readPageMeta, type CapturingPage } from './browser.js'

/** 单轮补抓目标上限（旧页面很多时只补最需要的，不无限开浏览器）。 */
export const RETITLE_MAX_TARGETS = 60

const RUN_SCAN_LIMIT = 500
const PAGE_META_SCAN_LIMIT = 1_000
const CARD_SCAN_LIMIT = 2_000
const COOKIE_LIMIT = 1_000
const NAV_TIMEOUT_MS = 15_000
const NETWORK_IDLE_TIMEOUT_MS = 3_000

export type RetitleStartResult = {
  accepted: boolean
  targets: number
  hosts: number
  reason?: 'busy' | 'no-targets' | 'capture-running'
}

export type RetitleStatus = {
  running: boolean
  targets: number
  tried: number
  updated: number
  failed: number
  skipped: number
  startedAt?: number
  finishedAt?: number
  error?: string
}

export type TitleBackfillDeps = {
  store: CaptureStore
  /** 浏览器工厂（测试注入假实现；生产传 openCapturingPage）。 */
  openPage: typeof openCapturingPage
  /** Chrome 通道。 */
  channel: string
}

type BackfillTarget = {
  /** 页面身份（pageIdentityOf）。 */
  identity: string
  /** 实际打开的原始地址（入口页/卡上的页面引用，可打开性优先）。 */
  url: string
  host: string
}

export class TitleBackfillService {
  private data: RetitleStatus = emptyStatus()
  private readonly deps: TitleBackfillDeps

  constructor(deps: TitleBackfillDeps) {
    this.deps = deps
  }

  status(): RetitleStatus {
    return { ...this.data }
  }

  /**
   * 启动一轮补抓（异步：立即返回受理结果，浏览器在后台跑）。
   *
   * 闸顺序：已有补抓在跑 → busy；目标里没有可跑的（全被 host 级采集闸挡下/本来就没有）时，
   * 有 running 采集 → capture-running，否则 → no-targets。
   * host 级采集闸：正在采集的 host 本轮跳过（避免同站抢浏览器/登录态），其余 host 照常跑。
   */
  start(): RetitleStartResult {
    if (this.data.running) return { accepted: false, targets: 0, hosts: 0, reason: 'busy' }
    const runningHosts = new Set(
      this.deps.store
        .listRuns(RUN_SCAN_LIMIT)
        .filter((run) => run.status === 'running')
        .map((run) => hostOf(run.entryUrl))
        .filter((host) => host !== ''),
    )
    const plan = this.plan(runningHosts)
    if (plan.targets.length === 0) {
      return {
        accepted: false,
        targets: 0,
        hosts: 0,
        reason: runningHosts.size > 0 ? 'capture-running' : 'no-targets',
      }
    }
    this.data = {
      running: true,
      targets: plan.targets.length,
      tried: 0,
      updated: 0,
      failed: 0,
      skipped: 0,
      startedAt: Date.now(),
    }
    // 后台跑：start 只负责受理（POST /retitle 走 200 信封回报 accepted/reason）
    void this.run(plan.targets).catch(() => undefined)
    return { accepted: true, targets: plan.targets.length, hosts: plan.hosts }
  }

  /** 计划补抓目标：入口页 → 卡上页面引用 → pages 表，按身份去重；只取缺标题/缺站点名的入口页。 */
  private plan(runningHosts: ReadonlySet<string>): { targets: BackfillTarget[]; hosts: number } {
    const runs = this.deps.store.listRuns(RUN_SCAN_LIMIT)
    const metaRows = this.deps.store.listPageMeta(PAGE_META_SCAN_LIMIT)
    const titleByIdentity = new Map<string, boolean>()
    const siteNameHosts = new Set<string>()
    for (const row of metaRows) {
      const host = hostOf(row.url)
      titleByIdentity.set(row.url, row.title !== undefined && row.title !== '')
      if (host !== '' && row.siteName !== undefined && row.siteName !== '') siteNameHosts.add(host)
    }

    const candidates: Array<{ raw: string; isEntry: boolean }> = []
    for (const run of runs) candidates.push({ raw: run.entryUrl, isEntry: true })
    for (const card of this.deps.store.listAllCards(CARD_SCAN_LIMIT, 0)) {
      for (const pageUrl of card.relatedPageUrls) candidates.push({ raw: pageUrl, isEntry: false })
    }
    for (const row of metaRows) candidates.push({ raw: row.url, isEntry: false })

    const seen = new Set<string>()
    const hosts = new Set<string>()
    const targets: BackfillTarget[] = []
    for (const candidate of candidates) {
      if (targets.length >= RETITLE_MAX_TARGETS) break
      const raw = candidate.raw.trim()
      if (!/^https?:/i.test(raw)) continue
      const identity = pageIdentityOf(raw)
      if (identity === '' || seen.has(identity)) continue
      const host = hostOf(identity)
      if (host === '') continue
      // host 级采集闸：同 host 正在采集 → 本轮跳过（换站补抓不受影响）。
      if (runningHosts.has(host)) continue
      seen.add(identity)
      // 缺页面标题的必修；缺站点名（host 无任何 siteName）的入口页必修；其余跳过。
      const hasTitle = titleByIdentity.get(identity) === true
      const needsSiteName = candidate.isEntry && !siteNameHosts.has(host)
      if (hasTitle && !needsSiteName) continue
      targets.push({ identity, url: raw, host })
      hosts.add(host)
    }
    return { targets, hosts: hosts.size }
  }

  /** 后台执行体：一次浏览器、逐目标导航；无论成败 finally 关浏览器并收口状态。 */
  private async run(targets: BackfillTarget[]): Promise<void> {
    let handle: CapturingPage | undefined
    let currentHost = ''
    try {
      const cookies = this.loadCookies()
      handle = await this.deps.openPage(this.deps.channel, () => undefined, { headless: true })
      for (const target of targets) {
        if (target.host !== currentHost) {
          currentHost = target.host
          // 换 host 先清掉上一个站点的 cookie，避免把 A 站登录态带到 B 站
          if (typeof handle.context.clearCookies === 'function') {
            await handle.context.clearCookies().catch(() => undefined)
          }
          const matched = cookies.filter((cookie) => cookieMatchesHost(cookie.domain, target.host))
          if (matched.length > 0 && typeof handle.context.addCookies === 'function') {
            await handle.context.addCookies(matched).catch(() => undefined)
          }
        }
        this.data.tried += 1
        await this.backfillOne(handle, target)
      }
    } catch (err) {
      this.data.error = errText(err)
    } finally {
      await handle?.browser.close().catch(() => undefined)
      this.data.skipped = Math.max(0, this.data.targets - this.data.tried)
      this.data.running = false
      this.data.finishedAt = Date.now()
    }
  }

  /** 单目标：导航 → 读 meta → 身份校验 → 回写（所有异常落 failed，不打断整轮）。 */
  private async backfillOne(handle: CapturingPage, target: BackfillTarget): Promise<void> {
    try {
      await handle.page
        .goto(target.url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })
        .catch(() => undefined)
      await handle.page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => undefined)
      const meta = await readPageMeta(handle.page)
      // 身份校验（红线）：登录页/重定向后的页面 != 目标页 → 记 failed，绝不写跨页标题
      if (meta.url === '' || pageIdentityOf(meta.url) !== target.identity) {
        this.data.failed += 1
        return
      }
      if (meta.title === undefined && meta.siteName === undefined) {
        this.data.failed += 1
        return
      }
      let updatedRows = this.deps.store.applyPageMeta(meta.url, meta.title, meta.siteName)
      if (updatedRows === 0) {
        // 目标只在卡上被引用、pages 表没有行：用该 host 最近 run 归属补一行
        const captureId = this.latestCaptureIdOfHost(target.host)
        if (captureId !== undefined) {
          this.deps.store.upsertPage(captureId, target.identity, 0, 'ok', {
            ...(meta.title === undefined ? {} : { title: meta.title }),
            ...(meta.siteName === undefined ? {} : { siteName: meta.siteName }),
          })
          updatedRows = 1
        }
      }
      if (updatedRows > 0) this.data.updated += 1
      else this.data.failed += 1
    } catch {
      this.data.failed += 1
    }
  }

  /** 从 credential_events 读已存 cookie（同 domain/path/name 以最近一次为准，过期丢弃）。 */
  private loadCookies(): Cookie[] {
    const nowSeconds = Date.now() / 1000
    const byKey = new Map<string, Cookie>()
    for (const json of this.deps.store.listCookieJson(COOKIE_LIMIT)) {
      let raw: unknown
      try {
        raw = JSON.parse(json)
      } catch {
        continue
      }
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
      const record = raw as Record<string, unknown>
      const name = typeof record['name'] === 'string' ? record['name'] : ''
      const value = typeof record['value'] === 'string' ? record['value'] : ''
      const domain = typeof record['domain'] === 'string' ? record['domain'] : ''
      if (name === '' || domain === '') continue
      const expires = typeof record['expires'] === 'number' && Number.isFinite(record['expires']) ? record['expires'] : -1
      if (expires > 0 && expires < nowSeconds) continue
      const path = typeof record['path'] === 'string' && record['path'] !== '' ? record['path'] : '/'
      const sameSiteRaw = typeof record['sameSite'] === 'string' ? record['sameSite'] : 'Lax'
      const sameSite = (sameSiteRaw === 'Strict' || sameSiteRaw === 'Lax' || sameSiteRaw === 'None' ? sameSiteRaw : 'Lax') as Cookie['sameSite']
      const cookie: Cookie = {
        name,
        value,
        domain,
        path,
        expires,
        httpOnly: record['httpOnly'] === true,
        secure: record['secure'] === true,
        sameSite,
      }
      byKey.set(`${domain}|${path}|${name}`, cookie)
    }
    return [...byKey.values()]
  }

  /** 该 host 最近一次采集的 captureId（目标不在 pages 表时补行用）；没有则 undefined。 */
  private latestCaptureIdOfHost(host: string): string | undefined {
    const hit = this.deps.store.listRuns(RUN_SCAN_LIMIT).find((run) => hostOf(run.entryUrl) === host)
    return hit?.id
  }
}

/** URL → host（解析失败返回空串，调用方按无 host 跳过）。 */
function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return ''
  }
}

/** cookie domain（可带前导点）是否覆盖 host：`example.com` 覆盖 `a.example.com`。 */
function cookieMatchesHost(cookieDomain: string, host: string): boolean {
  const domain = cookieDomain.trim().toLowerCase().replace(/^\./, '')
  const target = host.trim().toLowerCase()
  return domain !== '' && (target === domain || target.endsWith(`.${domain}`))
}

function errText(err: unknown): string {
  const message = (err as Error | undefined)?.message
  return (typeof message === 'string' && message.length > 0 ? message : String(err)).slice(0, 300)
}

function emptyStatus(): RetitleStatus {
  return { running: false, targets: 0, tried: 0, updated: 0, failed: 0, skipped: 0 }
}
