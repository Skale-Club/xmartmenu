import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createServiceClient } from '@/lib/supabase/server'
import { slugify } from '@/lib/utils'
import {
  checkDestructiveAllowed,
  errorResult,
  getDefaultMenuId,
  jsonResult,
  logMcpMutation,
  resolveTenantId,
  textResult,
} from '../helpers'

const ALLOWED_LANGUAGE_CODES = ['en', 'pt', 'es', 'fr', 'de', 'it']

// Mirrors the language/translation sanitizers in the admin/menus routes.
function sanitizeLanguages(language: unknown, supported: unknown): { language: string; supported_languages: string[] } {
  const base = typeof language === 'string' && ALLOWED_LANGUAGE_CODES.includes(language) ? language : 'en'
  const raw = Array.isArray(supported) ? supported : [base]
  const deduped = Array.from(
    new Set(raw.filter((x): x is string => typeof x === 'string' && ALLOWED_LANGUAGE_CODES.includes(x))),
  )
  const normalized = deduped.length > 0 ? deduped : [base]
  if (!normalized.includes(base)) normalized.unshift(base)
  return { language: base, supported_languages: normalized }
}

/**
 * Read tools for a tenant's menu tree: menus, categories, products. Every tool
 * accepts a tenant id or slug and always scopes queries by tenant_id.
 */
export function registerMenuReadTools(server: McpServer): void {
  server.registerTool(
    'list_menus',
    {
      title: 'Listar menus do tenant',
      description: 'Lista os menus (cardápios) de um tenant, com idioma, status e posição.',
      inputSchema: { tenant: z.string().min(1).describe('id ou slug do tenant') },
      annotations: { readOnlyHint: true },
    },
    async ({ tenant }) => {
      const service = createServiceClient()
      const tenantId = await resolveTenantId(service, tenant)
      if (!tenantId) return errorResult(`Tenant não encontrado: ${tenant}`)
      const { data, error } = await service
        .from('menus')
        .select('id, name, slug, language, supported_languages, purpose, is_active, is_default, is_private, price_multiplier, position, created_at')
        .eq('tenant_id', tenantId)
        .order('position', { ascending: true })
      if (error) return errorResult(`Erro ao listar menus: ${error.message}`)
      return jsonResult({ tenant_id: tenantId, count: data?.length ?? 0, menus: data })
    },
  )

  server.registerTool(
    'list_categories',
    {
      title: 'Listar categorias',
      description: 'Lista as categorias de um tenant. Filtro opcional por menu_id.',
      inputSchema: {
        tenant: z.string().min(1).describe('id ou slug do tenant'),
        menu_id: z.string().uuid().optional().describe('Filtro opcional por menu'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ tenant, menu_id }) => {
      const service = createServiceClient()
      const tenantId = await resolveTenantId(service, tenant)
      if (!tenantId) return errorResult(`Tenant não encontrado: ${tenant}`)
      let query = service
        .from('categories')
        .select('id, menu_id, name, description, position, is_active, created_at')
        .eq('tenant_id', tenantId)
        .order('position', { ascending: true })
      if (menu_id) query = query.eq('menu_id', menu_id)
      const { data, error } = await query
      if (error) return errorResult(`Erro ao listar categorias: ${error.message}`)
      return jsonResult({ tenant_id: tenantId, count: data?.length ?? 0, categories: data })
    },
  )

  server.registerTool(
    'list_products',
    {
      title: 'Listar produtos',
      description:
        'Lista os produtos de um tenant. Filtros opcionais por menu_id e category_id. Traz preço, disponibilidade e imagem.',
      inputSchema: {
        tenant: z.string().min(1).describe('id ou slug do tenant'),
        menu_id: z.string().uuid().optional().describe('Filtro opcional por menu'),
        category_id: z.string().uuid().optional().describe('Filtro opcional por categoria'),
        limit: z.number().int().min(1).max(1000).optional().describe('Máximo (default 500)'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ tenant, menu_id, category_id, limit }) => {
      const service = createServiceClient()
      const tenantId = await resolveTenantId(service, tenant)
      if (!tenantId) return errorResult(`Tenant não encontrado: ${tenant}`)
      let query = service
        .from('products')
        .select('id, menu_id, category_id, name, description, price, original_price, image_url, is_available, is_featured, show_in_feed, tags, position, created_at')
        .eq('tenant_id', tenantId)
        .order('position', { ascending: true })
        .limit(limit ?? 500)
      if (menu_id) query = query.eq('menu_id', menu_id)
      if (category_id) query = query.eq('category_id', category_id)
      const { data, error } = await query
      if (error) return errorResult(`Erro ao listar produtos: ${error.message}`)
      return jsonResult({ tenant_id: tenantId, count: data?.length ?? 0, products: data })
    },
  )
}

/** Write tools for a tenant's menu tree (menus, categories, products). */
export function registerMenuWriteTools(server: McpServer): void {
  // ---- Menus ----
  server.registerTool(
    'create_menu',
    {
      title: 'Criar menu',
      description: 'Cria um menu (cardápio) para um tenant. slug gerado do nome (com sufixo se colidir).',
      inputSchema: {
        tenant: z.string().min(1).describe('id ou slug do tenant'),
        name: z.string().min(1),
        language: z.enum(['en', 'pt', 'es', 'fr', 'de', 'it']).optional().describe("Idioma base (default 'en')"),
        supported_languages: z.array(z.string()).optional(),
        purpose: z.string().optional().describe("Default 'restaurant'"),
        description: z.string().nullable().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ tenant, name, language, supported_languages, purpose, description }, extra) => {
      const service = createServiceClient()
      const tenantId = await resolveTenantId(service, tenant)
      if (!tenantId) return errorResult(`Tenant não encontrado: ${tenant}`)

      const i18n = sanitizeLanguages(language, supported_languages)
      const slug = slugify(name)
      const { data: existing } = await service
        .from('menus')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('slug', slug)
        .maybeSingle()
      const finalSlug = existing ? `${slug}-${Date.now().toString(36)}` : slug

      const { data, error } = await service
        .from('menus')
        .insert({
          tenant_id: tenantId,
          name: name.trim(),
          slug: finalSlug,
          language: i18n.language,
          supported_languages: i18n.supported_languages,
          translations: {},
          purpose: purpose ?? 'restaurant',
          description: description ?? null,
        })
        .select()
        .single()
      if (error) return errorResult(`Erro ao criar menu: ${error.message}`)
      logMcpMutation('create_menu', extra, { tenantId, name })
      return jsonResult(data)
    },
  )

  server.registerTool(
    'update_menu',
    {
      title: 'Atualizar menu',
      description:
        'Atualiza um menu (parcial). is_default:true desmarca os outros do tenant. Escopo por tenant garantido.',
      inputSchema: {
        tenant: z.string().min(1).describe('id ou slug do tenant'),
        menu_id: z.string().uuid(),
        name: z.string().min(1).optional(),
        purpose: z.string().optional(),
        description: z.string().nullable().optional(),
        is_active: z.boolean().optional(),
        is_default: z.boolean().optional(),
        is_private: z.boolean().optional(),
        price_multiplier: z.number().positive().optional(),
        position: z.number().int().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ tenant, menu_id, ...fields }, extra) => {
      const service = createServiceClient()
      const tenantId = await resolveTenantId(service, tenant)
      if (!tenantId) return errorResult(`Tenant não encontrado: ${tenant}`)

      const { data: owned } = await service
        .from('menus')
        .select('id')
        .eq('id', menu_id)
        .eq('tenant_id', tenantId)
        .maybeSingle()
      if (!owned) return errorResult('Menu não encontrado para este tenant.')

      const update: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(fields)) if (v !== undefined) update[k] = v
      if (Object.keys(update).length === 0) return errorResult('Nada para atualizar.')

      if (update.is_default === true) {
        await service.from('menus').update({ is_default: false }).eq('tenant_id', tenantId)
      }

      const { data, error } = await service.from('menus').update(update).eq('id', menu_id).select().single()
      if (error) return errorResult(`Erro ao atualizar menu: ${error.message}`)
      logMcpMutation('update_menu', extra, { tenantId, menu_id, keys: Object.keys(update) })
      return jsonResult(data)
    },
  )

  // ---- Categories ----
  server.registerTool(
    'create_category',
    {
      title: 'Criar categoria',
      description: 'Cria uma categoria num menu. Se menu_id não for informado, usa o menu default do tenant.',
      inputSchema: {
        tenant: z.string().min(1).describe('id ou slug do tenant'),
        name: z.string().min(1),
        description: z.string().nullable().optional(),
        position: z.number().int().optional(),
        menu_id: z.string().uuid().optional().describe('Menu alvo (default: menu default do tenant)'),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ tenant, name, description, position, menu_id }, extra) => {
      const service = createServiceClient()
      const tenantId = await resolveTenantId(service, tenant)
      if (!tenantId) return errorResult(`Tenant não encontrado: ${tenant}`)

      let resolvedMenuId = menu_id ?? null
      if (menu_id) {
        const { data: owned } = await service
          .from('menus')
          .select('id')
          .eq('id', menu_id)
          .eq('tenant_id', tenantId)
          .maybeSingle()
        if (!owned) return errorResult('Menu inválido para este tenant.')
      } else {
        resolvedMenuId = await getDefaultMenuId(service, tenantId)
      }
      if (!resolvedMenuId) return errorResult('Tenant não tem menu. Crie um menu antes.')

      const { data, error } = await service
        .from('categories')
        .insert({ tenant_id: tenantId, menu_id: resolvedMenuId, name, description: description ?? null, position: position ?? 0 })
        .select()
        .single()
      if (error) return errorResult(`Erro ao criar categoria: ${error.message}`)
      logMcpMutation('create_category', extra, { tenantId, name, menu_id: resolvedMenuId })
      return jsonResult(data)
    },
  )

  server.registerTool(
    'update_category',
    {
      title: 'Atualizar categoria',
      description: 'Atualiza uma categoria (name, description, position, is_active). Escopo por tenant.',
      inputSchema: {
        tenant: z.string().min(1).describe('id ou slug do tenant'),
        category_id: z.string().uuid(),
        name: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
        position: z.number().int().optional(),
        is_active: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ tenant, category_id, ...fields }, extra) => {
      const service = createServiceClient()
      const tenantId = await resolveTenantId(service, tenant)
      if (!tenantId) return errorResult(`Tenant não encontrado: ${tenant}`)
      const update: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(fields)) if (v !== undefined) update[k] = v
      if (Object.keys(update).length === 0) return errorResult('Nada para atualizar.')

      const { data, error } = await service
        .from('categories')
        .update(update)
        .eq('id', category_id)
        .eq('tenant_id', tenantId)
        .select()
        .single()
      if (error) return errorResult(`Erro ao atualizar categoria: ${error.message}`)
      if (!data) return errorResult('Categoria não encontrada para este tenant.')
      logMcpMutation('update_category', extra, { tenantId, category_id, keys: Object.keys(update) })
      return jsonResult(data)
    },
  )

  // ---- Products ----
  server.registerTool(
    'create_product',
    {
      title: 'Criar produto',
      description:
        'Cria um produto. Requer name e price. menu_id/category_id opcionais (default: menu default do tenant).',
      inputSchema: {
        tenant: z.string().min(1).describe('id ou slug do tenant'),
        name: z.string().min(1),
        price: z.number().min(0),
        description: z.string().nullable().optional(),
        original_price: z.number().min(0).nullable().optional(),
        category_id: z.string().uuid().optional(),
        menu_id: z.string().uuid().optional(),
        image_url: z.string().nullable().optional(),
        is_available: z.boolean().optional(),
        is_featured: z.boolean().optional(),
        show_in_feed: z.boolean().optional().describe('Exibir no feed visual mobile (default true)'),
        tags: z.array(z.string()).optional(),
        position: z.number().int().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ tenant, name, price, description, original_price, category_id, menu_id, image_url, is_available, is_featured, show_in_feed, tags, position }, extra) => {
      const service = createServiceClient()
      const tenantId = await resolveTenantId(service, tenant)
      if (!tenantId) return errorResult(`Tenant não encontrado: ${tenant}`)

      let resolvedMenuId = menu_id ?? null
      if (menu_id) {
        const { data: owned } = await service.from('menus').select('id').eq('id', menu_id).eq('tenant_id', tenantId).maybeSingle()
        if (!owned) return errorResult('Menu inválido para este tenant.')
      } else {
        resolvedMenuId = await getDefaultMenuId(service, tenantId)
      }
      if (category_id) {
        const { data: cat } = await service.from('categories').select('id').eq('id', category_id).eq('tenant_id', tenantId).maybeSingle()
        if (!cat) return errorResult('Categoria inválida para este tenant.')
      }

      const { data, error } = await service
        .from('products')
        .insert({
          tenant_id: tenantId,
          menu_id: resolvedMenuId,
          category_id: category_id ?? null,
          name: name.trim(),
          description: description ?? null,
          price,
          original_price: original_price ?? null,
          image_url: image_url ?? null,
          is_available: is_available ?? true,
          is_featured: is_featured ?? false,
          show_in_feed: show_in_feed ?? true,
          tags: tags ?? [],
          position: position ?? 0,
        })
        .select()
        .single()
      if (error) return errorResult(`Erro ao criar produto: ${error.message}`)
      logMcpMutation('create_product', extra, { tenantId, name })
      return jsonResult(data)
    },
  )

  server.registerTool(
    'update_product',
    {
      title: 'Atualizar produto',
      description: 'Atualiza um produto (parcial). Escopo por tenant.',
      inputSchema: {
        tenant: z.string().min(1).describe('id ou slug do tenant'),
        product_id: z.string().uuid(),
        name: z.string().min(1).optional(),
        price: z.number().min(0).optional(),
        description: z.string().nullable().optional(),
        original_price: z.number().min(0).nullable().optional(),
        category_id: z.string().uuid().nullable().optional(),
        image_url: z.string().nullable().optional(),
        is_available: z.boolean().optional(),
        is_featured: z.boolean().optional(),
        show_in_feed: z.boolean().optional().describe('Exibir no feed visual mobile'),
        tags: z.array(z.string()).optional(),
        position: z.number().int().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ tenant, product_id, ...fields }, extra) => {
      const service = createServiceClient()
      const tenantId = await resolveTenantId(service, tenant)
      if (!tenantId) return errorResult(`Tenant não encontrado: ${tenant}`)
      const update: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(fields)) if (v !== undefined) update[k] = v
      if (Object.keys(update).length === 0) return errorResult('Nada para atualizar.')

      const { data, error } = await service
        .from('products')
        .update(update)
        .eq('id', product_id)
        .eq('tenant_id', tenantId)
        .select()
        .single()
      if (error) return errorResult(`Erro ao atualizar produto: ${error.message}`)
      if (!data) return errorResult('Produto não encontrado para este tenant.')
      logMcpMutation('update_product', extra, { tenantId, product_id, keys: Object.keys(update) })
      return jsonResult(data)
    },
  )
}

/** Destructive menu-tree tools (gated). */
export function registerMenuDestructiveTools(server: McpServer): void {
  const makeDelete = (
    toolName: string,
    table: 'menus' | 'categories' | 'products',
    idField: string,
    label: string,
  ) => {
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

        if (table === 'menus') {
          const { data: menu } = await service.from('menus').select('is_default').eq('id', id).eq('tenant_id', tenantId).maybeSingle()
          if (!menu) return errorResult('Menu não encontrado para este tenant.')
          if (menu.is_default) return errorResult('Não é possível apagar o menu default.')
        }

        const { error } = await service.from(table).delete().eq('id', id).eq('tenant_id', tenantId)
        if (error) return errorResult(`Erro ao apagar ${label}: ${error.message}`)
        logMcpMutation(toolName, extra, { tenantId, id })
        return textResult(`${label} ${id} apagado(a).`)
      },
    )
  }

  makeDelete('delete_menu', 'menus', 'menu_id', 'menu')
  makeDelete('delete_category', 'categories', 'category_id', 'categoria')
  makeDelete('delete_product', 'products', 'product_id', 'produto')
}
