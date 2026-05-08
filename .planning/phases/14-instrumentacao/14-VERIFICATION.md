---
phase: 14-instrumentacao
verified: 2026-05-07T00:00:00Z
status: gaps_found
score: 3/4 success criteria verified
gaps:
  - truth: "Core Web Vitals are readable by route with real production traffic data"
    status: partial
    reason: "ROADMAP SC-1 requires real production traffic data from Vercel Speed Insights. 14-BASELINE.md explicitly documents 'No real-traffic data — no p75 CWV data available'. PageSpeed Insights synthetic Lighthouse was used instead. The data is documented but does not satisfy the literal criterion."
    artifacts:
      - path: ".planning/phases/14-instrumentacao/14-BASELINE.md"
        issue: "Lighthouse Scores section documents PSI synthetic data; Speed Insights row states no real-traffic data available"
    missing:
      - "Either: Vercel Speed Insights p75 CWV data by route once real traffic accumulates, OR: an explicit project decision downgrading SC-1 to accept synthetic PSI as sufficient (equivalent to the PERF-02 deferral decision)"
  - truth: "Supabase query timing is visible for the three critical paths"
    status: partial
    reason: "Probes were deployed (commit 070cefa) and removed (commit 3f2d449) without reading values. All 7 timing rows in 14-BASELINE.md are N/A deferred. PERF-02 in REQUIREMENTS.md remains unchecked [ ] on disk — the commit that marked it complete (cee005e) is not present on the current HEAD (1fe2be0)."
    artifacts:
      - path: ".planning/phases/14-instrumentacao/14-BASELINE.md"
        issue: "Supabase Query Timing section: all 7 rows show N/A with 'Deferred' note"
      - path: ".planning/REQUIREMENTS.md"
        issue: "PERF-02 shows '[ ] Pending' and '| PERF-02 | Phase 14 | Pending |' — requirements update commit cee005e is not on main HEAD"
    missing:
      - "Either: actual timing values captured from Vercel logs (re-run Plan 02 or accept N/A via explicit decision), OR: merge/cherry-pick cee005e to update REQUIREMENTS.md to reflect the accepted deferral"
  - truth: "REQUIREMENTS.md traceability table reflects phase completion"
    status: failed
    reason: "Current HEAD (1fe2be0) REQUIREMENTS.md shows PERF-01 = Pending, PERF-02 = Pending. The commit that updated those fields (cee005e) exists in git history but is not reachable from main HEAD. This is a documentation consistency gap — the file on disk contradicts what was claimed as complete."
    artifacts:
      - path: ".planning/REQUIREMENTS.md"
        issue: "Lines 5, 6, 38, 39: PERF-01 and PERF-02 still marked [ ] Pending"
    missing:
      - "Update REQUIREMENTS.md on current branch: mark PERF-01 [x] and PERF-02 [x] (or document explicitly that PERF-02 was accepted as N/A deferred)"
human_verification:
  - test: "Vercel Speed Insights real-traffic data"
    expected: "Once the app accumulates production traffic, Vercel Speed Insights should show p75 LCP, CLS, INP per route. Check the Speed Insights tab in the Vercel dashboard."
    why_human: "Requires real user traffic and Vercel dashboard access — cannot verify programmatically"
---

# Phase 14: Instrumentacao Verification Report

**Phase Goal:** Real performance data is visible and actionable before any optimization work begins
**Verified:** 2026-05-07
**Status:** gaps_found
**Re-verification:** No — initial verification

---

## Goal Achievement

### Success Criteria (from ROADMAP.md)

| # | Success Criterion | Status | Evidence |
|---|------------------|--------|----------|
| SC-1 | CWV readable by route in Vercel Speed Insights with real production traffic data | PARTIAL | 14-BASELINE.md documents PSI synthetic data — Speed Insights row states "No real-traffic data" |
| SC-2 | Bundle analysis generated — top 3 largest chunks identified with lazy-load notes | VERIFIED | Top 5 chunks documented in 14-BASELINE.md and 14-01-SUMMARY.md with full lazy-load rationale |
| SC-3 | Supabase query timing visible for 3 critical paths | PARTIAL | Probes deployed then removed; all 7 timing values are N/A deferred in 14-BASELINE.md |
| SC-4 | Written baseline note records scores/timings for Phase 15/16 comparison | VERIFIED | 14-BASELINE.md exists, committed (88fd231), all four sections present, no placeholder brackets |

**Score:** 2/4 success criteria fully verified (2 partial gaps, 2 fully verified)

---

### Observable Truths (from Plan must_haves)

**Plan 01 truths (FE-03):**

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Bundle analysis report generated | VERIFIED | .next/analyze/ reports generated via `ANALYZE=true npm run build --webpack`; client.html, edge.html, nodejs.html produced |
| 2 | Top 5 largest chunks identified by name and size in KB | VERIFIED | 14-01-SUMMARY.md and 14-BASELINE.md both contain complete top-5 table with chunk names and sizes |
| 3 | Each chunk marked as lazy-load candidate yes/no with rationale | VERIFIED | All 5 chunks have lazy-load candidacy and rationale; chunk 5536 (170 KB) is the only YES |

**Plan 02 truths (PERF-02):**

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 4 | console.time() probes added to 3 critical server-side paths | VERIFIED | commit 070cefa: 14 lines added across 3 files (4+4+6) |
| 5 | Probed code deployed to production and Vercel logs show timing | VERIFIED (infrastructure) | commit 070cefa pushed to main, Vercel deploy triggered; probes were live |
| 6 | Timing values for all 3 paths recorded before probe removal | FAILED | User chose not to read Vercel logs; all values remain unrecorded |
| 7 | Probes fully removed — no console.time() in production code | VERIFIED | commit 3f2d449 removes all 14 probe lines; grep confirms zero remaining PERF-PROBE or console.time lines |

**Plan 03 truths (PERF-01, FE-03, PERF-02):**

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 8 | 14-BASELINE.md exists with Lighthouse mobile scores for 2 routes | VERIFIED | File exists; "## Lighthouse Scores" section present; / = 100 and /{slug} = 94 documented |
| 9 | 14-BASELINE.md contains bundle chunk table with top 5, KB sizes, lazy-load | VERIFIED | "## Bundle Analysis" section present with full table |
| 10 | 14-BASELINE.md contains Supabase query timing for all measured paths | PARTIAL | Section present but all 7 values are N/A deferred — no actual timing data |
| 11 | 14-BASELINE.md committed and readable by Phase 15 and 16 planners | VERIFIED | commit 88fd231; file complete, no placeholder brackets, actionable targets documented for both phases |

**Score:** 8/11 truths verified, 2 partial, 1 failed

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `.next/analyze/client.html` | Client bundle treemap | NOT ON DISK (acceptable) | Generated during analysis build but not committed to git (correct — build artifacts excluded by .gitignore). Evidence: commit db7126d confirms successful build. Reports existed at generation time. |
| `.next/analyze/edge.html` | Edge bundle treemap | NOT ON DISK (acceptable) | Same as above — generated, not committed |
| `src/app/(public)/[slug]/[menuSlug]/page.tsx` | Probes added then removed | VERIFIED | Zero PERF-PROBE or console.time lines; git log confirms add (070cefa) and remove (3f2d449) |
| `src/app/(public)/[slug]/page.tsx` | Probes added then removed | VERIFIED | Same as above |
| `src/app/api/orders/route.ts` | Probes added then removed | VERIFIED | Same as above |
| `.planning/phases/14-instrumentacao/14-BASELINE.md` | Authoritative pre-optimization baseline | VERIFIED | Exists, substantive (163 lines, 4 sections), committed, no stubs |
| `next.config.ts` | Bundle analyzer wired | VERIFIED | `withBundleAnalyzer({ enabled: process.env.ANALYZE === "true", openAnalyzer: false })` confirmed |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `next.config.ts` | `@next/bundle-analyzer` | `withBundleAnalyzer({ enabled: process.env.ANALYZE === "true" })` | VERIFIED | Lines 2, 16-18 of next.config.ts confirm wiring |
| `console.time probes` | Vercel function logs | server-side stdout captured by Vercel runtime | VERIFIED (infrastructure) | Probes deployed in 070cefa; infrastructure was correct. No timing values captured (user decision). |
| `14-BASELINE.md` | Phase 15 planner | `read_first` in 15-01-PLAN.md | UNVERIFIABLE | Phase 15 directory does not exist yet — cannot check. Expected future state. |
| `14-BASELINE.md` | Phase 16 planner | `read_first` in 16-01-PLAN.md | UNVERIFIABLE | Phase 16 directory does not exist yet — cannot check. Expected future state. |

---

### Data-Flow Trace (Level 4)

Not applicable — Phase 14 produces planning artifacts (14-BASELINE.md) and infrastructure changes (probe add/remove), not dynamic UI components rendering live data. No data-flow trace needed.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Bundle analyzer wired in next.config.ts | `grep -n "withBundleAnalyzer" next.config.ts` | Lines 2 and 16 confirmed | PASS |
| No console.time probes in production code | `grep -rn "PERF-PROBE\|console\.time" src/` | Zero matches | PASS |
| 14-BASELINE.md has all required sections | `grep "## Lighthouse\|## Bundle\|## Supabase\|## Phase 15" 14-BASELINE.md` | All 4 sections found | PASS |
| 14-BASELINE.md has no placeholder brackets | `grep "\[N\]\|\[NN\]\|PENDING\|placeholder" 14-BASELINE.md` | Zero matches | PASS |
| Probe add commit exists | `git show 070cefa --stat` | +14 lines across 3 files confirmed | PASS |
| Probe removal commit exists | `git show 3f2d449 --stat` | -14 lines across 3 files confirmed | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| PERF-01 | 14-03 | CWV visíveis por rota no Vercel Speed Insights com dados de produção reais | PARTIAL | PSI synthetic Lighthouse documented; no real Speed Insights traffic data. REQUIREMENTS.md shows [ ] Pending on disk (cee005e not on main HEAD). |
| PERF-02 | 14-02, 14-03 | Queries críticas do Supabase têm timing logado e visível para análise | PARTIAL | Infrastructure deployed and removed; all timing values N/A deferred. REQUIREMENTS.md shows [ ] Pending on disk. |
| FE-03 | 14-01, 14-03 | Bundle analysis identifica maiores chunks e oportunidades de lazy loading | SATISFIED | Top 5 chunks identified; 14-BASELINE.md documents chunk 5536 as only lazy-load candidate. REQUIREMENTS.md shows [x] Complete. |

**REQUIREMENTS.md discrepancy:** The commit `cee005e` (which updated PERF-01 to [x] and PERF-02 to [x]) is in git history but NOT on the current HEAD (`1fe2be0`). The current disk state shows PERF-01 = Pending and PERF-02 = Pending. The traceability table is incomplete.

---

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `.planning/REQUIREMENTS.md` | PERF-01 and PERF-02 show `[ ] Pending` while Phase 14 is claimed complete | Warning | Downstream phases reading REQUIREMENTS.md will see inaccurate status. Not a runtime blocker. |
| `.planning/phases/14-instrumentacao/14-BASELINE.md` | All 7 Supabase timing rows show "N/A — Deferred" | Warning | Phase 15 must proceed without query wall-clock timing. Documented in baseline as acceptable. Phase 15 guidance (use EXPLAIN ANALYZE) is present and actionable. |

No runtime/production stubs found. No TODO/FIXME/placeholder patterns in production code. No console.time lines remain.

---

### Human Verification Required

#### 1. Vercel Speed Insights Real-Traffic Data

**Test:** Visit the Vercel dashboard > xmartmenu project > Speed Insights tab. Check whether p75 LCP, CLS, and INP data is available per route (e.g., `/`, `/{slug}`, `/{slug}/{menuSlug}`).
**Expected:** Either real CWV data is now visible (PERF-01 satisfied as originally written), or confirm the project decision to accept PSI synthetic Lighthouse as the baseline substitute.
**Why human:** Requires Vercel dashboard access and production traffic accumulation — not checkable from code.

#### 2. PERF-02 Acceptance Decision

**Test:** Decide whether "timing visible" is satisfied by the probe infrastructure (deployed-and-removed cycle) or requires actual captured values.
**Expected:** Either re-run Plan 02 to capture actual ms values, or explicitly downgrade PERF-02 to "accepted as N/A — EXPLAIN ANALYZE is the Phase 15 signal."
**Why human:** This is a product/team decision about what constitutes sufficient timing instrumentation.

---

### Gaps Summary

Three gaps require attention before Phase 14 can be considered fully closed:

**Gap 1 — SC-1 / PERF-01 (Partial):** The ROADMAP success criterion specifies "real production traffic data" from Vercel Speed Insights. What was captured is PageSpeed Insights synthetic Lighthouse. The data is useful and documented, but it does not technically satisfy the criterion as written. Resolution: either accept PSI as equivalent (requires explicit decision), or wait until Speed Insights accumulates real-user p75 data and update 14-BASELINE.md.

**Gap 2 — SC-3 / PERF-02 (Partial):** All 7 Supabase timing rows in 14-BASELINE.md are N/A deferred. The probe infrastructure was correct (deploy + remove confirmed in git), but no timing values were read. 14-BASELINE.md's Supabase Query Timing section is structurally present but content-empty. Phase 15 will use EXPLAIN ANALYZE instead (documented as acceptable), but PERF-02 as written requires timing to be "visible for bottleneck analysis." Resolution: same options — accept deferral explicitly or re-run probes.

**Gap 3 — REQUIREMENTS.md out of sync (Minor):** The commit that updated PERF-01 and PERF-02 to Complete on REQUIREMENTS.md (cee005e) is not on the current main branch HEAD. REQUIREMENTS.md on disk still shows both as Pending. This is a documentation accuracy issue. Resolution: apply the REQUIREMENTS.md changes (mark PERF-01 [x] and PERF-02 [x] with a note that PERF-02 timing was deferred).

**Root cause:** Gaps 1 and 2 share the same root cause — the user chose not to read Vercel logs during Plan 02 execution, and the Vercel Speed Insights dashboard had no real-traffic data yet. Both were documented as acceptable deferrals in 14-03-SUMMARY.md, but the ROADMAP success criteria were not updated to reflect those decisions.

**What IS working:** FE-03 is fully satisfied. 14-BASELINE.md is substantive, actionable, and provides Phase 15 and 16 planners with clear optimization targets (LCP 3.0s, 889 KB image issue, chunk 5536). Production code is clean — zero timing probes remain. The core goal of "real performance data visible and actionable" is substantially achieved for Lighthouse scores and bundle analysis.

---

_Verified: 2026-05-07_
_Verifier: Claude (gsd-verifier)_
