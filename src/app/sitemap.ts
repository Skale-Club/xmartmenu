import type { MetadataRoute } from 'next'
import { createServiceClient } from '@/lib/supabase/server'
import { PLATFORM_BASE } from '@/lib/seo'
import { scopeFilter } from '@/lib/blog/scope'

// Regenerate at most every 5 minutes (active tenants change rarely).
export const revalidate = 300

// SEED-014: platform sitemap lists the marketing landing plus every active
// tenant's platform-slug menu. Tenants with a *verified custom domain* are
// excluded here — their canonical home lives on their own domain (which serves
// its own sitemap), and the platform-slug copy is intentionally noindexed.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    {
      url: PLATFORM_BASE,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
  ]

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

    // Escopo da PLATAFORMA. Era a pior das três fugas: o sitemap da Xmartmenu
    // listaria os posts de cada restaurante sob URLs da plataforma — a pedir a
    // indexação de páginas que não existem lá.
    const { data: posts } = await scopeFilter(supabase.from('blog_posts'), null)
      .select('slug, published_at, updated_at')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(1000)

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
