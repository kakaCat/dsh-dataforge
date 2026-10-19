/**
 * 面板内的步骤/断言编辑器（M2）。
 *
 * 为什么单独一个组件：编辑态要维护一份可变的 doc 副本（增删步骤/断言、点选元素、
 * 插入等待），与 page-uitest 的只读展示状态分开，避免互相污染。
 *
 * 保存走服务端 `POST /ui-tests/script { doc }`：客户端**不做协议翻译**，整份 doc 回传，
 * 由 `parseUiScriptDoc` 校验全过才落新版本（vN+1，旧版本不覆盖）。
 *
 * @module dsh-dataforge/client/ui-step-editor
 */
import { useState, type ReactNode } from 'react'
import { pickUiSelector, saveUiScriptDoc } from './api.js'
import type { UiExpectLike, UiScriptDetail, UiScriptDocLike, UiStepLike } from './types.js'

const STEP_KINDS = ['goto', 'click', 'fill', 'press', 'select', 'submit', 'wait', 'upload'] as const
const EXPECT_KINDS = ['visible', 'hidden', 'text', 'value', 'url', 'count'] as const

const STEP_LABELS: Record<string, string> = {
  goto: '打开地址',
  click: '点击',
  fill: '输入',
  press: '按键',
  select: '选择',
  submit: '提交表单',
  wait: '等待',
  upload: '上传文件',
}

const EXPECT_LABELS: Record<string, string> = {
  visible: '元素可见',
  hidden: '元素隐藏',
  text: '文本',
  value: '输入值',
  url: '页面 URL',
  count: '元素数量',
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function nextStepId(steps: UiStepLike[]): string {
  let max = 0
  for (const step of steps) {
    const hit = /^s(\d+)$/.exec(step.id)
    if (hit !== null) max = Math.max(max, Number(hit[1]))
  }
  return `s${max + 1}`
}

function freshStep(kind: string, id: string): UiStepLike {
  switch (kind) {
    case 'goto': return { id, kind, url: 'https://' }
    case 'fill': return { id, kind, selector: '', value: '' }
    case 'press': return { id, kind, key: 'Enter' }
    case 'select': return { id, kind, selector: '', value: '' }
    case 'wait': return { id, kind, ms: 1_000 }
    case 'upload': return { id, kind, selector: '', files: [] }
    default: return { id, kind, selector: '' }
  }
}

/** 切 kind 时保留 id / 断言，其余字段按新 kind 重置（避免带着 fill.value 变成 click 的脏数据）。 */
function changeKind(step: UiStepLike, kind: string): UiStepLike {
  const next = freshStep(kind, step.id)
  if (step.expect !== undefined) next.expect = step.expect
  if ((kind === 'click' || kind === 'fill' || kind === 'select' || kind === 'submit' || kind === 'upload') && step.selector !== undefined) {
    next.selector = step.selector
    if (step.candidates !== undefined) next.candidates = step.candidates
  }
  return next
}

export interface UiStepEditorProps {
  detail: UiScriptDetail
  /** 已打开的录制会话（点选用；没有就只允许手填 selector）。 */
  sessionId?: string
  recording: boolean
  onClose: () => void
  /** 保存成功：回传落点（可能是同一流程的新版本，也可能是另存的新流程）。 */
  onSaved: (saved: { site: string; flow: string; version: number }) => void
}

export function UiStepEditor({ detail, sessionId, recording, onClose, onSaved }: UiStepEditorProps): ReactNode {
  const [doc, setDoc] = useState<UiScriptDocLike>(() => clone(detail.doc))
  const [busy, setBusy] = useState<'save' | 'save-as' | 'pick' | undefined>(undefined)
  const [error, setError] = useState<string | undefined>()
  const [notice, setNotice] = useState<string | undefined>()
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const [saveAsSite, setSaveAsSite] = useState('')
  const [saveAsFlow, setSaveAsFlow] = useState('')

  function patchSteps(steps: UiStepLike[]): void {
    setDoc((previous) => ({ ...previous, steps }))
  }

  function patchStep(index: number, patch: Partial<UiStepLike>): void {
    patchSteps(doc.steps.map((step, i) => (i === index ? { ...step, ...patch } : step)))
  }

  function deleteStep(index: number): void {
    patchSteps(doc.steps.filter((_, i) => i !== index))
  }

  function moveStep(index: number, delta: number): void {
    const target = index + delta
    if (target < 0 || target >= doc.steps.length) return
    const steps = [...doc.steps]
    const [step] = steps.splice(index, 1)
    steps.splice(target, 0, step as UiStepLike)
    patchSteps(steps)
  }

  function insertWait(index: number): void {
    const steps = [...doc.steps]
    steps.splice(index + 1, 0, { id: nextStepId(doc.steps), kind: 'wait', ms: 1_000 })
    patchSteps(steps)
  }

  function addStep(kind: string): void {
    patchSteps([...doc.steps, freshStep(kind, nextStepId(doc.steps))])
  }

  function addExpect(index: number): void {
    const step = doc.steps[index]
    if (step === undefined) return
    const expects: UiExpectLike[] = [...(step.expect ?? []), { kind: 'visible', selector: '' }]
    patchStep(index, { expect: expects })
  }

  function patchExpect(index: number, expectIndex: number, patch: Partial<UiExpectLike>): void {
    const step = doc.steps[index]
    if (step === undefined) return
    const expects = (step.expect ?? []).map((expect, i) => (i === expectIndex ? { ...expect, ...patch } : expect))
    patchStep(index, { expect: expects })
  }

  function deleteExpect(index: number, expectIndex: number): void {
    const step = doc.steps[index]
    if (step === undefined) return
    const expects = (step.expect ?? []).filter((_, i) => i !== expectIndex)
    patchStep(index, { expect: expects.length === 0 ? undefined : expects })
  }

  async function pick(stepIndex: number, expectIndex?: number): Promise<void> {
    if (sessionId === undefined) {
      setError('没有打开的录制会话：先点「打开浏览器」并登录，才能从页面点选元素（也可以手填 selector）。')
      return
    }
    if (recording) {
      setError('正在录制：先停止录制再点选元素（点选本身也会产生点击）。')
      return
    }
    setBusy('pick')
    setError(undefined)
    setNotice('点选模式已开启：请在浏览器窗口里点击目标元素（Esc 取消）…')
    try {
      const picked = await pickUiSelector(sessionId)
      if (!picked.ok) {
        if (picked.cancelled !== true) setError(picked.error ?? '点选失败')
        return
      }
      const selector = picked.selector ?? picked.candidates?.[0] ?? ''
      if (selector === '') {
        setError('这个元素没有生成可用选择器，请换一个元素或手填 selector。')
        return
      }
      if (expectIndex === undefined) {
        patchStep(stepIndex, { selector, ...(picked.candidates === undefined ? {} : { candidates: picked.candidates }) })
      } else {
        patchExpect(stepIndex, expectIndex, { selector })
      }
      const element = picked.element
      setNotice(`已选 ${element?.tag ?? '元素'}${element?.id === undefined || element.id === '' ? '' : `#${element.id}`}${element?.text === undefined || element.text === '' ? '' : ` ${element.text}`} → ${selector}`)
    } catch (err) {
      setError(String((err as Error)?.message ?? err))
    } finally {
      setBusy(undefined)
    }
  }

  async function save(): Promise<void> {
    setBusy('save')
    setError(undefined)
    setNotice(undefined)
    try {
      const saved = await saveUiScriptDoc(doc)
      onSaved({ site: saved.site, flow: saved.flow, version: saved.version })
    } catch (err) {
      setError(String((err as Error)?.message ?? err))
    } finally {
      setBusy(undefined)
    }
  }

  /**
   * 另存为新流程：基于当前 doc 复制一份到新的 site/flow（v1），不动原流程。
   *
   * 典型用法：录好一条流程后，仅「选择的类型/选项」不同——另存成新流程再改值回放，
   * 两个流程各自独立演进；若只是同一流程多组值，应该用入参槽位 `{{name}}`。
   */
  async function saveAsNewFlow(): Promise<void> {
    const site = (saveAsSite.trim() === '' ? doc.meta.site : saveAsSite.trim()).trim()
    const fallbackFlow = `${doc.meta.flow}-变体`
    const flow = (saveAsFlow.trim() === '' ? fallbackFlow : saveAsFlow.trim()).trim()
    if (site === '' || flow === '') {
      setError('新流程的站点名/流程名不能为空')
      return
    }
    if (site === doc.meta.site && flow === doc.meta.flow) {
      setError('新流程名与原流程相同：请换一个流程名，或直接用「保存为新版本」')
      return
    }
    setBusy('save-as')
    setError(undefined)
    setNotice(undefined)
    try {
      const variant: UiScriptDocLike = { ...doc, meta: { ...doc.meta, site, flow } }
      const saved = await saveUiScriptDoc(variant)
      onSaved({ site: saved.site, flow: saved.flow, version: saved.version })
    } catch (err) {
      setError(String((err as Error)?.message ?? err))
    } finally {
      setBusy(undefined)
    }
  }

  const editing = busy !== 'save'

  return (
    <div className="dsh-df-card">
      <div className="dsh-df-head">
        <h2>编辑脚本（当前 v{detail.version}，保存生成 v{detail.version + 1}）</h2>
        <span className="dsh-df-badge running">编辑中</span>
      </div>
      <p className="dsh-df-sub">
        改动只落在**新版本**上，旧版本保留；保存前服务端会完整校验（步骤字段/断言/入参引用）。
        点「从页面点选」需要浏览器会话已打开且未在录制。
      </p>
      <div className="dsh-df-field" style={{ marginTop: 8 }}>
        <label htmlFor="df-ui-edit-start">起点 URL</label>
        <input
          id="df-ui-edit-start"
          value={doc.meta.startUrl}
          onChange={(event) => setDoc({ ...doc, meta: { ...doc.meta, startUrl: event.target.value } })}
        />
      </div>

      {error !== undefined ? <div className="dsh-df-errline" role="alert">{error}</div> : null}
      {notice !== undefined ? <p className="dsh-df-kv">{notice}</p> : null}

      {doc.steps.map((step, index) => (
        <div
          key={`${step.id}-${index}`}
          className="dsh-df-inputs"
          style={{ marginTop: 10 }}
        >
          <div className="dsh-df-inputs-head">
            <span className="dsh-df-dname">#{index + 1} · {step.id}</span>
            <select
              className="dsh-df-select"
              value={step.kind}
              disabled={!editing}
              onChange={(event) => patchStep(index, changeKind(step, event.target.value))}
            >
              {STEP_KINDS.map((kind) => <option key={kind} value={kind}>{STEP_LABELS[kind] ?? kind}</option>)}
            </select>
            <button type="button" className="dsh-df-mini" disabled={!editing} onClick={() => moveStep(index, -1)}>↑</button>
            <button type="button" className="dsh-df-mini" disabled={!editing} onClick={() => moveStep(index, 1)}>↓</button>
            <button type="button" className="dsh-df-mini" disabled={!editing} onClick={() => insertWait(index)}>+ 等待</button>
            <button type="button" className="dsh-df-mini" disabled={!editing || doc.steps.length <= 1} onClick={() => deleteStep(index)}>删除</button>
          </div>
          <div className="dsh-df-inputs-body">
            <div className="dsh-df-inputs-row">
              {step.kind !== 'goto' && step.kind !== 'wait' && (
                <>
                  <input
                    style={{ flex: 1, minWidth: 220 }}
                    placeholder="selector（CSS / Playwright 选择器）"
                    value={step.selector ?? ''}
                    disabled={!editing}
                    onChange={(event) => patchStep(index, { selector: event.target.value })}
                  />
                  <button type="button" className="dsh-df-btn" disabled={!editing || busy !== undefined} onClick={() => { void pick(index) }}>
                    {busy === 'pick' ? '点选中…' : '从页面点选'}
                  </button>
                </>
              )}
              {step.kind === 'goto' && (
                <input
                  style={{ flex: 1, minWidth: 260 }}
                  placeholder="https://…"
                  value={step.url ?? ''}
                  disabled={!editing}
                  onChange={(event) => patchStep(index, { url: event.target.value })}
                />
              )}
              {step.kind === 'fill' && (
                <input
                  style={{ flex: 1, minWidth: 200 }}
                  placeholder="要填入的值（可含 {{input}}）"
                  value={step.value ?? ''}
                  disabled={!editing}
                  onChange={(event) => patchStep(index, { value: event.target.value })}
                />
              )}
              {step.kind === 'select' && (
                <input
                  style={{ flex: 1, minWidth: 180 }}
                  placeholder="选项 value"
                  value={step.value ?? ''}
                  disabled={!editing}
                  onChange={(event) => patchStep(index, { value: event.target.value })}
                />
              )}
              {step.kind === 'press' && (
                <input
                  style={{ minWidth: 140 }}
                  placeholder="Enter / Escape / Tab"
                  value={step.key ?? ''}
                  disabled={!editing}
                  onChange={(event) => patchStep(index, { key: event.target.value })}
                />
              )}
              {step.kind === 'wait' && (
                <input
                  style={{ minWidth: 120 }}
                  type="number"
                  placeholder="毫秒"
                  value={step.ms ?? 0}
                  disabled={!editing}
                  onChange={(event) => patchStep(index, { ms: Number(event.target.value) })}
                />
              )}
              {step.kind === 'upload' && (
                <input
                  style={{ flex: 1, minWidth: 260 }}
                  placeholder="文件路径，逗号分隔"
                  value={(step.files ?? []).join(', ')}
                  disabled={!editing}
                  onChange={(event) => patchStep(index, { files: event.target.value.split(',').map((item) => item.trim()).filter((item) => item !== '') })}
                />
              )}
            </div>
            {step.candidates !== undefined && step.candidates.length > 1 ? (
              <p className="dsh-df-kv">候选：{step.candidates.join(' ｜ ')}</p>
            ) : null}

            {(step.expect ?? []).map((expect, expectIndex) => (
              <div className="dsh-df-inputs-row" key={`${step.id}-expect-${expectIndex}`}>
                <select
                  className="dsh-df-select"
                  value={expect.kind}
                  disabled={!editing}
                  onChange={(event) => patchExpect(index, expectIndex, { kind: event.target.value, equals: undefined, contains: undefined })}
                >
                  {EXPECT_KINDS.map((kind) => <option key={kind} value={kind}>{EXPECT_LABELS[kind] ?? kind}</option>)}
                </select>
                {expect.kind !== 'url' && (
                  <>
                    <input
                      style={{ flex: 1, minWidth: 200 }}
                      placeholder="断言目标 selector"
                      value={expect.selector ?? ''}
                      disabled={!editing}
                      onChange={(event) => patchExpect(index, expectIndex, { selector: event.target.value })}
                    />
                    <button type="button" className="dsh-df-mini" disabled={!editing || busy !== undefined} onClick={() => { void pick(index, expectIndex) }}>
                      点选
                    </button>
                  </>
                )}
                {expect.kind !== 'visible' && expect.kind !== 'hidden' && (
                  <>
                    <input
                      style={{ minWidth: 130 }}
                      placeholder={expect.kind === 'count' ? '数量（数字）' : 'equals'}
                      value={expect.equals === undefined ? '' : String(expect.equals)}
                      disabled={!editing}
                      onChange={(event) => patchExpect(index, expectIndex, { equals: event.target.value === '' ? undefined : event.target.value })}
                    />
                    <input
                      style={{ minWidth: 130 }}
                      placeholder="contains（可选）"
                      value={expect.contains ?? ''}
                      disabled={!editing}
                      onChange={(event) => patchExpect(index, expectIndex, { contains: event.target.value === '' ? undefined : event.target.value })}
                    />
                  </>
                )}
                <button type="button" className="dsh-df-mini" disabled={!editing} onClick={() => deleteExpect(index, expectIndex)}>删断言</button>
              </div>
            ))}
            <div className="dsh-df-inputs-row">
              <button type="button" className="dsh-df-mini" disabled={!editing} onClick={() => addExpect(index)}>＋ 断言</button>
            </div>
          </div>
        </div>
      ))}

      <div className="dsh-df-inputs-row" style={{ marginTop: 12 }}>
        <select
          className="dsh-df-select"
          defaultValue="click"
          onChange={(event) => addStep(event.target.value)}
          disabled={!editing}
        >
          <option value="" disabled>＋ 添加步骤…</option>
          {STEP_KINDS.map((kind) => <option key={kind} value={kind}>{STEP_LABELS[kind] ?? kind}</option>)}
        </select>
        <span className="dsh-df-sub">共 {doc.steps.length} 步</span>
      </div>

      <div className="dsh-df-inputs-row" style={{ marginTop: 12 }}>
        <button type="button" className="dsh-df-btn-primary" onClick={() => { void save() }} disabled={busy !== undefined}>
          {busy === 'save' ? '保存中…' : '保存为新版本'}
        </button>
        <button type="button" className="dsh-df-btn" onClick={() => setSaveAsOpen(!saveAsOpen)} disabled={busy !== undefined}>
          另存为新流程
        </button>
        <button type="button" className="dsh-df-btn-ghost" onClick={onClose} disabled={busy === 'save'}>取消</button>
      </div>

      {saveAsOpen ? (
        <div className="dsh-df-inputs" style={{ marginTop: 10 }}>
          <div className="dsh-df-inputs-head">
            <span className="dsh-df-dname">另存为新流程（复制当前步骤到新的站点/流程，v1）</span>
          </div>
          <div className="dsh-df-inputs-body">
            <p className="dsh-df-sub">
              用于「同一套操作、只改选择类型/选项」的变体：另存后改值、保存，原流程不受影响。
              如果只是同一流程换几组值，更推荐用入参槽位 <code>{'{{name}}'}</code>。
            </p>
            <div className="dsh-df-row2">
              <div className="dsh-df-field">
                <label htmlFor="df-ui-saveas-site">站点名</label>
                <input
                  id="df-ui-saveas-site"
                  value={saveAsSite === '' ? doc.meta.site : saveAsSite}
                  onChange={(event) => setSaveAsSite(event.target.value)}
                />
              </div>
              <div className="dsh-df-field">
                <label htmlFor="df-ui-saveas-flow">新流程名</label>
                <input
                  id="df-ui-saveas-flow"
                  placeholder={`${doc.meta.flow}-变体`}
                  value={saveAsFlow}
                  onChange={(event) => setSaveAsFlow(event.target.value)}
                />
              </div>
            </div>
            <div className="dsh-df-inputs-row">
              <button type="button" className="dsh-df-btn-primary" onClick={() => { void saveAsNewFlow() }} disabled={busy !== undefined}>
                {busy === 'save-as' ? '另存中…' : '保存到新流程'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
