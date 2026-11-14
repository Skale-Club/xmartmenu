# Xprout Google runtime binding preparation

The production-only Coolify Compose service `app` binds
`/opt/xmartmenu/google-identity-runtime` read-only at
`/run/secrets/xmartmenu-google-identity`. Long bind syntax uses
`create_host_path: false`, so a missing source directory fails deployment
instead of silently creating an empty directory. The source directory keeps
its inode while the reviewed renewal helper replaces individual files inside
it; do not replace this directory bind with individual file mounts.

The host files already use root:1000 0750 for the directory and UID/GID
1000/1000 0600 for runtime files. The private CA stays outside the application
mount at `/opt/xmartmenu/google-identity-ca`, root:root 0700. The host-local
renewal timer is installed and its oneshot invocation succeeded; the existing
leaf was still valid, so actual certificate rotation was not exercised.

An isolated container using the production image and UID/GID verified Google
federation, account lookup and explicit permission denial for an update to a
cryptographically random absent UID. That does not activate application login.
Production login, account/grant import, certificate rotation across OAuth
expiry/restart and remaining data cutover gates require separate acceptance.

The configuration staging operator consumes only the host-root file
`/opt/xmartmenu/google-identity-ops/google-auth.env` (0600), supplied separately
by the coordinator. Its eight-key allowlist is `GOOGLE_AUTH_ENABLED=false`,
`GOOGLE_AUTH_PROJECT_ID`, `GOOGLE_AUTH_PROJECT_NUMBER`,
`GOOGLE_AUTH_WEB_API_KEY`, `GOOGLE_AUTH_ADC_FILE`, `GOOGLE_AUTH_ADC_AUDIENCE`,
`GOOGLE_AUTH_ADC_SERVICE_ACCOUNT` and `GOOGLE_AUTH_ADC_SUBJECT`. Project,
account, audience, subject and paths are pinned in the operator. Values must never enter Git, chat,
argv or diagnostic logs. A default offline plan must not read that file.

`scripts/ops/stage-xprout-google-config.py` defaults to an offline plan;
only explicit `--apply` on Linux root reads the fixed input file and invokes
the installed Coolify PHP runtime. It pins Coolify application
`gmaayluj11x1m6j7baogonfn` (team 0), use only container-local loopback API calls,
and leaves images and deployment state unchanged. If no
existing appropriate credential is available, use the installed supported
owner user 0/team 0 token model with ten-minute expiry and only `read`, `write`,
`deploy`; revoke that exact token in `finally`. Never recover existing token
hashes or enable sensitive/root API scope. See the installed-source findings
in [the host admission record](xprout-postgres-host-admission.md).

The installed `EnvironmentVariable::created` observer automatically clones new
production rows to preview unless a preview row already exists. Therefore the
operator first creates eight safe preview rows through POST: the enabled flag
is `false`, and the other seven values are empty (Laravel may store these as
NULL). Only after verifying this safe set does it POST missing production
rows. All rows are literal, runtime-only, not multiline and shown once. Existing
production/preview rows must already match their values and flags exactly;
different values, duplicate rows and partial unsafe state stop before changes.
Matching partial executions can be retried. The operator never PATCHes an
environment row, bulk-upserts, deletes rows or suppresses model events.

The Compose bind also applies to previews. Before accepting production
configuration, the operator verifies automatic previews are disabled. If
necessary it PATCHes only `is_preview_deployments_enabled=false` on this exact
application, without `instant_deploy`, and verifies settings/model pins again.
Repository `Skale-Club/xmartmenu`, branch `main`, Docker Compose build pack and
`/docker-compose.yaml` are pinned. Existing preview IDs/statuses are observed
without URLs or user data and must remain unchanged; no preview is stopped or
deleted. Fresh read-only metadata found automatic previews already disabled
and zero previews. The installed GitHub webhook and queued pull-request job
both check `Application::isPRDeployable()` before creating an automatic PR
deployment. The explicit admin preview API instead requires deploy authority
and does not consult that toggle: trusted administrators must not manually
deploy untrusted code into this production application. Development uses a
separate app/environment and DEV credentials.

Only the eight allowlisted Google values are read through the model for
preflight/postverification; the API has no sensitive scope and redacts values.
Other environment rows are compared by metadata only. The token lives only in
the PHP process, has a ten-minute expiration and is revoked in `finally`.
Requests allow no redirects, target only local application/env endpoints and
share an 80-second request budget. No deployment endpoint is available in the
operator. A process interruption can prevent `finally`; token expiry remains
the upper bound in that case. No request is automatically retried after an
uncertain mutation. Output contains booleans and a fixed failure phase only.

## Verified configuration staging

On 2026-11-04 at approximately 03:31–03:32 UTC the coordinator-approved
operator was executed on the existing host with source SHA-256
`27245d07fa29b6c624ca0a99d8793addcf9899a9d564db5874a4ebcd4db1a79b`.
The apply proof confirmed the eight production variables and eight safe
preview entries, Google disabled, automatic previews disabled, unrelated
environment metadata preserved and the temporary token revoked. No deployment
was requested. Before/after container snapshots matched ID, pinned image,
start time and mounts; health and UID/GID 1000/1000 remained valid. The
temporary public operator copy was removed.

An independent read-only model transaction then confirmed exactly eight
distinct keys in each scope, production/preview enabled flags `false`, the
other seven preview values empty, all entries runtime-only/literal/shown-once,
automatic previews disabled, zero existing previews and zero operator token
records remaining. That transaction was rolled back. No credentials or
customer data were emitted by either check.

Twelve offline parser/orchestration tests passed. The installed PHP parser
accepted the operator code without executing its bootstrap; Docker Compose
rendering accepted the fixed read-only bind and disabled host-path creation.
These fixtures do not simulate the Laravel API lifecycle; the separate live
readback above is the integration evidence.

The Compose mount is prepared in source and has not been activated in the
running production container. Google login remains disabled; there has been
no application deploy/restart, image change, data import or authentication
cutover in this operation. A subsequent reviewed release must recheck preview
isolation and host files before deploying the mount.
