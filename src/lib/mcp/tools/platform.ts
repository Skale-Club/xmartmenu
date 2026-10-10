import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createServiceClient } from '@/lib/supabase/server'
import { errorResult, jsonResult, logMcpMutation } from '../helpers'

/** Read tool for the single platform_settings row. Mirrors GET /api/superadmin/settings. */
export function registerPlatformReadTools(server: McpServer): void {
  server.registerTool(
    'get_platform_settings',
    {
      title: 'Configurações da plataforma',
      description:
        'Retorna as configurações globais da plataforma (nome, marca, cores default, CTA, landing, SEO, favicon).',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const service = createServiceClient()
      const { data, error } = await service.from('platform_settings').select('*').maybeSingle()
      if (error) return errorResult(`Erro ao buscar platform_settings: ${error.message}`)
      return jsonResult(data ?? {})
    },
  )
}

/** Write tool for platform_settings. Mirrors PATCH /api/superadmin/settings. */
export function registerPlatformWriteTools(server: McpServer): void {
  server.registerTool(
    'update_platform_settings',
    {
      title: 'Atualizar configurações da plataforma',
      description:
        'Upsert do platform_settings (nome do app, marca, cores default, CTA, rodapé, landing, SEO, favicon). Só os campos enviados mudam. Caches de página revalidam no TTL normal.',
      inputSchema: {
        settings: z
          .object({
            app_name: z.string(),
            brand_name: z.string(),
            default_primary_color: z.string(),
            default_accent_color: z.string(),
            cta_color: z.string(),
            menu_footer_brand: z.string(),
            landing: z.any(),
            seo_title: z.string().nullable(),
            seo_description: z.string().nullable(),
            favicon_url: z.string().nullable(),
          })
          .partial()
          .describe('Campos de platform_settings a alterar'),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ settings }, extra) => {
      const update = { ...settings } as Record<string, unknown>
      if (Object.keys(update).length === 0) return errorResult('Nada para atualizar.')

      const service = createServiceClient()
      const { data: existing } = await service.from('platform_settings').select('id').maybeSingle()

      const result = existing
        ? await service.from('platform_settings').update(update).eq('id', existing.id).select().single()
        : await service.from('platform_settings').insert(update).select().single()

      if (result.error) return errorResult(`Erro ao atualizar platform_settings: ${result.error.message}`)
      logMcpMutation('update_platform_settings', extra, { keys: Object.keys(update) })
      return jsonResult(result.data)
    },
  )
}
