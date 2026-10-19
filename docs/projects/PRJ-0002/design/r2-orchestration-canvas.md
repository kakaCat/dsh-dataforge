---
title: 编排画布（R-2）设计
status: draft
owner: kakaCat
reviewers: 待定
prd: docs/projects/PRJ-0002/requirement/r2-orchestration-canvas.md
serves: FR-2.1、FR-2.2、FR-2.3、FR-2.4、FR-2.5、FR-2.6
created: 2026-10-17
updated: 2026-10-17
---

# 编排画布（R-2）设计  serves: FR-2.1

## 摘要  serves: 全文

- **问题**：R-1 的链文件对 agent 友好，业务用户不写 YAML；原型 `docs/prototypes/orchestration.html` 已定型四段动线，但面板里**整个「编排」页签原本没有实现**（采集/接口库/采集网站三个页签是 PRJ-0001，编排是 PRJ-0002）。
- **方案**：面板加第 5 个页签「编排」——网站选择 → 流程列表（页面/接口编排 × 业务域 → 流程 → 版本，带检索与分页）→ 编排图列表（每版本一张，分页）→ 画布（`@xyflow/react` v12）；链契约补三个可选字段（业务域、版本来源、画布坐标），读写全经 `saveChain` 唯一写入口。
- **影响面**：新增 3 个 client 模块 + 1 个路由模块（四条路由：overview / palette / graph 读 / graph 写）；改 `src/chains/{schema,store}.ts`（补字段）、面板路由分派、构建链；不改采集期任何表结构，不改 R-1 校验规则。

## 背景与问题  serves: 全文

### 需求来源

| 需求编号 | 原始诉求 | 本设计如何回应 |
|---|---|---|
| FR-2.1 | 原型：「网站 → 编排类型 → 流程 → 版本 → 编排图三级列表」 | 四视图单页签：`sites → flows → graphs → canvas`，业务域→流程→版本三级 + 检索 + 分页 |
| FR-2.2 | 「React Flow 画布：拖入节点、拖点连线、点选改属性、Delete 删除」 | `@xyflow/react` v12 画布 + 左栏调色板（拖卡/页面进画布，也可点击追加）；连线/改属性/Delete 齐全 |
| FR-2.3 | 「连线即绑定：下游入参字段 ← 上游出参字段（下拉自卡模板）」 | 边属性面板两侧下拉，候选来自卡的 `inputs[].path` / `outputs[].path`，选完拼 `<节点id>.<字段路径>` |
| FR-2.4 | 「保存 = 写链文件 + 版本快照；校验失败不许保存，错误指到节点/边」 | 写路径只有 `saveChain`；失败回执 `issues[{target,code,reason}]` 逐条回显 |
| FR-2.5 | 「导入导出 YAML（原型占位按钮转正）」 | 导入：选 `.yaml` → 同一写入口（`source=import`）；导出：下载当前版本原文 |
| FR-2.6 | 「链级入参槽位编辑（对应 FR-1.7）」 | 画布上方可展开槽位编辑器，随 doc 一起回传 |
| FR-1.5 | 「版本快照、导入导出」（R-1） | 画布保存 = 新版本文件；历史版本可回读、不覆盖不删除 |

### 现状与代价

原型文件已可交互演示，但面板里没有入口：业务用户能看原型、能用 agent 工具，**没有一条「不碰文本」的路径**。
今天要创建一条链，只能让 agent 调 `dataforge_chain_upsert` 写 YAML，或用户自己手写文件——两条路都要求懂链格式。
代价是 R-1 的产物只有 agent 能造出来，业务用户连「看一眼链长什么样」都得开编辑器。

### 为什么是现在

R-1 的链契约（schema + 校验 + 版本 + 唯一写入口）已经稳定并有 84 项测试覆盖，画布只是它的另一个前端；
再晚做的代价是链文件在业务用户手里积累成「只由 agent 产生、人不敢改」的黑盒，与「文件可手改」的初衷背离。

## 目标与非目标  serves: 全文

### 目标

- 业务用户**全程不碰文本**完成一条链的查看、编辑、另存新版本（G1）；
- 画布与链文件**双向一致**：画布保存 → 重开完全一致；手改文件 → 画布正确回显（G2）；
- 画布产物**通过 R-1 全部校验**，可被 R-3 直接消费（G3）；
- 坏图（悬空卡、成环、字段不存在）保存时被拒并指到具体节点/边。

### 非目标

- **不做执行与运行视图**：那是 R-3 的链详情·运行 tab，混进来会把画布变成半个执行器；
- **不复制卡字段进链**：节点名称/方法/地址来自卡（唯一事实源），画布只读展示——复制会让改卡之后链骗人；
- **不新增校验规则**：画布只是编辑器，校验仍是 R-1 的那一套，画布不「顺手放宽」任何一条（例如空链、僵尸槽位）；
- **不做 PNG 导出**：原型本身是占位，且需要额外的位图导出依赖，收益低于成本。

## 方案总览  serves: FR-2.1、FR-2.2

**一句话方案**：面板新增「编排」页签，四段动线在一个页签内切换；数据来自两条只读路由 + 一条写路由，写路由内部仍只调 `saveChain`。

```text
浏览器（panel client）
  编排页签 ──GET /orchestration/overview──► 链目录扫描（listChains + 逐版本头部）
     │
     ├──GET /orchestration/palette────────► 库里的卡 + 采集到的页面（左栏拖拽源）
     │
     ├──GET /orchestration/graph──────────► loadChain + 卡投影（method/url/字段表）→ 可编辑 doc
     │
     └──POST /orchestration/graph─────────► saveChain（schema + 语义校验）→ 新版本 YAML 落盘
                                              └─ 来源标注 canvas / import
```

**关键概念**：

- **业务域（domain）**：链 `meta.domain`，编排页的分组维度；缺省「未分组」。
- **版本来源（source）**：链 `meta.source`，`agent` / `canvas` / `import`，由**写入方声明**，不猜。
- **卡投影（card projection）**：只含 `name/method/urlTemplate/inputs/outputs`，零凭证，供画布显示与绑定下拉。

## 架构与依赖  serves: FR-2.1、FR-2.2

- **模块划分**：
  - `src/orchestration/panel-routes.ts` —— 编排数据面（overview / graph 读写）；
  - `src/client/page-orchestration.tsx` —— 四视图与动线（网站/流程/编排图列表 + 检索分页 + 新建流程弹窗 + 导入）；
  - `src/client/orchestration-canvas.tsx` —— 画布、自定义节点、绑定编辑、槽位编辑、导出；
  - `src/client/xyflow-css.ts` —— React Flow 样式字符串（`pnpm gen:xyflow-css` 生成，产物进 git）。
- **依赖方向**：client → HTTP 路由 → `src/chains/*` → 文件系统。client 不 import 服务端模块，路由不实现校验。
- **外部依赖**：`@xyflow/react@12.12.0`（打包进 client bundle）。它挂掉的表现是整个页签白屏，其余四个页签不受影响（独立模块，按需渲染）。
- **与既有架构的差异**：面板路由原本一个前缀一个 handler；本期改为**同一前缀内分派**（`/orchestration/*` 交给编排 handler），因为宿主 prefix 匹配语义没有契约（详见 §接口设计 IF-3）。

## 数据模型  serves: FR-2.4、FR-2.6

- **实体与字段**：链文件 `chains/<siteSlug>/<flowSlug>/v<n>.yaml`，本期新增可选字段：

  ```yaml
  meta:
    domain: 采购域          # 新增：业务域分组（缺省「未分组」）
    note: 含审批分支         # 新增：新建流程弹窗备注
    source: canvas          # 新增：agent | canvas | import
  nodes:
    - id: create-order
      layout: { x: 770, y: 185 }   # 新增：画布坐标（缺省自动布局）
  ```

- **约束与不变量**：
  - 版本只增不删，`meta.version` 由 `saveChain` 分配（max+1），输入里的值被覆盖；
  - `layout` 的 `x`/`y` **都不 required**：schemastery 会把可选对象字段先实例化成 `{}` 再校验，写 required 会让「没坐标的链」全部失败（实现时踩到，`schema.ts` 里有注释）；
  - `source` 只接受三值枚举；`domain` / `note` 是自由字符串（业务域是用户词汇，枚举会挡人）。
- **迁移与回填**：不需要。三个字段全可选，老链零迁移；老链的版本在列表里显示「未标注来源」。
- **生命周期**：写入即新版本快照；画布保存 / YAML 导入 / agent 工具三条写入路径共用 `saveChain`。

## 接口设计  serves: FR-2.1、FR-2.5

| 编号 | 接口 | 输入 | 输出 | 失败与错误 | 兼容性 |
|---|---|---|---|---|---|
| IF-1 | `GET /orchestration/overview` | 无（可选 `?site=` 过滤） | `{sites[], flows[], chainsRootHint}`；versions 逐条含 `created/source/nodeCount/edgeCount/superseded/unreadable` | 500 `internal`（读目录异常） | 新增只读端点，无破坏性变更 |
| IF-2 | `GET /orchestration/graph?site&flow&version` | `site`、`flow` 必填，`version` 可选（缺省最新） | `{doc, cards, chainYaml, versions[]}` | 400 `missing-param`/`bad-param`；404 `chain-not-found`；422 `invalid-chain`（坏文件） | 同上 |
| IF-3 | `POST /orchestration/graph` | `{doc}` 或 `{chainYaml}`，可选 `source: canvas\|import` | `{ok:true, version, path, warnings[]}` | 400 `bad-json`/`bad-param`；413 `payload-too-large`；200+`ok:false`+`issues[]`（校验不过） | 同上 |
| IF-4 | `GET /orchestration/palette` | 无 | `{cards[], pages[], truncated?}`：卡的 cardId/名称/方法/地址/字段计数 + 采集到过的页面 | 500 `internal`；库为空返回空数组（不是错误） | 新增只读端点 |

#### IF-1 网站与流程总览

**语义**

一次拿够编排页三级的全部元数据：网站折叠（页面/接口编排条数、业务域集合、最近更新）与流程逐版本摘要。
分页与检索在客户端做——链是项目资产，量级是「几十条流程」，服务端分页只会多一次往返。

**错误码**

读目录或读文件异常 → 500 `internal`；单个版本文件坏**不是错误**，该版本在 `versions[]` 里带 `unreadable` 原因照常返回。

**兼容性**

新增端点，无版本压力。

#### IF-2 单版本可编辑副本

**语义**

返回 `doc`（完整链文档 JSON）+ `cards`（节点引用卡的投影）+ `chainYaml`（原文，供导出）。

**为什么返回 `doc` 而不是只返回 nodes/edges**：画布保存要把 `inputs` 槽位、`constants`、未知键原样带回；只给 nodes/edges 会在保存时覆盖掉链级入参。顺带让客户端不需要 YAML 解析器（不把 `js-yaml` 打进 bundle）。

**错误码**

`site`/`flow` 缺失 → 400 `missing-param`；`version` 非正整数 → 400 `bad-param`；版本不存在 → 404 `chain-not-found`（附 `availableVersions`）；
文件被手改坏 → 422 `invalid-chain`（附 `issues`）——**不假装能画**。

**兼容性**

新增端点；`doc` 形状即链契约，随 R-1 schema 演进（当前 `dataforge/v1`）。

#### IF-3 画布保存 / YAML 导入

**语义**

同一写入口承担两件事：画布回传 `doc`，导入回传 `chainYaml` 文本；`source` 区分来源（缺省 `canvas`）。
两者都只经 `saveChain`（schema + 语义校验全过才落盘），路由层不重复实现校验。

**错误码**

- JSON 解析失败 → 400 `bad-json`；
- 既无 `doc` 也无 `chainYaml`、或 `source` 不是 `canvas`/`import` → 400 `bad-param`；
- 请求体超 512 KB → 413 `payload-too-large`；
- 链不合法 → **HTTP 200 + `{ok:false, code, issues[]}`**：那是用户可修的操作反馈，不是服务异常（与采集入口同款取舍）。

**兼容性**

新增端点；请求体两种形态（`doc` / `chainYaml`）长期并存，便于 agent 手写 YAML 与画布回传 doc 共用一条写路径。
`source` 只接受 `canvas`/`import`，新增来源需要同时改本契约与版本列表的展示映射——这是一处**有意的收紧**，避免写入不可解释的来源值。

**幂等与重试**：不幂等——每次成功都产生新版本。重复提交同一份内容会得到内容相同的 v(n+1)，不改写历史。

#### IF-4 画布调色板

**语义**

「从接口库拖入节点」的数据源：接口编排列出库里可拖的卡，页面编排列出采集到过的页面（去重）。
只给身份与字段计数——拖进去之后画布按 cardId 再取完整字段表（IF-2 的 `cards`），避免重复下发。

**错误码**

库不存在/读不出来 → **200 + 空数组**（画布仍可开，手填 cardId 的路径仍在）；其余异常 → 500 `internal`。

**兼容性**

新增端点。卡片超过 500 张 / 页面超过 200 条时截断，并在 `truncated` 里如实说明——不静默截断。

#### 路由分派（无编号，属 IF-1～IF-4 的装配约束）

编排路由与采集路由共用前缀 `/dashboard/api/dataforge`。**不各自 register 一次**：宿主 prefix 匹配语义没有契约（首个命中 vs 最长前缀），两个 handler 抢前缀就是赌实现。
做法：前缀只注册一次，`/orchestration/*` 在我们的代码里分派（`CapturePanelDeps.orchestration`），并对两种 URL 形态（完整路径 / 剥好前缀）各有用例锁住。

## 备选方案  serves: 全文

| 方案 | 一句话说明 | 优点 | 代价 | 为什么未选 |
|---|---|---|---|---|
| A（选用） | 面板内新增「编排」页签 + 服务端 `doc` 往返 + `saveChain` 唯一写入口 | 与既有面板同构；校验不重复实现；客户端零 YAML 依赖 | client bundle +264 KB；多一个页面模块要维护 | — |
| B | 画布作为独立页面（`/dashboard/orchestration`） | 不受面板容器约束，画布可以更大 | 多一套路由与鉴权；与「单入口 + 标签页」的面板纪律分叉，用户要记两个地址 | 代价是长期的双入口维护，不是「复杂」 |
| C | 客户端自带 YAML 序列化器（画布直接产出 YAML） | 服务端少一个 doc 形态 | `js-yaml` 进 bundle；且客户端要自己保证 inputs/未知键不丢——同一件事两处实现 | 一致性风险高于收益 |
| D：什么都不做 | 继续只让 agent 写链文件 | 零成本 | 业务用户永远进不了链；R-1 的「文件可手改」只剩 agent 一条路 | 与 R-2 的需求定义直接冲突 |

## 四风险与证据  serves: 全文

| 风险类型 | 判断问题 | 现有证据 | 结论 |
|---|---|---|---|
| 价值 | 业务用户真的需要画布吗 | 原型已可交互演示（`docs/prototypes/orchestration.html`）；R-2 需求文档由原型倒推 | 部分（原型验证，无真实用户任务测试） |
| 可用性 | 用户能在画布上完成一次编排吗 | 已实现四段动线；「从接口库拖入」未做，当前需手填 cardId | 部分 |
| 可行性 | React Flow 能进单 CJS bundle 吗 | 已在真实构建链验证：`lib/client.js` 61 KB → 325 KB，构建通过；两个坑（alwaysBundle / CSS 不能 import）已固化进配置 | 已验证 |
| 商业可行性 | 成本可接受吗 | 无新增服务端资源；仅前端体积 +264 KB，本地分发 | 已验证 |

**未验证项的补课计划**：可用性 → 找一个业务用户按 S1 走一遍（选网站 → 新建流程 → 填 card → 连线 → 保存），记录卡在哪一步；负责人 kakaCat；下一个里程碑前给结论。

## 失败模式与回滚  serves: 全文

| 失败场景 | 触发条件 | 用户可见影响 | 检测手段 | 回滚动作 | 决策人 |
|---|---|---|---|---|---|
| 画布白屏 | `@xyflow/react` 打包或版本异常 | 编排页签不可用，其余四页签正常 | 页面 console 报错；构建体积骤降为 ≤原值可作旁证 | 回滚到不含画布的上一个 commit（页签随之消失） | kakaCat |
| 保存覆盖了链级入参 | 客户端只回传 nodes/edges | 该版本 `inputs` 丢失 | 单测已断言 `inputs` 原样保留 | 回读上一版本文件（版本不可变，文件仍在） | kakaCat |
| 编排路由 404 | 宿主传的 URL 形态未覆盖 | 页签一直空 | 单测覆盖两种形态；路由 404 日志 | 补 `isOrchestrationRequest` 判定 | kakaCat |
| 坏链文件 | 手改错 YAML | 该版本画布打不开 | overview 里带 `unreadable`；graph 返回 422 | 回读上一版本，或按 `issues` 修文件 | 用户 |
| 大链超限 | 链 YAML > 512 KB | 保存被拒（413） | 413 回执 | 拆链；上限是常量，需要时调 | kakaCat |

- **开关**：无（页签随插件存在/不存在）。
- **回滚演练**：不适用——回滚即 revert commit + 重新构建，无状态需要清理。
- **不可逆动作**：无。版本只增不删，任何一次误保存都留有旧版本文件。

## 跨关注点  serves: 全文

| 关注点 | 结论 | 依据与措施 |
|---|---|---|
| 安全 | 无新增攻击面 | 路由只做文件读写；`site`/`flow` 经 store 的 slug 校验，不拼接用户输入到路径；卡投影只含 method/url/字段路径，零凭证 |
| 隐私与合规 | 不涉及 | 不采集、不存储任何个人信息；导出的是链原文（天然零凭证） |
| 成本 | 无新增服务端资源 | 纯本地文件读写；前端体积 +264 KB |
| 可观测性 | 弱 | 无埋点。失败依赖 HTTP 错误码与画布内 notice；如需长期观测，应加「保存失败次数」计数（未做） |
| 性能与容量 | 满足当前量级 | overview 每次请求读所有链的最新版本头；几十条流程量级下 <10ms。链数上千时需要缓存版本头（未做） |
| 文档与支持 | 已更新 | 本设计 + README 编排章节 + 页面内提示文案（偏差原因写在界面上） |

## 交付拆分与里程碑  serves: 全文

| 里程碑 | 内容 | 出口判据 | 负责人 | 目标日期 |
|---|---|---|---|---|
| M1 | 链契约补字段（domain/source/layout）+ `listChains` 元数据 | schema 往返测试绿；老链零迁移 | kakaCat | 已完成（2026-10-17） |
| M2 | 编排数据路由（overview/graph 读写）+ 前缀内分派 | 14 项路由测试绿；两种 URL 形态都认 | kakaCat | 已完成（2026-10-17） |
| M3 | 四视图 + 画布 + 绑定下拉 + 槽位编辑 + 导入导出 | typecheck 0；329 passed；`pnpm build` 通过 | kakaCat | 已完成（2026-10-17） |
| M4 | 拖入节点（已完成 2026-10-17） | 调色板拖/点都能落节点；空库降级为手动填 cardId | kakaCat | 已完成 |
| M5 | 重命名业务域/流程（✅ 2026-10-17）、页面编排→接口链编译入口（⏳ 待做） | 用户能全程不碰文本完成 S1（重命名部分已达成） | kakaCat | 部分完成 |

## 需求追溯  serves: 全文

| 需求编号 | 设计节 | 测试用例 | 指标 |
|---|---|---|---|
| FR-2.1 | 方案总览、接口设计 IF-1 | `test/orchestration/panel-routes.test.ts` overview 三项 | 不适用 |
| FR-2.2 | 架构与依赖、接口设计 IF-4 | 调色板内容与零凭证用例、空库降级用例；构建验证（`lib/client.js` 331 KB） | 不适用 |
| FR-2.3 | 接口设计 IF-2（卡投影）、备选方案 C | 卡字段投影用例（含「不含 auth」断言） | 不适用 |
| FR-2.4 | 数据模型、接口设计 IF-3 | doc 形态保存、坏链 422、坏图不落盘 | 不适用 |
| FR-2.5 | 接口设计 IF-3（source=import） | import 来源标注、非法 source 400 | 不适用 |
| FR-2.6 | 数据模型、画布槽位编辑 | doc 往返后 `inputs` 原样保留 | 不适用 |
| FR-1.5 | 数据模型·生命周期 | `test/chains/store.test.ts` 版本只增用例 | 不适用 |

## 常见问题  serves: 全文

| 问题 | 回答 |
|---|---|
| 最可能被投诉什么 | 「为什么我改不了节点名称？」——因为名称属于接口卡。界面已写说明，但第一次用的人仍会愣一下。 |
| 6 个月后会成为什么负担 | 画布与卡库的字段语义会各自演进；如果卡模板加了新形态（如 multipart），绑定下拉要跟着改。 |
| 流量涨 10 倍先坏在哪 | overview 每次全量扫链目录并读每个最新版本头；链数到上千时会变慢（无缓存）。 |
| 谁半夜被叫起来、手上有什么 | 没有人——这是本地插件，无服务端。最坏是用户自己的页签白屏。 |
| 数据错了怎么修、修得回来吗 | 修得回来。版本是不可变快照，误保存产生的新版本不会覆盖旧文件，删掉 v(n) 即回到 v(n-1)。 |
| 这个决定错了多久能发现 | 「doc 往返」如果漏字段，会在下一次保存后的重开对不上——已有单测覆盖 `inputs`/`layout`，人工也能一眼看出。 |

## 开放问题  serves: 全文

| 问题 | 选项 | 负责人 | 截止 |
|---|---|---|---|
| Q1 「从接口库拖入节点」要不要做 | 已决：做（左栏调色板，拖 + 点两种入口都保留） | kakaCat | 已决：2026-10-17 完成 |
| Q2 业务域/流程重命名语义 | 只改 `meta.domain`（不动目录）／真正移动链文件目录（需要 rename 事务） | kakaCat | M4 前 |
| Q3 页面编排 → 接口编排的编译入口放哪 | 画布工具栏（「编译为接口链」）／流程列表行内操作 | kakaCat | R-3 联调前 |

## 附录  serves: 全文

- **原型与验证材料**：`docs/prototypes/orchestration.html`（四视图 + React Flow 交互）
- **相关文档**：[R-2 需求](../requirement/r2-orchestration-canvas.md)、[R-1 设计](./r1-chain-model.md)、[ADR-0001 编排界面技术选型](../../adr/0001-orchestration-ui-stack.md)
- **评审记录**：待评审
- **变更历史**：2026-10-17 初稿（实现完成当日追写，含与原型的三处有意偏差）
- 2026-10-17 追记①「面板整块不激活」的根因与修法：`@xyflow/react` 依赖的
  `use-sync-external-store` 会把 `process.env.NODE_ENV !== 'production' && (dev 分支)` 留在
  产物顶层，而浏览器里没有 `process` —— 宿主模块加载器一执行 factory 就抛
  `process is not defined`，**整个 client 半都不激活**（现象：侧栏没有「数据采集」图标，
  控制台之外没有任何提示，宿主半一切正常）。修法两层，缺一不可：
  1. `tsdown.client.config.mjs` 加 `define: { 'process.env.NODE_ENV': '"production"' }`，
     dev 分支被 DCE 掉；
  2. `scripts/wrap-client.mjs` 加构建期守卫：`lib/client.cjs` 里只要残留裸 `process.` 就
     **构建失败**并指到行号 —— 换依赖/改配置后不会静默发布一个必炸的 bundle。
  排查经验：遇到「插件宿主半 active、client 半毫无痕迹」时，先看产物里有没有
  `process.` / 顶层 JSON.parse / 顶层 `window`，再看模块图，别先怀疑 slot 注册。


- 2026-10-17 追记②「与原型对齐」的修订（对照 `docs/prototypes/orchestration.html` 的渲染结果逐屏比对）：
  - 补「层级图例」（右下角三级说明卡，网站/业务域 → 流程 → 版本）；
  - 三处分页条补「每页 N 条」下拉（网站 9/18/36、流程 10/20/50、编排图 10/20/50），
    **真实生效**（改 pageSize 并回到第 1 页），不做原型里那种点了没反应的装饰控件；
  - 版本行的「查看编排图」改为进**编排图列表**（原型动线：版本 → 编排图列表 → 打开画布），
    此前直接跳画布，等于把中间那层藏了；删掉原型没有的「编排图列表（n）」多余一行；
  - `.dsh-df-btn-primary` 原来是 `width:100%; margin-top:12px` 的全局样式，把「+ 新建流程」
    和列表行里的「查看编排图」撑成整行大按钮；改成紧凑按钮 + `.dsh-df-btn-block` 修饰类
    （只有采集表单的提交按钮需要块级）；
  - 画布：标题补「更新于 …」；页面链的边不再拿节点 id 当标签（原型的人写动线名链模型里
    没有，宁可不显示）；调色板从 `Panel position="center-left"`（浮在画布正中、遮住节点）
    移到左上工具条下面，且默认收起；
  - 已补齐：站点卡第二行改为 host（overview 新增 hosts 投影，来自链引用的卡/页面来源）；
    「✎ 重命名」已落地（`POST /orchestration/rename`，只同步目录名与各版本
    `meta.domain`/`meta.flow`，不改内容与版本号——这是 R-1「版本不可变」的元数据修正例外，见 M5）；
  - 仍保留的偏差（都是**数据模型里没有**或**要新依赖**，不是没做）：
    无「自动取名」标签（数据面没有「名字是否来自自动推断」的标志）、无「导出 PNG」
    （DOM→PNG 要引第三方库，违反零新依赖）、无 pill 开始/结束节点（链模型没有该节点类型）、
    画布编辑面板改的是链自己的字段（常量/绑定/重试），不是原型里属于接口卡的名称/方法/地址。
