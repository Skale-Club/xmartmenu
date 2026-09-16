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

## XM-00 — Decision gate (do this before any code)

Does a restaurant/menu tenant want a blog?

**Recommendation: yes, gated by plan.** The tenant public site already has SEO plumbing
(`src/lib/seo.ts`, `src/app/sitemap.ts`, `robots.ts`) and `blog` is already reserved, so the
surface was anticipated. A per-tenant blog at `/[slug]/blog` is a local-SEO asset for a
restaurant (menu explainers, seasonal dishes, neighbourhood content). Gate it behind
`src/lib/tenant-plan.ts` so it is an upsell, not a default cost.

**If the answer is no**, close this plan and record it in `MASTER.md` §1 — four-product
parity is a legitimate outcome, five-product parity for its own sake is not.

The rest of this file assumes the answer is yes.

## Architecture mapping

| Express repos | Xmartmenu |
|---|---|
| `server/routes/blog*.ts` | `src/app/api/blog/**/route.ts`, `src/app/api/internal/blog/**` for cron |
| `server/services/blog-generator.ts` | `src/lib/blog/generator.ts` |
| `shared/blog-prompt.ts`, `shared/blog-schedule.ts` | `src/lib/blog/prompt.ts`, `src/lib/blog/schedule.ts` |
| tenant-scoped `storage.forTenant()` | `src/lib/get-effective-tenant.ts` + tenant-scoped Supabase queries |
| `node-cron` | **none** — `skale-cron` crontab → `POST /api/internal/blog/cron/*` on `CRON_SECRET` |
| plaintext key columns | the repo's existing `encryptApiKey`/`decryptApiKey` (`src/lib/crypto.ts`) — **already the best practice in the org** |

## Tasks

| id | task | notes |
|---|---|---|
| **XM-00** | Product decision gate (above) | blocks everything else |
| **XM-01** | `src/lib/blog/contract.ts` — enums and types from MASTER §3 | |
| **XM-02** | Migrations: `blog_posts` (tenant-scoped, unique `(tenant_id, slug)`) + `blog_settings`, `blog_generation_jobs`, `blog_post_feedback`, `blog_rss_sources`, `blog_rss_items`, `ai_generation_logs`, `telegram_settings` — **RLS on every table**, public read only for published posts of an active tenant | follow the repo's existing RLS conventions |
| **XM-03** | Public routes: `/[slug]/blog` (list) and `/[slug]/blog/[post]` under `src/app/(public)/[slug]/`, with metadata via `src/lib/seo.ts`, entries in `sitemap.ts`, and `blog` removed from the blocking behaviour in `reserved-paths.ts` for the blog route itself | tenant branding comes from the existing tenant theme, never hardcoded |
| **XM-04** | Port `src/lib/blog/prompt.ts` + `schedule.ts` from xkedule, adapted to restaurant context: pillars (dishes, ingredients, seasonality, neighbourhood, events), geography from the tenant address, catalog from the tenant's **menu items**, internal links to menu categories and published posts | the catalog section is the interesting adaptation — a menu is a richer catalog than a service list |
| **XM-05** | `src/lib/blog/generator.ts` — full pipeline per MASTER §8, on the tenant's own OpenRouter key (decrypted at use), image to the repo's existing storage layer, WebP + 16:9 + fallback cover | |
| **XM-06** | Port `rss-fetcher`, `rss-selector`, `content-validator`, `ai-retry` from skaleclub | new dep: `rss-parser` |
| **XM-07** | Scheduling: `POST /api/internal/blog/cron/generate` + `/fetch-rss` behind `CRON_SECRET`, sweeping every tenant with the platform gate on; register both in the `skale-cron` crontab and document the required Coolify env vars in the README | the only scheduling path in this repo — there is no in-process alternative |
| **XM-08** | DB lock (`blog_settings.lock_acquired_at`, stale after 10 min) | mandatory: the container runs behind a pull-always Coolify deploy and can overlap during a rollout |
| **XM-09** | Tenant admin under `src/app/(admin)`: Blog (post CRUD) + Automation (settings, posting hour, approval queue, jobs with retry/cancel + timings, preview, RSS sources, feedback, cost) | mirror xkedule's tab layout |
| **XM-10** | Super-admin under `src/app/(superadmin)`: per-tenant `super_admin_enabled` toggle + `system_prompt` editor, matching xkedule's `/tenants/:id/blog-autopost` | |
| **XM-11** | Telegram: `telegram_settings` + approvals per MASTER §6 — separate approvals bot, `chat_ids text[]` with group and thread support, `POST /api/telegram/webhook`, `setWebhook` on save, reconcile sweep (ride the same `skale-cron` entry), per-chat test button | this repo has **no** Telegram today |
| **XM-12** | Plan gating in `src/lib/tenant-plan.ts` — blog + autopost as a capability, hidden entirely when the plan lacks it | |
| **XM-13** | Tests: schedule, RSS selector, sanitiser bounds, retry classifier, tenant isolation on every new query | |

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
