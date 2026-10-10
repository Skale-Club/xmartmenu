import type { MetadataRoute } from 'next'
import { PLATFORM_BASE } from '@/lib/seo'

// Platform-host robots.txt. Custom domains are rewritten by the middleware to
// the per-tenant `/[slug]/robots.txt` route, so this file only governs the
// platform domain itself.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/admin',
          '/superadmin',
          '/dashboard',
          '/settings',
          '/menu',
          '/menus',
          '/orders',
          '/tenants',
          '/overview',
          '/users',
          '/onboarding',
          '/auth',
        ],
      },
    ],
    sitemap: `${PLATFORM_BASE}/sitemap.xml`,
  }
}
