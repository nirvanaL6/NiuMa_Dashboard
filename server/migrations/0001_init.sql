-- ============================================================
-- 打工人工作台 · D1 schema
-- 设计原则：
--   1) 所有查询走索引，禁止全表扫描（D1 按「行扫描量」计费）
--   2) 一次性令牌（验证码/会话/重置）只存 SHA-256 哈希，明文只出现在邮件/客户端
--   3) 时间统一用整数 Unix 毫秒，便于索引范围比较
-- ============================================================

-- 用户
CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,            -- uuid v4
  email          TEXT NOT NULL,               -- 统一小写后存储
  email_norm     TEXT NOT NULL,               -- 登录查询键（小写，唯一）
  password_hash  TEXT NOT NULL,               -- pbkdf2$sha256$<iter>$<saltB64>$<hashB64>
  email_verified INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'active', -- active | disabled
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  last_login_at  INTEGER
);
-- 邮箱登录 / 注册查重 / 找回密码：唯一索引，查询即点查
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_norm ON users (email_norm);
-- 按状态清理/统计时避免全表扫描
CREATE INDEX IF NOT EXISTS idx_users_status_created ON users (status, created_at DESC);

-- 邮箱验证码 / 人机验证挑战 / 各类一次性票据（注册、找回密码、登录风控）
CREATE TABLE IF NOT EXISTS email_codes (
  id         TEXT PRIMARY KEY,
  email_norm TEXT NOT NULL,
  purpose    TEXT NOT NULL,                   -- signup | reset | change_email
  code_hash  TEXT NOT NULL,                   -- sha256(code + peper)
  attempts   INTEGER NOT NULL DEFAULT 0,      -- 校验失败次数，超限作废
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
);
-- 校验时按 (email,purpose) 取最新未消费验证码：一个复合索引覆盖过滤与排序
CREATE INDEX IF NOT EXISTS idx_codes_email_purpose ON email_codes (email_norm, purpose, created_at DESC);
-- 定期清理过期记录
CREATE INDEX IF NOT EXISTS idx_codes_expires ON email_codes (expires_at);
-- 发送频率限制：统计同一邮箱近 N 分钟的发送次数
CREATE INDEX IF NOT EXISTS idx_codes_email_created ON email_codes (email_norm, created_at DESC);

-- 会话（登录态）
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,                -- sha256(token)
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  ua         TEXT,
  ip_hash    TEXT
);
-- 鉴权：每次请求按 token_hash 点查；登出全部设备按 user_id 删
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

-- 密码重置令牌（验证码通过后签发，一次性）
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_resets_user ON password_resets (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resets_expires ON password_resets (expires_at);

-- 人机验证挑战（proof-of-work）
CREATE TABLE IF NOT EXISTS pow_challenges (
  id          TEXT PRIMARY KEY,
  salt        TEXT NOT NULL,
  difficulty  INTEGER NOT NULL,               -- 需要的哈希前导 0 比特数
  purpose     TEXT NOT NULL,                  -- signup | login | reset | send_code
  ip_hash     TEXT,
  attempts    INTEGER NOT NULL DEFAULT 0,
  expires_at  INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pow_expires ON pow_challenges (expires_at);
CREATE INDEX IF NOT EXISTS idx_pow_ip_created ON pow_challenges (ip_hash, created_at DESC);

-- 登录失败计数（邮箱维度，防风控爆破）
CREATE TABLE IF NOT EXISTS login_attempts (
  email_norm  TEXT PRIMARY KEY,
  fails       INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attempts_locked ON login_attempts (locked_until);

-- 登录模式的用户数据：整包快照（单行 JSON）
CREATE TABLE IF NOT EXISTS user_state (
  user_id    TEXT PRIMARY KEY,
  payload    TEXT NOT NULL,                   -- JSON 字符串（压缩前）
  version    INTEGER NOT NULL DEFAULT 1,      -- 单调递增，客户端据此做冲突检测
  bytes      INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
-- 按更新时间做批量巡检/统计
CREATE INDEX IF NOT EXISTS idx_state_updated ON user_state (updated_at DESC);

-- 备份历史（可选的“回滚”能力，只保留最近 N 份）
CREATE TABLE IF NOT EXISTS backups (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  payload    TEXT NOT NULL,
  version    INTEGER NOT NULL,
  bytes      INTEGER NOT NULL,
  source     TEXT NOT NULL DEFAULT 'auto',    -- manual | auto | import
  created_at INTEGER NOT NULL
);
-- 取某用户最近备份：复合索引直接覆盖
CREATE INDEX IF NOT EXISTS idx_backups_user_created ON backups (user_id, created_at DESC);

-- 每用户审计/配额计数（每日写入次数，保护 D1 每日写入配额）
CREATE TABLE IF NOT EXISTS usage_daily (
  user_id TEXT NOT NULL,
  day     TEXT NOT NULL,                      -- YYYY-MM-DD (UTC)
  writes  INTEGER NOT NULL DEFAULT 0,
  reads   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
CREATE INDEX IF NOT EXISTS idx_usage_day ON usage_daily (day);
