# Owned PostgreSQL orders seam

`OWNED_ORDER_DATA_ENABLED=false` remains the default. No production schema,
database content, runtime flag or provider configuration was changed by this
implementation. Production still uses the existing source until cutover gates
and the other consumers are reconciled.

The flag selects the independent `ORDERS_DATABASE_URL`/`ORDERS_DATABASE_SSL`
target, pinned to `PROD_DATABASE_HOST` and `PROD_DATABASE_NAME`. Development
continues to use the existing isolated DEV guard. The pool has two connections,
a read-only default, five-second statement timeout and one eight-second total
deadline including pool admission and the checkout operation. Timed-out/late
leases are destroyed; mutations and interrupted commits are never retried.

POST keeps the existing bounded input, catalog-only prices, option/ingredient
validation, menu multiplier, service capabilities, verified session ownership,
delivery/location/table checks and Stripe-required initial status. Its selected
data path reads only the independent PostgreSQL. Existing Auth helpers remain
separate and still depend on the legacy Auth/profile implementation. The owned
adapter reads only plan features/live subscription state and presence of an
active Stripe connection; it neither reads payment credentials nor calls a
payment API. Payment/webhook handlers remain a separate migration gate.
Ambiguous multiple active connections fail closed. Overlapping delivery zones
that both match the same checkout also fail closed: the old query had no order
contract, so restore row ordering must not silently select a different fee.
Option groups also have legal equal positions. Selected reset/add operations,
different selected price resets, or duplicate label overwrites at the same
position fail closed when their order could change price or fingerprint.
Commuting additions and unselected optional resets remain allowed. The existing
pricing resolver is unchanged; explicit distinct group positions resolve this
ambiguity without relying on a new UUID tie-break.

Creation calls the restored **same**
`public.create_order_with_items(jsonb,jsonb)` function from
`20261027095000_order_customer_identity.sql`; it does not split order/item writes
or replace the function. Its normalized `prosrc` SHA-256 is
`b579f7885163e682b14649dca2d4fa7b7edb59a7626171d6a6b0fee082d20c75`.
Each creation verifies the body, exact arguments/result, language, search path,
SECURITY INVOKER state, runtime `EXECUTE`, non-Auth-dependent RLS context and the
valid unique tenant/idempotency partial index. Missing/drifted state fails
closed. No automatic grants, function installation or privilege escalation
occurs. This function does not call `auth.uid()`/`auth.role()` and does not
decrement stock; the existing availability validation is retained.

Read/write transactions use READ COMMITTED to preserve the function's unique
conflict/replay behavior under concurrent requests. Read-only KDS transactions
use REPEATABLE READ. The KDS remains tenant-scoped, recent 48 hours, at most 500
orders; explicit columns preserve NULL currency and avoid exposing newly added
internal fields. More than 1000 items in one historical order fails closed
instead of silently truncating that order. Kitchen status updates preserve the
existing state machine and tenant+previous-status compare-and-set; staff never
set provider payment states. Foreign order IDs remain hidden.

Optional attribution lookups and trusted lifecycle analytics use separate
savepoints in the selected database. Failed lookup SELECTs return no attribution
after rollback, including table/permission errors and statement timeouts; the
global checkout deadline still applies. A lifecycle event has an idempotent
server event key. A savepoint isolates event failures from the order/status write;
there is no fallback into the old Data API. Auth, other analytics endpoints,
payments and the remaining catalog writers are not retired by this flag.

Unit/source tests exercise the owned routing boundary and catalog pricing.
The CI PostgreSQL suite uses only the explicitly pinned disposable loopback
database, minimal typed tables and the exact historical function definition.
It tests rollback after an item constraint failure, concurrent retries,
conflicting fingerprints, tenant/customer isolation, KDS projection, runtime
EXECUTE denial, payment-state/CAS boundaries and analytics failure isolation.
These fixtures do not establish production readiness, provider login, restored
Auth FK coverage or a completed production cutover.
