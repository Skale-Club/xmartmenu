# Native principal and administration context

`OWNED_AUTH_ENABLED` defaults to `false`. This slice prepares the native guard and SQL context; it does not activate authentication, Google, application database credentials, or a production cutover.

When selected, `get-effective-tenant`, `superadmin-auth`, the password guard and login redirect use the existing native session store. Every request verifies the provider account/revocation state through that store, then joins the immutable verified user ID to `app_accounts` and `profiles`. Disabled accounts, ambiguous/missing profiles, unknown roles, duplicate native cookies and invalid host bindings fail closed. A configured email never promotes a user to superadmin, including in the legacy guard/redirect, OAuth callback and MCP token gate. Existing stored roles are preserved; the callback no longer upserts a privileged role while proving a legacy identity.

The existing IDENTITY pool is shared with the pilot: maximum two connections, five-second connection/statement limits and six-second query budget. Native shell queries provide platform appearance, tenant settings, menus, plan/capabilities, chat visibility, tenant dashboard counts and superadmin overview. Tenant IDs come from the verified membership or an explicitly authorized superadmin preview. Menu selection uses the same context and checks the tenant in SQL. Native signout revokes only the native session and clears its cookies after origin verification.

The overview reads account IDs solely for the existing user count. It does not fetch provider administration records. Its engagement/revenue query reproduces the original `get_platform_menu_overview` SQL; CI compares results with the unmodified historical RPC for status exclusions, range boundaries, median clamping, tenant activity and numeric totals. No new function grant is required.

Server Supabase factories reject calls when this mode is selected. Middleware skips legacy session refresh and leaves authorization to the native server guards. There is no fake SDK object or fallback to Supabase after a native error. The off branch retains the existing data/auth adapters.

## Remaining activation work

Keep the flag off until these bounded consumers are migrated and acceptance passes:

- Browser login/account context and the existing late-link proof flow: `/auth/login`, `components/auth/AdminLoginModal.tsx`, and `/identity` with `IdentityPilot.tsx`. Preserve online proof of the old immutable UID; never link by email.
- Provider-backed superadmin account creation/update/deletion and launch-checklist attribution: `api/superadmin/tenants` POST, `api/superadmin/users/[id]`, and the launch-checklist item route currently return explicit 503 in native mode. Their legacy branches remain available while the flag is off.
- Other admin/superadmin business consumers that still construct server Supabase clients, including OCR/import/seed and settings/subscription management. The factory boundary refuses them in native mode; this is a preparation guard, not completed functionality.
- Custom-domain resolution and remaining browser REST/RPC writes require native adapters. Canonical-host guards and shell migration do not establish a complete source exit.
- Production acceptance must include native login, recovery/reset, member/staff authorization, superadmin preview, logout and provider revocation, using the final deployed image and credentials.

Final cutover still requires complete 47-table reconciliation, a database-enforced barrier covering browser/API/RPC/Auth-trigger writers, rollback proof and a separately reviewed activation. This code performs no schema/data migration and changes no current flag.

## Verification

New unit cases cover immutable UID/tenant binding, recovery/disabled controls, native cookie/origin handling, no email promotion, no legacy client construction, bounded shared pool, BRT count boundaries, plan zero/NULL overrides and explicit off-branch behavior. Four disposable PostgreSQL cases cover the actual native profile/count queries and source-RPC equality. Projection fixtures intentionally test only selected columns, not full production DDL, grants or live Google acceptance.

Local targeted run: 61 tests passed; ESLint had zero errors (existing warnings remain). The local shared dependency installation lacks several existing packages/type declarations, so full TypeScript/build verification belongs to CI with `npm ci`. PostgreSQL tests run only against the loopback disposable CI database; no local Docker or production database is used. CI on the initial code head completed all 84 PostgreSQL checks, including the four native core cases, with zero failures/skips; the final callback/MCP regression changes require their updated CI run.
