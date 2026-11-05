# Xmartmenu isolated identity pilot

Preparation only. This branch does not create a container/database, install a
route, read production credentials, enable a production flag or contact a provider.
The pilot is a separate process and database on existing host188, behind only
`https://xmartmenu.skale.club/__xmartmenu_identity_pilot/`. The stage alias points
at the same production app and is expressly rejected.

The mini server uses the existing `createIdentityHttp`, `IdentityStore`, verified
Google ID-token/current-account readers and renewable X.509 credentials. It does
not start Next, worker queues, Source SQL, Supabase SDK, registration, staff
acceptance, Stripe, mail or CRM. It builds the existing Firebase browser package
into a public local JS file; no CDN library or new provider secret is needed.
Local dependencies are incomplete (Firebase is absent in the shared junction),
so the full browser/server bundle is validated from `npm ci` in cloud CI. The
server bundle built locally and passed the prohibited-runtime import check.

## Fixed boundaries

- Prefix `/__xmartmenu_identity_pilot/`, canonical production domain only.
- `xmartmenu_identity_pilot` at Docker name `xmartmenu-identity-pilot-db:5432`;
  login `xmartmenu_pilot_runtime`, owner `xmartmenu_pilot_owner`. Production
  `xmartmenu`, its roles and PG host49 are rejected as runtime targets.
- Runtime pool2, SQL5s/query6s/connect5s, application server port8099 inside its
  isolated Docker network. The installation must publish no host port. Traefik
  routes only the exact canonical host plus pilot path to this container;
  production routes/labels remain intact. Root performs resource admission before
  selecting/installing limits; no hardware/cost change is implied.
- Existing Google read-only mount at `/run/secrets/xmartmenu-google-identity`,
  application UID1000; the ADC validator retains its exact project/SAN/path guards.
- Only fixed Source project's public URL/key is admitted. A service key, arbitrary
  project, emulator, environment expansion or extra configuration field refuses.
- Configuration arrives as a bounded private stdin JSON packet, not URL/argv or
  tool output. It is not written by the harness. There are no request/access or
  provider-error logs. Only aggregate startup readiness may reach stdout.
- Cookies are exclusively `__Host-xm_identity_pilot` and its `_challenge`, secure,
  HttpOnly, SameSite=Lax, Path=/. Main application cookies are neither read nor
  overwritten. `identity-http` defaults remain unchanged.

The startup SQL checks exact database/role/owner,51 tables,95 ledger rows, seven
accounts/one disabled, restricted runtime role with connection limit2, exact
profile/account-control digests from the clone receipt and no invalid bindings or
sessions. The root coordinator must independently establish isolation and all47
business digests before startup; these sanity checks do not replace clone proof.
Current own candidate OID30227 on49 is the export source and remains untouched.

## Reproducible public bundle

`node scripts/ops/build-xmartmenu-identity-pilot.mjs` is plan-only. Explicit
`--output-new <new-directory>` builds `server.cjs`, `browser.js` and the CLI, with
LF/source-derived SHA256 manifest. Existing destination directories refuse.
The server bundles current source and dependencies except pg, which must be the
validated installed driver in the selected Node runtime image. The bundle import
guard rejects included Next/Stripe/Supabase/Upstash/AWS runtimes.

The copied CLI defaults to plan-only without loading the runtime. It starts only
with `--serve-reviewed <exact-manifest-sha256>`, after checking all three exact
artifact hashes, refusing NODE_OPTIONS/TLS-disable/emulator overrides and reading
one <=32KiB stdin packet with EOF within5s. The coordinator provides EOF; an
interactive Docker stdin left open is intentionally refused. Failed admission
closes the pool and listens on no socket. Startup success is a JSON boolean only.
No private config belongs in this repo, CI artifact, deployment URL or terminal.

## Root-coordinated clone and real proof

The new `xmartmenu-identity-pilot-snapshot.mjs` compiles one private read-only
query that combines the preserved47/92 business manifest with all four identity
table row digests, full95 ledger digest and exact profile/account-control hashes.
`comparePilotSnapshots` requires equality of every field: the former engagement
drift exception is not used. Its actual SQL is covered by the disposable
foundation PostgreSQL fixture after the three migrations commit.

`export-xmartmenu-identity-pilot.py` is plan-only by default. Its reviewed export
mode requires its own source hash, the exact pinned existing backup helper and
snapshot query hash, a private previously admitted snapshot SHA, source OID30227,
dormant runtime/reader roles and zero other database sessions. It takes the
existing backup lock; samples current capacity, current PG memory and unchanged
cgroup event counters without requiring historical zero or resetting counters;
checks the complete private manifest before/after dump; authenticates its
AES-GCM ciphertext; and retains archive/key/snapshot/receipt as new root400 files
in a new root700 recovery directory. Only aggregate hashes/counts/path reach its
stdout. Restore success and application cutover remain explicitly false. The
key/archive/private snapshot must subsequently travel only through the root
coordinator's private stdio path; this export CLI never prints those payloads.

1. Serialize the source49 snapshot/export with other PG operations. Reuse the
   reviewed authenticated encrypted backup/restore machinery, current fixed
   container/image/volume pins and fresh51/95/7/47 manifest. Transport archive/key
   only through private pipes or root-only recovery storage; never via chat.
2. Freshly admit CPU/RAM/PSI/disk on188, with headroom for the isolated PG and mini
   server while the production app remains running. Do not resize/stop other apps.
   Create only a new isolated volume/database/roles; map archive ownership to
   `xmartmenu_pilot_owner`. No cluster auth roles/production credentials are copied.
   PG has no published port and only the mini server's private network can reach
   it. Runtime receives only the existing identity/profile reads and four identity
   table privileges necessary for this copy; no financial/business writer.
3. Independently compare the restored clone's47 business row digests, six UUID/
   authority groups,51 table inventory,95 ledger rows, seven account controls,
   role distribution, sequences and function provenance. Record original49 OID,
   roles, data and zero sessions unchanged. No application login role on49 changes.
4. Pin the public bundle and install the restricted mini server/one path route
   with Google RO mount and private startup config. Test health/config/challenge
   through the real HTTPS prefix; prove normal production routes/cookies unchanged.
5. The real user independently proves the previous Source account (password grant
   followed by online getUser, fixed public project only), then fresh Google or
   SMS possession. Only the actual verified immutable Source UID can bind to the
   exact existing clone account. No email/phone contact match or promotion exists.
   Existing owned proof may link a second factor only while originally active and
   <=300s; do not extend expiry or require an invented post-deployment freshness.
   Each Google/phone proof must be <=300s and current provider status remains
   mandatory. Sessions/codes stay memory/cookies and hashed SQL; never report them.
6. Independently read clone proof: verified provider bindings map to the original
   account, local role/tenant and all47 business digests unchanged, disabled account
   still blocked; real logout/revocation denies old sessions. Aggregate receipt
   records actual proof times/provider categories only, with UUIDs private.

Only the isolated clone changes in this operation. Its bindings/sessions are not
automatically copied to production; any later transfer requires exact independent
proof/expiry and role-preservation review.

## Separate final data cutover gate

The Source47 business write barrier and final full reconciliation are still
required. Stopping the production app alone is insufficient: existing browsers
write via REST, and privileged RPC/Auth triggers can write without the app. A
reviewed DB-enforced fence must cover these paths while preserving public Auth
getUser/password possession proofs. Capture exact reversible definitions, backup
and current writers before fence. No three-engagement-table drift exception
applies at final cutover. Reconcile all47, six authority groups, sequences,
orders/totals and functions under the fence, then prove a single own writer.

All additive OWNED-only domain proposals (financial ledgers, effects, OAuth and
account/FK extensions) require separate apply/rehearsal before flags. The isolated
identity pilot does not claim payment, MCP, schema or full production readiness.
Pre-own-writer rollback restores the exact Source fence definitions; after any
own business write, stop both writers and reconcile before deciding direction.
