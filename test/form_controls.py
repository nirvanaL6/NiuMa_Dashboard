"""自绘表单控件回归：下拉 / 日期时间 / 时间

运行：python3 test/form_controls.py
"""
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
    pg.wait_for_timeout(1200)

    pg.click('[data-module="todo"]')
    pg.wait_for_timeout(800)
    pg.click('[data-new-task="todo"]')
    pg.wait_for_selector(".ed", timeout=5000)

    # 1. 编辑器里不再有原生 select / datetime-local
    native = pg.evaluate("""() => ({
      select: document.querySelectorAll('.ed select').length,
      dt: document.querySelectorAll('.ed input[type=datetime-local]').length,
    })""")
    chk(native["select"] == 0 and native["dt"] == 0, f"编辑器已无原生控件 {native}")
    chk(pg.locator('.ed [data-fc="select"]').count() == 1, "所属项目是自绘下拉")
    chk(pg.locator('.ed [data-fc="datetime"]').count() == 2, "截止时间/计划日期是自绘日期控件")

    # 2. 下拉展开并选择
    pg.click('.ed [data-fc="select"] [data-fc-toggle]')
    pg.wait_for_timeout(400)
    chk(pg.locator('.fc__pop--list').is_visible(), "下拉弹层可展开")
    n_opt = pg.locator('.fc__pop--list .fc__opt').count()
    chk(n_opt >= 2, f"下拉有选项（{n_opt} 个）")
    pg.locator('.fc__pop--list .fc__opt').nth(1).click()
    pg.wait_for_timeout(400)
    val = pg.input_value("#edProject")
    chk(bool(val) and val != "", f"下拉选择写回隐藏 input：{val}")
    chk(not pg.locator('.fc__pop--list').is_visible(), "选完自动收起")
    txt = pg.inner_text('.ed [data-fc="select"] .fc__val')
    chk(txt and txt != "不归属项目（独立待办）", f"下拉显示已选文案：{txt}")

    # 3. 日期控件：展开 → 选日 → 选时 → 保存回写
    pg.click('.ed [data-fc="datetime"] [data-fc-toggle]')
    pg.wait_for_timeout(400)
    chk(pg.locator(".cal").count() == 1, "日历弹层出现")
    chk(pg.locator(".cal__cell:not(.is-void)").count() >= 28, "日历渲染出日期格")
    day = pg.locator('.cal__cell:not(.is-void)').nth(15)
    day.click()
    pg.wait_for_timeout(300)
    due = pg.input_value("#edDue")
    print("   选择后 #edDue =", due)
    chk(len(due) == 16 and "T" in due, "日期时间写入隐藏 input")

    # 时间步进
    before = due[11:16]
    pg.locator('.cal [data-fc-step="时"] [data-fc-inc="1"]').click()
    pg.wait_for_timeout(250)
    after = pg.input_value("#edDue")[11:16]
    chk(before != after, f"小时步进生效（{before} → {after}）")

    # 「今天」快捷
    pg.locator('[data-fc-quick="today"]').click()
    pg.wait_for_timeout(300)
    today_val = pg.input_value("#edDue")
    chk(today_val.startswith(today_val[:10]) and "T09:00" in today_val, f"「今天」快捷生效：{today_val}")
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(300)
    # closeFc 只置 hidden，节点还在 DOM 里 —— 断言要判可见性而不是 count
    chk(not pg.locator(".ed [data-fc='datetime'] [data-fc-pop]").first.is_visible(), "ESC 关闭弹层")
    chk(pg.locator(".ed").count() == 1, "ESC 只关弹层、不关编辑器")

    # 4. 保存后数据落到存储
    pg.fill("#edTitleInput", "控件测试待办")
    pg.click("[data-ed-save]")
    pg.wait_for_timeout(900)
    saved = pg.evaluate("""() => {
      const d = JSON.parse(localStorage.getItem('wd-data'));
      const t = d.todos.find(x => x.title === '控件测试待办');
      return t ? { due: t.due, projectId: t.projectId } : null;
    }""")
    print("   落库结果:", saved)
    chk(saved is not None, "待办已保存")
    chk(saved and saved["due"].startswith(today_val[:10]), "截止时间随保存写入")

    # 5. 计薪规则页：模块尚未开放（config.js 里只有 todo 是 ready），只能做源码级校验
    src = open("src/views.js", encoding="utf-8").read()
    chk("renderTimeField({" in src and "renderSelectField({" in src, "计薪规则页源码已改用自绘控件")
    chk("form-controls.js" in src, "views.js 已引入 form-controls")
    wip = pg.evaluate("""() => {
      const b = document.querySelector('[data-view="rules"]');
      return b ? b.getAttribute('aria-selected') : 'no-btn';
    }""")
    print("   计薪规则页当前状态:", wip, "（模块未开放，显示施工中占位）")

    print("\npageerror:", errs[:5])
    print("FAILS:", fails)
    b.close()
