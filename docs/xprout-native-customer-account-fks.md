# Native customer references (prepared; not applied)

Two legacy foreign keys still require an `auth.users` row after native account
registration: `customer_profiles.id` and `orders.customer_id`. New own accounts
must not receive fabricated Source Auth rows to pass those checks.

A verified-TLS, explicitly READ ONLY query against the existing Source project
on 2026-11-04 confirmed both exact validated constraints:

- `customer_profiles_id_fkey`: `id` references `auth.users(id)`, delete CASCADE.
- `orders_customer_id_fkey`: `customer_id` references `auth.users(id)`, delete SET NULL.

No customer row, password or token was selected. This confirms Source metadata;
the actual candidate must be rechecked before apply. The candidate has not been
changed by this preparation.

The [owned-only proposal](proposals/native-customer-account-fks-owned-only.sql)
requires the exact database/owner and original constraint definitions. It
refuses any existing reference without the same UUID in `app_accounts`, locks
the four affected tables and compares their complete rows before committing.
Only the two FK targets change. Delete/update behavior, validated constraints,
RLS, existing data and all Auth records remain intact. Reapplication refuses.
The SQL stays outside automatic migrations and must be part of the separately
reviewed candidate operation with its backup/restore proof.

Disposable PostgreSQL tests use the actual SQL proposal: legacy constraints
first block native account inserts; wrong target/role and orphan references
refuse; the proposal preserves all rows and policies; native profiles/orders
then work without an Auth stub; unknown UUIDs still fail; deleting a synthetic
account keeps the prior CASCADE/SET NULL semantics. Runtime cannot read Auth.
These tests do not prove actual production privileges or activate any flag.
