/**
 * 面板渲染冒烟：用 react-dom/server 把整棵树渲一次。
 *
 * 为什么值得有：client 半边只有「构建通过」这一道机器检查，而构建不执行组件代码——
 * import 期错误、hooks 误用、模块顶层碰 `document` 都要等浏览器里才炸（表现为页签白屏）。
 * 这里不测交互，只证明「页签的组件树能被真实 React 渲染出来」。
 *
 * 注意：画布不在覆盖范围——React Flow 需要浏览器 API，SSR 下不渲染它。
 *
 * @module dsh-dataforge/test/client/render-smoke
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DataforgePanelApp } from '../../src/client/app.js'
import { CardsLibraryPage } from '../../src/client/board-cards.js'
import { PagerBar } from '../../src/client/card-parts.js'
import { QuickCapturePage } from '../../src/client/page-capture.js'
import { OrchestrationPage } from '../../src/client/page-orchestration.js'
import { SitesBoardPage } from '../../src/client/sites-board.js'
import { UiTestPage } from '../../src/client/page-uitest.js'
import { UiStepEditor } from '../../src/client/ui-step-editor.js'
import { RecorderControlsTab } from '../../src/client/sidebar-recorder.js'
import { ORCH_TAB_LABEL, UITEST_TAB_LABEL } from '../../src/client/dom.js'
import type { UiScriptDetail } from '../../src/client/types.js'

describe('面板渲染冒烟', () => {
  it('整个面板能渲出顶栏与五个页签', () => {
    const html = renderToStaticMarkup(<DataforgePanelApp />)
    expect(html).toContain('数据采集')
    expect(html).toContain(ORCH_TAB_LABEL)
    expect(html).toContain(UITEST_TAB_LABEL)
  })

  it('UI 测试页在不可见时不渲染内容（也不发请求）', () => {
    const html = renderToStaticMarkup(<UiTestPage visible={false} />)
    expect(html).toBe('')
  })

  it('UI 测试页可见时先渲染录制表单与脚本列表骨架', () => {
    const html = renderToStaticMarkup(<UiTestPage visible />)
    expect(html).toContain('UI 测试')
    expect(html).toContain('起点 URL')
    expect(html).toContain('打开浏览器')
    expect(html).toContain('UI 脚本')
    expect(html).toContain('批量回归')
  })

  it('编排页在不可见时不渲染内容（也不发请求）', () => {
    const html = renderToStaticMarkup(<OrchestrationPage visible={false} />)
    expect(html).toBe('')
  })

  it('编排页可见时先渲染网站列表骨架', () => {
    const html = renderToStaticMarkup(<OrchestrationPage visible />)
    expect(html).toContain('编排（DAG）')
    expect(html).toContain('先选择一个网站')
  })

  it('接口库页能渲染骨架（三级名称 / 补抓入口不阻塞首屏）', () => {
    const html = renderToStaticMarkup(<CardsLibraryPage visible={false} />)
    expect(html).toContain('接口库')
    expect(html).toContain('补抓名称')
  })

  it('快速采集页能渲染骨架（左列 aside + 右列采集结果）', () => {
    const html = renderToStaticMarkup(<QuickCapturePage visible={false} />)
    expect(html).toContain('采集结果')
    expect(html).toContain('<aside>')
    expect(html).toContain('发起采集')
  })

  it('侧栏录制控制 tab 能渲染骨架', () => {
    const html = renderToStaticMarkup(<RecorderControlsTab />)
    expect(html).toContain('UI 测试 · 录制控制')
  })

  it('步骤编辑器能渲染（含断言编辑与点选入口）', () => {
    const detail: UiScriptDetail = {
      site: '示例站',
      flow: '搜索',
      version: 1,
      availableVersions: [1],
      yaml: '',
      doc: {
        apiVersion: 'dataforge/v1',
        kind: 'ui-script',
        meta: { site: '示例站', flow: '搜索', version: 1, created: '2026-10-17T00:00:00Z', startUrl: 'https://example.com/' },
        inputs: [],
        steps: [
          { id: 's1', kind: 'click', selector: '#go', expect: [{ kind: 'visible', selector: '#result' }] },
        ],
      },
    }
    const html = renderToStaticMarkup(
      <UiStepEditor detail={detail} recording={false} onClose={() => undefined} onSaved={() => undefined} />,
    )
    expect(html).toContain('编辑脚本')
    expect(html).toContain('保存为新版本')
    expect(html).toContain('从页面点选')
    expect(html).toContain('＋ 断言')
    expect(html).toContain('另存为新流程')
  })

  it('分页条：多页时出页码窗口与上一页/下一页；当前页高亮', () => {
    const html = renderToStaticMarkup(
      <PagerBar page={5} totalPages={29} label="第 51–60 / 共 286 接口" onGoto={() => undefined} />,
    )
    expect(html).toContain('第 51–60 / 共 286 接口')
    expect(html).toContain('aria-label="上一页"')
    expect(html).toContain('aria-label="下一页"')
    expect(html).toContain('…')
    expect(html).toContain('aria-current="true"')
  })

  it('采集网站页仍能渲染（回归：新页签没把它挤坏）', () => {
    const html = renderToStaticMarkup(<SitesBoardPage visible onRecapture={() => undefined} onOpenInLibrary={() => undefined} />)
    expect(html.length).toBeGreaterThan(0)
  })
})
