# Access-request onboarding (plan)

Status: **plan, waiting for the owner's answers** (open decisions at the end). Written 2026-11-12.

## Decision

XmartMenu is **not self-service for now**. A business that signs up on the main XmartMenu site answers a short questionnaire and waits. The team reviews the request, contacts the person to schedule a meeting, sets the restaurant up and only then grants access. XmartMenu is new, it is paid, and the team needs full control over who gets in.

Self-service onboarding is not wrong, only early. It stays in the code behind a switch that is **off by default**, so it can be turned back on later without rewriting it.

Signups on a restaurant's own site (its menu, subdomain or custom domain) do not change: they are customers. Restaurant staff keep being created by the restaurant's admin (Settings → Staff).

## Today (code facts)

- Production runs owned mode (own PostgreSQL + native identity), so this plan targets owned mode only. Legacy Supabase paths are left as they are.
- `NativeRegistration.create` (`src/lib/auth/native-registration.ts:41`) creates `profiles(role='store-admin', tenant_id=NULL)` for a business signup, then the browser goes to `/onboarding` (`NativeRegister.tsx:36`).
- A store-admin without a restaurant is sent to `/onboarding` by `OwnedAdminLayout.tsx:21` and `api/auth/resolve-redirect/route.ts:26`.
- `/onboarding` (`OnboardingForm.tsx`) asks 4 steps and `POST /api/onboarding` → `nativeOnboarding()` → `complete_onboarding()` creates tenant, settings, an **active** `menu` plan subscription, menu, category and product. Nobody approves anything.
- `src/app/auth/pending/page.tsx` ("Account under review") exists but nothing links to it.
- No team notification exists for signups. Telegram is used only by the blog (`src/lib/blog/telegram.ts` `sendToAll`, bot token and chat ids in `telegram_settings`). The dev outbound guard (`scripts/lib/dev-outbound-guard.mjs`) already blocks Telegram in development.
- Scheduled jobs: no in-process scheduler; the org's skale-cron crontab calls internal routes with `CRON_SECRET` (`api/internal/blog/cron/generate`).
- Owned schema changes go to `docs/owned-schema/*.sql` (GitHub Action "Owned schema", plan then apply), with a matching `supabase/migrations/*.sql` for the dev database.

## References in other apps

- **Xtimator** (`Dev/xtimator`), best onboarding experience: one question per screen (`components/onboarding/survey/*`), progress bar, skip on optional questions, server draft autosaved on every answer plus localStorage (`onboarding_drafts`, resume where you stopped), prefill from the verified sign-in, language first (en/pt/es), browser back = previous question, mobile keyboard handling, WhatsApp consent unchecked by default.
- **Xpot** (`Dev/xpot`), the approval model: `auth_access_requests` with `draft → pending → approved | declined` (`migrations/0042_access_request_form.sql`), submit never grants access (`server/auth/phoneAuth.ts` `accessOf`), Telegram message to the team with a WhatsApp deep link and a ready greeting, abandoned-draft alert after 30 minutes (`server/auth/telegramNotifications.ts`), admin list with pending first and approve/decline (`client/src/pages/admin/AdminReps.tsx`, `server/routes/xpot/resellerAccounts.ts`).

## Target flow

```
Main site → Create business account (Google or SMS) → /onboarding
   no request / draft  → questionnaire (autosaved, resumable)
   submit              → status pending → "We got your request" screen
                          team gets Telegram: answers + WhatsApp link
   pending (any login) → same "under review" screen, WhatsApp button to the team
   team: Superadmin → Access requests → Approve (new or existing restaurant, plan)
   approved            → profile linked to the restaurant → /dashboard
   declined            → polite "not available right now" screen
Restaurant site → sign up → customer (unchanged)
```

## Questionnaire (proposal)

Name and phone (or Google e-mail) come from the verified sign-up and are not asked again. One question per screen, en/pt/es.

| # | Question | Type | Required |
|---|---|---|---|
| 1 | Language | single | yes (default from browser) |
| 2 | Business name | text | yes |
| 3 | Business type: restaurant, bar, café, bakery, pizzeria, food truck, hotel, other | single | yes |
| 4 | City, state, country | text | yes |
| 5 | Number of locations: 1, 2–5, 6+ | single | no |
| 6 | Menu today: printed, PDF/QR, another app, none | single | no |
| 7 | What you want: QR menu, table ordering, takeout/delivery, AI chat, 3D/AR dishes, own website/domain, several languages | multi | no |
| 8 | Menu size: up to 30, 30–80, 80+ items | single | no |
| 9 | Instagram or website | text | no |
| 10 | Best time to contact (morning, afternoon, evening) + WhatsApp consent (unchecked) | single + checkbox | no |

Final screen (copy draft): "Thanks! The XmartMenu team will contact you to schedule a meeting and set up your menu with you." plus a WhatsApp button to the team.

## Work plan

Branch `feat/access-request-onboarding` from `dev`. Phases are in dependency order; durations are agent working time.

**P1. Switch and lock-down (~30 min)**
- Env flag `SELF_SERVICE_ONBOARDING_ENABLED` (default `false`), read in one helper and listed in `src/lib/data/owned-mode.ts`.
- When off, `POST /api/onboarding` (self-service) refuses with 403 **on the server**, and `/onboarding` renders the questionnaire instead of `OnboardingForm`. When on, today's behaviour is unchanged.

**P2. Schema (~45 min)**
- `docs/owned-schema/<ts>_access_requests.sql` and the matching `supabase/migrations/<ts>_access_requests.sql`, idempotent:
  `access_requests(id, user_id UNIQUE → profiles, status draft|pending|approved|declined, step, answers jsonb (object, ≤64 KB), schema_version, language, whatsapp_opt_in_at, started_at, last_activity_at, abandoned_notified_at, submitted_at, reviewed_at, reviewed_by, decision_note, tenant_id, plan_slug)`, index on `(status, submitted_at)` and on abandoned drafts, touch trigger for `last_activity_at`. Server-only access (no anon/authenticated grants).

**P3. Applicant API (~1 h)**
- Extract the session guard from `api/onboarding/route.ts` (`ownedAccount`: same origin, current browser session, not superadmin, no preview/demo cookie) into a shared helper.
- `GET /api/access-request` (state + draft + prefill), `PUT` (autosave a step, rate-limited), `POST` (submit: validate with zod, lock profile and request, `draft → pending`, idempotent on double submit). Submit never touches `tenant_id` or role.

**P4. Questionnaire UI (~1.5 h)**
- `src/components/access-request/*`: port the Xtimator survey pattern (shell, progress, step config, server draft + localStorage, back button, keyboard helpers already in `src/components/ui/keyboard-fields.ts`, `PhoneField` not needed).
- Screens for pending (rewrite `auth/pending` copy, add WhatsApp button) and declined.

**P5. Gating (~30 min)**
- `/onboarding` server page decides by request status: none/draft → questionnaire, pending → pending screen, declined → declined screen, has restaurant → `/dashboard`.
- `resolve-redirect` and `OwnedAdminLayout` keep sending tenant-less store-admins to `/onboarding`; no admin route opens without a restaurant.

**P6. Team notification (~45 min)**
- On submit: Telegram through the existing blog bot (`telegram_settings` token and chats, owned variant in `src/lib/blog/native/telegram.ts`), message with name, phone, e-mail, answers, a `wa.me` link with a ready greeting and a link to the request in the superadmin. Fail-open: a Telegram outage never fails the submit.
- `POST /api/internal/access-requests/abandoned` protected by `CRON_SECRET`: drafts idle for 30+ minutes, notified once (`abandoned_notified_at`). Add the line to the skale-cron crontab.

**P7. Superadmin "Access requests" (~1.5 h)**
- Sidebar item in `SuperadminSidebar.tsx`, page `(superadmin)/access-requests` with pending first (as in Xpot), detail with all answers and contact buttons.
- Approve, in one transaction with the request and profile locked:
  - **New restaurant**: create tenant + settings + subscription on the plan the team picks (reuse the owned tenant administration path, no auto menu/product), set the applicant's `profiles.tenant_id`.
  - **Existing restaurant**: link the applicant to a restaurant the team already built (only if it has no other owner).
- Decline (with an internal note) and reopen. Every action writes `audit_events`.

**P8. Customer-site safety check (~20 min)**
- Test that a sign-up started from a restaurant page, subdomain or custom domain can only create a `customer` (owned `NativeRegister` already refuses other hosts; add a regression test).

**P9. Tests (~1.5 h, run on CI)**
- Unit: answer schema, status machine, self-service POST refused when the switch is off, pending/declined users never reach admin routes, approval idempotent and refused for an already linked profile, Telegram failure does not fail submit.
- Integration on disposable PostgreSQL (`tests/integration/`): submit and approve transactions.
- e2e: update `tests/e2e/api/onboarding.spec.ts` and add an access-request spec.
- This Surface runs only targeted tests; the full suite runs on CI or the desktop.

**P10. Rollout (owner OK at each production step)**
1. Merge to `dev`, CI green, check on localhost with the dev database (fake data).
2. Read-only count of production store-admins without a restaurant (they will see the questionnaire next time they sign in).
3. Release (`main`), deploy code, then apply the owned schema step with the "Owned schema" Action (plan → apply).
4. Confirm the Telegram chat receives a test request; add the crontab line.
5. Journal entry with the decision ID and a Current State rewrite.

Total: about 8–9 hours of agent work plus CI, split over two sessions. Model routing: Opus for schema, guards, approval transaction and final review; Sonnet for the questionnaire port, superadmin page and tests; Haiku for copy/i18n strings.

## Out of scope

- Payment or plan checkout during signup (the team sets the plan on approval).
- Automatic SMS/WhatsApp/e-mail to the applicant on approval: no outbound messaging provider exists; the team contacts the person by WhatsApp from the Telegram message.
- Legacy Supabase signup paths (not used in production).
- Xphere CRM lead sync for requests (can be added once the CRM sync is turned on).

## Open decisions (owner)

1. Is the question list right? Add or remove any?
2. Approve options: both "new restaurant" and "link to an existing one" (recommended), or only one?
3. Plan on approval chosen by the team in the approve dialog (recommended)?
4. Telegram: use the blog bot and its chats, or a separate chat for sales leads?
5. Which team WhatsApp number goes on the pending screen?
6. Self-service switch as an env flag (recommended, changed in Coolify) or a toggle in Superadmin → Settings?
