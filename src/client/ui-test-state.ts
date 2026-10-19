/**
 * UI 测试页的跨挂载状态（切走「UI 测试」页签 / 切到对话再回来时恢复）。
 *
 * 为什么需要：DSH 主面板是「按需挂载」的——离开面板时整个 React 树卸载，
 * 页面里的 useState 全部丢失（服务端的浏览器会话还在，但表单、选中的脚本、
 * 录制会话 id 看起来"没了"）。所以把这些**用户会以为还开着**的状态持久化：
 *   - 录制表单（起点 URL / 站点 / 流程 / 业务域 / 说明）
 *   - 当前选中的脚本（site/flow/version）与回放入参
 *   - 浏览器会话 id + 是否在录制 + 提示文案
 *
 * 存储用 sessionStorage（同一标签页生命周期；关掉标签页就清空），并对 SSR/无 window
 * 场景回落到模块内存——渲染冒烟测试不会因此崩。
 *
 * @module dsh-dataforge/client/ui-test-state
 */
import type { UiRecordingSessionView } from './types.js'

export type UiTestRecordForm = {
  startUrl: string
  site: string
  flow: string
  domain: string
  note: string
}

export type UiTestPersistedState = {
  recordForm?: UiTestRecordForm
  selected?: { site: string; flow: string }
  selectedVersion?: number
  sessionId?: string
  recording?: boolean
  notice?: string
  /** 回放入参值（同一脚本下次回放不必重填）。 */
  inputValues?: Record<string, string>
  /** 回放慢放：每步之间的延迟（毫秒）。 */
  slowMoMs?: number
  /** Playwright 引擎是否显示浏览器窗口。 */
  showBrowser?: boolean
  /** 回放时点击落点画脉冲光圈（缺省 true）。 */
  highlightClicks?: boolean
  /** 回放结束后停留多久再关浏览器（毫秒）。 */
  holdMs?: number
}

const STORAGE_KEY = 'dsh-dataforge:ui-test:v1'

/** 内存副本：无 window / 写失败时仍能在本次页面生命周期内恢复。 */
let memory: UiTestPersistedState | undefined

function hasWindow(): boolean {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined'
}

function readStorage(): UiTestPersistedState | undefined {
  if (memory !== undefined) return memory
  if (!hasWindow()) return undefined
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (raw === null || raw === '') return undefined
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    memory = parsed as UiTestPersistedState
    return memory
  } catch {
    return undefined
  }
}

/** 读当前持久化状态（页面的 useState 初值从这里来）。 */
export function loadUiTestState(): UiTestPersistedState {
  return readStorage() ?? {}
}

/** 合并写（值不变也写；调用方按 state 变化触发）。 */
export function saveUiTestState(patch: Partial<UiTestPersistedState>): void {
  const next: UiTestPersistedState = { ...(readStorage() ?? {}), ...patch }
  memory = next
  if (!hasWindow()) return
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // 隐私模式/配额满：内存副本仍然有效，不影响本次会话
  }
}

/**
 * 用服务端会话列表对齐本地状态：会话还在就沿用，录制状态以服务端为准；
 * 会话不存在了（浏览器被关/进程重启）就清掉本地 sessionId，避免"点开始录制报会话不存在"。
 */
export function reconcileSession(
  state: UiTestPersistedState,
  sessions: readonly UiRecordingSessionView[],
): { sessionId?: string; recording: boolean; changed: boolean } {
  if (state.sessionId === undefined) {
    const first = sessions[0]
    if (first === undefined) return { recording: false, changed: false }
    return { sessionId: first.sessionId, recording: first.recording, changed: true }
  }
  const mine = sessions.find((session) => session.sessionId === state.sessionId)
  if (mine !== undefined) {
    return { sessionId: mine.sessionId, recording: mine.recording, changed: mine.recording !== (state.recording ?? false) }
  }
  if (sessions.length === 0) {
    // 服务端列表为空：可能是宿主刚重启/会话已被关闭——清掉旧 id。
    return { recording: false, changed: true }
  }
  // 有其它会话但没有我们那只：同样清零（旧 session 已失效）。
  return { sessionId: sessions[0]?.sessionId, recording: sessions[0]?.recording ?? false, changed: true }
}
