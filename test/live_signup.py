"""线上回归：在真实域名上走完 注册 → 登出 → 登录，检查人机验证/倒计时/错误提示

验证码走真实邮件，无法读取，所以这里只验证到「发码成功 + 人机验证已通过 + 倒计时读秒」，
再用错误验证码验证「注册提交不再被 captcha_required 阻塞」。

运行：python3 test/live_signup.py
"""
import time
from playwright.sync_api import sync_playwright

URL = "https://desk.763988.xyz/"
fails = []


def chk(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        fails.append(msg)


with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 1500, "height": 940})
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.goto(URL, wait_until="networkidle", timeout=45000)
    pg.wait_for_timeout(1200)

    pg.click("#btnAccount")
    pg.wait_for_timeout(700)
    pg.click('[data-tab="signup"]')
    pg.wait_for_timeout(400)

    chk("自动完成人机验证" in pg.inner_text("#captchaState"), "初始人机验证文案正确")

    email = f"probe{int(time.time())}@763988.xyz"
    pg.fill("#email", email)
    pg.click('[data-sendcode]')

    t0 = time.time()
    pg.wait_for_selector('[data-err="code"]:not(:empty)', timeout=60000)
    print(f"   发码耗时 {time.time()-t0:.1f}s →", pg.inner_text('[data-err="code"]')[:50])
    cap = pg.inner_text("#captchaState")
    chk("已通过" in cap, "线上人机验证完成后显示已通过：" + cap.strip())

    nums = []
    for _ in range(20):
        s = pg.inner_text('[data-sendcode]').strip()
        try:
            nums.append(int(s.split("s")[0]))
        except ValueError:
            nums.append(None)
        pg.wait_for_timeout(250)
    valid = [n for n in nums if n is not None]
    print("   读秒:", nums)
    chk(len(valid) >= 16 and all(valid[i] >= valid[i + 1] for i in range(len(valid) - 1)), "线上倒计时正常递减")

    # 错误验证码：必须看到「验证码不正确」，而不是「请先完成人机验证」
    pg.fill("#code", "000000")
    pg.fill("#password", "Work2026desk")
    pg.fill("#password2", "Work2026desk")
    pg.click(".auth-submit")
    pg.wait_for_selector('[data-err="code"]:not(:empty)', timeout=30000)
    msg = pg.inner_text('[data-err="code"]').strip()
    print("   注册返回:", msg)
    chk("验证码" in msg, "注册不再被人机验证拦截：" + msg)
    chk("人机验证" not in msg, "未出现 captcha_required")

    print("\nconsole errors:", errs[:5])
    print("FAILS:", fails)
    b.close()
