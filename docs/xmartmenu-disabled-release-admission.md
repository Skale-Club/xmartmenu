# Xmartmenu release with owned features disabled

Prepared from read-only inspection, then the normal reviewed main release
completed on2026-11-04. It kept owned/Google login features disabled and did not
change SQL runtime login. Docker was used only on the existing remote host/CI;
local Docker Desktop was never started or used for this migration.

## Historical baseline before release

The healthy single app is resource`gmaayluj11x1m6j7baogonfn`, container
`app-gmaayluj11x1m6j7baogonfn-20261102T010249`, image
`ghcr.io/skale-club/xmartmenu:e5b1fb54ddc55a3445bd115a5973e4e30cb48876`, immutable
image`sha256:06645e194800d6ed0ef8e2e729991affd14c6bec057a1e98e71359062d4a58b6`.
It runs as`node`, Nodev24.22.2, on the existing own app bridge. Its runtime
cannot resolve`pg`. All five OWNED data flags and GOOGLE_AUTH_ENABLED are absent
in that old container; the existing strict true checks treat those as disabled.
There is no ADC env/path/mount in the old container. The host Google directory
exists; native SQL runtime remains NOLOGIN/limit12.

A bounded explicit READ ONLY Coolify model transaction confirmed application2,
environment1/team0, repository`Skale-Club/xmartmenu`, branch`main`, Docker Compose
build pack and`/docker-compose.yaml`. Automatic previews are disabled. The five
OWNED flag rows are absent. The staged GOOGLE_AUTH_ENABLED production row is
exactly one literal false runtime-only row. IMAGE_TAG remains the old SHA. The
stored raw Compose still lacks the Google bind; no model value was changed.

The new validated source includes`pg`8.x and the existing prebuilt-image Compose
bind from`/opt/xmartmenu/google-identity-runtime` to
`/run/secrets/xmartmenu-google-identity`, read_only true/create_host_path false.
The directory's existing root:1000 mode0750 and files1000:1000 mode0600 allow the
image's UID/GID1000 only. The CA directory is outside the app mount. The next
release can introduce the dependency/mount with all owned/Google features still
disabled. No SQL password/env URL is required for that release.

The SQL reader end-to-end gate had to wait for the validated new image; do not
install pg into the old container, use a new helper container or hand-roll a
PostgreSQL client to bypass the missing dependency.

## Executed release and postverification

PR26 was merged normally as78a3cd545c4b6c3f31c01e7cc244c06154d4f506. Official
main CI/deploy run41855494663 completed successfully without an admin override,
disabled scanner or manual duplicate dispatch. The optional GenericPassword
finding was reviewed as a public OS-account lookup; GitGuardian stayed active.

Read-only postverification found one healthy final container
`app-gmaayluj11x1m6j7baogonfn-20261104T152701`, exact full-SHA image tag and image
ID`sha256:df2d814c67b0049a26e5cf76a4909fdce7434d9ee028219e8ebc0fae2596f267`.
Readiness returned200/release78a3cd545c4b6c3f31c01e7cc244c06154d4f506. Runtime
Node24.22.2/UID1000/GID1000 resolves pg8.20.0. All five owned flags remain absent
(strict false defaults); GOOGLE_AUTH_ENABLED is literal false. The exact ADC
path is configured/readable, with the sole expected Google bind RW=false.
The private bridge ID/IP remained unchanged and transport stayed active.

The postdeploy Coolify raw Compose, normalized only for CRLF/outer whitespace,
has SHA256`07b95fc00b209fb87843161ecc61cbd326c281e373185abeb4c15a0f744e607a`,
matching the selected commit's Git blob. Parsed values confirm read_only true and
create_host_path false. Automatic previews remain disabled. Independent server
verification retained the37 existing SSH policies and SQL runtime NOLOGIN/limit12.
This release unlocked the separate reviewed private SQL-reader proof; it did
not activate native application data/auth or perform any business-data write.

## Existing trigger and rollback path

`.github/workflows/ci.yml` calls`build-deploy.yml` only after checks/E2E/independent
PG all succeed on a push or manual CI execution on`main`. PR or branch CI does
not build/push/deploy an image. `build-deploy.yml` is reusable workflow_call,
not workflow_dispatch. No new deployment workflow is needed.

After required PR checks and technical review, merging the selected commit into
main is the concrete publication trigger. Main CI builds the resulting exact
commit on a GitHub runner, pushes the full-SHA tag to GHCR, then the existing
script sets IMAGE_TAG on only this Coolify application, deploys and waits for
public readiness to report that exact release. There is no VPS Next build.
Do not merge/dispatch while a required check or policy remains unresolved.

Read-only installed-source inspection confirmed Coolify's
ApplicationDeploymentJob::deploy_docker_compose_buildpack invokes
loadComposeFileForDeployment, which calls Application::loadComposeFile with
isInit false. It reloads the Compose file from the configured Git main branch
before parsing/deploying and updates docker_compose_raw. No such method was
executed during inspection. The old stored raw file therefore does not itself
block the new bind, but target Compose fidelity must be checked: compare the
postdeploy raw Compose SHA256 with the selected commit's Git blob, and avoid
concurrent Compose changes on main during the deployment window.

Rollback uses the existing workflow only after its own admission checks:

```bash
# Prepared command only; not dispatched during this admission.
gh workflow run rollback.yml --repo Skale-Club/xmartmenu --ref main \
  -f sha=e5b1fb54ddc55a3445bd115a5973e4e30cb48876
```

That workflow requires a full SHA, a successful main CI for that SHA and an
existing GHCR manifest. The live old SHA has successful main CI run41369475702
and its image is resident/running. Confirm manifest availability immediately
before publication. Rollback pins the old image through the same IMAGE_TAG
script; it still reads current main Compose, so preserve/check the intended
Compose as well. The new Google bind can remain while the old code ignores it.
Rollback never enables owned flags or changes SQL auth.

## Pre/post checks within the approved bounds

Before trigger: exact target main commit/green CI/image provenance; source
Compose bind flags and hash; current host admission; valid readable host Google
runtime directory; no app/Google true flag; no SQL runtime login; saved live old
image/readiness and successful rollback CI. Preserve candidate DB, transport,
backup, existing volume and unrelated app metadata. No data migration is part
of this release.

After deployment: exact SHA image and readiness release; one healthy final app
(two same-resource containers may coexist temporarily during rollout); the same
private bridge ID/subnet; effective OWNED flags false/absent and Google literal
false; fixed Google source/target directory bind RO with no CA/private-CA mount;
ADC path configured/readable by UID/GID1000; no public PG port, SQL runtime still
NOLOGIN/limit12; no new own cgroup/host OOM/cap pressure. Confirm Node can resolve
pg before preparing any reader password. Only then can the separate short-lived
reader proof be reviewed/applied. No authenticated public-user test is required.

The deploy script retries API calls, including mutations. If a mutation has an
uncertain result, inspect the exact IMAGE_TAG/deployment UUID/job status before
manual recovery; do not dispatch another deployment blindly. A green release
and protocol health are not evidence of SQL login or complete Supabase exit.
