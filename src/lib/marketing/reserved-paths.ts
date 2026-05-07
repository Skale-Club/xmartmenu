/**
 * Reserved slugs that tenants cannot register.
 * Used in:
 *   - src/middleware.ts (blocks reserved-slug paths from reaching tenant routes)
 *   - src/app/api/onboarding/route.ts (rejects reserved slugs at registration)
 */
export const RESERVED_PATHS = new Set([
  'pricing', 'features', 'about', 'faq', 'blog', 'demo', 'help', 'support',
  'pt', 'en', 'legal', 'privacy', 'terms', 'contact', 'careers',
  'auth', 'api', 'onboarding', 'dashboard', 'menu', 'settings',
  'overview', 'tenants', 'users', 'admin', 'superadmin',
  'sitemap', 'robots',
])
