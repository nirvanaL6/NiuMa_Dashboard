"""待办模块冒烟：三视图渲染 + 新建/编辑 + 拖拽打标/排期 + 四宫格互斥 + 缩放 + 施工中拦截

前置：python3 -m http.server 8765（项目根）+ wrangler dev（server/）
运行：python3 test/todo_flow.py
"""
import json
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8765/index.html"
SHOT = "/tmp/wd-todo"
fails = []
def chk(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond: fails.append(msg)

def data(pg):
    return pg.evaluate("JSON.parse(localStorage.getItem('wd-data'))")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 1500, "height": 940})
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.text) if m.type == "error" else None)
    pg.on("dialog", lambda d: d.accept())
    pg.goto(URL, wait_until="networkidle")
    pg.wait_for_timeout(1000)

    # ---------- 0. 施工中拦截 ----------
    for mod in ["news", "food", "salary", "report"]:
        pg.click(f'[data-module="{mod}"]'); pg.wait_for_timeout(420)
        chk(pg.locator(".wip h3").count() == 1 and pg.locator(".wip h3").inner_text() == "施工中", f"{mod} 显示施工中")
    pg.screenshot(path=f"{SHOT}-wip.png")

    # ---------- 1. 项目&待办 ----------
    pg.click('[data-module="todo"]'); pg.wait_for_timeout(700)
    chk(pg.locator("#projectList .pj").count() == 2, f"项目卡片 {pg.locator('#projectList .pj').count()} 个")
    chk(pg.locator("#looseList .td").count() > 0, f"独立待办 {pg.locator('#looseList .td').count()} 条")
    chk(pg.locator(".td__check").count() == len(data(pg)["todos"]), "每条待办都有勾选框")
    pg.screenshot(path=f"{SHOT}-list.png")

    # 勾选完成
    first = pg.locator("#looseList .td").first
    tid = first.get_attribute("data-id")
    first.locator(".td__check").click(); pg.wait_for_timeout(500)
    chk(any(t["id"] == tid and t["done"] for t in data(pg)["todos"]), "勾选后 done=true 落库")
    pg.locator(f'[data-toggle-todo="{tid}"]').click(); pg.wait_for_timeout(400)

    # 新建项目
    pg.click('[data-new-task="project"]'); pg.wait_for_timeout(500)
    chk(pg.locator(".ed-mask.open").count() == 1, "新建项目弹出编辑器")
    chk(pg.locator('#edProject').count() == 0, "项目编辑器不显示「所属项目」")
    pg.screenshot(path=f"{SHOT}-editor-project.png")
    pg.fill("#edTitleInput", "冒烟测试项目")
    pg.fill("#edDue", "2026-11-05T18:30")
    pg.fill("#edPlan", "2026-11-03T10:00")
    pg.click('[data-quad-pick="q2"]', force=True); pg.wait_for_timeout(200)
    pg.click('[data-tag-pick="评审"]', force=True); pg.wait_for_timeout(200)
    pg.click("#edTagNew", force=True); pg.fill("#edTagNew", "冒烟")
    pg.click("[data-tag-add]", force=True); pg.wait_for_timeout(300)
    pg.screenshot(path=f"{SHOT}-editor-filled.png")
    pg.click("[data-ed-save]"); pg.wait_for_timeout(700)
    d = data(pg)
    np = [x for x in d["projects"] if x["title"] == "冒烟测试项目"]
    chk(len(np) == 1, "项目已保存")
    if np:
        pp = np[0]
        chk(pp["due"] == "2026-11-05T18:30", f"截止时间保存 {pp['due']}")
        chk(pp["planAt"] == "2026-11-03T10:00", f"计划日期保存 {pp['planAt']}")
        chk("q2" in pp["tags"] and "评审" in pp["tags"] and "冒烟" in pp["tags"], f"Tag 保存 {pp['tags']}")
    chk(pg.locator("#projectList .pj").count() == 3, "项目列表刷新为 3 个")

    # 在项目下新建待办
    pg.locator("#projectList .pj").last.locator("[data-add-todo-to]").click(); pg.wait_for_timeout(500)
    chk(pg.locator("#edProject").input_value() == np[0]["id"], "从项目 + 进入时预选所属项目")
    pg.fill("#edTitleInput", "冒烟子待办")
    pg.click('[data-quad-pick="q1"]', force=True); pg.wait_for_timeout(150)
    pg.click('[data-quad-pick="q3"]', force=True); pg.wait_for_timeout(150)
    pg.click("[data-ed-save]"); pg.wait_for_timeout(700)
    d = data(pg)
    nt = [t for t in d["todos"] if t["title"] == "冒烟子待办"]
    chk(len(nt) == 1 and nt[0]["projectId"] == np[0]["id"], "子待办归属项目正确")
    chk(nt and [x for x in nt[0]["tags"] if x.startswith("q")] == ["q3"], f"四宫格互斥，只留最后一选 {nt[0]['tags'] if nt else None}")

    # 编辑改回不分格
    pg.locator(f'[data-edit-todo="{nt[0]["id"]}"]').click(); pg.wait_for_timeout(500)
    pg.click('[data-quad-pick=""]', force=True); pg.wait_for_timeout(150)
    pg.click("[data-ed-save]"); pg.wait_for_timeout(600)
    nt = [t for t in data(pg)["todos"] if t["title"] == "冒烟子待办"]
    chk(not [x for x in nt[0]["tags"] if x.startswith("q")], "四宫格可清空")

    # ESC 关闭
    pg.click('[data-new-task="todo"]'); pg.wait_for_timeout(400)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
    chk(pg.locator(".ed-mask").count() == 0, "ESC 关闭编辑器")

    # ---------- 2. 四宫格 ----------
    pg.click('#segNav button:has-text("四宫格")'); pg.wait_for_timeout(700)
    chk(pg.locator(".quad-cell").count() == 4, "四宫格渲染 4 格")
    pg.screenshot(path=f"{SHOT}-quad.png")

    # 把待分类条目拖进 q1
    side = pg.locator("#quadSide .qi").first
    item_title = side.locator(".qi__txt").inner_text()
    drop_target = pg.locator('[data-drop="quad:q1"]')
    side.drag_to(drop_target); pg.wait_for_timeout(800)
    d = data(pg)
    moved = [x for x in (d["projects"] + d["todos"]) if x["title"] == item_title and "q1" in x["tags"]][0]
    chk("q1" in moved["tags"], f"拖入 q1 后自动打标：{item_title} → {moved['tags']}")
    chk(pg.locator('[data-drop="quad:q1"] .qi').count() >= 1, "q1 格子内出现条目")

    # 跨格拖动：q1 → q4（互斥）
    pg.locator('[data-drop="quad:q1"] .qi').first.drag_to(pg.locator('[data-drop="quad:q4"]')); pg.wait_for_timeout(800)
    d = data(pg)
    q1n = len([x for x in (d["projects"] + d["todos"]) if "q1" in x["tags"]])
    q4n = len([x for x in (d["projects"] + d["todos"]) if "q4" in x["tags"]])
    print("   q1:", q1n, "q4:", q4n)
    chk(len([x for x in (d["projects"] + d["todos"]) if len([t for t in x["tags"] if t.startswith("q")]) > 1]) == 0,
        "任何条目最多只有一个四宫格标签")
    pg.screenshot(path=f"{SHOT}-quad-after.png")

    # ---------- 3. 概览 ----------
    pg.click('#segNav button:has-text("概览")'); pg.wait_for_timeout(800)
    chk(pg.locator(".ov-grid--week").count() == 1, "默认周视图")
    chk(pg.locator(".ov-grid--week .day").count() == 7, f"周视图 7 列：{pg.locator('.ov-grid--week .day').count()}")
    pg.screenshot(path=f"{SHOT}-ov-week.png")

    # 拖一条到未来某天
    src = pg.locator("#ovCanvas .de").first
    src_title = src.locator(".de__txt").inner_text()
    target_day = pg.locator(".ov-grid--week .day").nth(5)
    day_key = target_day.get_attribute("data-day")
    src.drag_to(target_day); pg.wait_for_timeout(800)
    d = data(pg)
    hit = [x for x in (d["projects"] + d["todos"]) if x["title"] == src_title][0]
    chk(str(hit["planAt"]).startswith(day_key), f"拖到 {day_key} 后 planAt={hit['planAt']}")

    # 日 / 月切换
    pg.click('[data-range="day"]'); pg.wait_for_timeout(600)
    chk(pg.locator(".ov-day").count() == 1, "切到日视图")
    pg.screenshot(path=f"{SHOT}-ov-day.png")
    pg.click('[data-range="month"]'); pg.wait_for_timeout(600)
    chk(pg.locator(".ov-grid--month .day").count() == 42, f"月视图 42 格：{pg.locator('.ov-grid--month .day').count()}")

    # 缩放
    def scale_state():
        return pg.evaluate("""() => {
          const c = document.querySelector('#ovCanvas');
          const de = document.querySelector('#ovCanvas .de__txt') || document.querySelector('#ovCanvas .day__num');
          const day = document.querySelector('#ovCanvas .day');
          const cs = getComputedStyle(day);
          // 横向溢出检查：内部元素是否超出 canvas
          const cw = c.clientWidth, iw = c.scrollWidth;
          return { fs: parseFloat(getComputedStyle(c).fontSize), val: document.querySelector('#ovZoomVal').textContent,
                   hScroll: iw > cw + 1, tOver: de ? de.scrollWidth > de.clientWidth + 1 || getComputedStyle(de).textOverflow === 'ellipsis' : null };
        }""")
    s0 = scale_state()
    for _ in range(4):
        pg.click('[data-zoom="-1"]'); pg.wait_for_timeout(200)
    s_min = scale_state()
    for _ in range(8):
        pg.click('[data-zoom="1"]'); pg.wait_for_timeout(200)
    s_max = scale_state()
    print("   缩放:", s0["val"], "→", s_min["val"], "→", s_max["val"], "| 字号", s0["fs"], s_min["fs"], s_max["fs"])
    chk(s_min["val"] == "60%" and s_max["val"] == "160%", "缩放区间 60%–160% 封顶生效")
    chk(s_max["fs"] > s0["fs"] > s_min["fs"], "字号随缩放联动")
    chk(s_max["tOver"] is True, "放大到 160% 时文字按省略号截断（不撑破格子）")
    pg.screenshot(path=f"{SHOT}-ov-month-160.png")

    # 缩放值持久化
    pg.reload(wait_until="networkidle"); pg.wait_for_timeout(900)
    chk(abs(data(pg)["overviewScale"] - 1.6) < 1e-6, f"缩放值持久化 {data(pg)['overviewScale']}")
    chk(pg.locator("#ovZoomVal").inner_text() == "160%", "重载后缩放值回显 160%")

    # 删除测试数据，保持种子干净
    pg.evaluate("""() => {
      const d = JSON.parse(localStorage.getItem('wd-data'));
      d.projects = d.projects.filter(p => !p.title.startsWith('冒烟'));
      d.todos = d.todos.filter(t => !t.title.startsWith('冒烟'));
      localStorage.setItem('wd-data', JSON.stringify(d));
    }""")

    chk(not errs, "无 JS 报错" + ("" if not errs else "：" + " | ".join(errs[:4])))
    b.close()

print("\nFAILS:", json.dumps(fails, ensure_ascii=False) if fails else "[]")
