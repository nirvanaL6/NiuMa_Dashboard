"""针对性回归：验证码倒计时读秒 + 人机验证状态 + 字段错误展示

前置：python3 -m http.server 8765（项目根）+ wrangler dev（server/）
运行：python3 test/countdown_and_err.py
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
    ctx = b.new_context(viewport={"width": 1500, "height": 940})
    pg = ctx.new_page()
    logs = []
    pg.on("pageerror", lambda e: logs.append("PAGEERROR " + str(e)))
    pg.goto(URL, wait_until="networkidle")
    pg.wait_for_timeout(1000)

    pg.click("#btnAccount")
    pg.wait_for_timeout(600)
    pg.click('[data-tab="signup"]')
    pg.wait_for_timeout(300)

    # --- 1. 未验证时的初始文案 ---
    cap = pg.inner_text("#captchaState")
    chk("自动完成人机验证" in cap and "已通过" not in cap, "初始人机验证文案：" + cap.strip())

    email = f"cd{int(time.time())}@example.com"
    pg.fill("#email", email)

    # --- 2. 点发送验证码：记录发送中 → 读秒 → 每秒文案 ---
    t0 = time.time()
    pg.click('[data-sendcode]')
    seen = []
    for _ in range(80):
        txt = pg.inner_text('[data-sendcode]').strip()
        dis = pg.is_disabled('[data-sendcode]')
        if not seen or seen[-1][1] != txt:
            seen.append((round(time.time() - t0, 2), txt, dis))
        if pg.inner_text('[data-err="code"]').strip():
            break
        pg.wait_for_timeout(100)
    print("   按钮文案变化:", seen[:8])
    err = pg.inner_text('[data-err="code"]').strip()
    chk(bool(err), "发码结果回填到 data-err=code：" + err[:48])
    chk(any("发送中" in s[1] for s in seen), "过程中出现「发送中…」态，不会被倒计时文案覆盖")

    # --- 3. 读秒：连续采样 6 秒，必须严格递减且不卡住 ---
    samples = []
    for _ in range(24):
        samples.append(pg.inner_text('[data-sendcode]').strip())
        pg.wait_for_timeout(250)
    nums = []
    for s in samples:
        try:
            nums.append(int(s.split("s")[0]))
        except ValueError:
            nums.append(None)
    print("   读秒采样:", nums)
    valid = [n for n in nums if n is not None]
    chk(len(valid) >= 20, f"倒计时始终有数字（{len(valid)}/24 次采样）")
    chk(all(valid[i] >= valid[i + 1] for i in range(len(valid) - 1)), "倒计时单调不增，没有回跳")
    chk(valid[0] - valid[-1] >= 4, f"约 6 秒内读掉 {valid[0] - valid[-1]} 秒（应接近 6）")
    chk(pg.is_disabled('[data-sendcode]'), "读秒期间按钮禁用")

    # --- 4. 人机验证状态：发送成功后应为「已通过」 ---
    cap2 = pg.inner_text("#captchaState")
    chk("已通过" in cap2, "发送后人机验证显示已通过：" + cap2.strip())

    # --- 5. 字段错误：验证码填错 → 服务端返回 code_invalid，提示必须可见 ---
    real_code = pg.evaluate("document.querySelector('#code').value")
    wrong = "000000" if real_code != "000000" else "111111"
    pg.fill("#code", wrong)
    pg.fill("#password", "Work2026desk")
    pg.fill("#password2", "Work2026desk")
    pg.click(".auth-submit")
    pg.wait_for_selector('[data-err="code"]:not(:empty)', timeout=20000)
    msg = pg.inner_text('[data-err="code"]').strip()
    chk("验证码" in msg or "过期" in msg, "错误验证码提示可见：" + msg)
    chk(pg.locator("#authState").inner_text().strip() == "", "错误提示落在验证码字段，没有重复打到表单底部")
    chk(pg.locator(".auth-mask[hidden]").count() == 0, "注册失败后浮层保持打开")

    # --- 6. 切页签后倒计时复位（不应看到禁用的旧按钮） ---
    pg.click('[data-tab="login"]')
    pg.wait_for_timeout(400)
    pg.click('[data-tab="signup"]')
    pg.wait_for_timeout(400)
    btn = pg.inner_text('[data-sendcode]').strip()
    chk(btn == "获取验证码" and not pg.is_disabled('[data-sendcode]'), "切回注册页倒计时已复位：" + btn)

    print("\nconsole:", logs[:6])
    print("FAILS:", fails)
    b.close()
