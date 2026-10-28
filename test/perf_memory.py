"""性能与内存回归：验证定时器泄漏已修复、勾选待办不再整页重绘

判定口径：
  1. 静置 20s，setTimeout 句柄数不再指数增长（修复前每 ~0.5s 翻倍）
  2. JS 堆与 DOM 节点数在静置期间保持稳定
  3. 勾选待办不触发整页重建（观察视图节点身份是否变化）

运行：python3 test/perf_memory.py
"""
import time
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8765/index.html"
fails = []


def chk(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        fails.append(msg)


# 在页面里插桩：统计 setTimeout / setInterval 的存活句柄数
INSTRUMENT = """
(() => {
  if (window.__patched) return;
  window.__patched = true;
  window.__timers = new Set();
  const st = window.setTimeout, si = window.setInterval;
  const ct = window.clearTimeout, ci = window.clearInterval;
  window.setTimeout = function (fn, d, ...a) {
    const id = st.call(window, function () { window.__timers.delete(id); if (typeof fn === 'function') fn(); }, d, ...a);
    window.__timers.add(id);
    return id;
  };
  window.setInterval = function (fn, d, ...a) {
    const id = si.call(window, fn, d, ...a);
    window.__timers.add(id);
    return id;
  };
  window.clearTimeout = function (id) { window.__timers.delete(id); return ct.call(window, id); };
  window.clearInterval = function (id) { window.__timers.delete(id); return ci.call(window, id); };
})();
"""


def mem(page):
    return page.evaluate("performance.memory ? performance.memory.usedJSHeapSize : 0")


def nodes(page):
    return page.evaluate("document.getElementsByTagName('*').length")


def timers(page):
    return page.evaluate("window.__timers ? window.__timers.size : -1")


with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome",
                          args=["--no-sandbox", "--js-flags=--expose-gc"])
    ctx = b.new_context(viewport={"width": 1500, "height": 940})
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.add_init_script(INSTRUMENT)
    page.goto(URL, wait_until="networkidle")
    page.wait_for_timeout(2500)

    t0, n0, m0 = timers(page), nodes(page), mem(page)
    print(f"   起始: 定时器 {t0} · DOM {n0} · 堆 {m0/1048576:.1f}MB")

    # --- 静置 20 秒 ---
    samples = []
    for i in range(10):
        page.wait_for_timeout(2000)
        samples.append((timers(page), nodes(page), mem(page)))
    t1, n1, m1 = samples[-1]
    print(f"   20s 后: 定时器 {t1} · DOM {n1} · 堆 {m1/1048576:.1f}MB")
    print("   定时器采样:", [s[0] for s in samples])

    chk(t1 < 200, f"定时器句柄未失控（{t0} → {t1}，阈值 200）")
    chk(max(s[0] for s in samples) < 300, "静置期间定时器没有指数增长")
    chk(m1 < m0 * 3 + 8 * 1048576, f"堆内存稳定（{m0/1048576:.1f} → {m1/1048576:.1f}MB）")
    chk(n1 < n0 * 1.5 + 200, f"DOM 节点未膨胀（{n0} → {n1}）")

    # --- 勾选待办：不应整页重建 ---
    page.click('[data-module="todo"]')
    page.wait_for_timeout(900)
    page.wait_for_selector(".td__check", timeout=8000)
    mark = page.evaluate("""() => {
      const v = document.querySelector('.view');
      v.dataset.probe = 'keep-me';
      return document.querySelectorAll('.td__check').length;
    }""")
    page.locator(".td__check").first.click()
    page.wait_for_timeout(700)
    kept = page.evaluate("() => document.querySelector('.view')?.dataset.probe === 'keep-me'")
    chk(kept, "勾选待办后视图节点被复用（未整页重建）")
    page.wait_for_timeout(300)
    chk(page.locator(".td__check").count() == mark, "勾选后条目数量不变")

    # --- 连续切换视图 10 次，计时器与节点应回归 ---
    for i in range(10):
        page.click(f'[data-view="{["list","quadrant","overview"][i % 3]}"]')
        page.wait_for_timeout(220)
    page.wait_for_timeout(1200)
    t2, n2 = timers(page), nodes(page)
    print(f"   切换 10 次后: 定时器 {t2} · DOM {n2}")
    chk(t2 < 250, f"高频切换后定时器收敛（{t2}）")
    chk(n2 < n0 * 1.8 + 400, f"高频切换后 DOM 无堆积（{n2}）")

    print("\npageerror:", errs[:5])
    print("FAILS:", fails)
    b.close()
