# Native public chat conversation admission

The anonymous chat session endpoint selects native SQL through `OWNED_ADMIN_MENUS_ENABLED` before creating any source client. It shares the existing two-connection administrative pool/transaction deadline and bounded native body reader. No new pool, DDL, role, production flag, provider request or credential operation is introduced.

The native transaction resolves an active tenant by slug, preserves addon plan availability/subscription-active/force-on/force-off/settings semantics, normalizes the supplied 8–15 phone digits and hashes them with the existing tenant-scoped function. Only the hash enters SQL. A fixed-namespace transaction advisory lock serializes that tenant/hash's native first-use requests, then the current tenant blocklist and latest conversation since UTC midnight determine reuse or insertion. Existing message-count and daily-limit acknowledgments/defaults are preserved.

This is an anonymous conversation identifier, not an authenticated user, verified phone, profile or local role. No contact lookup or identity promotion occurs. Existing blocked-conversation behavior remains enforced by message/audio admission; this endpoint preserves the source's existing-day reuse. Native errors never fall back to source creation.

Six offline and six disposable PostgreSQL cases cover scoped hashing, UTC-day reuse/counts, concurrent first use, tenant isolation, blocklist, inactive tenant, addon overrides/settings and rollback. They are projection fixtures, not production grant acceptance. Message/audio routes, native catalog/context, AI configuration/usage/error accounting, staff chat management and final source reconciliation/write barrier remain required follow-up work before native chat rollout.
