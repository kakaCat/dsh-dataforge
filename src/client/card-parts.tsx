/**
 * 卡片详情渲染件（React 版）：采集页 / 接口库共用（模板字段表 / 鉴权 / 关联页面 / 形态清单 / 图例）。
 *
 * 呈现纪律：用户数据只进 JSX 文本节点（天然转义，零 dangerouslySetInnerHTML）；
 * unverified 字段照实标注（面板不替样本背书）；形态清单只在有真关系行时画出。
 *
 * @module dsh-dataforge/client/card-parts
 */
import type { ReactNode } from 'react'
import {
  AUTH_TYPE_LABELS, LOCATION_LABELS, RELATED_PAGES_DISPLAY_CAP,
  methodClass, pagerWindow, shortSample,
} from './dom.js'
import { shapeEntries, uniquePageUrls } from './grouping.js'
import type { CardRow, RelationRow, Template } from './types.js'

export function MethodBadge({ method }: { method: string }): ReactNode {
  return <span className={`dsh-df-method ${methodClass(method)}`}>{method}</span>
}

export function TemplateBlock({ title, template }: { title: string; template?: Template }): ReactNode {
  const hasFields = template !== undefined && template.fields.length > 0
  return (
    <div className="dsh-df-sec">
      <h3>
        {title}
        {template?.codePath !== undefined && <small>{template.codePath}</small>}
      </h3>
      {!hasFields && <div className="dsh-df-kv">暂无</div>}
      {hasFields && (
        <>
          {template?.pathParams !== undefined && template.pathParams.length > 0 && (
            <div className="dsh-df-kv">
              路径参数：
              {template.pathParams.map((param) => (
                <span className="dsh-df-fp" key={param}>{`{${param}}`}</span>
              ))}
            </div>
          )}
          <table className="dsh-df-fields">
            <thead>
              <tr><th>字段</th><th>位置</th><th>类型</th><th>示例</th><th>备注</th></tr>
            </thead>
            <tbody>
              {template?.fields.map((field) => (
                <tr key={`${field.field}-${field.location ?? 'legacy'}`}>
                  <td className="dsh-df-mono">{field.field}</td>
                  <td>{field.location === undefined ? '—' : LOCATION_LABELS[field.location] ?? field.location}</td>
                  <td>{field.type}</td>
                  <td className="dsh-df-mono">{shortSample(field.sample)}</td>
                  <td>
                    {field.role}
                    {field.unverified && <sup className="dsh-df-tag-unverified">样本未验证</sup>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}

export function AuthBlock({ card }: { card: CardRow }): ReactNode {
  return (
    <div className="dsh-df-sec">
      <h3>鉴权</h3>
      {card.authType === undefined ? (
        <div className="dsh-df-kv">未探测到鉴权特征</div>
      ) : (
        <>
          <div className="dsh-df-kv">类型 <b>{AUTH_TYPE_LABELS[card.authType] ?? card.authType}</b></div>
          {card.authEvidence !== undefined && <div className="dsh-df-kv">证据 <b>{card.authEvidence}</b></div>}
          {card.authBinding !== undefined && (
            <div className="dsh-df-kv">
              会话 <b>{`cookies ${card.authBinding.cookies} · storageKeys ${card.authBinding.storageKeys}`}</b>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function RelatedPagesBlock({ card }: { card: CardRow }): ReactNode {
  // 按页面身份去重：同一 SPA 页面的 hash/反缓存戳变体在「关联页面」里只算一条
  const pages = uniquePageUrls(card.relatedPageUrls)
  return (
    <div className="dsh-df-sec">
      <h3>关联页面 <small>{pages.length}</small></h3>
      {pages.length === 0 ? (
        <div className="dsh-df-kv">无</div>
      ) : (
        <>
          <div className="dsh-df-list">
            {pages.slice(0, RELATED_PAGES_DISPLAY_CAP).map((url) => (
              <div className="dsh-df-mono" key={url}>{url}</div>
            ))}
          </div>
          {pages.length > RELATED_PAGES_DISPLAY_CAP && (
            <div className="dsh-df-kv">
              {`…共 ${pages.length} 条，仅展示前 ${RELATED_PAGES_DISPLAY_CAP} 条`}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** 形态清单：只在 run 带真关系行时渲染（面板不谎造形态数）。 */
export function ShapesBlock({ relations }: { relations: RelationRow[] }): ReactNode {
  return (
    <div className="dsh-df-sec">
      <h3>形态 <small>{relations.length === 0 ? '无关系行' : shapeEntries(relations).length}</small></h3>
      {relations.length === 0 ? (
        <div className="dsh-df-kv">本运行没有入参关系行（历史数据）；不同指纹即不同形态（比如物料单不同）。</div>
      ) : (
        <ul className="dsh-df-shape-list">
          {shapeEntries(relations).map((entry) => (
            <li className="dsh-df-shape" key={entry.fp}>
              <span className="dsh-df-fp">{entry.fp}</span>
              <span className="dsh-df-kv"><b>{entry.samples}</b> 样本</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * 分页条（接口列表 / 页面列表共用）：页码窗口 + 上一页/下一页，`label` 给「第 x–y / 共 N」说明。
 * 只有一页时仍渲染 label（数量信息有用），按钮组只在多页时出现。
 */
export function PagerBar({ page, totalPages, label, onGoto, ariaLabel = '分页' }: {
  page: number
  totalPages: number
  label?: string
  onGoto: (page: number) => void
  ariaLabel?: string
}): ReactNode {
  return (
    <div className="dsh-df-pagerbar">
      {label !== undefined && <span>{label}</span>}
      {totalPages > 1 && (
        <span className="dsh-df-pages" role="group" aria-label={ariaLabel}>
          <button
            className="dsh-df-pg"
            type="button"
            disabled={page <= 0}
            aria-label="上一页"
            onClick={() => { onGoto(page - 1) }}
          >
            ‹
          </button>
          {pagerWindow(page, totalPages).map((item, index) => (
            item === '…'
              ? <span className="dsh-df-pg-gap" key={`gap-${index}`}>…</span>
              : (
                <button
                  className="dsh-df-pg"
                  key={item}
                  type="button"
                  aria-current={item === page}
                  onClick={() => { onGoto(item) }}
                >
                  {item + 1}
                </button>
              )
          ))}
          <button
            className="dsh-df-pg"
            type="button"
            disabled={page >= totalPages - 1}
            aria-label="下一页"
            onClick={() => { onGoto(page + 1) }}
          >
            ›
          </button>
        </span>
      )}
    </div>
  )
}

export type LegendEntry = { level: 1 | 2 | 3; label: string }

export function Legend({ entries }: { entries: ReadonlyArray<LegendEntry> }): ReactNode {
  return (
    <aside className="dsh-df-legend">
      {entries.map((entry) => (
        <span className="dsh-df-kv" key={entry.label}>
          <span className={`dsh-df-lv dsh-df-lv${entry.level}`}>{entry.level}</span>
          {entry.label}
        </span>
      ))}
    </aside>
  )
}
