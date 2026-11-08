# Development database: fictional dataset (plan)

Status: **plan, not built yet** (2026-11-08). Decision: XMM-D-2 in the Notion journal.

## Why

Owner's universal rule (`skaleclub-apps/agents/RULES.md` §4, 2026-11-07): the app's existing
Supabase project is the **development** database and holds a robust **fake** dataset covering
every type, status and edge case. Production is never copied into development by default;
`npm run db:pull` is an emergency tool that needs the owner's explicit OK for each run
(`docs/runbooks/dev-database-pull.md`).

Today the dev project (`ktogbpqookfcqilqvici`, production until the 2026-11-06 cutover) still
holds the **real** pre-cutover data, and no fictional dataset exists:

- `supabase/seed.sql`: 5 e2e restaurants and fixed logins. It runs only on a local `supabase db reset`.
- `scripts/seed.ts` and `supabase/seed_test_data.sql`: one demo restaurant tied to one real user.
  They have no dev-target guard.

## Principles

1. **Fiction only.** Invented company and person names, fictional addresses, `@example.test`
   emails and `+1 555 01xx` phones. Stripe values are test-mode only: `acct_test_*`, `pi_test_*`.
   No real person, customer or card.
2. **Deterministic.** Fixed UUIDs with a seeded generator, so ids are stable across runs and
   tests and bug reports can name them.
3. **One command, one transaction.** `npm run db:seed:dev` resolves the target only through
   `developmentConfig()` (`scripts/lib/database-target.mjs`) and refuses any other target. It
   takes a JSON backup of the target first, the same way as `db:pull`. Then it replaces all
   app data in a single transaction (error means ROLLBACK).
4. **Coverage is tested.** A unit test reads every `CHECK (... IN (...))` list from
   `supabase/migrations` and fails if the seed leaves a value unused. When a new status is
   added, the seed has to follow.
5. **No outbound effects.** The seed writes rows only. It never calls Stripe, AI, Telegram,
   Xphere or email.

## Fictional companies (coverage matrix)

| Slug | Plan / subscription | Covers |
|---|---|---|
| `lumen-bistro` | payments, active, monthly | Stripe Connect connected (test account); dine-in, pickup and delivery; tips, upsell, item notes; AR models; menus in en/pt/es; feed view; verified custom domain |
| `casa-pinheiro` | orders, active, annual | dine-in only, table management, waiter calls in every reason and status, KDS orders in every status, `pt` default, non-USD currency |
| `harbor-noodle-co` | menu, trial | several menus, one private menu, list view, QR codes, scan analytics |
| `ember-grill` | payments, past_due | switches ON but blocked by the plan (empty live features) |
| `quiet-fig-cafe` | orders, cancelled | `tenants.is_active = false` |
| `northside-pizza-lab` | orders, active | half-and-half options, all four price rules, ingredient customization, several locations, delivery zones |
| `blank-slate-diner` | menu, trial | just onboarded: no menu, empty catalog, launch checklist incomplete |
| `old-oak-tavern` | orders, active, override prices | grandfathered note, unverified custom domain |
| `polyglot-kitchen` | payments, active | 15 supported languages, partial translations, RTL (`ar`), long names, emoji; ~500 products for pagination and performance |
| `inkwell-eatery` | menu + blog override | blog posts draft and published; generation jobs in every status, trigger and source; RSS items; feedback; chat add-on (`own_key`, `platform`, `included`); AI usage events; blocked phones |

**Users**
- One fictional superadmin.
- For each company: a store-admin, a store-staff user, and customers (`customer_profiles`
  linked by both `customer_link_method` values).

**Orders**
- Every `orders.status` × `order_type` combination, with `added_via` `upsell` and `chat` items.
- `payment_divergences` rows.
- Spread over the last 90 days.

**Analytics**
- `menu_sessions` and `menu_events` for all 21 `event_name` values.
- Every `source`, `entry_source` and `device_class` value.

**Other**
- `audit_events` rows.
- `app_tenant_effects` in every kind and status, if that table exists on dev (see Phase 0).

## Media

The dev outbound guard only reaches the dev Supabase host, so fictional media go to dev
Supabase Storage. The real images currently stored there are removed in Phase 3.

- **Images:** about 40 small generated WebP images (product, logo, cover, hero, blog cover), kept
  in the repo under `scripts/dev-seed/assets/`.
- **Video and 3D:** one short sample video and one GLB/USDZ pair for `product_media` and
  `product_ar_models`. Their source and license need the owner's OK (open question 3).

## Phases

0. **Inspect the live dev schema, read-only.**
   - Do the owned-only `app_*` tables from `docs/proposals/*-owned-only.sql` exist?
   - Are the foreign keys to `auth.users` still there (`profiles`, `orders`, `waiter_calls`,
     `customer_profiles`)?
   - Is the migration ledger present?

   This decides whether fake users need `auth.users` rows with the same UUIDs as `profiles` and
   `app_accounts`.
1. **Generator and tests.** `scripts/dev-seed/` (TypeScript, deterministic) builds the rows. Unit
   tests cover:
   - the target guard;
   - fiction-only values (no real-looking emails or phones);
   - CHECK-value coverage;
   - referential integrity.
2. **CI rehearsal.** A job applies the migrations to a disposable PostgreSQL, runs the seed twice
   (idempotency) and checks the counts. This mirrors the existing `dev-db-pull` job.
3. **Replace the real data on the dev project.** This needs the owner's explicit OK.
   - Confirm the verified cutover backup holds the pre-cutover data.
   - Take the seed's own JSON backup.
   - Run the seed (one transaction).
   - Empty the dev Storage buckets of real files and upload the fictional assets.
   - Afterwards, a read-only check: no row matches a real email or phone domain.
4. **Close.**
   - Gate `db:pull` behind an explicit `--emergency` flag.
   - Set `SOURCE_IS_CANDIDATE` to `false` in `scripts/lib/dev-db-pull.ts`; its "stale 2026-11-04
     candidate" notice is outdated since the cutover. Update its test.
   - Update the runbook and the journal.

Phases 0, 1 and 3 are light (rows against a remote database). Phase 2 runs in CI.

## Open questions for the owner

1. OK to permanently replace the real pre-cutover data in the dev project once the cutover
   backup is confirmed?
2. Login for fictional users: Google sign-in cannot work for invented accounts. Options:
   - a dev-only command that mints an `app_sessions` row for a chosen fake user (preferred);
   - password users as in the e2e seed.
3. Source of the sample 3D model and video: generated in-house, or a CC0 asset?
4. Currencies beyond USD: is `BRL` enough for the non-USD case?
