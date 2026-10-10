import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createServiceClient } from '@/lib/supabase/server'
import { generatePassword } from '@/lib/auth/password-gen'
import {
  checkDestructiveAllowed,
  errorResult,
  jsonResult,
  logMcpMutation,
  resolveTenantId,
  textResult,
} from '../helpers'

const DEFAULT_STAFF_PASSWORD = process.env.DEFAULT_STAFF_PASSWORD?.trim() || 'Staff@12345'

/** Read tool for a tenant's staff members. Mirrors GET /api/superadmin/tenants/[id]/staff. */
export function registerStaffReadTools(server: McpServer): void {
  server.registerTool(
    'list_staff',
    {
      title: 'Listar staff do tenant',
      description: 'Lista os membros store-staff de um tenant (nome, email, obrigatoriedade de trocar senha).',
      inputSchema: { tenant: z.string().min(1).describe('id ou slug do tenant') },
      annotations: { readOnlyHint: true },
    },
    async ({ tenant }) => {
      const service = createServiceClient()
      const tenantId = await resolveTenantId(service, tenant)
      if (!tenantId) return errorResult(`Tenant não encontrado: ${tenant}`)

      const { data: profiles, error } = await service
        .from('profiles')
        .select('id, full_name, role, must_change_password, created_at')
        .eq('tenant_id', tenantId)
        .eq('role', 'store-staff')
        .order('created_at', { ascending: true })
      if (error) return errorResult(`Erro ao listar staff: ${error.message}`)

      const staff = await Promise.all(
        (profiles ?? []).map(async (p) => {
          const { data: authUser } = await service.auth.admin.getUserById(p.id)
          return {
            id: p.id,
            full_name: p.full_name,
            email: authUser?.user?.email ?? null,
            must_change_password: p.must_change_password,
            created_at: p.created_at,
          }
        }),
      )

      return jsonResult({ tenant_id: tenantId, count: staff.length, staff })
    },
  )
}

/**
 * Resolve tenant + verify a staff member belongs to it (role store-staff).
 * Returns the tenantId, or an error result to return directly.
 */
async function requireStaffOfTenant(
  service: ReturnType<typeof createServiceClient>,
  tenant: string,
  staffId: string,
): Promise<{ tenantId: string; fullName: string | null } | { error: string }> {
  const tenantId = await resolveTenantId(service, tenant)
  if (!tenantId) return { error: `Tenant não encontrado: ${tenant}` }
  const { data: staff } = await service
    .from('profiles')
    .select('id, role, tenant_id, full_name')
    .eq('id', staffId)
    .maybeSingle()
  if (!staff || staff.tenant_id !== tenantId || staff.role !== 'store-staff') {
    return { error: 'Staff não encontrado para este tenant.' }
  }
  return { tenantId, fullName: staff.full_name ?? null }
}

/** Write tools for staff. Mirrors the superadmin staff routes. */
export function registerStaffWriteTools(server: McpServer): void {
  server.registerTool(
    'create_staff',
    {
      title: 'Criar staff',
      description:
        'Cria um membro store-staff para um tenant (senha padrão temporária, troca obrigatória no 1º login). Retorna as credenciais UMA vez. 409 se o email já existe.',
      inputSchema: {
        tenant: z.string().min(1).describe('id ou slug do tenant'),
        name: z.string().min(1),
        email: z.string().email(),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ tenant, name, email }, extra) => {
      const service = createServiceClient()
      const tenantId = await resolveTenantId(service, tenant)
      if (!tenantId) return errorResult(`Tenant não encontrado: ${tenant}`)

      const { data: userData, error: userError } = await service.auth.admin.createUser({
        email,
        password: DEFAULT_STAFF_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: name.trim() },
      })
      if (userError) {
        if (userError.message.includes('already been registered')) {
          return errorResult('Este email já está registrado.')
        }
        return errorResult(`Erro ao criar staff: ${userError.message}`)
      }

      if (userData.user) {
        await service.from('profiles').upsert(
          {
            id: userData.user.id,
            tenant_id: tenantId,
            role: 'store-staff',
            full_name: name.trim(),
            must_change_password: true,
            password_changed_at: null,
          },
          { onConflict: 'id' },
        )
      }

      logMcpMutation('create_staff', extra, { tenantId, email })
      return jsonResult({
        staff: { id: userData.user?.id ?? null, email, full_name: name.trim() },
        credentials: { email, password: DEFAULT_STAFF_PASSWORD },
      })
    },
  )

  server.registerTool(
    'reset_staff_password',
    {
      title: 'Resetar senha do staff',
      description:
        'Gera nova senha temporária para um staff (troca obrigatória no próximo login). Retorna as credenciais UMA vez.',
      inputSchema: {
        tenant: z.string().min(1).describe('id ou slug do tenant'),
        staff_id: z.string().uuid(),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ tenant, staff_id }, extra) => {
      const service = createServiceClient()
      const ctx = await requireStaffOfTenant(service, tenant, staff_id)
      if ('error' in ctx) return errorResult(ctx.error)

      const { data: authUser } = await service.auth.admin.getUserById(staff_id)
      const email = authUser?.user?.email ?? null
      if (!email) return errorResult('Email do staff não encontrado.')

      const password = generatePassword()
      const { error } = await service.auth.admin.updateUserById(staff_id, {
        password,
        user_metadata: { full_name: ctx.fullName ?? undefined },
      })
      if (error) return errorResult(`Erro ao resetar senha: ${error.message}`)
      await service.from('profiles').update({ must_change_password: true, password_changed_at: null }).eq('id', staff_id)

      logMcpMutation('reset_staff_password', extra, { tenantId: ctx.tenantId, staff_id })
      return jsonResult({ credentials: { email, password }, staff: { id: staff_id, email, full_name: ctx.fullName } })
    },
  )
}

/** Destructive staff tool (gated). Demotes a staff member to customer. */
export function registerStaffDestructiveTools(server: McpServer): void {
  server.registerTool(
    'demote_staff',
    {
      title: 'Rebaixar staff (destrutivo)',
      description:
        'Rebaixa um staff para role customer e desvincula do tenant (não apaga o auth user). Exige MCP_ALLOW_DESTRUCTIVE=true e confirm:true.',
      inputSchema: {
        tenant: z.string().min(1).describe('id ou slug do tenant'),
        staff_id: z.string().uuid(),
        confirm: z.boolean().optional().describe('Deve ser true para confirmar'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ tenant, staff_id, confirm }, extra) => {
      const blocked = checkDestructiveAllowed(confirm)
      if (blocked) return blocked
      const service = createServiceClient()
      const ctx = await requireStaffOfTenant(service, tenant, staff_id)
      if ('error' in ctx) return errorResult(ctx.error)

      const { error } = await service.from('profiles').update({ role: 'customer', tenant_id: null }).eq('id', staff_id)
      if (error) return errorResult(`Erro ao rebaixar staff: ${error.message}`)
      logMcpMutation('demote_staff', extra, { tenantId: ctx.tenantId, staff_id })
      return textResult(`Staff ${staff_id} rebaixado para customer.`)
    },
  )
}
