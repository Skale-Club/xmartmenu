# Requirements

**Project:** xmartmenu
**Last updated:** 2026-05-05

## v1 Requirements

### Performance

- [x] **PERF-01**: Public menu page (/{slug}/{menuSlug}) loads with TTFB < 500ms on warm Vercel
- [x] **PERF-02**: Public menu JS bundle does not include admin-only code (Supabase browser client isolated)
- [x] **PERF-03**: Public menu pages use ISR/revalidate instead of force-dynamic (menu data cached up to 60s)
- [x] **PERF-04**: Root redirect (/) is statically generated, not force-dynamic
- [x] **PERF-05**: Polyfill bundle reduced by targeting modern browsers (browserslist)
- [x] **PERF-06**: generateMetadata and page render share tenant/menu data (no duplicate DB queries per request)
- [x] **PERF-07**: Tenant + menu queries run in parallel where tenant_id is not required for menu lookup

### Security (from CONCERNS.md — HIGH priority)

- [x] **SEC-01**: Orders table INSERT policy validates tenant context (not WITH CHECK (true))
- [x] **SEC-02**: must_change_password enforced at API layer, not only middleware UI redirect
- [x] **SEC-03**: Uniform auth middleware pattern across all API routes (assertRole helper)

### CI/CD

- [x] **CI-01**: PR gate: lint (eslint) + build (next build) must pass before merge
- [x] **CI-02**: TypeScript errors block CI

## v2 Requirements (deferred)

- Bundle size budget enforced in CI (lighthouse-ci or bundlesize)
- Real-user metrics (Vercel Speed Insights)
- DB EXPLAIN ANALYZE on hot queries (menu fetch, staff list)
- E2E tests for critical flows (onboarding, menu display, order placement)
- Playwright test suite for tenant isolation

## Out of Scope

- Full test coverage — deferred, high effort, no existing infra
- Supabase realtime subscriptions — not needed for current feature set
- Edge runtime for admin routes — server-side auth is fine there

## Traceability

| REQ-ID | Phase | Status |
|---|---|---|
| PERF-01 | Phase 1 — Performance | Complete |
| PERF-02 | Phase 1 — Performance | Complete |
| PERF-03 | Phase 1 — Performance | Complete |
| PERF-04 | Phase 1 — Performance | Complete |
| PERF-05 | Phase 1 — Performance | Complete |
| PERF-06 | Phase 1 — Performance | Complete |
| PERF-07 | Phase 1 — Performance | Complete |
| SEC-01 | Phase 2 — Security | Complete |
| SEC-02 | Phase 2 — Security | Complete |
| SEC-03 | Phase 2 — Security | Complete |
| CI-01 | Phase 3 — CI/CD | Complete |
| CI-02 | Phase 3 — CI/CD | Complete |
