#!/usr/bin/env python3
"""dsh-dataforge 接口采集插件实现后流程图（Pillow 手绘，无 matplotlib）。"""
from PIL import Image, ImageDraw, ImageFont

W, H = 1680, 1240
img = Image.new("RGB", (W, H), "#fafbfc")
dr = ImageDraw.Draw(img)

FONT_PATHS = [
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/STHeiti Light.ttc",
]

def font(size: int) -> ImageFont.FreeTypeFont:
    for p in FONT_PATHS:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    return ImageFont.load_default()

F_TITLE = font(40)
F_BOX = font(24)
F_BODY = font(19)
F_SMALL = font(17)

C = {
    "ink": "#1f2933",
    "user": ("#e0f2fe", "#0284c7"),
    "tool": ("#ede9fe", "#7c3aed"),
    "gate": ("#fef3c7", "#d97706"),
    "exec": ("#dcfce7", "#16a34a"),
    "browser": ("#cffafe", "#0891b2"),
    "norm": ("#fce7f3", "#db2777"),
    "store": ("#f1f5f9", "#475569"),
    "out": ("#ecfccb", "#65a30d"),
    "future": ("#ffffff", "#9ca3af"),
}

def text_size(t, f):
    bb = dr.textbbox((0, 0), t, font=f)
    return bb[2] - bb[0], bb[3] - bb[1]

def box(x, y, w, h, title, lines=(), colors=None, dash=False, title_font=None):
    fill, edge = colors or C["tool"]
    if dash:
        # 虚线边框：分段画
        seg, gap, r = 14, 8, 14
        dr.rounded_rectangle([x, y, x + w, y + h], radius=r, fill=fill)
        _dash_rect(x, y, w, h, edge, seg, gap)
    else:
        dr.rounded_rectangle([x, y, x + w, y + h], radius=14, fill=fill, outline=edge, width=3)
    tf = title_font or F_BOX
    tw, th = text_size(title, tf)
    dr.text((x + (w - tw) / 2, y + 12), title, font=tf, fill=C["ink"])
    ty = y + 12 + th + 10
    for ln in lines:
        dr.text((x + 18, ty), ln, font=F_BODY, fill="#374151")
        ty += text_size(ln, F_BODY)[1] + 8

def _dash_line(x1, y1, x2, y2, color, seg=14, gap=8, width=3):
    import math
    total = math.hypot(x2 - x1, y2 - y1)
    if total == 0:
        return
    dx, dy = (x2 - x1) / total, (y2 - y1) / total
    d = 0.0
    while d < total:
        e = min(d + seg, total)
        dr.line([x1 + dx * d, y1 + dy * d, x1 + dx * e, y1 + dy * e], fill=color, width=width)
        d = e + gap

def _dash_rect(x, y, w, h, color, seg, gap):
    _dash_line(x, y, x + w, y, color, seg, gap)
    _dash_line(x + w, y, x + w, y + h, color, seg, gap)
    _dash_line(x + w, y + h, x, y + h, color, seg, gap)
    _dash_line(x, y + h, x, y, color, seg, gap)

def arrow(x1, y1, x2, y2, color="#64748b", dash=False, label=None, label_side=1, width=3):
    if dash:
        _dash_line(x1, y1, x2, y2, color)
    else:
        dr.line([x1, y1, x2, y2], fill=color, width=width)
    # 箭头
    import math
    ang = math.atan2(y2 - y1, x2 - x1)
    L = 14
    for da in (2.6, -2.6):
        dr.line(
            [x2, y2, x2 + L * math.cos(ang + da), y2 + L * math.sin(ang + da)],
            fill=color, width=width,
        )
    if label:
        tw, th = text_size(label, F_SMALL)
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        dr.rectangle([mx - tw / 2 - 6, my - th / 2 - 4 - 14 * label_side, mx + tw / 2 + 6, my + th / 2 + 4 - 14 * label_side], fill="#fafbfc")
        dr.text((mx - tw / 2, my - th / 2 - 14 * label_side), label, font=F_SMALL, fill=color)

# ── 标题 ──
t = "dsh-dataforge 接口采集插件 · 实现后流程（MVP-1 实线 / 下期虚线）"
tw, th = text_size(t, F_TITLE)
dr.text(((W - tw) / 2, 24), t, font=F_TITLE, fill=C["ink"])

# ── ① 会话层 ──
box(120, 100, 380, 96, "用户", ["给出 URL / 凭据 / 确认写操作"], C["user"])
box(1180, 100, 380, 96, "DSH Agent（对话）", ["决步、填表智能、如实转述"], C["user"])
arrow(500, 148, 1180, 148, label="发起采集 / 确认")
arrow(1180, 176, 500, 176, label="回执 / 进度 / 卡片报告")

# ── ② 工具面 ──
box(60, 250, 480, 128, "dataforge_capture（发起）",
    ["task_type: single_page | site_crawl | action", "entry_url / confirm / maxDepth / maxPages"], C["tool"])
box(600, 250, 480, 128, "dataforge_browser_*（原语）",
    ["open → snapshot → act(click/fill/press/", "submit/wait/goto) → close（agent 驾驶）"], C["tool"])
box(1140, 250, 480, 128, "capture_status / result / cancel",
    ["status 轮询进度 · result 取 cards/samples/", "credentials/pages · cancel 终止"], C["tool"])
arrow(740, 196, 740, 250, label="工具调用")

# ── ③ 编排层（三道闸 + 两路径）──
box(60, 432, 700, 150, "application 编排 · 闸",
    ["① entryUrl 合法性 + taskType 白名单（bad-url / bad-task）",
     "② action = 真实 UI 写操作 → 用户 confirm=true 才放行",
     "③ 自治任务投 ctx.jobs 后台 job（缺席 → 前台降级标注）"], C["gate"])
arrow(300, 378, 300, 432, label="capture")

box(60, 640, 330, 130, "自治路径（worker）",
    ["single_page：开页等网络静默", "site_crawl：同域 BFS 逐页", "（深度≤3 / 页数≤50 诚实截断）"], C["exec"])
box(430, 640, 330, 130, "agent 驱动路径",
    ["action：SessionRegistry 开会话", "bindSink 旁落记录", "close 时收 cookie 结卡"], C["exec"])
arrow(240, 582, 240, 640)
arrow(520, 582, 560, 640, label="action", label_side=-1)
arrow(720, 378, 720, 705, label="browser_*")
arrow(720, 705, 760, 705)

# ── ④ Browser 层 ──
box(60, 830, 700, 120, "browser 层：系统无头 Chrome + 旁路监听",
    ["--disable-blink-features=AutomationControlled · 只收 xhr/fetch",
     "WireSample：url/method/status/headers/postData/responseText"], C["browser"])
arrow(240, 770, 240, 830)
arrow(600, 770, 600, 830)

# ── ⑤ 归一化 + 存储 ──
box(880, 432, 360, 150, "Normalizer（纯函数）",
    ["URL 归一化：路径段抽 {p}、query 排序", "mergeKey 跨页归并同一接口", "jsonToTemplate + 多样本 diff 标 role"], C["norm"])
box(1300, 432, 348, 150, "CaptureStore（SQLite）",
    ["capture_runs / pages", "request_samples（厚数据留档）", "interface_cards / credentials"], C["store"])
arrow(760, 890, 880, 507, label="样本流", label_side=-1)
arrow(1240, 507, 1320, 507)

# ── ⑥ 出口 ──
box(880, 640, 360, 130, "工具出口",
    ["capture_status：runs 表投影", "capture_result：按 scope 分页", "capture_cancel：终止运行"], C["out"])
box(1320, 640, 320, 130, "面板只读 API",
    ["GET /dashboard/api/dataforge", "runs / runs/:id / cards", "出口闸：凭证原文剥壳不出站"], C["out"])
arrow(1480, 582, 1480, 640)
arrow(1060, 582, 1060, 640)
arrow(1240, 705, 1320, 705)

# ── ⑦ 下期（虚线）：编排执行 = 纯 HTTP 直调，无浏览器 ──
box(880, 830, 760, 150, "下期：编排 → 自动调用（设计已封存，未实现）",
    ["采集包导入项目接口库 → 编排 DAG（绑定即依赖）→ 拓扑调度",
     "执行器：按卡片模板参数化出入参，纯 HTTP 直调（无浏览器）",
     "凭证卡注入 cookie/token · 401 自动重登换票 · 结晶 → 复跑"],
    C["future"], dash=True)
_dash_line(1200, 770, 1200, 830, "#9ca3af")
arrow(1200, 770, 1200, 830, color="#9ca3af", dash=True)
lbl = "接口卡片库"
lw, lh = text_size(lbl, F_SMALL)
dr.rectangle([1214, 788, 1214 + lw + 12, 788 + lh + 8], fill="#fafbfc")
dr.text((1220, 792), lbl, font=F_SMALL, fill="#9ca3af")

# ── 底部注释 ──
notes = [
    "边界：浏览器只在采集段使用（把接口从真实 UI 里逼出来）；编排/复跑段拿卡片模板 + 凭证卡直接发 HTTP，不经过浏览器",
    "纪律：写操作仅 action 任务制 + 用户确认 · 凭证只存本地 SQLite 不进日志 · 风控/验证码/超限如实回报",
    "留痕：<dataRoot>/capture/capture.sqlite + samples/ + events.ndjson（唯一事实源）",
]
y = 1010
for n in notes:
    dr.text((60, y), n, font=F_BODY, fill="#6b7280")
    y += 34

out = "/Volumes/ORICO/doc/github/dsh/dsh-dataforge/docs/capture-flow-diagram.png"
img.save(out)
print(out)
