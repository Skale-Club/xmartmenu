import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createServiceClient } from '@/lib/supabase/server'
import { errorResult, jsonResult, logMcpMutation, resolveTenantId } from '../helpers'

const HEX = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const HTTPS = /^https:\/\//

/**
 * Write tools for per-tenant branding + SEO. Mirrors PATCH /api/admin/branding
 * and /api/admin/seo (same validation), scoped to an explicit tenant.
 */
export function registerBrandingWriteTools(server: McpServer): void {
  server.registerTool(
    'update_branding',
    {
      title: 'Atualizar branding do tenant',
      description:
        'Atualiza cores (hex), logo/banner (https ou null), redes e toggles de pedido de um tenant. Upsert em tenant_settings.',
      inputSchema: {
        tenant: z.string().min(1).describe('id ou slug do tenant'),
        primary_color: z.string().describe('cor hex, ex. #RRGGBB'),
        accent_color: z.string().describe('cor hex, ex. #RRGGBB'),
        logo_url: z.string().nullable().optional().describe('https URL ou null'),
        banner_url: z.string().nullable().optional().describe('https URL ou null'),
        instagram: z.string().nullable().optional(),
        whatsapp: z.string().nullable().optional(),
        tagline: z.string().nullable().optional(),
        whatsapp_orders_enabled: z.boolean().optional(),
        orders_enabled: z.boolean().optional(),
        direct_orders_enabled: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ tenant, primary_color, accent_color, logo_url, banner_url, instagram, whatsapp, tagline, whatsapp_orders_enabled, orders_enabled, direct_orders_enabled }, extra) => {
      const service = createServiceClient()
      const tenantId = await resolveTenantId(service, tenant)
      if (!tenantId) return errorResult(`Tenant não encontrado: ${tenant}`)

      for (const [k, v] of [['primary_color', primary_color], ['accent_color', accent_color]] as const) {
        if (typeof v !== 'string' || !HEX.test(v.trim())) return errorResult(`${k} inválido (esperado hex).`)
      }
      const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : null)
      const asset = (v: string | null | undefined, key: string): string | null | { err: string } => {
        if (v === null || v === undefined || v === '') return null
        if (!HTTPS.test(v)) return { err: `${key} deve ser uma URL https ou null.` }
        return v
      }
      const logo = asset(logo_url, 'logo_url')
      if (logo && typeof logo === 'object') return errorResult(logo.err)
      const banner = asset(banner_url, 'banner_url')
      if (banner && typeof banner === 'object') return errorResult(banner.err)

      const update: Record<string, unknown> = {
        tenant_id: tenantId,
        primary_color: primary_color.trim(),
        accent_color: accent_color.trim(),
        instagram: str(instagram, 64),
        whatsapp: str(whatsapp, 32),
        tagline: str(tagline, 120),
        logo_url: logo as string | null,
        banner_url: banner as string | null,
      }
      if (whatsapp_orders_enabled !== undefined) update.whatsapp_orders_enabled = whatsapp_orders_enabled === true
      if (orders_enabled !== undefined) update.orders_enabled = orders_enabled === true
      if (direct_orders_enabled !== undefined) update.direct_orders_enabled = direct_orders_enabled === true

      const { error } = await service.from('tenant_settings').upsert(update, { onConflict: 'tenant_id' })
      if (error) return errorResult(`Erro ao atualizar branding: ${error.message}`)
      logMcpMutation('update_branding', extra, { tenantId })
      return jsonResult({ ok: true, tenant_id: tenantId })
    },
  )

  server.registerTool(
    'update_seo',
    {
      title: 'Atualizar SEO do tenant',
      description:
        'Atualiza os overrides de SEO de um tenant (title<=70, description<=200, keywords<=300, og_image https, noindex). Strings vazias viram null.',
      inputSchema: {
        tenant: z.string().min(1).describe('id ou slug do tenant'),
        seo_title: z.string().nullable().optional(),
        seo_description: z.string().nullable().optional(),
        seo_keywords: z.string().nullable().optional(),
        seo_og_image_url: z.string().nullable().optional().describe('https URL ou null'),
        seo_noindex: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ tenant, seo_title, seo_description, seo_keywords, seo_og_image_url, seo_noindex }, extra) => {
      const service = createServiceClient()
      const tenantId = await resolveTenantId(service, tenant)
      if (!tenantId) return errorResult(`Tenant não encontrado: ${tenant}`)

      const str = (v: unknown, max: number): string | null => {
        if (typeof v !== 'string') return null
        const t = v.trim().slice(0, max)
        return t ? t : null
      }
      let ogImage: string | null = null
      if (seo_og_image_url !== null && seo_og_image_url !== undefined && seo_og_image_url !== '') {
        if (!HTTPS.test(seo_og_image_url.trim())) return errorResult('seo_og_image_url deve ser uma URL https ou null.')
        ogImage = seo_og_image_url.trim().slice(0, 2048)
      }

      const update: Record<string, unknown> = {
        tenant_id: tenantId,
        seo_title: str(seo_title, 70),
        seo_description: str(seo_description, 200),
        seo_keywords: str(seo_keywords, 300),
        seo_og_image_url: ogImage,
        seo_noindex: seo_noindex === true,
      }
      const { error } = await service.from('tenant_settings').upsert(update, { onConflict: 'tenant_id' })
      if (error) return errorResult(`Erro ao atualizar SEO: ${error.message}`)
      logMcpMutation('update_seo', extra, { tenantId })
      return jsonResult({ ok: true, tenant_id: tenantId })
    },
  )
}
