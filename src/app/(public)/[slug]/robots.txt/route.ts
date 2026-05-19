import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const revalidate = 300

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const supabase = createServiceClient()

  const { data: tenant } = await supabase
    .from('tenants')
    .select('custom_domain, custom_domain_verified')
    .eq('slug', slug)
    .eq('is_active', true)
    .single()

  // When a custom domain is verified, disallow the platform URL
  // so search engines index only the canonical custom domain.
  const hasCustomDomain = !!(tenant?.custom_domain && tenant?.custom_domain_verified)

  const body = hasCustomDomain
    ? `User-agent: *\nDisallow: /\n`
    : `User-agent: *\nAllow: /\n`

  return new NextResponse(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
