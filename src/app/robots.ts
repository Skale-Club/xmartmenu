import type { MetadataRoute } from 'next'

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
    sitemap: 'https://xmartmenu.skale.club/sitemap.xml',
  }
}
