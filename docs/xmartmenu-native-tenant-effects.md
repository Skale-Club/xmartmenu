# Native tenant effects (dark launch)

Code only. No schema, flags, provider requests or deployments were applied by
this change. `OWNED_TENANT_EFFECTS_ENABLED` remains false by default. Activation
also requires the existing owned identity/tenant administration configuration,
reviewed SQL proposals and explicit backend privileges.

## Routes and transactional producers

Native branches cover the eight existing tenant routes: `seed`, `seed-image`,
`seed-images`, `seed-status`, `ocr-menu`, `ocr-upload-token`, `upload` and
`xphere-resync`, plus `/api/superadmin/xphere/backfill` and the internal workers.
The false branches preserve Source behavior. Owned denial never calls Source.
The missing legacy image-seeding GitHub workflow is replaced by bounded QStash
continuations to the existing app; no service or account is created.

Tenant creation, subscription patches/financial completion, verified SaaS
webhooks, Connect completion/disconnect and onboarding record CRM intentions in
the same SQL commit as their successful mutation. Provider event IDs or unique
operation IDs bind retries; a subscription's permanent ID is not a dedup key.
Onboarding preserves the canonical SQL role/catalog/entry-plan rules and original
UUID. Its current real session/version/binding is checked under the existing
account-authority lock. No Source user or target provider account is fabricated.

The bounded backfill accepts an explicit UUID `Idempotency-Key`, current real
administrator and same-origin POST. It records at most 100 intentions plus an
ID-only audit in one transaction. Its opaque v1 cursor orders by timestamp and
UUID, preserving nulls and microseconds. Reusing a key/page reuses intentions.
Backfill/manual/Connect internal keys never invent a CRM timeline note.
Responses distinguish saved/queued/pending; none claim delivery. Publication
failure after commit cannot turn a successful financial mutation or onboarding
into a failed HTTP response. The shared publisher is safe to call after commit.

## Authority, cost and concurrency

All browser effect phases re-read the existing Google account status and then
check the exact SQL session hash, clock expiry, account version, live binding,
profile role, disabled/reset state and tenant. Jobs persist a scoped actor
session hash, never a bearer token. A five-second server observation is matched
again under SQL locks; browser roles, IDs and provider assertions are not proof.
The existing admin pool has two connections; no new runtime pool exists.

Catalog writes share the established account authority and menu advisory locks.
Paid output applies only to the locked tenant/menu snapshot. Categories/products
are additive and bounded at 1000/2000; existing IDs, translations and images are
preserved. Images use unique operation storage paths and compare-and-set null
image columns. A QStash duplicate cannot acquire another private step nonce or
start another provider call. Continuations process one image at a time.

AI is platform-funded as in the old superadmin flows. Receipts require actual
provider cost, generation/model and response digest; no estimate or zero cost is
substituted for missing usage. Customer billable/charge fields remain false/zero.
A prepared internal claim can append a truthful paid receipt after actor
revocation; it cannot start another call or apply catalog output. This preserves
known cost without granting the revoked actor authority.

## Storage and workers

Native storage requires explicit S3 configuration and never falls back to
Supabase. OCR tickets bind actor/session/tenant, exact bytes SHA256, length and
MIME, expire after five minutes and consume once. Downloads enforce 15MB and a
timeout. Multipart images are bounded before parsing and converted with Sharp.

QStash requires existing token/current+next signing keys and pinned HTTPS public
worker URLs. Workers verify the bounded original raw body and accept only a
single operation/effect UUID. Actor/session/role fields are rejected. No workflow
or provider is invoked in tests. A publish retry is safe before a SQL claim;
after an uncertain provider outcome the worker reports a nonretryable outcome.

## CRM confirmation and reconciliation

The CRM dispatcher reads only owned SQL plus the existing Google status reader.
Contact email is not inferred; company phone can come only from a currently
verified linked phone identity. Missing/disabled phone identity yields no phone.
A successful CRM response must contain confirmed account/opportunity UUIDs;
`contact_id=null` preserves an existing confirmed contact. Remote facts and
delivery receipt/audit commit atomically. A tenant FIFO blocks later intentions
behind an unresolved processing/reconcile record.

The existing CRM receiver does not guarantee note deduplication. Timeout,
malformed success, interrupted storage/provider call or ambiguous commit leaves
`reconcile`; do not reset claims or resend the note automatically. An operator
must compare the private operation/claim/request/response digests with provider
evidence and SQL readback before any explicit reconciliation. Processing claims
have no automatic timeout takeover. An interrupted prepared image step likewise
requires review. Status HTTP exposes local outcome without asserting remote
delivery. Successful CRM completion publishes the next pending intention best
effort; an unavailable queue leaves durable pending work.

## Separately reviewed schema and validation

Apply proposals only through a separate reviewed operation:

- `native-tenant-effects-owned-only.sql` (existing base outbox).
- `native-tenant-effects-dispatch-owned-only.sql` (receipt/claim/event columns).
- `native-tenant-operations-owned-only.sql` (operation/call/upload tables).

The new proposals require database `xmartmenu`, owner `xmartmenu_owner`, bounded
locks and backend-only access, preserving existing outbox IDs/rows and all seven
accounts. They are outside automatic migrations. Their use does not authorize a
live apply or activation.

Disposable CI tests deny Source Auth access and cover replay/current authority,
rollback, costs after revocation, tenant/snapshot separation, OCR one-use binding,
private image nonce, ambiguous CRM FIFO, confirmed response IDs, financial event
atomicity, Connect nonce-scoped dedup, onboarding rollback and 100-row backfill
boundaries. Offline unit tests verify signed worker boundaries and queue failure
after a committed success. Providers are fakes; actual provider readiness and
separate schema/flag activation remain operator tasks.
