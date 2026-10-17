/**
 * 面板（单入口 + 顶级标签页）的样式注入：幂等（style 节点 id 去重），全部类名带
 * dsh-df- 前缀，不依赖宿主类名结构——宿主外壳怎么改不影响本面板。
 *
 * 设计系统来自 docs/prototypes/*.html（三张原型共享同一套 tokens 与层级视觉）：
 * tokens 随 .dsh-df-view 注入；lv-1/2/3 层级徽标 + 卡片 + 左导轨线表达
 * 页面→接口→形态 / 网站→页面 的从属；纪律同原型：样式零 innerHTML。
 *
 * @module dsh-dataforge/client/styles
 */
const STYLE_ID = 'dsh-dataforge-panel-styles'

const CSS = `
.dsh-df-view {
  /* shadcn/ui 标准 token 名（前端统一约定）；值来自三张原型的色板 */
  --background: #f4f5f7; --card: #ffffff; --border: #e4e7ec;
  --foreground: #1d2129; --muted-foreground: #86909c; --secondary-foreground: #4e5969;
  --primary: #3b6ef0; --primary-foreground: #ffffff;
  --accent: #eaf0fe; --accent-foreground: #3b6ef0;
  --ring: #3b6ef0;
  --destructive: #dc2626; --destructive-foreground: #ffffff;
  --success: #16a34a; --success-soft: #e8f8f0;
  --warning: #d97706; --warning-soft: #fff4e5; --warning-soft-line: #f5dfa8;
  --radius: 12px;
  --dsh-df-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  /* 兼容别名：既有类名先吃这层，统一迁移完成前不删 */
  --dsh-df-bg: var(--background); --dsh-df-card: var(--card); --dsh-df-line: var(--border);
  --dsh-df-ink: var(--foreground); --dsh-df-ink-2: var(--secondary-foreground);
  --dsh-df-ink-3: var(--muted-foreground);
  --dsh-df-accent: var(--primary); --dsh-df-accent-soft: var(--accent);
  --dsh-df-ok: var(--success); --dsh-df-ok-soft: var(--success-soft);
  --dsh-df-warn: var(--warning); --dsh-df-warn-soft: var(--warning-soft);
  --dsh-df-err: var(--destructive); --dsh-df-err-soft: #fdecec;
  --dsh-df-radius: var(--radius);
  background: var(--background); color: var(--foreground);
  font: 13px/1.6 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  -webkit-font-smoothing: antialiased;
}

/* ── 顶栏（brand + tabs，原型 .topbar） ── */
.dsh-df-topbar { background: var(--dsh-df-card); border-bottom: 1px solid var(--dsh-df-line);
  padding: 0 24px; display: flex; align-items: center; gap: 24px; height: 52px;
  position: sticky; top: 0; z-index: 10; }
.dsh-df-brand { font-weight: 700; font-size: 14px; white-space: nowrap; }
.dsh-df-brand em { font-style: normal; color: var(--dsh-df-accent); }
.dsh-df-tabs { display: flex; gap: 4px; height: 100%; }
.dsh-df-tab { display: flex; align-items: center; padding: 0 14px; color: var(--dsh-df-ink-2);
  border: none; border-bottom: 2px solid transparent; font-size: 13px; background: none; cursor: pointer; }
.dsh-df-tab:hover { color: var(--dsh-df-ink); }
.dsh-df-tab[aria-selected="true"] { color: var(--dsh-df-ink); font-weight: 600;
  border-bottom-color: var(--dsh-df-accent); }
.dsh-df-subtabs { margin: 2px 0 10px; }
.dsh-df-subtabs .dsh-df-tab { padding: 4px 10px; font-size: 12px; height: auto; }
.dsh-df-tabpane[hidden] { display: none; }

/* ── 页面容器（原型 .page） ── */
.dsh-df-page { max-width: 1080px; margin: 0 auto; padding: 22px 24px 56px; }
.dsh-df-page-spl { max-width: 1280px; margin: 0 auto; padding: 22px 24px 56px;
  display: grid; grid-template-columns: 360px 1fr; gap: 20px; align-items: start; }
@media (max-width: 980px) { .dsh-df-page-spl { grid-template-columns: 1fr; } }
.dsh-df-page-spl > aside { min-width: 0; }
.dsh-df-page-spl > main { min-width: 0; }

/* ── 通用卡 / 头部 / 状态 ── */
.dsh-df-card { background: var(--dsh-df-card); border: 1px solid var(--dsh-df-line);
  border-radius: var(--dsh-df-radius); padding: 16px 18px; }
.dsh-df-card + .dsh-df-card { margin-top: 14px; }
.dsh-df-card h2 { font-size: 14px; font-weight: 600; margin-bottom: 4px;
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dsh-df-sub { color: var(--dsh-df-ink-3); font-size: 12px; margin: 0; }
.dsh-df-head { display: flex; align-items: baseline; justify-content: space-between;
  margin-bottom: 12px; gap: 10px; flex-wrap: wrap; }
.dsh-df-sync { font-size: 11px; color: var(--dsh-df-ink-3); display: flex; align-items: center;
  gap: 8px; white-space: nowrap; }
.dsh-df-last { font-size: 11px; color: var(--dsh-df-ink-3); }

/* ── 徽标 / 方法 / 层级标识 ── */
.dsh-df-badge { display: inline-block; border-radius: 5px; padding: 1px 8px; font-size: 11px;
  font-weight: 600; white-space: nowrap; }
.dsh-df-badge.running { background: var(--dsh-df-accent-soft); color: var(--dsh-df-accent); }
.dsh-df-badge.done, .dsh-df-badge.ok { background: var(--dsh-df-ok-soft); color: var(--dsh-df-ok); }
.dsh-df-badge.failed, .dsh-df-badge.error { background: var(--dsh-df-err-soft); color: var(--dsh-df-err); }
.dsh-df-badge.cancelled, .dsh-df-badge.skipped-external { background: #f1f2f4; color: var(--dsh-df-ink-3); }
.dsh-df-method { font: 700 10.5px var(--dsh-df-mono); border-radius: 5px; padding: 1px 7px;
  white-space: nowrap; }
.dsh-df-method.GET { background: var(--dsh-df-ok-soft); color: var(--dsh-df-ok); }
.dsh-df-method.POST { background: var(--dsh-df-warn-soft); color: var(--dsh-df-warn); }
.dsh-df-method.dsh-df-method-other { background: #f1f2f4; color: var(--dsh-df-ink-3); }
.dsh-df-lv { font-size: 10px; font-weight: 700; letter-spacing: .05em; border-radius: 4px;
  padding: 1px 6px; white-space: nowrap; }
.dsh-df-lv1 { background: #eef2ff; color: #4f46e5; }
.dsh-df-lv2 { background: #ecfdf5; color: #059669; }
.dsh-df-lv3 { background: #fff7ed; color: #ea580c; }
.dsh-df-auto-tag { font-size: 10px; color: var(--dsh-df-warn); background: var(--dsh-df-warn-soft);
  border-radius: 4px; padding: 1px 6px; white-space: nowrap; }
.dsh-df-mono { font-family: var(--dsh-df-mono); font-size: 11.5px; word-break: break-all; }

/* ── 表单（原型 .url-input / .mode-tag / .btn-primary） ── */
.dsh-df-url-input, .dsh-df-search { width: 100%; border: 1px solid #d4d8df; border-radius: 8px;
  padding: 8px 12px; font: 12px var(--dsh-df-mono); color: var(--dsh-df-ink);
  background: var(--dsh-df-card); box-sizing: border-box; }
.dsh-df-url-input:focus, .dsh-df-search:focus { outline: none; border-color: var(--dsh-df-accent);
  box-shadow: 0 0 0 3px var(--dsh-df-accent-soft); }
.dsh-df-search { flex: 1; max-width: 340px; font-family: inherit; font-size: 13px; }
.dsh-df-mode-tag { display: inline-flex; align-items: center; gap: 5px;
  background: var(--dsh-df-accent-soft); color: var(--dsh-df-accent); border-radius: 6px;
  padding: 2px 8px; font-size: 11px; font-weight: 600; margin-top: 10px; }
.dsh-df-btn-primary { margin-top: 12px; width: 100%; border: none; background: var(--dsh-df-accent);
  color: #fff; border-radius: 8px; padding: 9px 0; font-size: 13px; font-weight: 600; cursor: pointer; }
.dsh-df-btn-primary:hover { filter: brightness(1.06); }
.dsh-df-btn-primary:disabled { opacity: .5; cursor: default; }
.dsh-df-btn, .dsh-df-btn-ghost, .dsh-df-mini, .dsh-df-pact { border: 1px solid var(--dsh-df-line);
  background: var(--dsh-df-card); border-radius: 6px; padding: 4px 10px; font-size: 12px;
  color: var(--dsh-df-ink-2); cursor: pointer; white-space: nowrap; }
.dsh-df-btn:hover, .dsh-df-btn-ghost:hover { border-color: #b8c3d9; color: var(--dsh-df-ink); }
.dsh-df-btn[disabled], .dsh-df-btn-ghost[disabled] { opacity: .45; cursor: default; }
.dsh-df-mini { font-size: 11px; padding: 1px 8px; }
.dsh-df-mini:hover { border-color: var(--dsh-df-accent); color: var(--dsh-df-accent);
  background: var(--dsh-df-accent-soft); }
.dsh-df-select { border: 1px solid var(--dsh-df-line); border-radius: 8px; padding: 7px 8px;
  font-size: 12px; color: var(--dsh-df-ink-2); background: var(--dsh-df-card); cursor: pointer; }

/* ── 进度：stat 网格 + 步骤时间线 + note（原型 .stat-grid / .steps / .note） ── */
.dsh-df-stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 12px 0 14px; }
.dsh-df-stat { background: #f7f8fa; border: 1px solid var(--dsh-df-line); border-radius: 8px;
  padding: 8px 4px; text-align: center; }
.dsh-df-stat b { display: block; font-size: 17px; font-weight: 700; }
.dsh-df-stat span { font-size: 11px; color: var(--dsh-df-ink-3); }
.dsh-df-steps { list-style: none; padding: 0; margin: 0; }
.dsh-df-steps li { position: relative; padding: 0 0 16px 26px; font-size: 12px; color: var(--dsh-df-ink-2); }
.dsh-df-steps li:last-child { padding-bottom: 0; }
.dsh-df-steps li::before { content: ""; position: absolute; left: 6px; top: 4px; width: 9px;
  height: 9px; border-radius: 50%; background: #d4d8df; }
.dsh-df-steps li::after { content: ""; position: absolute; left: 10px; top: 16px; bottom: 0;
  width: 1px; background: var(--dsh-df-line); }
.dsh-df-steps li:last-child::after { display: none; }
.dsh-df-steps li.dsh-df-done { color: var(--dsh-df-ink); }
.dsh-df-steps li.dsh-df-done::before { background: var(--dsh-df-ok); }
.dsh-df-steps li.dsh-df-doing { color: var(--dsh-df-accent); font-weight: 600; }
.dsh-df-steps li.dsh-df-doing::before { background: var(--dsh-df-accent);
  box-shadow: 0 0 0 4px var(--dsh-df-accent-soft); }
.dsh-df-steps li small { display: block; color: var(--dsh-df-ink-3); font-size: 11px; font-weight: 400; }
.dsh-df-note { background: var(--dsh-df-warn-soft); border: 1px solid #f5dfa8; border-radius: 8px;
  padding: 8px 12px; font-size: 12px; color: var(--dsh-df-warn); }

/* ── 结果文档头 + L1 页面节点（原型 .doc-head / .page-node） ── */
.dsh-df-doc-head { display: flex; align-items: baseline; justify-content: space-between;
  margin-bottom: 14px; gap: 10px; flex-wrap: wrap; }
.dsh-df-doc-head h1 { font-size: 17px; font-weight: 700; margin: 0; }
.dsh-df-summary { color: var(--dsh-df-ink-3); font-size: 12px; }
.dsh-df-page-node { background: var(--dsh-df-card); border: 1px solid var(--dsh-df-line);
  border-radius: var(--dsh-df-radius); margin-bottom: 14px; overflow: hidden; }
.dsh-df-pn-head { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
  padding: 12px 18px; background: linear-gradient(90deg, #f8faff, #ffffff);
  border: none; border-bottom: 1px solid transparent; cursor: pointer; }
.dsh-df-page-node:not(.dsh-df-collapsed) > .dsh-df-pn-head { border-bottom-color: var(--dsh-df-line); }
.dsh-df-pn-name { font-weight: 600; font-size: 13px; word-break: break-all; }
.dsh-df-pn-meta { margin-left: auto; color: var(--dsh-df-ink-3); font-size: 11px; white-space: nowrap; }
.dsh-df-caret { color: var(--dsh-df-ink-3); font-size: 10px; transition: transform .15s ease; }
.dsh-df-collapsed .dsh-df-caret { transform: rotate(-90deg); }
.dsh-df-pn-body { padding: 14px 18px 16px; }

/* ── L2 接口卡 + L3 细节导轨（原型 .iface / .sec） ── */
.dsh-df-iface { margin-left: 0; }
.dsh-df-iface-card { border: 1px dashed var(--dsh-df-line); border-radius: 10px;
  background: var(--dsh-df-card); padding: 10px 14px; margin-bottom: 10px; }
.dsh-df-iface-card:hover { border-color: #b8c3d9; }
.dsh-df-iface-card.dsh-df-open { border: 1px dashed var(--dsh-df-accent); }
.dsh-df-iface-head { display: flex; align-items: center; gap: 8px; cursor: pointer;
  background: none; border: none; width: 100%; text-align: left; padding: 0; }
.dsh-df-iface-url { display: block; font: 11px var(--dsh-df-mono); color: var(--dsh-df-ink-2);
  margin: 4px 0 0 2px; word-break: break-all; }
.dsh-df-iface-chips { display: flex; gap: 10px; flex-wrap: wrap; font-size: 11px;
  color: var(--dsh-df-ink-3); margin-top: 6px; }
.dsh-df-iface-chips b { color: var(--dsh-df-ink-2); font-weight: 600; }
.dsh-df-iface-detail { margin-top: 10px; border-left: 2px solid var(--dsh-df-accent);
  background: #fdfdff; border-radius: 0 8px 8px 0; padding: 2px 0 2px 14px; }
.dsh-df-sec { border-left: 2px dashed #ead9c2; margin: 12px 0; padding-left: 12px; }
.dsh-df-sec:last-child { margin-bottom: 2px; }
.dsh-df-sec h3 { font-size: 12px; font-weight: 600; margin: 0 0 6px; color: var(--dsh-df-ink);
  display: flex; align-items: center; gap: 8px; }
.dsh-df-sec h3 small { color: var(--dsh-df-ink-3); font-weight: 400; }
.dsh-df-fields { width: 100%; border-collapse: collapse; font-size: 11px; }
.dsh-df-fields th { text-align: left; font-weight: 600; color: var(--dsh-df-ink-3);
  background: #f7f8fa; padding: 4px 8px; border: 1px solid var(--dsh-df-line); white-space: nowrap; }
.dsh-df-fields td { padding: 4px 8px; border: 1px solid var(--dsh-df-line);
  color: var(--dsh-df-ink-2); word-break: break-all; }
.dsh-df-fields td.dsh-df-mono { font-size: 11px; }
.dsh-df-tag-unverified { font-size: 10px; font-weight: 600; color: var(--dsh-df-warn);
  background: var(--dsh-df-warn-soft); border-radius: 4px; padding: 1px 6px; white-space: nowrap; }
.dsh-df-shape-list { list-style: none; margin: 0; padding: 0; }
.dsh-df-shape { display: flex; align-items: center; gap: 10px; padding: 5px 0;
  border-bottom: 1px dashed var(--dsh-df-line); font-size: 11.5px; flex-wrap: wrap; }
.dsh-df-shape:last-child { border-bottom: none; }
.dsh-df-fp { font: 11px var(--dsh-df-mono); background: #f1f2f4; border-radius: 4px;
  padding: 1px 7px; color: var(--dsh-df-ink-2); word-break: break-all; }
.dsh-df-kv { color: var(--dsh-df-ink-3); font-size: 11px; }
.dsh-df-kv b { color: var(--dsh-df-ink-2); font-weight: 600; }

/* ── 工具条（原型 .toolbar） ── */
.dsh-df-toolbar { display: flex; gap: 10px; align-items: center; margin: 0 0 14px; flex-wrap: wrap; }
.dsh-df-view-head { margin-bottom: 16px; }
.dsh-df-view-head h1 { font-size: 17px; font-weight: 700; margin: 0 0 2px; }

/* ── L1 网站（article 级，原型 .site） ── */
.dsh-df-site { background: var(--dsh-df-card); border: 1px solid var(--dsh-df-line);
  border-radius: var(--dsh-df-radius); margin-bottom: 14px; overflow: hidden; }
.dsh-df-site-header { display: flex; align-items: center; gap: 10px; width: 100%;
  text-align: left; padding: 12px 18px; background: linear-gradient(90deg, #f8faff, #ffffff);
  border: none; cursor: pointer; border-bottom: 1px solid transparent; }
.dsh-df-site:not(.dsh-df-collapsed) > .dsh-df-site-header { border-bottom-color: var(--dsh-df-line); }
.dsh-df-site-name { font-weight: 600; font-size: 13px; }
.dsh-df-host { font: 11.5px var(--dsh-df-mono); color: var(--dsh-df-ink-3); word-break: break-all; }
.dsh-df-stats { margin-left: auto; display: flex; gap: 14px; font-size: 11px;
  color: var(--dsh-df-ink-3); white-space: nowrap; }
.dsh-df-stats b { color: var(--dsh-df-ink); font-weight: 700; font-size: 12px; }
.dsh-df-time-row { display: flex; gap: 16px; padding: 6px 18px; font-size: 11px;
  color: var(--dsh-df-ink-3); border-top: 1px dashed var(--dsh-df-line); flex-wrap: wrap; }
.dsh-df-site-body { border-top: 1px dashed var(--dsh-df-line); background: #fdfdff;
  padding: 12px 18px 16px; }
.dsh-df-site-body h3 { font-size: 12px; font-weight: 600; color: var(--dsh-df-ink-3);
  margin: 0 0 10px; }
.dsh-df-pages-rail { background: var(--dsh-df-card); border: 1px solid var(--dsh-df-line);
  border-radius: 10px; padding: 4px 16px; }

/* ── L2 页面页卡（rail 行，原型 .pgcard） ── */
.dsh-df-pgcard { display: flex; align-items: flex-start; gap: 10px; padding: 10px 0;
  border-bottom: 1px dashed var(--dsh-df-line); }
.dsh-df-pgcard:last-child { border-bottom: none; }
.dsh-df-pg-main { min-width: 0; flex: 1; }
.dsh-df-pname { font-weight: 600; font-size: 12.5px; }
.dsh-df-purl { color: var(--dsh-df-accent); text-decoration: none; font: 11.5px var(--dsh-df-mono);
  word-break: break-all; }
.dsh-df-purl::after { content: " ↗"; font-family: inherit; }
.dsh-df-purl:hover { text-decoration: underline; }
.dsh-df-pg-acts { margin-left: auto; display: flex; gap: 6px; white-space: nowrap; }
.dsh-df-pg-chips { display: flex; gap: 10px; flex-wrap: wrap; font-size: 11px;
  color: var(--dsh-df-ink-3); margin-top: 3px; }
.dsh-df-pg-chips b { color: var(--dsh-df-ink-2); font-weight: 600; }

/* ── 空态（原型 .empty） ── */
.dsh-df-empty { border: 1.5px dashed #c8cdd6; border-radius: var(--dsh-df-radius);
  padding: 30px 20px; text-align: center; color: var(--dsh-df-ink-3); font-size: 12px;
  background: rgba(255, 255, 255, .5); }
.dsh-df-empty b { color: var(--dsh-df-ink-2); font-weight: 600; }

/* ── 接口库视图：网站网格（原型 .site-grid/.site-card） ── */
.dsh-df-site-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 14px; }
.dsh-df-site-card { background: var(--dsh-df-card); border: 1px solid var(--dsh-df-line);
  border-radius: var(--dsh-df-radius); padding: 14px 16px; cursor: pointer; text-align: left;
  transition: border-color .15s ease, transform .15s ease; }
.dsh-df-site-card:hover { border-color: var(--dsh-df-accent); transform: translateY(-1px); }
.dsh-df-site-card-title { display: flex; align-items: center; gap: 8px; font-size: 13px;
  font-weight: 600; flex-wrap: wrap; }
.dsh-df-site-card-stats { display: flex; gap: 12px; margin: 8px 0; font-size: 11px;
  color: var(--dsh-df-ink-3); flex-wrap: wrap; }
.dsh-df-site-card-stats b { color: var(--dsh-df-ink); font-weight: 700; font-size: 12px; }
.dsh-df-site-card-foot { display: flex; align-items: center; gap: 8px; font-size: 11px;
  color: var(--dsh-df-ink-3); }
.dsh-df-site-card-enter { margin-left: auto; color: var(--dsh-df-accent); font-size: 11px;
  font-weight: 600; }

/* ── 接口库视图：面包屑 + 站点横幅 ── */
.dsh-df-crumb { display: flex; gap: 8px; align-items: center; margin-bottom: 12px;
  font-size: 12px; color: var(--dsh-df-ink-3); flex-wrap: wrap; }
.dsh-df-crumb button { color: var(--dsh-df-accent); background: none; border: none; cursor: pointer;
  font-size: 12px; padding: 0; }
.dsh-df-crumb button:hover { text-decoration: underline; }
.dsh-df-site-banner { display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin-bottom: 14px; padding: 14px 18px; }

/* ── 分页条（原型 .pagerbar） ── */
.dsh-df-pagerbar { display: flex; align-items: center; gap: 10px; margin-top: 14px;
  font-size: 12px; color: var(--dsh-df-ink-3); flex-wrap: wrap; }
.dsh-df-pages { display: flex; gap: 4px; margin-left: auto; flex-wrap: wrap; }
.dsh-df-pg { border: 1px solid var(--dsh-df-line); background: var(--dsh-df-card);
  border-radius: 6px; padding: 2px 9px; cursor: pointer; font-size: 12px; color: var(--dsh-df-ink-2); }
.dsh-df-pg:hover { border-color: #b8c3d9; }
.dsh-df-pg[aria-current="true"] { background: var(--dsh-df-accent); border-color: var(--dsh-df-accent);
  color: #fff; cursor: default; }
.dsh-df-pg[disabled] { opacity: .4; cursor: default; }

/* ── 右下角图例（原型 .legend, position fixed） ── */
.dsh-df-legend { position: fixed; right: 16px; bottom: 16px; z-index: 20;
  background: var(--dsh-df-card); border: 1px solid var(--dsh-df-line); border-radius: 10px;
  padding: 9px 14px; font-size: 11px; color: var(--dsh-df-ink-3); display: flex; gap: 14px;
  align-items: center; box-shadow: 0 8px 24px rgba(29, 33, 41, .08); flex-wrap: wrap; }

/* ── 刷新/加载/错误提示（跨页共用） ── */
.dsh-df-errline { color: var(--dsh-df-err); font-size: 12px; margin-top: 10px;
  word-break: break-all; }
.dsh-df-noticeline { color: var(--dsh-df-ink-3); font-size: 12px; margin-top: 10px; }
.dsh-df-state { text-align: center; padding: 20px 0; color: var(--dsh-df-ink-3); font-size: 12px; }
.dsh-df-state.err { color: var(--dsh-df-err); }

/* ── 采集运行页（命令式 board-runs）沿用类：只换皮不改 DOM ── */
.dsh-df-runs { padding: 22px 24px 56px; max-width: 1080px; margin: 0 auto; }
.dsh-df-item { background: var(--dsh-df-card); border: 1px dashed var(--dsh-df-line);
  border-radius: 10px; padding: 10px 14px; margin-bottom: 10px; cursor: pointer; }
.dsh-df-item:hover { border-color: #b8c3d9; }
.dsh-df-item.open { border: 1px dashed var(--dsh-df-accent); }
.dsh-df-row { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
.dsh-df-grow { flex: 1; min-width: 0; }
.dsh-df-cap { color: var(--dsh-df-ink-3); font-size: 11px; }
.dsh-df-chips { display: flex; gap: 10px; flex-wrap: wrap; font-size: 11px; color: var(--dsh-df-ink-3); }
.dsh-df-detail { display: none; margin-top: 10px; border-left: 2px solid var(--dsh-df-accent);
  background: #fdfdff; border-radius: 0 8px 8px 0; padding: 2px 0 2px 14px; }
.dsh-df-item.open > .dsh-df-detail { display: block; }
.dsh-df-block { margin: 10px 0; }
.dsh-df-block h3 { font-size: 12px; font-weight: 600; margin: 0 0 6px; color: var(--dsh-df-ink-2); }
.dsh-df-list { display: flex; flex-direction: column; gap: 2px; }
.dsh-df-line { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 12px; min-width: 0; }
.dsh-df-sample { cursor: pointer; }
.dsh-df-pre { font: 11px var(--dsh-df-mono); background: #f7f8fa; border: 1px solid var(--dsh-df-line);
  border-radius: 8px; padding: 8px 10px; margin: 4px 0 10px; white-space: pre-wrap;
  word-break: break-all; max-height: 220px; overflow: auto; }

/* ── 编排：视图头 / 面包屑 / 工具条（原型 .view-head .crumb .ob-toolbar） ── */
.dsh-df-view-head { display: flex; align-items: baseline; justify-content: space-between;
  margin-bottom: 14px; gap: 10px; flex-wrap: wrap; }
.dsh-df-view-head h1 { font-size: 17px; font-weight: 700; margin: 0; display: flex; align-items: center; gap: 8px; }
.dsh-df-view-head .dsh-df-sub { margin: 0; }
.dsh-df-crumb { display: flex; align-items: center; gap: 8px; margin-bottom: 14px;
  font-size: 12.5px; color: var(--dsh-df-ink-3); flex-wrap: wrap; }
.dsh-df-crumb button { border: none; background: none; padding: 0; cursor: pointer;
  color: var(--dsh-df-accent); font-weight: 600; font-size: 12.5px; }
.dsh-df-ob-toolbar { display: flex; gap: 10px; align-items: center; margin-bottom: 14px; flex-wrap: wrap; }
.dsh-df-ob-toolbar .dsh-df-search { flex: 1; min-width: 220px; max-width: 380px;
  border: 1px solid #d4d8df; border-radius: 8px; padding: 7px 12px; font-size: 13px;
  background: var(--dsh-df-card); font-family: inherit; }
.dsh-df-ob-toolbar .dsh-df-search:focus { outline: none; border-color: var(--dsh-df-accent);
  box-shadow: 0 0 0 3px var(--dsh-df-accent-soft); }
.dsh-df-ob-toolbar .dsh-df-ops { margin-left: auto; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.dsh-df-fmt-tag { font-size: 10.5px; color: var(--dsh-df-ink-3); border: 1px dashed var(--dsh-df-line);
  border-radius: 5px; padding: 2px 7px; white-space: nowrap; }

/* ── 编排：网站格子（原型 .site-grid） ── */
.dsh-df-site-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px; }
.dsh-df-site-card { background: var(--dsh-df-card); border: 1px solid var(--dsh-df-line);
  border-radius: var(--dsh-df-radius); padding: 16px 18px; cursor: pointer; text-align: left;
  font-family: inherit; transition: border-color .15s, box-shadow .15s; }
.dsh-df-site-card:hover { border-color: var(--dsh-df-accent); box-shadow: 0 4px 16px rgba(59,110,240,.10); }
.dsh-df-site-card .dsh-df-title { display: flex; align-items: center; gap: 8px; }
.dsh-df-site-card .dsh-df-title b { font-size: 14.5px; flex: 1; }
.dsh-df-site-card .dsh-df-host { font: 11.5px var(--dsh-df-mono); color: var(--dsh-df-ink-3); margin-top: 3px; }
.dsh-df-site-card .dsh-df-stats { display: flex; gap: 14px; margin-top: 12px; font-size: 11.5px;
  color: var(--dsh-df-ink-3); flex-wrap: wrap; }
.dsh-df-site-card .dsh-df-stats b { color: var(--dsh-df-ink-2); }
.dsh-df-site-card .dsh-df-foot { margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--dsh-df-line);
  display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--dsh-df-ink-3); }
.dsh-df-site-card .dsh-df-enter { color: var(--dsh-df-accent); font-weight: 600; font-size: 12px; }

/* ── 编排：类型标签（原型 .kind-tabs） ── */
.dsh-df-kind-tabs { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
.dsh-df-kind-tab { border: 1px solid var(--dsh-df-line); background: var(--dsh-df-card);
  border-radius: 999px; padding: 6px 18px; font-size: 13px; color: var(--dsh-df-ink-2);
  cursor: pointer; display: flex; align-items: center; gap: 8px; font-family: inherit; }
.dsh-df-kind-tab[aria-pressed="true"] { background: var(--dsh-df-accent-soft);
  border-color: var(--dsh-df-accent); color: var(--dsh-df-accent); font-weight: 600; }
.dsh-df-kind-tab small { font-size: 11px; color: var(--dsh-df-ink-3); font-weight: 400; }
.dsh-df-kind-tab[aria-pressed="true"] small { color: var(--dsh-df-accent); }

/* ── 编排：业务域 → 流程 → 版本 三级 ── */
.dsh-df-domain { background: var(--dsh-df-card); border: 1px solid var(--dsh-df-line);
  border-radius: var(--dsh-df-radius); margin-bottom: 14px; overflow: hidden; }
.dsh-df-domain-head { display: flex; align-items: center; gap: 10px; padding: 12px 18px;
  background: linear-gradient(90deg, #f8faff, #fff); border-bottom: 1px solid var(--dsh-df-line);
  cursor: pointer; border: none; width: 100%; text-align: left; font-family: inherit; }
.dsh-df-domain-head .dsh-df-dname { font-weight: 700; flex: 1; font-size: 13px; }
.dsh-df-domain-head .dsh-df-meta { color: var(--dsh-df-ink-3); font-size: 11px; }
.dsh-df-domain.dsh-df-collapsed .dsh-df-domain-body { display: none; }
.dsh-df-domain.dsh-df-collapsed .dsh-df-caret { transform: rotate(-90deg); }
.dsh-df-domain-body { padding: 10px 18px 14px; }
.dsh-df-flow { margin-left: 18px; padding-left: 16px; border-left: 2px solid var(--dsh-df-line); }
.dsh-df-flow + .dsh-df-flow { margin-top: 10px; }
.dsh-df-flow-head { display: flex; align-items: center; gap: 10px; padding: 9px 14px;
  border: 1px solid var(--dsh-df-line); border-radius: 10px; cursor: pointer; background: #fff;
  width: 100%; text-align: left; font-family: inherit; }
.dsh-df-flow-head:hover { border-color: #b8c3d9; }
.dsh-df-flow-head .dsh-df-fname { font-weight: 600; flex: 1; font-size: 13px; }
.dsh-df-flow-head .dsh-df-meta { color: var(--dsh-df-ink-3); font-size: 11px; }
.dsh-df-flow.dsh-df-collapsed .dsh-df-flow-body { display: none; }
.dsh-df-flow-body { padding: 8px 0 2px; }
.dsh-df-ver { margin-left: 26px; padding: 7px 0 7px 16px; border-left: 2px dashed #ead9c2;
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dsh-df-ver .dsh-df-vtag { font: 700 11px var(--dsh-df-mono); background: #f2f4f7;
  border-radius: 5px; padding: 1px 8px; }
.dsh-df-ver .dsh-df-vtag.dsh-df-cur { background: var(--dsh-df-ok-soft); color: var(--dsh-df-ok); }
.dsh-df-ver .dsh-df-vmeta { font-size: 11px; color: var(--dsh-df-ink-3); flex: 1; min-width: 160px; }

/* ── 编排：编排图行（原型 .graph） ── */
.dsh-df-graph { background: var(--dsh-df-card); border: 1px solid var(--dsh-df-line);
  border-radius: var(--dsh-df-radius); margin-bottom: 10px; display: flex; align-items: center;
  gap: 16px; padding: 12px 16px; transition: border-color .15s; }
.dsh-df-graph:hover { border-color: #b8c3d9; }
.dsh-df-graph .dsh-df-thumb { width: 132px; height: 64px; flex-shrink: 0; }
.dsh-df-graph .dsh-df-info { flex: 1; min-width: 0; }
.dsh-df-graph .dsh-df-gname { font-weight: 700; font-size: 13.5px; display: flex;
  align-items: center; gap: 8px; flex-wrap: wrap; }
.dsh-df-graph .dsh-df-gmeta { font-size: 11.5px; color: var(--dsh-df-ink-3); margin-top: 3px;
  display: flex; gap: 14px; flex-wrap: wrap; }
.dsh-df-graph .dsh-df-gmeta b { color: var(--dsh-df-ink-2); }
.dsh-df-graph .dsh-df-gops { display: flex; gap: 8px; flex-shrink: 0; flex-wrap: wrap; }

/* ── 编排：分页条（原型 .pagerbar） ── */
.dsh-df-pagerbar { display: flex; align-items: center; gap: 14px; margin-top: 18px; flex-wrap: wrap; }
.dsh-df-pagerbar .dsh-df-total { font-size: 12px; color: var(--dsh-df-ink-3); }
.dsh-df-pagerbar .dsh-df-pages { display: flex; gap: 4px; margin-left: auto; }
.dsh-df-pagerbar .dsh-df-pg { min-width: 30px; text-align: center; border: 1px solid var(--dsh-df-line);
  background: var(--dsh-df-card); border-radius: 6px; padding: 3px 8px; font-size: 12px;
  color: var(--dsh-df-ink-2); cursor: pointer; font-family: inherit; }
.dsh-df-pagerbar .dsh-df-pg[aria-current="true"] { background: var(--dsh-df-accent);
  border-color: var(--dsh-df-accent); color: #fff; font-weight: 600; }
.dsh-df-pagerbar .dsh-df-pg:disabled { opacity: .45; cursor: default; }

/* ── 编排：画布 ── */
.dsh-df-canvas-head { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
.dsh-df-canvas-name { font-size: 15px; font-weight: 700; }
.dsh-df-canvas-meta { font-size: 11.5px; color: var(--dsh-df-ink-3); }
.dsh-df-canvas-ops { margin-left: auto; display: flex; gap: 8px; }
.dsh-df-canvas-notice { white-space: pre-wrap; font: 11.5px var(--dsh-df-mono); background: #f7f8fa;
  border: 1px solid var(--dsh-df-line); border-radius: 8px; padding: 8px 10px; margin-bottom: 10px; }
.dsh-df-canvas-hint { font-size: 11px; color: var(--dsh-df-ink-3); margin-top: 8px; }
.dsh-df-flow-wrap { background: var(--dsh-df-card); border: 1px solid var(--dsh-df-line);
  border-radius: var(--dsh-df-radius); overflow: hidden; height: 560px; }

/* React Flow 自定义节点（原型 .rf-page-node / .rf-api-node / .rf-pill-node） */
.dsh-df-rf-node { background: #fff; border-radius: 10px; padding: 8px 14px; min-width: 170px;
  box-shadow: 0 2px 8px rgba(30,50,120,.08); }
.dsh-df-rf-page { border: 1.5px solid var(--dsh-df-accent); }
.dsh-df-rf-api { border: 1.5px solid #059669; min-width: 190px; }
.dsh-df-rf-t { display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 12.5px; }
.dsh-df-rf-u { font: 10.5px var(--dsh-df-mono); color: var(--dsh-df-ink-3); margin-top: 2px;
  word-break: break-all; }
.dsh-df-rf-pill { border: 1.5px solid #94a3b8; background: #f8fafc; color: var(--dsh-df-ink-2);
  border-radius: 999px; padding: 5px 20px; font-weight: 700; font-size: 12px; }
.dsh-df-rf-selected { outline: 2px solid var(--dsh-df-accent); outline-offset: 2px; }
.dsh-df-rf-toolbar { display: flex; gap: 6px; align-items: center; background: var(--dsh-df-card);
  border: 1px solid var(--dsh-df-line); border-radius: 10px; padding: 6px 8px;
  box-shadow: 0 2px 10px rgba(20,30,60,.08); flex-wrap: wrap; }
.dsh-df-rf-toolbar button { border: 1px solid var(--dsh-df-line); background: #fff; border-radius: 6px;
  padding: 3px 10px; font-size: 12px; color: var(--dsh-df-ink-2); cursor: pointer; font-family: inherit; }
.dsh-df-rf-toolbar button:hover { border-color: var(--dsh-df-accent); color: var(--dsh-df-accent); }
.dsh-df-rf-hint { font-size: 10.5px; color: var(--dsh-df-ink-3); padding: 0 6px; }
.dsh-df-rf-panel { width: 264px; background: var(--dsh-df-card); border: 1px solid var(--dsh-df-line);
  border-radius: 10px; padding: 12px 14px; box-shadow: 0 8px 28px rgba(20,30,60,.12); font-size: 12px; }
.dsh-df-rf-panel h3 { font-size: 13px; margin: 0 0 4px; display: flex; justify-content: space-between;
  align-items: center; gap: 8px; }
.dsh-df-rf-close { border: none; background: none; cursor: pointer; color: var(--dsh-df-ink-3);
  font-size: 13px; padding: 0; }
.dsh-df-rf-panel label { display: block; font-size: 11px; color: var(--dsh-df-ink-3); margin: 8px 0 3px; }
.dsh-df-rf-panel input, .dsh-df-rf-panel textarea { width: 100%; border: 1px solid #d4d8df;
  border-radius: 6px; padding: 5px 8px; font-size: 12px; font-family: inherit; box-sizing: border-box; }
.dsh-df-rf-panel input:focus, .dsh-df-rf-panel textarea:focus { outline: none;
  border-color: var(--dsh-df-accent); }
.dsh-df-rf-panel input[readonly] { background: #f7f8fa; color: var(--dsh-df-ink-3); }
.dsh-df-rf-row { display: flex; gap: 8px; }
.dsh-df-rf-row > div { flex: 1; min-width: 0; }

/* ── 编排：新建流程弹窗（原型 .modal） ── */
.dsh-df-modal-mask { position: fixed; inset: 0; background: rgba(20,28,45,.38);
  display: flex; align-items: center; justify-content: center; z-index: 100; }
.dsh-df-modal { width: 440px; max-width: calc(100vw - 40px); background: var(--dsh-df-card);
  border-radius: 14px; padding: 20px 22px; box-shadow: 0 18px 60px rgba(15,25,55,.25); }
.dsh-df-modal h2 { font-size: 15px; margin: 0 0 4px; }
.dsh-df-modal .dsh-df-sub { margin-bottom: 14px; }
.dsh-df-field { margin-bottom: 12px; }
.dsh-df-field label { display: block; font-size: 12px; color: var(--dsh-df-ink-2); margin-bottom: 4px; }
.dsh-df-field input, .dsh-df-field select, .dsh-df-field textarea { width: 100%;
  border: 1px solid #d4d8df; border-radius: 8px; padding: 7px 10px; font-size: 13px;
  font-family: inherit; background: #fff; box-sizing: border-box; }
.dsh-df-field input:focus, .dsh-df-field select:focus, .dsh-df-field textarea:focus {
  outline: none; border-color: var(--dsh-df-accent); box-shadow: 0 0 0 3px var(--dsh-df-accent-soft); }
.dsh-df-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.dsh-df-modal-ops { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.dsh-df-errline { display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  background: var(--dsh-df-err-soft); color: var(--dsh-df-err); border: 1px solid #f3c2c2;
  border-radius: 8px; padding: 8px 12px; font-size: 12px; margin-bottom: 12px; }
`

/**
 * 在屏即确认样式在场（页面切换后自愈复注入）；幂等，可安全反复调用。
 */
export function injectStyles(): void {
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

/* ══════════════════════════ 编排页（R-2） ══════════════════════════ */

/** React Flow 结构样式（自动生成的字符串，见 scripts/gen-xyflow-css.mjs）。 */
export const XYFLOW_STYLE_ID = 'dsh-dataforge-xyflow-styles'

/**
 * 幂等注入一段 CSS（id 去重）。
 *
 * React Flow 的样式只能这样进来：client 半边只会分发一个 .cjs，CSS 文件没人加载。
 * 与 injectStyles 同一套路，只是内容来源不同（那边是手写 tokens，这边是上游产物）。
 */
export function injectCssOnce(id: string, css: string): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(id) !== null) return
  const style = document.createElement('style')
  style.id = id
  style.textContent = css
  document.head.appendChild(style)
}
