# Native platform tenant and plan administration

Code-only implementation. `OWNED_TENANT_ADMIN_ENABLED` defaults false and also
requires native auth. Selecting either native auth or this feature never falls
back to Source SQL/Auth after a denial. No live DDL, flags, external provider
calls or deployment are performed by this change.

The existing admin pool (max 2) handles all queries. The runtime resolves the
real owned principal with current provider status, then SQL checks the exact
server-derived session hash, expiry/version, binding, account disabled state,
recovery state and platform role. Authority writes share account administration's
transaction lock. Browser roles, preview/demo, contact matches and supplied actor
IDs cannot grant authority. Writes require same-origin bounded JSON and a
mandatory ID-only audit in the same transaction.

## Delivered paths

- `/api/superadmin/plans` GET/POST and `/plans/[id]` GET/PUT/DELETE; plans SSR.
- `/api/superadmin/tenants` GET/POST and `/tenants/[id]` PATCH/DELETE; directory
  and detail SSR, including the existing subscription DTO consumed by its own API.
- `/tenants/[id]/menus` GET, nested `categories-list` GET and `products-list` GET;
  tenant/menu/category ownership is checked in SQL; lists refuse beyond 1,000.
- `/tenants/[id]/settings` GET/PATCH; explicit fields/types, current subscription
  ceiling under lock, validated service switches, no arbitrary tenant assignment.
- Both tenant staff panels use PR60's `OwnedStaffManagement` in native mode.

Creation requires an explicitly chosen existing verified native account UUID.
Only an independent active customer/unassigned store administrator is eligible;
an assigned account, global administrator, disabled account, historical recovery
restriction or missing active binding is refused. Phone/Google registration
happens independently through the existing registration flow. There is no
Source user, password, provider identity or contact inference. The transaction
creates tenant/settings/subscription/default menu, assigns store-admin to that
exact account, bumps its local session version, revokes local sessions, records
the audit and stores the CRM intention. Concurrent attempts serialize; any
failure rolls the entire unit back. The owner signs in using their existing
verified factor. No reset flag is fabricated or cleared.

Plan updates preserve all Stripe identifiers. Prices must fit their canonical
NUMERIC precision (10,2 and fee 5,4); the final annual price cannot fall below
monthly. Deletion refuses any subscription reference or Stripe identifier;
deactivation remains available. This operation never creates provider prices.

Tenant deletion is deliberately limited to an unused local shell. Current FK
metadata and dependent rows are checked under locks; menu content, unknown
dependencies, financial history, subscription billing fields and domain/CRM
IDs require deactivation instead. Profiles/accounts/provider bindings and audit
history are preserved. Associated local accounts lose that tenant role and
their local sessions. Pending native outbox jobs are canceled, not executed;
other job states prevent deletion. The UI reports successful deletion only
after that transaction commits and exposes the ordinary active/inactive switch.

## Separately reviewed prerequisites and remaining cutover work

Apply `docs/proposals/native-tenant-effects-owned-only.sql` only through a
separately reviewed owned-only operation with the flag still false. Grant DML
only to the existing admin backend, plus its existing required table/audit
sequence privileges; no browser role grants. Existing tables, users and defaults
are not changed. Review the canonical FK inventory before enabling deletion;
unrecognized or unvalidated dependencies refuse deletion. The separate native
registration/profile FK and staff access proposals remain their own prerequisites.

The durable `app_tenant_effects` row is **pending**, not a claim of CRM delivery.
A native dispatcher/provider migration is still needed. The existing Source
worker must never consume this outbox. No new service is introduced here.

These exact existing routes remain real cutover gaps and return 503 in native
mode **before** Source/provider work: POST `seed`, POST `seed-image`, POST
`seed-images`, GET `seed-status`, POST `ocr-menu`, GET `ocr-upload-token`, POST
`upload`, POST `xphere-resync`, all under
`/api/superadmin/tenants/[id]/`. Native UI disables the legacy CRM resync and
does not expose AI seed/OCR actions. Subscription mutation/billing APIs belong
to their separate migration; this change does not alter them.

## Verification

Focused unit tests exercise invalid authority, contact/role injection, numeric
precision, HTTP origin/body limits and truthful error responses. The serial CI
Postgres suite uses a disposable loopback database and a backend role without
Source Auth access. It covers atomic creation/rollback, concurrent owner reuse,
current session/role revocation, tenant isolation, plan billing preservation,
settings ceilings, guarded deletion and preservation of seven synthetic IDs,
including imported disabled/recovery accounts. No live records or factors are
used. Full type/build, browser and PostgreSQL checks run in CI.
