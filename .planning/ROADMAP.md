# Roadmap

**Project:** xmartmenu
**Milestone:** M1 — Foundation hardening (performance + security + CI)
**Created:** 2026-05-05

## Overview

| # | Phase | Goal | Requirements | Status |
|---|---|---|---|---|
| 1 | Performance | 1/2 | In Progress|  |
| 2 | Security | Fix HIGH issues from audit | SEC-01–03 | 🔲 Not started |
| 3 | CI/CD | No broken builds on main | CI-01–02 | 🔲 Not started |

---

## Phase 1: Performance

**Goal:** The public menu page loads noticeably faster — JS bundle shrinks, DB queries are cached and parallelized, no admin code ships to public visitors.

**Requirements:** PERF-01, PERF-02, PERF-03, PERF-04, PERF-05, PERF-06, PERF-07

**Plans:** 1/2 plans executed

**Success criteria:**
1. `force-dynamic` removed from public routes — pages use ISR with 60s revalidate
2. Root page (/) is static — no server work on a redirect
3. `browserslist` targets modern browsers — polyfill chunk visibly smaller in analyzer
4. `generateMetadata` and page render share data via React `cache()` — only 1 tenant query per request instead of 2
5. Tenant + menu fetched in parallel — saves 1 round-trip per page load
6. Before/after bundle analysis shows public menu route does not include Supabase browser client

Plans:
- [ ] 01-01-PLAN.md — Public route caching + query optimization (revalidate=60, React cache(), parallel fetch)
- [x] 01-02-PLAN.md — browserslist field in package.json to reduce polyfill bundle

---

## Phase 2: Security

**Goal:** The three HIGH security issues from the codebase audit are closed.

**Requirements:** SEC-01, SEC-02, SEC-03

**Success criteria:**
1. Orders INSERT policy rejects requests without valid tenant context
2. API routes block requests from users with must_change_password=true
3. All API routes use the same auth assertion helper

**Plans:**
- Plan 2.1: Fix orders RLS INSERT policy
- Plan 2.2: Enforce must_change_password at API layer
- Plan 2.3: Unify auth middleware across API routes

---

## Phase 3: CI/CD

**Goal:** Broken code cannot land on main — lint and build are gated on every PR.

**Requirements:** CI-01, CI-02

**Success criteria:**
1. GitHub Actions workflow runs `npm run lint` and `npm run build` on every PR
2. TypeScript errors fail the CI run
3. Workflow passes on current main branch

**Plans:**
- Plan 3.1: Add lint + build GitHub Actions workflow

---

## Seeds (future milestones)

See `.planning/seeds/` for the 5 planted seeds awaiting the right milestone:
- SEED-001: AI-powered tenant onboarding
- SEED-002: Customer order system (cart + addons)
- SEED-003: Stripe Connect payments
- SEED-004: Full performance milestone (this M1 Phase 1 is the start)
- SEED-005: Marketing landing page
