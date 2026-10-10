import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createServiceClient } from '@/lib/supabase/server'
import { listAllAuthUsers } from '@/lib/admin/list-auth-users'
import {
  checkDestructiveAllowed,
  errorResult,
  jsonResult,
  logMcpMutation,
  textResult,
} from '../helpers'

/** Read tools for platform users. Mirrors GET /api/superadmin/users. */
export function registerUserReadTools(server: McpServer): void {
  server.registerTool(
    'list_users',
    {
      title: 'Listar usuários',
      description:
        'Lista todos os usuários (auth + profile): id, email, nome, role, tenant, provider e último login. Filtros opcionais por texto e role.',
      inputSchema: {
        search: z
          .string()
          .optional()
          .describe('Filtro opcional por email ou nome (case-insensitive)'),
        role: z
          .enum(['superadmin', 'store-admin', 'store-staff', 'customer'])
          .optional()
          .describe('Filtro opcional por role'),
        limit: z.number().int().min(1).max(1000).optional().describe('Máximo (default 200)'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ search, role, limit }) => {
      const service = createServiceClient()
      let authUsers
      try {
        authUsers = await listAllAuthUsers(service)
      } catch (e) {
        return errorResult(`Erro ao listar usuários: ${e instanceof Error ? e.message : String(e)}`)
      }

      const { data: profiles } = await service
        .from('profiles')
        .select('id, role, tenant_id, full_name, tenants(id, name, slug)')
      const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]))

      let users = authUsers.map((u) => {
        const profile = profileMap.get(u.id)
        return {
          id: u.id,
          email: u.email ?? null,
          full_name: profile?.full_name ?? (u.user_metadata?.full_name as string) ?? null,
          role: profile?.role ?? null,
          tenant_id: profile?.tenant_id ?? null,
          tenant: Array.isArray(profile?.tenants) ? profile.tenants[0] ?? null : profile?.tenants ?? null,
          provider: (u.app_metadata?.provider as string) ?? 'email',
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at,
        }
      })

      if (role) users = users.filter((u) => u.role === role)
      if (search) {
        const term = search.toLowerCase()
        users = users.filter(
          (u) =>
            (u.email?.toLowerCase().includes(term) ?? false) ||
            (u.full_name?.toLowerCase().includes(term) ?? false),
        )
      }

      const capped = users.slice(0, limit ?? 200)
      return jsonResult({ count: capped.length, total: users.length, users: capped })
    },
  )
}

/** Write tools for users. Mirrors PATCH /api/superadmin/users/[id]. */
export function registerUserWriteTools(server: McpServer): void {
  server.registerTool(
    'update_user',
    {
      title: 'Atualizar usuário',
      description:
        'Atualiza role e/ou tenant de um usuário. store-admin/store-staff exigem tenant_id; superadmin/customer forçam tenant_id nulo. Valida o tenant.',
      inputSchema: {
        user_id: z.string().uuid().describe('id do usuário (auth)'),
        role: z
          .enum(['superadmin', 'store-admin', 'store-staff', 'customer'])
          .optional()
          .describe('Novo role'),
        tenant_id: z.string().uuid().nullable().optional().describe('Tenant a vincular (uuid) ou null'),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ user_id, role, tenant_id }, extra) => {
      const service = createServiceClient()

      const rawRole = role ?? null
      const rawTenantId = tenant_id ?? null

      if ((rawRole === 'store-admin' || rawRole === 'store-staff') && !rawTenantId) {
        return errorResult('store-admin/store-staff precisam de um tenant_id.')
      }
      if (rawTenantId) {
        const { data: tenant } = await service.from('tenants').select('id').eq('id', rawTenantId).maybeSingle()
        if (!tenant) return errorResult(`Tenant não encontrado: ${rawTenantId}`)
      }

      let normalizedTenantId = rawTenantId
      if (rawRole === 'superadmin' || rawRole === 'customer' || !rawRole) {
        normalizedTenantId = null
      }

      const update: Record<string, unknown> = {}
      if (role !== undefined) update.role = rawRole
      if (tenant_id !== undefined || rawRole === 'superadmin' || rawRole === 'customer' || !rawRole) {
        update.tenant_id = normalizedTenantId
      }

      const { data, error } = await service.from('profiles').upsert({ id: user_id, ...update }).select().single()
      if (error) return errorResult(`Erro ao atualizar usuário: ${error.message}`)
      logMcpMutation('update_user', extra, { user_id, update })
      return jsonResult(data)
    },
  )
}

/** Destructive user tools (gated). Mirrors DELETE /api/superadmin/users/[id]. */
export function registerUserDestructiveTools(server: McpServer): void {
  server.registerTool(
    'delete_user',
    {
      title: 'Apagar usuário (destrutivo)',
      description:
        'APAGA o auth user (e o profile via cascade). Exige MCP_ALLOW_DESTRUCTIVE=true e confirm:true.',
      inputSchema: {
        user_id: z.string().uuid().describe('id do usuário (auth)'),
        confirm: z.boolean().optional().describe('Deve ser true para confirmar'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ user_id, confirm }, extra) => {
      const blocked = checkDestructiveAllowed(confirm)
      if (blocked) return blocked
      const service = createServiceClient()
      const { error } = await service.auth.admin.deleteUser(user_id)
      if (error) return errorResult(`Erro ao apagar usuário: ${error.message}`)
      logMcpMutation('delete_user', extra, { user_id })
      return textResult(`Usuário ${user_id} apagado.`)
    },
  )
}
