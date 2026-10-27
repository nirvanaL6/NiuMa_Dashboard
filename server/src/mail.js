/**
 * 邮件发送：Cloudflare 上没有原生的邮件 API，走两种可插拔通道
 *   1) RESEND_API_KEY  —— 生产推荐（免费额度 100 封/天）
 *   2) 未配置时         —— 返回 devCode，仅用于本地联调，界面会显式提示「开发模式」
 * 只发验证码，不泄露账号是否存在。
 */

const FROM = 'WorkDesk <no-reply@workdesk.local>';

function codeMail(code, purpose) {
  const title = purpose === 'reset' ? '重置登录密码' : '注册验证';
  return {
    subject: `【打工人工作台】${title}验证码 ${code}`,
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
