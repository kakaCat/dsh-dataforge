---
title: 链模型与编排定义（R-1）设计
status: draft
owner: yunpeng
reviewers: 待定
prd: docs/projects/PRJ-0002/requirement/r1-chain-model.md
serves: FR-1.0、FR-1.1、FR-1.2、FR-1.3、FR-1.4、FR-1.5、FR-1.6、FR-1.7
created: 2026-10-17
updated: 2026-10-17
---

# 链模型与编排定义（R-1）设计  serves: FR-1.0～FR-1.7

## 摘要  serves: 全文

- **问题**：采集期接口库是静态文档，缺少一个机器可消费、人可手改、可版本化的流程载体。
- **方案**：链 = 工作区 YAML 文件（节点引用项目接口库稳定卡 ID、边 = 绑定即依赖），加载即校验；页面编排编译为接口编排，执行模型只有一套。
- **影响面**：新增 `src/library/*`（接口库导入）与 `src/chains/*`（schema/校验/存取/编译）两组模块、3 个 agent 工具；不动采集期任何表结构（只读消费 capture SQLite）。

## 背景与问题  serves: 全文

### 需求来源

| 需求编号 | 原始诉求 | 本设计如何回应 |
|---|---|---|
| FR-1.0 | 节点引用要有稳定身份（决策 Q3：先导入项目接口库） | §数据模型·接口库：capture SQLite → 项目接口库，跨 run 归并 + 来源溯源 |
| FR-1.1～1.3 | YAML 链文件（决策 Q1），节点 = 卡引用 + 配置，边 = 绑定声明 | §数据模型·链 schema |
| FR-1.4 | 坏定义定义期被拒 | IF-2 validate：悬空/成环/字段不存在逐一指认 |
| FR-1.5/1.6 | 版本快照、导入导出 | §数据模型·生命周期：文件即版本，导出零凭证 |
| FR-1.7 | 链级入参槽位 | 链 schema `inputs:` 段，R-6 结晶的写入点 |
| （决策 Q2） | 页面编排编译为接口编排执行 | §页面编排编译 |

### 现状与代价

今天"编排"只有原型（orchestration.html 的 React Flow CDN 占位），链不存在——接口库的价值止步于人读文档。PRJ-0001 需求 G4 写明卡片结构化就是为了编排消费。

### 为什么是现在

第二期 6 条需求的依赖拓扑里 R-1 是根：链契约不定，R-2 画布与 R-3 引擎无法并行开工。

## 目标与非目标  serves: 全文

### 目标

- 手写一份 ≥3 节点、含绑定边的链 YAML，经工具校验通过并落盘（不依赖任何 UI）；
- 三类坏定义（悬空卡引用 / 成环 / 绑定字段不存在）在保存前被拒，错误指到具体节点/边；
- 接口库导入：同一接口跨两次采集 run 归并为一张项目卡，来源（captureId/页面）可追溯；
- 同一流程两个版本共存，可分别回读；
- 页面编排可编译产出合法接口编排草稿。

### 非目标

- **不做画布 UI**（R-2）：本期链只能手写/agent 写，省掉前后端联调，契约先行；
- **不做执行**（R-3）：链定义不携带任何运行时语义，引擎的消费契约以本 schema 为准再冻结；
- **不做条件边/审批分支**：原型都没有的形态，引入会让拓扑与编译语义翻倍复杂；
- **不改采集期表结构**：接口库导入只读 capture SQLite，导入产物是另一套文件，失败不污染采集库。

## 方案总览  serves: FR-1.1

**一句话方案**：项目接口库与链都以 YAML 文件落在工作区 `.dsh/dataforge/` 下（与流程包第三层"项目自带、权威覆盖"同纪律），链通过稳定卡 ID 引用接口库，校验器在写入前完成全部静态检查。

```text
capture SQLite（一期，只读）
   │ dataforge_library_import（跨 run 归并 + 溯源）
   ▼
.dsh/dataforge/library/cards/<cardId>.yaml  ← 项目接口库（稳定 ID）
   │ 引用
   ▼
.dsh/dataforge/chains/<site>/<flow>/v<n>.yaml  ← 链（版本快照）
   │ dataforge_chain_upsert 写入前
   ▼
validate（schema + 悬空 + 成环 + 绑定字段存在性 + 入参槽位）
```

**关键概念**：

- **项目接口库**：从各次采集导入、跨 run 归并后的卡片集合，卡 ID 项目内稳定；
- **链（chain）**：流程的一个版本快照；`interface-chain` 可被 R-3 直接执行，`page-chain` 需编译；
- **绑定边**：`from: <节点>.<出参路径>` → `to: <节点>.<入参路径>`，绑定关系即拓扑依赖；
- **入参槽位**：链级 `inputs:` 声明，本期只占位与校验，R-6 结晶时写入具体值。

## 架构与依赖  serves: FR-1.1

- **模块划分**：
  - `src/library/import.ts` → 读 capture SQLite、跨 run 归并、写卡文件（纯增量，幂等）；
  - `src/library/store.ts` → 卡文件存取 + 索引（cardId → 文件指针）；
  - `src/chains/schema.ts` → 链 YAML 的 schemastery 定义与类型（项目已有 schemastery 依赖）；
  - `src/chains/validate.ts` → 纯函数校验（schema 之外的语义检查全在这）；
  - `src/chains/store.ts` → 链文件存取、版本快照、导入导出；
  - `src/chains/compile.ts` → page-chain → interface-chain 草稿；
  - `src/tools.ts` → 注册 3 个工具（见 IF-1/2/3）。
- **依赖方向**：library 不依赖 chains；chains 依赖 library（校验卡引用）；compile 依赖两者；无环。
- **外部依赖**：无新增 npm 依赖（js-yaml、schemastery 已在）；capture SQLite 只读，库缺席时导入工具如实报"无采集数据"。
- **与既有架构的差异**：采集期用 SQLite 做查询面；接口库与链刻意用**文件**而不是表——它们是要进 git、要手改、要导入导出的项目资产，文件是唯一诚实的载体（与流程包发现层同哲学）。

## 数据模型  serves: FR-1.0、FR-1.1、FR-1.5、FR-1.7

### 项目接口库（FR-1.0）

`.dsh/dataforge/library/` 下每卡一文件 `cards/<cardId>.yaml` + `index.yaml`（cardId → 文件/归并键/站点）：

```yaml
# cards/card_000123.yaml
cardId: card_000123            # 导入时分配，序号式，项目内唯一且不复用
kind: interface-card
identity:
  mergeKey: GET /api/materials?q={q}      # 采集期归并键原样保留
  method: GET
  urlTemplate: /api/materials?q={q}
inputs:                        # 入参字段模板（从采集卡投影）
  - path: query.q
    type: string
    required: true
    role: search-key           # 一期变量角色标注原样带上
outputs:
  - path: body.items[*].internalId
    type: string
auth: cookie-session           # 一期 authType 原样投影
sources:                       # 来源溯源（可多次导入累积）
  - captureId: cap_20261016_01
    pages: [https://scm.example.com/purchase/new]
    relationIds: [rel_88, rel_91]
```

- **归并规则**：同 `mergeKey` 即同卡；再导入同卡 = 合并 `sources`、以新样本刷新字段模板（字段并集，冲突记 `notice`）；`legacy` 关系行照常溯源。
- **不变量**：cardId 分配后不复用；卡文件不含任何凭证值（只投影 `auth` 标志与来源名）。

### 链（FR-1.1/1.5/1.7）

`.dsh/dataforge/chains/<siteSlug>/<flowSlug>/v<n>.yaml`——**一个版本一个文件，版本即不可变快照**；目录即历史，无需额外元数据表：

```yaml
apiVersion: dataforge/v1
kind: interface-chain          # interface-chain 可执行；page-chain 需编译
meta:
  site: 智慧供应链 SCM
  flow: 采购下单
  version: 3
  created: 2026-10-17T12:00:00Z
inputs:                        # FR-1.7 入参槽位（R-6 结晶写入 example 值）
  - name: materialCodes
    type: array<string>
    required: true
  - name: keyword
    type: string
    required: true
nodes:
  - id: query-material
    card: card_000123
    constants:                 # R-6 结晶的常量写入点；本期允许手填
      query.orgId: "2120"
      query.q: $inputs.keyword # 槽位引用：复跑时替换（R-6）
  - id: create-order
    card: card_000457
edges:                         # FR-1.3 绑定即依赖
  - from: query-material.body.items[0].internalId
    to: create-order.body.lines[0].materialId
```

- **约束与不变量**：`nodes[].id` 链内唯一；`edges` 两端节点必须存在；`to` 路径必须在目标卡的入参模板中（或在 `constants` 中已给值——绑定与常量互斥）；`from` 路径必须在源卡出参模板中；`inputs` 的 `name` 唯一且被至少一个节点入参引用才允许存在（防僵尸槽位）。
- **槽位引用语法（实现定稿）**：`$inputs.<name>`，可出现在 `constants` 的值上，也可作为边的 `from`；作为 `from` 时它**不构成节点依赖**（不参与拓扑排序与环判定），只表示「这个入参由链级槽位提供」。引用未声明的槽位即报错。
- **page-chain 差异**：nodes 是 `page:`（页面 URL 模板）而非 `card:`；`edges` 是页面跳转/动线；编译后才产生接口级绑定。
- **生命周期**：手写/agent 写 → 校验 → 落盘即新版本（version 取 max+1）；不删除旧版本（导入导出见 IF-3）。
- **迁移与回填**：不适用——链是全新目录无存量；接口库导入是增量过程，不修改采集库。

## 接口设计  serves: FR-1.0、FR-1.4、FR-1.6

| 编号 | 接口 | 输入 | 输出 | 失败与错误 | 兼容性 |
|---|---|---|---|---|---|
| IF-1 | `dataforge_library_import`（agent 工具） | captureId（缺省=全部未导入的 run） | 导入卡数/归并数/跳过数 + 卡 ID 清单 | 无采集库 → `no-capture-data` | 新增工具，无兼容负担 |
| IF-2 | `dataforge_chain_upsert`（agent 工具） | site/flow/链 YAML 文本 | 落盘的版本号 + 文件路径 | 校验失败 → `invalid-chain` 带逐条错误 | 新增 |
| IF-3 | `dataforge_chain_get`（agent 工具） | site/flow/version（缺省最新）/ `export: true` | 链 YAML 全文（导出即原文，天然零凭证） | 不存在 → `chain-not-found` | 新增 |

#### IF-1 dataforge_library_import

**语义**

把一次（或全部未导入的）采集 run 的接口卡导入项目接口库：同 `mergeKey` 归并、分配稳定 cardId、累积来源溯源。纯增量幂等——重复导入同一 run 不产生重复卡、不重复记来源。调用方（agent）在编排前先跑它。

**错误码**

- `no-capture-data` → 采集库不存在或指定 captureId 无卡；调用方应先引导用户做采集，放弃本次导入；
- 单张卡数据损坏 → 跳过该卡并在回执 `skipped` 中如实计数与原因，不阻断整批（与流程包发现"坏 yaml 跳过不炸"同纪律）。

**兼容性**

新增工具；导入产物是文件，未来导入规则演进只影响新导入，已导入卡不强制重导。

**幂等与重试**

以 `(mergeKey)` 为天然幂等键；重复调用结果收敛于同一卡集合，`sources` 按 captureId 去重。

#### IF-2 dataforge_chain_upsert

**语义**

唯一的链写入口（画布 R-2 将来也走它）：先做 schema 校验，再做语义校验——卡引用在项目接口库中存在、拓扑无环（Kahn 排序兜底）、绑定两端字段在卡模板中存在、绑定与常量互斥、入参槽位被引用——全部通过才落盘为新版本快照。**不存在"部分写入"**。

**错误码**

- `invalid-chain` → 错误数组，每条指到 `nodes[i]` / `edges[j]` 并给中文原因；调用方（agent）应逐条修正后重试；
- `card-not-imported` → 引用的卡不在项目库，提示先跑 IF-1；
- 落盘 IO 失败原样上抛（沿用插件纪律）。

**兼容性**

`apiVersion: dataforge/v1` 写进每份链文件；未来 schema 演进走版本字段，旧版文件只读不迁移。

#### IF-3 dataforge_chain_get

**语义**

读链：按 site/flow/version（缺省最新）回读链 YAML 全文；`export: true` 时同一份原文即导出物——链文件天然零凭证，导出无需剥除。导入方在目标工作区用 IF-2 落盘（卡引用若缺席会收到 `card-not-imported`，先导入接口库）。

**错误码**

- `chain-not-found` → site/flow/version 任一不匹配；调用方列出可用版本后重试或放弃；
- 文件存在但已损坏（被手改坏）→ `invalid-chain` 同 IF-2 语义，并提示可回读旧版本。

**兼容性**

新增工具；读取对旧 `apiVersion` 文件只做 schema 所知的字段解析，未知字段原样保留不丢。

## 页面编排编译  serves: FR-1.2（决策 Q2）

`page-chain` 编译为 `interface-chain` 草稿：

1. 每个 `page:` 节点 → 查 `page_card_relations` 得该页面触发的接口卡集合（按 relation 的入参指纹分形态）；
2. 页面动线边 → 展开为接口级先后约束；
3. **绑定建议**：跨节点匹配"上游出参字段名/类型 ≈ 下游入参字段名/类型"生成候选绑定边，标 `suggested: true`；
4. 产出 interface-chain 草稿（不落盘为正式版本），由用户/agent 确认绑定后经 IF-2 落盘。

编译不保证产物可执行——它给的是草稿，确认权在人。

## 备选方案  serves: 全文

| 方案 | 一句话说明 | 优点 | 代价 | 为什么未选 |
|---|---|---|---|---|
| A（选用） | 工作区 YAML 文件 + 稳定卡 ID 接口库 | 人可读、git 可管、导入导出天然；与流程包哲学一致 | 要自己写校验与归并 | — |
| B | 链与接口库都进 SQLite | 查询方便、与采集库同栈 | 不可手改、不可 git diff、导入导出要另做序列化；agent 写链必须过工具，调试体验差 | 链是"项目资产"而非"查询数据"，文件载体更诚实 |
| C | 不做接口库导入，直接引用 `(capture_id, merge_key)` | 省掉导入模块 | 重新采集即产生新卡，旧链引用悬空需人工换绑；跨 run 同接口无法归并 | 用户已决策（Q3）要稳定 ID |
| D：什么都不做 | 链用对话口头描述，执行期再拼 | 零开发 | 无校验、无版本、无复跑载体，R-2~R-6 全部无地基 | 现在不能接受 |

## 四风险与证据  serves: 全文

| 风险类型 | 判断问题 | 现有证据 | 结论 |
|---|---|---|---|
| 价值 | 用户真的想要吗 | 用户主动提出 A/B→C/D 复跑场景并推进拆分 | 已验证 |
| 可用性 | 用户会用吗 | 编排原型已交互演示三级列表+画布；手写 YAML 路径面向 agent 无可用性问题 | 部分 |
| 可行性 | 我们建得出来吗 | js-yaml/schemastery 已在依赖中并有流程包先例；归并键一期已落库 | 已验证 |
| 商业可行性 | 公司能接受吗 | 纯本地文件，无新增成本 | 已验证 |

**未验证项的补课计划**：跨 run 归并规则的精度（误并/漏并）未有真实多 run 数据验证——M1 交付后用同一站点两次真实采集做归并抽检，yunpeng，M2 开始前要结论。

## 失败模式与回滚  serves: 全文

| 失败场景 | 触发条件 | 用户可见影响 | 检测手段 | 回滚动作 | 决策人 |
|---|---|---|---|---|---|
| 归并误并（两个接口合成一卡） | mergeKey 规则过宽 | 链引用到错误卡，执行期 404/400 | M2 抽检 + 执行期失败 | 删卡重导（卡文件可单独删除重导，不影响采集库） | yunpeng |
| 校验过严误杀合法链 | 字段模板路径语法不全 | 链无法落盘 | 用户反馈/单测 | 校验规则热修（纯代码，无数据迁移） | yunpeng |
| 链文件被手改坏 | 用户直接编辑 | 读取报错 | 读取时重校验 | 旧版本文件仍在，指回上一版本 | 用户自己 |

- **开关**：无（纯文件功能，无运行时开关需求）。
- **回滚演练**：不适用（无线上状态）。
- **不可逆动作**：无。接口库卡可删可重导；链版本只增不删；采集库全程只读。

## 跨关注点  serves: 全文

| 关注点 | 结论 | 依据与措施 |
|---|---|---|
| 安全 | 链与接口库零凭证 | 卡只投影 `auth` 标志与来源名；链导出即文件原文，无需剥除 |
| 隐私与合规 | 不适用：无新增个人数据采集 | 数据来自采集库投影，留存策略随采集期 |
| 成本 | 可忽略 | 每卡一文件、每版本一文件，KB 级 |
| 可观测性 | 沿用现有纪律 | 工具回执带中文错误清单；无新后台 job |
| 性能与容量 | 不适用：无流量概念 | 校验是纯函数，百节点链毫秒级 |
| 文档与支持 | README 待补 | M3 更新 README「编排」节 |

## 交付拆分与里程碑  serves: 全文

| 里程碑 | 内容 | 出口判据 | 负责人 | 目标日期 |
|---|---|---|---|---|
| M1 | 接口库导入（FR-1.0）+ 链 schema 与校验（FR-1.1~1.4、1.7） | **链契约冻结**；手写 3 节点链过校验落盘；三类坏定义被拒单测齐 | yunpeng | 2026-10-20 |
| M2 | 版本/导入导出（FR-1.5/1.6）+ 页面编排编译骨架 | 两版本共存回读；page-chain 编译出草稿；归并抽检结论出炉 | yunpeng | 2026-10-22 |
| M3 | 3 个 agent 工具 + e2e（手写链→校验→供 R-3 消费的桩） | typecheck/build/vitest 全绿；README 更新 | yunpeng | 2026-10-24 |

## 需求追溯  serves: 全文

| 需求编号 | 设计节 | 测试用例 | 指标 |
|---|---|---|---|
| FR-1.0 | 数据模型·接口库 / IF-1 | import 归并单测（同 key 两 run→一卡两来源） | 不适用 |
| FR-1.1/1.2/1.3 | 数据模型·链 schema | schema 单测（合法/非法样本） | 不适用 |
| FR-1.4 | IF-2 / validate.ts | 悬空/成环/字段不存在三单测 | 不适用 |
| FR-1.5/1.6 | 数据模型·生命周期 / IF-3 | 版本共存回读、导出导入往返 | 不适用 |
| FR-1.7 | 链 schema inputs 段 | 槽位未引用被拒单测 | 不适用 |

## 常见问题  serves: 全文

| 问题 | 回答 |
|---|---|
| 最可能被投诉什么 | 手改链文件后报错看不懂——所以校验错误必须指到节点/边并给中文原因 |
| 6 个月后会成为什么负担 | 卡字段模板路径语法若一开始定得太糙，R-3 求值期要回头扩语法 |
| 流量涨 10 倍先坏在哪里 | 无流量概念；链节点数暴涨时校验仍是毫秒级 |
| 谁半夜被叫起来、手上有什么 | 无人——无线上服务；最坏是用户链跑挂，手上有完整版本历史可回退 |
| 数据错了怎么修、修得回来吗 | 接口库卡删了重导即可（采集库是源，只读未动）；链回退到旧版本文件 |
| 这个决定错了多久能发现 | 归并规则错在 M2 抽检即暴露；schema 字段缺失在 R-3 联调第一天暴露 |

## 开放问题  serves: 全文

| 问题 | 选项 | 负责人 | 截止 |
|---|---|---|---|
| 卡 ID 形态：序号式 `card_000123` 还是语义 slug | 序号（稳定无歧义）/ slug（可读） | yunpeng | M1 开工时定，倾向序号 |
| 绑定路径语法：JSONPath 子集还是自定义点路径 | 自定义点路径（够用、好实现）/ JSONPath（表达力强） | yunpeng | M1 开工时定，倾向自定义点路径 |

## 附录  serves: 全文

- **原型与验证材料**：不适用（编排原型见相关文档；本设计无新原型）
- **相关文档**：[R-1 需求](../requirement/r1-chain-model.md)、[PRJ-0001 设计 spec](../../../superpowers/specs/2026-10-17-interface-capture-design.md)、[编排原型](../../../prototypes/orchestration.html)
- **评审记录**：未评审
- **变更历史**：2026-10-17 初稿（含用户三项决策：YAML / 页面编排编译为接口编排 / 先导入项目接口库）
