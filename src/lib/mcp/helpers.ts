import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'
import type { ServerRequest, ServerNotification } from '@modelcontextprotocol/sdk/types.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { captureSecurityEvent } from '@/lib/observability'

/**
 * Shared helpers for the xmartmenu MCP tools.
 *
 * All tools run only after `verifyMcpToken` has authenticated the caller as a
 * platform superadmin, so they use the service-role client and mirror the
 * tenant-scoping filters of the existing superadmin/admin API routes.
 */

export type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

/** Strip characters that would break a PostgREST `.or()`/`.ilike()` filter. */
export function sanitizeFilter(value: string): string {
  return value.replace(/[,()%*]/g, ' ').trim()
}

/**
 * Resolve a tenant reference (uuid id OR slug) to its tenant id. Returns null if
 * no such tenant exists. Lets every per-tenant tool accept the friendly slug.
 */
export async function resolveTenantId(
  service: SupabaseClient,
  tenant: string,
): Promise<string | null> {
  if (isUuid(tenant)) return tenant
  const { data } = await service
    .from('tenants')
    .select('id')
    .eq('slug', tenant)
    .maybeSingle()
  return data?.id ?? null
}

/**
 * Resolve the tenant's default menu id (is_default, else first by position).
 * The web app resolves this via a cookie; MCP has no session, so pick the
 * canonical default. Returns null if the tenant has no menus.
 */
export async function getDefaultMenuId(
  service: SupabaseClient,
  tenantId: string,
): Promise<string | null> {
  const { data } = await service
    .from('menus')
    .select('id, is_default, position')
    .eq('tenant_id', tenantId)
    .order('is_default', { ascending: false })
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle()
  return data?.id ?? null
}

/** Success result: pretty-printed JSON payload. */
export function jsonResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

/** Plain-text success result. */
export function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] }
}

/** Error result — surfaced to the model with `isError` so it can react. */
export function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

/** The owner's user id / email resolved by `verifyMcpToken`, for audit logs. */
export function callerFromExtra(extra: ToolExtra): { userId?: string; email?: string } {
  const info = extra.authInfo?.extra as { userId?: string; email?: string } | undefined
  return { userId: info?.userId, email: info?.email }
}

/**
 * Audit a mutating tool call. Reuses the existing security-event sink so MCP
 * writes land in Sentry alongside the rest of the platform's authz events.
 */
export function logMcpMutation(tool: string, extra: ToolExtra, args: unknown): void {
  captureSecurityEvent(`MCP mutation: ${tool}`, {
    kind: 'mcp',
    tool,
    caller: callerFromExtra(extra),
    args,
  })
}

/**
 * Guard for destructive tools. They are OFF unless `MCP_ALLOW_DESTRUCTIVE=true`
 * AND the caller passes `confirm: true`. Returns an error result to short-circuit
 * the tool, or `null` when the operation is allowed to proceed.
 */
export function checkDestructiveAllowed(confirm: boolean | undefined): CallToolResult | null {
  if (process.env.MCP_ALLOW_DESTRUCTIVE !== 'true') {
    return errorResult(
      'Operação destrutiva bloqueada: defina MCP_ALLOW_DESTRUCTIVE=true no servidor para habilitar deletes.',
    )
  }
  if (confirm !== true) {
    return errorResult(
      'Operação destrutiva exige confirmação explícita: chame novamente com confirm: true.',
    )
  }
  return null
}
