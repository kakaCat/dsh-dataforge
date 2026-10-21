/**
 * UI 测试页签：浏览器录制 + 页面断言的脚本列表 / 回放 / 运行记录。
 *
 * 交互动线（对齐「按键精灵」心智）：
 *   1. 录制表单填起点 URL + 站点/流程名 → 打开浏览器（可见 Chrome）→ 用户登录/导航
 *   2. 开始录制 → 用户在浏览器里操作 → 停止并保存（自动落成 vN 脚本）
 *   3. 选中脚本 → 回放计划（不跑）→ 确认回放（真浏览器）→ 看每步/断言/失败截图
 *
 * 页面只做展示与发请求：闸门判定、脚本校验、cookie 注入全在服务端（与 agent 工具同一套）。
 *
 * @module dsh-dataforge/client/page-uitest
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  closeUiRecording, confirmUiAgentReview, fetchUiBatches, fetchUiOverview, fetchUiRunDetail, fetchUiScript,
  fetchUiSessions, openUiRecording, runUiBatch, runUiTest, startUiRecording, stopUiRecording,
  uiBatchReportUrl, uiEvidenceUrl,
} from './api.js'
import type {
  UiBatchRecord, UiBatchResponse, UiOverview, UiRunDetail, UiRunResponse, UiRunRow,
  UiScriptDetail, UiScriptRef, UiStepLike,
} from './types.js'
import { UiStepEditor } from './ui-step-editor.js'
import { openInSidebarBrowser } from './sidebar-browser.js'
import { loadUiTestState, reconcileSession, saveUiTestState } from './ui-test-state.js'
import { openRecorderTab } from './sidebar-recorder.js'

export interface UiTestPageProps {
  visible: boolean
}

type Busy = 'load' | 'open' | 'start' | 'stop' | 'close' | 'plan' | 'run' | 'detail' | 'batch-plan' | 'batch-run' | 'review' | undefined

type Selected = { site: string; flow: string }

const FIELD_NOTE: Record<string, string> = {
  click: '点击',
  fill: '输入',
  press: '按键',
  select: '选择',
  submit: '提交表单',
  wait: '等待',
  goto: '打开地址',
  upload: '上传文件',
  scroll: '滚动',
}

function stepSummary(step: UiStepLike): string {
  const target = step.selector ?? step.url ?? step.key
    ?? (step.deltaY === undefined ? undefined : `Δ${step.deltaY}px`)
    ?? (step.files === undefined ? '' : step.files.join(', '))
  const value = step.value === undefined ? '' : ` = ${step.value}`
  return `${FIELD_NOTE[step.kind] ?? step.kind}${value}${target === '' ? '' : ` @ ${target}`}`
}

function assertSummary(step: UiStepLike): string {
  return (step.expect ?? []).map((expect) => {
    const expected = expect.equals ?? expect.contains ?? ''
    const target = expect.selector === undefined ? '' : ` ${expect.selector}`
    return `${expect.kind}${target}${expected === '' ? '' : ` ${expected}`}`
  }).join('；')
}

export function UiTestPage({ visible }: UiTestPageProps): ReactNode {
  // 初值来自持久化状态：面板离开再回来时，表单/选中脚本/录制会话不该看起来"没了"。
  const [overview, setOverview] = useState<UiOverview | undefined>()
  const [selected, setSelected] = useState<Selected | undefined>(() => loadUiTestState().selected)
  const [detail, setDetail] = useState<UiScriptDetail | undefined>()
  const [selectedVersion, setSelectedVersion] = useState<number | undefined>(() => loadUiTestState().selectedVersion)
  const [error, setError] = useState<string | undefined>()
  const [notice, setNotice] = useState<string | undefined>(() => loadUiTestState().notice)
  const [busy, setBusy] = useState<Busy>(undefined)
  const [recordForm, setRecordForm] = useState(() => {
    const saved = loadUiTestState().recordForm
    return saved ?? { startUrl: '', site: '', flow: '', domain: '', note: '' }
  })
  const [sessionId, setSessionId] = useState<string | undefined>(() => loadUiTestState().sessionId)
  const [recording, setRecording] = useState<boolean>(() => loadUiTestState().recording ?? false)
  const [inputValues, setInputValues] = useState<Record<string, string>>(() => loadUiTestState().inputValues ?? {})
  const [slowMoMs, setSlowMoMs] = useState<number>(() => loadUiTestState().slowMoMs ?? 0)
  const [showBrowser, setShowBrowser] = useState<boolean>(() => loadUiTestState().showBrowser ?? false)
  const [highlightClicks, setHighlightClicks] = useState<boolean>(() => loadUiTestState().highlightClicks ?? true)
  const [holdMs, setHoldMs] = useState<number>(() => loadUiTestState().holdMs ?? 2_000)
  const [runResponse, setRunResponse] = useState<UiRunResponse | undefined>()
  const [runDetail, setRunDetail] = useState<UiRunDetail | undefined>()
  const [editing, setEditing] = useState(false)
  const [batches, setBatches] = useState<UiBatchRecord[]>([])
  const [batchResponse, setBatchResponse] = useState<UiBatchResponse | undefined>()
  const [batchScope, setBatchScope] = useState<'site' | 'all'>('all')

  const scripts = overview?.scripts ?? []
  const runs = overview?.runs ?? []

  async function reload(
    keepSelection = true,
    prefer?: Selected,
    preferVersion?: number,
    silent = false,
  ): Promise<void> {
    if (!silent) setBusy('load')
    if (!silent) setError(undefined)
    try {
      const next = await fetchUiOverview()
      setOverview(next)
      try {
        setBatches((await fetchUiBatches(10)).batches)
      } catch {
        // 批次列表是增强项：服务端旧版本没有该路由时不影响主视图
      }
      // 选中的脚本优先沿用（含持久化恢复的）；刚保存的脚本显式 prefer，确保切到新内容。
      const persisted = loadUiTestState().selected
      const candidate = prefer ?? persisted ?? selected
      const exists = candidate !== undefined
        && next.scripts.some((script) => script.site === candidate.site && script.flow === candidate.flow)
      if (!keepSelection || candidate === undefined || !exists) {
        const first = next.scripts[0]
        if (first !== undefined) setSelected({ site: first.site, flow: first.flow })
      } else {
        setSelected(candidate)
      }
      if (preferVersion !== undefined) setSelectedVersion(preferVersion)
      // 会话优先按 id 认领（持久化的），否则取服务端列表第一个。
      const preferred = sessionId ?? loadUiTestState().sessionId
      const current = next.sessions.find((session) => session.sessionId === preferred) ?? next.sessions[0]
      if (current !== undefined) {
        setSessionId(current.sessionId)
        setRecording(current.recording)
      }
    } catch (err) {
      if (!silent) setError(String((err as Error)?.message ?? err))
    } finally {
      if (!silent) setBusy(undefined)
    }
  }

  // 状态持久化：这些是用户会以为"还在"的东西。
  useEffect(() => { saveUiTestState({ selected, selectedVersion }) }, [selected, selectedVersion])
  useEffect(() => { saveUiTestState({ recordForm }) }, [recordForm])
  useEffect(() => { saveUiTestState({ sessionId, recording }) }, [sessionId, recording])
  useEffect(() => { saveUiTestState({ inputValues }) }, [inputValues])
  useEffect(() => { saveUiTestState({ slowMoMs, showBrowser, highlightClicks, holdMs }) }, [slowMoMs, showBrowser, highlightClicks, holdMs])
  useEffect(() => { if (notice !== undefined) saveUiTestState({ notice }) }, [notice])

  useEffect(() => {
    if (!visible) return
    void reload(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  // 侧栏「录制控制」tab 保存成功后通知本页刷新脚本列表（带 saved 详情则直接切过去）。
  useEffect(() => {
    if (!visible) return
    const onReload = (event: Event): void => {
      const detail = (event as CustomEvent<{ site?: unknown; flow?: unknown; version?: unknown }>).detail
      if (typeof detail?.site === 'string' && typeof detail.flow === 'string' && typeof detail.version === 'number') {
        void reload(true, { site: detail.site, flow: detail.flow }, detail.version)
      } else {
        void reload(true)
      }
    }
    window.addEventListener('dataforge:uitest-reload', onReload)
    return () => window.removeEventListener('dataforge:uitest-reload', onReload)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  // 脚本列表自动刷新：录制可能在侧栏 tab 完成，主面板不主动刷新就会像"看不到新内容"。
  useEffect(() => {
    if (!visible) return
    const timer = setInterval(() => { void reload(true, undefined, undefined, true) }, 5_000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  // 会话轮询：面板挂载后从服务端对齐浏览器会话与录制状态（切走再回来能接着用）。
  useEffect(() => {
    if (!visible) return
    let cancelled = false
    const sync = async (): Promise<void> => {
      try {
        const { sessions } = await fetchUiSessions()
        if (cancelled) return
        const next = reconcileSession(loadUiTestState(), sessions)
        if (next.changed) {
          setSessionId(next.sessionId)
          setRecording(next.recording)
        }
      } catch {
        // 旧服务端没有该路由时忽略：主视图照常
      }
    }
    void sync()
    const timer = setInterval(() => { void sync() }, 2_500)
    return () => { cancelled = true; clearInterval(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, sessionId])

  useEffect(() => {
    if (!visible || selected === undefined) return
    let cancelled = false
    setBusy('detail')
    fetchUiScript(selected.site, selected.flow, selectedVersion)
      .then((value) => {
        if (cancelled) return
        setDetail(value)
        setRunResponse(undefined)
        setRunDetail(undefined)
        setEditing(false)
        setInputValues((previous) => {
          const next: Record<string, string> = {}
          for (const input of value.doc.inputs) {
            next[input.name] = previous[input.name] ?? input.example ?? ''
          }
          return next
        })
        setRecordForm((previous) => ({
          ...previous,
          startUrl: previous.startUrl !== '' ? previous.startUrl : value.doc.meta.startUrl,
          site: previous.site !== '' ? previous.site : value.doc.meta.site,
          flow: previous.flow !== '' ? previous.flow : value.doc.meta.flow,
        }))
        setError(undefined)
      })
      .catch((err: unknown) => { if (!cancelled) setError(String((err as Error)?.message ?? err)) })
      .finally(() => { if (!cancelled) setBusy(undefined) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, selected?.site, selected?.flow, selectedVersion])

  function selectScript(script: UiScriptRef): void {
    setSelected({ site: script.site, flow: script.flow })
    setSelectedVersion(undefined)
    setRecordForm((previous) => ({
      ...previous,
      site: script.site,
      flow: script.flow,
    }))
  }

  async function onOpenRecording(): Promise<void> {
    setError(undefined)
    setNotice(undefined)
    setBusy('open')
    try {
      const opened = await openUiRecording(recordForm.startUrl.trim())
      if (opened.ok !== true || opened.sessionId === undefined) {
        setError(opened.error ?? '打开录制浏览器失败')
        return
      }
      setSessionId(opened.sessionId)
      setRecording(false)
      setRecordForm((previous) => ({
        ...previous,
        site: previous.site.trim() === '' && opened.suggestedSite !== undefined ? opened.suggestedSite : previous.site,
        flow: previous.flow.trim() === '' && opened.suggestedFlow !== undefined ? opened.suggestedFlow : previous.flow,
      }))
      // 共享浏览器：顺手在右侧栏打开「录制控制」tab，浏览器旁边就能开始/停止录制。
      if (opened.engine === 'shared' && opened.sessionId !== undefined) {
        const openedTab = openRecorderTab({
          sessionId: opened.sessionId,
          ...(opened.pageUrl === undefined ? {} : { pageUrl: opened.pageUrl }),
          site: recordForm.site,
          flow: recordForm.flow,
        })
        if (!openedTab) {
          setNotice('浏览器已打开，但右侧栏录制控制 tab 未能打开（宿主 sidebar-right 不可用）；请在本面板里开始录制。')
          return
        }
      }
      setNotice(opened.notice ?? `浏览器已打开：先在窗口里登录/导航，再点「开始录制」。`)
    } catch (err) {
      setError(String((err as Error)?.message ?? err))
    } finally {
      setBusy(undefined)
    }
  }

  async function onStartRecording(): Promise<void> {
    if (sessionId === undefined) return
    setError(undefined)
    setBusy('start')
    try {
      const started = await startUiRecording(sessionId)
      if (started.ok !== true) {
        setError(started.error ?? '开始录制失败')
        return
      }
      setRecording(true)
      setNotice('🔴 正在录制：在浏览器里完成业务操作，然后点「停止并保存」。')
    } catch (err) {
      setError(String((err as Error)?.message ?? err))
    } finally {
      setBusy(undefined)
    }
  }

  async function onStopRecording(): Promise<void> {
    if (sessionId === undefined) return
    setError(undefined)
    setBusy('stop')
    try {
      const stopped = await stopUiRecording({
        sessionId,
        ...(recordForm.site.trim() === '' ? {} : { site: recordForm.site.trim() }),
        ...(recordForm.flow.trim() === '' ? {} : { flow: recordForm.flow.trim() }),
        ...(recordForm.domain.trim() === '' ? {} : { domain: recordForm.domain.trim() }),
        ...(recordForm.note.trim() === '' ? {} : { note: recordForm.note.trim() }),
        save: true,
      })
      if (stopped.ok !== true) {
        setError(stopped.error ?? '停止录制失败')
        return
      }
      setRecording(false)
      const saved = stopped.saved === undefined ? '' : `，已保存为 v${stopped.saved.version}`
      setNotice(`录制结束：${stopped.stepCount ?? 0} 步${saved}。${stopped.notice ?? ''}`)
      if (stopped.saved !== undefined) {
        setSelected({ site: stopped.saved.site, flow: stopped.saved.flow })
        setSelectedVersion(undefined)
        // 自动命名（站点/流程留空）落盘后回填表单，用户能看到最终名字。
        setRecordForm((previous) => ({ ...previous, site: stopped.saved!.site, flow: stopped.saved!.flow }))
        await reload(true, stopped.saved, stopped.saved.version)
      } else {
        await reload(true)
      }
    } catch (err) {
      setError(String((err as Error)?.message ?? err))
    } finally {
      setBusy(undefined)
    }
  }

  async function onCloseRecording(): Promise<void> {
    if (sessionId === undefined) return
    setBusy('close')
    try {
      await closeUiRecording(sessionId)
      setSessionId(undefined)
      setRecording(false)
      setNotice('录制浏览器已关闭。')
    } catch (err) {
      setError(String((err as Error)?.message ?? err))
    } finally {
      setBusy(undefined)
    }
  }

  async function onPlanRun(): Promise<void> {
    if (detail === undefined) return
    setError(undefined)
    setBusy('plan')
    try {
      const response = await runUiTest({
        site: detail.site,
        flow: detail.flow,
        version: detail.version,
        inputs: inputValues,
        slowMoMs,
        highlightClicks,
        holdMs,
        ...(showBrowser ? { headless: false } : {}),
      })
      if (response.ok !== true) {
        setError(response.message ?? '回放计划生成失败')
        setRunResponse(undefined)
        return
      }
      setRunResponse(response)
      setRunDetail(undefined)
    } catch (err) {
      setError(String((err as Error)?.message ?? err))
    } finally {
      setBusy(undefined)
    }
  }

  async function onConfirmRun(): Promise<void> {
    if (detail === undefined) return
    setError(undefined)
    setBusy('run')
    try {
      const response = await runUiTest({
        site: detail.site,
        flow: detail.flow,
        version: detail.version,
        inputs: inputValues,
        slowMoMs,
        highlightClicks,
        holdMs,
        ...(showBrowser ? { headless: false } : {}),
        confirm: true,
      })
      setRunResponse(response)
      setNotice(response.result?.success === true ? '✅ 回放通过' : '❌ 回放失败（看步骤/截图）')
      await reload(true)
    } catch (err) {
      setError(String((err as Error)?.message ?? err))
    } finally {
      setBusy(undefined)
    }
  }

  async function onLoadRun(runId: string): Promise<void> {
    setBusy('detail')
    try {
      setRunDetail(await fetchUiRunDetail(runId))
    } catch (err) {
      setError(String((err as Error)?.message ?? err))
    } finally {
      setBusy(undefined)
    }
  }

  async function onBatchPlan(): Promise<void> {
    setError(undefined)
    setNotice(undefined)
    setBusy('batch-plan')
    try {
      const response = await runUiBatch({
        ...(batchScope === 'site' && selected !== undefined ? { site: selected.site } : {}),
        limit: 20,
      })
      if (response.ok !== true) {
        setError(response.message ?? '批量计划生成失败')
        setBatchResponse(undefined)
        return
      }
      setBatchResponse(response)
      if (response.plan?.missingInputs !== undefined && response.plan.missingInputs.length > 0) {
        setNotice(`计划里有缺参脚本：${response.plan.missingInputs.join('、')}（执行时会被记为跳过）`)
      }
    } catch (err) {
      setError(String((err as Error)?.message ?? err))
    } finally {
      setBusy(undefined)
    }
  }

  async function onBatchRun(): Promise<void> {
    setError(undefined)
    setBusy('batch-run')
    try {
      const response = await runUiBatch({
        ...(batchScope === 'site' && selected !== undefined ? { site: selected.site } : {}),
        limit: 20,
        confirm: true,
      })
      if (response.ok !== true) {
        setError(response.message ?? '批量回放未执行')
        setBatchResponse(response)
        return
      }
      setBatchResponse(response)
      const result = response.result
      if (result !== undefined) {
        setNotice(`批量回放：${result.total} 条 ｜ 通过 ${result.passed} / 失败 ${result.failed} / 跳过 ${result.skipped}（${Math.round(result.elapsedMs / 1000)}s）`)
      }
      await reload(true)
    } catch (err) {
      setError(String((err as Error)?.message ?? err))
    } finally {
      setBusy(undefined)
    }
  }

  /** 人工审查确认：当前版本与 AI 任务描述比对一致 → 落 review=confirmed 新版本。 */
  async function onConfirmReview(): Promise<void> {
    if (detail === undefined) return
    setError(undefined)
    setBusy('review')
    try {
      const result = await confirmUiAgentReview({
        site: detail.doc.meta.site,
        flow: detail.doc.meta.flow,
        version: detail.version,
      })
      setNotice(result.message ?? `已确认 v${result.version ?? '?'}：与任务一致`)
      await reload(true)
    } catch (err) {
      setError(String((err as Error)?.message ?? err))
    } finally {
      setBusy(undefined)
    }
  }
  const stepCount = detail?.doc.steps.length ?? 0
  const versionOptions = useMemo(() => detail?.availableVersions ?? [], [detail])
  const currentRun = runResponse?.result
  const hasPlan = runResponse?.gate === 'confirm-required' && runResponse.plan !== undefined
  const missingInputs = detail === undefined
    ? []
    : detail.doc.inputs.filter((input) => input.required && (inputValues[input.name] ?? '').trim() === '').map((input) => input.name)

  if (!visible) return null

  return (
    <div className="dsh-df-page-spl">
      <aside>
        <div className="dsh-df-card">
          <div className="dsh-df-head">
            <h2>UI 测试</h2>
            <span className="dsh-df-badge done">浏览器回放</span>
          </div>
          <p className="dsh-df-sub">录制页面操作 → 存为脚本 → 回放 + 页面断言。与接口链（HTTP）是两条执行面。</p>
          {overview?.browser !== undefined ? (
            <p className="dsh-df-kv">
              <b>浏览器引擎</b> {overview.browser.label}
              {overview.browser.available ? '' : '（不可用）'}
              {overview.browser.degraded === undefined ? '' : ` ｜ ${overview.browser.degraded}`}
            </p>
          ) : null}
          <p className="dsh-df-kv">
            <b>共享浏览器</b>{' '}
            {overview?.browser?.available === true
              ? '已连接（dsh-builtin-browser / ctx.browser）'
              : overview === undefined
                ? '检测中…'
                : `未安装 —— ${overview.browser?.installCommand ?? '安装 dsh-builtin-browser'}`}
          </p>
          <button type="button" className="dsh-df-btn" onClick={() => { void reload(true) }} disabled={busy === 'load'}>
            {busy === 'load' ? '刷新中…' : '刷新'}
          </button>
        </div>

        <div className="dsh-df-card">
          <div className="dsh-df-head"><h2>录制</h2>{recording ? <span className="dsh-df-badge running">录制中</span> : null}</div>
          <div className="dsh-df-field">
            <label htmlFor="df-ui-start-url">起点 URL</label>
            <input
              id="df-ui-start-url"
              value={recordForm.startUrl}
              placeholder="https://example.com/"
              onChange={(event) => setRecordForm({ ...recordForm, startUrl: event.target.value })}
            />
          </div>
          <div className="dsh-df-row2">
            <div className="dsh-df-field">
              <label htmlFor="df-ui-site">站点名</label>
              <input
                id="df-ui-site"
                value={recordForm.site}
                placeholder="留空自动取站点名/域名"
                onChange={(event) => setRecordForm({ ...recordForm, site: event.target.value })}
              />
            </div>
            <div className="dsh-df-field">
              <label htmlFor="df-ui-flow">流程名</label>
              <input
                id="df-ui-flow"
                value={recordForm.flow}
                placeholder="留空自动取页面标题"
                onChange={(event) => setRecordForm({ ...recordForm, flow: event.target.value })}
              />
            </div>
          </div>
          <div className="dsh-df-row2">
            <div className="dsh-df-field">
              <label htmlFor="df-ui-domain">业务域（可选）</label>
              <input
                id="df-ui-domain"
                value={recordForm.domain}
                onChange={(event) => setRecordForm({ ...recordForm, domain: event.target.value })}
              />
            </div>
            <div className="dsh-df-field">
              <label htmlFor="df-ui-note">版本说明（可选）</label>
              <input
                id="df-ui-note"
                value={recordForm.note}
                onChange={(event) => setRecordForm({ ...recordForm, note: event.target.value })}
              />
            </div>
          </div>
          <p className="dsh-df-sub" style={{ marginTop: -4 }}>
            站点名/流程名可留空：站点取 og:site_name 或域名，流程取页面标题；停止保存时仍为空会自动命名。
          </p>
          <div className="dsh-df-inputs-row">
            <button type="button" className="dsh-df-btn" onClick={() => { void onOpenRecording() }} disabled={busy !== undefined || recordForm.startUrl.trim() === ''}>
              {busy === 'open' ? '打开中…' : '打开浏览器'}
            </button>
            <button type="button" className="dsh-df-btn" onClick={() => { void onStartRecording() }} disabled={busy !== undefined || sessionId === undefined || recording}>
              {busy === 'start' ? '开始中…' : '开始录制'}
            </button>
            <button type="button" className="dsh-df-btn-primary" onClick={() => { void onStopRecording() }} disabled={busy !== undefined || sessionId === undefined || !recording}>
              {busy === 'stop' ? '停止中…' : '停止并保存'}
            </button>
            <button type="button" className="dsh-df-btn-ghost" onClick={() => { void onCloseRecording() }} disabled={busy !== undefined || sessionId === undefined}>
              关闭浏览器
            </button>
          </div>
          {sessionId !== undefined ? (
            <p className="dsh-df-kv" style={{ marginTop: 8 }}>
              <b>会话</b> {sessionId} ｜ {recording ? '录制中' : '未录制'}
            </p>
          ) : null}
        </div>

        <div className="dsh-df-card">
          <div className="dsh-df-head">
            <h2>UI 脚本</h2>
            <span className="dsh-df-badge">{scripts.length}</span>
            <button type="button" className="dsh-df-btn-ghost" disabled={busy === 'load'} onClick={() => { void reload(true) }}>
              {busy === 'load' ? '刷新中…' : '刷新'}
            </button>
          </div>
          {scripts.length === 0 ? (
            <p className="dsh-df-sub">还没有脚本。用上面的录制流程生成，或让 agent 用 dataforge_ui_script_upsert 写入。</p>
          ) : (
            <div className="dsh-df-list">
              {scripts.map((script) => {
                const active = selected?.site === script.site && selected?.flow === script.flow
                const versionInfo = script.versionsInfo?.find((info) => info.version === script.latest)
                return (
                  <button
                    key={`${script.site}/${script.flow}`}
                    type="button"
                    className="dsh-df-btn-ghost"
                    style={{ justifyContent: 'space-between', textAlign: 'left', ...(active ? { borderColor: 'var(--dsh-df-accent)' } : {}) }}
                    onClick={() => selectScript(script)}
                  >
                    <span>
                      <b>{script.site}</b> / {script.flow}
                      {script.unreadable === undefined ? '' : ' ⚠'}
                    </span>
                    <span className="dsh-df-kv">
                      v{script.latest}
                      {versionInfo?.stepCount === undefined ? '' : ` · ${versionInfo.stepCount} 步`}
                      {(script.review ?? versionInfo?.review) === 'pending' ? ' · ⏳待审查' : ''}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </aside>

      <main>
        {error !== undefined ? (
          <div className="dsh-df-errline" role="alert">
            <span>{error}</span>
            <button type="button" className="dsh-df-btn" onClick={() => { void reload(true) }}>重试</button>
          </div>
        ) : null}
        {notice !== undefined ? <div className="dsh-df-card"><p className="dsh-df-sub">{notice}</p></div> : null}

        {detail === undefined ? (
          <div className="dsh-df-empty">
            <b>选择一个脚本</b>
            <p className="dsh-df-sub">左侧列表选中后显示步骤、断言与回放入口。</p>
          </div>
        ) : editing ? (
          <UiStepEditor
            detail={detail}
            sessionId={sessionId}
            recording={recording}
            onClose={() => setEditing(false)}
            onSaved={(saved) => {
              setEditing(false)
              setSelected({ site: saved.site, flow: saved.flow })
              setSelectedVersion(saved.version)
              setNotice(`已保存：${saved.site} / ${saved.flow} v${saved.version}`)
              void reload(true)
            }}
          />
        ) : (
          <div className="dsh-df-card">
            <div className="dsh-df-head">
              <h2>
                {detail.doc.meta.site} / {detail.doc.meta.flow} ｜ v{detail.version}
              </h2>
              <span className="dsh-df-badge done">{detail.doc.meta.source ?? '未标注'}</span>
              {detail.doc.meta.review === 'pending' ? <span className="dsh-df-badge running">⏳ 待审查</span> : null}
              {detail.doc.meta.review === 'confirmed' ? <span className="dsh-df-badge done">✓ 已确认</span> : null}
            </div>
            {detail.doc.meta.task !== undefined && detail.doc.meta.task !== '' ? (
              <p className="dsh-df-kv" style={{ marginTop: 6 }}>
                <b>AI 任务</b> {detail.doc.meta.task}
              </p>
            ) : null}
            <p className="dsh-df-kv">
              <b>起点</b> {detail.doc.meta.startUrl} ｜ <b>{stepCount} 步</b>
              {detail.doc.meta.created === undefined ? '' : ` ｜ ${detail.doc.meta.created}`}
            </p>
            <div className="dsh-df-inputs-row" style={{ marginTop: 10 }}>
              <select
                className="dsh-df-select"
                value={detail.version}
                onChange={(event) => setSelectedVersion(Number(event.target.value))}
              >
                {versionOptions.map((version) => <option key={version} value={version}>v{version}</option>)}
              </select>
              <select
                className="dsh-df-select"
                value={slowMoMs}
                title="回放慢放：每步之间等待多久"
                onChange={(event) => {
                  const value = Number(event.target.value)
                  setSlowMoMs(value)
                  if (value > 0 && overview?.browser?.engine === 'playwright') setShowBrowser(true)
                }}
              >
                <option value={0}>正常速度</option>
                <option value={500}>慢速（0.5s/步）</option>
                <option value={1000}>很慢（1s/步）</option>
                <option value={2000}>极慢（2s/步）</option>
              </select>
              <label className="dsh-df-kv" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input type="checkbox" checked={highlightClicks} onChange={(event) => setHighlightClicks(event.target.checked)} />
                点击动画
              </label>
              <select
                className="dsh-df-select"
                value={holdMs}
                title="回放结束后停留多久再关闭浏览器"
                onChange={(event) => setHoldMs(Number(event.target.value))}
              >
                <option value={0}>结束即关闭</option>
                <option value={1000}>末尾停 1s</option>
                <option value={2000}>末尾停 2s</option>
                <option value={5000}>末尾停 5s</option>
              </select>
              {overview?.browser?.engine === 'playwright' ? (
                <label className="dsh-df-kv" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="checkbox" checked={showBrowser} onChange={(event) => setShowBrowser(event.target.checked)} />
                  显示浏览器窗口
                </label>
              ) : null}
              {detail.doc.meta.review === 'pending' ? (
                <button
                  type="button"
                  className="dsh-df-btn-primary"
                  title="比对上方 AI 任务描述与下方步骤：一致就确认，确认落 review=confirmed 新版本"
                  onClick={() => { void onConfirmReview() }}
                  disabled={busy !== undefined}
                >
                  {busy === 'review' ? '确认中…' : '✓ 审查通过'}
                </button>
              ) : null}
              <button type="button" className="dsh-df-btn" onClick={() => { void onPlanRun() }} disabled={busy !== undefined}>
                {busy === 'plan' ? '生成计划…' : '回放计划'}
              </button>
              <button type="button" className="dsh-df-btn-primary" onClick={() => { void onConfirmRun() }} disabled={busy !== undefined || missingInputs.length > 0}>
                {busy === 'run' ? '回放中…' : '确认回放'}
              </button>
              <button type="button" className="dsh-df-btn-ghost" onClick={() => setEditing(true)} disabled={busy !== undefined}>
                编辑脚本
              </button>
              <button
                type="button"
                className="dsh-df-btn-ghost"
                title="在右侧 Sidebar 浏览器打开脚本起点（只读查看，不参与录制/回放）"
                onClick={() => openInSidebarBrowser(detail.doc.meta.startUrl)}
                disabled={!/^https?:\/\//i.test(detail.doc.meta.startUrl)}
              >
                在侧栏浏览器打开
              </button>
              {missingInputs.length > 0 ? <span className="dsh-df-errline">缺必填入参：{missingInputs.join('、')}</span> : null}
              {slowMoMs > 0 ? <span className="dsh-df-kv">回放会按 {slowMoMs}ms/步 慢放{overview?.browser?.engine === 'playwright' && !showBrowser ? '（建议勾选“显示浏览器窗口”才看得到）' : ''}</span> : null}
            </div>

            {detail.doc.inputs.length > 0 ? (
              <div className="dsh-df-inputs" style={{ marginTop: 12 }}>
                <div className="dsh-df-inputs-head"><span className="dsh-df-dname">入参槽位</span></div>
                <div className="dsh-df-inputs-body">
                  {detail.doc.inputs.map((input) => (
                    <div className="dsh-df-inputs-row" key={input.name}>
                      <span className="dsh-df-inputs-req">{input.name}（{input.type}{input.required ? '，必填' : ''}）</span>
                      <input
                        value={inputValues[input.name] ?? ''}
                        placeholder={input.example ?? ''}
                        onChange={(event) => setInputValues({ ...inputValues, [input.name]: event.target.value })}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <table className="dsh-df-fields" style={{ marginTop: 14 }}>
              <thead>
                <tr><th>#</th><th>步骤</th><th>断言</th></tr>
              </thead>
              <tbody>
                {detail.doc.steps.map((step, index) => (
                  <tr key={step.id}>
                    <td className="dsh-df-mono">{index + 1}</td>
                    <td className="dsh-df-mono">{stepSummary(step)}</td>
                    <td className="dsh-df-mono">{assertSummary(step) === '' ? '—' : assertSummary(step)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {runResponse !== undefined && hasPlan ? (
          <div className="dsh-df-card">
            <div className="dsh-df-head"><h2>回放计划</h2><span className="dsh-df-badge running">待确认</span></div>
            <p className="dsh-df-kv">
              <b>起点</b> {runResponse.plan?.startUrl} ｜ <b>步骤</b> {runResponse.plan?.stepCount} ｜{' '}
              <b>写操作</b> {runResponse.plan?.writeSteps ?? 0}
            </p>
            <p className="dsh-df-sub">确认后将打开无头 Chrome 逐步操作；click/submit/upload 可能产生真实业务写入，请确认后再点「确认回放」。</p>
            <button type="button" className="dsh-df-btn-primary" onClick={() => { void onConfirmRun() }} disabled={busy !== undefined}>
              {busy === 'run' ? '回放中…' : '确认回放'}
            </button>
          </div>
        ) : null}

        {currentRun !== undefined ? (
          <div className="dsh-df-card">
            <div className="dsh-df-head">
              <h2>{currentRun.success ? '回放通过' : '回放失败'} ｜ {currentRun.site} / {currentRun.flow} v{currentRun.version}</h2>
              <span className={`dsh-df-badge ${currentRun.success ? 'done' : 'failed'}`}>
                {currentRun.stepsDone}/{currentRun.totalSteps} 步
              </span>
            </div>
            <p className="dsh-df-kv">
              <b>耗时</b> {currentRun.elapsedMs}ms ｜ <b>run</b> {currentRun.runId}
              {currentRun.cookiesApplied > 0 ? ` ｜ 注入 cookie ${currentRun.cookiesApplied} 条` : ''}
              {currentRun.error === undefined ? '' : ` ｜ ${currentRun.error}`}
            </p>
            <table className="dsh-df-fields" style={{ marginTop: 10 }}>
              <thead><tr><th>#</th><th>步骤</th><th>断言</th></tr></thead>
              <tbody>
                {currentRun.steps.map((step) => (
                  <tr key={step.id}>
                    <td className="dsh-df-mono">{step.ok ? '✓' : '✗'}</td>
                    <td className="dsh-df-mono">
                      {step.kind}{step.target === undefined ? '' : ` @ ${step.target}`}（{step.elapsedMs}ms）
                      {step.error === undefined ? '' : <div className="dsh-df-kv">{step.error}</div>}
                    </td>
                    <td className="dsh-df-mono">
                      {step.assertions.length === 0 ? '—' : step.assertions.map((assertion, index) => (
                        <div key={index}>
                          {assertion.ok ? '✓' : '✗'} {assertion.kind}
                          {assertion.error === undefined ? '' : `：${assertion.error}`}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {currentRun.screenshot !== undefined ? (
              <div style={{ marginTop: 10 }}>
                <p className="dsh-df-kv"><b>失败截图</b> {currentRun.screenshot}</p>
                <img
                  alt="失败截图"
                  style={{ maxWidth: '100%', border: '1px solid var(--dsh-df-line)', borderRadius: 8 }}
                  src={uiEvidenceUrl(currentRun.runId, 'failure.png')}
                />
                {currentRun.dom === undefined ? null : (
                  <p className="dsh-df-kv">
                    <a href={uiEvidenceUrl(currentRun.runId, 'failure.html')} target="_blank" rel="noreferrer">打开失败现场 HTML</a>
                  </p>
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="dsh-df-card">
          <div className="dsh-df-head">
            <h2>批量回归</h2>
            <span className="dsh-df-badge">{batches.length}</span>
          </div>
          <p className="dsh-df-sub">
            把一组脚本串行跑一遍并出报告（`report.md` / `report.json`，落 `dataRoot/ui-batches/`）；缺参脚本记为跳过，不静默消失。
          </p>
          <div className="dsh-df-inputs-row" style={{ marginTop: 8 }}>
            <select className="dsh-df-select" value={batchScope} onChange={(event) => setBatchScope(event.target.value === 'site' ? 'site' : 'all')}>
              <option value="all">全部脚本</option>
              <option value="site" disabled={selected === undefined}>{selected === undefined ? '当前站点（未选）' : `当前站点（${selected.site}）`}</option>
            </select>
            <button type="button" className="dsh-df-btn" onClick={() => { void onBatchPlan() }} disabled={busy !== undefined || scripts.length === 0}>
              {busy === 'batch-plan' ? '生成计划…' : '批量计划'}
            </button>
            <button
              type="button"
              className="dsh-df-btn-primary"
              onClick={() => { void onBatchRun() }}
              disabled={busy !== undefined || batchResponse?.gate !== 'confirm-required' || (batchResponse.plan?.total ?? 0) === 0}
            >
              {busy === 'batch-run' ? '批量回放中…' : '确认批量回放'}
            </button>
          </div>

          {batchResponse?.gate === 'confirm-required' && batchResponse.plan !== undefined ? (
            <div style={{ marginTop: 10 }}>
              <p className="dsh-df-kv">
                <b>选中</b> {batchResponse.plan.total} 条 ｜ <b>写操作</b> {batchResponse.plan.writeSteps} 步
                {batchResponse.plan.missingInputs.length === 0 ? '' : ` ｜ 缺参：${batchResponse.plan.missingInputs.join('、')}`}
              </p>
              <div className="dsh-df-list">
                {batchResponse.plan.items.slice(0, 20).map((item) => (
                  <div key={`${item.index}-${item.site}/${item.flow}`} className="dsh-df-kv">
                    {item.index + 1}. {item.site} / {item.flow}{item.version === undefined ? '' : ` v${item.version}`} ｜ {item.stepCount} 步
                    {item.error === undefined ? '' : ` ｜ ✗ ${item.error}`}
                    {item.missing.length === 0 ? '' : ` ｜ 缺参 ${item.missing.join('、')}`}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {batchResponse?.result !== undefined ? (
            <div style={{ marginTop: 10 }}>
              <p className="dsh-df-kv">
                <b>{batchResponse.result.batchId}</b> ｜ 通过 {batchResponse.result.passed} / 失败 {batchResponse.result.failed} / 跳过 {batchResponse.result.skipped}
                ｜ {Math.round(batchResponse.result.elapsedMs / 1000)}s ｜
                <a href={uiBatchReportUrl(batchResponse.result.batchId, 'md')} target="_blank" rel="noreferrer">报告 md</a>
                {' ｜ '}
                <a href={uiBatchReportUrl(batchResponse.result.batchId, 'json')} target="_blank" rel="noreferrer">report.json</a>
              </p>
              {batchResponse.result.items.filter((item) => item.success !== true).map((item) => (
                <div key={`${item.index}-${item.site}/${item.flow}`} className="dsh-df-kv">
                  {item.skipped === true ? '⏭' : '✗'} {item.site} / {item.flow}
                  {item.failedStep === undefined ? '' : ` ｜ 断在 ${item.failedStep}`}
                  {item.error === undefined ? '' : ` ｜ ${item.error}`}
                </div>
              ))}
            </div>
          ) : null}

          {batches.length > 0 ? (
            <div className="dsh-df-list" style={{ marginTop: 10 }}>
              {batches.map((batch) => (
                <div key={batch.batchId} className="dsh-df-kv">
                  <b>{batch.batchId}</b> ｜ {batch.total} 条 ｜ 通过 {batch.passed} / 失败 {batch.failed} / 跳过 {batch.skipped}
                  {' ｜ '}
                  <a href={uiBatchReportUrl(batch.batchId, 'md')} target="_blank" rel="noreferrer">报告</a>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="dsh-df-card">
          <div className="dsh-df-head"><h2>运行记录</h2><span className="dsh-df-badge">{runs.length}</span></div>
          {runs.length === 0 ? (
            <p className="dsh-df-sub">还没有回放记录。</p>
          ) : (
            <div className="dsh-df-list">
              {runs.map((run: UiRunRow) => (
                <button key={run.runId} type="button" className="dsh-df-btn-ghost" style={{ justifyContent: 'space-between', textAlign: 'left' }} onClick={() => { void onLoadRun(run.runId) }}>
                  <span>
                    <span className={`dsh-df-badge ${run.status === 'success' ? 'done' : run.status === 'failed' ? 'failed' : 'running'}`}>{run.status}</span>{' '}
                    {run.site} / {run.flow} v{run.version}{run.failedStep === undefined ? '' : ` ｜ 断在 ${run.failedStep}`}
                  </span>
                  <span className="dsh-df-kv">{new Date(run.startedAt).toLocaleString()}</span>
                </button>
              ))}
            </div>
          )}
          {runDetail !== undefined ? (
            <div style={{ marginTop: 10 }}>
              <p className="dsh-df-kv"><b>{runDetail.run.runId}</b> ｜ {runDetail.run.status}</p>
              {runDetail.events.flatMap((event, index) => {
                if (event.event === 'step') {
                  return [`${event.status === 'done' ? '✓' : event.status === 'error' ? '✗' : '…'} ${event.id ?? ''} ${event.kind ?? ''}${event.error === undefined ? '' : ` ｜ ${event.error}`}`]
                }
                if (event.event === 'assert') {
                  return [`　断言 ${event.kind ?? ''} ${event.status === 'ok' ? '✓' : '✗'}${event.error === undefined ? '' : ` ｜ ${event.error}`}`]
                }
                if (event.event === 'terminal') {
                  return [`终态：${event.success === true ? '成功' : '失败'}${event.message === undefined ? '' : ` · ${event.message}`}`]
                }
                return []
              }).map((line, index) => <div className="dsh-df-kv" key={index}>{line}</div>)}
              {runDetail.run.screenshot === undefined ? null : (
                <img
                  alt="失败截图"
                  style={{ maxWidth: '100%', marginTop: 8, border: '1px solid var(--dsh-df-line)', borderRadius: 8 }}
                  src={uiEvidenceUrl(runDetail.run.runId, 'failure.png')}
                />
              )}
            </div>
          ) : null}
        </div>
      </main>
    </div>
  )
}
