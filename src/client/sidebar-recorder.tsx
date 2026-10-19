/**
 * 右侧栏「录制控制」tab：把开始/停止/关闭放进浏览器旁边，避免"浏览器在右侧、按钮在面板里"的两头跑。
 *
 * 为什么用 sidebar-right 的自定义 tab（而不是改内置浏览器）：
 *   - 内置浏览器是第三方面板，我们不改它；
 *   - `ctx.sidebarRightTabs.register` + `sidebar.right.pane.tab` 是公开扩展位（官方文档写明）；
 *   - tab 正文只是普通 React，直接调 dataforge 的录制 API（开始/停止/关闭 + 会话轮询）。
 *
 * 数据来源：
 *   - 打开浏览器时，面板把 `{sessionId,pageUrl,site,flow}` 写进模块级 store 并打开本 tab；
 *   - tab 轮询 `/ui-tests/record/sessions` 对齐录制状态；
 *   - 停止保存时站点/流程留空也可以（服务端自动命名）。
 *
 * @module dsh-dataforge/client/sidebar-recorder
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import {
  closeUiRecording, fetchUiSessions, startUiRecording, stopUiRecording,
} from './api.js'
import type { UiRecordingSessionView } from './types.js'

const TAB_ID = '@dataforge/ui-recorder'
const TAB_KIND = 'dataforge-recorder'

/** 打开 tab 时的目标（模块级：tab 正文与打开方同一 client bundle，无需依赖 tab params 类型）。 */
export type RecorderTabTarget = {
  sessionId: string
  pageUrl?: string
  site?: string
  flow?: string
}

let target: RecorderTabTarget | undefined

/** 打开/聚焦「录制控制」tab；宿主没有 sidebar-right 服务时返回 false。 */
export type OpenRecorderTab = (next: RecorderTabTarget) => boolean

let openImpl: OpenRecorderTab = () => false

/** 页面打开浏览器后调用：记录目标并调 sidebarRight.openTab。 */
export function openRecorderTab(next: RecorderTabTarget): boolean {
  target = next
  return openImpl(next)
}

/** client 入口安装（register 类型 + 正文 + 打开函数）。 */
export function installRecorderTab(ctx: {
  slots?: {
    inject?: (slot: string, thunk: () => unknown) => unknown
    register?: (spec: Record<string, unknown>, occupant: unknown) => unknown
  }
  get?: (name: string) => unknown
}): void {
  const tabs = ctx.get?.('sidebarRightTabs') as { register?: (definition: Record<string, unknown>) => unknown } | undefined
  if (tabs === undefined || typeof tabs.register !== 'function') {
    openImpl = () => false
    return
  }
  try {
    tabs.register({
      id: TAB_ID,
      kind: TAB_KIND,
      priority: 'extension',
      title: () => '录制控制',
      guide: [{
        order: 45,
        title: () => '录制控制',
        description: () => '开始/停止 UI 测试录制（与浏览器标签联动）',
      }],
    })
  } catch {
    openImpl = () => false
    return
  }
  ctx.slots?.inject?.('sidebar.right.pane.tab', () => ctx.slots?.register?.({
    name: 'sidebar.right.pane.tab',
    key: TAB_ID,
  }, RecorderControlsTab))

  openImpl = (next) => {
    const service = ctx.get?.('sidebarRight') as {
      openTab?: (kind: string, options?: Record<string, unknown>) => unknown
      split?: (paneId?: string) => string | undefined
    } | undefined
    if (service === undefined || typeof service.openTab !== 'function') return false
    try {
      target = next
      // 尽量和浏览器面板**并排**：sidebar-right 支持最多两格；分栏失败就退回合并在当前格（多一个 tab）。
      let paneId: string | undefined
      try { paneId = typeof service.split === 'function' ? service.split() : undefined } catch { paneId = undefined }
      service.openTab(TAB_KIND, {
        ...(paneId === undefined ? {} : { paneId }),
        revealIfOpened: true,
      })
      return true
    } catch {
      return false
    }
  }
}

function messageOf(error: unknown): string {
  return String((error as Error)?.message ?? error).slice(0, 500)
}

/** tab 正文：录制状态 + 开始/停止/关闭。 */
export function RecorderControlsTab(): ReactNode {
  const [session, setSession] = useState<UiRecordingSessionView | undefined>(() => {
    if (target === undefined) return undefined
    return { sessionId: target.sessionId, pageUrl: target.pageUrl ?? '', recording: false, startedAt: Date.now() }
  })
  const [busy, setBusy] = useState<'start' | 'stop' | 'close' | undefined>(undefined)
  const [error, setError] = useState<string | undefined>()
  const [saved, setSaved] = useState<{ site: string; flow: string; version: number } | undefined>()

  useEffect(() => {
    let cancelled = false
    const sync = async (): Promise<void> => {
      try {
        const { sessions } = await fetchUiSessions()
        if (cancelled) return
        const wanted = target?.sessionId
        const mine = wanted === undefined ? undefined : sessions.find((item) => item.sessionId === wanted)
        if (mine !== undefined) setSession(mine)
      } catch {
        // 服务短暂不可达：保留现状，下次轮询再对齐
      }
    }
    void sync()
    const timer = setInterval(() => { void sync() }, 1_500)
    return () => { cancelled = true; clearInterval(timer) }
  }, [])

  async function start(): Promise<void> {
    if (session === undefined) return
    setBusy('start')
    setError(undefined)
    try {
      const result = await startUiRecording(session.sessionId)
      if (!result.ok) setError(result.error ?? '开始录制失败')
      else setSession((previous) => previous === undefined ? previous : { ...previous, recording: true })
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(undefined)
    }
  }

  async function stop(): Promise<void> {
    if (session === undefined) return
    setBusy('stop')
    setError(undefined)
    try {
      // 站点/流程留空也可以：服务端会按当前页面自动命名。
      const result = await stopUiRecording({ sessionId: session.sessionId, save: true })
      if (!result.ok) {
        setError(result.error ?? '停止录制失败')
        return
      }
      setSession((previous) => previous === undefined ? previous : { ...previous, recording: false })
      if (result.saved !== undefined) {
        setSaved(result.saved)
        try {
          window.dispatchEvent(new CustomEvent('dataforge:uitest-reload', { detail: result.saved }))
        } catch { /* 非浏览器环境忽略 */ }
      } else {
        setError(result.notice ?? '没有可保存的步骤')
      }
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(undefined)
    }
  }

  async function close(): Promise<void> {
    if (session === undefined) return
    setBusy('close')
    setError(undefined)
    try {
      await closeUiRecording(session.sessionId)
      setSession(undefined)
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(undefined)
    }
  }

  const style = {
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
    fontSize: 12,
    color: 'var(--foreground)',
    background: 'var(--background)',
    height: '100%',
    boxSizing: 'border-box' as const,
  }
  const button = (disabled: boolean): CSSProperties => ({
    padding: '7px 12px',
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: 'var(--card)',
    color: 'var(--foreground)',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    fontSize: 12,
  })

  if (session === undefined) {
    return (
      <div style={style}>
        <strong>UI 测试 · 录制控制</strong>
        <div style={{ color: 'var(--muted-foreground)' }}>还没有浏览器会话。请到「数据采集 → UI 测试」点「打开浏览器」。</div>
      </div>
    )
  }

  return (
    <div style={style}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <strong>UI 测试 · 录制控制</strong>
        <span style={{
          padding: '1px 8px', borderRadius: 999, fontSize: 11,
          background: session.recording ? 'var(--success-soft, #e8f7ee)' : 'var(--muted)',
          color: session.recording ? 'var(--success, #1f9d55)' : 'var(--muted-foreground)',
        }}>{session.recording ? '录制中' : '未录制'}</span>
      </div>
      <div style={{ color: 'var(--muted-foreground)', wordBreak: 'break-all' }}>{session.pageUrl || target?.pageUrl}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" style={button(busy !== undefined || session.recording)} disabled={busy !== undefined || session.recording} onClick={() => { void start() }}>
          {busy === 'start' ? '开始中…' : '开始录制'}
        </button>
        <button type="button" style={button(busy !== undefined || !session.recording)} disabled={busy !== undefined || !session.recording} onClick={() => { void stop() }}>
          {busy === 'stop' ? '停止中…' : '停止并保存'}
        </button>
        <button type="button" style={button(busy !== undefined)} disabled={busy !== undefined} onClick={() => { void close() }}>
          {busy === 'close' ? '关闭中…' : '关闭浏览器'}
        </button>
      </div>
      <div style={{ color: 'var(--muted-foreground)' }}>
        站点/流程名留空也可以保存（自动命名）。保存后到「数据采集 → UI 测试」选中脚本回放。
      </div>
      {saved !== undefined ? (
        <div style={{ color: 'var(--success, #1f9d55)' }}>
          已保存：{saved.site} / {saved.flow} v{saved.version}
        </div>
      ) : null}
      {error !== undefined ? <div style={{ color: 'var(--destructive, #dc2626)' }}>{error}</div> : null}
    </div>
  )
}
