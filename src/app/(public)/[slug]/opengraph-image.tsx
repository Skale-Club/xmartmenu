import { ImageResponse } from 'next/og'
import { createServiceClient } from '@/lib/supabase/server'
import { computePrimaryForeground } from '@/lib/color-utils'
import { getInitials } from '@/lib/utils'

// SEED-014: per-tenant branded Open Graph / Twitter card.
// Rendered at request time and cached by the ISR window below. When a tenant
// sets an explicit seo_og_image_url it is preferred in generateMetadata(); this
// generated card is the high-quality default (logo + name + tagline + brand colors).

export const revalidate = 300
export const alt = 'Digital menu'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = createServiceClient()
  const { data: tenant } = await supabase
    .from('tenants')
    .select('name, tenant_settings(primary_color, accent_color, tagline, logo_url)')
    .eq('slug', slug)
    .eq('is_active', true)
    .single()

  const name = tenant?.name ?? 'Menu'
  const settings = (tenant?.tenant_settings ?? null) as
    | { primary_color?: string; accent_color?: string; tagline?: string | null; logo_url?: string | null }
    | null

  const primary = settings?.primary_color && /^#[0-9a-fA-F]{3,8}$/.test(settings.primary_color)
    ? settings.primary_color
    : '#F52323'
  const foreground = computePrimaryForeground(primary)
  const tagline = settings?.tagline?.trim() || null
  const logoUrl = settings?.logo_url || null

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: primary,
          color: foreground,
          padding: '80px',
          fontFamily: 'sans-serif',
        }}
      >
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={name}
            width={180}
            height={180}
            style={{ width: 180, height: 180, borderRadius: 28, objectFit: 'cover', marginBottom: 40 }}
          />
        ) : (
          <div
            style={{
              width: 180,
              height: 180,
              borderRadius: 28,
              marginBottom: 40,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255,255,255,0.14)',
              fontSize: 80,
              fontWeight: 800,
            }}
          >
            {getInitials(name)}
          </div>
        )}
        <div
          style={{
            fontSize: 76,
            fontWeight: 800,
            letterSpacing: '-2px',
            lineHeight: 1.05,
            textAlign: 'center',
            maxWidth: 980,
          }}
        >
          {name}
        </div>
        {tagline && (
          <div
            style={{
              fontSize: 34,
              fontWeight: 500,
              opacity: 0.85,
              marginTop: 24,
              textAlign: 'center',
              maxWidth: 900,
              lineHeight: 1.35,
            }}
          >
            {tagline.slice(0, 120)}
          </div>
        )}
        <div
          style={{
            marginTop: 56,
            fontSize: 22,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '4px',
            opacity: 0.7,
          }}
        >
          Digital Menu
        </div>
      </div>
    ),
    { ...size }
  )
}
