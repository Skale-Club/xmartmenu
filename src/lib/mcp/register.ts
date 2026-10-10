import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  registerTenantReadTools,
  registerTenantWriteTools,
  registerTenantDestructiveTools,
} from './tools/tenants'
import { registerUserReadTools, registerUserWriteTools, registerUserDestructiveTools } from './tools/users'
import { registerPlanReadTools, registerPlanWriteTools, registerPlanDestructiveTools } from './tools/plans'
import { registerPlatformReadTools, registerPlatformWriteTools } from './tools/platform'
import { registerMenuReadTools, registerMenuWriteTools, registerMenuDestructiveTools } from './tools/menu'
import {
  registerLocationReadTools,
  registerLocationWriteTools,
  registerLocationDestructiveTools,
} from './tools/locations'
import { registerOrderReadTools } from './tools/orders'
import { registerStaffReadTools, registerStaffWriteTools, registerStaffDestructiveTools } from './tools/staff'
import { registerBrandingWriteTools } from './tools/branding'
import { registerLaunchChecklistReadTools, registerLaunchChecklistWriteTools } from './tools/launch-checklist'

/**
 * Registers every xmartmenu MCP tool on the server instance.
 *
 * Tiers:
 * - read/list/get — always on.
 * - create/update — always on (safe writes).
 * - delete/destructive — registered, but each self-gates on MCP_ALLOW_DESTRUCTIVE
 *   + a confirm:true arg (see helpers.checkDestructiveAllowed).
 */
export function registerMcpTools(server: McpServer): void {
  // Read
  registerTenantReadTools(server)
  registerUserReadTools(server)
  registerPlanReadTools(server)
  registerPlatformReadTools(server)
  registerMenuReadTools(server)
  registerLocationReadTools(server)
  registerOrderReadTools(server)
  registerStaffReadTools(server)
  registerLaunchChecklistReadTools(server)

  // Write (create/update)
  registerTenantWriteTools(server)
  registerUserWriteTools(server)
  registerPlanWriteTools(server)
  registerPlatformWriteTools(server)
  registerMenuWriteTools(server)
  registerLocationWriteTools(server)
  registerStaffWriteTools(server)
  registerBrandingWriteTools(server)
  registerLaunchChecklistWriteTools(server)

  // Destructive (gated at call time)
  registerTenantDestructiveTools(server)
  registerUserDestructiveTools(server)
  registerPlanDestructiveTools(server)
  registerMenuDestructiveTools(server)
  registerLocationDestructiveTools(server)
  registerStaffDestructiveTools(server)
}
