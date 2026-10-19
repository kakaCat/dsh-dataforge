/**
 * 页面内选择器候选生成器（录制器与点选器共用）。
 *
 * 为什么单独成字符串常量：
 *   - 录制器要它把用户操作的元素变成候选链；
 *   - 面板「从页面点选元素加断言」也要它（否则一套选择器逻辑会分裂成两份，必然漂移）。
 * 页面脚本里挂 `window.__dfUiSelectorCandidates(el)`，幂等（已存在就跳过），
 * 多个模块重复注入不会重复定义。
 *
 * 候选顺序就是回放优先级：testid → id → name → aria-label → 文本 → CSS 路径。
 * 只生成「当前页面唯一命中」的候选；Playwright 专属选择器（`:has-text` / `text=`）
 * 在页面内 `querySelectorAll` 校验不了，由 stopping/回放阶段的 Playwright 引擎二次校验。
 *
 * @module dsh-dataforge/uitest/selector-script
 */
export const SELECTOR_HELPER_SCRIPT = `(() => {
  var VERSION = 2
  if (typeof window.__dfUiSelectorCandidates === 'function' && window.__dfUiSelectorVersion === VERSION) return
  window.__dfUiSelectorVersion = VERSION

  function esc(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value)
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&')
  }
  function textOf(el) {
    return ((el.innerText || el.textContent || '') + '').replace(/\\s+/g, ' ').trim().slice(0, 40)
  }
  function unique(selector) {
    try { return document.querySelectorAll(selector).length === 1 } catch (err) { return false }
  }
  function cssPath(el) {
    var parts = []
    var cur = el
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      if (cur.id && unique('#' + esc(cur.id))) { parts.unshift('#' + esc(cur.id)); break }
      var part = cur.tagName.toLowerCase()
      var parent = cur.parentElement
      if (parent) {
        var same = []
        for (var i = 0; i < parent.children.length; i += 1) {
          if (parent.children[i].tagName === cur.tagName) same.push(parent.children[i])
        }
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')'
      }
      parts.unshift(part)
      if (parts.length >= 8) break
      cur = cur.parentElement
    }
    return parts.join(' > ')
  }
  function addCandidate(out, selector) {
    // Playwright 专属选择器（text= / :has-text）页面里校验不了唯一性，先收进来，
    // 由回放阶段校验；纯 CSS 仍要求当前页唯一，避免录进歧义选择器。
    var playwrightOnly = /^text=|:has-text\\(/.test(selector)
    if (selector && out.indexOf(selector) < 0 && (playwrightOnly || unique(selector))) out.push(selector)
  }
  function quote(value) {
    return String(value).replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"')
  }
  function candidatesFor(el) {
    var out = []
    if (!el || el.nodeType !== 1) return out
    var attrs = ['data-testid', 'data-test-id', 'data-test', 'data-qa']
    for (var i = 0; i < attrs.length; i += 1) {
      var testId = el.getAttribute(attrs[i])
      if (testId) addCandidate(out, '[' + attrs[i] + '="' + quote(testId) + '"]')
    }
    if (el.id) addCandidate(out, '#' + esc(el.id))
    if (el.name && /^(INPUT|SELECT|TEXTAREA|FORM)$/.test(el.tagName)) {
      addCandidate(out, el.tagName.toLowerCase() + '[name="' + quote(el.name) + '"]')
    }
    var aria = el.getAttribute('aria-label')
    if (aria) addCandidate(out, el.tagName.toLowerCase() + '[aria-label="' + quote(aria) + '"]')
    var placeholder = el.getAttribute('placeholder')
    if (placeholder) addCandidate(out, el.tagName.toLowerCase() + '[placeholder="' + quote(placeholder) + '"]')
    var title = el.getAttribute('title')
    if (title) addCandidate(out, el.tagName.toLowerCase() + '[title="' + quote(title) + '"]')
    var alt = el.getAttribute('alt')
    if (alt && el.tagName === 'IMG') addCandidate(out, 'img[alt="' + quote(alt) + '"]')
    var href = el.getAttribute('href')
    if (href && el.tagName === 'A') addCandidate(out, 'a[href="' + quote(href) + '"]')
    var role = el.getAttribute('role')
    if (role) addCandidate(out, '[role="' + quote(role) + '"]')
    var text = textOf(el)
    if (text !== '' && (/^(BUTTON|A|LABEL)$/.test(el.tagName) || role)) {
      if (role) addCandidate(out, '[role="' + quote(role) + '"]:has-text("' + quote(text) + '")')
      addCandidate(out, el.tagName.toLowerCase() + ':has-text("' + quote(text) + '")')
      addCandidate(out, 'text="' + quote(text) + '"')
    }
    var path = cssPath(el)
    if (path) addCandidate(out, path)
    return out.slice(0, 8)
  }
  window.__dfUiSelectorCandidates = candidatesFor
})()`

/**
 * 点选器：让用户在可见会话里点一个元素，页面返回该元素的候选选择器。
 *
 * 是一个 Promise 表达式（Playwright `evaluate` 会 await 返回的 Promise）：
 *   - 捕获阶段吞掉 click/mousemove/keydown，避免误触页面业务（导航/提交）；
 *   - Esc 取消并 resolve `{ ok: false, cancelled: true }`；
 *   - 清理函数挂在 window 上，Node 侧超时可主动 cancel（避免 evaluate 永远挂着）。
 */
export const PICKER_SCRIPT = `new Promise((resolve) => {
  if (typeof window.__dfUiSelectorCandidates !== 'function') {
    resolve({ ok: false, error: 'selector helper 未注入（请先打开/刷新会话页面）' })
    return
  }
  if (typeof window.__dfUiPickerCancel === 'function') {
    try { window.__dfUiPickerCancel() } catch (err) {}
  }
  var highlighted = null
  var previousOutline = ''
  var previousOffset = ''

  function highlight(el) {
    if (highlighted === el) return
    restoreHighlight()
    if (!el || el.nodeType !== 1) return
    highlighted = el
    previousOutline = el.style.outline
    previousOffset = el.style.outlineOffset
    el.style.outline = '2px solid #2563eb'
    el.style.outlineOffset = '2px'
  }
  function restoreHighlight() {
    if (!highlighted) return
    highlighted.style.outline = previousOutline
    highlighted.style.outlineOffset = previousOffset
    highlighted = null
  }
  function cleanup() {
    restoreHighlight()
    window.removeEventListener('click', onClick, true)
    window.removeEventListener('mousemove', onMove, true)
    window.removeEventListener('keydown', onKey, true)
    window.__dfUiPickerCancel = null
  }
  function resolveWith(payload) {
    cleanup()
    resolve(payload)
  }
  function onMove(event) {
    event.preventDefault()
    event.stopPropagation()
    var el = event.target
    if (typeof el.closest === 'function') {
      el = el.closest('a,button,input,textarea,select,label,[role="button"],[role="link"],[role="tab"],[role="checkbox"],[role="menuitem"]') || el
    }
    highlight(el)
  }
  function onClick(event) {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    var el = event.target
    if (typeof el.closest === 'function') {
      el = el.closest('a,button,input,textarea,select,label,[role="button"],[role="link"],[role="tab"],[role="checkbox"],[role="menuitem"]') || el
    }
    var candidates = []
    try { candidates = window.__dfUiSelectorCandidates(el) || [] } catch (err) {}
    resolveWith({
      ok: true,
      pageUrl: location.href,
      candidates: candidates,
      selector: candidates.length > 0 ? candidates[0] : '',
      element: {
        tag: el.tagName,
        id: el.id || '',
        text: ((el.innerText || el.textContent || '') + '').replace(/\\s+/g, ' ').trim().slice(0, 60)
      }
    })
  }
  function onKey(event) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    resolveWith({ ok: false, cancelled: true })
  }

  window.__dfUiPickerCancel = function () {
    resolveWith({ ok: false, cancelled: true })
  }
  window.addEventListener('click', onClick, true)
  window.addEventListener('mousemove', onMove, true)
  window.addEventListener('keydown', onKey, true)
})`

/** 点选结果（页面返回，Node 侧透传；含候选与元素摘要）。 */
export type PickedElement = {
  ok: boolean
  cancelled?: boolean
  error?: string
  pageUrl?: string
  selector?: string
  candidates?: string[]
  element?: { tag: string; id: string; text: string }
}
