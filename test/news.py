"""资讯模块回归：四路热榜 / 订阅源 / 稍后读 / 收藏 / 移动端横滑

接口用固定夹具打桩，测试不依赖外网与真实 Worker：
  - 热榜：4 列，前三列有数据，第四列模拟「数据源不可用」
  - 订阅：两个源，其中一个带缩略图

运行：python3 test/news.py
"""
import json
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8765/index.html"
fails = []


def chk(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        fails.append(msg)


def board(bid, label, accent, n=12, error=""):
    items = [{
        "id": f"{bid}-{i}",
        "rank": i + 1,
        "title": f"{label}第 {i + 1} 条热榜内容",
        "url": f"https://example.com/{bid}/{i}",
        "hot": f"{120 - i * 3}.4万",
        "source": label,
    } for i in range(n)]
    return {"id": bid, "label": label, "accent": accent,
            "home": f"https://example.com/{bid}", "items": items, "error": error}


HOT = {
    "ok": True,
    "fetchedAt": 1794476800000,
    "boards": [
        board("weibo", "微博热搜", "#f43f5e"),
        board("baidu", "百度热搜", "#3b82f6"),
        board("zhihu", "知乎热榜", "#6366f1"),
        board("xhs", "小红书热榜", "#ff2442", n=0, error="数据源暂无榜单"),
    ],
}

FEED_OK = {
    "ok": True,
    "sources": [{
        "url": "https://example.com/feed",
        "title": "示例科技",
        "type": "rss",
        "siteUrl": "https://example.com/",
        "error": "",
        "at": 1794476800000,
        "items": [{
            "id": f"feed-{i}",
            "title": f"订阅条目标题 {i + 1}：这是一条比较长的资讯标题用来验证两行截断",
            "url": f"https://example.com/post/{i}",
            "ts": 1794476400000 - i * 600000,
            "image": "https://example.com/cover.png" if i % 2 == 0 else "",
            "excerpt": "",
            "source": "示例科技",
        } for i in range(9)],
    }],
}

PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082"
)


def stub(page):
    def hot(route):
        route.fulfill(status=200, content_type="application/json",
                      headers={"access-control-allow-origin": "*"}, body=json.dumps(HOT))

    def feed(route):
        # 跨域 POST 会先发预检，这里一并放行
        if route.request.method == "OPTIONS":
            return route.fulfill(status=204, headers={
                "access-control-allow-origin": "*",
                "access-control-allow-headers": "content-type",
                "access-control-allow-methods": "GET,POST,OPTIONS",
            })
        # 只回放订阅夹具；地址不匹配时返回抓取失败，验证错误分支
        req = json.loads(route.request.post_data or "{}")
        urls = req.get("urls") or []
        if urls and urls[0] == "https://example.com/feed":
            route.fulfill(status=200, content_type="application/json",
                          headers={"access-control-allow-origin": "*"}, body=json.dumps(FEED_OK))
        else:
            route.fulfill(status=200, content_type="application/json",
                          headers={"access-control-allow-origin": "*"},
                          body=json.dumps({"ok": True, "sources": [
                              {"url": u, "title": "", "type": "", "items": [], "error": "站点返回 403"}
                              for u in urls]}))

    page.route("**/api/news/hot*", hot)
    page.route("**/api/news/feed", feed)
    page.route("**/cover.png", lambda r: r.fulfill(status=200, content_type="image/png", body=PNG))
    page.route("**/example.com/**", lambda r: r.fulfill(status=200, content_type="text/html", body="<h1>stub</h1>"))


with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 1600, "height": 980})
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    stub(pg)

    pg.goto(URL, wait_until="networkidle")
    pg.evaluate("() => localStorage.clear()")
    pg.reload(wait_until="networkidle")

    # ---------- 一级 / 二级导航 ----------
    pg.click('[data-module="news"]')
    pg.wait_for_timeout(600)
    chk(pg.locator("#panelTitle").inner_text() == "资讯", "一级导航进入「资讯」")
    views = pg.eval_on_selector_all("#segNav .lbl", "els => els.map(e => e.textContent)")
    chk(views == ["实时推荐", "订阅话题", "稍后读", "收藏"], f"四个二级视图齐全：{views}")
    chk(pg.eval_on_selector_all("#segNav .lbl", "els => els.every(e => e.scrollWidth <= e.clientWidth + 1)"),
        "二级导航文字未被截断")

    # ---------- 实时推荐：四列并列 ----------
    pg.wait_for_timeout(500)
    chk(pg.locator(".board").count() == 4, "实时推荐展示 4 个热榜")
    tops = pg.eval_on_selector_all(".board", "els => els.map(e => Math.round(e.getBoundingClientRect().top))")
    chk(len(set(tops)) == 1, f"四个榜单位于同一行（top={tops}）")
    lefts = pg.eval_on_selector_all(".board", "els => els.map(e => Math.round(e.getBoundingClientRect().left))")
    chk(lefts == sorted(lefts) and len(set(lefts)) == 4, f"榜单横向并列（left={lefts}）")
    chk(pg.locator(".board .ni img").count() == 0, "热榜条目不配图")
    chk(pg.locator(".board").nth(0).locator(".ni").count() == 10, "每个榜单首屏 10 条")
    chk(pg.locator('.board[data-board="weibo"] .board__more').inner_text().strip() == "展开全部 12 条",
        "超出部分给出展开入口")
    chk(pg.locator('.board[data-board="xhs"] .board__empty').count() == 1, "失败的数据源单独显示占位与重试")

    first = pg.locator('.board[data-board="weibo"] .ni').nth(0)
    chk(first.locator("a.ni__link").get_attribute("target") == "_blank", "条目链接新窗口打开")
    chk(first.locator("a.ni__link").get_attribute("rel") == "noopener noreferrer", "外链带 noopener")
    chk(first.locator(".ni__act").count() == 2, "条目右侧有稍后读 / 收藏两个单图标")

    # ---------- 点击条目真的能跳转 ----------
    with ctx.expect_page() as pop:
        first.locator("a.ni__link").click()
    chk(pop.value.url.startswith("https://example.com/weibo/0"), f"点击条目跳转到原文（{pop.value.url}）")
    pop.value.close()

    # ---------- 稍后读：原条目 → 稍后读 → 反向取消 ----------
    first.locator('[data-news-act="later"]').click()
    pg.wait_for_timeout(500)
    chk(pg.locator('.board[data-board="weibo"] .ni').nth(0).locator('[data-news-act="later"]').get_attribute("aria-pressed") == "true",
        "点击后图标变为「取消稍后读」状态")
    chk(pg.locator('[data-module="news"] .rail__badge').inner_text() == "1", "侧栏角标显示稍后读条数")

    pg.click('[data-view="later"]')
    pg.wait_for_timeout(500)
    chk(pg.locator(".ki").count() == 1, "条目进入稍后读")
    chk("第 1 条热榜内容" in pg.locator(".ki .ki__t").inner_text(), "稍后读里是刚存的那一条")
    chk(pg.locator('.ki [data-news-act="later"]').get_attribute("aria-pressed") == "true", "稍后读里书签为选中态")

    # 在稍后读里取消
    pg.locator('.ki [data-news-act="later"]').click()
    pg.wait_for_timeout(500)
    chk(pg.locator(".ki").count() == 0, "在稍后读里取消后条目消失")
    chk(pg.locator(".news-empty").count() == 1, "取消后回到空状态")

    pg.click('[data-view="realtime"]')
    pg.wait_for_timeout(500)
    chk(pg.locator('.board[data-board="weibo"] .ni').nth(0).locator('[data-news-act="later"]').get_attribute("aria-pressed") == "false",
        "原条目的图标同步恢复")

    # ---------- 收藏 ----------
    pg.locator('.board[data-board="baidu"] .ni').nth(0).locator('[data-news-act="fav"]').click()
    pg.wait_for_timeout(400)
    pg.locator('.board[data-board="baidu"] .ni').nth(1).locator('[data-news-act="fav"]').click()
    pg.wait_for_timeout(500)
    pg.click('[data-view="fav"]')
    pg.wait_for_timeout(500)
    chk(pg.locator(".ki").count() == 2, "收藏列表有 2 条")
    chk(pg.locator('.ki [data-news-act="fav"]').first.get_attribute("aria-pressed") == "true", "收藏里星标为选中态")

    # 在收藏里取消收藏
    pg.locator('.ki').nth(0).locator('[data-news-act="fav"]').click()
    pg.wait_for_timeout(500)
    chk(pg.locator(".ki").count() == 1, "在收藏模块也能取消收藏")

    # 收藏里补一条稍后读，验证两个状态互不干扰
    pg.locator('.ki').nth(0).locator('[data-news-act="later"]').click()
    pg.wait_for_timeout(500)
    chk(pg.locator('.ki').count() == 1, "加稍后读不会把条目移出收藏")
    state = pg.evaluate("() => JSON.parse(localStorage.getItem('wd-data')).news")
    chk(len(state["fav"]) == 1 and len(state["later"]) == 1, "稍后读与收藏各自独立落库")

    # ---------- 订阅话题 ----------
    pg.click('[data-view="topics"]')
    pg.wait_for_timeout(500)
    chk(pg.locator(".news-empty").count() == 1, "未订阅时给出空状态与预设源")
    chk(pg.locator(".news-presets .preset").count() == 3, "空状态提供 3 个预设源")

    pg.click('[data-news-act="add-sub"]')
    pg.wait_for_timeout(400)
    chk(pg.locator("#subUrl").count() == 1, "添加订阅弹窗打开")
    pg.fill("#subUrl", "example.com/feed")  # 故意不带协议，验证自动补 https
    pg.click("[data-sub-ok]")
    pg.wait_for_timeout(900)
    chk(pg.locator(".sub").count() == 1, "订阅后出现分框卡片")
    subs = pg.evaluate("() => JSON.parse(localStorage.getItem('wd-data')).news.subs")
    chk(subs and subs[0]["url"] == "https://example.com/feed", f"地址自动补全为 https（{subs and subs[0]['url']}）")
    chk(pg.locator(".sub .si").count() == 8, "卡片内最多展示 8 条")
    chk(pg.locator(".sub .si__thumb img").count() >= 1, "订阅内容可配图")
    chk(pg.locator(".sub__foot").count() == 1, "超出条数给出「去站点看全部」入口")
    chk(pg.locator(".sub .ni__act").count() == 16, "订阅条目同样带稍后读 / 收藏图标")

    # 订阅页里收藏一条
    pg.locator(".sub .si").nth(1).locator('[data-news-act="fav"]').click()
    pg.wait_for_timeout(500)
    pg.click('[data-view="fav"]')
    pg.wait_for_timeout(400)
    chk(pg.locator(".ki").count() == 2, "订阅条目可加入收藏")

    # ---------- 取消订阅 ----------
    pg.click('[data-view="topics"]')
    pg.wait_for_timeout(500)
    pg.click(".sub__x")
    pg.wait_for_timeout(400)
    chk(pg.locator(".dlg").count() == 1, "取消订阅走应用内确认框")
    pg.click('[data-dlg="ok"]')
    pg.wait_for_timeout(600)
    chk(pg.locator(".sub").count() == 0, "确认后订阅卡片移除")

    # ---------- 刷新后仍在 ----------
    pg.reload(wait_until="networkidle")
    pg.wait_for_timeout(700)
    pg.click('[data-module="news"]')
    pg.wait_for_timeout(800)
    pg.click('[data-view="later"]')
    pg.wait_for_timeout(500)
    chk(pg.locator(".ki").count() == 1, "刷新页面后稍后读仍在本地")

    # ---------- 移动端：横滑与导航 ----------
    m = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    mp = m.new_page()
    mp.on("pageerror", lambda e: errs.append(str(e)))
    stub(mp)
    mp.goto(URL, wait_until="networkidle")
    mp.click('[data-module="news"]')
    mp.wait_for_timeout(900)
    dims = mp.evaluate("() => { const r = document.querySelector('[data-board-row]'); return { w: r.clientWidth, sw: r.scrollWidth }; }")
    chk(dims["sw"] > dims["w"] + 50, f"移动端四列改为左右滑（{dims}）")
    mp.evaluate("() => { document.querySelector('[data-board-row]').scrollLeft = 600; }")
    mp.wait_for_timeout(200)
    mp.locator('.board').nth(2).locator(".ni").nth(0).locator('[data-news-act="later"]').click()
    mp.wait_for_timeout(500)
    kept = mp.evaluate("() => document.querySelector('[data-board-row]').scrollLeft")
    chk(kept > 400, f"点图标后横向滚动位置保留（{kept}）")
    m.close()

    print("pageerror:", errs)
    print("FAILS:", fails)
    b.close()

raise SystemExit(1 if fails else 0)
