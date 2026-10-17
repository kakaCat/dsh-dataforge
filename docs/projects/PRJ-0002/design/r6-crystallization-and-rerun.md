---
title: 结晶与复跑 · R-6 设计
status: draft
owner: yunpeng
reviewers: 待定
prd: docs/projects/PRJ-0002/requirement/r6-crystallization-and-rerun.md
serves: FR-6.1、FR-6.2、FR-6.3、FR-6.4、FR-6.5、FR-6.6、FR-6.7
created: 2026-10-17
updated: 2026-10-17
---

# 结晶与复跑 · R-6 设计  serves: FR-6.1～FR-6.7

## 摘要  serves: 全文

- **问题**：R-5 的首跑已经能产出「值 + 来源 + 依据」，但这些值还留在 probe 的 run 里；链文件仍是首跑时的临时值（甚至没有值）。下一次换材料（A/B→C/D）还得重新探索。
- **方案**：新增 `dataforge_chain_crystallize`：读同一 `explorationId` 的 probe 留痕，按来源自动给出三分类草案（`user`→入参、`constant`→常量、`upstream`→链生成值），`confirm=true` 后写回链文件——`user` 值冻成链级 `inputs` 槽位，`constant` 冻进节点 `constants`，`upstream` **只校验绑定边、绝不冻结**。复跑直接复用 `dataforge_chain_run` 代入新槽位值；诊断复用 R-3 的失败节点/绑定边信息。
- **影响面**：新增 `src/execute/crystal.ts`、`src/orchestration/crystal.ts` 与第 18 个工具 `dataforge_chain_crystallize`；新增 `crystal-run` 留痕；不改链/卡 schema（只用既有 `inputs` / `constants` / `edges`），不新增依赖。
- **关键决策（回答需求 Q1/Q2）**：M1 只做**手动复跑**（不排期、不批量）；结晶以一次 exploration 为单位**重新生成草案**，写回当前链的新版本（不自动合并旧槽位，冲突显式报）。

## 背景与问题  serves: 全文

### 需求来源

| 需求编号 | 原始诉求 | 本设计如何回应 |
|---|---|---|
| FR-6.1 | 按首跑来源自动给出三分类草案 | 读 probe run 的 `provenance`：`user`→input、`constant`→constant、`upstream`→chain；`agent-inferred`→input 候选但需确认 |
| FR-6.2 | 草案经用户确认后才写回 | 不带 `confirm=true` 只返回草案；`agent-inferred` 行必须在 `decisions` 里显式 `confirmed:true` |
| FR-6.3 | 铁律：响应值不可冻为常量 | `upstream` 行只允许 `chain`；任何把 upstream 当 constant 的决策 → `crystal-iron-rule`，整次写回拒绝 |
| FR-6.4 | 结晶后链含链级 inputs 声明 | user 行生成 `inputs[{name,type,required,example}]`，节点常量写成 `$inputs.<name>` |
| FR-6.5 | 无人值守复跑 | 直接 `dataforge_chain_run(inputs:{...})`：R-3 拓扑执行 + R-4 换票，重新求解全部链生成值 |
| FR-6.6 | 失败诊断指到节点/值/求解路径 | 复用 R-3 的 `failedNode` + `binding-*` 错误（错误消息带 `from → to`）；M1 的端到端用例断言断点可读 |
| FR-6.7 | 复跑留痕可对照 | 每次复跑本来就是 `chain-run`；`run.json.chain` 含 site/flow/version，按版本对照即可 |

### 现状与代价

R-5 的 probe 已经把「这个值是谁给的」记下来了，但这份信息只活在 `runs/`：

- 链文件里没有 `inputs`，`dataforge_chain_run` 复跑时还得靠 agent 重新描述值；
- 首跑查出来的内部 ID 若被手抄进 `constants`，换材料必挂——这正是 R-6 要防的错；
- 每次换单都重新 probe，R-5 的价值没有沉淀成资产。

代价是「一次探索，次次复跑」变成「每次都要探索」。而 R-6 的全部工作只是把 R-5 已经记录的事实翻译成链文件，不需要再执行一次网络。

出处：R-6 需求 §1/§3/§5；R-5 设计的 `provenance` 数据模型；R-1 的 `inputs` / `constants` 契约。

### 为什么是现在

R-5 刚落地的 `provenance` 是结晶的唯一原料；再晚做，probe 留痕会被新 run 淹没，或者 agent 会用手抄常量绕过——一旦错误的值进了链文件，后面很难分辨是「用户给的」还是「响应来的」。现在做，成本最低、分类最可信。

## 目标与非目标  serves: 全文

### 目标

- 给定一个 `explorationId`，输出逐值三分类草案：`constant` / `input` / `chain`，并带来源、依据、值预览、是否需用户确认；
- 草案不带 `confirm=true` 时**绝不写链**；
- `agent-inferred` 行没有显式用户确认时拒绝写回（`crystal-confirmation-required`）；
- 任何「upstream → constant」的决策被拒（`crystal-iron-rule`），整次写回不落盘；
- 写回后的链通过 R-1 校验，含链级 `inputs` 与节点 `constants: '$inputs.<name>'`；
- 用 `dataforge_chain_run` 代入新入参复跑，链生成值由上游响应重新求解（与首跑值不同也能成功）；
- 复跑失败时，失败节点与绑定边在回执/运行记录里可读。

### 非目标

- **不做定时/批量复跑**：M1 只做手动触发；调度形态是需求 Q1，留到 M2 评估。
- **不做自动合并旧结晶**：每次以一次 exploration 为准重新出草案；旧槽位/常量不自动继承（冲突显式报），避免「半新半旧」的链。
- **不做条件边/分支**：仍是一条链一种执行路径。
- **不做自动修复**：复跑失败不自动改绑定/换值；agent 用 R-5 probe 再试。
- **不做值加密/脱敏存储**：结晶只处理业务值；probe 已把敏感路径写成 `***`，这类行不参与结晶。
- **不做 UI**：M1 只交付工具与留痕；面板展示留给后续。
- **不新增写链入口**：写回仍走 `saveChain`（R-1 校验 + 版本快照），不直接写 YAML 文件。

## 方案总览  serves: FR-6.1

**一句话方案**：把一次 exploration 的 probe 留痕编译成一份「逐值分类草案」，用户确认后按草案生成链的新版本；复跑只是用新槽位值调用既有执行引擎。

```text
probe × N（同一 explorationId）
  │  run.json.probe + provenance + values
  ▼
buildCrystalDraft
  │  user → input（槽位候选）
  │  constant → constant
  │  upstream → chain（只校验绑定边）
  │  agent-inferred → input 候选 + requiresUserConfirmation
  ▼
confirm? ── 否 ──► 返回草案（不写链）
  │ 是 + decisions 合法
  ▼
applyCrystalDraft → saveChain（R-1 校验 / 新版本）
  ▼
dataforge_chain_run(inputs:{C,D}) → 重新求解链生成值 → 成功/失败诊断
```

**关键概念**：

- **结晶草案（draft）**：逐值分类建议，不写盘；带 `source`、`suggestion`、`evidence`、`requiresUserConfirmation`。
- **决策（decisions）**：用户/agent 对草案的覆盖；只允许在 `constant` 与 `input` 之间选择，`chain` 行不可改成冻结。
- **结晶运行（crystal-run）**：一次写回审计，记录 explorationId、草案摘要、决策、写入版本。
- **槽位（input slot）**：链级 `inputs[]`，复跑时由 `dataforge_chain_run.inputs` 替换。

## 架构与依赖  serves: FR-6.1、FR-6.2、FR-6.4

- **模块划分**：
  - `src/execute/crystal.ts` → 纯函数：读 probe 留痕折叠成 draft、来源→建议映射、冲突/敏感行识别、草案校验（铁律）。
  - `src/orchestration/crystal.ts` → 应用层：载链、生成 draft、应用 decisions、构造新链 doc、`saveChain`、写 crystal-run。
  - `src/tools.ts` → `dataforge_chain_crystallize`（第 18 个工具）。
  - `src/index.ts` → 装配 deps（复用 `ChainRunToolDeps`）。
- **依赖方向**：`tools.ts` → `orchestration/crystal.ts` → `execute/crystal.ts` + `chains/store.ts` + `runs/store.ts`。不依赖 capture/client。
- **外部依赖**：无新增；`js-yaml`/`schemastery` 已在用。
- **与既有架构的差异**：结晶是**第一个把 runs 事实写回工作区资产**的模块；因此必须走 `saveChain`（版本快照 + R-1 校验），不能直接改文件。

## 数据模型  serves: FR-6.1、FR-6.2、FR-6.4

### 结晶草案行

```ts
type CrystalSuggestion = 'constant' | 'input' | 'chain'

type CrystalDraftRow = {
  nodeId: string
  path: string              // 卡字段路径
  value: unknown            // 首跑值（敏感行已排除）
  source: 'user' | 'agent-inferred' | 'upstream' | 'constant'
  suggestion: CrystalSuggestion
  /** user/agent-inferred 的槽位候选名（同名自动加节点前缀）。 */
  slotName?: string
  type: string              // 卡字段类型
  evidence?: string
  requiresUserConfirmation: boolean
  conflict?: boolean        // 同一 path 在不同 probe 里值/来源不一致
  excluded?: string         // 敏感/不可冻结原因；excluded 行不参与写回
}
```

- **来源映射（硬规则）**：`user`→input、`constant`→constant、`upstream`→chain、`agent-inferred`→input + `requiresUserConfirmation`。
- **冲突**：同一 `nodeId + path` 在多条 probe 里出现不同值/来源 → `conflict: true`；写回前必须用 `decisions` 明确选一个，否则 `crystal-conflict`。
- **敏感行**：probe 的 `redacted: true` 或值为 `***` → `excluded: '敏感值不参与结晶'`，不写回、不阻塞其它行。
- **类型**：常量只接受 string/number/boolean（链 schema 的常量类型）；object/array 只能作为用户入参（槽位），不能冻成常量。

### 结晶后的链

```yaml
apiVersion: dataforge/v1
kind: interface-chain
meta: { site: 智慧供应链 SCM, flow: 采购下单, version: 2, created: ... }
inputs:
  - { name: q, type: string, required: true, example: "A" }
  - { name: quantity, type: number, required: true, example: "1" }
nodes:
  - id: query
    card: card_000001
    constants: { query.q: "$inputs.q" }
  - id: order
    card: card_000002
    constants: { body.quantity: "$inputs.quantity" }
edges:
  - { from: query.body.items[0].internalId, to: order.body.materialId }
```

- `upstream` 值不写入 `constants`；只要求已存在 `to` 指向该字段的绑定边（否则 `crystal-chain-without-binding`）。
- 已有 `inputs`/`constants` 不在草案里的保持原样；同名槽位类型不一致 → `crystal-slot-conflict`。
- 写回后由 `saveChain` 分配新版本；旧版本仍可回读。

### crystal-run 留痕

`dataRoot/runs/<runId>/run.json`：`kind: 'crystal-run'`、`crystal.{site,flow,explorationId,decisions,writtenVersion,path}`、`draft`（行摘要，不含敏感值）、`startedAt`；events 写 `meta` + `terminal` + `result`，供 `dataforge_status` 通用折叠。

## 接口设计  serves: FR-6.1、FR-6.2、FR-6.3、FR-6.4

| 编号 | 接口 | 输入 | 输出 | 失败与错误 | 兼容性 |
|---|---|---|---|---|---|
| IF-1 | `dataforge_chain_crystallize`（agent 工具，第 18 个） | `site`、`flow`、`version?`、`explorationId`、`confirm?`、`decisions?` | `gate`（draft/written/blocked）、`draft[]`、`inputs[]`、`version`、`path`、`runId` | 见 IF-2/IF-3 | 新增工具；不改现有 17 个 |
| IF-2 | `buildCrystalDraft()`（执行核心） | probe runs + 链/卡 | `CrystalDraft` | `crystal-no-source` / `crystal-conflict` | 内部函数；只读 runs |
| IF-3 | `applyCrystalDraft()`（写回） | draft + decisions + 链 doc | 新链 doc + inputs | `crystal-iron-rule` / `crystal-confirmation-required` / `crystal-chain-without-binding` / `crystal-unsupported-value` / `crystal-slot-conflict` | 内部函数；写回只经 `saveChain` |
| IF-4 | 铁律校验（`assertNoResponseConstant`） | draft + decisions | 通过或错误 | `crystal-iron-rule` | 纯函数，可穷举单测 |
| IF-5 | 复跑 | `dataforge_chain_run.inputs` | 既有 chain-run | 既有 R-3/R-4 错误 | 复用，不新增接口 |

#### IF-1 dataforge_chain_crystallize

**语义**

读同一 `explorationId`（缺省 = 该 site/flow 最近一组 probe）的 probe 留痕，生成三分类草案。`confirm !== true` 只返回草案，**不写链**。`confirm=true` 时：

- 默认按草案建议写回；
- `decisions` 可以覆盖 `constant` / `input`（键 `${nodeId}:${path}`，如 `query:query.q`）；
- `agent-inferred` 行必须在 `decisions` 里带 `confirmed: true`，否则拒绝；
- `upstream` 行不允许出现在 `decisions` 的 `as` 里（出现即 `crystal-iron-rule`）；
- 任何冲突行必须由 `decisions` 明确选择，否则 `crystal-conflict`。

**错误码**

| 情形 | code | 调用方处理 |
|---|---|---|
| 没有匹配的 probe 留痕 | `crystal-no-source` | 先跑 R-5 probe |
| 未带 confirm | `crystal-confirmation-required`（gate=draft） | 向用户展示草案，确认后重调 |
| agent-inferred 未确认 | `crystal-confirmation-required` | 让用户确认该值，再在 decisions 里标 confirmed |
| upstream 被要求冻成常量/入参 | `crystal-iron-rule` | 拒绝；响应值只能走绑定边 |
| upstream 行没有绑定边 | `crystal-chain-without-binding` | 先用 `dataforge_chain_upsert` 补边 |
| 冲突行未决策 | `crystal-conflict` | 在 decisions 里选一个值/分类 |
| 常量类型不支持（object/array） | `crystal-unsupported-value` | 改成入参槽位，或人工决定 |
| 槽位同名但类型不一致 | `crystal-slot-conflict` | 换槽位名或修类型 |
| 写回未过 R-1 校验 | `invalid-chain`（带 issues） | 修草案/链后重试，不落盘 |

**兼容性**

新增工具；不改变链 schema。写回只产生新版本，旧版本可回读。

#### IF-2 buildCrystalDraft

**语义**

扫描 `listRunIds(dataRoot, 200)`，只取 `run.json.kind === 'probe-run'` 且 `probe.site/flow/version` 匹配、`probe.explorationId` 匹配的运行；按 `startedAt` 升序折叠：

- 每个 `provenance` 行 → draft 行；
- 同一 `nodeId + path` 多次出现：值/来源一致则保留；不一致标 `conflict`；
- `values` 里对应路径的值用于 `value`（`***` 视为敏感，excluded）；
- 卡字段类型从接口库卡取；卡不在场 → 该行 `excluded`（不阻塞其它行）。

**错误码**

- `crystal-no-source`：一条匹配 probe 都没有；
- `crystal-conflict`：冲突行在 confirm 时仍未决策（在 IF-3 统一报）。

**兼容性**

只读 runs；旧 run 没有 `probe`/`provenance` 段时自然跳过。

#### IF-3 applyCrystalDraft

**语义**

先做铁律与确认校验，再构造新链：

- `constant` → `node.constants[path] = value`（只接受标量）；
- `input` → 生成/复用链级 `inputs` 槽位，`node.constants[path] = '$inputs.<name>'`；
- `chain` → 不写常量；校验已有一条 `to` 指向 `nodeId.path` 的绑定边；
- `excluded` 行跳过，不改变链。

构造完交给 `saveChain(workspaceRoot, chainToYaml(doc), { source: 'agent' })`；校验不过原样返回 issues，不落盘。

**错误码**

同 IF-1 的 `crystal-*`；`saveChain` 的 `invalid-chain` / `card-not-imported` 原样返回。

**兼容性**

写回是新增版本，不删旧版本；不修改卡文件。

#### IF-4 assertNoResponseConstant

**语义**

铁律的代码落点：对每个 draft 行，若 `source === 'upstream'`，`decisions.as` 只能是 `chain`（或没有决策），否则返回 `crystal-iron-rule`。即使 agent 在 decisions 里写 `as:'constant'`，也在写链前拒绝——**工具/schema 不提供这条路径**。

**错误码**

`crystal-iron-rule`。

**兼容性**

纯函数；未来新增来源类型时必须显式声明是否可冻结。

#### IF-5 复跑

**语义**

结晶后的链是普通 `interface-chain`：`dataforge_chain_run(site, flow, inputs:{q:'C', quantity:2}, confirm:true)` 即复跑。R-3 的分层/绑定/R-4 换票全部复用；链生成值由上游响应重新求解，不读首跑缓存。

**错误码**

沿用 R-3/R-4：`missing-params` / `inputs-invalid` / `binding-*` / `node-*` / `relogin-*`。

**兼容性**

不新增接口；结晶只改变链文件内容。

## 备选方案  serves: 全文

| 方案 | 一句话说明 | 优点 | 代价 | 为什么未选 |
|---|---|---|---|---|
| A（选用） | 读 probe 留痕 → 草案 → 确认 → saveChain 新版本 | 来源可信；铁律可在写前拦；复用 R-1 校验 | 需要 R-5 留痕；冲突要人工决策 | — |
| B | 直接把首跑值写进 constants，人工再改 | 快 | 响应值被冻结，换入参必挂；违反铁律 | 直接排除 |
| C | 自动把所有 user 值都当入参、upstream 都当链值，不问用户 | 零交互 | agent 猜的值变成资产；冲突无法发现 | 违反 FR-6.2 |
| D | 新建一份「复跑链」而不改原链 | 不动原资产 | 两套链漂移；版本/绑定要同步 | 资产分叉成本更高 |
| E：什么都不做 | 每次复跑重新 probe | 零开发 | R-5 的价值不沉淀；用户无法「一次探索，次次复跑」 | 现在不能接受：R-6 是整条流水线的终点 |

## 四风险与证据  serves: 全文

| 风险类型 | 判断问题 | 现有证据 | 结论 |
|---|---|---|---|
| 价值 | 用户真的需要吗 | R-6 需求原话「下一次 c/d 还能跑通吗」；R-5 已有 provenance | 已验证 |
| 可用性 | agent 会用吗 | 草案行带 suggestion/evidence/conflict；写回走既有 upsert/run | 部分（未做任务测试） |
| 可行性 | 我们建得出来吗 | `probe-run` 留痕、`saveChain`、R-3 执行均已存在；无新依赖 | 已验证（本地 A/B→C/D 用例） |
| 商业可行性 | 公司能接受吗 | 纯本地、零新依赖 | 已验证 |
| **安全** | 敏感值会不会被结晶 | probe 已把敏感路径写 `***`；结晶把这类行 excluded | 已验证（单测） |

**未验证项的补课计划**：
- 真实业务链 A/B→C/D 需要真实站点；M1 用本地 HTTP 服务验证「换入参后上游重新求解」；
- 冲突决策的真实体验 → M2 用一次双 probe 首跑观察。

## 失败模式与回滚  serves: 全文

| 失败场景 | 触发条件 | 用户可见影响 | 检测手段 | 回滚动作 | 决策人 |
|---|---|---|---|---|---|
| 响应值被冻成常量 | 决策/实现绕过铁律 | 换入参复跑必挂 | `crystal-iron-rule` 写前拒；单测 | 回读旧链版本；重新结晶 | yunpeng |
| agent 猜的值被当用户值 | 未确认就写回 | 资产含不可信值 | `agent-inferred` 强制 `confirmed:true`；草案标 requiresUserConfirmation | 撤回新版本；重新确认 | 用户 |
| 冲突值写错 | 多 probe 值不一致且未决策 | 复跑用了错的常量/槽位 | `crystal-conflict` 写前拒 | 在 decisions 里重选；重新写回 | 用户/agent |
| 绑定边缺失 | upstream 行没有边 | 链写回失败 | `crystal-chain-without-binding` | 先 upsert 补边，再结晶 | agent |
| 写回后链被手改坏 | 文件被编辑 | 复跑 `invalid-chain` | `loadChain` 校验 | 回读旧版本；重新 upsert | 用户 |
| 敏感值进草案 | probe 未脱敏/新字段 | 泄漏 | probe 扫描 + excluded 行 | 删除 crystal-run；补规则 | yunpeng |

- **开关**：复用 `chainRunEnabled`（关闭后结晶工具也拒绝，避免在停执行时改资产）。
- **回滚演练**：写回前后各回读一次版本；确认旧版本可读、复跑可用。
- **不可逆动作**：写回会产生新版本（可回读旧版本）；不删除历史。

## 跨关注点  serves: 全文

| 关注点 | 结论 | 依据与措施 |
|---|---|---|
| 安全 | 敏感值不参与结晶；铁律写前拦 | probe `redacted` 行 excluded；upstream→constant 直接拒 |
| 隐私与合规 | 草案/留痕只落本机 | 与 runs 同纪律；不自动上传 |
| 成本 | 可忽略 | 只读 run + 写一个 YAML；无网络 |
| 可观测性 | 每次写回有 crystal-run | `crystal-run` 记录 explorationId/decisions/version |
| 性能与容量 | 扫描最近 200 个 run | 结晶是低频人工动作；量大再加索引 |
| 文档与支持 | 需要新增结晶/复跑章节 | README 增「结晶与复跑」：三分类、确认、槽位、复跑命令 |

## 交付拆分与里程碑  serves: 全文

| 里程碑 | 内容 | 出口判据 | 负责人 | 目标日期 |
|---|---|---|---|---|
| M1 | draft 生成 + 铁律 + 确认闸 + 槽位写回 + crystal-run + A/B→C/D 端到端 | 本地服务：A/B 首跑 probe → 结晶 v2 → C/D 复跑成功且内部 ID 重新求解；写回无响应常量；typecheck/test/build 全绿 | yunpeng | 已完成（2026-10-17） |
| M2 | 复跑诊断（`dataforge_chain_diagnose`）+ 复跑对照视图 + 冲突决策体验 | 一次无效 C 的失败报告能直接指到绑定边；两次 run 可对照 | yunpeng | 部分完成（2026-10-17）：diagnose 已落地，对照视图待做 |
| M3 | 调度/批量（需求 Q1）+ 增量结晶（Q2）+ 面板 | 多组入参批量复跑；旧链增量确认 | yunpeng | 2026-10-25 |

## 需求追溯  serves: 全文

| 需求编号 | 设计节 | 测试用例 | 指标 | 里程碑 |
|---|---|---|---|---|
| FR-6.1 | §数据模型 / IF-2 | `test/execute/crystal.test.ts`：四种来源→三种建议 | 来源映射正确率 = 100% | M1 |
| FR-6.2 | §接口设计 / IF-1/IF-3 | `test/orchestration/crystal.test.ts`：无 confirm 不写；agent-inferred 未确认拒 | 未确认写回数 = 0 | M1 |
| FR-6.3 | §接口设计 / IF-4 | `test/execute/crystal.test.ts`：upstream→constant 拒 | 响应常量数 = 0 | M1 |
| FR-6.4 | §数据模型 / IF-3 | `test/orchestration/crystal.test.ts`：写回后 inputs + `$inputs.<name>` | 槽位声明覆盖率 = 100% | M1 |
| FR-6.5 | §接口设计 / IF-5 | `test/orchestration/crystal.test.ts`：C/D 复跑成功、上游值变化 | 复跑成功率 = 1 | M1 |
| FR-6.6 | §接口设计 / IF-5 | `test/orchestration/diagnose.test.ts`：failedNode + 可疑入边 + 上游状态 + 建议 | 断点可读率 = 100% | M1/M2 |
| FR-6.7 | §数据模型 | `test/orchestration/crystal.test.ts`：两次 run 的 chain.version 可对照 | 每次复跑一条 run | M1 |

## 常见问题  serves: 全文

| 问题 | 回答 |
|---|---|
| 为什么不让 agent 直接改链文件？ | 直接改会绕过 R-1 校验/版本快照；`saveChain` 是唯一写入口，结晶也必须走它。 |
| 为什么 upstream 连「入参」都不能当？ | 响应值不是每单可换的人给值，它是求解结果；当入参会把「重新求解」变成「回放首跑值」。 |
| agent-inferred 怎么算确认？ | 工具要求 decisions 里显式 `confirmed:true`；它无法验证真人，只能在 R-6 的确认闸上再加一道，不伪造。 |
| 多 probe 值冲突怎么办？ | `crystal-conflict` 写前拒；在 decisions 里选一个值/分类后再写。 |
| 6 个月后会成为什么负担？ | 多一个 crystal-run kind 与槽位命名规则；只要写回只走 saveChain、铁律不变，负担可控。 |
| 数据错了怎么修？ | 结晶产生新版本；回读旧版本或重新结晶写 vN+1，不改历史。 |
| 这个决定错了多久能发现？ | 换入参复跑第一次就会暴露（上游值没重新求解）；端到端用例已覆盖。 |
| 为什么不做定时复跑？ | 需求 Q1 未定；手动 `dataforge_chain_run` 已能无人值守执行，调度是外围能力。 |

## 开放问题  serves: 全文

| 问题 | 选项 | 负责人 | 截止 |
|---|---|---|---|
| Q1（需求原问题）复跑调度形态 | **已决（M1）：仅手动触发**；定时/批量留 M3 | yunpeng | 已决：2026-10-17 |
| Q2（需求原问题）结晶后再编辑链 | **已决（M1）：以一次 exploration 重新出草案，不自动合并**；旧常量/槽位保留但不自动继承新值 | yunpeng | 已决：2026-10-17 |
| Q3 槽位命名规则 | 取字段叶子名；同名加节点前缀（M1） | yunpeng | M1 |
| Q4 冲突决策是否需要 UI | M1 用 decisions 文本；M2 评估面板 | yunpeng | M2 |
| Q5 复跑诊断是否单独工具 | M1 复用 R-3 回执；M2 评估 `dataforge_chain_diagnose` | yunpeng | M2 |

## 验收证据  serves: 全文

> 本节在里程碑完成时逐条补证据；M1 完成后更新。

- M1（2026-10-17）：
  - [x] `pnpm typecheck` 0；`pnpm test` 464 passed / 3 skipped；`pnpm build` 通过；
  - [x] 无 confirm 不写链，版本保持 v1（`test/orchestration/crystal.test.ts`）；
  - [x] upstream→constant 被 `crystal-iron-rule` 拒，版本不前进；
  - [x] 写回后链含 `inputs` + 节点常量 `$inputs.<name>`，upstream 不写常量；
  - [x] C/2 复跑成功：`queries` 含 C、`orders` 含 C-ID，且不再出现 A-ID；
  - [x] 无效 Z 的失败：`failedNode=order`，错误含 `query.body.items[0].internalId → order.body.materialId`；
  - [x] agent-inferred 未确认被拒；confirmed 后写成入参；
  - [x] crystal-run 审计留痕。


- M2（2026-10-17，部分完成）：
  - [x] `dataforge_chain_diagnose(runId)`：失败节点/错误码/节点状态/可疑入边/上游状态/建议（`test/orchestration/diagnose.test.ts`）；
  - [x] 只读：不重跑、不改链；run 不存在/非链运行诚实报错；
  - [ ] 复跑对照视图（两次 run 的差异展示）；
  - [ ] 冲突决策的面板体验。

## 附录  serves: 全文

### 与 R-5 的边界

R-5 只负责「值 + 来源 + 依据」；R-6 只负责「把来源翻译成链资产」。结晶不重新执行网络，也不猜测来源。

### 与 R-1 的边界

结晶只使用 R-1 已有的 `inputs` / `constants` / `edges`，不新增 schema 字段；写回必须过 `saveChain` 的校验与版本分配。
