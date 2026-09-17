---
initiative: autoblog-parity
status: planned
created: 2026-09-16
owner: Skale Club
repos: [xkedule, websites, skaleclub, xtimator, xmartmenu]
reference_implementation: xkedule
---

# Auto-Blog Parity — Master Plan

> **This file is identical in all five repositories.** It is the shared contract.
> The per-repository task list lives next to it in `REPO-PLAN.md`.
> Source of truth for this file: `xkedule/.planning/initiatives/autoblog-parity/MASTER.md`.
> Change it there first, then copy to the other four in the same change.

## 1. Goal

One auto-blog system, with the same capabilities, running on all five products.
Today the five are at five different levels:

| Product | Blog | Auto-posting | Today |
|---|---|---|---|
| **xkedule** | multi-tenant | yes | best content engine, thinnest pipeline robustness |
| **skaleclub** | single-site | yes | best pipeline engineering (RSS, retry, preview, health) |
| **websites** | multi-tenant | yes | solid multi-tenant basics, only one with AI cost logging |
| **xtimator** | single-site | **no** | manual CRUD only |
| **xmartmenu** | **none** | no | `blog` is only a reserved slug |

**Xkedule is the mirror.** Every other product converges on it. Xkedule itself is not
finished: it absorbs RSS and the pipeline-robustness work from Skale Club, and AI cost
logging from Websites, in Phase 1 — *before* anyone copies from it.

## 2. Decisions

| # | Decision |
|---|---|
| **D-01** | **Xkedule is canonical.** `shared/blog-prompt.ts`, `shared/blog-schedule.ts` and the `BlogGenerator` shape are the specification. Other repos port, they do not reinvent. |
| **D-02** | **RSS is an optional topic source, never mandatory.** Precedence per run: (1) a pending RSS item above the score threshold when `rss_enabled`, else (2) editorial pillar rotation. Skale Club today *requires* RSS and skips with `no_rss_items`; that becomes a fallback to pillar rotation. |
| **D-03** | **One data contract** (§3) — identical table names, column names and enum values in all five repos, minus `tenant_id` in the single-site ones. |
| **D-04** | **Telegram everywhere, groups first-class.** `chat_ids` is always an array; supergroup ids (`-100…`) and forum topic threads are supported; approvals ride a **separate bot token** from the alert bot. |
| **D-05** | **AI key ownership follows tenancy.** Multi-tenant products (xkedule, websites, xmartmenu) run blog generation **exclusively** on the tenant's own OpenRouter key. Single-site products (skaleclub, xtimator) use the platform key. Both go through the same `resolveBlogAiConfig()` gate returning `null` when unconfigured. |
| **D-06** | **Keys encrypted at rest.** Adopt xmartmenu's `encryptApiKey`/`decryptApiKey` pattern in every repo. The API never returns a key — it returns `hasKey: true` and accepts the `"********"` sentinel to mean "keep the stored one". |
| **D-07** | **Scheduling is HTTP-first.** Every repo exposes `POST /api/blog/cron/generate` and `POST /api/blog/cron/fetch-rss` behind `CRON_SECRET`, driven by the org's `skale-cron` crontab on the Coolify VPS. In-process schedulers stay only where they already exist, gated by `DISABLE_INPROCESS_CRON=true`. Never both at once. |
| **D-08** | **Approval queue is the default.** `auto_publish` defaults to `false` in every repo; the generated post lands as a draft. |
| **D-09** | **Posting hour + timezone are mandatory.** Port `shared/blog-schedule.ts` verbatim. "When is the next post?" must be answerable in the admin UI of every product. |
| **D-10** | **Single-site repos keep a one-row settings table** — same columns as multi-tenant, minus `tenant_id`, minus the super-admin gate (`super_admin_enabled` is hardcoded `true`). |
| **D-11** | **No monorepo, no npm package.** Shared modules are copied verbatim with a `// SOURCE OF TRUTH: xkedule/<path> — sync changes back` header. A drift check lands in Phase 6. |
| **D-12** | **Migrations on live data are two-step.** Add new column → dual-write + backfill → drop old, in separate deploys. Never a bare `ALTER ... RENAME` on a table a paying tenant is using. |

## 3. Canonical data contract

Single-site repos (skaleclub, xtimator) omit every `tenant_id` column and the
`super_admin_enabled` flag.

### 3.1 `blog_settings`

| column | type | notes |
|---|---|---|
| `id` | serial pk | |
| `tenant_id` | int fk | multi-tenant only, unique |
| `super_admin_enabled` | bool, default false | platform kill-switch; whole feature invisible until on |
| `system_prompt` | text | **super-admin authored**, not tenant-editable |
| `enabled` | bool, default false | tenant toggle |
| `posts_per_day` | int, default 1 | 0 = paused |
| `posting_hour` | int null | 0–23, in the tenant's timezone; null = legacy drift mode |
| `last_run_at` | timestamp | advances on **attempt**, not on success |
| `lock_acquired_at` | timestamp | DB-level re-entrancy lock, stale after 10 min |
| `seo_keywords` | text | comma-separated |
| `prompt_style` | text | tenant-editable tone/style |
| `enable_trend_analysis` | bool, default true | |
| `rss_enabled` | bool, default false | turns RSS on as a topic source |
| `openrouter_api_key` | text | **encrypted at rest**, never returned |
| `text_model` | text | |
| `image_model` | text | |
| `auto_publish` | bool, default false | canonical name (was `auto_approve` in skaleclub/websites) |
| `updated_at` | timestamp | |

### 3.2 `blog_generation_jobs`

`id`, `tenant_id`, `post_id` (nullable fk), `status`, `trigger`, `source`, `rss_item_id`,
`pillar_id`, `topic`, `model`, `error_message`, `durations_ms` jsonb, `attempts`,
`locked_at`, `locked_by`, `started_at`, `completed_at`, `created_at`.

- `status` ∈ `pending | running | completed | failed | skipped`
- `trigger` ∈ `cron | manual | telegram`
- `source` ∈ `pillar | rss | manual`
- `durations_ms` = `{ topic, content, image, upload, total }`, `image` nullable

### 3.3 `blog_post_feedback`

`id`, `tenant_id`, `post_id` (fk, `on delete set null`), `post_title`, `post_excerpt`,
`source_title`, `verdict`, `reason`, `decided_by`, `created_at`.

- `verdict` ∈ `approved | rejected` — **canonical**. Replaces skaleclub's
  `signal: positive|negative` and websites' `rating: positive|negative`.
- `decided_by` ∈ `admin | telegram`
- Title/excerpt are snapshots so the signal survives deletion of a rejected post.

### 3.4 `blog_rss_sources` / `blog_rss_items`

- `blog_rss_sources`: `id`, `tenant_id`, `name`, `url`, `enabled`, `last_fetched_at`,
  `last_fetched_status`, `error_message`, `created_at`, `updated_at`
- `blog_rss_items`: `id`, `tenant_id`, `source_id` (fk cascade), `guid`, `url`, `title`,
  `summary`, `published_at`, `status` (`pending|used|skipped`), `used_at`, `used_post_id`,
  `skip_reason`, `created_at`; **unique(`source_id`, `guid`)**

### 3.5 `telegram_settings` (extended)

`chat_ids text[]`, `approvals_enabled bool`, `approvals_bot_token text`,
`approvals_chat_ids text[]`, `webhook_secret text`, on top of whatever each repo already has.

### 3.6 `ai_generation_logs`

Ported from websites: `id`, `tenant_id`, `step`, `provider`, `model`, `prompt` (truncated),
`input_tokens`, `output_tokens`, `cost_usd`, `status`, `error`, `duration_ms`, `created_at`.
Blog writes two steps: `blog_post` and `blog_image`.

## 4. Canonical API surface

Same paths in every repo (Next.js repos use the same paths as route handlers).

```
GET    /api/blog/settings                  admin
PUT    /api/blog/settings                  admin
GET    /api/blog/integration               admin — masked key + models
PUT    /api/blog/integration               owner — rotate key / set models
GET    /api/blog/models                    admin — live OpenRouter catalog, doubles as test-connection
POST   /api/blog/generate                  admin — manual run, bypasses cadence gates
POST   /api/blog/preview                   admin — generate without persisting
POST   /api/blog/posts/from-preview        admin — commit a preview
GET    /api/blog/jobs                      admin
GET    /api/blog/jobs/latest               admin
POST   /api/blog/jobs/:id/retry            admin
POST   /api/blog/jobs/:id/cancel           admin
GET    /api/blog/queue                     admin — drafts awaiting approval
POST   /api/blog/posts/:id/approve         admin
POST   /api/blog/posts/:id/reject          admin
GET    /api/blog/feedback                  admin
GET    /api/blog/rss-sources               admin
POST   /api/blog/rss-sources               admin
PATCH  /api/blog/rss-sources/:id           admin
DELETE /api/blog/rss-sources/:id           admin
GET    /api/blog/rss-items                 admin
GET    /api/blog/health                    admin
POST   /api/blog/cron/generate             CRON_SECRET bearer
POST   /api/blog/cron/fetch-rss            CRON_SECRET bearer
POST   /api/telegram/webhook               X-Telegram-Bot-Api-Secret-Token
GET    /super-admin/tenants/:id/blog-autopost     super-admin (multi-tenant only)
PATCH  /super-admin/tenants/:id/blog-autopost     super-admin (multi-tenant only)
```

Environment variables, same names everywhere:
`CRON_SECRET`, `BLOG_AI_TIMEOUT_MS` (default 30000), `OPENROUTER_API_KEY` (platform key,
single-site repos only), `API_CREDENTIAL_ENCRYPTION_KEY`, `DISABLE_INPROCESS_CRON`,
`PUBLIC_ORIGIN` (used to build Telegram callback URLs and absolute image URLs).

## 5. Shared modules

Copied verbatim, header-tagged with their source of truth.

| Module | Canonical home | What it holds |
|---|---|---|
| `shared/blog-contract.ts` | xkedule | enums + TS types from §3 (new file, Phase 0) |
| `shared/blog-prompt.ts` | xkedule | editorial pillars, geography, catalog, internal links, keyword dedup, title styles, length profiles, link sanitizer |
| `shared/blog-schedule.ts` | xkedule | `scheduledHours`, `zonedHourAndDay`, `isRunDue` — pure, no I/O |
| `server/blog/rss-fetcher.ts` | skaleclub | `rss-parser` singleton, upsert on `(source_id, guid)` |
| `server/blog/rss-selector.ts` | skaleclub | pure ranker: keyword overlap 0.6 + recency 0.4, 14-day window |
| `server/blog/content-validator.ts` | skaleclub | HTML tag allowlist + 600–4000 plain-text bounds + slugify |
| `server/blog/ai-retry.ts` | skaleclub | `withAiTimeout` + `withAiRetry` [1s, 5s, 30s] + transient classifier |
| `server/blog/telegram-approvals.ts` | xkedule | approval cards, callback handling, webhook secret, `setWebhook` reconcile |

## 6. Telegram group support (cross-cutting spec)

This is required in **all five** products.

1. **`chat_ids` is `text[]`.** An entry is either a plain chat id (`123456789`,
   `-1001234567890`) or `"<chat_id>:<thread_id>"` for a forum-topic thread. The send
   helper splits on `:` and passes `message_thread_id` when a thread is present. This keeps
   the existing `text[]` column and needs no extra migration.
2. **The bot must be a member of the group.** Telegram refuses to post into a group the bot
   has not joined; surface that error verbatim in the admin UI instead of a generic failure.
3. **Approvals use a separate bot token** (`approvals_bot_token`, falling back to
   `bot_token`). The approvals bot carries a public webhook; the alert bot must not, so a
   leaked webhook secret buys nothing on the notification channel.
4. **Approvals go to `approvals_chat_ids`** (falling back to `chat_ids`), because putting an
   owner's private chat in the shared list would also send them every lead/booking alert.
5. **The webhook is authenticated by `webhook_secret`**, echoed by Telegram in
   `X-Telegram-Bot-Api-Secret-Token`. A `chat_id` in the body is attacker-controlled and
   proves nothing. The secret rotates whenever approvals are re-enabled.
6. **`setWebhook` is reconciled on a schedule** (xkedule already does this, every 15 min).
   Without it, a revoked token or a domain change leaves the Approve/Reject buttons dead
   with no signal in the product: sending still works, only the taps go nowhere.
7. **A "Send test message" button per chat id**, so a misconfigured group is caught at save
   time and not at the first generated draft.
8. **Callback payload** is `{ action: 'approve'|'reject', postId, tenantId }`; a reject asks
   for a reason in a follow-up message and writes it to `blog_post_feedback.reason` with
   `decided_by = 'telegram'`.

## 7. Phases

Order matters: Phase 1 finishes the mirror before anyone copies from it.

| Phase | Scope | Why here |
|---|---|---|
| **P0** | Contract freeze — `shared/blog-contract.ts` in all five repos, no behaviour change | Every later migration has one target to write against |
| **P1** | **xkedule** completes the mirror: RSS, sanitizer, retry/timeout, preview, job retry/cancel, health, stage timings, cost logging | It is the source everyone ports from |
| **P2** | **websites** converges | Largest live tenant base — earliest real-world validation of the contract |
| **P3** | **skaleclub** converges (single-site) | Smallest delta; also donates RSS upstream in P1 |
| **P4** | **xtimator** builds from the xkedule structure on Next.js + Inngest | Needs the contract stable; no live blog automation to break |
| **P5** | **xmartmenu** builds from zero | Largest build; benefits from four prior ports |
| **P6** | Parity verification, drift check, end-to-end smoke on every product | Closes the initiative |

Telegram is **not** a separate phase — it is a deliverable inside each repo's phase, so no
product ships parity without it.

### Rough effort

| Phase | Tasks | Estimate |
|---|---|---|
| P0 | 5 (one per repo) | 0.5 sprint |
| P1 xkedule | 14 | 2 sprints |
| P2 websites | 16 | 2–3 sprints |
| P3 skaleclub | 9 | 1–2 sprints |
| P4 xtimator | 9 | 2 sprints |
| P5 xmartmenu | 10 | 3 sprints |
| P6 | 4 | 0.5 sprint |

## 8. Definition of parity

A product is done when **all** of these hold:

- [ ] Tables and enums match §3 exactly (minus tenancy columns where not applicable)
- [ ] Every endpoint in §4 exists with the same path, method and auth level
- [ ] Pillar rotation + geography + catalog + internal links + keyword dedup in the prompt
- [ ] RSS available as an optional topic source, with admin CRUD over sources and items
- [ ] Posting hour + timezone, and the admin UI states when the next post runs
- [ ] Approval queue by default; approve/reject feed `blog_post_feedback`; feedback feeds the prompt
- [ ] Telegram approvals working **into a group**, with a separate bot and a reconciled webhook
- [ ] HTML sanitizer + 600–4000 char bounds; a malformed generation fails the job, never publishes
- [ ] Timeout + backoff retry on every AI call; transient vs permanent classified
- [ ] Image best-effort: WebP, 16:9, curated fallback; a failed image never kills the post
- [ ] Cost and tokens logged per generation to `ai_generation_logs`
- [ ] DB-level lock (never an in-memory Set) so the HTTP cron path is safe
- [ ] `POST /api/blog/cron/generate` + `/fetch-rss` registered in the `skale-cron` crontab
- [ ] `/api/blog/health` green, stage timings recorded on completed jobs
- [ ] Unit tests for: schedule, RSS selector, sanitizer, retry classifier
- [ ] One end-to-end post generated, approved from a Telegram group, and published

## 9. Risks

| Risk | Mitigation |
|---|---|
| Column renames on live tenant data (`auto_approve`, `rating`, `signal`) | D-12 two-step migration; backfill script committed with the migration |
| Websites' visual-regression CI blocks on new admin UI | Regenerate baselines in the same PR (`npm run test:visual:update`) |
| Four repos gain an outbound RSS dependency + `rss-parser` | Fetcher failures are per-source and non-fatal; `last_fetched_status` surfaces them in the admin |
| Generation cost rises once every product is on | Cost logging lands in P1, before the rollout, so spend is visible per tenant from day one |
| Copied modules drift apart | P6 drift check; `SOURCE OF TRUTH` header on every copied file |
| xmartmenu has no scheduler at all | HTTP cron endpoint + `skale-cron` crontab entry (D-07) — no new infrastructure |
| xmartmenu product fit | XM-00 is an explicit decision gate before any code. **Answered "platform only", then reversed on 2026-09-17: restaurants get a blog too** (XM-14). The gate did its job — the reversal cost a rewrite of one migration that had never reached production, and nothing else |
| Uma migração passar no typecheck e falhar contra a base de dados | Correr as migrações contra um Postgres local com stubs de Supabase antes de as aplicar (`docs/runbooks/migracoes.md` no xmartmenu). Foi assim que se apanhou, na 058, uma política de RLS cuja subconsulta a `tenants` corria sob a RLS de quem lia e por isso tornava invisível ao público o blog de TODOS os restaurantes. Nem o typecheck nem os testes de unidade lhe tocavam |
| Reaplicar migrações já aplicadas, ou aplicar meia migração | Runner único nos cinco repos (`npm run db:migrate`): registo partilhado com o Supabase CLI, simulação por omissão, cada ficheiro numa transação com o seu registo. Recusa aplicar quando o registo está vazio com muitas pendentes, e quando duas migrações partilham a versão — o xkedule tem seis pares desses e o xtimator dez |
