-- ============================================================
-- 0003_turnstile.sql
-- 人机验证由自研 PoW 换成 Cloudflare Turnstile。
--
-- email_codes.pow_verified 是 PoW 时代的名字，语义是「这次发码通过过人机验证」。
-- 换成 Turnstile 后继续复用会误导，这里新增 captcha_ok 承载同一语义：
--   - 新增列而不是改名：D1 上已有数据，ADD COLUMN 零风险，RENAME 要挑 SQLite 版本
--   - 旧列保留，历史行保持 0，不影响新逻辑（新逻辑只读 captcha_ok）
-- ============================================================
ALTER TABLE email_codes ADD COLUMN captcha_ok INTEGER NOT NULL DEFAULT 0;
