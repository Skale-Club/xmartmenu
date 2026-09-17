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
  // O espaço de caminhos é achatado: os grupos de rotas do Next não entram no
  // URL, portanto tudo o que o admin ocupa tem de ser negado a um slug de
  // restaurante, ou a rota estática engole o menu dele. 'posts' é o painel de
  // blog do restaurante — ficaria em /blog se a /blog não fosse já o blog da
  // plataforma, que é um URL de SEO e não se mexe.
  'posts',
  'sitemap', 'robots',
])
