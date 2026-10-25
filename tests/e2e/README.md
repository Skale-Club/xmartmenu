# Tests

| Layer | Where | What it covers | Runs on |
|---|---|---|---|
| Unit | `tests/unit` (Vitest) | Pure logic: plan rules, upsell steps, i18n, translations, AI helpers, chat rules | every push, in seconds |
| API integration | `tests/e2e/api` (Playwright) | `POST /api/orders` against the real app + database: plans, tables, staff vs guest, prices | every push (CI) |
| Flows | `tests/e2e/flows` (Playwright) | Guest menu on a phone, waiter app and admin on desktop | every push (CI) |

All database-backed tests run against a **local Supabase** built from
`supabase/migrations` + `supabase/seed.sql` — never against production. The
helper in `fixtures/db.ts` refuses any non-local database.

## The seed

`supabase/seed.sql` creates one restaurant per plan, with fixed ids mirrored in
`fixtures/seed.ts`:

| Slug | Plan | Used for |
|---|---|---|
| `test-menu` | Digital Menu | the plan blocks ordering even with switches on |
| `test-waiter` | Menu + Orders | waiter app, table `Mesa 1` |
| `test-self` | Menu + Payments | guest ordering, upsell, tables `Mesa 4`, `Mesa 5`, inactive `Old Patio` |
| `test-switch` | Menu + Payments | tests that flip settings (serial, isolated) |

Logins: `owner@test-menu.local`, `owner@test-waiter.local`, `staff@test-waiter.local`,
`owner@test-self.local`, `staff@test-self.local`, `staff@test-switch.local` —
password `Test-Pass-1234!` (local database only).

## Running locally

Needs Docker (Docker Desktop on Windows/macOS).

```bash
npm run db:local          # start Supabase: applies migrations + seed (first run downloads images)
npm run test:e2e          # app on :3100 + all Playwright projects against the local DB
npm run test:e2e -- --project=api            # one project
npm run test:e2e -- --headed --project=mobile # watch it
npm run test:e2e:report   # open the last HTML report
npm run db:local:reset    # back to a clean seed
npm run db:local:stop
```

`npm test` / `npm run test:coverage` run the unit tests (no Docker needed).

## Understanding a failure

- **CI run page** — the summary lists each failed test with its error message.
- **Artifacts → `playwright-report`** — open `index.html`: every failed test has
  its **trace** (each step with the DOM snapshot, network calls and console),
  **video** and **screenshot**. Locally: `npx playwright show-trace <trace.zip>`.
- **Artifacts → `unit-reports`** — coverage HTML (`coverage/index.html`).
- If the database itself failed to start, the job prints the Postgres logs.

## Adding a test

- New behaviour of an API route → `tests/e2e/api/*.spec.ts`, assert the
  response *and* what landed in the database (`fixtures/db.ts`).
- New screen or flow → `tests/e2e/flows/*.spec.ts`; phone flows are matched by
  the `mobile` project, staff/admin by `desktop` (see `playwright.config.ts`).
- Need data? Add it to `supabase/seed.sql` with a fixed id and mirror it in
  `fixtures/seed.ts`. Tests that change shared settings use `test-switch`.
- Logged-in tests: `test.use({ storageState: storageStatePath('selfOwner') })`.
