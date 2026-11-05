# Native MCP and OAuth contract (preparation; disabled)

Baseline: main e273b801d57a16a2318e6792cc981369345baf89. No production change, client credential export, provider request or schema apply is part of this publication. The native selector is `OWNED_MCP_ENABLED=true`, default false; native operation also requires the existing native Auth configuration. A native refusal never falls back to Source.

## Existing surface and migration boundary

The source tree registers **50 tools**, including factory-created delete tools, in ten modules: menus/categories/products 12, locations/zones 8, tenants 8, plans/subscription 6, staff 4, users 3, launch checklist 3, branding/SEO 2, orders 2 and platform 2. The transport remains stateless Streamable HTTP at `/api/mcp`; destructive actions retain `MCP_ALLOW_DESTRUCTIVE=true` and explicit `confirm:true`.

The old authorization server is Supabase `/auth/v1`. Its browser SDK owns consent, authorization codes, client registration and refresh. The old resource gate resolves a Source JWT/user and profile, then synthesizes `mcp:admin` and uses the user's UUID as client ID. There is no local authorization-server implementation or local client registry to preserve. Native mode accepts only its own resource-bound opaque access tokens, and reports the actual registered client ID and consented scope.

Existing Supabase access/refresh tokens, client IDs and authorizations do not transfer issuers. MCP clients must rediscover, register/reconnect and explicitly consent after cutover. No Source OAuth client secret is read, copied or exported. Existing browser native sign-in is reused; an OAuth grant never creates or impersonates an `app_sessions` row.

## Native protocol contract

- Fixed issuer: configured application origin; fixed resource: that origin plus `/api/mcp`. Host/request arguments cannot select an issuer or resource.
- `GET /.well-known/oauth-protected-resource`: RFC9728 resource and authorization-server discovery, actual `mcp:admin` scope and Bearer header use.
- `GET /.well-known/oauth-authorization-server`: RFC8414 endpoints, code response, authorization_code/refresh_token grants, S256 only, supported client authentication.
- `POST /oauth/register`: RFC7591 registration, server-generated client ID, exact HTTPS or loopback redirect URIs, bounded metadata and existing rate limiting. No arbitrary metadata fetch or provider registration. Public clients use `none`; locally generated confidential-client secrets are returned once and stored only as hashes.
- `GET /oauth/authorize`: validates registered client, exact redirect, resource, scope, state and S256 challenge; creates a short-lived authorization request and redirects only to the application's consent screen.
- `GET /oauth/details` and `POST /oauth/decision`: native signed-in superadmin, current session/version/binding/profile, explicit allow/deny, same-origin mutation and bounded body. No silent approval or email-based privilege.
- `POST /oauth/token`: bounded form body, registered client authentication, exact client/redirect/resource, short-lived one-use code with S256 verifier. Access/refresh values are random opaque credentials, hashed at rest; no Source or Google JWT is minted.
- Refresh rotates atomically; reuse revokes the grant family durably. Resource/scope cannot expand. Account version, disabled/reset controls, exact enabled binding and current provider revocation are checked again.
- `POST /oauth/revoke`: bounded authenticated-client revocation; invalid/unknown values do not disclose token existence. Revocation never retries a business/financial action.

Metadata may be public/CORS-readable. Token endpoints authorize by code/client/PKCE or refresh/client, never by an ambient browser cookie. Consent mutations require the actual native cookie and Origin. Tokens never appear in resource URLs or tool arguments. Authorization codes may appear only in the registered callback URL, expire shortly and are single use.

## Authority and data reuse

Each tool transaction checks its actual access-token/grant/client, fixed resource, expiry, consented `mcp:admin`, current superadmin profile/account version, enabled project/subject binding and tenant scope. Current Google status is read with the existing bounded read-only account lookup outside SQL; its server-issued proof is short-lived and refreshed outside later transactions as needed. Payload booleans/roles/tenant IDs cannot confer authority.

Browser guards retain their current session-hash SQL. The three shared account/tenant/subscription repositories accept an explicit closed browser-or-OAuth authority union, with no both/neither case. OAuth uses its own persisted grant and current SQL guard, not a fake cookie/session or a query/SDK shim. Existing catalogue/location/settings query repositories run inside the already-authorized MCP transaction. The existing admin pool of two is reused; no new service, pool or billing resource.

Writes retain the account-authority advisory, then authority rows, tenant and domain lock order. Business effects and audit/CRM intentions use their existing native atomic contracts. Provider/network work occurs outside SQL. Subscription changes use the native billing coordinator and immutable financial request ledger; MCP does not directly overwrite a Stripe-backed billing cycle/plan.

## Honest tool-contract changes

Existing business tool names/operations are retained where semantics remain valid. Native identity operations expose the already-reviewed account model:

- `create_tenant` assigns an exact independent verified `owner_user_id`; it does not create an email/password identity.
- `create_staff` issues an invitation for an existing verified `recipient_user_id`; `reset_staff_password` returns the native recovery link and revokes old access, rather than manufacturing credentials.
- `delete_user` explicitly disables/revokes the native account and preserves retained business history; it does not claim a hard-deleted Source Auth user.
- Plan/subscription changes route through their native administration/billing contracts. Account/tenant ownership changes never match email/contact details.
- User/staff listings expose local UUID/profile/current binding data. Unavailable Source email fields remain null; no provider user listing or contact search is added.
- `xphere_resync` records a native CRM intention; launch-checklist SQL is native and its existing public-site scan runs outside SQL, with fresh authorization before applying results.

Clients must refresh the tool schemas after reconnecting. Native schemas reject obsolete credential-bearing inputs instead of silently accepting them. Source mode remains explicit while the rollout flag is false.

## Proof before activation

Offline protocol/transport/tool tests, disposable PostgreSQL concurrency/privilege/tenant tests and full build/browser CI precede any schema/flag apply. Cover PKCE downgrade/replay, code double exchange, refresh races/reuse, exact redirect/resource/client/scope, cross-site consent, bounded bodies, disabled/version-revoked/binding-revoked actors, forged tool context and financial phase revocation. Public client registration does not grant any user access; real superadmin consent remains necessary.

Initial evidence: 76 offline tests cover the native catalogue, actual SDK schema listing and server-capability propagation, protocol/body limits, false authority and platform DTO secret exclusion. The disposable OAuth suite adds 24 PostgreSQL cases including real concurrent exchange/refresh and a narrow NOLOGIN runtime role. The local dependency junction lacks some declaration packages/Redis; full project type/build and PostgreSQL validation run in CI. The complete PR64 publisher/dispatcher is integrated: trusted post-commit handoff publishes a pending intention's actual ID and cannot throw into a confirmed financial response. Recording/publishing an intention does not claim remote delivery. Platform tools select and return only id plus their ten branding/SEO fields, never integration credentials. Registration and authorization have existing per-IP limits plus bounded indexed daily budgets (1,000 registrations/10,000 requests), rather than a permanent lifetime cap. No cleanup/retention change or production SQL was applied.

Review/apply the additive OWNED-only OAuth tables with a restoration-proven backup, preserve Source/business UUIDs/roles/rows and existing migration provenance, verify actual client acceptance/reauth, and retain the global Source reconciliation/write-fence gates before production activation. This preparation does not close those gates.

Primary contracts: [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization), [OAuth security BCP](https://www.rfc-editor.org/rfc/rfc9700.html), [dynamic client registration](https://www.rfc-editor.org/rfc/rfc7591.html), [protected resource metadata](https://www.rfc-editor.org/rfc/rfc9728.html).
