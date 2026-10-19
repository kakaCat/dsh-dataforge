/**
 * 面板工作区选择：当前会话所属工作区优先，找不到才回退最近更新。
 *
 * 背景：useWorkspaces 的 items 是全局列表，顺序/更新时间会被其他项目影响；
 * 直接取 updatedAt 最新会把别的项目当成本会话工作区，面板因此显示空数据。
 *
 * @module dsh-dataforge/client/workspace
 */
export type WorkspaceItemLike = {
  readonly workspaceId?: string
  readonly path?: string
  readonly updatedAt?: string
  readonly sessionIds?: ReadonlyArray<string>
}

/** 返回当前会话所属工作区路径；会话不在任何工作区时退回最近更新。 */
export function pickWorkspacePath(
  items: ReadonlyArray<WorkspaceItemLike> | undefined,
  sessionId: string | undefined,
): string | undefined {
  const list = items ?? []
  if (sessionId !== undefined && sessionId.length > 0) {
    const current = list.find((item) => Array.isArray(item.sessionIds) && item.sessionIds.includes(sessionId))
    if (current?.path !== undefined && current.path.length > 0) return current.path
  }
  const latest = [...list].sort(
    (left, right) => String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')),
  )[0]
  return latest?.path
}
