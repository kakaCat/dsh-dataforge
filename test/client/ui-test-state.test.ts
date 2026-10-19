/**
 * UI 测试页跨挂载状态：持久化往返与会话对齐。
 *
 * 无 window 环境下回落到模块内存（渲染冒烟/单测都不崩）。
 *
 * @module dsh-dataforge/test/client/ui-test-state
 */
import { describe, expect, it } from 'vitest'
import { loadUiTestState, reconcileSession, saveUiTestState } from '../../src/client/ui-test-state.js'

describe('ui-test-state', () => {
  it('save → load 合并写：表单/选中脚本/会话 id 都能恢复', () => {
    saveUiTestState({
      recordForm: { startUrl: 'https://example.com/', site: '示例站', flow: '搜索', domain: '', note: '' },
      selected: { site: '示例站', flow: '搜索' },
      selectedVersion: 2,
      sessionId: 'browser:1',
      recording: true,
    })
    const state = loadUiTestState()
    expect(state.recordForm?.startUrl).toBe('https://example.com/')
    expect(state.selected).toEqual({ site: '示例站', flow: '搜索' })
    expect(state.selectedVersion).toBe(2)
    expect(state.sessionId).toBe('browser:1')
    expect(state.recording).toBe(true)
    // 合并写不丢旧键
    saveUiTestState({ notice: 'hi' })
    expect(loadUiTestState().sessionId).toBe('browser:1')
    expect(loadUiTestState().notice).toBe('hi')
  })

  it('reconcileSession：会话还在就对齐录制状态；会话没了就清掉旧 id', () => {
    const alive = reconcileSession({ sessionId: 'browser:1', recording: false }, [
      { sessionId: 'browser:1', pageUrl: 'https://example.com/', recording: true, startedAt: 1 },
    ])
    expect(alive).toEqual({ sessionId: 'browser:1', recording: true, changed: true })

    const gone = reconcileSession({ sessionId: 'browser:1', recording: true }, [])
    expect(gone).toEqual({ recording: false, changed: true })

    const none = reconcileSession({}, [])
    expect(none).toEqual({ recording: false, changed: false })
  })
})
