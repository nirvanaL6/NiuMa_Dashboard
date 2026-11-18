"""总览模块回归：四块等宽卡片 / 时钟走秒 / 当日待办 / 资讯速览可选源 / 快捷入口

接口全部打桩，不依赖外网与真实 Worker：
  - 热榜：四路都有数据
  - 待办：用预置数据（首次打开会 seed）

运行：python3 test/overview.py
"""
import json
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

        # ---------- 2. 四块卡片 ----------
        chk(pg.locator(".ov-card").count() == 4, f"四块卡片（{pg.locator('.ov-card').count()}）")
        widths = pg.eval_on_selector_all(".ov-card", "els => els.map(e => Math.round(e.getBoundingClientRect().width))")
        chk(len(set(widths)) == 1, f"四块卡片等宽（{widths}）")
        heights = pg.eval_on_selector_all(".ov-card", "els => els.map(e => Math.round(e.getBoundingClientRect().height))")
        chk(len(set(heights)) >= 3, f"卡片高度各自随内容，未被拉平（{heights}）")

        # 左上时钟 / 左下待办 / 右上资讯 / 右下入口
        boxes = pg.eval_on_selector_all(".ov-card", "els => els.map(e => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y) }; })")
        left_x = min(b["x"] for b in boxes)
        right_x = max(b["x"] for b in boxes)
        clock, todos, news, links = boxes
        chk(clock["x"] == left_x and todos["x"] == left_x, "时钟与待办在左列")
        chk(news["x"] == right_x and links["x"] == right_x, "资讯与快捷入口在右列")
        chk(clock["y"] < todos["y"], "时钟在待办之上")
        chk(news["y"] < links["y"], "资讯在快捷入口之上")

        # ---------- 3. 北京时间精确到秒 ----------
        clock_txt = pg.locator(".ov-clock__hm").inner_text().strip()
        sec1 = pg.locator('[data-ov-clock="s"]').inner_text().strip()
        chk(len(clock_txt) == 5 and clock_txt[2] == ":", f"时:分格式 {clock_txt}")
        chk(sec1.isdigit() and len(sec1) == 2, f"秒为两位数字（{sec1}）")
        pg.wait_for_timeout(1600)
        sec2 = pg.locator('[data-ov-clock="s"]').inner_text().strip()
        chk(sec1 != sec2, f"秒在走动（{sec1} → {sec2}）")
        chk(pg.locator(".ov-clock__date").inner_text().count("年") == 1, "显示年月日与星期")

        # ---------- 4. 当日待办 ----------
        rows = pg.locator(".ov-todo")
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
        chk(pg.locator(".ov-src").count() == 4, f"默认显示四路资讯（{pg.locator('.ov-src').count()}）")
        heads = [t.strip() for t in pg.locator(".ov-src__head b").all_inner_texts()]
        chk("微博热搜" in heads and "微信热文" in heads, f"资讯源标题正确（{heads}）")
        per = pg.locator(".ov-src").first.locator(".ov-src__list a")
        chk(per.count() == 4, f"每个源速览 4 条（{per.count()}）")
        chk(pg.locator(".ov-src__list a img").count() == 0, "速览条目不配图")
        tgt = per.first.get_attribute("target")
        chk(tgt == "_blank", "速览条目新窗口打开")

        # ---------- 6. 选择显示哪些资讯列表 ----------
        pg.locator('[data-ov-act="pick-src"]').first.click()
        pg.wait_for_timeout(300)
        chk(pg.locator("[data-ov-picker]").is_visible(), "勾选面板可展开")
        chk(pg.locator("[data-ov-src]").count() == 4, "面板列出四个源")
        pg.locator('[data-ov-src="baidu"]').uncheck()
        pg.wait_for_timeout(700)
        chk(pg.locator(".ov-src").count() == 3, "取消勾选后少一列")
        chk(pg.locator("[data-ov-picker]").is_visible(), "重绘后面板保持展开")
        # 全部取消 → 空态
        for sid in ["weibo", "zhihu", "wechat"]:
            pg.locator(f'[data-ov-src="{sid}"]').uncheck()
            pg.wait_for_timeout(400)
        chk(pg.locator(".ov-src").count() == 0, "全部取消后没有资讯块")
        chk(pg.locator(".ov-news .ov-empty").count() == 1, "全部取消后有空态提示")
        # 恢复一个
        pg.locator('[data-ov-src="weibo"]').check()
        pg.wait_for_timeout(600)
        chk(pg.locator(".ov-src").count() == 1, "重新勾选后恢复显示")

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
        chk(pg.locator(".ov-link").count() == 1, "添加快捷入口成功")
        chk(pg.locator(".ov-link__txt b").first.inner_text().strip() == "GitHub", "入口标题正确")
        href = pg.locator(".ov-link > a").first.get_attribute("href")
        chk(href.startswith("https://github.com/"), f"自动补全协议（{href}）")
        chk(pg.locator(".ov-link > a").first.get_attribute("target") == "_blank", "入口新窗口打开")

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
        chk(pg.locator(".ov-link").count() == 1, "刷新后快捷入口仍在")
        chk(pg.locator(".ov-src").count() == 1, "刷新后资讯源选择仍在")
        chk(not pg.locator("[data-ov-picker]").is_visible(), "刷新后勾选面板默认收起")

        # ---------- 9. 删除入口 ----------
        pg.locator(".ov-link").first.hover()
        pg.locator('[data-ov-act="del-link"]').first.click(force=True)
        pg.wait_for_timeout(400)
        chk(pg.locator(".ed-mask").count() == 1, "删除走应用内确认框")
        pg.locator('[data-dlg="ok"]').click()
        pg.wait_for_timeout(600)
        chk(pg.locator(".ov-link").count() == 0, "确认后入口被删除")

        # ---------- 10. 离开再回来，面板收起 ----------
        pg.locator('[data-module="todo"]').click()
        pg.wait_for_timeout(500)
        pg.locator('[data-module="overview"]').click()
        pg.wait_for_timeout(700)
        chk(not pg.locator("[data-ov-picker]").is_visible(), "切走再回来勾选面板已收起")
        chk(pg.locator(".ov-card").count() == 4, "回来仍是四块卡片")

        # ---------- 11. 移动端单列 ----------
        m = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        mp = m.new_page()
        mp.on("pageerror", lambda e: errs.append(str(e)))
        stub(mp)
        mp.goto(URL, wait_until="networkidle")
        mp.wait_for_timeout(1500)
        xs = mp.eval_on_selector_all(".ov-card", "els => els.map(e => Math.round(e.getBoundingClientRect().x))")
        chk(len(set(xs)) == 1, f"移动端卡片单列排列（x={xs}）")
        ws = mp.eval_on_selector_all(".ov-card", "els => els.map(e => Math.round(e.getBoundingClientRect().width))")
        chk(len(set(ws)) == 1, f"移动端卡片等宽（{ws[0]}）")
        mp.screenshot(path=f"{SHOT}-mobile.png")
        m.close()

        chk(not errs, f"无 JS 报错（{errs[:2]}）")
        pg.screenshot(path=f"{SHOT}.png")
        b.close()

    print("\nFAILS:", fails)


if __name__ == "__main__":
    main()
