CREATE TABLE IF NOT EXISTS push_rate_limits (
  id TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_rate_limits_expiry ON push_rate_limits(expires_at);
