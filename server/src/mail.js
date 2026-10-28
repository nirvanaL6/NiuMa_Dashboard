/**
 * 邮件发送：Cloudflare 上没有原生邮件 API，走 Resend（免费额度 100 封/天）。
 *   - 配了 RESEND_API_KEY：真实发信；发件地址必须在 Resend 已验证域名下
 *   - 未配：只在 DEV_MODE=true 时回传 devCode 供本地联调；生产由 api.js 直接拒绝（503），
 *     不会出现「提示已发送但用户永远收不到」
 * 只发验证码，不泄露账号是否存在。
 */

// 兜底发件人，仅当 env.MAIL_FROM 未配置时使用；仍需是已验证域名下的地址
const FROM = 'WorkDesk <no-reply@763988.xyz>';

function codeMail(code, purpose) {
  // 只放动作名，「验证码」由模板统一拼，避免出现「注册验证验证码」这种重复
  const title = purpose === 'reset' ? '重置密码' : '注册';
  return {
    // 验证码只进正文：主题行会出现在锁屏 / 通知栏预览里
    subject: `【打工人工作台】${title}验证码`,
    text: `你的${title}验证码是 ${code}，10 分钟内有效。\n如果不是你本人操作，请忽略本邮件。`,
    html: `<div style="font-family:system-ui,-apple-system,'PingFang SC',sans-serif;padding:24px;background:#f6f8fc">
      <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:28px">
        <p style="color:#6366f1;font-weight:700;letter-spacing:.08em;font-size:12px;margin:0 0 8px">WORKDESK</p>
        <h2 style="margin:0 0 12px;font-size:20px;color:#1e2438">${title}验证码</h2>
        <p style="color:#4a5268;font-size:14px;margin:0 0 18px">输入下面的验证码完成${title}，10 分钟内有效：</p>
        <div style="font-size:32px;font-weight:800;letter-spacing:.32em;color:#4f46e5;background:#eef0ff;border-radius:12px;padding:14px 18px;text-align:center">${code}</div>
        <p style="color:#7a839a;font-size:12px;margin:18px 0 0">如果不是你本人操作，忽略本邮件即可，账号不会有任何变化。</p>
      </div>
    </div>`,
  };
}

export async function sendCodeMail(env, to, code, purpose) {
  const mail = codeMail(code, purpose);
  if (env.RESEND_API_KEY) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: env.MAIL_FROM || FROM,
        to: [to],
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      }),
    });
    if (!res.ok) {
      // 不把上游错误透给前端，避免泄露配置细节
      return { delivered: false, channel: 'resend', reason: `upstream_${res.status}` };
    }
    return { delivered: true, channel: 'resend' };
  }
  // 本地/演示：不真的发信，把验证码回给前端，界面会标注「开发模式」
  return { delivered: false, channel: 'dev', devCode: code };
}
