# Owned database schema changes

Schema changes for the production PostgreSQL (the owned `xmartmenu` database
on the Hetzner host) after the final cutover. `docs/proposals/` is the
cutover's fixed list; new changes go here.

## Files

`YYYYMMDDHHMMSS_name.sql`, applied in name order. Each file:

- is one transaction (`BEGIN` … `COMMIT`) with `lock_timeout` / `statement_timeout`;
- refuses to run unless `current_database()='xmartmenu'` and `current_user='xmartmenu_owner'`;
- is idempotent (running it twice changes nothing);
- grants what `xmartmenu_runtime` (the app's server role, BYPASSRLS) needs and nothing to browser roles;
- ends with a sentinel that fails the transaction if the result is wrong.

Once applied a file is never edited: the operator refuses a file whose SHA-256
differs from the one recorded. Write a new file instead.

Keep the matching legacy file in `supabase/migrations/` when the change also
applies to Supabase, and make the app tolerate the change not being there yet
(deploy code first, schema second).

## Applying

GitHub › Actions › **Owned schema** › Run workflow (branch `main`):

1. `mode=plan` — read only: each file is `applied`, `pending` or `changed`.
2. `mode=apply`, `confirm_sha` = first 8 characters of the main commit
   (needs a green CI run on that commit).

The workflow ships `scripts/ops/xprout-owned-schema.py` and these files to
the PostgreSQL host over SSH (`CUTOVER_SSH_*` secrets, `final-cutover`
environment) and runs it as root. Apply takes the operator lock and refuses
while the cutover or an Xmail deploy holds its lock, writes a schema-only
`pg_dump` to `/opt/xmartmenu/owned-schema/<run>/` (0400), runs each pending
file through `psql` in the PostgreSQL container as `xmail_owner` →
`SET ROLE xmartmenu_owner`, and records it in `xmartmenu_ops.owned_schema`.
Output is `xmartmenu-owned-schema key=value` lines only (no SQL text, no
secrets; errors as SQLSTATE).

Tests: `python3 -B scripts/ops/test_xprout_owned_schema.py` (CI job
`owned-schema-postgres` also runs them against a disposable PostgreSQL 17).
