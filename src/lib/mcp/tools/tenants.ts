import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createServiceClient } from '@/lib/supabase/server'
import { generatePassword } from '@/lib/auth/password-gen'
import { enqueueXphereSync } from '@/lib/xphere/queue'
import {
  checkDestructiveAllowed,
  errorResult,
  isUuid,
  jsonResult,
  logMcpMutation,
  resolveTenantId,
  textResult,
} from '../helpers'

const HEX = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

// Mirror of the tenant_settings allowlist in the superadmin settings route.
const settingsShape = z
  .object({
    logo_url: z.string().nullable(),
    primary_color: z.string(),
    accent_color: z.string(),
    banner_url: z.string().nullable(),
    address: z.string().nullable(),
    phone: z.string().nullable(),
    instagram: z.string().nullable(),
    whatsapp: z.string().nullable(),
    business_hours: z.any(),
    custom_tags: z.array(z.string()),
    orders_enabled: z.boolean(),
    direct_orders_enabled: z.boolean(),
    currency: z.string(),
    language: z.string(),
    whatsapp_orders_enabled: z.boolean(),
    item_notes_enabled: z.boolean(),
    ingredient_customization_enabled: z.boolean(),
    amber_threshold_minutes: z.number(),
    red_threshold_minutes: z.number(),
    business_type: z.string().nullable(),
    tagline: z.string().nullable(),
    about: z.string().nullable(),
    dine_in_enabled: z.boolean(),
    pickup_enabled: z.boolean(),
    delivery_enabled: z.boolean(),
    pickup_eta_minutes: z.number(),
    delivery_fee_cents: z.number(),
    tips_enabled: z.boolean(),
    tip_percentage_1: z.number(),
    tip_percentage_2: z.number(),
    tip_percentage_3: z.number(),
    table_management_enabled: z.boolean(),
  })
  .partial()

/** Read tools for tenants. Mirrors GET /api/superadmin/tenants + detail routes. */
export function registerTenantReadTools(server: McpServer): void {
  server.registerTool(
    'list_tenants',
    {
      title: 'Listar tenants',
      description:
        'Lista os restaurantes (tenants) da plataforma, mais recentes primeiro. Traz plano, status ativo, domínio customizado e logo.',
      inputSchema: {
        search: z.string().optional().describe('Filtro opcional por nome ou slug (case-insensitive)'),
        limit: z.number().int().min(1).max(500).optional().describe('Máximo (default 100)'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ search, limit }) => {
      const service = createServiceClient()
      let query = service
        .from('tenants')
        .select(
          'id, slug, name, plan, is_active, custom_domain, custom_domain_verified, created_at, tenant_settings(logo_url)',
        )
        .order('created_at', { ascending: false })
        .limit(limit ?? 100)
      if (search) {
        const term = search.replace(/[,()%*]/g, ' ').trim()
        if (term) query = query.or(`name.ilike.%${term}%,slug.ilike.%${term}%`)
      }
      const { data, error } = await query
      if (error) return errorResult(`Erro ao listar tenants: ${error.message}`)
      return jsonResult({ count: data?.length ?? 0, tenants: data })
    },
  )

  server.registerTool(
    'get_tenant',
    {
      title: 'Detalhar tenant',
      description:
        'Detalhe completo de um tenant (id uuid ou slug): dados, tenant_settings e assinatura/plano efetivo.',
      inputSchema: { tenant: z.string().min(1).describe('id (uuid) ou slug do tenant') },
      annotations: { readOnlyHint: true },
    },
    async ({ tenant }) => {
      const service = createServiceClient()
      const column = isUuid(tenant) ? 'id' : 'slug'
      const { data: t, error } = await service
        .from('tenants')
        .select('*, tenant_settings(*)')
        .eq(column, tenant)
        .maybeSingle()
      if (error) return errorResult(`Erro ao buscar tenant: ${error.message}`)
      if (!t) return errorResult(`Tenant não encontrado: ${tenant}`)
      const { data: subscription } = await service
        .from('tenant_subscriptions')
        .select('*, plan:plans(*)')
        .eq('tenant_id', t.id)
        .maybeSingle()
      return jsonResult({ tenant: t, subscription })
    },
  )
}

/** Write tools for tenants (create/update). Mirrors the superadmin routes. */
export function registerTenantWriteTools(server: McpServer): void {
  server.registerTool(
    'create_tenant',
    {
      title: 'Criar tenant',
      description:
        'Cria um novo restaurante (tenant) + tenant_settings + usuário store-admin dono (senha temporária). Retorna as credenciais UMA vez (não recuperável depois).',
      inputSchema: {
        name: z.string().min(1).describe('Nome do restaurante'),
        slug: z.string().min(1).describe('Slug único (usado na URL pública)'),
        email: z.string().email().describe('Email do dono (store-admin)'),
        plan: z.string().optional().describe("Plano legado (free/pro/enterprise). Default 'free'"),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ name, slug, email, plan }, extra) => {
      const service = createServiceClient()

      const { data: existing } = await service.from('tenants').select('id').eq('slug', slug).maybeSingle()
      if (existing) return errorResult(`Slug já existe: ${slug}. Escolha outro.`)

      const { data: tenant, error: tenantError } = await service
        .from('tenants')
        .insert({ name, slug, plan: plan ?? 'free' })
        .select()
        .single()
      if (tenantError || !tenant) return errorResult(`Erro ao criar tenant: ${tenantError?.message}`)

      await service.from('tenant_settings').insert({ tenant_id: tenant.id })

      const tempPassword = generatePassword()
      const { data: userData, error: userError } = await service.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { tenant_id: tenant.id },
      })
      if (userError) {
        await service.from('tenants').delete().eq('id', tenant.id)
        return errorResult(`Erro ao criar usuário dono: ${userError.message}`)
      }
      if (userData.user) {
        await service.from('profiles').upsert({
          id: userData.user.id,
          tenant_id: tenant.id,
          role: 'store-admin',
          must_change_password: true,
          password_changed_at: null,
        })
      }

      logMcpMutation('create_tenant', extra, { name, slug, email })
      return jsonResult({ tenant, credentials: { email, password: tempPassword } })
    },
  )

  server.registerTool(
    'update_tenant',
    {
      title: 'Atualizar tenant',
      description: 'Atualiza campos básicos de um tenant: is_active, plan (legado) e/ou name.',
      inputSchema: {
        tenant: z.string().min(1).describe('id ou slug do tenant'),
        is_active: z.boolean().optional(),
        plan: z.string().optional().describe('Plano legado (free/pro/enterprise)'),
        name: z.string().min(1).optional(),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ tenant, is_active, plan, name }, extra) => {
      const service = createServiceClient()
      const tenantId = await resolveTenantId(service, tenant)
      if (!tenantId) return errorResult(`Tenant não encontrado: ${tenant}`)

      const update: Record<string, unknown> = {}
      if (is_active !== undefined) update.is_active = is_active
      if (plan !== undefined) update.plan = plan
      if (name !== undefined) update.name = name
      if (Object.keys(update).length === 0) return errorResult('Nada para atualizar.')

      const { data, error } = await service.from('tenants').update(update).eq('id', tenantId).select().single()
      if (error) return errorResult(`Erro ao atualizar tenant: ${error.message}`)
      logMcpMutation('update_tenant', extra, { tenantId, update })
      return jsonResult(data)
    },
  )

  server.registerTool(
    'update_tenant_settings',
    {
      title: 'Atualizar settings do tenant',
      description:
        'Upsert de tenant_settings (cores, contato, horários, moeda/idioma, toggles de pedido/entrega/gorjeta, KDS thresholds, etc.). Só os campos enviados são alterados.',
      inputSchema: {
        tenant: z.string().min(1).describe('id ou slug do tenant'),
        settings: settingsShape.describe('Campos de tenant_settings a alterar'),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ tenant, settings }, extra) => {
      const service = createServiceClient()
      const tenantId = await resolveTenantId(service, tenant)
      if (!tenantId) return errorResult(`Tenant não encontrado: ${tenant}`)

      const update = { ...settings } as Record<string, unknown>
      for (const key of ['primary_color', 'accent_color'] as const) {
        if (key in update && (typeof update[key] !== 'string' || !HEX.test((update[key] as string).trim()))) {
          return errorResult(`${key} inválido (esperado hex, ex. #RRGGBB).`)
        }
      }
      if (Object.keys(update).length === 0) return errorResult('Nada para atualizar.')

      const { data, error } = await service
        .from('tenant_settings')
        .upsert({ ...update, tenant_id: tenantId }, { onConflict: 'tenant_id' })
        .select()
        .single()
      if (error) return errorResult(`Erro ao atualizar settings: ${error.message}`)
      logMcpMutation('update_tenant_settings', extra, { tenantId, keys: Object.keys(update) })
      return jsonResult(data)
    },
  )

  server.registerTool(
    'set_chat_addon_override',
    {
      title: 'Override do chat addon',
      description:
        'Força habilitar/desabilitar o chat addon de um tenant, ignorando o plano. true=força ligado, false=força desligado, null=segue o plano.',
      inputSchema: {
        tenant: z.string().min(1).describe('id ou slug do tenant'),
        override: z.union([z.boolean(), z.null()]).describe('true | false | null'),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ tenant, override }, extra) => {
      const service = createServiceClient()
      const tenantId = await resolveTenantId(service, tenant)
      if (!tenantId) return errorResult(`Tenant não encontrado: ${tenant}`)
      const { error } = await service
        .from('tenant_subscriptions')
        .update({ chat_addon_override: override })
        .eq('tenant_id', tenantId)
      if (error) return errorResult(`Erro ao setar override: ${error.message}`)
      logMcpMutation('set_chat_addon_override', extra, { tenantId, override })
      return textResult(`chat_addon_override do tenant ${tenantId} definido como ${String(override)}.`)
    },
  )

  server.registerTool(
    'xphere_resync',
    {
      title: 'Re-sync Xphere CRM',
      description:
        'Re-enfileira um sync completo do Xphere CRM para o tenant (fail-open; no-op se o gate XPHERE_*/QSTASH não estiver configurado).',
      inputSchema: { tenant: z.string().min(1).describe('id ou slug do tenant') },
      annotations: { readOnlyHint: false },
    },
    async ({ tenant }, extra) => {
      const service = createServiceClient()
      const tenantId = await resolveTenantId(service, tenant)
      if (!tenantId) return errorResult(`Tenant não encontrado: ${tenant}`)
      await enqueueXphereSync(tenantId, 'manual')
      logMcpMutation('xphere_resync', extra, { tenantId })
      return textResult(`Re-sync Xphere enfileirado para o tenant ${tenantId}.`)
    },
  )
}

/** Destructive tenant tools (gated). Mirrors DELETE /api/superadmin/tenants/[id]. */
export function registerTenantDestructiveTools(server: McpServer): void {
  server.registerTool(
    'delete_tenant',
    {
      title: 'Apagar tenant (destrutivo)',
      description:
        'APAGA um tenant e cascateia: remove os auth users dos profiles, apaga scan_events e o tenant (cascade em categorias/produtos/menus/etc.). Exige MCP_ALLOW_DESTRUCTIVE=true e confirm:true.',
      inputSchema: {
        tenant: z.string().min(1).describe('id ou slug do tenant'),
        confirm: z.boolean().optional().describe('Deve ser true para confirmar a operação destrutiva'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ tenant, confirm }, extra) => {
      const blocked = checkDestructiveAllowed(confirm)
      if (blocked) return blocked

      const service = createServiceClient()
      const tenantId = await resolveTenantId(service, tenant)
      if (!tenantId) return errorResult(`Tenant não encontrado: ${tenant}`)

      const { data: profiles } = await service.from('profiles').select('id').eq('tenant_id', tenantId)
      for (const p of profiles ?? []) {
        await service.auth.admin.deleteUser(p.id)
      }
      await service.from('scan_events').delete().eq('tenant_id', tenantId)
      const { error } = await service.from('tenants').delete().eq('id', tenantId)
      if (error) return errorResult(`Erro ao apagar tenant: ${error.message}`)

      logMcpMutation('delete_tenant', extra, { tenantId, deletedProfiles: profiles?.length ?? 0 })
      return textResult(`Tenant ${tenantId} apagado (${profiles?.length ?? 0} usuários removidos).`)
    },
  )
}
