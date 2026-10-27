/**
 * 限流与配额：D1 按行扫描计费，这里全部走主键/索引点查
 */

export async function bumpUsage(env, userId, field = 'writes') {
  const day = new Date().toISOString().slice(0, 10);
  const col = field === 'reads' ? 'reads' : 'writes';
  await env.DB.prepare(
    `INSERT INTO usage_daily (user_id, day, writes, reads) VALUES (?1, ?2, ${col === 'writes' ? 1 : 0}, ${col === 'reads' ? 1 : 0})
     ON CONFLICT(user_id, day) DO UPDATE SET ${col} = ${col} + 1`,
  ).bind(userId, day).run();
}

export async function usageToday(env, userId) {
  const day = new Date().toISOString().slice(0, 10);
  const row = await env.DB.prepare(
    'SELECT writes, reads FROM usage_daily WHERE user_id = ?1 AND day = ?2',
  ).bind(userId, day).first();
  return { day, writes: row?.writes || 0, reads: row?.reads || 0 };
}

export async function enforceCloudWriteQuota(env, userId) {
  const { writes } = await usageToday(env, userId);
  const limit = Number(env.DAILY_WRITES_LIMIT || 300);
  if (writes >= limit) {
    const err = new Error('今日云端同步次数已达上限，请明天再试或下载备份');
    err.code = 'quota_exceeded';
    err.status = 429;
    throw err;
  }
}

/** 普通滑动窗口限流：基于已有表的 created_at 计数，不额外建表 */
export async function countRecent(env, sql, binds) {
  const row = await env.DB.prepare(sql).bind(...binds).first();
  return Number(row?.n || 0);
}
