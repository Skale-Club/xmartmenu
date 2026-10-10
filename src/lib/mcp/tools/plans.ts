import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createServiceClient } from '@/lib/supabase/server'
import {
  checkDestructiveAllowed,
  errorResult,
  jsonResult,
  logMcpMutation,
  resolveTenantId,
  textResult,
} from '../helpers'

function planSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** Read tools for billing plans. Mirrors GET /api/superadmin/plans[/id]. */
export function registerPlanReadTools(server: McpServer): void {
  server.registerTool(
    'list_plans',
    {
      title: 'Listar planos',
      description:
        'Lista os planos de assinatura da plataforma (preços mensal/anual, taxa de transação, features, ativo, ordem).',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const service = createServiceClient()
      const { data, error } = await service
        .from('plans')
        .select('*')
        .order('sort_order', { ascending: true })
      if (error) return errorResult(`Erro ao listar planos: ${error.message}`)
      return jsonResult({ count: data?.length ?? 0, plans: data })
    },
  )

  server.registerTool(
    'get_plan',
    {
      title: 'Detalhar plano',
      description: 'Retorna um plano por id.',
      inputSchema: { plan_id: z.string().uuid().describe('id do plano') },
      annotations: { readOnlyHint: true },
    },
    async ({ plan_id }) => {
      const service = createServiceClient()
      const { data, error } = await service.from('plans').select('*').eq('id', plan_id).maybeSingle()
      if (error) return errorResult(`Erro ao buscar plano: ${error.message}`)
      if (!data) return errorResult(`Plano não encontrado: ${plan_id}`)
      return jsonResult(data)
    },
  )
}

/** Write tools for plans. Mirrors POST/PUT /api/superadmin/plans. */
export function registerPlanWriteTools(server: McpServer): void {
  server.registerTool(
    'create_plan',
    {
      title: 'Criar plano',
      description:
        'Cria um plano de assinatura. slug é gerado a partir do nome. annual_price deve ser >= monthly_price; preços >= 0.',
      inputSchema: {
        name: z.string().min(1),
        description: z.string().nullable().optional(),
        monthly_price: z.number().min(0),
        annual_price: z.number().min(0),
        transaction_fee_pct: z.number().min(0).max(100),
        features: z.array(z.string()).optional(),
        is_active: z.boolean().optional(),
        sort_order: z.number().int().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ name, description, monthly_price, annual_price, transaction_fee_pct, features, is_active, sort_order }, extra) => {
      if (annual_price < monthly_price) return errorResult('annual_price deve ser >= monthly_price.')
      const service = createServiceClient()
      const { data, error } = await service
        .from('plans')
        .insert({
          name: name.trim(),
          slug: planSlug(name),
          description: description ?? null,
          monthly_price,
          annual_price,
          transaction_fee_pct,
          features: features ?? [],
          is_active: is_active ?? true,
          sort_order: sort_order ?? 0,
        })
        .select()
        .single()
      if (error) return errorResult(`Erro ao criar plano: ${error.message}`)
      logMcpMutation('create_plan', extra, { name })
      return jsonResult(data)
    },
  )

  server.registerTool(
    'update_plan',
    {
      title: 'Atualizar plano',
      description:
        'Atualiza um plano (parcial). Alterar name regenera o slug. Preços >= 0; transaction_fee_pct entre 0 e 100.',
      inputSchema: {
        plan_id: z.string().uuid(),
        name: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
        monthly_price: z.number().min(0).optional(),
        annual_price: z.number().min(0).optional(),
        transaction_fee_pct: z.number().min(0).max(100).optional(),
        features: z.array(z.string()).optional(),
        is_active: z.boolean().optional(),
        sort_order: z.number().int().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ plan_id, name, description, monthly_price, annual_price, transaction_fee_pct, features, is_active, sort_order }, extra) => {
      const update: Record<string, unknown> = {}
      if (name !== undefined) {
        update.name = name.trim()
        update.slug = planSlug(name)
      }
      if (description !== undefined) update.description = description
      if (monthly_price !== undefined) update.monthly_price = monthly_price
      if (annual_price !== undefined) update.annual_price = annual_price
      if (transaction_fee_pct !== undefined) update.transaction_fee_pct = transaction_fee_pct
      if (features !== undefined) update.features = features
      if (is_active !== undefined) update.is_active = is_active
      if (sort_order !== undefined) update.sort_order = sort_order
      if (Object.keys(update).length === 0) return errorResult('Nada para atualizar.')

      const service = createServiceClient()
      const { data, error } = await service.from('plans').update(update).eq('id', plan_id).select().single()
      if (error) return errorResult(`Erro ao atualizar plano: ${error.message}`)
      logMcpMutation('update_plan', extra, { plan_id, keys: Object.keys(update) })
      return jsonResult(data)
    },
  )

  server.registerTool(
    'update_subscription',
    {
      title: 'Atualizar assinatura do tenant',
      description:
        'Atualiza overrides da assinatura de um tenant (billing_cycle, override de preços/taxa, notas). Erro se o tenant ainda não tem assinatura (atribua um plano antes).',
      inputSchema: {
        tenant: z.string().min(1).describe('id ou slug do tenant'),
        billing_cycle: z.enum(['monthly', 'annual']).optional(),
        override_monthly_price: z.number().min(0).nullable().optional(),
        override_annual_price: z.number().min(0).nullable().optional(),
        override_transaction_fee_pct: z.number().min(0).max(100).nullable().optional(),
        override_notes: z.string().nullable().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ tenant, billing_cycle, override_monthly_price, override_annual_price, override_transaction_fee_pct, override_notes }, extra) => {
      const service = createServiceClient()
      const tenantId = await resolveTenantId(service, tenant)
      if (!tenantId) return errorResult(`Tenant não encontrado: ${tenant}`)

      const { data: existing } = await service
        .from('tenant_subscriptions')
        .select('id')
        .eq('tenant_id', tenantId)
        .maybeSingle()
      if (!existing) {
        return errorResult('Tenant sem assinatura. Atribua um plano antes de editar os detalhes de cobrança.')
      }

      const update: Record<string, unknown> = {}
      if (billing_cycle !== undefined) update.billing_cycle = billing_cycle
      if (override_monthly_price !== undefined) update.override_monthly_price = override_monthly_price
      if (override_annual_price !== undefined) update.override_annual_price = override_annual_price
      if (override_transaction_fee_pct !== undefined) update.override_transaction_fee_pct = override_transaction_fee_pct
      if (override_notes !== undefined) update.override_notes = override_notes
      if (Object.keys(update).length === 0) return errorResult('Nada para atualizar.')

      const { data, error } = await service
        .from('tenant_subscriptions')
        .update(update)
        .eq('tenant_id', tenantId)
        .select('*, plan:plans(*)')
        .single()
      if (error) return errorResult(`Erro ao atualizar assinatura: ${error.message}`)
      logMcpMutation('update_subscription', extra, { tenantId, keys: Object.keys(update) })
      return jsonResult(data)
    },
  )
}

/** Destructive plan tools (gated). Mirrors DELETE /api/superadmin/plans/[id]. */
export function registerPlanDestructiveTools(server: McpServer): void {
  server.registerTool(
    'delete_plan',
    {
      title: 'Apagar plano (destrutivo)',
      description:
        'APAGA um plano. Bloqueado se algum tenant tiver assinatura nele. Exige MCP_ALLOW_DESTRUCTIVE=true e confirm:true.',
      inputSchema: {
        plan_id: z.string().uuid(),
        confirm: z.boolean().optional().describe('Deve ser true para confirmar'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ plan_id, confirm }, extra) => {
      const blocked = checkDestructiveAllowed(confirm)
      if (blocked) return blocked
      const service = createServiceClient()
      const { data: subs } = await service
        .from('tenant_subscriptions')
        .select('tenant_id')
        .eq('plan_id', plan_id)
        .limit(1)
      if (subs && subs.length > 0) {
        return errorResult('Não é possível apagar: há tenants com assinatura neste plano. Remova-os primeiro.')
      }
      const { error } = await service.from('plans').delete().eq('id', plan_id)
      if (error) return errorResult(`Erro ao apagar plano: ${error.message}`)
      logMcpMutation('delete_plan', extra, { plan_id })
      return textResult(`Plano ${plan_id} apagado.`)
    },
  )
}
