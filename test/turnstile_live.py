"""线上（desk.763988.xyz）Turnstile 真实验证：正式密钥 + 真实浏览器

正式密钥不再放行任意 token，必须由浏览器里的 Turnstile 组件真实产出一个。
运行：python3 test/turnstile_live.py
"""
from playwright.sync_api import sync_playwright

URL = "https://desk.763988.xyz/"
fails = []


def chk(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        fails.append(msg)


with sync_playwright() as p:
    b = p.chromium.launch(
        executable_path="/usr/bin/google-chrome",
        args=[
            "--no-sandbox",
            "--disable-blink-features=AutomationControlled",
            # 无头 Chromium 的 UA 会带 "HeadlessChrome"，Turnstile 直接判 bot；
            # 换成普通 UA 才能跑通「真人」链路
            "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        ],
    )
    ctx = b.new_context(viewport={"width": 1366, "height": 940}, locale="zh-CN")
    pg = ctx.new_page()
    errs = []
    reqs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    pg.on("console", lambda m: print("   [console]", m.text[:200]) if ("turnstile" in m.text.lower() or "error" in m.text.lower()) else None)
    pg.on("request", lambda r: reqs.append(r.url) if "turnstile" in r.url else None)

    pg.goto(URL, wait_until="networkidle")
    pg.wait_for_timeout(1500)

    # 打开登录浮层
    opened = pg.evaluate("""() => {
      const m = document.getElementById('authMask');
      if (!m) return false;
      m.hidden = false;
      return true;
    }""")
    chk(opened, "登录浮层可打开")
    pg.wait_for_timeout(400)

    pg.fill("#email", "live-check@example.invalid")
    pg.fill("#password", "Abcd1234")
    pg.click(".auth-submit")

    # 等 Turnstile 组件挂载
    widget = False
    for _ in range(40):
        if pg.evaluate("() => !!document.querySelector('.auth-ts iframe')") or pg.evaluate("() => !!window.turnstile"):
            widget = True
            break
        pg.wait_for_timeout(300)
    chk(widget, "Turnstile 组件已加载")
    print("   turnstile 相关请求:", [u.split('/')[2] for u in reqs][:4])

    # 组件是 Managed 模式，无头环境通常自动通过；若需交互则点一下复选框
    state_txt = ""
    for i in range(40):
        state_txt = pg.inner_text("#captchaState")
        if "通过" in state_txt or "失败" in state_txt or "超时" in state_txt or "出错" in state_txt:
            break
        if i == 8 and pg.locator(".auth-ts iframe").count():
            try:
                pg.frame_locator(".auth-ts iframe").locator("body").click(timeout=2500)
            except Exception:
                pass
        pg.wait_for_timeout(500)

    print("   验证状态:", state_txt)

    # 关键断言：不是「未通过」类错误，说明后端认了真实 token
    body = pg.inner_text(".auth-modal")
    captcha_rejected = "人机验证未通过" in body or "请先完成人机验证" in body or "人机验证出错" in body
    chk(not captcha_rejected, "后端认可浏览器产出的真实 token（未报验证失败）")
    chk("邮箱或密码不正确" in body or "password" in body.lower() or "欢迎" in body,
        f"请求已走到账号校验环节：{body[:80]!r}")

    print("\npageerror:", errs[:3])
    b.close()

print("\nFAILS:", fails)
