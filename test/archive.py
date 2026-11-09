"""已完成归档回归（待办列表视图）

规则：
  - 独立待办完成后按计划日期归档到「已完成」
  - 项目部分完成 → 完成的待办留在项目里，不归档
  - 项目全部待办完成 → 整个项目卡片归档到「已完成」（默认折叠，可展开）
  - 空项目不算完成，仍留在主列表
  - 归档区可取消完成（回到原位置）与删除

运行：python3 test/archive.py
"""
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8765/index.html"
fails = []


def chk(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        fails.append(msg)


def goto_todo(pg):
    pg.click('[data-module="todo"]')
    pg.wait_for_timeout(800)


def reset(pg):
    pg.evaluate("() => localStorage.clear()")
    pg.reload(wait_until="networkidle")
    pg.wait_for_timeout(1600)
    goto_todo(pg)


with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    pg = b.new_context(viewport={"width": 1600, "height": 1100}).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    pg.goto(URL, wait_until="networkidle")
    pg.wait_for_timeout(1200)
    reset(pg)

    # 1. 独立待办完成后归档，并按计划日期分组
    loose_before = pg.locator("#looseList .td").count()
    pg.locator(".pj--loose .td:not(.is-done) .td__check").first.click()
    pg.wait_for_timeout(800)
    chk(pg.locator("#looseList .td").count() == loose_before - 1, "独立待办完成后从「独立待办」移出")
    chk(pg.locator("#archiveSection").count() == 1, "出现「已完成」区块")
    chk(pg.locator(".arc__list .td").count() == 1, "归档区出现 1 条独立待办")
    heads = pg.locator(".arc__group-head span:first-child").all_inner_texts()
    chk(all("月" in h and "周" in h for h in heads), f"按计划日期分组：{heads}")
    chk(pg.locator(".arc__list .td__title").first.evaluate(
        "e => getComputedStyle(e).textDecorationLine").find("line-through") == -1, "归档条目不划删除线")

    # 2. 分组按日期倒序（新日期在前）
    pg.evaluate("""() => {
      const d = JSON.parse(localStorage.getItem('wd-data'));
      const base = d.todos.find(t => t.done && !t.projectId) || d.todos[0];
      d.todos.push({ ...base, id: 'tf-early', title: '很早的计划', done: true,
        planAt: '2026-10-01T09:00', createdAt: Date.now() + 1 });
      d.todos.push({ ...base, id: 'tf-none', title: '无计划日期', done: true,
        planAt: '', createdAt: Date.now() + 2 });
      localStorage.setItem('wd-data', JSON.stringify(d));
    }""")
    pg.reload(wait_until="networkidle")
    pg.wait_for_timeout(1600)
    goto_todo(pg)
    heads = pg.locator(".arc__group-head span:first-child").all_inner_texts()
    chk(heads[0].startswith("11月"), f"最新日期分组排最前：{heads}")
    chk("未设置计划日期" in heads, "无计划日期的条目独立分组")
    chk(heads[-1] == "未设置计划日期", "无计划日期的分组排最后")

    # 3. 取消完成 → 回到独立待办
    pg.locator(".arc__list .td__check").first.click()
    pg.wait_for_timeout(800)
    chk(pg.locator("#looseList .td").count() == loose_before, "归档区取消完成后回到「独立待办」")

    # 4. 项目部分完成不归档
    reset(pg)
    card = pg.locator("#projectList .pj", has_text="工作台 v2")
    n = card.locator(".td").count()
    done_before = card.locator(".td.is-done").count()
    card.locator(".td:not(.is-done) .td__check").first.click()
    pg.wait_for_timeout(800)
    chk(pg.locator("#projectList .pj", has_text="工作台 v2").count() == 1, f"项目 {n} 条只完成 {done_before + 1} 条时不归档")
    chk(pg.locator(".pj--archived").count() == 0, "未全部完成时归档区没有项目")

    # 5. 项目全部完成 → 整卡归档，默认折叠，可展开查看子待办
    for _ in range(n + 1):
        x = pg.locator("#projectList .pj", has_text="工作台 v2").locator(".td:not(.is-done) .td__check").first
        if not x.count():
            break
        x.click()
        pg.wait_for_timeout(700)
    chk(pg.locator("#projectList .pj", has_text="工作台 v2").count() == 0, "项目全部完成后离开主列表")
    chk(pg.locator(".pj--archived", has_text="工作台 v2").count() == 1, "整个项目卡片归档到「已完成」")
    chk(pg.locator(".pj--archived .pj__list:not([hidden])").count() == 0, "归档项目默认折叠")
    chk(pg.locator(".pj--archived .td").count() == n, f"归档项目里保留 {n} 条子待办")
    pg.locator(".pj--archived .pj__fold").first.click()
    pg.wait_for_timeout(500)
    chk(pg.locator(".pj--archived .pj__list:not([hidden])").count() == 1, "点箭头可展开查看子待办")

    # 6. 归档项目里取消一条完成 → 项目回到主列表
    pg.locator(".pj--archived .td__check").first.click()
    pg.wait_for_timeout(900)
    chk(pg.locator(".pj--archived").count() == 0, "取消完成后项目移出归档区")
    chk(pg.locator("#projectList .pj", has_text="工作台 v2").count() == 1, "项目回到主列表")

    # 7. 空项目留在主列表，不进归档
    reset(pg)
    pg.evaluate("""() => {
      const d = JSON.parse(localStorage.getItem('wd-data'));
      d.projects.push({ id: 'p-empty', title: '空项目测试', tags: [], createdAt: Date.now() });
      localStorage.setItem('wd-data', JSON.stringify(d));
    }""")
    pg.reload(wait_until="networkidle")
    pg.wait_for_timeout(1600)
    goto_todo(pg)
    chk(pg.locator("#projectList .pj", has_text="空项目测试").count() == 1, "空项目留在主列表")
    chk(pg.locator(".pj--archived", has_text="空项目测试").count() == 0, "空项目不归档")

    # 8. 归档条目可删除（走应用内确认框）
    reset(pg)
    pg.locator(".pj--loose .td:not(.is-done) .td__check").first.click()
    pg.wait_for_timeout(800)
    cnt = pg.locator(".arc__list .td").count()
    pg.locator(".arc__list .td").first.hover()
    pg.locator(".arc__list .td__del").first.click()
    pg.wait_for_selector(".dlg", timeout=4000)
    chk(pg.locator(".dlg").count() == 1, "归档条目删除走应用内确认框")
    pg.click('.dlg [data-dlg="ok"]')
    pg.wait_for_timeout(700)
    chk(pg.locator(".arc__list .td").count() == cnt - 1, "确认后归档条目被删除")

    print("\npageerror:", errs)
    print("FAILS:", fails)
    b.close()

raise SystemExit(1 if fails else 0)
