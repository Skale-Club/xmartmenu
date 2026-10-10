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

/** Read tools for a tenant's locations (branches) and delivery zones. */
export function registerLocationReadTools(server: McpServer): void {
  server.registerTool(
    'list_locations',
    {
      title: 'Listar unidades',
      description: 'Lista as unidades/filiais (locations) de um tenant, com endereço, contato e menu vinculado.',
      inputSchema: { tenant: z.string().min(1).describe('id ou slug do tenant') },
      annotations: { readOnlyHint: true },
    },
    async ({ tenant }) => {
      const service = createServiceClient()
      const tenantId = await resolveTenantId(service, tenant)
      if (!tenantId) return errorResult(`Tenant não encontrado: ${tenant}`)
      const { data, error } = await service
        .from('locations')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: true })
      if (error) return errorResult(`Erro ao listar unidades: ${error.message}`)
      return jsonResult({ tenant_id: tenantId, count: data?.length ?? 0, locations: data })
    },
  )

  server.registerTool(
    'list_delivery_zones',
    {
      title: 'Listar zonas de entrega',
      description: 'Lista as zonas de entrega de um tenant (nome, taxa em centavos, prefixos de CEP, ativa).',
      inputSchema: { tenant: z.string().min(1).describe('id ou slug do tenant') },
      annotations: { readOnlyHint: true },
    },
    async ({ tenant }) => {
      const service = createServiceClient()
      const tenantId = await resolveTenantId(service, tenant)
      if (!tenantId) return errorResult(`Tenant não encontrado: ${tenant}`)
      const { data, error } = await service
        .from('delivery_zones')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: true })
      if (error) return errorResult(`Erro ao listar zonas: ${error.message}`)
      return jsonResult({ tenant_id: tenantId, count: data?.length ?? 0, delivery_zones: data })
    },
  )
}

const SLUG_RE = /^[a-z0-9-]+$/
const coord = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Write tools for locations + delivery zones. */
export function registerLocationWriteTools(server: McpServer): void {
  server.registerTool(
    'create_location',
    {
      title: 'Criar unidade',
      description: 'Cria uma unidade/filial para um tenant. slug único (a-z, 0-9, hífen). menu_id opcional (deve ser do tenant).',
      inputSchema: {
        tenant: z.string().min(1).describe('id ou slug do tenant'),
        name: z.string().min(1),
        slug: z.string().min(1).describe('slug único: minúsculas, números e hífens'),
        address: z.string().nullable().optional(),
        city: z.string().nullable().optional(),
        phone: z.string().nullable().optional(),
        business_hours: z.any().optional(),
        menu_id: z.string().uuid().optional(),
        region: z.string().nullable().optional(),
        postal_code: z.string().nullable().optional(),
        country: z.string().nullable().optional(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ tenant, name, slug, address, city, phone, business_hours, menu_id, region, postal_code, country, latitude, longitude }, extra) => {
      const service = createServiceClient()
      const tenantId = await resolveTenantId(service, tenant)
      if (!tenantId) return errorResult(`Tenant não encontrado: ${tenant}`)
      if (!SLUG_RE.test(slug)) return errorResult('slug deve conter apenas minúsculas, números e hífens.')

      if (menu_id) {
        const { data: owned } = await service.from('menus').select('id').eq('id', menu_id).eq('tenant_id', tenantId).maybeSingle()
        if (!owned) return errorResult('Menu não encontrado para este tenant.')
      }

      const { data, error } = await service
        .from('locations')
        .insert({
          tenant_id: tenantId,
          name: name.trim(),
          slug: slug.trim(),
          address: address?.trim() || null,
          city: city?.trim() || null,
          phone: phone?.trim() || null,
          business_hours: business_hours || null,
          menu_id: menu_id ?? null,
          region: region?.trim() || null,
          postal_code: postal_code?.trim() || null,
          country: country?.trim() || null,
          latitude: coord(latitude),
          longitude: coord(longitude),
        })
        .select()
        .single()
      if (error) {
        if (error.code === '23505') return errorResult('Já existe uma unidade com esse slug.')
        return errorResult(`Erro ao criar unidade: ${error.message}`)
      }
      logMcpMutation('create_location', extra, { tenantId, slug })
      return jsonResult(data)
    },
  )

  server.registerTool(
    'update_location',
    {
      title: 'Atualizar unidade',
      description: 'Atualiza uma unidade (parcial). Escopo por tenant.',
      inputSchema: {
        tenant: z.string().min(1).describe('id ou slug do tenant'),
        location_id: z.string().uuid(),
        name: z.string().min(1).optional(),
        slug: z.string().optional(),
        address: z.string().nullable().optional(),
        city: z.string().nullable().optional(),
        phone: z.string().nullable().optional(),
        business_hours: z.any().optional(),
        menu_id: z.string().uuid().nullable().optional(),
        region: z.string().nullable().optional(),
        postal_code: z.string().nullable().optional(),
        country: z.string().nullable().optional(),
        latitude: z.number().nullable().optional(),
        longitude: z.number().nullable().optional(),
        is_active: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ tenant, location_id, ...fields }, extra) => {
      const service = createServiceClient()
      const tenantId = await resolveTenantId(service, tenant)
      if (!tenantId) return errorResult(`Tenant não encontrado: ${tenant}`)
      if (fields.slug !== undefined && !SLUG_RE.test(fields.slug)) {
        return errorResult('slug deve conter apenas minúsculas, números e hífens.')
      }
      if (fields.menu_id) {
        const { data: owned } = await service.from('menus').select('id').eq('id', fields.menu_id).eq('tenant_id', tenantId).maybeSingle()
        if (!owned) return errorResult('Menu não encontrado para este tenant.')
      }
      const update: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(fields)) if (v !== undefined) update[k] = v
      if (Object.keys(update).length === 0) return errorResult('Nada para atualizar.')

      const { data, error } = await service
        .from('locations')
        .update(update)
        .eq('id', location_id)
        .eq('tenant_id', tenantId)
        .select()
        .single()
      if (error) {
        if (error.code === '23505') return errorResult('Já existe uma unidade com esse slug.')
        return errorResult(`Erro ao atualizar unidade: ${error.message}`)
      }
      if (!data) return errorResult('Unidade não encontrada para este tenant.')
      logMcpMutation('update_location', extra, { tenantId, location_id, keys: Object.keys(update) })
      return jsonResult(data)
    },
  )

  server.registerTool(
    'create_delivery_zone',
    {
      title: 'Criar zona de entrega',
      description: 'Cria uma zona de entrega (nome, taxa em centavos, prefixos de CEP).',
      inputSchema: {
        tenant: z.string().min(1).describe('id ou slug do tenant'),
        name: z.string().min(1),
        fee_cents: z.number().int().min(0).optional(),
        zipcode_prefixes: z.array(z.string()).optional(),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ tenant, name, fee_cents, zipcode_prefixes }, extra) => {
      const service = createServiceClient()
      const tenantId = await resolveTenantId(service, tenant)
      if (!tenantId) return errorResult(`Tenant não encontrado: ${tenant}`)
      const { data, error } = await service
        .from('delivery_zones')
        .insert({
          tenant_id: tenantId,
          name: name.trim(),
          fee_cents: Math.max(0, Number(fee_cents ?? 0)),
          zipcode_prefixes: Array.isArray(zipcode_prefixes) ? zipcode_prefixes : [],
        })
        .select()
        .single()
      if (error) return errorResult(`Erro ao criar zona: ${error.message}`)
      logMcpMutation('create_delivery_zone', extra, { tenantId, name })
      return jsonResult(data)
    },
  )

  server.registerTool(
    'update_delivery_zone',
    {
      title: 'Atualizar zona de entrega',
      description: 'Atualiza uma zona de entrega (name, fee_cents, zipcode_prefixes, is_active). Escopo por tenant.',
      inputSchema: {
        tenant: z.string().min(1).describe('id ou slug do tenant'),
        zone_id: z.string().uuid(),
        name: z.string().min(1).optional(),
        fee_cents: z.number().int().min(0).optional(),
        zipcode_prefixes: z.array(z.string()).optional(),
        is_active: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ tenant, zone_id, ...fields }, extra) => {
      const service = createServiceClient()
      const tenantId = await resolveTenantId(service, tenant)
      if (!tenantId) return errorResult(`Tenant não encontrado: ${tenant}`)
      const update: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(fields)) if (v !== undefined) update[k] = v
      if (Object.keys(update).length === 0) return errorResult('Nada para atualizar.')

      const { data, error } = await service
        .from('delivery_zones')
        .update(update)
        .eq('id', zone_id)
        .eq('tenant_id', tenantId)
        .select()
        .single()
      if (error) return errorResult(`Erro ao atualizar zona: ${error.message}`)
      if (!data) return errorResult('Zona não encontrada para este tenant.')
      logMcpMutation('update_delivery_zone', extra, { tenantId, zone_id, keys: Object.keys(update) })
      return jsonResult(data)
    },
  )
}

/** Destructive location/zone tools (gated). */
export function registerLocationDestructiveTools(server: McpServer): void {
  const makeDelete = (toolName: string, table: 'locations' | 'delivery_zones', idField: string, label: string) => {
    server.registerTool(
      toolName,
      {
        title: `Apagar ${label} (destrutivo)`,
        description: `APAGA um(a) ${label} do tenant. Exige MCP_ALLOW_DESTRUCTIVE=true e confirm:true.`,
        inputSchema: {
          tenant: z.string().min(1).describe('id ou slug do tenant'),
          [idField]: z.string().uuid(),
          confirm: z.boolean().optional().describe('Deve ser true para confirmar'),
        },
        annotations: { readOnlyHint: false, destructiveHint: true },
      },
      async (args, extra) => {
        const { tenant, confirm } = args as { tenant: string; confirm?: boolean }
        const id = (args as Record<string, string>)[idField]
        const blocked = checkDestructiveAllowed(confirm)
        if (blocked) return blocked
        const service = createServiceClient()
        const tenantId = await resolveTenantId(service, tenant)
        if (!tenantId) return errorResult(`Tenant não encontrado: ${tenant}`)
        const { error } = await service.from(table).delete().eq('id', id).eq('tenant_id', tenantId)
        if (error) return errorResult(`Erro ao apagar ${label}: ${error.message}`)
        logMcpMutation(toolName, extra, { tenantId, id })
        return textResult(`${label} ${id} apagado(a).`)
      },
    )
  }

  makeDelete('delete_location', 'locations', 'location_id', 'unidade')
  makeDelete('delete_delivery_zone', 'delivery_zones', 'zone_id', 'zona de entrega')
}
