# Stabilization release runbook (EX-12)

Companion to `2026-10-26-stabilization-execution-plan.md` and
`2026-10-26-ex-00-baseline.md`. Everything below is prepared; nothing here has
been applied to production. Steps marked **[prod]** change production and need
an explicit go-ahead.

## 1. Pull requests

| PR | Phase | Migration | Depends on |
|---|---|---|---|
| #11 | EX-01 profiles self-promotion, anonymous analytics RPCs | `20261027090000_profiles_and_analytics_privileges` | — |
| #12 | EX-01 role-based writes, server-only orders and chat | `20261027091000_tenant_write_privileges` | — |
| #13 | EX-02 deploy gated by CI, image by SHA, build secrets | — (Coolify `IMAGE_TAG` env on first deploy) | — |
| #14 | EX-06 private menu, immediate cache expiry | `20261027092000_private_menu_public_reads` | — |
| #15 | EX-03 strict pricing, atomic idempotent orders | `20261027093000_atomic_orders` | — |
| #16 | EX-04 payment transitions, confirmation | `20261027094000_payment_divergences` | — |
| #17 | EX-07 order history by identity | `20261027095000_order_customer_identity` | #15 (stacked) |
| #18 | EX-05 custom domains, SEO, auth redirect | — | — |
| #19 | EX-10 dependencies (audit 28 → 0) | — | — |
| #20 | EX-08/09 onboarding, AI billing, rate limits | `20261027096000_atomic_onboarding`, `20261027097000_ai_billing_batches` | — |
| #21 | EX-11 overlay focus, video encode slot | — | — |

CI status when this runbook was written: every PR's own tests pass; the only
failing e2e test on the others is `public-menu-cache.spec.ts`, which fails on
`main` today and is fixed by #14. Merge #14 first and rebase the rest.

## 2. Why the order matters

- `main` currently deploys on every push, without waiting for CI (fixed by
  #13). Until #13 is in, **merging a PR deploys it**.
- Code that calls a new function must not reach production before the
  migration that creates it: #15 calls `create_order_with_items`, #17 calls
  `link_orders_to_verified_phone`, #20 calls `complete_onboarding` and
  writes `billing_batch`. Deploying any of them first breaks ordering,
  the customer panel or onboarding.
- The privilege migrations (#11, #12, #14) only tighten access; the current
  code works with them (it writes with the service role), so they can be
  applied before or after their code.

## 3. Migration ledger (do this once, before any new migration) [prod]

Production's `supabase_migrations.schema_migrations` is missing the 12 files
from `20261009120000_launch_checklist_items` to `20261026130000_menu_engagement`,
although their objects exist (verified read-only on 2026-10-26: e.g.
`launch_checklist_items`, `waiter_calls`, `audit_events`, `ai_usage_events`,
`mirror_tenant_plan()`, `get_menu_engagement()`). `npm run db:migrate` lists
them as pending and `--apply` would run them again.

1. Back up the database (Supabase dashboard → Database → Backups, or
   `pg_dump` of the `public` and `supabase_migrations` schemas).
2. Re-check each of the 12 files' objects exist (catalog query in the
   baseline, section 4).
3. Record them without running: `npm run db:migrate -- --baseline=20261026130000 --apply`.
4. `npm run db:migrate` must then list only the new `20261027…` files.

## 4. Release sequence

Each step: apply (if any) → deploy → verify. Stop on any failed check.

| # | Action | Verify |
|---|---|---|
| 1 | **[prod]** Ledger reconciliation (section 3) | dry run lists only the eight 2026-10-27 files |
| 2 | Merge #14 (EX-06) **[prod deploy]**; apply `…092000` with `--only` | `/test`: private menu shows nothing anonymously; menu edits visible at once |
| 3 | **[prod]** Apply `…090000` and `…091000` (#11, #12), then merge both | as a store-staff account: PATCH `/rest/v1/profiles` role → refused; product price update → refused; admin still edits |
| 4 | Merge #13 (EX-02) | next main push: CI `deploy` job runs after `checks`+`e2e`; Coolify env `IMAGE_TAG` = SHA; `/api/health/ready` release = SHA |
| 5 | **[prod]** Apply `…093000`, then merge #15 (EX-03) | place a test order: one order, items present, `currency`/`subtotal` set; same Idempotency-Key → same id |
| 6 | **[prod]** Apply `…095000`, then merge #17 (EX-07) | `/<slug>/me` lists only own orders |
| 7 | **[prod]** Apply `…094000`, then merge #16 (EX-04) | confirmation page with a typed `?redirect_status=succeeded` shows "Processing" |
| 8 | Merge #18 (EX-05) | on a custom domain: `/`, `/api/orders` (JSON 400 for empty body), `/checkout/<id>` |
| 9 | **[prod]** Apply `…096000`, `…097000`, then merge #20 (EX-08/09) | new signup completes; AI billing run with no events → `nothing_to_bill` |
| 10 | Merge #19 (EX-10), #21 (EX-11) | `/api/health/ready`, a menu, an admin page, MCP 401 without token |

Apply one file: `npm run db:migrate -- --only=<file>.sql --apply` (dry run first
without `--apply`). Merge conflicts to expect while rebasing: `supabase/seed.sql`
(#14 and #18 both append; keep both blocks), `.github/workflows/ci.yml`
(#13 and #20), `package.json` scripts (#13, #16, #19), `src/app/api/orders/route.ts`
(#15 → #17 stacked).

## 5. Rollback

- **Code**: before #13, revert the merge commit (main redeploys). After #13,
  run the `Redeploy or roll back` workflow with the previous SHA (it must have
  a green CI run and an image in GHCR).
- **Privilege migrations**: do not restore the old permissive policies. If a
  legitimate writer is blocked, add the specific grant/policy it needs.
- **Order/payment migrations** are additive (new columns, functions, a table):
  old code keeps working with them, so a code rollback needs no schema
  rollback.
- **Data**: no backfill runs automatically. `npm run payments:reconcile` and
  `scripts/report-customer-phone-backfill.ts` are report-only.

## 6. Production configuration found (not changed)

| Item | State | Effect |
|---|---|---|
| Stripe | `STRIPE_SECRET_KEY` empty, no webhook secret | online payment is off; EX-04 needs Stripe test mode in staging to be proven end to end |
| Upstash Redis | absent | limits now enforced in memory (#20); add Redis for multi-instance limits |
| Sentry | `SENTRY_DSN` absent | no error reporting |
| `CRON_SECRET` | absent | blog scheduler returns 503: not running |
| `MENU_REVALIDATE_SECRET` | absent | `/api/internal/revalidate-menu` is off (404); admin writes still revalidate |
| Xphere | `XPHERE_SYNC_ENABLED=true` | CRM sync is live (planning state says "dark") |

## 7. Still to prove outside CI

- Signed Stripe webhook + Payment Element checkout in Stripe test mode.
- Custom domain on real DNS: Stripe return URL, OAuth redirect allow-lists.
- Authenticated MCP tool calls with the SDK 1.32.2 override.
- Policy state after the migrations: re-run the baseline catalog inventory
  (read-only) and compare with section 4 of the baseline.
