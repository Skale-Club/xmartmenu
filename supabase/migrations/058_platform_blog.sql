-- 058_platform_blog.sql
--
-- Auto-blog parity XM-02 (.planning/initiatives/autoblog-parity/MASTER.md §3).
--
-- SCOPE: this is Xmartmenu's OWN marketing blog, at /blog on the platform site.
-- It is NOT a per-tenant feature — restaurants do not get a blog, and nothing
-- here carries a tenant_id. That decision closes XM-00: the reader is the
-- restaurant owner we are selling to, not their diner.
--
-- Everything is platform-level and edited from the superadmin panel, which is
-- why the tables sit next to platform_settings rather than next to the tenant
-- tables, and why RLS is on with no policy on every operational table: nothing
-- public reads them, the server uses the service role, and an empty policy set
-- denies anon and authenticated outright. blog_posts is the exception — the
-- public site reads published rows.

-- ── blog_posts ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.blog_posts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title                TEXT NOT NULL,
  slug                 TEXT NOT NULL,
  content              TEXT NOT NULL,
  excerpt              TEXT,
  cover_image_url      TEXT,
  meta_description     TEXT,
  focus_keyword        TEXT,
  tags                 TEXT,
  author_name          TEXT,
  reading_time_minutes INTEGER,
  -- Distinguishes a generated draft from a hand-written one, which is what the
  -- approval queue filters on.
  ai_generated         BOOLEAN NOT NULL DEFAULT FALSE,
  status               TEXT NOT NULL DEFAULT 'draft',
  published_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT blog_posts_status_check CHECK (status IN ('draft', 'published'))
);

CREATE UNIQUE INDEX IF NOT EXISTS blog_posts_slug_unique ON public.blog_posts (slug);
CREATE INDEX IF NOT EXISTS blog_posts_published_idx ON public.blog_posts (status, published_at DESC);

ALTER TABLE public.blog_posts ENABLE ROW LEVEL SECURITY;

-- The only public read on this migration: the marketing site renders published
-- posts for anonymous visitors, which is the entire point of the feature.
DROP POLICY IF EXISTS blog_posts_public_read ON public.blog_posts;
CREATE POLICY blog_posts_public_read ON public.blog_posts
  FOR SELECT USING (status = 'published');

-- ── blog_settings ───────────────────────────────────────────────────────────
--
-- One row, pinned to id = 1 by the check constraint, so an upsert can never
-- quietly create a second configuration that nothing reads.

CREATE TABLE IF NOT EXISTS public.blog_settings (
  id                    INTEGER PRIMARY KEY DEFAULT 1,
  enabled               BOOLEAN NOT NULL DEFAULT FALSE,
  posts_per_day         INTEGER NOT NULL DEFAULT 1,
  -- Anchor hour 0-23 in the timezone below. NULL keeps a drifting cadence, so
  -- nothing can promise a publishing time until someone picks an hour.
  posting_hour          INTEGER,
  timezone              TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  last_run_at           TIMESTAMPTZ,
  -- The generation lock. In the DATABASE, not in module state: this runs on a
  -- container that can be rolled with two instances briefly alive, and the cron
  -- endpoint can be called while a manual run is in flight. Stale after ten
  -- minutes so a crashed run frees itself.
  lock_acquired_at      TIMESTAMPTZ,
  seo_keywords          TEXT NOT NULL DEFAULT '',
  prompt_style          TEXT NOT NULL DEFAULT '',
  system_prompt         TEXT NOT NULL DEFAULT '',
  enable_trend_analysis BOOLEAN NOT NULL DEFAULT TRUE,
  rss_enabled           BOOLEAN NOT NULL DEFAULT FALSE,
  -- FALSE queues every generated post as a draft for approval.
  auto_publish          BOOLEAN NOT NULL DEFAULT FALSE,
  -- ENCRYPTED AT REST with src/lib/crypto.ts, the same envelope the per-tenant
  -- chat-addon key already uses. There is no platform-wide AI credential in
  -- this repo, so the blog carries its own — and it carries it encrypted,
  -- because that is already the standard here.
  openrouter_api_key    TEXT,
  text_model            TEXT NOT NULL DEFAULT '',
  image_model           TEXT NOT NULL DEFAULT '',
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT blog_settings_singleton CHECK (id = 1),
  CONSTRAINT blog_settings_posting_hour_range
    CHECK (posting_hour IS NULL OR (posting_hour >= 0 AND posting_hour <= 23)),
  CONSTRAINT blog_settings_posts_per_day_range
    CHECK (posts_per_day >= 0 AND posts_per_day <= 24)
);

ALTER TABLE public.blog_settings ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN public.blog_settings.openrouter_api_key IS
  'Encrypted at rest (src/lib/crypto.ts encryptApiKey). Never returned to a client — the API exposes hasKey instead.';

-- ── blog_generation_jobs ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.blog_generation_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL until the post exists: the job row is created BEFORE generation runs.
  post_id       UUID REFERENCES public.blog_posts(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  trigger       TEXT,
  source        TEXT,
  rss_item_id   UUID,
  pillar_id     TEXT,
  topic         TEXT,
  model         TEXT,
  error_message TEXT,
  -- {topic, content, image, upload, total}; image is NULL when that stage was
  -- skipped, which is not the same as an image that took 0ms.
  durations_ms  JSONB,
  attempts      INTEGER NOT NULL DEFAULT 1,
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT blog_generation_jobs_status_check
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  CONSTRAINT blog_generation_jobs_trigger_check
    CHECK (trigger IS NULL OR trigger IN ('cron', 'manual', 'telegram')),
  CONSTRAINT blog_generation_jobs_source_check
    CHECK (source IS NULL OR source IN ('pillar', 'rss', 'manual'))
);

CREATE INDEX IF NOT EXISTS blog_generation_jobs_created_idx
  ON public.blog_generation_jobs (created_at DESC);

ALTER TABLE public.blog_generation_jobs ENABLE ROW LEVEL SECURITY;

-- ── blog_post_feedback ──────────────────────────────────────────────────────
--
-- The approve/reject signal that steers the next generation. Title and excerpt
-- are snapshots so the signal survives a rejected post being deleted.

CREATE TABLE IF NOT EXISTS public.blog_post_feedback (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id      UUID REFERENCES public.blog_posts(id) ON DELETE SET NULL,
  post_title   TEXT NOT NULL,
  post_excerpt TEXT,
  source_title TEXT,
  verdict      TEXT NOT NULL,
  reason       TEXT,
  decided_by   TEXT NOT NULL DEFAULT 'admin',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT blog_post_feedback_verdict_check CHECK (verdict IN ('approved', 'rejected')),
  CONSTRAINT blog_post_feedback_decided_by_check CHECK (decided_by IN ('admin', 'telegram'))
);

CREATE INDEX IF NOT EXISTS blog_post_feedback_created_idx
  ON public.blog_post_feedback (created_at DESC);

ALTER TABLE public.blog_post_feedback ENABLE ROW LEVEL SECURITY;

-- ── RSS as an optional topic source ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.blog_rss_sources (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  url                 TEXT NOT NULL,
  enabled             BOOLEAN NOT NULL DEFAULT TRUE,
  last_fetched_at     TIMESTAMPTZ,
  -- 'ok' | 'error'. A failing feed is recorded and skipped, never auto-disabled:
  -- a publisher's hour of downtime must not silently unsubscribe us.
  last_fetched_status TEXT,
  error_message       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.blog_rss_sources ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.blog_rss_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id    UUID NOT NULL REFERENCES public.blog_rss_sources(id) ON DELETE CASCADE,
  -- Feed <guid>/<id>, else the link, else a deterministic hash. The unique index
  -- below IS the de-duplication strategy, which is why the fetcher needs no lock.
  guid         TEXT NOT NULL,
  url          TEXT NOT NULL,
  title        TEXT NOT NULL,
  summary      TEXT,
  published_at TIMESTAMPTZ,
  status       TEXT NOT NULL DEFAULT 'pending',
  -- Set only AFTER the post insert succeeds, so a failed run leaves the item
  -- available to the next one.
  used_at      TIMESTAMPTZ,
  used_post_id UUID,
  skip_reason  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT blog_rss_items_status_check CHECK (status IN ('pending', 'used', 'skipped'))
);

CREATE UNIQUE INDEX IF NOT EXISTS blog_rss_items_source_guid_uniq
  ON public.blog_rss_items (source_id, guid);

CREATE INDEX IF NOT EXISTS blog_rss_items_status_idx
  ON public.blog_rss_items (status, published_at DESC);

ALTER TABLE public.blog_rss_items ENABLE ROW LEVEL SECURITY;

-- ── ai_generation_logs ──────────────────────────────────────────────────────
--
-- Per-call cost ledger. Every column but step/provider/model/status is nullable:
-- a model that reports no token counts is normal, not an error, and a row that
-- will not write must never be able to fail a generation.

CREATE TABLE IF NOT EXISTS public.ai_generation_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  step          TEXT NOT NULL,
  provider      TEXT NOT NULL,
  model         TEXT NOT NULL,
  -- Truncated at write time: a cost ledger, not an archive of every prompt.
  prompt        TEXT,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  cost_usd      NUMERIC(10, 4),
  status        TEXT NOT NULL,
  error         TEXT,
  duration_ms   INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 'skipped' is not 'failure': a model that charges for the call and returns
  -- nothing succeeded at the API level. Conflating them makes the failure rate
  -- in this table meaningless.
  CONSTRAINT ai_generation_logs_status_check CHECK (status IN ('success', 'failure', 'skipped'))
);

CREATE INDEX IF NOT EXISTS ai_generation_logs_created_idx
  ON public.ai_generation_logs (created_at DESC);

ALTER TABLE public.ai_generation_logs ENABLE ROW LEVEL SECURITY;

-- ── telegram_settings ───────────────────────────────────────────────────────
--
-- Platform-level, for blog approval cards. An entry in either array is a chat
-- id, optionally with a forum-topic thread: "-1001234567890" or
-- "-1001234567890:42" (MASTER §6). A supergroup with forum topics enabled
-- REFUSES a message carrying no message_thread_id when its General topic is
-- closed, and files it in the wrong topic otherwise — both failures are
-- invisible from inside the product.

CREATE TABLE IF NOT EXISTS public.telegram_settings (
  id                  INTEGER PRIMARY KEY DEFAULT 1,
  enabled             BOOLEAN NOT NULL DEFAULT FALSE,
  -- Both tokens are ENCRYPTED AT REST (src/lib/crypto.ts), like every other
  -- credential this repo stores.
  bot_token           TEXT,
  chat_ids            TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  approvals_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
  -- A SEPARATE bot for approvals, so the one carrying a public webhook is not
  -- the one sending anything else: it can be revoked on its own, and a leaked
  -- webhook secret buys nothing elsewhere. NULL falls back to bot_token.
  approvals_bot_token TEXT,
  -- Empty falls back to chat_ids.
  approvals_chat_ids  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  -- Echoed by Telegram in X-Telegram-Bot-Api-Secret-Token on every webhook call.
  -- The webhook is a PUBLIC endpoint, so this is what proves the request came
  -- from Telegram: a chat_id in the body is attacker-controlled and proves
  -- nothing on its own.
  webhook_secret      TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT telegram_settings_singleton CHECK (id = 1)
);

ALTER TABLE public.telegram_settings ENABLE ROW LEVEL SECURITY;
