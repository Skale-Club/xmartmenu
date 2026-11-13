import type { MetadataRoute } from 'next'
import { createServiceClient } from '@/lib/supabase/server'
import { PLATFORM_BASE, tenantOwnHost } from '@/lib/seo'
import { scopeFilter } from '@/lib/blog/scope'
import { listArchive, listTags } from '@/lib/blog/public-queries'
import {nativeBlogSelected} from '@/lib/blog/native/selected'
import {nativePlatformSitemap} from '@/lib/blog/native/sitemap'
import { ownedModeActive } from '@/lib/data/owned-mode'

// Regenerate at most every 5 minutes (active tenants change rarely).
export const revalidate = 300

// SEED-014: platform sitemap lists the marketing landing plus every active
// tenant's platform-slug menu. Tenants with a *verified custom domain* are
// excluded here — their canonical home lives on their own domain (which serves
// its own sitemap), and the platform-slug copy is intentionally noindexed.
// Own PostgreSQL only; each part degrades on its own and never reads Supabase.
async function ownedSitemap(entries: MetadataRoute.Sitemap): Promise<MetadataRoute.Sitemap> {
  const runtime = await import('@/lib/data/public-seo-runtime')
  try {
    for (const t of await runtime.ownedSitemapTenants()) {
      // A restaurant on its own host (custom domain or subdomain) serves its own sitemap there.
      if (tenantOwnHost(t)) continue
      entries.push({ url: `${PLATFORM_BASE}/${t.slug}`, lastModified: t.updated_at ? new Date(t.updated_at) : new Date(), changeFrequency: 'weekly', priority: 0.8 })
    }
  } catch {}
  try {
    const blog = await runtime.ownedPlatformBlogSitemap()
    entries.push({ url: `${PLATFORM_BASE}/blog`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.7 })
    for (const tag of blog.tags) entries.push({ url: `${PLATFORM_BASE}/blog/tag/${tag}`, changeFrequency: 'weekly', priority: 0.5 })
    for (const year of new Set(blog.archive.map(e => e.year))) entries.push({ url: `${PLATFORM_BASE}/blog/archive/${year}`, changeFrequency: 'monthly', priority: 0.4 })
    for (const e of blog.archive) entries.push({ url: `${PLATFORM_BASE}/blog/archive/${e.year}/${String(e.month).padStart(2, '0')}`, changeFrequency: 'monthly', priority: 0.3 })
    for (const post of blog.posts) entries.push({ url: `${PLATFORM_BASE}/blog/${post.slug}`,
      lastModified: new Date(post.updated_at ?? post.published_at ?? Date.now()), changeFrequency: 'monthly', priority: 0.6 })
  } catch {}
  return entries
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if(nativeBlogSelected())return nativePlatformSitemap()
  const entries: MetadataRoute.Sitemap = [
    {
      url: PLATFORM_BASE,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
    { url: `${PLATFORM_BASE}/pricing`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
  ]

  if (ownedModeActive()) return ownedSitemap(entries)

  try {
    const supabase = createServiceClient()
    const { data: tenants } = await supabase
      .from('tenants')
      .select('slug, updated_at, custom_domain, custom_domain_verified')
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(5000)

    for (const t of tenants ?? []) {
      if (t.custom_domain && t.custom_domain_verified) continue
      entries.push({
        url: `${PLATFORM_BASE}/${t.slug}`,
        lastModified: t.updated_at ? new Date(t.updated_at) : new Date(),
        changeFrequency: 'weekly',
        priority: 0.8,
      })
    }
  } catch {
    // Sitemap must never 500 the whole route — fall back to the landing entry.
  }

  // Auto-blog parity XM-03: the platform's own blog. A separate try/catch so a
  // blog read failing cannot cost us the tenant entries above, and vice versa —
  // the whole point of a sitemap is that it degrades rather than disappears.
  try {
    const supabase = createServiceClient()
    entries.push({
      url: `${PLATFORM_BASE}/blog`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.7,
    })

    // Escopo da PLATAFORMA. Era a pior das três fugas: o sitemap da Xprout
    // listaria os posts de cada restaurante sob URLs da plataforma — a pedir a
    // indexação de páginas que não existem lá.
    const { data: posts } = await scopeFilter(supabase.from('blog_posts').select('slug, published_at, updated_at'), null)
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(1000)

    // As etiquetas e os arquivos que EXISTEM — a lista vem da contagem, nunca
    // de um ciclo de 1 a 12. O sitemap não pode prometer páginas que dão 404.
    const [platformTags, platformArchive] = await Promise.all([
      listTags(supabase, null).catch(() => []),
      listArchive(supabase, null).catch(() => []),
    ])

    for (const tag of platformTags) {
      entries.push({
        url: `${PLATFORM_BASE}/blog/tag/${tag.slug}`,
        changeFrequency: 'weekly',
        priority: 0.5,
      })
    }
    for (const year of new Set(platformArchive.map((e) => e.year))) {
      entries.push({
        url: `${PLATFORM_BASE}/blog/archive/${year}`,
        changeFrequency: 'monthly',
        priority: 0.4,
      })
    }
    for (const entry of platformArchive) {
      entries.push({
        url: `${PLATFORM_BASE}/blog/archive/${entry.year}/${String(entry.month).padStart(2, '0')}`,
        changeFrequency: 'monthly',
        priority: 0.3,
      })
    }

    for (const post of posts ?? []) {
      entries.push({
        url: `${PLATFORM_BASE}/blog/${post.slug}`,
        lastModified: post.updated_at
          ? new Date(post.updated_at)
          : post.published_at
            ? new Date(post.published_at)
            : new Date(),
        changeFrequency: 'monthly',
        priority: 0.6,
      })
    }
  } catch {
    // Same reasoning as above.
  }

  return entries
}
