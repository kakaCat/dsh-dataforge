/**
 * 项目接口库（Project Interface Library）的文件形态。
 *
 * 这里刻意只用 `type` 别名：与 `shared/capture-types.ts` 同一理由（工具 output.schema
 * 推断要求 Record 兼容，interface 会被"缺隐式索引签名"卡死，勿改回 interface）。
 *
 * 不变量（R-1 决策 Q3 + 安全红线）：
 *   - `cardId` 序号式、项目内唯一、分配后不复用——链靠它稳定引用，重新采集不会换绑；
 *   - 卡文件**不含任何凭证值**：凭证只投影成 `auth` 标志与 `authEvidence` 来源名
 *     （形如 `header:cookie:JSESSIONID`，是名字不是值），`sources` 只记采集 run 与页面；
 *   - 卡文件**不冻结任何字段样本值**：入参/出参只留路径与类型。值要么来自用户入参，
 *     要么来自链上 `constants`，要么由上游绑定边生成——这是 R-6 铁律在库层的落点。
 *
 * @module dsh-dataforge/library/types
 */

import type { AuthType, FieldRole } from '../shared/capture-types.js'

/** 卡文件里的字段类型：采集期的 `null`（样本为空/未取到）折成 `string`，不留无意义类型。 */
export type LibraryFieldType = 'string' | 'number' | 'boolean' | 'object' | 'array'

/** 凭证角色字段不入卡：鉴权由 `auth` 标志 + R-4 的注入通道承担。 */
export type LibraryFieldRole = Exclude<FieldRole, 'credential'>

/** 入参字段模板（从采集卡请求模板投影）。 */
export type LibraryInput = {
  /** 点路径，首段是位置：`query.q` / `body.lines[*].materialId` / `header.content-type`。 */
  path: string
  type: LibraryFieldType
  /** 真入参（多形态下值变化过）→ true；常量/单形态未验证 → false。 */
  required: boolean
  role: LibraryFieldRole
  /** 只在为 true 时出现：单样本或值从未变化过，模板尚未被验证。 */
  unverified?: boolean
}

/** 出参字段模板（从采集卡响应模板投影）。 */
export type LibraryOutput = {
  path: string
  type: LibraryFieldType
}

/** 来源溯源：一张卡可以来自多次采集（跨 run 归并），每次导入累积一条。 */
export type LibrarySource = {
  captureId: string
  /** 触发过这张卡的页面 URL（去重）。 */
  pages: string[]
  /** 采集期关系行 ID（`page_card_relations.id`），legacy 行照常带入。 */
  relationIds: string[]
}

/** 一张接口卡 = 一个卡文件 `cards/<cardId>.yaml`。 */
export type LibraryCard = {
  cardId: string
  kind: 'interface-card'
  /** 采集期语义名（`semanticName`），人读用；缺省则省略该键。 */
  name?: string
  identity: {
    /** 采集期归并键原样保留：同键即同卡。 */
    mergeKey: string
    method: string
    urlTemplate: string
  }
  inputs: LibraryInput[]
  outputs: LibraryOutput[]
  /** 一期 `authType` 原样投影；无鉴权/未判定就是 `none` / `unknown`。 */
  auth: AuthType
  /** 鉴权来源**名**（如 `header:cookie:JSESSIONID`），永不含凭证值。 */
  authEvidence?: string
  sources: LibrarySource[]
  /** 归并冲突记录（字段类型/角色冲突、鉴权标志冲突），人读中文。 */
  notice?: string[]
}

/** 卡文件草稿：cardId 由库分配，采集侧投影不出来。 */
export type LibraryCardDraft = Omit<LibraryCard, 'cardId'>

/** 索引条目：cardId → 文件指针 + 归并键 + 站点，避免每次导入都翻全部卡文件。 */
export type LibraryIndexEntry = {
  cardId: string
  /** 相对库根的路径，固定形状 `cards/<cardId>.yaml`。 */
  file: string
  mergeKey: string
  method: string
  urlTemplate: string
  /** 站点 host（取自来源页面 URL）；推不出来就是空串，不编造。 */
  site: string
  updatedAt: number
}

/** `index.yaml`：库的指针面。卡文件才是权威，索引只是加速器（可与盘上文件对账重建）。 */
export type LibraryIndex = {
  apiVersion: 'dataforge/v1'
  kind: 'interface-library-index'
  /** 下一个可分配序号；持久化它是为了"删卡也不复用 ID"。 */
  nextCardSeq: number
  cards: LibraryIndexEntry[]
}
