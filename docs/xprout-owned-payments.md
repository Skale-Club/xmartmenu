# Owned order-payment data seam

`OWNED_PAYMENT_DATA_ENABLED=false` and the Orders flag stay unchanged in production.
This patch makes no provider request, environment/schema change, deployment or
cutover. It implements a staged data boundary, not complete Supabase retirement.

## Selected paths

With the flag enabled, these order-payment paths read/write only the explicitly
pinned `PAYMENTS_DATABASE_URL`/`PAYMENTS_DATABASE_SSL` target:

- `/checkout/[orderId]` and its confirmation page: projected order/items/tenant
  display, Stripe gate, current intent and server-evidence confirmation.
- `/api/stripe/payment-intents`: existing Supabase Auth getUser is preserved;
  original UUID/profile/order-customer authority is rechecked on the selected DB.
- `getOrCreatePaymentIntent`/`createPaymentIntent` in `lib/stripe.ts`: own provider
  orchestration without a legacy data factory or caller-supplied amount authority.
- `applyPaymentSignal`: payment state, tenant/currency/amount/current-intent checks,
  divergence audit and trusted order analytics on the selected DB.
- Verified webhook `payment_intent.succeeded`, `.payment_failed`, `.canceled`:
  signature verification remains before DB access; business effects and the
  processed-event ledger commit in the same own transaction.

The public checkout still treats its unguessable order UUID as a capability,
as HEAD did. This patch does not broaden the authenticated intent API's access:
profile tenant/superadmin or exact order customer is required; reissuing an
existing intent retains the profile-tenant/superadmin restriction. No identity
is joined by email/phone. Auth/middleware remain a separate migration gate.

The own runtime refuses access unless OWNED_ORDER_DATA_ENABLED is also true.
Conversely, own Orders refuses a guest Stripe-required order until Payments is
enabled. Flags default false; a failed own operation never falls back to the
Supabase Data API. Both explicit targets match PROD_DATABASE_HOST/NAME, reject
Supabase production hosts and preserve the existing isolated development guard.

## Money, provider calls and retries

All charge facts come from a database snapshot: order total/tip, historical
currency when non-NULL, otherwise the configured tenant currency, live plan
features/fee override and one active connected account. SQL NULL currency is
preserved. Existing USD fallback for absent tenant currency and zero-decimal
currency conversion remain; fee0 overrides and fee-exempt tips are retained.
Invalid/ambiguous financial configuration fails before provider creation.

Provider calls run outside SQL leases, using the existing Stripe SDK with a
6-second per-request timeout and maxNetworkRetries0. Confirmation uses the same
bounded retrieve helper; the global legacy SDK defaults are unchanged. No SDK/key is instantiated
by importing the modules. The charge's provider idempotency key hashes the
original order/tenant/current-intent, amount, currency, application fee and
connected account. This is a deliberate safety improvement over HEAD: lost
responses/concurrent identical requests reuse one provider operation.

Existing intents must match immutable order/tenant metadata, amount, currency,
connected-account destination and exact application fee. Destination accepts the
provider string or expanded account ID; missing/null destination/fee never falls
back to current configuration or zero. A matching known live intent is reused. Divergent processing/succeeded,
requires_capture or unknown states require reconciliation and are never cancelled
or replaced; only known confirmable states may be safely cancelled/replaced. Replacing another confirmable intent requires confirmed
cancellation first. Historical ambiguous metadata fails closed for review.

An independent short SQL transaction revalidates the snapshot and claims the
new intent by tenant+order+prior-intent+payable-status+financial CAS. A lost CAS
reads the winner before cancelling an orphan: concurrent provider-idempotency
calls can return the SAME intent, which must never be cancelled as a loser.
Different winners are ownership/amount/currency checked before a secret is
returned. Orphan cancellation is best effort, as before; an orphan secret is
never returned. An ambiguous SQL COMMIT is not retried or blindly cancelled;
a later request reconciles through the provider key/current recorded intent.

## Provider evidence and event atomicity

The existing paymentTransition matrix is unchanged. Applying a signal locks the
order row, validates tenant metadata, historical currency, amount sufficiency and
current-intent rules, then uses tenant+id+old-status CAS. Stale failures cannot
regress paid/kitchen states; paid-after-cancel and second-payment cases become
idempotent divergence records, without refund/reopening side effects.

A signed payment webhook takes a transaction-scoped event lock, checks the
selected processed-event ledger, applies its signal and records success only
in that same transaction. Event-type conflicts fail closed; historical NULL
ledger type still deduplicates its immutable event ID. Divergence or ledger
write failure rolls back business changes and returns500 for Stripe retry.
This strengthens HEAD's best-effort divergence/ledger errors, which could
acknowledge an event without its audit evidence. Trusted analytics remains
best effort behind the existing savepoint and stable lifecycle event key.

The pool max is2, default read-only; each operation is admitted under an
8-second total SQL deadline with 5-second statements/2-second lock timeout.
Timed-out leases are destroyed; mutations and ambiguous commits are not
implicitly retried. Adding this pool brings the six current own pools to a
maximum12 connections per process; replicas/warm production capacity still need
separate admission. This patch does not modify a role or connection limit.

## Remaining live dependencies and release gates

SaaS/addon subscriptions, invoice AI billing, `account.updated`, Stripe Connect
OAuth/callback/disconnect, `getTenantPlan` and other settings writers remain on
the legacy data path. The webhook routes these other event types explicitly to
its original branch. Their configuration changes are NOT mirrored by this patch.
Auth context/layouts, browser product/options/ingredient/settings CRUD, waiter
calls, customer history, analytics RPCs and other workers also remain legacy.

Therefore enabling the two flags alone is not a safe production cutover: plan,
Connect and currency writers must first share the selected source of truth or
be frozen/reconciled in the coordinated window. Do not roll back flags after
new payments without freezing and reconciling the selected DB's order/ledger/
divergence delta. No Stripe real/test key, webhook secret, actual event or
customer record enters tests/CI from this patch.

## Verification

Focused unit/source tests use injected SQL/provider doubles: database pricing,
fee0/JPY, metadata/destination/fee ownership including expanded/null/missing fields,
settled/ambiguous protection, bounded confirmation reads, cancellation,
CAS winners including shared provider IDs, ambiguous commits, tenant scope,
HTTP Auth/signatures, no legacy fallback and the joint rollout guard.

`tests/integration/payments.test.ts` is added to the existing disposable CI
PostgreSQL job. Seven cases cover tenant/NULL/fee configuration, API authority,
claim races, concurrent event replay, ledger-failure rollback with retry,
financial divergences/stale signals and divergence-audit failure rollback.
It requires the exact loopback `/xmartmenu_identity_test` target and does not
load dotenv, start the app or call a provider. The minimal fixtures do not
reproduce every child-tenant FK or prove phantom-insert exclusion; restored FK
fidelity and production admission remain separate release checks. PostgreSQL/build/full E2E are
left for CI; no live database mutation was used to validate this seam.
