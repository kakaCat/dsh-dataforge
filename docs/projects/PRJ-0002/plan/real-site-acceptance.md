# 真实站点联调清单（R-1～R-6 主路径）

- 项目：PRJ-0002 链工坊
- 目的：把「本地 HTTP 服务已验证的机制」推到**一条真实业务链**上验收
- 适用：cookie 型登录态站点（token 型仍属 R-4 M3 未完成项）
- 原则：**先读后写、先 test 环境后生产、没有用户确认不发写请求**

> 本地单测/端到端已覆盖：采集、接口库、链校验、执行、cookie 注入、401 换票、首跑 probe、结晶、C/D 复跑、失败诊断。
> 本清单验证的是**真实站点**的登录态、响应结构、写操作与业务字段，不重复本地用例。

---

## 1. 前置条件

| 项 | 要求 | 确认 |
|---|---|---|
| 环境 | 优先 test/UAT；生产必须得到明确授权并限定只读或可回滚写 | ☐ |
| 账号 | 一个可登录的测试账号；无验证码/双因素（有则按诚实边界中止） | ☐ |
| 业务数据 | 至少两组可替换的入参（A/B 与 C/D），C/D 已知有效；另备一个无效值 Z | ☐ |
| 目标接口 | 登录接口 + 查询接口 + 业务写接口（或只读链先验） | ☐ |
| 回滚 | 写操作有业务侧清理/撤销方案；必要时先只跑只读链 | ☐ |
| 凭证纪律 | 凭证只走采集/本地库；不写进链、不贴进对话 | ☐ |

---

## 2. 采集与接口库

1. 用 `dataforge_browser_open` / `dataforge_browser_act` 完成真实登录，或用 `dataforge_capture(task_type=action)` 走登录 + 目标页面；写操作先向用户确认。
2. `dataforge_capture_result(scope=cards)` 检查：
   - 登录接口与业务接口都在卡里；
   - 卡 `auth` 为 `cookie-session`（token 型会 `unsupported`，记录并停止）；
   - 卡入参/出参路径符合真实响应。
3. `dataforge_library_import` 导入项目接口库，记下 `cardId`。
4. 检查 `dataforge_capture_result(scope=credentials)`：只报名称/来源，确认 cookie 已入库。

**通过判据**：目标链的每个节点都能在接口库找到卡；没有 `unknown` 鉴权卡。

---

## 3. 搭链与首跑 probe

1. `dataforge_chain_upsert` 写主链：查询节点 + 业务节点 + 绑定边（先按已知响应结构连）。
2. 如果链还缺参数，用 `dataforge_chain_probe` 逐节点试探：
   - 查询节点：`query.q` 用 `source:user`（A），读 `outputs` 里的内部 ID；
   - 业务节点：`body.materialId` 用 `source:upstream` + evidence（`probe:<runId> · body.items[0].internalId`），数量用 `source:user`；
   - 写方法必须用户确认后带 `confirm=true`。
3. 记录同一轮首跑的 `explorationId`。

**通过判据**：每个节点至少一次 probe 成功；`provenance` 覆盖所有非凭证入参；失败尝试有 run 记录。

---

## 4. 结晶

1. `dataforge_chain_crystallize(site, flow, explorationId)` 不带 confirm → 检查草案：
   - `query.q` 是 `input`；
   - 内部 ID 是 `chain`（不得是 `constant`）；
   - 组织/数量等固定/人给值分类正确；
   - `agent-inferred` 行标了「需用户确认」。
2. 用户确认草案；对 `agent-inferred` 行在 `decisions` 里写 `confirmed:true`。
3. 带 `confirm=true` 重调 → 新版本 vN+1。
4. `dataforge_chain_get` 回读：`inputs` 有名称/类型/example；节点常量为 `$inputs.<name>`；没有内部 ID 常量。

**通过判据**：链生成值没有被冻结；槽位声明完整；R-1 校验通过；旧版本仍可回读。

---

## 5. 换入参复跑（C/D）

1. `dataforge_chain_run(site, flow, inputs:{...C/D...}, confirm:true)`。
2. 检查运行记录：
   - 查询节点请求里是 C/D；
   - 业务节点收到的 materialId 是 C-ID/D-ID，**不是首跑的 A-ID/B-ID**；
   - 价格/库存等漂移值以本次响应为准。
3. 对照两次 `run.json.chain.version` 与 `dataforge_chain_runs`。

**通过判据**：复跑成功；链生成值重新求解有证据；无浏览器进程。

---

## 6. 失败与诊断

1. 用无效值 Z 复跑（或让 C 不属于该组织）→ 预期失败。
2. `dataforge_chain_diagnose(runId)`：
   - `failedNode` 指到消费该值的节点；
   - `edges` 里可疑边是 `查询节点.出参 → 业务节点.入参`；
   - `hints` 给出绑定断点建议。
3. 记录失败 runId 与错误码。

**通过判据**：失败可定位到绑定边，不是一句「500」。

---

## 7. 登录态过期与换票（cookie 型）

1. 等 cookie 过期（或手动清掉本地持久化 jar / 重新采集前先失效会话）。
2. 用 `dataforge_chain_run(..., relogin:{site,flow,inputs:{账号,密码}})` 复跑。
3. 检查：
   - 401 → 登录链执行 → `set-cookie` 收割 → 重放成功；
   - 登录链 run 的 `params` 值是 `***`，事件无密码/token；
   - `dataRoot/credentials/cookies.json` 权限 0600，按 origin 存；
   - 再跑一次不触发登录链（持久化生效）。

**通过判据**：换票后链继续；零凭证泄漏；第二次复用持久化 cookie。

---

## 8. 证据与收口

| 证据 | 位置 | 必填 |
|---|---|---|
| 采集 runId + cardId | `dataforge_capture_status` / 接口库 | ☐ |
| 首跑 probe runId + explorationId | `runs/<runId>/run.json` | ☐ |
| 结晶版本 + crystal-runId | `dataforge_chain_get` / `runs/` | ☐ |
| C/D 复跑 runId + 关键请求摘要 | `dataforge_status` / `dataforge_chain_runs` | ☐ |
| 失败诊断 runId + 可疑边 | `dataforge_chain_diagnose` | ☐ |
| 换票 runId + 登录链 runId | `runs/` | ☐ |
| 业务侧结果（单号/状态） | 业务系统 | ☐ |

**禁止**：把 cookie/token/密码原文贴进对话、链文件、提交记录或工单。

---

## 9. 已知缺口（联调时如实记录，不阻塞主路径）

- token 型凭证（Authorization/localStorage）未采集：目标站是 token 型时记录 `unsupported`，按 R-4 M3 补课；
- 复跑仅手动触发，无定时/批量；
- 结晶不自动合并旧槽位（以一次 exploration 重新出草案）；
- 面板暂无结晶/诊断 UI，全部走工具；
- 真实站点响应结构漂移时，先用 probe 重新确认 outputs，再 upsert 新链版本。

---

## 10. 签收

| 角色 | 结论 | 日期 |
|---|---|---|
| 操作人 | 主路径通过 / 阻塞项： | |
| 业务确认人 | 写操作与业务结果确认 | |
| 代码 owner | 是否需要修链/修插件 | |
