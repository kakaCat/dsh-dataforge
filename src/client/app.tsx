/**
 * 面板总组件（main 插槽占用者，原型三页共享的顶栏 + 标签页容器）。
 *
 * DSH 运行时直接渲染本组件并注入 usePanelInfo（GlobalStandardProps 投影），所以整个视图树
 * 都是声明式 React。页签集合与原型一致：快速采集 / 接口库 / 采集网站 / 编排
 * （「采集运行」页已按产品决定移除：运行进度在快速采集页内联展示，历史聚合在采集网站页）。
 * 跨页动线：站点页「重采」→ RecaptureSeed 预填快速采集；站点页「接口 →」→ libSeed 落入
 * 接口库该站点视图。可见性门闩（usePanelInfo）在此投影一次，向下传 visible 布尔。
 *
 * @module dsh-dataforge/client/app
 */
import { useEffect, useState, type ReactNode } from 'react'
import { CardsLibraryPage } from './board-cards.js'
import { QuickCapturePage } from './page-capture.js'
import { OrchestrationPage } from './page-orchestration.js'
import {
  CAPTURE_TAB_ID, CAPTURE_TAB_LABEL,
  CARDS_TAB_ID, CARDS_TAB_LABEL,
  ORCH_TAB_ID, ORCH_TAB_LABEL,
  PANEL_ID,
  SITES_TAB_ID, SITES_TAB_LABEL,
} from './dom.js'
import { PanelHostProps, UsePanelInfo, UseWorkspaces, WorkspaceSnapshotLike } from './host.js'
import { injectStyles } from './styles.js'
import { SitesBoardPage } from './sites-board.js'
import { setPanelWorkspace } from './api.js'
import type { RecaptureSeed } from './types.js'

export interface DataforgePanelAppProps extends PanelHostProps {}

interface TabEntry {
  id: string
  label: string
}

const TABS: readonly TabEntry[] = [
  { id: CAPTURE_TAB_ID, label: CAPTURE_TAB_LABEL },
  { id: CARDS_TAB_ID, label: CARDS_TAB_LABEL },
  { id: SITES_TAB_ID, label: SITES_TAB_LABEL },
  { id: ORCH_TAB_ID, label: ORCH_TAB_LABEL },
]

/** 兜底 hook：槽位未注入 useWorkspaces 时返回空工作区（不写 ?workspace=，交服务端回落）。 */
const NO_WORKSPACE: UseWorkspaces = <S,>(selector: (snapshot: WorkspaceSnapshotLike) => S): S =>
  selector({ items: [] })

/** 兜底 hook：槽位未注入 usePanelInfo 时恒判「本面板在看」（host.ts 同款）。 */
const ALWAYS_ACTIVE: UsePanelInfo = <S,>(selector: (info: { activePanelId: string | null }) => S): S =>
  selector({ activePanelId: PANEL_ID })

/** 站点页「接口 →」的种子：host 落入接口库视图 B；nonce 让重复点同站也能再次触发。 */
type LibSeed = { host: string; nonce: number }

export function DataforgePanelApp(props: DataforgePanelAppProps): ReactNode {
  // 面板属于某个工作区：把当前工作区根交给 api 层（所有请求带 ?workspace=）。
  // 渲染期写入而不是 effect 里写：子组件的取数 effect 在同一轮之后才跑，晚一步就先打了
  // 一次「以宿主 cwd 为工作区」的空请求（面板会闪一下空态）。
  //
  // 取「最近更新」的工作区而不是 items[0]：registry 顺序是创建序，items[0] 可能是一个
  // 很久没用的工作区——面板会显示空数据（用户看到的就是「编排白板」）。当前会话所在
  // 的工作区通常就是最近有写入的那个；服务端也有同一套兜底（src/index.ts latestWorkspacePath）。
  const useWorkspaces: UseWorkspaces = typeof props.useWorkspaces === 'function' ? props.useWorkspaces : NO_WORKSPACE
  const workspacePath = useWorkspaces((snapshot) => {
    const items = snapshot.items ?? []
    const latest = [...items].sort(
      (left, right) => String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')),
    )[0]
    return latest?.path
  })
  setPanelWorkspace(typeof workspacePath === 'string' ? workspacePath : undefined)
  const usePanelInfo: UsePanelInfo = typeof props.usePanelInfo === 'function' ? props.usePanelInfo : ALWAYS_ACTIVE
  const activePanelId = usePanelInfo((info) => info.activePanelId)
  const visible = activePanelId === PANEL_ID
  const [activeTab, setActiveTab] = useState<string>(CAPTURE_TAB_ID)
  const [seed, setSeed] = useState<RecaptureSeed | undefined>()
  const [libSeed, setLibSeed] = useState<LibSeed | undefined>()

  useEffect(() => {
    injectStyles()
  }, [])

  const recapture = (url: string): void => {
    setSeed({ url, nonce: Date.now() })
    setActiveTab(CAPTURE_TAB_ID)
  }

  const openInLibrary = (host: string): void => {
    setLibSeed({ host, nonce: Date.now() })
    setActiveTab(CARDS_TAB_ID)
  }

  return (
    <div className="dsh-df-view" data-dsh-df-view="">
      <header className="dsh-df-topbar">
        <span className="dsh-df-brand">
          {'Data'}
          <em>Forge</em>
          {' · 数据采集'}
        </span>
        <nav className="dsh-df-tabs" role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className="dsh-df-tab"
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              data-dsh-df-tab={tab.id}
              onClick={() => { setActiveTab(tab.id) }}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>
      {activeTab === CAPTURE_TAB_ID && <QuickCapturePage visible={visible} seed={seed} />}
      {activeTab === CARDS_TAB_ID && (
        <CardsLibraryPage visible={visible} openSite={libSeed?.host} openNonce={libSeed?.nonce} />
      )}
      {activeTab === SITES_TAB_ID && (
        <SitesBoardPage visible={visible} onRecapture={recapture} onOpenInLibrary={openInLibrary} />
      )}
      {activeTab === ORCH_TAB_ID && <OrchestrationPage visible={visible} />}
    </div>
  )
}
