/** 后端端到端测试：真实 HTTP 打 worker（本地 D1） */
const B = process.env.API || 'http://127.0.0.1:8787';
let fails = 0;
const ok = (cond, msg, extra = '') => {
  if (!cond) fails += 1;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}${extra ? ' — ' + extra : ''}`);
};

async function call(method, path, body, token) {
  const res = await fetch(B + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function shaBits(salt, nonce) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}|${nonce}`)));
  let bits = 0;
  for (const b of d) { if (b === 0) { bits += 8; continue; } bits += Math.clz32(b) - 24; break; }
  return bits;
}

async function solve(pow) {
  if (!pow || !pow.salt) throw new Error('pow missing: ' + JSON.stringify(pow));
  for (let n = 0; n < 5_000_000; n += 1) {
    if ((await shaBits(pow.salt, n)) >= pow.difficulty) return { powId: pow.id, nonce: n };
  }
  throw new Error('solve failed');
}

const email = `t${Date.now()}@example.com`;
const pwd = 'Work2026desk';

const health = await call('GET', '/api/health');
ok(health.json.ok, '健康检查');

// 人机验证：错误 nonce 必须被拒
const pow0 = (await call('POST', '/api/auth/pow', { purpose: 'signup' })).json;
ok(!!pow0.id && pow0.difficulty >= 10, `签发 PoW 挑战 difficulty=${pow0.difficulty}`);
const badCode = await call('POST', '/api/auth/code', { email, purpose: 'signup', pow: { powId: pow0.id, nonce: -1 } });
ok(badCode.status === 400 && badCode.json.error.code === 'captcha_failed', '错误 nonce 被拒绝', JSON.stringify(badCode.json));

// 正常发码
const pow1 = (await call('POST', '/api/auth/pow', { purpose: 'signup' })).json;
const solved1 = await solve(pow1);
const code1 = await call('POST', '/api/auth/code', { email, purpose: 'signup', pow: solved1 });
ok(code1.json.ok && code1.json.devMode && /^\d{6}$/.test(code1.json.devCode), '验证码发送（开发模式回显）', code1.json.masked);
const devCode = code1.json.devCode;

// 60 秒内重复发送应被限流
const pow1b = (await call('POST', '/api/auth/pow', { purpose: 'signup' })).json;
const again = await call('POST', '/api/auth/code', { email, purpose: 'signup', pow: await solve(pow1b) });
ok(again.status === 429, '同邮箱 60s 内重复发码被限流', again.json.error?.message);

// 蜜罐
const powH = (await call('POST', '/api/auth/pow', { purpose: 'signup' })).json;
const honey = await call('POST', '/api/auth/code', { email: `h${Date.now()}@example.com`, purpose: 'signup', pow: await solve(powH), honeypot: 1 });
ok(honey.status === 200 && honey.json.delivered === false, '蜜罐触发后静默成功');

// 注册校验
const pow2 = (await call('POST', '/api/auth/pow', { purpose: 'signup' })).json;
const mismatch = await call('POST', '/api/auth/signup', { email, code: devCode, password: pwd, password2: pwd + 'x', pow: await solve(pow2) });
ok(mismatch.json.error?.code === 'password_mismatch', '两次密码不一致被拒');
const pow3 = (await call('POST', '/api/auth/pow', { purpose: 'signup' })).json;
const weak = await call('POST', '/api/auth/signup', { email, code: devCode, password: 'abcdefgh', password2: 'abcdefgh', pow: await solve(pow3) });
ok(weak.json.error?.code === 'password_weak', '弱密码被拒', weak.json.error?.message);
const pow3b = (await call('POST', '/api/auth/pow', { purpose: 'signup' })).json;
const wrongCode = await call('POST', '/api/auth/signup', { email, code: '000000', password: pwd, password2: pwd, pow: await solve(pow3b) });
ok(wrongCode.json.error?.code === 'code_invalid', '错误验证码被拒');

// 正确注册
const pow4 = (await call('POST', '/api/auth/pow', { purpose: 'signup' })).json;
const signup = await call('POST', '/api/auth/signup', { email, code: devCode, password: pwd, password2: pwd, pow: await solve(pow4) });
ok(signup.json.ok && signup.json.token && signup.json.user.emailVerified, '注册成功并直接登录', signup.json.user?.email);
const token = signup.json.token;

// 验证码一次性
const pow5 = (await call('POST', '/api/auth/pow', { purpose: 'signup' })).json;
const reuse = await call('POST', '/api/auth/signup', { email, code: devCode, password: pwd, password2: pwd, pow: await solve(pow5) });
ok(reuse.status >= 400, '同一验证码不能复用', reuse.json.error?.code);

// me
const me1 = await call('GET', '/api/me', null, token);
ok(me1.json.ok && me1.json.cloud === null, '获取当前用户，云端暂无数据');
const noAuth = await call('GET', '/api/me');
ok(noAuth.status === 401, '未带 token 返回 401');

// 登录：错误密码 + 锁定
const email2 = `l${Date.now()}@example.com`;
const powA = (await call('POST', '/api/auth/pow', { purpose: 'signup' })).json;
const cA = await call('POST', '/api/auth/code', { email: email2, purpose: 'signup', pow: await solve(powA) });
const powB = (await call('POST', '/api/auth/pow', { purpose: 'signup' })).json;
const s2 = await call('POST', '/api/auth/signup', { email: email2, code: cA.json.devCode, password: pwd, password2: pwd, pow: await solve(powB) });
ok(s2.json.ok, '第二个账号注册成功');

for (let i = 0; i < 6; i += 1) {
  const pr = await call('POST', '/api/auth/pow', { purpose: 'login' });
  if (!pr.json.salt) { console.log('pow resp', pr.status, JSON.stringify(pr.json)); }
  const p = pr.json;
  await call('POST', '/api/auth/login', { email: email2, password: 'wrong' + i, pow: await solve(p) });
}
const powLock = (await call('POST', '/api/auth/pow', { purpose: 'login' })).json;
const locked = await call('POST', '/api/auth/login', { email: email2, password: pwd, pow: await solve(powLock) });
ok(locked.status === 429 && locked.json.error.code === 'locked', '连续 6 次错误后锁定', locked.json.error?.message);

// 找回密码
const powR = (await call('POST', '/api/auth/pow', { purpose: 'reset' })).json;
const codeR = await call('POST', '/api/auth/code', { email, purpose: 'reset', pow: await solve(powR) });
ok(codeR.json.ok, '找回密码验证码发送');
const powR2 = (await call('POST', '/api/auth/pow', { purpose: 'reset' })).json;
const verR = await call('POST', '/api/auth/reset/verify', { email, code: codeR.json.devCode, pow: await solve(powR2) });
ok(verR.json.ok && verR.json.resetToken, '验证码通过并获得重置令牌');
const newPwd = 'Newpass2026x';
const reset = await call('POST', '/api/auth/reset/confirm', { raw: verR.json.resetToken, password: newPwd, password2: newPwd });
ok(reset.json.ok && reset.json.token, '重置密码成功并自动登录');
const oldSess = await call('GET', '/api/me', null, token);
ok(oldSess.status === 401, '重置密码后旧会话失效');

// 云端数据：读写 + 版本冲突 + 配额
const t2 = reset.json.token;
// 找回密码前重置它的登录失败计数（前面测锁定用的是另一个邮箱，这里不受影响）
const state = { todos: [{ id: 'a', title: '写周报', done: false }], prefs: { payTick: true }, savedAt: Date.now() };
const put1 = await call('PUT', '/api/state', { payload: state }, t2);
ok(put1.json.ok && put1.json.version === 1, `首次上传 v${put1.json.version} ${put1.json.bytes}B`);
const get1 = await call('GET', '/api/state', null, t2);
ok(get1.json.payload?.todos?.[0]?.title === '写周报', '读取云端快照内容一致');
const put2 = await call('PUT', '/api/state', { payload: state, baseVersion: 99 }, t2);
ok(put2.status === 409 && put2.json.error.code === 'version_conflict', '版本冲突被识别', String(put2.json.serverVersion));
const put3 = await call('PUT', '/api/state', { payload: state, baseVersion: 1 }, t2);
ok(put3.json.ok && put3.json.version === 2, '带基线版本正常递增');
const big = { blob: 'x'.repeat(600 * 1024) };
const tooBig = await call('PUT', '/api/state', { payload: big }, t2);
ok(tooBig.status === 413, '超限数据被拒（512KB）');
const backups = await call('GET', '/api/backups', null, t2);
ok(backups.json.ok && Array.isArray(backups.json.backups), `备份列表 ${backups.json.backups.length} 条`);

// 登出
const out = await call('POST', '/api/auth/logout', {}, t2);
ok(out.json.ok, '登出成功');
const after = await call('GET', '/api/me', null, t2);
ok(after.status === 401, '登出后 token 失效');

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}`);
process.exit(fails ? 1 : 0);
