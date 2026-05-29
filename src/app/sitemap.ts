import type { MetadataRoute } from 'next'
import { createServiceClient } from '@/lib/supabase/server'
import { PLATFORM_BASE } from '@/lib/seo'

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

  return entries
}
