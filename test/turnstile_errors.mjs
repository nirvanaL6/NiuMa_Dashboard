/**
 * runTurnstile 错误码映射单测
 *
 * 关键：loadTurnstile() 把 Promise 缓存在模块级变量里，测不同 stub 必须换一个模块实例，
 * 否则第一个 stub 的 widget 会被所有用例复用（表现为「全是 600010」）。
 * 用 import + 查询串强制重新求值模块。
 */
globalThis.window = { turnstile: null };
globalThis.document = {
  documentElement: { dataset: {} },
  createElement: () => ({}),
  head: { appendChild: () => {} },
};
const store = {};
globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => (store[k] = v), removeItem: (k) => delete store[k] };
globalThis.location = { protocol: 'https:', hostname: 'desk.763988.xyz', port: '' };

let fails = 0;
const ok = (c, m, extra = '') => { if (!c) fails++; console.log(`${c ? 'PASS' : 'FAIL'} ${m}${extra ? ' — ' + extra : ''}`); };

let seq = 0;
/** 每个用例拿一份全新的模块实例，并注入一个会按指定方式回调的 Turnstile */
async function fresh(turnstileStub) {
  window.turnstile = turnstileStub;
  seq += 1;
  return import(`../src/api.js?case=${seq}`);
}

function errStub(code) {
  return {
    render: (slot, opt) => { setTimeout(() => opt['error-callback'](code), 0); return 'w-' + code; },
    remove: () => {},
    reset: () => {},
  };
}

for (const [code, expectShort, mustMention] of [
  ['600010', '环境被判定为风险', '换一个网络'],
  ['110200', '域名未在 Turnstile 授权', '白名单'],
  ['400020', '站点密钥无效', '管理员'],
  ['400070', '站点密钥域名不匹配', '管理员'],
  ['999999', '人机验证失败', '重试'],
]) {
  const mod = await fresh(errStub(code));
  const slot = { innerHTML: '', __tsWidget: null };
  let caught = null;
  try {
    await mod.runTurnstile({ siteKey: 'x', slot });
    ok(false, `${code} 应抛错`);
  } catch (e) {
    caught = e;
  }
  ok(
    caught && caught.code === 'captcha_error' && caught.tsShort === expectShort && caught.message.includes(mustMention),
    `${code} → ${caught ? caught.tsShort : '未抛错'}`,
    caught ? caught.message : '',
  );
}

// 成功路径
const okMod = await fresh({
  render: (slot, opt) => { setTimeout(() => opt.callback('tok-1'), 0); return 'w-ok'; },
  remove: () => {},
  reset: () => {},
});
const slot2 = { innerHTML: '', __tsWidget: null };
const token = await okMod.runTurnstile({ siteKey: 'x', slot: slot2 });
ok(token === 'tok-1', '拿到 token 后正常返回');
ok(slot2.__tsWidget === 'w-ok', 'widget 句柄挂在 slot 上便于 reset');

// 复位：resetTurnstile 应调到 turnstile.reset
let resetCalled = 0;
window.turnstile = { render: () => 'w', remove: () => {}, reset: () => { resetCalled += 1; } };
okMod.resetTurnstile(slot2);
ok(resetCalled === 1, 'resetTurnstile 调到组件 reset');

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}`);
process.exit(fails ? 1 : 0);
