# Native login entry and explicit previous-account proof

This slice keeps `OWNED_AUTH_ENABLED=false` and `GOOGLE_AUTH_ENABLED` unchanged. It changes no production schema, role, credential or application data.

The server selects the native or legacy `/auth/login` entry from the explicit authentication flag. The shared native entry verifies the canonical host and the Google public project's provenance before rendering phone/Google controls. `/identity` retains the standalone pilot when native application authentication is off. The admin login modal checks the current server authority before displaying a legacy login form; native mode links to the native entry.

`/api/auth/authority` is a no-store server decision. Browser actions confirm that decision before constructing a legacy Auth client or starting native provider proof. A denied/unavailable/unknown authority never chooses legacy. Native login uses only the existing Google in-memory client and native challenge/login/session HTTP operations. It requests its final destination from the native profile guard; failed authorization or unsafe destinations do not fall back to `/dashboard`. The legacy form also stops on an unconfirmed redirect.

## Explicit account linking

`/auth/login?action=existing-account-link` collects the previous email/password as possession evidence, followed by a recent verified Google/phone identity. The server performs an explicit password grant to the pinned source Supabase project using its public key, then calls online `/auth/v1/user` with the returned access token. The whole source proof is bounded to eight seconds, including response bodies and transports that ignore cancellation. Response bodies are capped at 64 KiB. Only the online verified immutable UID leaves the boundary. The password and provider access/refresh tokens are not persisted, logged or returned to the browser. This legitimate source Auth proof may create its own provider session; it performs no business-data write or role update.

Native account/profile controls must admit the exact UID. Disabled, unknown, recovery-required and conflicting accounts are refused. Preview/demo context, invalid/stale native sessions, extra caller identity fields, cross-origin requests and consumed/invalid challenges are refused. No email/phone comparison establishes ownership. The existing store locks and verifies the provider identity/account before binding, preserving the restored account/profile/tenant/role IDs.

The binding records the existing `legacy-session` proof category: the password grant produces an actual source Auth session, independently verified online. No DDL or expanded proof category is needed. The link endpoint itself creates no application session. After successful binding the browser explicitly obtains a fresh challenge and uses the normal native login endpoint to create one.

The legacy standalone pilot still permits an explicitly requested old-session proof only after confirming legacy authority. That path is unreachable from native login; there is no automatic SDK refresh/fallback for native proof failures.

## Remaining activation gates

- Provider-backed superadmin account management and launch-checklist attribution remain explicit next slices, as recorded in the core principal document.
- Registration/onboarding, customer browser account context, recovery/password/account management and any remaining server/browser REST/RPC consumers need their native flows before enabling the global flag. Existing functionality is not considered delivered merely because the preparation boundary refuses it.
- MCP/OAuth bearer transport still uses the legacy provider; its canonical role gate no longer admits configured emails. A separate native token transport is needed before declaring that surface migrated.
- Storage-only backend callers may need a separate storage client. Migrating storage access is distinct from SQL/Auth, and is not solved by substituting a fake legacy SDK.
- Full source reconciliation/write barrier, rollback proof, native phone/Google acceptance, linked-account acceptance, reset/recovery and provider-revocation acceptance remain required before cutover. These tests make no live provider requests, send no SMS and do not prove production UI acceptance.

Offline tests cover source public-key/project pinning, exact online UID versus contacts/token response fields, deleted/banned users, response/deadline bounds, late transport completion, linking without session issuance, ownership/preview/demo/challenge denials, browser no-fallback sequencing and server entry selection. Existing PostgreSQL store/profile tests remain in CI; no new schema or privilege change is introduced.
