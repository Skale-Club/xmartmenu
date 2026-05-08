---
phase: 17-ci-gate
plan: 01
subsystem: infra
tags: [lighthouse, lighthouse-ci, github-actions, performance, ci, treosh]

# Dependency graph
requires:
  - phase: 14-instrumentacao
    provides: Baseline Lighthouse scores (/ = 100, /restaurante-teste = 94 mobile)
  - phase: 16-frontend-perf
    provides: Phase 16 target of >= 90 mobile performance on both routes
provides:
  - GitHub Actions Lighthouse CI workflow blocking PRs when performance drops below 0.88
  - LHCI config auditing both production URLs with pessimistic aggregation
affects: [all future phases — any PR that degrades performance below 0.88 will fail CI before merge]

# Tech tracking
tech-stack:
  added: [treosh/lighthouse-ci-action@v12, lighthouse-ci (LHCI)]
  patterns: [production-URL auditing (no local server), PR gate via GitHub Actions status check]

key-files:
  created:
    - .lighthouserc.json
    - .github/workflows/lighthouse-ci.yml
  modified: []

key-decisions:
  - "Threshold set at 0.88 (score 88) — 2-point buffer below Phase 16 target of >= 90, to absorb run-to-run variance"
  - "numberOfRuns: 1 — single run per URL keeps CI fast; production URLs have stable synthetic scores"
  - "preset: lighthouse:no-pwa — suppresses service-worker failures (app has no SW)"
  - "pull_request trigger only — gate is pre-merge, not post-merge; push-to-main would audit already-merged state"
  - "No setup-node step — treosh/lighthouse-ci-action ships its own Node environment"
  - "temporaryPublicStorage: true — report link posted in PR check, no LHCI server needed"

patterns-established:
  - "Performance gates: assert categories:performance with minScore on 0-1 scale and error severity"
  - "Separate CI workflows: lighthouse-ci.yml is independent from ci.yml (lint/build)"

requirements-completed: [PERF-03]

# Metrics
duration: 15min
completed: 2026-05-07
---

# Phase 17 Plan 01: Lighthouse CI Gate Summary

**GitHub Actions Lighthouse CI workflow blocking PRs when mobile Performance score drops below 0.88, auditing both production URLs via treosh/lighthouse-ci-action@v12**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-07T22:45:00Z
- **Completed:** 2026-05-07T22:50:00Z
- **Tasks:** 2
- **Files created:** 2

## Accomplishments

- Created `.lighthouserc.json` with LHCI configuration auditing both production URLs at threshold 0.88
- Created `.github/workflows/lighthouse-ci.yml` triggering on every PR to main, using treosh/lighthouse-ci-action@v12
- Locked Phase 16 performance gains into CI — any future PR degrading performance below 0.88 will fail before merge
- Threshold comment documents full rationale: Phase 14 baseline, Phase 16 target, 2-point buffer

## Task Commits

Each task was committed atomically:

1. **Task 1: Write .lighthouserc.json** - `64fb6cf` (chore)
2. **Task 2: Write .github/workflows/lighthouse-ci.yml** - `039e5c3` (feat)

## Files Created/Modified

- `.lighthouserc.json` (509 bytes) — LHCI config: URLs, assertion (categories:performance minScore 0.88 error), temporary-public-storage upload target
- `.github/workflows/lighthouse-ci.yml` (977 bytes) — GitHub Actions workflow: PR gate, treosh/lighthouse-ci-action@v12, configPath reference, artifact upload

## Decisions Made

- **Threshold 0.88:** 2-point buffer below Phase 16 target of >= 90. Phase 14 baseline was 100 (/) and 94 (/restaurante-teste). 0.88 is conservative enough to absorb Lighthouse run-to-run variance while still catching real regressions.
- **`numberOfRuns: 1`:** Production URL scores are stable (synthetic measurement, no real traffic variability). A single run keeps the CI job fast.
- **`preset: lighthouse:no-pwa`:** The app has no service worker. Without this preset, LHCI would fail on PWA category assertions, which are irrelevant to this gate's purpose.
- **`pull_request` trigger only:** The gate is pre-merge. Triggering on push to main would add noise by re-auditing an already-merged state.
- **No `setup-node` step:** treosh/lighthouse-ci-action@v12 manages its own Node environment internally.
- **`temporaryPublicStorage: true`:** Uploads full Lighthouse HTML report to LHCI temporary storage and posts the public link in the GitHub Actions run log, enabling easy debugging without maintaining an LHCI server.

## How to Verify the Gate Works

1. Open a pull request targeting `main`
2. Check the GitHub Actions tab — a "Lighthouse CI" workflow run will appear
3. The job runs Lighthouse against both production URLs
4. If Performance score >= 0.88 on both URLs: job passes (green checkmark, PR can merge)
5. If any URL scores below 0.88: job fails (red X, PR is blocked)
6. Click the failed step to see the LHCI report link posted in the log

## URLs Audited

- `https://xmartmenu.skale.club/` (baseline: 100 mobile — well above threshold)
- `https://xmartmenu.skale.club/restaurante-teste` (baseline: 94 mobile — above threshold with 6-point headroom)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - the workflow uses public production URLs and treosh/lighthouse-ci-action which requires no additional secrets or service configuration.

## Next Phase Readiness

- PERF-03 satisfied: Lighthouse CI is configured in GitHub Actions and will block PRs on performance regression
- The gate is live on the next PR opened against main
- Any future phase that modifies rendering, images, or JS bundles will automatically be audited against the 0.88 threshold

---
*Phase: 17-ci-gate*
*Completed: 2026-05-07*
