# Native account and staff administration

Code only; no provider, production SQL, DDL, flags or real invitation delivery
has been executed by this implementation task. `OWNED_ACCOUNT_ADMIN_ENABLED`
defaults off. The selected native routes additionally require existing owned
Auth/Google configuration. Selecting owned Auth always intercepts these routes:
a disabled/missing native feature refuses, never calls Source as fallback.
Legacy Auth selection with all owned flags off retains the old UI/handlers.

Scope is exactly six route files/eleven HTTP methods: store staff GET/POST and
staff PATCH/DELETE; global tenant staff GET/POST and staff PATCH/DELETE; global
users GET and user PATCH/DELETE. UsersPage and the store StaffPage have native
views. The shared `OwnedStaffManagement({tenantId?})` component is available to
the separately owned tenant directory/detail work. This change does not edit
those pages, Connect, subscription or MCP tools. Their remaining Source callers
are a separate migration boundary, not silently routed through this adapter.

Native lists read own profiles/accounts/bindings only. No Source Auth email is
invented or matched; email is null, provider labels come from actual owned
bindings and the last recorded session comes from own sessions. Both lists are
bounded at1000 and refuse overflow. Staff grants/acceptance enforce that cap
under the same authority lock. No table, provider account or user profile is
created by inviting staff; new users register independently through the49
verified phone/Google flow first and share their UUID from `/staff-access`.

Every admin request first obtains the actual owned principal/provider check.
The shared admin pool(max2) then rechecks the exact server-derived session
digest against current version, expiry, binding, disabled account, recovery
gate, profile role and tenant. Global tenant routes require SQL superadmin
again even if the profile was downgraded after the first lookup. All authority
mutations use one advisory transaction lock; opposing superadmins cannot
concurrently remove one another and leave no active operator. Self mutation
is forbidden. Role aliases normalize for authorization without rewriting old
rows. No pool is added; provider verification uses the existing identity pool2.

An invitation accepts only an explicitly chosen recipient UUID whose own
verified binding already exists. Its fixed grant is store-staff on the issuer's
resolved tenant. Current owner role/customer status, lack of other tenant
membership, target account version and issuer current SQL authority are checked
again at consumption. URL possession alone cannot grant access: consumption
requires a new verified phone/Google factor already bound to exactly that UID,
the configured project, current provider status and the existing single-use
browser challenge. Token hashes are persisted; codes expire after30minutes and
concurrent acceptance admits once. The role/tenant update, version bump, old
session removal, used marker and required ID-only audit commit together. The
existing identity store then creates the new native cookie session. A failure
in that final provider/session check never retries the committed grant; normal
verified sign-in can resume an already accepted account.

Native PATCH staff is **revoke local sessions and issue recovery**, never a
provider-password reset. It increments the account version, deletes local
sessions and creates a case tied to the exact target UUID, tenant and resulting
version. It sets must_change_password only for this new case. A historical
true flag without a matching native case is refused, as are disabled accounts.
Only that exact pending case/generation can clear its own gate, after a fresh
already-bound factor and browser nonce; newer versions, role/tenant changes,
revoked issuer, expired/replayed cases and mismatched identities refuse. The
operation never clears disabled_at, modifies provider bans, creates/replaces
bindings, changes provider credentials or clears a historical recovery flag.
Someone who lost all bound factors still needs independent reviewed ownership
recovery; the link/phone/email is not a replacement ownership proof.

Staff DELETE demotes only that tenant's staff to customer/unassigned, revokes
their native sessions and pending codes, preserving the original account UUID,
profile history and provider records. Global user DELETE explicitly means
**disable local account** in the native UI; it sets owned disabled_at and revokes
sessions/codes, preserving all financial/history/provider rows. This neither
deletes nor logs out a real Source/Google account. Global role assignment edits
existing own accounts only, never upserts a guessed ID, and requires explicit
supported roles/real tenants. Disabled historical accounts cannot be silently
reactivated through role edit or staff recovery.

The additive table proposal is
`docs/proposals/native-account-administration-owned-only.sql`, outside automatic
migrations. Review actual runtime DML and audit_events sequence privileges
separately. It does not alter any existing row, role/default, identity binding,
imported ban, UUID or legacy Auth FK. Each privileged account operation requires
audit INSERT RETURNING and readback within the same transaction. Audit failure
rolls back the profile/account/case/session changes as a unit.

Local unit tests cover owned session context/role denial, exact explicit UID,
cross-origin, wrong project, stale factor, unbound/different identity, browser
nonce, replay, role/tenant injection and no Source fallback. Disposable PG CI
covers the original seven synthetic IDs including one disabled and one
historical recovery account, no Source Auth access/writes, atomic concurrent
invite, role/session invalidation, precise recovery generation, preserved
providers/IDs, opposing superadmin updates and audit rollback. Heavy checks and
PostgreSQL run only in CI; no real users or factors are used in these tests.
