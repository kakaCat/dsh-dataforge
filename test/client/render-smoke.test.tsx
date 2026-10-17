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
import { OrchestrationPage } from '../../src/client/page-orchestration.js'
import { SitesBoardPage } from '../../src/client/sites-board.js'
import { ORCH_TAB_LABEL } from '../../src/client/dom.js'

describe('面板渲染冒烟', () => {
  it('整个面板能渲出顶栏与五个页签', () => {
    const html = renderToStaticMarkup(<DataforgePanelApp />)
    expect(html).toContain('数据采集')
    expect(html).toContain(ORCH_TAB_LABEL)
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

  it('采集网站页仍能渲染（回归：新页签没把它挤坏）', () => {
    const html = renderToStaticMarkup(<SitesBoardPage visible onRecapture={() => undefined} onOpenInLibrary={() => undefined} />)
    expect(html.length).toBeGreaterThan(0)
  })
})
