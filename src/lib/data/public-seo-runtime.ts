import { ownedAdminTransaction } from './admin-menus-runtime'
import { readOgTenant, readPlatformBlogSitemap, readSeoTenant, readSitemapTenants, readTenantSitemapEntries } from './public-seo'

export const ownedSitemapTenants = () => ownedAdminTransaction(false, readSitemapTenants)
export const ownedPlatformBlogSitemap = () => ownedAdminTransaction(false, query => readPlatformBlogSitemap(query))
export const ownedOgTenant = (slug: string) => ownedAdminTransaction(false, query => readOgTenant(query, slug))
/** One snapshot for the tenant row and its sitemap entries. */
export const ownedTenantSitemap = (slug: string) => ownedAdminTransaction(false, async query => {
  const tenant = await readSeoTenant(query, slug)
  return tenant ? { tenant, ...(await readTenantSitemapEntries(query, tenant.id)) } : null
})
export const ownedRobotsTenant = (slug: string) => ownedAdminTransaction(false, query => readSeoTenant(query, slug))
