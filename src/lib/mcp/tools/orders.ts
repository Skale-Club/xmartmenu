import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createServiceClient } from '@/lib/supabase/server'
import { errorResult, jsonResult, resolveTenantId } from '../helpers'

const ORDER_STATUSES = [
  'awaiting_payment',
  'pending',
  'paid',
  'payment_failed',
  'preparing',
  'ready',
  'out_for_delivery',
  'done',
  'cancelled',
] as const

/** Read tools for orders. Superadmin/cross-tenant, so scoped by explicit tenant. */
export function registerOrderReadTools(server: McpServer): void {
  server.registerTool(
    'list_orders',
    {
      title: 'Listar pedidos',
      description:
        'Lista pedidos de um tenant, mais recentes primeiro. Filtros opcionais por status e janela de horas. Inclui os itens.',
      inputSchema: {
        tenant: z.string().min(1).describe('id ou slug do tenant'),
        status: z.enum(ORDER_STATUSES).optional().describe('Filtro opcional por status'),
        since_hours: z
          .number()
          .int()
          .min(1)
          .max(24 * 90)
          .optional()
          .describe('Só pedidos das últimas N horas (default: sem limite de tempo)'),
        limit: z.number().int().min(1).max(1000).optional().describe('Máximo (default 100)'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ tenant, status, since_hours, limit }) => {
      const service = createServiceClient()
      const tenantId = await resolveTenantId(service, tenant)
      if (!tenantId) return errorResult(`Tenant não encontrado: ${tenant}`)

      let query = service
        .from('orders')
        .select('*, order_items(*)')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(limit ?? 100)
      if (status) query = query.eq('status', status)
      if (since_hours) {
        const cutoff = new Date(Date.now() - since_hours * 3600_000).toISOString()
        query = query.gte('created_at', cutoff)
      }

      const { data, error } = await query
      if (error) return errorResult(`Erro ao listar pedidos: ${error.message}`)
      return jsonResult({ tenant_id: tenantId, count: data?.length ?? 0, orders: data })
    },
  )

  server.registerTool(
    'get_order',
    {
      title: 'Detalhar pedido',
      description: 'Retorna um pedido específico por id, com todos os itens.',
      inputSchema: { order_id: z.string().uuid().describe('id do pedido') },
      annotations: { readOnlyHint: true },
    },
    async ({ order_id }) => {
      const service = createServiceClient()
      const { data, error } = await service
        .from('orders')
        .select('*, order_items(*)')
        .eq('id', order_id)
        .maybeSingle()
      if (error) return errorResult(`Erro ao buscar pedido: ${error.message}`)
      if (!data) return errorResult(`Pedido não encontrado: ${order_id}`)
      return jsonResult(data)
    },
  )
}
