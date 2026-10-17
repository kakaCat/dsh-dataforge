/**
 * 编排画布（@xyflow/react / React Flow v12）。
 *
 * 与原型 `docs/prototypes/orchestration.html` 的差异是**有意的**，且只差一处：
 * 原型把节点的「名称 / 方法 / 地址」做成可编辑输入框，但那些字段属于**接口卡**
 * （`library/cards/*.yaml`），不属于链。链里只存 cardId——把方法/地址复制进链文件会立刻
 * 出现两处事实源，改卡之后链就骗人。所以这里：卡派生的三项**只读展示**，
 * 真正可编辑的是链自己拥有的东西（`constants` 绑定、`page` 地址、节点 retry/timeout、坐标）。
 *
 * 边的标签同理：链的边是**字段绑定**（`from` → `to`），不是自由文本。标签取 from 的叶子名
 * （`body.orderNo` → orderNo），编辑边就是编辑这两个绑定路径。
 *
 * @module dsh-dataforge/client/orchestration-canvas
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import {
  ReactFlow, Background, Controls, MiniMap, Panel, Handle, Position, MarkerType,
  applyEdgeChanges, applyNodeChanges, addEdge,
  type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type NodeProps,
} from '@xyflow/react'
import { XYFLOW_CSS } from './xyflow-css.js'
import { XYFLOW_STYLE_ID, injectCssOnce } from './styles.js'
import type {
  CanvasEdge, CanvasNode, CardProjection, ChainDocLike, ChainGraph, ChainInputSlot, ChainSaveResult,
} from './types.js'

/** 画布节点 data：label/url/method 是**展示投影**（来自卡或 page），constants 才是可编辑的链数据。 */
type CanvasNodeData = {
  label: string
  url?: string
  method?: string
  desc?: string
  /** 链节点原始字段（保存时原样带回，不做语义解释）。 */
  card?: string
  page?: string
  constants: Record<string, string>
  retry?: number
  timeoutSeconds?: number
}

type FlowNode = Node<CanvasNodeData, 'page' | 'api' | 'pill'>
type FlowEdge = Edge

const NODE_WIDTH = 210
const LEVEL_GAP = 300
const LANE_GAP = 150

/* ──────────────────────────── 自定义节点 ──────────────────────────── */

function PageNode({ data, selected }: NodeProps<Node<CanvasNodeData>>): ReactNode {
  return (
    <div className={`dsh-df-rf-node dsh-df-rf-page${selected === true ? ' dsh-df-rf-selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="dsh-df-rf-t">
        <span className="dsh-df-lv dsh-df-lv-2">页面</span>
        <span>{data.label}</span>
      </div>
      {data.url === undefined ? null : <div className="dsh-df-rf-u">{data.url}</div>}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function ApiNode({ data, selected }: NodeProps<Node<CanvasNodeData>>): ReactNode {
  const method = data.method ?? ''
  return (
    <div className={`dsh-df-rf-node dsh-df-rf-api${selected === true ? ' dsh-df-rf-selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="dsh-df-rf-t">
        <span className={`dsh-df-method ${method === 'GET' ? 'GET' : method === 'POST' ? 'POST' : 'dsh-df-method-other'}`}>
          {method || '—'}
        </span>
        <span>{data.label}</span>
      </div>
      {data.url === undefined ? null : <div className="dsh-df-rf-u">{data.url}</div>}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function PillNode({ data }: NodeProps<Node<CanvasNodeData>>): ReactNode {
  return (
    <div className="dsh-df-rf-pill">
      <Handle type="target" position={Position.Left} />
      {data.label}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

const NODE_TYPES = { page: PageNode, api: ApiNode, pill: PillNode }

/* ──────────────────────────── 布局与投影 ──────────────────────────── */

/** 边的标签 = from 的叶子字段名（`body.orderNo` → orderNo）。 */
export function edgeLabelOf(from: string): string {
  const dot = from.lastIndexOf('.')
  const leaf = dot >= 0 ? from.slice(dot + 1) : from
  return leaf.replace(/\[\*?\]$/, '') || from
}

/**
 * 缺坐标时的自动布局：按**最长上游层级**分列（同层同列，纵向错开）。
 *
 * 为什么不用随机或 0,0：agent 手写的链没有坐标，全叠在原点等于画布不可用；
 * 而按拓扑分层至少能一眼看出依赖方向（这是画布的主要用途）。
 */
export function autoLayout(nodes: CanvasNode[], edges: CanvasEdge[]): Record<string, { x: number; y: number }> {
  const level = new Map<string, number>()
  for (const node of nodes) level.set(node.id, 0)
  // 松弛迭代（节点数很小；有环也不会死循环——上限封住）
  for (let round = 0; round < nodes.length; round += 1) {
    let changed = false
    for (const edge of edges) {
      const sourceId = edge.from.split('.')[0] ?? ''
      const targetId = edge.to?.split('.')[0] ?? ''
      const from = level.get(sourceId)
      const to = level.get(targetId)
      if (from === undefined || to === undefined) continue
      if (to <= from) {
        level.set(targetId, from + 1)
        changed = true
      }
    }
    if (!changed) break
  }
  const perLevel = new Map<number, number>()
  const layout: Record<string, { x: number; y: number }> = {}
  for (const node of nodes) {
    const lv = level.get(node.id) ?? 0
    const lane = perLevel.get(lv) ?? 0
    perLevel.set(lv, lane + 1)
    layout[node.id] = { x: lv * LEVEL_GAP, y: lane * LANE_GAP }
  }
  return layout
}

/** 链节点 → 画布节点（坐标缺省走自动布局）。 */
export function projectNodes(graph: ChainGraph): FlowNode[] {
  const auto = autoLayout(graph.doc.nodes, graph.doc.edges)
  return graph.doc.nodes.map((node) => {
    const card = node.card === undefined ? undefined : graph.cards[node.card]
    const isPage = node.page !== undefined
    const label = isPage
      ? `页面 ${pageTail(node.page ?? '')}`
      : card?.name ?? node.card ?? node.id
    const data: CanvasNodeData = {
      label,
      ...(isPage ? { url: node.page ?? '' } : {}),
      ...(card === undefined ? {} : { url: card.urlTemplate, method: card.method }),
      constants: node.constants,
      ...(node.card === undefined ? {} : { card: node.card }),
      ...(node.page === undefined ? {} : { page: node.page }),
    }
    const position = node.layout ?? auto[node.id] ?? { x: 0, y: 0 }
    return {
      id: node.id,
      type: isPage ? 'page' : 'api',
      position: { x: position.x, y: position.y },
      data,
    }
  })
}

function pageTail(page: string): string {
  const trimmed = page.replace(/\/+$/, '')
  const tail = trimmed.slice(trimmed.lastIndexOf('/') + 1)
  return tail.length > 0 ? tail : page
}

/** 链边 → 画布边（绑定路径的叶子名当标签）。 */
export function projectEdges(doc: ChainDocLike): FlowEdge[] {
  return doc.edges.map((edge, index) => ({
    id: `e${index}`,
    source: edge.from.split('.')[0] ?? edge.from,
    target: edge.to.split('.')[0] ?? edge.to,
    label: edgeLabelOf(edge.from),
    sourceHandle: null,
    targetHandle: null,
    animated: true,
    markerEnd: { type: MarkerType.ArrowClosed },
    // 绑定路径原样存在 data 上：画布只改节点的源/靶，保存时仍写回完整路径。
    data: { from: edge.from, to: edge.to },
  }))
}

/* ──────────────────────────── 画布组件 ──────────────────────────── */

export interface OrchestrationCanvasProps {
  graph: ChainGraph
  /** 保存结果回到页面层（成功刷版本号，失败展示 issues）。 */
  onSave: (doc: ChainDocLike) => Promise<ChainSaveResult>
}

export function OrchestrationCanvas({ graph, onSave }: OrchestrationCanvasProps): ReactNode {
  injectCssOnce(XYFLOW_STYLE_ID, XYFLOW_CSS)

  const [nodes, setNodes] = useState<FlowNode[]>(() => projectNodes(graph))
  const [edges, setEdges] = useState<FlowEdge[]>(() => projectEdges(graph.doc))
  const [inputs, setInputs] = useState<ChainInputSlot[]>(() => graph.doc.inputs.map((slot) => ({ ...slot })))
  const [inputsOpen, setInputsOpen] = useState(false)
  const [selNodeId, setSelNodeId] = useState<string | undefined>()
  const [selEdgeId, setSelEdgeId] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | undefined>()

  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current))
  }, [])
  const onEdgesChange = useCallback((changes: EdgeChange<FlowEdge>[]) => {
    setEdges((current) => applyEdgeChanges(changes, current))
  }, [])
  const onConnect = useCallback((connection: Connection) => {
    setEdges((current) => addEdge({ ...connection, id: `e-new-${Date.now()}`, animated: true, markerEnd: { type: MarkerType.ArrowClosed } }, current))
  }, [])

  const selNode = nodes.find((node) => node.id === selNodeId)
  const selEdge = edges.find((edge) => edge.id === selEdgeId)

  /** 画布状态 → 链文档（只改画布拥有的字段，其余原样带回）。 */
  const toDoc = useCallback((): ChainDocLike => {
    const nextNodes: CanvasNode[] = nodes.map((node) => {
      const base: CanvasNode = {
        id: node.id,
        ...(node.data.card === undefined ? {} : { card: node.data.card }),
        ...(node.data.page === undefined ? {} : { page: node.data.page }),
        constants: node.data.constants,
        ...(node.data.retry === undefined ? {} : { retry: node.data.retry }),
        ...(node.data.timeoutSeconds === undefined ? {} : { timeoutSeconds: node.data.timeoutSeconds }),
        layout: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
      }
      return base
    })
    const nextEdges: CanvasEdge[] = edges.map((edge) => ({
      from: String(edge.data?.from ?? edge.source),
      to: String(edge.data?.to ?? edge.target),
    }))
    return { ...graph.doc, inputs, nodes: nextNodes, edges: nextEdges }
  }, [edges, graph.doc, inputs, nodes])

  const save = useCallback(() => {
    setBusy(true)
    setNotice(undefined)
    void onSave(toDoc())
      .then((result) => {
        if (result.ok) {
          setNotice(`已保存为 v${result.version ?? '?'}（旧版本仍可回读）`)
        } else {
          const lines = (result.issues ?? []).map((issue) => `${issue.target}：${issue.reason}`)
          setNotice(`校验不过，未落盘：\n${lines.join('\n')}`)
        }
      })
      .catch((error: unknown) => {
        setNotice(`保存失败：${error instanceof Error ? error.message : String(error)}`)
      })
      .finally(() => { setBusy(false) })
  }, [onSave, toDoc])

  const addNode = useCallback((type: 'page' | 'api') => {
    const id = `${type}-${Date.now()}`
    setNodes((current) => [
      ...current,
      {
        id,
        type,
        position: { x: 80, y: 80 + current.length * 24 },
        data: {
          label: type === 'page' ? '新页面' : '新接口（需补 card）',
          constants: {},
          ...(type === 'page' ? { page: '/new-page' } : {}),
        },
      },
    ])
    setSelNodeId(id)
  }, [])

  const updateNodeData = useCallback((patch: Partial<CanvasNodeData>) => {
    if (selNodeId === undefined) return
    setNodes((current) => current.map((node) => (
      node.id === selNodeId ? { ...node, data: { ...node.data, ...patch } } : node
    )))
  }, [selNodeId])

  const updateEdgeBinding = useCallback((side: 'from' | 'to', value: string) => {
    if (selEdgeId === undefined) return
    setEdges((current) => current.map((edge) => {
      if (edge.id !== selEdgeId) return edge
      const nextSource = side === 'from' ? value.split('.')[0] ?? edge.source : edge.source
      const nextTarget = side === 'to' ? value.split('.')[0] ?? edge.target : edge.target
      return {
        ...edge,
        source: nextSource,
        target: nextTarget,
        label: side === 'from' ? edgeLabelOf(value) : edge.label,
        data: { ...(edge.data ?? {}), [side]: value },
      }
    }))
  }, [selEdgeId])

  const deleteSelection = useCallback(() => {
    if (selNodeId !== undefined) {
      setNodes((current) => current.filter((node) => node.id !== selNodeId))
      setEdges((current) => current.filter((edge) => edge.source !== selNodeId && edge.target !== selNodeId))
      setSelNodeId(undefined)
    } else if (selEdgeId !== undefined) {
      setEdges((current) => current.filter((edge) => edge.id !== selEdgeId))
      setSelEdgeId(undefined)
    }
  }, [selEdgeId, selNodeId])

  const legend = useMemo(
    () => `${graph.kind === 'page-chain' ? '页面编排' : '接口编排'} · v${graph.version} · ${nodes.length} 节点 ${edges.length} 边`,
    [edges.length, graph.kind, graph.version, nodes.length],
  )

  return (
    <div className="dsh-df-canvas-wrap">
      <div className="dsh-df-canvas-head">
        <span className="dsh-df-canvas-name">{graph.flow}</span>
        <span className="dsh-df-canvas-meta">{legend}</span>
        <div className="dsh-df-canvas-ops">
          <button
            type="button"
            className="dsh-df-btn"
            disabled={graph.chainYaml.length === 0}
            title={graph.chainYaml.length === 0 ? '草稿尚未落盘，没有可导出的 YAML' : '导出当前版本原文'}
            onClick={() => { downloadText(`${graph.site}-${graph.flow}-v${graph.version}.yaml`, graph.chainYaml) }}
          >
            导出 YAML
          </button>
          <button type="button" className="dsh-df-btn-primary" disabled={busy} onClick={save}>
            {busy ? '保存中…' : '保存为新版本'}
          </button>
        </div>
      </div>
      {notice === undefined ? null : <div className="dsh-df-canvas-notice">{notice}</div>}
      <div className="dsh-df-inputs">
        <button type="button" className="dsh-df-inputs-head" onClick={() => { setInputsOpen(!inputsOpen) }}>
          <span className="dsh-df-lv dsh-df-lv-1">链级入参</span>
          <span className="dsh-df-dname">{inputs.length} 个槽位（$inputs.&lt;name&gt;）</span>
          <span className="dsh-df-caret">{inputsOpen ? '▼' : '▶'}</span>
        </button>
        {inputsOpen ? (
          <div className="dsh-df-inputs-body">
            {inputs.map((slot, index) => (
              <div key={`${slot.name}-${index}`} className="dsh-df-inputs-row">
                <input
                  placeholder="槽位名 materialCodes"
                  value={slot.name}
                  onChange={(event) => { patchSlot(setInputs, index, { name: event.target.value }) }}
                />
                <select
                  value={slot.type}
                  onChange={(event) => { patchSlot(setInputs, index, { type: event.target.value }) }}
                >
                  {INPUT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
                <label className="dsh-df-inputs-req">
                  <input
                    type="checkbox"
                    checked={slot.required}
                    onChange={(event) => { patchSlot(setInputs, index, { required: event.target.checked }) }}
                  />
                  必填
                </label>
                <input
                  placeholder="示例值（可选）"
                  value={slot.example ?? ''}
                  onChange={(event) => { patchSlot(setInputs, index, { example: event.target.value === '' ? undefined : event.target.value }) }}
                />
                <button type="button" className="dsh-df-btn" onClick={() => { setInputs((current) => current.filter((_item, i) => i !== index)) }}>
                  删除
                </button>
              </div>
            ))}
            <div className="dsh-df-inputs-row">
              <button
                type="button"
                className="dsh-df-btn"
                onClick={() => { setInputs((current) => [...current, { name: `slot${current.length + 1}`, type: 'string', required: false }]) }}
              >
                + 新增槽位
              </button>
              <span className="dsh-df-rf-hint">
                槽位必须被常量或边引用（$inputs.名），否则保存时按 R-1 的僵尸槽位规则拒绝。
              </span>
            </div>
          </div>
        ) : null}
      </div>
      <div className="dsh-df-flow-wrap">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_event, node) => { setSelNodeId(node.id); setSelEdgeId(undefined) }}
          onEdgeClick={(_event, edge) => { setSelEdgeId(edge.id); setSelNodeId(undefined) }}
          onPaneClick={() => { setSelNodeId(undefined); setSelEdgeId(undefined) }}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls />
          <MiniMap pannable zoomable />
          <Panel position="top-left">
            <div className="dsh-df-rf-toolbar">
              <button type="button" onClick={() => { addNode('page') }}>+ 页面节点</button>
              <button type="button" onClick={() => { addNode('api') }}>+ 接口节点</button>
              <button type="button" onClick={deleteSelection}>删除选中</button>
              <span className="dsh-df-rf-hint">拖圆点连线 · 点节点/边编辑</span>
            </div>
          </Panel>
          {selNode === undefined ? null : (
            <Panel position="top-right">
              <NodeEditor node={selNode} onChange={updateNodeData} onClose={() => { setSelNodeId(undefined) }} />
            </Panel>
          )}
          {selEdge === undefined ? null : (
            <Panel position="top-right">
              <EdgeEditor
                from={String(selEdge.data?.from ?? selEdge.source)}
                to={String(selEdge.data?.to ?? selEdge.target)}
                sourceCard={cardsOfNode(nodes, graph, selEdge.source)}
                targetCard={cardsOfNode(nodes, graph, selEdge.target)}
                onChange={updateEdgeBinding}
                onClose={() => { setSelEdgeId(undefined) }}
              />
            </Panel>
          )}
        </ReactFlow>
      </div>
      <p className="dsh-df-canvas-hint">
        画布只编辑链自己拥有的字段：常量绑定、页面地址、节点重试/超时与坐标。
        节点的「名称 / 方法 / 地址」来自被引用的接口卡（唯一事实源），改卡请去接口库。
      </p>
    </div>
  )
}

/**
 * 下载文本文件（导出版本原文用）。
 *
 * 链文件天然零凭证（只存 cardId、字段路径、常量），所以导出即原文，不需要脱敏。
 */
function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/yaml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename.replace(/[\\/:*?"<>|]/g, '-')
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/** 取某节点引用卡的投影（没有卡 / 卡不在库 → undefined，编辑面板退回手写）。 */
function cardsOfNode(nodes: FlowNode[], graph: ChainGraph, nodeId: string): CardProjection | undefined {
  const node = nodes.find((item) => item.id === nodeId)
  const cardId = node?.data.card
  return cardId === undefined ? undefined : graph.cards[cardId]
}

/** 改一个槽位字段（name/type/required/example）。 */
function patchSlot(
  setInputs: (updater: (current: ChainInputSlot[]) => ChainInputSlot[]) => void,
  index: number,
  patch: Partial<ChainInputSlot>,
): void {
  setInputs((current) => current.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)))
}

/** 槽位类型词表（与 R-1 CHAIN_VALUE_TYPES 同源；这里只列画布提供的选项）。 */
const INPUT_TYPES = [
  'string', 'number', 'boolean', 'object', 'array',
  'array<string>', 'array<number>', 'array<boolean>', 'array<object>',
] as const

/* ──────────────────────────── 编辑面板 ──────────────────────────── */

function NodeEditor(props: {
  node: FlowNode
  onChange: (patch: Partial<CanvasNodeData>) => void
  onClose: () => void
}): ReactNode {
  const { node, onChange, onClose } = props
  const constants = node.data.constants ?? {}
  return (
    <div className="dsh-df-rf-panel">
      <h3>
        <span>节点 {node.id}</span>
        <button type="button" className="dsh-df-rf-close" onClick={onClose}>✕</button>
      </h3>
      <label>名称（来自卡 / 页面，只读）</label>
      <input value={node.data.label} readOnly />
      {node.data.url === undefined ? null : (
        <>
          <label>地址（只读）</label>
          <input value={node.data.url} readOnly />
        </>
      )}
      {node.type === 'api' ? (
        <>
          <label>接口卡 ID（链里只存 cardId，方法/地址由卡解析）</label>
          <input
            value={node.data.card ?? ''}
            placeholder="card_000123"
            onChange={(event) => {
              const value = event.target.value.trim()
              onChange(value === '' ? { card: undefined, label: node.id } : { card: value, label: value })
            }}
          />
        </>
      ) : null}
      {node.data.page === undefined ? null : (
        <>
          <label>页面路径（可改）</label>
          <input
            value={node.data.page}
            onChange={(event) => { onChange({ page: event.target.value }) }}
          />
        </>
      )}
      <label>常量绑定（每行 `字段路径 = 值`，值可写 $inputs.槽位）</label>
      <textarea
        rows={4}
        value={Object.entries(constants).map(([key, value]) => `${key} = ${value}`).join('\n')}
        onChange={(event) => {
          const next: Record<string, string> = {}
          for (const line of event.target.value.split('\n')) {
            const trimmed = line.trim()
            if (trimmed.length === 0) continue
            const eq = trimmed.indexOf('=')
            if (eq <= 0) continue
            next[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
          }
          onChange({ constants: next })
        }}
      />
      <div className="dsh-df-rf-row">
        <div>
          <label>重试次数</label>
          <input
            type="number"
            min={0}
            value={node.data.retry ?? ''}
            onChange={(event) => {
              const raw = event.target.value
              onChange(raw === '' ? { retry: undefined } : { retry: Number(raw) })
            }}
          />
        </div>
        <div>
          <label>超时（秒）</label>
          <input
            type="number"
            min={0}
            value={node.data.timeoutSeconds ?? ''}
            onChange={(event) => {
              const raw = event.target.value
              onChange(raw === '' ? { timeoutSeconds: undefined } : { timeoutSeconds: Number(raw) })
            }}
          />
        </div>
      </div>
    </div>
  )
}

/**
 * 连线属性 = 「下游入参字段 ← 上游出参字段」（FR-2.3）。
 *
 * 两侧有卡模板就给**下拉**（候选来自卡的 inputs/outputs，选完拼成 `<节点id>.<字段路径>`）；
 * 没有卡模板（页面编排的 page 节点、或卡不在库里）就退回文本框——不假装有模板。
 */
function EdgeEditor(props: {
  from: string
  to: string
  sourceCard?: CardProjection
  targetCard?: CardProjection
  onChange: (side: 'from' | 'to', value: string) => void
  onClose: () => void
}): ReactNode {
  const { from, to, sourceCard, targetCard, onChange, onClose } = props
  const sourceNode = from.split('.')[0] ?? ''
  const targetNode = to.split('.')[0] ?? ''
  const fromPath = from.slice(sourceNode.length + 1)
  const toPath = to.slice(targetNode.length + 1)

  return (
    <div className="dsh-df-rf-panel">
      <h3>
        <span>依赖绑定</span>
        <button type="button" className="dsh-df-rf-close" onClick={onClose}>✕</button>
      </h3>

      <label>上游：{sourceNode} 的出参</label>
      {sourceCard === undefined || sourceCard.outputs.length === 0 ? (
        <input value={from} onChange={(event) => { onChange('from', event.target.value) }} />
      ) : (
        <select
          value={fromPath}
          onChange={(event) => { onChange('from', `${sourceNode}.${event.target.value}`) }}
        >
          <option value="">（选择出参字段）</option>
          {sourceCard.outputs.map((field) => (
            <option key={field.path} value={field.path}>{field.path} · {field.type}</option>
          ))}
        </select>
      )}

      <label>下游：{targetNode} 的入参</label>
      {targetCard === undefined || targetCard.inputs.length === 0 ? (
        <input value={to} onChange={(event) => { onChange('to', event.target.value) }} />
      ) : (
        <select
          value={toPath}
          onChange={(event) => { onChange('to', `${targetNode}.${event.target.value}`) }}
        >
          <option value="">（选择入参字段）</option>
          {targetCard.inputs.map((field) => (
            <option key={field.path} value={field.path}>
              {field.path} · {field.type}{field.required === true ? ' · 必填' : ''}
            </option>
          ))}
        </select>
      )}

      <p className="dsh-df-rf-hint">
        {sourceCard === undefined || targetCard === undefined
          ? '有一侧节点没有卡模板（页面节点或卡不在库），只能手写路径。'
          : '候选来自两侧卡的字段表；边标签取上游字段的叶子名。'}
      </p>
    </div>
  )
}
