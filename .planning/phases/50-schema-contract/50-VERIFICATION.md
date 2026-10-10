---
phase: 50-schema-contract
verified: 2026-06-21T00:00:00Z
status: passed
score: 7/7 must-haves verified
gaps_resolved:
  - truth: "The project typechecks (npx tsc --noEmit passes)"
    status: resolved
    resolution: "Dropped the excess `status` field from the two inline normalizeMrr({...}) calls at lines 64/74 of scripts/xphere-mapping-check.ts (commit after verification). `npx tsc --noEmit -p tsconfig.json` now exits 0 and `npm run xphere:check` still exits 0."
human_verification: []
---

# Phase 50: Schema & Contract Verification Report

**Phase Goal:** The CRM sync state lives in the schema and the entity/stage/MRR mapping exists as a pure, offline-testable function — front-loading the riskiest correctness decisions (immutable idempotency key, stage mapping, normalized MRR) with zero upstream dependency.
**Verified:** 2026-06-21
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1   | tenants gains 5 nullable xphere_* columns via idempotent migration | ✓ VERIFIED | migration 054 lines 10-15: 5x `ADD COLUMN IF NOT EXISTS`, all nullable (no NOT NULL), correct types (3x text, timestamptz, text) |
| 2   | Tenant interface mirrors all 5 columns type-safely | ✓ VERIFIED | src/types/database.ts lines 97-101: five `string \| null` fields inside Tenant after custom_domain_verified |
| 3   | external_id = tenants.id is the documented idempotency key (not email/phone) | ✓ VERIFIED | migration comment lines 3-4; types.ts lines 56-58; mapping.ts lines 128/134/139 all set external_id = input.tenant.id |
| 4   | /api/v1/sync contract + SyncReason + XPHERE_STAGES live in one file (types.ts) | ✓ VERIFIED | types.ts: SyncReason (8 members), XPHERE_STAGES (4 stages incl 'At Risk'), XphereSyncRequest with source:'xmartmenu' |
| 5   | buildSyncPayload is pure: no I/O, no network/queue imports, owner-only contact, normalized MRR | ✓ VERIFIED | mapping.ts imports only ./types + type-only @/types/database; no fetch/qstash/createClient/getTenantPlan; contact.role hardcoded 'store-admin'; amount = normalizeMrr (annual_price/12 or monthly_price) |
| 6   | Offline gate exits 0 with no network/credentials | ✓ VERIFIED | `npx tsx scripts/xphere-mapping-check.ts` → "all assertions passed", EXIT=0; no dotenv/process.env/Supabase imports |
| 7   | Project typechecks (`npx tsc --noEmit` passes) — declared acceptance criterion | ✗ FAILED | `npx tsc --noEmit -p tsconfig.json` → TSC_EXIT=2; 2x TS2353 in scripts/xphere-mapping-check.ts (lines 64, 74) |

**Score:** 6/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `supabase/migrations/054_xphere_sync_columns.sql` | 5 idempotent nullable xphere_* columns | ✓ VERIFIED | Exists, substantive, exactly 5 ADD COLUMN IF NOT EXISTS, all nullable, correct types + COMMENTs |
| `scripts/apply-migration-054.mjs` | runner targeting migration 054 | ✓ VERIFIED | Exists; line 24 readFileSync of 054_xphere_sync_columns.sql (key link WIRED) |
| `src/types/database.ts` (Tenant) | 5 xphere_* `string \| null` fields | ✓ VERIFIED | Lines 97-101 inside Tenant interface |
| `src/lib/xphere/types.ts` | SyncReason + XPHERE_STAGES + contract | ✓ VERIFIED | Exists, substantive (109 lines), all exports present |
| `src/lib/xphere/mapping.ts` | pure buildSyncPayload + helpers | ✓ VERIFIED | Exists, substantive (158 lines); WIRED to types.ts and consumed by check script |
| `scripts/xphere-mapping-check.ts` | offline assertion gate | ⚠️ STUB-FREE but breaks tsc | Exists, substantive (251 lines), runs green at runtime; but introduces 2 project typecheck errors |
| `package.json` (xphere:check) | npm script entry | ✓ VERIFIED | Line 13 `"xphere:check": "npx tsx scripts/xphere-mapping-check.ts"`; valid JSON |

### Key Link Verification

| From | To | Via | Status |
| ---- | -- | --- | ------ |
| apply-migration-054.mjs | 054_xphere_sync_columns.sql | readFileSync | ✓ WIRED |
| mapping.ts | types.ts | import XPHERE_STAGES/SyncReason/XphereSyncRequest | ✓ WIRED |
| mapping.ts | external_id = tenants.id | account/contact/opportunity.external_id = input.tenant.id | ✓ WIRED |
| xphere-mapping-check.ts | mapping.ts | import buildSyncPayload + helpers (@/lib/xphere/mapping) | ✓ WIRED |
| package.json | xphere-mapping-check.ts | npx tsx | ✓ WIRED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Offline mapper gate exits 0 with no network | `npx tsx scripts/xphere-mapping-check.ts` | "all assertions passed", exit 0 | ✓ PASS |
| Project typechecks | `npx tsc --noEmit -p tsconfig.json` | exit 2, 2 errors in check script | ✗ FAIL |
| package.json valid JSON | `node -e "require('./package.json')"` | valid JSON | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| FND-01 | 50-01 | tenants table has 5 xphere_* sync-state columns (external_id = tenants.id) | ✓ SATISFIED | migration 054 + Tenant interface; all 5 columns present, nullable, correct types |
| FND-02 | 50-02, 50-03 | src/lib/xphere/ exposes types.ts + pure mapping.ts; offline unit-testable | ⚠️ PARTIAL | types.ts + mapping.ts present and correct; offline gate runs green BUT project tsc fails. NOTE: REQUIREMENTS.md FND-02 text also lists a `client.ts` (network POST) — intentionally out of scope for Phase 50 per the goal + "no network code" constraint; client.ts belongs to Phase 51. Not a Phase-50 gap. |

No orphaned requirements: REQUIREMENTS.md maps only FND-01 and FND-02 to Phase 50, both claimed by plans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| scripts/xphere-mapping-check.ts | 64, 74 | Excess `status` property on normalizeMrr() literal → TS2353 | 🛑 Blocker | Breaks the `npx tsc --noEmit` gate the plans declared as an acceptance criterion |

No TODO/FIXME/placeholder, no stub returns, no hardcoded-empty render data found. No `@upstash/qstash` in package.json or node_modules. No network/queue/producer code in src/lib/xphere/ (only comment-level mentions declaring its absence). Xphere repo untouched (separate repo). All code/comments in English.

### Human Verification Required

None — all checks were resolvable programmatically.

### Gaps Summary

The phase substantively achieves its goal: schema (migration 054 + Tenant interface), the single-source contract (types.ts), and the pure offline mapper (mapping.ts) all exist, are correct, and are wired. The offline gate runs green at runtime, confirming MRR normalization, external_id keying, stage selection, and note dedup.

One blocking gap: the project's TypeScript gate fails. `tsconfig.json` type-checks `scripts/**/*.ts`, and `scripts/xphere-mapping-check.ts` passes a `status` field into two inline `normalizeMrr({...})` calls (lines 64, 74) whose parameter type does not include `status`, producing two TS2353 excess-property errors. The runtime `tsx` gate masks this because esbuild strips types without checking them. Both PLAN 50-01 (Task 2) and PLAN 50-02 (Tasks 1 & 2) declared `npx tsc --noEmit` passing as an explicit acceptance criterion, so this is a real, narrow correctness gap.

Fix is one-line-scoped: remove `status` from the two inline `normalizeMrr({...})` literals (it is not part of the mapper's MRR inputs), or widen `normalizeMrr`'s parameter type to also `Pick` `status`. After the fix, re-run `npx tsc --noEmit -p tsconfig.json` (must exit 0) and `npx tsx scripts/xphere-mapping-check.ts` (must still exit 0).

---

_Verified: 2026-06-21_
_Verifier: Claude (gsd-verifier)_
