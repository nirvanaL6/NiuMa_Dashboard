"""交互回归：单击编辑 / 四宫格与概览可完成 / 确认弹窗 / 导航文字 / toast 时长

运行：python3 test/interactions.py
"""
import time
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8765/index.html"
fails = []


def chk(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        fails.append(msg)


with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 1600, "height": 940})
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL, wait_until="networkidle")
    pg.wait_for_timeout(1500)

    # 1. 二级导航文字不截断
    pg.click('[data-module="todo"]')
    pg.wait_for_timeout(800)
    labels = pg.eval_on_selector_all(
        '#segNav .lbl', "els => els.map(e => ({txt: e.textContent, cut: e.scrollWidth > e.clientWidth + 1}))")
    print("   导航标签:", labels)
    chk(any(x["txt"] == "项目&待办" for x in labels), "导航出现「项目&待办」")
    chk(not any(x["cut"] for x in labels), "导航文字未被截断")

    # 2. 全局「新建待办」按钮已移除
    chk(pg.locator(".navrow__new").count() == 0, "顶部不再显示常驻「新建待办」按钮")
    chk(pg.locator('[data-view="list"]').count() == 1, "待办模块二级导航正常")

    # 3. 单击待办行即打开编辑器（不再需要点铅笔）
    pg.wait_for_selector(".td__title", timeout=8000)
    pg.locator(".td__title").first.click()
    pg.wait_for_selector(".ed", timeout=5000)
    chk(pg.locator(".ed").count() == 1, "单击待办标题即可打开编辑器")
    val = pg.input_value("#edTitleInput")
    chk(bool(val), f"编辑器带上了原标题：{val[:20]}")
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(400)

    # 4. 勾选按钮不会误触发编辑器
    pg.locator(".td__check").first.click()
    pg.wait_for_timeout(500)
    chk(pg.locator(".ed").count() == 0, "点勾选框不会打开编辑器")
    chk(pg.locator(".td__check").first.get_attribute("aria-checked") == "true", "勾选生效")

    # 5. 完成态不打删除线
    deco = pg.eval_on_selector(".td.is-done .td__title", "e => getComputedStyle(e).textDecorationLine")
    chk("line-through" not in deco, f"完成后标题无删除线（{deco}）")

    # 6. 四宫格：可勾选完成 + 点击文字编辑
    pg.click('[data-view="quadrant"]')
    pg.wait_for_timeout(800)
    n_qi = pg.locator(".qi__check").count()
    chk(n_qi > 0, f"四宫格出现完成勾选框（{n_qi} 个）")
    if n_qi:
        before = pg.locator(".qi__check").first.get_attribute("aria-checked")
        pg.locator(".qi__check").first.click()
        pg.wait_for_timeout(600)
        after = pg.locator(".qi__check").first.get_attribute("aria-checked")
        chk(before != after, f"四宫格勾选生效（{before} → {after}）")
        chk(pg.locator(".ed").count() == 0, "四宫格勾选不误开编辑器")
    if pg.locator(".qi__txt[data-edit-todo]").count():
        pg.locator(".qi__txt[data-edit-todo]").first.click()
        pg.wait_for_timeout(500)
        chk(pg.locator(".ed").count() == 1, "四宫格点击条目可编辑")
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(300)

    # 7. 概览：可勾选完成
    pg.click('[data-view="overview"]')
    pg.wait_for_timeout(900)
    n_de = pg.locator(".de__check").count()
    chk(n_de > 0, f"概览出现完成勾选框（{n_de} 个）")
    if n_de:
        before = pg.locator(".de__check").first.get_attribute("aria-checked")
        pg.locator(".de__check").first.click()
        pg.wait_for_timeout(600)
        chk(pg.locator(".de__check").first.get_attribute("aria-checked") != before, "概览勾选生效")

    # 8. 删除确认走自定义弹窗，带「不再提示」
    pg.click('[data-view="list"]')
    pg.wait_for_timeout(800)
    pg.locator(".td__title").first.click()
    pg.wait_for_selector(".ed [data-ed-del]", timeout=5000)
    pg.click("[data-ed-del]")
    pg.wait_for_selector(".dlg", timeout=4000)
    chk(pg.locator(".dlg").count() == 1, "删除弹出应用内确认框（非原生 confirm）")
    chk(pg.locator(".dlg__once").count() == 1, "确认框带「不再提示」选项")
    pg.locator(".dlg__once").click()   # 复选框视觉隐藏，靠 label 命中
    pg.wait_for_timeout(200)
    chk(pg.locator(".dlg__once input").is_checked(), "「不再提示」可勾选")
    pg.click('.dlg [data-dlg="ok"]')
    pg.wait_for_timeout(800)
    chk(pg.locator(".dlg").count() == 0, "确认后弹窗关闭")

    # 9. 「不再提示」生效：再次删除不再弹窗
    pg.locator(".td__title").first.click()
    pg.wait_for_selector(".ed [data-ed-del]", timeout=5000)
    pg.click("[data-ed-del]")
    pg.wait_for_timeout(700)
    chk(pg.locator(".dlg").count() == 0, "勾过「不再提示」后不再弹确认框")

    # 10. toast 2 秒后消失
    pg.wait_for_timeout(300)
    pg.evaluate("document.querySelector('#btnHelp').click()")
    pg.wait_for_selector(".toast", timeout=3000)
    t0 = time.time()
    pg.wait_for_selector(".toast", state="detached", timeout=6000)
    dt = time.time() - t0
    chk(dt < 3.2, f"toast 约 2 秒后消失（实测 {dt:.2f}s）")

    print("\npageerror:", errs[:5])
    print("FAILS:", fails)
    b.close()
