# Localhost on the owned sign-in (phone, no SMS)

Owner decision XMM-D-4 (2026-11-09): localhost runs like production, on the owned sign-in and every owned
boundary, against the **development** database, and phone sign-in works the way Xpot does locally: a
development code on screen instead of an SMS.

## Turn it on

In `.env.local` (shared across machines through Google Drive):

```
DEV_OWNED_STACK=true
DEV_GOOGLE_AUTH_WEB_API_KEY=<the shared project's public web API key>
```

`npm run dev` then (`scripts/lib/dev-environment.mjs`, `applyOwnedStack`):

- turns on every `OWNED_*_ENABLED` flag production sets, plus `GOOGLE_AUTH_ENABLED`;
- uses the shared Google project (`skaleclub`, where `localhost` is an authorized domain) through
  `DEV_GOOGLE_AUTH_SHARED_PROJECT=true`; production configuration is unchanged;
- sets `IDENTITY_ORIGIN` to `http://localhost:<port>` from `-p`/`--port`, `PORT` or 3000;
- opens only `identitytoolkit.googleapis.com` and `www.googleapis.com` in the dev outbound guard;
- trusts the pinned Supabase root CA (`scripts/ops/fixtures/supabase-prod-ca.crt`) so the dev database keeps
  TLS verify-full;
- keeps the dev Supabase bucket as storage (owned mode requires S3 only in production).

Branches without this code ignore `DEV_OWNED_STACK`, so the shared `.env.local` never breaks them.

## Signing in

Open the site's "Start" popup (or `/auth/login`), type the phone of a dev account and press Continue. No SMS
is sent: `src/app/api/identity/dev-phone/route.ts` returns a 6-digit development code (5 minutes, 5 tries),
the screen fills it in, and confirming signs in the dev profile whose `profiles.phone` matches, through the
normal identity store (an `operator-recovery` binding for `dev-phone-<digits>`, then the usual session
cookie). The route answers 404 unless `NODE_ENV=development`, the owned sign-in is on and the host is
localhost.

The dev account needs an `app_accounts` row and the phone on its profile. The owner's superadmin profile has
both since 2026-11-09. For another account:

```sql
insert into public.app_accounts(id) values ('<profile id>') on conflict do nothing;
update public.profiles set phone = '+1XXXXXXXXXX' where id = '<profile id>';
```

Google sign-in on localhost reaches the real shared project; an unbound Google identity logs its UID as
`[dev identity] no account bound to …` so it can be bound by an operator.

## Notes

- The dev database received the identity migrations (`20261103190000`…`20261104090000`) and the AR one
  (`20261107090000`) on 2026-11-09 via `npm run db:migrate -- --apply` with
  `NODE_EXTRA_CA_CERTS=scripts/ops/fixtures/supabase-prod-ca.crt`.
- Production is unaffected by everything above except one shared fix: phone sign-in uses an invisible
  reCAPTCHA on its own element (as Xpot does); the visible checkbox never showed inside the sign-in popup and
  Google answered `auth/invalid-app-credential`.
