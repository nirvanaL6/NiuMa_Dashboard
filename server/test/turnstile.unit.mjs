/**
 * verifyTurnstile 单元测：把 siteverify 的响应打桩，覆盖成功/失败/网络异常/漏配密钥
 *
 * 端到端测试用的是 Cloudflare 官方「始终通过」的测试密钥，假 token 也会被放行，
 * 失败分支只能靠打桩验证。运行：node server/test/turnstile.unit.mjs
 */
import { verifyTurnstile, captchaConfig } from '../src/api.js';

let fails = 0;
const ok = (cond, msg, extra = '') => {
  if (!cond) fails += 1;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}${extra ? ' — ' + extra : ''}`);
};

const TEST_SITE = '1x00000000000000000000AA';
const REAL_SITE = '0x4AAAAAAA-real-site-key';

/** 打桩 fetch，返回给定响应；记录请求体便于断言 */
function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return handler();
  };
  return calls;
}

const jsonRes = (obj) => ({ json: async () => obj });

async function expectErr(fn, code) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e.code;
  }
}

/* 1. 未启用人机验证：直接放行，也不该去打 siteverify */
const calls1 = stubFetch(async () => jsonRes({ success: true }));
ok((await verifyTurnstile({ TURNSTILE_SITE_KEY: '' }, { token: 'x' }, '1.2.3.4')) === true, '未配置站点密钥时放行');
ok(calls1.length === 0, '未启用时不请求 siteverify');

/* 2. 启用了但没带 token */
stubFetch(async () => jsonRes({ success: true }));
ok((await expectErr(() => verifyTurnstile({ TURNSTILE_SITE_KEY: TEST_SITE }, {}, '1.2.3.4'), 'x')) === 'captcha_required', '缺少 token 返回 captcha_required');
ok((await expectErr(() => verifyTurnstile({ TURNSTILE_SITE_KEY: TEST_SITE }, null, '1.2.3.4'), 'x')) === 'captcha_required', 'token 为 null 同样被拒');

/* 3. 校验通过 */
const calls3 = stubFetch(async () => jsonRes({ success: true }));
ok((await verifyTurnstile({ TURNSTILE_SITE_KEY: TEST_SITE }, { token: 'good' }, '1.2.3.4')) === true, '校验通过返回 true');
ok(calls3[0].url.includes('challenges.cloudflare.com/turnstile/v0/siteverify'), '请求打到官方 siteverify');
ok(calls3[0].body.response === 'good' && calls3[0].body.remoteip === '1.2.3.4', 'token 与客户端 IP 一并提交');

/* 4. 校验失败 */
stubFetch(async () => jsonRes({ success: false, 'error-codes': ['invalid-input-response'] }));
ok((await expectErr(() => verifyTurnstile({ TURNSTILE_SITE_KEY: TEST_SITE }, { token: 'bad' }, '1.2.3.4'), 'x')) === 'captcha_failed', '校验失败返回 captcha_failed');

/* 5. 网络异常 */
stubFetch(async () => { throw new Error('network down'); });
ok((await expectErr(() => verifyTurnstile({ TURNSTILE_SITE_KEY: TEST_SITE }, { token: 'x' }, '1.2.3.4'), 'x')) === 'captcha_error', 'siteverify 不可达返回 captcha_error');

/* 6. 测试站点密钥未配 secret 时自动配对测试密钥，不报错 */
const calls6 = stubFetch(async () => jsonRes({ success: true }));
ok((await verifyTurnstile({ TURNSTILE_SITE_KEY: TEST_SITE }, { token: 'x' })) === true, '测试站点密钥自动配对测试 secret');
ok(calls6[0].body.secret === '1x0000000000000000000000000000000AA', '用的是官方测试 secret');

/* 7. 正式站点密钥漏配 secret：必须显式报错，不能悄悄放行 */
stubFetch(async () => jsonRes({ success: true }));
ok((await expectErr(() => verifyTurnstile({ TURNSTILE_SITE_KEY: REAL_SITE }, { token: 'x' }), 'x')) === 'server_misconfigured', '正式站点密钥漏配 secret 时报错');

/* 8. 正式站点密钥 + 正式 secret 正常走校验 */
const calls8 = stubFetch(async () => jsonRes({ success: true }));
ok((await verifyTurnstile({ TURNSTILE_SITE_KEY: REAL_SITE, TURNSTILE_SECRET_KEY: 'real-secret' }, { token: 'x' })) === true, '正式密钥对正常校验');
ok(calls8[0].body.secret === 'real-secret', '提交的是配置的 secret');

/* 9. captchaConfig 只暴露公开信息 */
const cfg = captchaConfig({ TURNSTILE_SITE_KEY: REAL_SITE, TURNSTILE_SECRET_KEY: 'real-secret' });
ok(cfg.provider === 'turnstile' && cfg.siteKey === REAL_SITE && cfg.enabled === true, 'captchaConfig 返回站点密钥');
ok(!JSON.stringify(cfg).includes('real-secret'), 'captchaConfig 不泄露 secret');

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}`);
process.exit(fails ? 1 : 0);
