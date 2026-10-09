
CREATE TABLE IF NOT EXISTS oauth_codes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  TEXT NOT NULL UNIQUE,
  client_id             TEXT,
  redirect_uri          TEXT NOT NULL,
  code_challenge        TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL DEFAULT 'S256',
  scope                 TEXT,
  token_id              UUID REFERENCES api_tokens(id) ON DELETE CASCADE,
  raw_token             TEXT,
  expires_at            TIMESTAMPTZ NOT NULL,
  used_at               TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_oauth_codes_code ON oauth_codes(code);
;
