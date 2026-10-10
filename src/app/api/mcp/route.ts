import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import { verifyMcpToken } from '@/lib/mcp/verify-token'
import { registerMcpTools } from '@/lib/mcp/register'

/**
 * xmartmenu MCP server (Streamable HTTP) — owner-level management surface for
 * Claude / Codex.
 *
 * - Authorization Server: Supabase Auth OAuth 2.1 (discovery + PKCE + consent).
 * - Resource metadata: /.well-known/oauth-protected-resource points clients at it.
 * - Auth gate: `verifyMcpToken` validates the Supabase token and only lets
 *   platform superadmins through.
 *
 * Runs stateless (no SSE, no Redis). Mounted at /api/mcp via `basePath: '/api'`.
 */

export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const mcpHandler = createMcpHandler(
  (server) => {
    registerMcpTools(server)
  },
  {
    serverInfo: { name: 'xmartmenu-admin', version: '0.1.0' },
  },
  {
    basePath: '/api',
    disableSse: true,
    maxDuration: 60,
    verboseLogs: process.env.NODE_ENV !== 'production',
  },
)

// Optional override when the reverse proxy does not forward X-Forwarded-* headers.
const publicOrigin = process.env.MCP_PUBLIC_ORIGIN?.replace(/\/$/, '') || undefined

const authHandler = withMcpAuth(mcpHandler, verifyMcpToken, {
  required: true,
  resourceMetadataPath: '/.well-known/oauth-protected-resource',
  ...(publicOrigin ? { resourceUrl: publicOrigin } : {}),
})

export { authHandler as GET, authHandler as POST, authHandler as DELETE }
