import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createServiceClient } from '@/lib/supabase/server'
import {
  LAUNCH_CHECKLIST_ITEMS,
  LAUNCH_CHECKLIST_KEYS,
  LAUNCH_CHECKLIST_REASON_LABELS,
  LAUNCH_CHECKLIST_STATUSES,
  resolveLaunchChecklistLink,
  summarizeLaunchChecklist,
  type LaunchChecklistTenant,
} from '@/lib/launch-checklist'
import {
  LaunchChecklistSetupError,
  loadLaunchChecklist,
  runLaunchChecklistScan,
  setLaunchChecklistItem,
} from '@/lib/admin/launch-checklist-data'
import { callerFromExtra, errorResult, jsonResult, logMcpMutation, resolveTenantId, type ToolExtra } from '../helpers'

/** "Updated by" shown in the panel for a tick made by an agent. */
function mcpActorLabel(extra: ToolExtra): string {
  const caller = callerFromExtra(extra)
  return `mcp:${caller.email ?? caller.userId ?? 'agent'}`
}

function describeLaunchChecklist(tenant: LaunchChecklistTenant) {
  return {
    tenantId: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    status: tenant.status,
    siteUrl: tenant.siteUrl,
    customDomain: tenant.primaryDomain,
    progress: summarizeLaunchChecklist(tenant.entries),
    items: LAUNCH_CHECKLIST_ITEMS.map((item) => {
      const entry = tenant.entries[item.key]
      const signal = tenant.signals[item.key]
      return {
        key: item.key,
        category: item.category,
        label: item.label,
        description: item.description,
        status: entry?.status ?? 'pending',
        note: entry?.note || null,
        updatedBy: entry?.updatedBy ?? null,
        updatedAt: entry?.updatedAt ?? null,
        detected: signal
          ? { ok: signal.ok, detail: [signal.value, signal.reason ? LAUNCH_CHECKLIST_REASON_LABELS[signal.reason] : null].filter(Boolean).join(' · ') }
          : null,
        link: resolveLaunchChecklistLink(item.link, tenant.siteUrl, tenant.primaryDomain),
      }
    }),
  }
}

/** Read tool for the website launch checklist (same data as Clients → Launch checklist). */
export function registerLaunchChecklistReadTools(server: McpServer): void {
  server.registerTool(
    'get_launch_checklist',
    {
      title: 'Ver checklist de lançamento do site',
      description:
        'Checklist de lançamento do site de cada restaurante (Search Console, robots.txt, sitemap, GA4, GTM, Microsoft Clarity, Pixel da Meta, Bing, Perfil da Empresa no Google, PageSpeed, SSL…). ' +
        'Sem `tenant`: uma linha de progresso por restaurante, com os itens pendentes. Com `tenant`: cada item com key, status (pending/done/na), nota, o sinal detectado pela plataforma e um link da ferramenta. ' +
        'Para verificar o site ao vivo use scan_launch_checklist; para marcar um item use set_launch_checklist_item.',
      inputSchema: {
        tenant: z.string().min(1).optional().describe('id ou slug do restaurante'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ tenant }) => {
      const service = createServiceClient()
      const data = await loadLaunchChecklist(service)
      if (!tenant) {
        return jsonResult({
          setupRequired: data.setupRequired,
          restaurants: data.tenants.map((t) => ({
            tenantId: t.id,
            slug: t.slug,
            name: t.name,
            status: t.status,
            siteUrl: t.siteUrl,
            ...summarizeLaunchChecklist(t.entries),
            missing: LAUNCH_CHECKLIST_ITEMS.filter((i) => (t.entries[i.key]?.status ?? 'pending') === 'pending').map((i) => i.key),
          })),
        })
      }
      const tenantId = await resolveTenantId(service, tenant)
      const found = tenantId ? data.tenants.find((t) => t.id === tenantId) : null
      if (!found) return errorResult(`Restaurante não encontrado: ${tenant}`)
      return jsonResult({ setupRequired: data.setupRequired, ...describeLaunchChecklist(found) })
    },
  )
}

/** Write tools: tick an item, or scan the live site and tick what it verifies. */
export function registerLaunchChecklistWriteTools(server: McpServer): void {
  server.registerTool(
    'set_launch_checklist_item',
    {
      title: 'Marcar item do checklist de lançamento',
      description:
        "Define um item do checklist de lançamento de um restaurante: status 'done' (verificado), 'na' (não se aplica) ou 'pending'. " +
        "Coloque em `note` o que foi verificado (ex.: 'GA4 G-ABC123 recebendo visitas em tempo real'); sem `note`, a nota atual é mantida. " +
        `Keys: ${LAUNCH_CHECKLIST_ITEMS.map((i) => i.key).join(', ')}.`,
      inputSchema: {
        tenant: z.string().min(1).describe('id ou slug do restaurante'),
        itemKey: z.string().min(1),
        status: z.enum(LAUNCH_CHECKLIST_STATUSES),
        note: z.string().max(2000).optional(),
      },
    },
    async ({ tenant, itemKey, status, note }, extra) => {
      if (!LAUNCH_CHECKLIST_KEYS.has(itemKey)) {
        return errorResult(`Item desconhecido '${itemKey}'. Keys válidas: ${Array.from(LAUNCH_CHECKLIST_KEYS).join(', ')}`)
      }
      const service = createServiceClient()
      const tenantId = await resolveTenantId(service, tenant)
      if (!tenantId) return errorResult(`Restaurante não encontrado: ${tenant}`)
      logMcpMutation('set_launch_checklist_item', extra, { tenantId, itemKey, status })
      try {
        const entry = await setLaunchChecklistItem(service, { tenantId, itemKey, status, note, updatedBy: mcpActorLabel(extra) })
        if (!entry) return errorResult(`Restaurante não encontrado: ${tenant}`)
        return jsonResult({ updated: true, tenantId, itemKey, entry })
      } catch (err) {
        if (err instanceof LaunchChecklistSetupError) return errorResult(err.message)
        throw err
      }
    },
  )

  server.registerTool(
    'scan_launch_checklist',
    {
      title: 'Verificar o site ao vivo para o checklist de lançamento',
      description:
        'Acessa o cardápio público do restaurante (domínio próprio ou URL da plataforma): home, robots.txt, sitemap.xml e o contêiner publicado do Google Tag Manager. ' +
        'Informa, por item do checklist, o que está comprovadamente no ar: HTTPS, noindex, robots.txt, sitemap, GTM, GA4, Microsoft Clarity e Pixel da Meta (na página ou dentro do contêiner do GTM), título/descrição, og:image, favicon, JSON-LD, canonical e tags de verificação do Search Console/Bing. ' +
        "Com apply=true marca como 'done' todo item PENDENTE que a verificação comprovou, com a evidência na nota; itens done/N/A nunca são alterados. " +
        'O que um robô não vê (sitemap enviado no Search Console, Perfil da Empresa no Google, PageSpeed…) continua precisando de set_launch_checklist_item depois de conferir na ferramenta certa.',
      inputSchema: {
        tenant: z.string().min(1).describe('id ou slug do restaurante'),
        apply: z.boolean().optional().describe('true = marcar automaticamente os itens verificados'),
      },
    },
    async ({ tenant, apply }, extra) => {
      const service = createServiceClient()
      const tenantId = await resolveTenantId(service, tenant)
      if (!tenantId) return errorResult(`Restaurante não encontrado: ${tenant}`)
      if (apply) logMcpMutation('scan_launch_checklist', extra, { tenantId, apply: true })
      try {
        const outcome = await runLaunchChecklistScan(service, tenantId, { apply: Boolean(apply), updatedBy: mcpActorLabel(extra) })
        if (!outcome) return errorResult(`Restaurante não encontrado: ${tenant}`)
        return jsonResult({ ...outcome.scan, markedDone: outcome.marked })
      } catch (err) {
        if (err instanceof LaunchChecklistSetupError) return errorResult(err.message)
        throw err
      }
    },
  )
}
