---
initiative: autoblog-parity
repo: xmartmenu
phase: P5
role: builds the whole system from zero
status: planned
---

# Auto-Blog Parity — Xmartmenu

Read [`MASTER.md`](./MASTER.md) first.

Xmartmenu has **no blog at all** — `blog` appears only in
`src/lib/marketing/reserved-paths.ts` as a reserved slug. This is the largest build of the
initiative: public blog, admin, super-admin gate, generator, scheduler and Telegram, all new.

It is also the repo with the **least** scheduling infrastructure: no `node-cron`, no Inngest,
no Vercel cron. Scheduling comes entirely from the org's `skale-cron` crontab hitting an HTTP
endpoint (MASTER D-07). No new infrastructure is needed.

Multi-tenant: every table carries `tenant_id`, the super-admin gate applies, and generation
runs on the **tenant's own** OpenRouter key (MASTER D-05).

## XM-00 — Decision gate: ANSWERED

**The blog is Xmartmenu's OWN marketing blog, not a per-tenant feature.**

Restaurants do not get a blog. The reader is the restaurant owner we are selling
to, not their diner. That answer shrinks this phase considerably: no tenancy on
any table, no per-tenant AI key, no plan gating, no `/[slug]/blog` route, and no
question about whether a pizzeria wants a CMS. It is the platform site's blog,
living at `/blog` beside the landing page, edited from superadmin.

## Tasks

| id | task | status |
|---|---|---|
| ~~XM-01~~ | ~~`src/lib/blog/contract.ts`~~ | **DONE** (P0) |
| ~~XM-02~~ | ~~Schema + RLS~~ | **DONE** — `058_platform_blog.sql`. Platform-level, no `tenant_id`. RLS on with no policy everywhere except `blog_posts`, which keeps a public read for published rows because that is the entire point |
| ~~XM-03~~ | ~~Public routes~~ | **DONE** — `/blog` and `/blog/[slug]` under `(marketing)`, plus sitemap entries in their own try/catch so a blog read failing cannot cost the tenant entries. `blog` was already a reserved slug, so no tenant can shadow it |
| ~~XM-04~~ | ~~`prompt.ts` + `schedule.ts`~~ | **DONE** — schedule byte-identical; the 8 pillars are this blog's own (menu engineering, margin, delivery vs marketplace, operations, photos and copy, …), written in pt-BR for a Brazilian restaurant owner |
| **XM-05** | Generator | **DONE** — imagens incluídas (`src/lib/blog/cover-image.ts`: 16:9 + WebP + upload em `_platform/blog/`, best-effort para que um modelo de imagem ocupado nunca custe um post; as páginas públicas e o card de OG passaram a exibi-las) — pillar/RSS topic → content → link whitelist → tag allowlist → 600–4000 bounds → draft or publish → job row with stage timings → cost logged. The AI key lives on `blog_settings`, **encrypted at rest**, because this repo has no platform-wide credential. **No cover generation yet** |
| ~~XM-06~~ | ~~RSS + validator + retry~~ | **DONE** — `rss.ts` (fetcher + ranker), `content-validator.ts`, `ai-retry.ts`. RSS optional: an empty or off-topic feed falls back to the pillar rotation |
| **XM-07** | Scheduling | **DONE in code** — `POST /api/internal/blog/cron/generate` and `/fetch-rss` behind `CRON_SECRET`. This repo has NO in-process scheduler, so this is the only path, not a break-glass twin. **Still to do — OPS, not code: register both in the `skale-cron` crontab and set `CRON_SECRET` in Coolify.** Until that happens this repo's blog never generates on its own; the superadmin console's "Gerar agora" works regardless. |
| ~~XM-08~~ | ~~DB lock~~ | **DONE** — one conditional UPDATE on `lock_acquired_at`, stale after 10 min. Necessary here: the pull-always Coolify deploy can briefly overlap two instances |
| **XM-09** | Superadmin surface | — | **DONE** — `/blog` in the superadmin console: schedule (posting hour + timezone + the server-computed next run), voice/models, the encrypted OpenRouter key as a write-only field, approval queue, RSS feeds with fetch-now and per-feed errors, Telegram (separate alert vs approval bots and chats, forum topics), and generation history with per-stage timings. Initial state is read by the SERVER page — the encrypted key is destructured out there, so it never reaches the RSC payload. A `toggle` action was added to the RSS route so pausing a feed does not mean deleting and re-adding it. |
| ~~XM-10~~ | ~~Tests~~ | **DONE** — 47 tests in `tests/unit/blog/`. This repo had no test runner at all; it gains a deliberately narrow vitest config rather than shipping these modules unguarded |
| ~~XM-11~~ | ~~Telegram approvals~~ | **DONE except setWebhook** — separate approvals bot, group + forum-topic delivery, fan-out surviving one bad destination, chat-id validation at save, encrypted tokens, webhook authenticated by the shared secret. **The secret must be registered with Telegram manually** |
| ~~XM-12~~ | ~~Plan gating~~ | **NOT APPLICABLE** — the blog is the platform's, so there is no tenant plan to gate it behind |

## Still open

- **Cover images.** Posts publish without one; `durations_ms.image` is null.
- **`setWebhook` on save + a reconcile job.** Without them a revoked token or a
  domain change leaves the Approve/Reject buttons dead with no signal in the
  product: sending still works, only the taps go nowhere.
- **The superadmin React panel.** Every endpoint exists; nothing renders them.
- **Crontab + `CRON_SECRET`.** Nothing runs on a schedule until both are set.

## Guardrails specific to this repo

- **Tenant isolation.** Every new query is tenant-scoped through the existing
  `get-effective-tenant` / RLS path. A blog post must never be readable across tenants, and
  the public route must resolve the tenant from the slug, not from a session.
- **Encrypted credentials.** This repo already encrypts the chat-addon OpenRouter key at
  rest. The blog key uses the same `src/lib/crypto.ts` — do not introduce a plaintext column
  to match what the older repos currently do; they are the ones migrating to this standard
  (MASTER D-06).
- **Deploy** is a prebuilt GHCR image pulled by Coolify via `docker-compose.yaml`. New env
  vars (`CRON_SECRET`, `BLOG_AI_TIMEOUT_MS`, `PUBLIC_ORIGIN`) are set in the Coolify app
  configuration, not in the compose file.
- **Reserved paths.** `blog` is currently reserved as a tenant slug — keep that reservation
  and make sure the new route does not collide with it.

## Order of work

1. XM-00 (gate — do not start without an answer)
2. XM-01, XM-02 (contract + schema + RLS)
3. XM-03 (public blog, manual posts only — ships value before any AI)
4. XM-09 partial (post CRUD admin)
5. XM-04, XM-05, XM-08 (prompt, generator, lock)
6. XM-07 (scheduling)
7. XM-06 (RSS)
8. XM-11 (Telegram + groups)
9. XM-10, XM-12, XM-09 complete, XM-13
