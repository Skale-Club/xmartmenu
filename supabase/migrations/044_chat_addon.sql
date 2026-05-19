-- SEED-024: AI Chat Addon — Phase A schema
-- AI chat assistant addon for the public menu. Restaurant brings its own
-- OpenRouter API key; the platform persists encrypted credentials, conversations,
-- messages, and a phone-number blocklist. Plan availability and per-tenant
-- activation live on the existing subscription tables.

-- ============================================================
-- chat_addon_settings — per-tenant configuration (one row per tenant)
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_addon_settings (
  tenant_id                      UUID        PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  enabled                        BOOLEAN     NOT NULL DEFAULT false,
  openrouter_api_key             TEXT        NULL,           -- AES-256-GCM ciphertext (base64)
  openrouter_model               TEXT        NOT NULL DEFAULT 'openai/gpt-4o-mini',
  audio_enabled                  BOOLEAN     NOT NULL DEFAULT false,
  audio_provider                 TEXT        NULL CHECK (audio_provider IS NULL OR audio_provider IN ('whisper', 'deepgram')),
  audio_api_key                  TEXT        NULL,           -- AES-256-GCM ciphertext (base64)
  rate_limit_per_phone_per_day   INT         NOT NULL DEFAULT 30 CHECK (rate_limit_per_phone_per_day BETWEEN 1 AND 500),
  created_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE chat_addon_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chat_addon_settings_tenant_all"
  ON chat_addon_settings FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- ============================================================
-- chat_conversations — one row per (tenant, phone, day)
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_conversations (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone_hash        TEXT        NOT NULL,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  message_count     INT         NOT NULL DEFAULT 0,
  status            TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  admin_note        TEXT        NULL
);

CREATE INDEX IF NOT EXISTS chat_conversations_tenant_idx       ON chat_conversations (tenant_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS chat_conversations_phone_idx        ON chat_conversations (tenant_id, phone_hash);

ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;

-- Public can insert their own conversation; staff/admin read via service client
CREATE POLICY "chat_conversations_public_insert"
  ON chat_conversations FOR INSERT
  WITH CHECK (true);

CREATE POLICY "chat_conversations_tenant_select"
  ON chat_conversations FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "chat_conversations_tenant_update"
  ON chat_conversations FOR UPDATE
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- ============================================================
-- chat_messages — user + assistant turns within a conversation
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_messages (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID        NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  role             TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
  content          TEXT        NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  has_audio        BOOLEAN     NOT NULL DEFAULT false,
  tokens_used      INT         NULL
);

CREATE INDEX IF NOT EXISTS chat_messages_conversation_idx ON chat_messages (conversation_id, created_at);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chat_messages_public_insert"
  ON chat_messages FOR INSERT
  WITH CHECK (true);

CREATE POLICY "chat_messages_tenant_select"
  ON chat_messages FOR SELECT
  USING (
    conversation_id IN (
      SELECT id FROM chat_conversations
      WHERE tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid())
    )
  );

-- ============================================================
-- chat_blocked_phones — moderation blocklist
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_blocked_phones (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone_hash   TEXT        NOT NULL,
  blocked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  blocked_by   UUID        NULL REFERENCES profiles(id) ON DELETE SET NULL,
  reason       TEXT        NULL,
  UNIQUE (tenant_id, phone_hash)
);

ALTER TABLE chat_blocked_phones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chat_blocked_phones_tenant_all"
  ON chat_blocked_phones FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- ============================================================
-- Plan + subscription extensions
-- ============================================================
ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS chat_addon_available BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE tenant_subscriptions
  ADD COLUMN IF NOT EXISTS chat_addon_active   BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS chat_addon_since    TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS chat_addon_override BOOLEAN     NULL;
-- chat_addon_override: NULL = follow plan; TRUE = force-enable; FALSE = force-disable.
-- Used by superadmin per-tenant overrides regardless of plan.
