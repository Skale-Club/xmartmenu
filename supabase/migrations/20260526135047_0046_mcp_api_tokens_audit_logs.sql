
CREATE TABLE IF NOT EXISTS api_tokens (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT        NOT NULL,
  token_hash   TEXT        NOT NULL UNIQUE,
  token_prefix TEXT        NOT NULL,
  is_active    BOOLEAN     NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  rotated_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS mcp_audit_logs (
  id            SERIAL      PRIMARY KEY,
  token_id      UUID        REFERENCES api_tokens(id) ON DELETE SET NULL,
  token_prefix  TEXT        NOT NULL,
  tool_name     TEXT        NOT NULL,
  target_type   TEXT,
  target_id     TEXT,
  action        TEXT        NOT NULL,
  result        TEXT        NOT NULL,
  error_message TEXT,
  ip_address    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mcp_audit_logs_token_id_idx   ON mcp_audit_logs(token_id);
CREATE INDEX IF NOT EXISTS mcp_audit_logs_created_at_idx ON mcp_audit_logs(created_at DESC);
;
