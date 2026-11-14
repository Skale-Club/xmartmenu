# Xprout complete rename — verified status

Owner instruction, 2026-11-13: rename the application everywhere, including the Dev checkout and GitHub. This supersedes the old plan's exemption for repository/internal naming. **Status: partial.** GitHub and local source naming are changed; the physical checkout move, Codex project binding, Drive runtime consolidation and live infrastructure migration are not complete.

## Completed and verified

| Item | Result |
| --- | --- |
| GitHub | `Skale-Club/xprout`, same repository ID `R_kgDOR7fMtA`, history and branches preserved; homepage `https://xprout.app`, Xprout description |
| Git remote | `https://github.com/Skale-Club/xprout.git`; new remote reads main/dev; old repository API resolves to the renamed repository |
| Coolify metadata | Verified 2026-11-13 11:32 EST: display name `xprout`, source `Skale-Club/xprout`; same application UUID, branch, build pack, domain mapping and service configuration; healthy, no deployment requested |
| Package | `package.json` and both lockfile root names use `xprout`; dependencies unchanged |
| Runtime labels | Xprout telemetry, PostgreSQL application names, MCP realm, Firebase transient instance and analytics debug namespace |
| Browser continuity | New analytics/AR hint keys write under Xprout and read old keys to preserve active sessions and once-only guidance |
| Tooling/docs | 37 operator/test filenames and 38 document filenames renamed, with workflow/import/current-link updates; XPROUT_PROD_* settings retain legacy aliases |
| Deployment preparation | Same image/SHA dual-published to new and legacy GHCR packages on the next authorized release; repository+SHA pin/readback and legacy rollback selection tested |
| Shared registry | Local `skaleclub-apps` commit `a3439db` records current Xprout identity and pending operations; original migration history preserved |
| Notion | Product container title is Xprout; Journal keeps its existing identity/history and XMM prefix |
| Drive deliverables | `N:\My Drive\Xprout` remains canonical; child folder `Add Feature Xmartmenu` renamed to `Add Feature Xprout`; brand pack and color-review evidence remain there |

## Pending local move and resolved Coolify access

The real checkout remains **`C:\Users\Vanildo\Dev\xmartmenu`**. Windows refused the directory rename because Codex-owned connector processes hold that working directory open. A content-move attempt moved Git metadata before failing on the hidden source directory; all Git metadata was restored and HEAD/status verified. An **empty destination scaffold** remains at `C:\Users\Vanildo\Dev\xprout\.git`; it is not a second checkout. No tracked source or Git history was discarded.

Automatic approval review rejected the subsequent local move/cleanup operation and the earlier Drive consolidation/environment-link operation with `blocked by policy`, without a more specific reason. Those rejected operations were not executed. No alternate execution mechanism was used to bypass the rejection.

The reviewed completion helper is [finish-xprout-local-rename.ps1](../../scripts/ops/finish-xprout-local-rename.ps1). **Prepared, syntax checked, not executed.** Close Codex and run it in a separate PowerShell 7 window:

```powershell
pwsh -NoProfile -File "C:\Users\Vanildo\Dev\xmartmenu\scripts\ops\finish-xprout-local-rename.ps1" -ConsolidateDrive
```

It refuses nonempty destination collisions, removes only the verified empty scaffold, renames the checkout, verifies the same HEAD, and updates the existing Codex project name/root without changing its ID. With the optional switch, it moves `N:\My Drive\Dev\xmartmenu` into `N:\My Drive\Xprout\Runtime`, preserves its files/backups, updates only the AR_MODELS_DIR filesystem prefix, and recreates the existing environment symlink. No environment contents are printed. Until completed, the current environment link and AR files intentionally remain at their working old Drive location. No Codex SQLite database was edited.

Coolify remains healthy at UUID `gmaayluj11x1m6j7baogonfn`. The initial token's PATCH returned HTTP 403, missing write. The owner generated a replacement and entered it into a masked local terminal; the token is stored in the Xprout environment file, without being printed or passed as a process argument. At 11:32 EST on 2026-11-13, the following metadata patch succeeded with the new token:

```json
{"name":"xprout","git_repository":"Skale-Club/xprout","instant_deploy":false}
```

Readback confirms `xprout` / `Skale-Club/xprout`. Protected UUID, branch, build pack, Compose location, domain mapping, environment/destination/source IDs and public origin fields are unchanged. The application remained `running:healthy` and public `/api/health` returned HTTP 200. No deployment, database or runtime-environment mutation was requested. The repository's staging guard now pins the exact new source rather than accepting the transitional old repository alias. Safe metadata snapshots are delivered with the review; token values are excluded.

## Compatibility and remaining infrastructure migration

These old strings have real contracts; they are not forgotten UI labels. A complete infrastructure rename still requires staged migrations and verification rather than replacing them in place:

- Physical PostgreSQL database/roles, schema ledgers and deployed transport/systemd/SSH paths. New repository-local operators explicitly emit the old installed filenames until host migration is performed.
- Google identity workload pool, service account, SPIFFE subject and ADC mount paths. Preserve login while provisioning and verifying replacements.
- R2 buckets/CDN hosts and stored media URLs. Copy/verify objects and update configuration before switching URLs; keep old public URLs readable.
- Offsite backup archive/protocol/receiver identities. Old encrypted archives must remain restorable and a throwaway restore must verify the new protocol before retirement.
- Existing Stripe state/encryption domain separators, payment/subscription/CRM idempotency keys, advisory locks, cookies/cart keys, generated account identities and external CRM source/pipeline bindings. Changing them without a compatible transition can break sessions, ciphertext, retries or concurrent writes.
- Old printed-QR hosts, reserved legacy slug and historical migration/archive/journal records. Keep compatibility and historical facts. XMM remains the Journal prefix.

GHCR publication, new package permissions, host pull and a real rollback have **not** been proved by the local patch. Both old and new image coordinates are supported; retain old SHA images. Production code remains on its existing release pending the normal release authorization.

## Evidence

- Coolify authenticated GET/PATCH/GET succeeded; whitelisted before/after fields and a protected-configuration comparison passed, with public health HTTP 200. The 12 offline Google-staging tests passed again after pinning the new repository source.
- Parent verification: **88 tests across 12 unit files passed**, including raw legacy host routing, session-key migration, AR hint continuity, MCP realm, order/auth boundaries and new/legacy environment settings. The two configuration suites were rerun after tightening the helper input type: 23 passed.
- Full TypeScript noEmit passed after the input type correction; scoped ESLint and whitespace checks passed.
- Parent reran two offline deployment image tests, 15 transport installer cases, the final-cutover suite (33 cases, 18 existing platform/Docker skips), and 12 Google staging guard cases: no failures.
- Worker evidence: all ten Python suites, 140 cases with 38 existing skips and no failures; 37 Node operator tests; shell syntax checks. Real PostgreSQL integration cases were not run locally.
- Local completion helper has valid PowerShell syntax; its filesystem/Drive execution is deliberately unverified because it has not run.
- Prior color correction is separate local commit `7168a5b`; approved brand masters are `c98bcfe`. Both remain unpushed. The color report/evidence is already delivered under `Reviews/2026-11-13 Public Colors`.

Detailed source inventories and filename mapping are delivered under `N:\My Drive\Xprout\Reviews\2026-11-13 Rename`. Never treat an inventory or prepared script as evidence of a live migration.

References: [GitHub repository rename behavior](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository), [Coolify application metadata API](https://coolify.io/docs/api/endpoints/applications/update-application-by-uuid).
