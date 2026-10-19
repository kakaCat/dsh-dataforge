import { describe, expect, it } from 'vitest'
import { pickWorkspacePath } from '../../src/client/workspace.js'

describe('pickWorkspacePath', () => {
  it('当前会话所属工作区优先于全局最近更新', () => {
    const items = [
      { path: '/work/other', updatedAt: '2026-10-18T13:00:00Z', sessionIds: ['s-other'] },
      { path: '/work/dataforge', updatedAt: '2026-10-18T11:00:00Z', sessionIds: ['s-dataforge'] },
    ]
    expect(pickWorkspacePath(items, 's-dataforge')).toBe('/work/dataforge')
  })

  it('会话找不到时回退最近更新；空列表返回 undefined', () => {
    const items = [
      { path: '/work/old', updatedAt: '2026-10-17T00:00:00Z', sessionIds: [] },
      { path: '/work/new', updatedAt: '2026-10-18T00:00:00Z', sessionIds: [] },
    ]
    expect(pickWorkspacePath(items, 's-missing')).toBe('/work/new')
    expect(pickWorkspacePath(undefined, 's')).toBeUndefined()
  })
})
