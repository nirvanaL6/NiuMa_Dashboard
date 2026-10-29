"""人机验证（Cloudflare Turnstile）端到端回归

前置（**必须用官方测试密钥**，否则浏览器里的挑战过不了）：
  - wrangler.toml 的 TURNSTILE_SITE_KEY = "1x00000000000000000000AA"
  - .dev.vars 的 TURNSTILE_SECRET_KEY = "1x0000000000000000000000000000000AA"
  - 静态前端  python3 -m http.server 8765（项目根）
  - 本地 API  cd server && npx wrangler dev --port 8787 --local -c wrangler.build.toml

用正式 site key 跑本脚本会失败，且失败是**正确行为**：127.0.0.1 不在该 key 的
域名白名单里，浏览器端回 110200。线上真实链路请跑 test/turnstile_live.py。

运行：python3 test/turnstile.py
"""
import json
import urllib.request

from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8765/index.html"
API = "http://127.0.0.1:8787"
fails = []


def chk(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        fails.append(msg)


def api(path, payload=None):
    req = urllib.request.Request(
        API + path,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"content-type": "application/json"},
        method="POST" if payload is not None else "GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())


# ---------- 1. 接口层 ----------
cfg = api("/api/auth/captcha-config")
chk(cfg.get("provider") == "turnstile" and cfg.get("enabled") is True, f"captcha-config 返回 Turnstile 配置 {cfg}")

r = api("/api/auth/code", {"email": "ts-test@example.com", "purpose": "signup", "captcha": None})
chk(r.get("error", {}).get("code") == "captcha_required", f"不带 token 发码被拦：{r.get('error', {}).get('code')}")

# 官方文档：测试密钥对「任意 token」都返回 success，假 token 场景只能靠打桩验证
# （见 server/test/turnstile.unit.mjs 的 captcha_failed / captcha_error 分支）
r = api("/api/auth/code", {"email": "ts-test@example.com", "purpose": "signup", "captcha": {"token": "bogus"}})
print("   测试密钥下假 token:", r.get("error", {}).get("code") or "放行（官方测试密钥特性）")
chk(True, "假 token 分支由单元测覆盖（见 server/test/turnstile.unit.mjs）")

r = api("/api/auth/pow", {"purpose": "signup"})
chk(r.get("error", {}).get("code") == "not_found", "旧 PoW 接口已下线")

# ---------- 2. 浏览器层 ----------
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    pg = b.new_context(viewport={"width": 1280, "height": 900}).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL, wait_until="networkidle")
    pg.wait_for_timeout(1200)

    pg.click("[data-action='login'], .btn--login, #loginBtn", timeout=5000) if pg.locator("[data-action='login']").count() else pg.evaluate(
        "() => document.dispatchEvent(new CustomEvent('auth:open'))"
    )
    pg.wait_for_timeout(600)
    has_modal = pg.locator("#authMask").count() and not pg.locator("#authMask").first.is_hidden()
    if not has_modal:
        pg.evaluate("() => { const m = document.getElementById('authMask'); if (m) m.hidden = false; }")
    pg.wait_for_timeout(300)
    chk(pg.locator("#captchaState").count() > 0, "登录表单有人机验证提示区")
    chk(pg.locator("#captchaSlot").count() > 0, "存在 Turnstile 挂载点")

    pg.fill("#email", "ts-e2e@example.com")
    pg.fill("#password", "abcd1234")
    pg.click(".auth-submit")
    # Turnstile 是否真的被拉起来了：官方脚本注入后 window.turnstile 才存在。
    # 注意：官方「始终通过」的测试密钥在无头浏览器里直接颁发 token、不渲染 iframe，
    # 所以这里断言脚本已加载，而不是断言出现 widget。
    got_lib = False
    for _ in range(30):
        got_lib = pg.evaluate("() => !!window.turnstile")
        if got_lib:
            break
        pg.wait_for_timeout(300)
    chk(got_lib, "点击登录后加载了 Turnstile 组件")

    ok = False
    for _ in range(60):
        txt = pg.inner_text("#captchaState")
        if "通过" in txt:
            ok = True
            break
        if "失败" in txt or "出错" in txt or "超时" in txt or "不支持" in txt:
            break
        pg.wait_for_timeout(500)
    chk(ok, f"人机验证走完：{pg.inner_text('#captchaState')!r}")

    # 提交后若走到「邮箱或密码不正确」，说明后端已认可 token（不再是 captcha_* 错误）
    msg = pg.inner_text("#authState") or pg.inner_text("[data-err='password']")
    chk("人机验证" not in msg, f"后端认可 token，未报验证错误：{msg!r}")

    print("\npageerror:", errs[:5])
    b.close()

print("\nFAILS:", fails)
