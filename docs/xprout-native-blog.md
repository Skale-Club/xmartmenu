# Native blog, RSS, Telegram and scheduled jobs

Code and a separately reviewed schema proposal only. No live SQL, provider
request, credentials, infrastructure, flag or deployment was changed.
`OWNED_BLOG_ENABLED` defaults false. Native execution requires owned identity and
that explicit configuration. Owned selection/denial never falls back to Source.
False legacy branches retain their SDK paths.

## Covered application flows

The five platform API groups remain `settings` GET/PATCH, `posts` GET/POST,
`rss` GET/POST, `telegram` GET/PATCH and `generate` POST. The existing internal
Telegram webhook and two CRON POST routes use native adapters. Platform and
tenant panels, tenant actions, both public RSS feeds, indexes/posts/tags/archives,
metadata and the platform sitemap use owned SQL in native mode.

The tenant sidebar/actions previously allowed store staff to use the blog. This
port preserves that tenant member rule, checking the current SQL role and plan.
Platform administration requires current superadmin authority. Preview/demo
cookies are not an independent authority and are rejected for native controls.
Public readers require published, nonfuture rows in the exact scope, plus an
active tenant and current `blog` capability for restaurant scopes.

All runtime SQL reuses the existing two-connection admin pool. No new pool,
service, scheduler, account or paid provider is introduced. The existing
CRON_SECRET endpoints remain the scheduling entry points. Telegram keeps its
existing fixed official API and bot settings; AI keeps the existing OpenRouter
models and primary KeyChoice billing rules. The blog-specific key override stays
nonbillable as before. This does not add a paid fallback or automatic AI retry.

## Authority and transaction boundaries

Origin, cross-site requests, bounded bodies, schemas and manual idempotency UUIDs
are checked before provider lookups. Current real owned browser sessions are
matched by server-derived hash, user, authentication epoch, project/subject,
account version, clock expiry, live binding, current role and tenant. Google
status is refreshed outside SQL before each phase and SQL matches the exact
tuple again afterward. Private queued work retains the original provenance; no
raw session token or substitute owner identity is stored or manufactured.

Writers share `xmartmenu-account-authority`, actor locks, tenant NO KEY UPDATE /
plan SHARE and a scope-specific blog advisory. Publication, feedback, operation
completion, RSS consumption and mandatory ID-only audit commit atomically. A
callback's scope comes from its current unique Telegram secret, never its body;
current enabled approvals, configured chat and tenant capability are checked in
the decision transaction. Duplicate callback IDs cannot duplicate feedback.

## Durable effects and ambiguity

`app_blog_operations` and `app_blog_calls` are proposed dedicated backend tables,
outside automatic migrations. Legacy blog jobs, rows, IDs, locks and Source
digests are preserved. Existing accounts and bindings are never changed. The SQL
proposal requires database `xmartmenu` owned by `xmartmenu_owner`; backend grants
and activation require a separate reviewed operation. Receipt FKs deliberately
retain history and can prevent physical deletion; tenant archival remains the
alternative when historical references exist.

A manual generation/settings request has an explicit UUID that the browser keeps
through uncertain outcomes. Cron has a deterministic tick key and rechecks
cadence under its scope lock; the cadence advances on attempt as before. Claims
have no timed takeover. An unresolved generation or remote settings operation
requires review before another operation of that kind. Calls are inserted as
sending before network work, and only the exact private claim can record a
receipt. No HTTP endpoint accepts those internal claims, actor hashes or roles.

AI receipts require actual finite provider cost. Missing token counts remain
null, never invented zeroes. A known receipt may be appended after actor
revocation to preserve cost, but cannot authorize another call or apply output.
Output applies only with current authority and unchanged configuration/grounding.
Prompts, pillar rotation, tenant context, HTML/link sanitization and length bounds
reuse the existing machinery. Covers use explicit native S3, immutable operation
paths and the existing 16:9 normalization. No configured image model skips that
stage as before; an uncertain paid/image/storage outcome requires reconciliation.

Draft notification intentions commit with the post. Post-commit delivery failure
preserves the generated result. Pending intentions can be picked up by the same
configured cron, retaining and revalidating the original actor. Each destination
has a separate prepared call and confirmed message ID receipt. Unknown Telegram
outcomes never automatically resend. Callback acknowledgements have separate
durable intentions, so their failure cannot repeat or undo a committed approval.

Enabling Telegram registers the desired secret once, then applies the local
configuration only after confirmed provider success and current authority/CAS.
Disabling clears the local secret in the claim's commit; a failed remote delete
still reports disabled locally and a pending remote outcome. API keys/bot tokens
remain encrypted at rest and never appear in responses or receipt payloads.

Operators must reconcile private operation/request/response digests, provider
evidence and SQL readback before an explicit reviewed repair. Do not blindly
reset claims or repeat paid requests/messages after a timeout or ambiguous commit.

## RSS and validation

RSS fetches retain sequential processing, twenty items per source and GUID
deduplication preserving used/skipped state. Inventories are bounded at 1000
sources/scopes. DNS is resolved and a public address pinned into the request;
private/loopback/link-local/mapped destinations and redirects are refused.
Responses are bounded to 2MB and 15 seconds. Network calls occur outside SQL;
source URL/enabled state and current authority are rechecked before insertion.

CI adds a serial disposable PostgreSQL suite without removing existing hooks.
It exercises public scope/capability/scheduling, current authority, audit rollback,
approval concurrency, request/claim/call replay, real cost after revocation and
Telegram secret/chat/scope/replay boundaries. Offline fakes cover origin/body
rejection before providers, cost/receipt ambiguity and local disable versus
unknown remote deletion. Providers are never called by tests. Full build,
TypeScript, installed Sharp/image tests and PostgreSQL run in CI, not local Docker.
