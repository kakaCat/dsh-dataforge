/**
 * 回放点击的视觉提示：在点击落点注入一个脉冲光圈 + 圆点，让观看者能看清"点到哪了"。
 *
 * 约束：
 *   - `pointer-events:none` + 最高 z-index：不拦截点击、不改布局；
 *   - 开一次样式、每次点击生成一个小节点，900ms 后自删；
 *   - 纯页面内 DOM，不依赖 CDP 覆盖层（共享浏览器和 Playwright 都能用）。
 *
 * @module dsh-dataforge/uitest/highlight
 */

const STYLE_ID = 'df-ui-click-highlight-style'

/** 生成"在视口 (x, y) 点击"的注入表达式（数字内联，安全）。 */
export function highlightClickExpression(x: number, y: number): string {
  const px = Math.round(Number.isFinite(x) ? x : 0)
  const py = Math.round(Number.isFinite(y) ? y : 0)
  return `(() => {
    try {
      const STYLE_ID = ${JSON.stringify(STYLE_ID)}
      if (document.getElementById(STYLE_ID) === null) {
        const style = document.createElement('style')
        style.id = STYLE_ID
        style.textContent = [
          '@keyframes dfUiClickRing { 0% { transform: translate(-50%, -50%) scale(0.25); opacity: 0.95 } 100% { transform: translate(-50%, -50%) scale(1.7); opacity: 0 } }',
          '@keyframes dfUiClickDot { 0% { transform: translate(-50%, -50%) scale(0); opacity: 1 } 25% { transform: translate(-50%, -50%) scale(1); opacity: 1 } 100% { transform: translate(-50%, -50%) scale(0.9); opacity: 0 } }'
        ].join('\\n')
        ;(document.head || document.documentElement).appendChild(style)
      }
      const host = document.createElement('div')
      host.setAttribute('data-df-ui-click', '1')
      host.style.cssText = 'position:fixed;left:${px}px;top:${py}px;width:0;height:0;z-index:2147483647;pointer-events:none;'
      const ring = document.createElement('span')
      ring.style.cssText = 'position:absolute;left:0;top:0;width:34px;height:34px;border:2px solid rgba(255,82,82,0.95);border-radius:50%;box-shadow:0 0 10px rgba(255,82,82,0.55);animation:dfUiClickRing 760ms ease-out forwards;'
      const dot = document.createElement('span')
      dot.style.cssText = 'position:absolute;left:0;top:0;width:9px;height:9px;border-radius:50%;background:#ff5252;box-shadow:0 0 6px rgba(255,82,82,0.8);animation:dfUiClickDot 760ms ease-out forwards;'
      host.appendChild(ring)
      host.appendChild(dot)
      ;(document.body || document.documentElement).appendChild(host)
      setTimeout(() => { host.remove() }, 1000)
      return { x: ${px}, y: ${py} }
    } catch (err) { return null }
  })()`
}
