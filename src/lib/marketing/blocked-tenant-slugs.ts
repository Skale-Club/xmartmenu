/**
 * First path segments that must never be resolved as a tenant slug.
 *
 * INVARIANT: every entry here must have NO named App Router route. Named routes
 * (`auth/`, `api/`, `dashboard/`, `terms/`, …) self-resolve via the file system
 * and never reach `[slug]`, so they must not be listed — middleware blocks this
 * set with a hard 404 *before* file-system routing runs, which would take a real
 * page offline. `scripts/check-blocked-slugs.ts` enforces the invariant in CI.
 *
 * Deliberately NOT unified with `RESERVED_PATHS`: that set stops tenants from
 * *registering* a slug at onboarding and therefore includes every named route.
 * The two have opposite purposes.
 *   - Regression 1 (commit 533cd8b): unified the lists, 404'd every admin/api
 *     URL. Reverted in 5f571ba.
 *   - Regression 2 (this file): `terms`/`privacy` stayed listed after commit
 *     2628a1c added real pages for them, 404'ing both in production.
 *
 * This module intentionally has zero imports so it stays free to pull into the
 * Edge middleware bundle (Phase 12-01 D-26, minimal-imports).
 */
export const BLOCKED_TENANT_SLUGS = new Set([
  'pricing', 'features', 'about', 'faq', 'blog', 'help', 'support',
  'pt', 'en', 'legal', 'contact', 'careers',
])
