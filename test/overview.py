"""总览模块回归：四块等宽卡片 / 时钟走秒 / 当日待办 / 资讯速览可选源 / 快捷入口

接口全部打桩，不依赖外网与真实 Worker：
  - 热榜：四路都有数据
  - 待办：用预置数据（首次打开会 seed）

运行：python3 test/overview.py
"""
import json
from datetime import date, timedelta
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8765/index.html"
SHOT = "/tmp/ov-test"
fails = []


def chk(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        fails.append(msg)


def board(bid, label, accent, n=12):
    items = [{
        "id": f"{bid}-{i}", "rank": i + 1,
        "title": f"{label}第 {i + 1} 条内容",
        "url": f"https://example.com/{bid}/{i}",
        "hot": f"{120 - i * 3}.4万", "source": label,
    } for i in range(n)]
    return {"id": bid, "label": label, "accent": accent,
            "home": f"https://example.com/{bid}", "items": items, "error": ""}


HOT = {"ok": True, "fetchedAt": 1794700000000, "boards": [
    board("weibo", "微博热搜", "#f43f5e"),
    board("baidu", "百度热搜", "#3b82f6"),
    board("zhihu", "知乎热榜", "#6366f1"),
    board("wechat", "微信热文", "#22b573"),
]}


def stub(page):
    def handler(route):
        req = route.request
        if req.method == "OPTIONS":
            return route.fulfill(status=204, headers={
                "access-control-allow-origin": "*",
                "access-control-allow-methods": "GET,POST,OPTIONS",
                "access-control-allow-headers": "content-type",
            })
        if "/api/news/hot" in req.url:
            return route.fulfill(status=200, content_type="application/json", body=json.dumps(HOT))
        if "/api/news/feed" in req.url:
            return route.fulfill(status=200, content_type="application/json", body=json.dumps({"ok": True, "sources": []}))
        return route.continue_()

    page.route("**/api/news/**", handler)
    page.route("**/api/news/hot**", handler)


def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 1500, "height": 1000})
        pg = ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        stub(pg)
        pg.goto(URL, wait_until="networkidle")
        pg.wait_for_timeout(1200)

        # ---------- 1. 标题与描述 ----------
        chk(pg.locator("#panelTitle").inner_text().strip() == "总览", "模块标题为「总览」")
        chk(pg.locator("#panelDesc").inner_text().strip() == "自定义总览页", "描述为「自定义总览页」")
        chk(pg.locator(".navrow").is_hidden(), "总览不显示二级导航条")
        chk(pg.locator("#segNav button").count() == 0, "总览没有二级导航按钮")
        chk(pg.locator("#segNav").is_hidden(), "二级导航容器整体隐藏")

        # ---------- 2. 四块卡片 ----------
        chk(pg.locator(".ovw-card").count() == 4, f"四块卡片（{pg.locator('.ovw-card').count()}）")
        widths = pg.eval_on_selector_all(".ovw-card", "els => els.map(e => Math.round(e.getBoundingClientRect().width))")
        chk(len(set(widths)) == 1, f"四块卡片等宽（{widths}）")
        heights = pg.eval_on_selector_all(".ovw-card", "els => els.map(e => Math.round(e.getBoundingClientRect().height))")
        chk(len(set(heights)) >= 3, f"卡片高度各自随内容，未被拉平（{heights}）")

        # 左上时钟 / 左下待办 / 右上资讯 / 右下入口
        boxes = pg.eval_on_selector_all(".ovw-card", "els => els.map(e => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y) }; })")
        left_x = min(b["x"] for b in boxes)
        right_x = max(b["x"] for b in boxes)
        clock, todos, news, links = boxes
        chk(clock["x"] == left_x and todos["x"] == left_x, "时钟与待办在左列")
        chk(news["x"] == right_x and links["x"] == right_x, "资讯与快捷入口在右列")
        chk(clock["y"] < todos["y"], "时钟在待办之上")
        chk(news["y"] < links["y"], "资讯在快捷入口之上")

        # ---------- 3. 北京时间精确到秒 ----------
        clock_txt = pg.locator(".ovw-clock__hm").inner_text().strip()
        sec1 = pg.locator('[data-ov-clock="s"]').inner_text().strip()
        chk(len(clock_txt) == 5 and clock_txt[2] == ":", f"时:分格式 {clock_txt}")
        chk(sec1.isdigit() and len(sec1) == 2, f"秒为两位数字（{sec1}）")
        pg.wait_for_timeout(1600)
        sec2 = pg.locator('[data-ov-clock="s"]').inner_text().strip()
        chk(sec1 != sec2, f"秒在走动（{sec1} → {sec2}）")
        chk(pg.locator(".ovw-clock__date").inner_text().count("年") == 1, "显示年月日与星期")

        # ---------- 4. 当日待办 ----------
        rows = pg.locator(".ovw-todo")
        chk(rows.count() > 0, f"当日待办有 {rows.count()} 条")
        tid = rows.first.get_attribute("data-todo-row")
        chk(pg.locator(f'[data-toggle-todo="{tid}"]').count() == 1, "待办带勾选框")
        pg.locator(f'[data-toggle-todo="{tid}"]').click()
        pg.wait_for_timeout(400)
        cls = pg.locator(f'[data-todo-row="{tid}"]').first.get_attribute("class") or ""
        chk("is-done" in cls, "勾选后标记为已完成")
        st = pg.locator('[data-toggle-todo="%s"]' % tid).first.get_attribute("aria-checked")
        chk(st == "true", "勾选框 aria-checked 同步")
        # 再点回来，别影响后续用例
        pg.locator(f'[data-toggle-todo="{tid}"]').click()
        pg.wait_for_timeout(300)

        # ---------- 5. 资讯速览：默认四路 ----------
        pg.wait_for_timeout(1500)
        chk(pg.locator(".ovw-src").count() == 4, f"默认显示四路资讯（{pg.locator('.ovw-src').count()}）")
        heads = [t.strip() for t in pg.locator(".ovw-src__head b").all_inner_texts()]
        chk("微博热搜" in heads and "微信热文" in heads, f"资讯源标题正确（{heads}）")
        per = pg.locator(".ovw-src").first.locator(".ovw-src__list a")
        chk(per.count() == 4, f"每个源速览 4 条（{per.count()}）")
        chk(pg.locator(".ovw-src__list a img").count() == 0, "速览条目不配图")
        tgt = per.first.get_attribute("target")
        chk(tgt == "_blank", "速览条目新窗口打开")

        # ---------- 6. 选择显示哪些资讯列表 ----------
        pg.locator('[data-ov-act="pick-src"]').first.click()
        pg.wait_for_timeout(300)
        chk(pg.locator("[data-ov-picker]").is_visible(), "勾选面板可展开")
        chk(pg.locator("[data-ov-src]").count() == 4, "面板列出四个源")
        pg.locator('[data-ov-src="baidu"]').uncheck()
        pg.wait_for_timeout(700)
        chk(pg.locator(".ovw-src").count() == 3, "取消勾选后少一列")
        chk(pg.locator("[data-ov-picker]").is_visible(), "重绘后面板保持展开")
        # 全部取消 → 空态
        for sid in ["weibo", "zhihu", "wechat"]:
            pg.locator(f'[data-ov-src="{sid}"]').uncheck()
            pg.wait_for_timeout(400)
        chk(pg.locator(".ovw-src").count() == 0, "全部取消后没有资讯块")
        chk(pg.locator(".ovw-news .ovw-empty").count() == 1, "全部取消后有空态提示")
        # 恢复一个
        pg.locator('[data-ov-src="weibo"]').check()
        pg.wait_for_timeout(600)
        chk(pg.locator(".ovw-src").count() == 1, "重新勾选后恢复显示")

        # ---------- 7. 快捷入口 ----------
        pg.locator('[data-ov-act="add-link"]').first.click()
        pg.wait_for_timeout(300)
        chk(pg.locator("#ovLinkUrl").is_visible(), "添加入口弹窗打开")
        # 非法地址
        pg.fill("#ovLinkUrl", "not a url")
        pg.locator("[data-ov-ok]").click()
        pg.wait_for_timeout(200)
        err = pg.locator("[data-ov-err]").inner_text().strip()
        chk(err != "", f"非法地址给出提示（{err}）")
        # 正常地址（省略协议）
        pg.fill("#ovLinkUrl", "github.com/nirvanaL6")
        pg.fill("#ovLinkName", "GitHub")
        pg.locator("[data-ov-ok]").click()
        pg.wait_for_timeout(600)
        chk(pg.locator(".ovw-link").count() == 1, "添加快捷入口成功")
        chk(pg.locator(".ovw-link__txt b").first.inner_text().strip() == "GitHub", "入口标题正确")
        href = pg.locator(".ovw-link > a").first.get_attribute("href")
        chk(href.startswith("https://github.com/"), f"自动补全协议（{href}）")
        chk(pg.locator(".ovw-link > a").first.get_attribute("target") == "_blank", "入口新窗口打开")

        # 重复添加
        pg.locator('[data-ov-act="add-link"]').first.click()
        pg.wait_for_timeout(250)
        pg.fill("#ovLinkUrl", "https://github.com/nirvanaL6")
        pg.locator("[data-ov-ok]").click()
        pg.wait_for_timeout(250)
        chk("已经加过" in pg.locator("[data-ov-err]").inner_text(), "重复地址被拦下")
        pg.locator("[data-ov-close]").first.click()
        pg.wait_for_timeout(200)

        # ---------- 8. 持久化 ----------
        pg.reload(wait_until="networkidle")
        pg.wait_for_timeout(1500)
        chk(pg.locator(".ovw-link").count() == 1, "刷新后快捷入口仍在")
        chk(pg.locator(".ovw-src").count() == 1, "刷新后资讯源选择仍在")
        chk(not pg.locator("[data-ov-picker]").is_visible(), "刷新后勾选面板默认收起")

        # ---------- 9. 删除入口 ----------
        pg.locator(".ovw-link").first.hover()
        pg.locator('[data-ov-act="del-link"]').first.click(force=True)
        pg.wait_for_timeout(400)
        chk(pg.locator(".ed-mask").count() == 1, "删除走应用内确认框")
        pg.locator('[data-dlg="ok"]').click()
        pg.wait_for_timeout(600)
        chk(pg.locator(".ovw-link").count() == 0, "确认后入口被删除")

        # ---------- 10. 离开再回来，面板收起 ----------
        pg.locator('[data-module="todo"]').click()
        pg.wait_for_timeout(500)
        pg.locator('[data-module="overview"]').click()
        pg.wait_for_timeout(700)
        chk(not pg.locator("[data-ov-picker]").is_visible(), "切走再回来勾选面板已收起")
        chk(pg.locator(".ovw-card").count() == 4, "回来仍是四块卡片")

        # ---------- 11. 当日待办口径：计划今天 + 截止非今天，也必须出现 ----------
        base = pg.evaluate("() => JSON.parse(localStorage.getItem('wd-data'))")
        today = pg.evaluate("() => { const d = new Date(); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); }")
        day = lambda n: (date.fromisoformat(today) + timedelta(days=n)).isoformat()
        def todo(tid, title, plan, due):
            return {"id": tid, "title": title, "tags": ["urgent", "important"],
                    "planAt": plan, "due": due, "projectId": "", "done": False,
                    "createdAt": "2026-01-01T00:00:00.000Z"}
        base["todos"] = [
            todo("t-plan-today-due-later", "计划今天截止下周", f"{today}T09:00", f"{day(7)}T18:00"),
            todo("t-plan-past-due-today", "计划上周截止今天", f"{day(-7)}T09:00", f"{today}T20:00"),
            todo("t-plan-today-only", "只排了今天", f"{today}T14:30", ""),
            todo("t-past-only", "上周计划没做完", f"{day(-3)}T10:00", ""),
            todo("t-future", "下周才做", f"{day(7)}T10:00", f"{day(8)}T10:00"),
        ]
        base["todos"].append({**todo("t-done-today", "今天已经做完的", "", f"{today}T08:00"), "done": True})
        pg.evaluate("d => localStorage.setItem('wd-data', JSON.stringify(d))", base)
        # 只改 hash 不会重新加载页面，必须 reload 才能读到新数据
        pg.reload(wait_until="networkidle")
        pg.wait_for_timeout(1500)
        texts = " | ".join(pg.locator(".ovw-todo__t").all_inner_texts())
        ids = pg.eval_on_selector_all(".ovw-todo", "els => els.map(e => e.dataset.todoRow)")
        chk("计划今天截止下周" in texts, f"计划今天 / 截止下周的待办已显示（{texts}）")
        chk("计划上周截止今天" in texts, "截止今天的待办已显示")
        chk("只排了今天" in texts, "只排了今天日期的待办已显示")
        chk("下周才做" not in texts, "下周的待办不混进当日")
        chk(ids and ids[0] == "t-past-only", f"逾期排在最前面（{ids[:2]}）")
        chk(pg.locator('[data-todo-row="t-past-only"] .ovw-late').count() == 1, "无截止时间的过期计划标为已逾期")
        chk(pg.locator('[data-todo-row="t-plan-today-due-later"] .ovw-late').count() == 0, "计划今天的不算逾期")
        # 卡片上显示的是今天这一栏的时间，不是下周的截止时间
        meta = pg.locator('[data-todo-row="t-plan-today-due-later"] .ovw-todo__m').inner_text()
        chk("09:00" in meta and "18:00" not in meta, f"显示今天计划时间（{meta.strip()}）")
        # 今天共 5 条（4 条未完成 + 1 条已完成），完成 1 条 → 20%
        prog = pg.locator(".ovw-bar > i").first.get_attribute("style") or ""
        chk("--v:20%" in prog.replace(" ", ""), f"进度条按「含已完成」的今天总数算（{prog.strip()}）")

        # ---------- 12. 待办「概览」的周视图不被总览样式压成两列 ----------
        pg.locator('[data-module="todo"]').click()
        pg.wait_for_timeout(500)
        chk(pg.locator(".navrow").is_visible(), "切到待办后二级导航恢复")
        pg.locator('[data-view="overview"]').click()
        pg.wait_for_timeout(900)
        chk(pg.locator(".ov-grid--week").count() == 1, "待办概览周视图存在")
        n_day = pg.locator(".ov-grid--week .day").count()
        chk(n_day == 7, f"周视图 7 列（{n_day}）")
        cols = pg.locator(".ov-grid--week").evaluate("e => getComputedStyle(e).gridTemplateColumns.split(' ').length")
        chk(cols == 7, f"周视图真的是 7 列网格（{cols}）")
        heads = pg.locator(".ov-col-head").all_inner_texts()
        chk(len(heads) == 7, f"周视图 7 个表头（{heads}）")
        pg.screenshot(path=f"{SHOT}-todo-week.png")

        # ---------- 13. 移动端单列 ----------
        m = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        mp = m.new_page()
        mp.on("pageerror", lambda e: errs.append(str(e)))
        stub(mp)
        mp.goto(URL, wait_until="networkidle")
        mp.wait_for_timeout(1500)
        xs = mp.eval_on_selector_all(".ovw-card", "els => els.map(e => Math.round(e.getBoundingClientRect().x))")
        chk(len(set(xs)) == 1, f"移动端卡片单列排列（x={xs}）")
        ws = mp.eval_on_selector_all(".ovw-card", "els => els.map(e => Math.round(e.getBoundingClientRect().width))")
        chk(len(set(ws)) == 1, f"移动端卡片等宽（{ws[0]}）")
        mp.screenshot(path=f"{SHOT}-mobile.png")
        m.close()

        chk(not errs, f"无 JS 报错（{errs[:2]}）")
        pg.screenshot(path=f"{SHOT}.png")
        b.close()

    print("\nFAILS:", fails)


if __name__ == "__main__":
    main()
