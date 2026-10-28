"""浏览器端全流程回归：注册 → 云端同步 → 登出 → 登录 → 找回密码 → 备份恢复

前置：python3 -m http.server 8765（项目根）+ wrangler dev（server/）
运行：python3 test/auth_flow.py
"""
import json, re, time
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8765/index.html"
fails = []
def chk(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond: fails.append(msg)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 1500, "height": 940})
    pg = ctx.new_page()
    logs = []
    pg.on("pageerror", lambda e: logs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: logs.append("CONSOLE " + m.text) if m.type == "error" else None)
    pg.on("dialog", lambda d: d.accept())
    pg.goto(URL, wait_until="networkidle")
    pg.wait_for_timeout(1200)

    # 1. 首次进入：免登录模式
    chk(pg.locator("#btnAccount .who b").inner_text() == "免登录模式", "首屏为免登录模式：" + pg.locator("#btnAccount .who b").inner_text())
    seed_todos = pg.evaluate("JSON.parse(localStorage.getItem('wd-data')).todos.length")
    chk(seed_todos > 0, f"首次进入写入种子数据 {seed_todos} 条")

    # 2. 免登录模式下勾选待办 → 落本地
    pg.click('[data-module="todo"]'); pg.wait_for_timeout(700)
    pg.wait_for_selector(".td__check", timeout=5000)
    before_done = pg.evaluate("JSON.parse(localStorage.getItem('wd-data')).todos.filter(t=>t.done).length")
    pg.locator(".td__check").first.click(); pg.wait_for_timeout(600)
    done_count = pg.evaluate("JSON.parse(localStorage.getItem('wd-data')).todos.filter(t=>t.done).length")
    print("   done 数量:", done_count, "| aria:", pg.evaluate("[...document.querySelectorAll('.td__check')].map(e=>e.getAttribute('aria-checked')).join('')"))
    chk(done_count == before_done + 1, f"勾选后写入本地（{before_done} → {done_count} 条）")
    local_only = pg.evaluate("localStorage.getItem('wd-token')")
    chk(not local_only, "免登录模式无 token")

    # 3. 导出备份
    pg.click("#railSettings"); pg.wait_for_timeout(600)
    chk(pg.locator(".acct-card").count() == 1, "设置里出现账户卡片")
    with pg.expect_download() as dl:
        pg.click('[data-backup="export"]')
    d = dl.value
    path = "/tmp/wd-backup.json"
    d.save_as(path)
    data = json.load(open(path))
    chk(data.get("app") == "worker-desk" and len(data["data"]["todos"]) == seed_todos, f"备份下载成功 {d.suggested_filename}")
    pg.keyboard.press("Escape"); pg.wait_for_timeout(400)

    # 4. 打开登录浮层
    pg.click("#btnAccount"); pg.wait_for_timeout(600)
    chk(pg.locator(".auth-mask.open").count() == 1, "账户按钮打开登录浮层")
    pg.screenshot(path="/tmp/wd-auth-login.png")

    # 5. 切到注册
    pg.click('[data-tab="signup"]'); pg.wait_for_timeout(400)
    email = f"ui{int(time.time())}@example.com"
    pg.fill("#email", email)
    pg.click('[data-sendcode]')
    # 人机验证 + 发码
    pg.wait_for_selector('[data-err="code"]:not(:empty)', timeout=30000)
    msg = pg.inner_text('[data-err="code"]')
    chk("开发模式" in msg or "已发送" in msg, "验证码已发送：" + msg[:40])
    code = pg.evaluate("document.querySelector('#code').value")
    chk(len(code) == 6, "开发模式自动填入验证码 " + code)

    # 6. 密码校验
    pg.fill("#password", "abc")
    pg.fill("#password2", "abc")
    pg.click(".auth-submit"); pg.wait_for_timeout(900)
    chk("密码" in pg.inner_text('[data-err="password"]'), "弱密码前端拦截：" + pg.inner_text('[data-err="password"]'))

    pg.fill("#password", "Work2026desk")
    pg.fill("#password2", "Work2026deskX")
    pg.click(".auth-submit"); pg.wait_for_timeout(600)
    chk("不一致" in pg.inner_text('[data-err="password2"]'), "两次密码不一致拦截")

    # 7. 正式注册
    pg.fill("#password2", "Work2026desk")
    pg.click(".auth-submit")
    pg.wait_for_selector(".auth-mask[hidden]", timeout=40000, state="attached")
    pg.wait_for_timeout(1200)
    chk(pg.evaluate("localStorage.getItem('wd-mode')") == "cloud", "注册后切换为云端模式")
    chk(bool(pg.evaluate("localStorage.getItem('wd-token')")), "已获得会话 token")
    name = pg.locator("#btnAccount .who b").inner_text()
    chk(name == email.split("@")[0], f"页头显示账号名 {name}")
    if pg.locator("#sheetMask.open").count(): pg.click("#sheetClose"); pg.wait_for_timeout(500)
    v = pg.evaluate("document.querySelector('#btnAccount').dataset.sync")
    print("   同步状态:", v)

    # 8. 云端已有数据
    pg.wait_for_timeout(1500)
    cloud = pg.evaluate("(async()=>{const r=await fetch('http://127.0.0.1:8787/api/state',{headers:{authorization:'Bearer '+localStorage.getItem('wd-token')}});return await r.json()})()")
    chk(cloud.get("version", 0) >= 1 and cloud["payload"]["todos"], f"云端已存快照 v{cloud.get('version')} ({cloud.get('bytes')}B)")

    # 9. 登录后改数据 → 自动上传（5s 防抖）。外卖模块已改为「施工中」，改用待办勾选触发改动
    pg.click('[data-module="todo"]'); pg.wait_for_timeout(800)
    print("   badge:", pg.get_attribute("#btnAccount","data-sync"))
    pg.locator(".td__check").nth(1).click(); pg.wait_for_timeout(900)
    print("   local done:", pg.evaluate("JSON.parse(localStorage.getItem('wd-data')).todos.filter(t=>t.done).length"), "badge:", pg.get_attribute("#btnAccount","data-sync"))
    pg.wait_for_function("document.querySelector('#btnAccount').dataset.sync !== 'dirty'", timeout=15000)
    print("   after wait badge:", pg.get_attribute("#btnAccount","data-sync"))
    cloud2 = pg.evaluate("(async()=>{const r=await fetch('http://127.0.0.1:8787/api/state',{headers:{authorization:'Bearer '+localStorage.getItem('wd-token')}});return await r.json()})()")
    chk(cloud2["payload"].get("todos") and any(t.get("done") for t in cloud2["payload"]["todos"]), f"改动后自动同步到云端 v{cloud2.get('version')}")

    # 10. 退出登录
    pg.click("#btnAccount"); pg.wait_for_timeout(700)
    pg.click('[data-auth="logout"]'); pg.wait_for_timeout(1200)
    chk(pg.evaluate("localStorage.getItem('wd-mode')") == "guest", "退出后回到免登录模式")
    chk(not pg.evaluate("localStorage.getItem('wd-token')"), "退出后清空 token")

    # 11. 登录（错误密码 → 正确密码）
    pg.click("#btnAccount"); pg.wait_for_timeout(600)
    pg.fill("#email", email); pg.fill("#password", "wrongpass1")
    pg.click(".auth-submit"); pg.wait_for_selector('[data-err="password"]:not(:empty)', timeout=30000)
    chk("不正确" in pg.inner_text('[data-err="password"]'), "错误密码提示：" + pg.inner_text('[data-err="password"]'))
    pg.fill("#password", "Work2026desk")
    pg.click(".auth-submit")
    pg.wait_for_selector(".auth-mask[hidden]", timeout=40000, state="attached")
    pg.wait_for_timeout(1200)
    chk(pg.evaluate("localStorage.getItem('wd-mode')") == "cloud", "登录成功回到云端模式")
    if pg.locator("#sheetMask.open").count(): pg.click("#sheetClose"); pg.wait_for_timeout(500)
    synced = pg.evaluate("JSON.parse(localStorage.getItem('wd-data')).todos.filter(t=>t.done).length")
    chk(synced >= 1, f"登录后拉回云端数据（已完成待办 {synced} 条）")

    # 12. 找回密码
    pg.click("#btnAccount"); pg.wait_for_timeout(700)
    pg.click('[data-auth="logout"]'); pg.wait_for_timeout(1200)
    pg.click("#btnAccount"); pg.wait_for_timeout(700)
    chk(pg.locator("[data-forgot]").is_visible(), "登录页有忘记密码入口")
    pg.click("[data-forgot]"); pg.wait_for_timeout(400)
    chk(pg.locator('[data-step="verify"]').count() == 1, "忘记密码进入验证步骤")
    pg.fill("#email", email)
    pg.click("[data-sendcode]")
    pg.wait_for_selector('[data-step="verify"] [data-err="code"]:not(:empty)', timeout=30000)
    pg.click(".auth-submit")
    pg.wait_for_selector('[data-step="confirm"]', timeout=40000)
    pg.wait_for_timeout(700)
    chk(True, "验证码通过，进入重设密码步骤")
    pg.fill("#password", "Newpass2026x"); pg.fill("#password2", "Newpass2026x")
    pg.locator(".auth-submit").click(force=True)
    pg.wait_for_selector(".auth-mask[hidden]", timeout=40000, state="attached")
    pg.wait_for_timeout(1200)
    chk(pg.evaluate("localStorage.getItem('wd-mode')") == "cloud", "重设密码后自动登录")
    if pg.locator("#sheetMask.open").count(): pg.click("#sheetClose"); pg.wait_for_timeout(500)

    # 13. 恢复备份（恢复为种子状态）
    pg.click("#railSettings"); pg.wait_for_timeout(600)
    with pg.expect_file_chooser() as fc:
        pg.click('[data-backup="import"]')
    fc.value.set_files(path)
    pg.wait_for_timeout(1500)
    chk(pg.evaluate("JSON.parse(localStorage.getItem('wd-data')).todos.length") == seed_todos, "备份恢复成功")

    # 14. 重置为示例（导入后面板已关闭，重新打开）
    pg.click("#railSettings"); pg.wait_for_timeout(600)
    pg.click('[data-backup="reset"]'); pg.wait_for_timeout(1200)
    chk(pg.evaluate("JSON.parse(localStorage.getItem('wd-data')).todos.filter(t=>t.done).length") == 2, "重置为示例数据")

    print("\nconsole:", logs[:8])
    print("FAILS:", fails)
    b.close()
