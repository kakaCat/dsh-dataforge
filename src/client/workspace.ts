/**
 * 面板工作区选择：当前会话所属工作区优先；找不到就**不猜**，交给服务端兜底。
 *
 * 背景：useWorkspaces 的 items 是全局列表，顺序/更新时间会被其他项目影响。
 * 旧实现按 updatedAt 取「最近更新的工作区」兜底——那会把刚有活动的别的项目
 * （比如用户顺手打开过的其他仓库）当成本会话工作区，面板于是全空。
 * 服务端兜底（latestDataforgeWorkspacePath）只在**有 .dsh/dataforge 数据**的
 * 工作区里挑最近更新的，口径比"谁最新"准得多。
 *
 * 所以：会话归属找得到 → 用它（用户在 GUI 里的显式选择，绝不覆盖）；
 * 找不到 → 返回 undefined → 请求不带 ?workspace= → 服务端按 dataforge 数据兜底。
 *
 * @module dsh-dataforge/client/workspace
 */
export type WorkspaceItemLike = {
  readonly workspaceId?: string
  readonly path?: string
  readonly updatedAt?: string
  readonly sessionIds?: ReadonlyArray<string>
}

/** 返回当前会话所属工作区路径；会话不在任何工作区时返回 undefined（让服务端兜底）。 */
export function pickWorkspacePath(
  items: ReadonlyArray<WorkspaceItemLike> | undefined,
  sessionId: string | undefined,
): string | undefined {
  const list = items ?? []
  if (sessionId !== undefined && sessionId.length > 0) {
    const current = list.find((item) => Array.isArray(item.sessionIds) && item.sessionIds.includes(sessionId))
    if (current?.path !== undefined && current.path.length > 0) return current.path
  }
  return undefined
}
