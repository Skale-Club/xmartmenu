// =============================================================================
// src/lib/blog/sweep.ts
//
// Roda uma volta de geração por TODOS os blogs ativos (autoblog-parity XM-11).
//
// A plataforma tem um blog; cada restaurante com o recurso ligado tem o dele.
// O cron chama isto uma vez e cada escopo decide sozinho, com as próprias
// configurações, se está na hora — o `isRunDue` de cada um roda no fuso dele.
//
// Sequencial, nunca em paralelo: cada escopo faz várias chamadas de modelo, e
// disparar cinquenta restaurantes de uma vez levaria o provedor a limitar a
// taxa de todos eles ao mesmo tempo. Isto roda num agendador, não numa request.
// =============================================================================
import { createServiceClient } from '@/lib/supabase/server'
import { generateBlogPost, type GenerationResult } from '@/lib/blog/generator'
import { fetchAllRssSources } from '@/lib/blog/rss'
import { describeScope, type BlogScope } from '@/lib/blog/scope'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServiceClient = ReturnType<typeof createServiceClient>

export interface SweepEntry {
  scope: string
  status: string
  reason?: string
  title?: string
  error?: string
}

export interface SweepSummary {
  scopesConsidered: number
  generated: number
  skipped: number
  failed: number
  entries: SweepEntry[]
}

/**
 * Os escopos com o blog LIGADO.
 *
 * A plataforma entra sempre que tiver uma linha de configuração; um restaurante
 * entra quando tiver a dele com `enabled`. O gate de PLANO não é checado aqui
 * de propósito: uma linha `enabled` só existe porque alguém com o recurso a
 * criou, e re-checar o plano a cada volta transformaria uma varredura numa
 * consulta de faturamento por tenant. O plano é checado onde importa — no admin
 * que liga o recurso e na página pública que o serve.
 */
async function enabledScopes(svc: ServiceClient): Promise<BlogScope[]> {
  const { data } = await svc.from('blog_settings').select('tenant_id, enabled')
  const rows = (data ?? []) as Array<{ tenant_id: string | null; enabled: boolean }>
  return rows.filter((r) => r.enabled).map((r) => r.tenant_id)
}

/**
 * Uma volta de geração por escopo.
 *
 * Uma falha num escopo nunca derruba os outros: um restaurante com a chave de
 * API errada não pode impedir os outros quarenta de publicarem naquele dia.
 */
export async function runBlogSweep(opts: { trigger: 'cron' | 'manual'; svc?: ServiceClient } = { trigger: 'cron' }): Promise<SweepSummary> {
  const svc = opts.svc ?? createServiceClient()
  const scopes = await enabledScopes(svc)
  const summary: SweepSummary = {
    scopesConsidered: scopes.length,
    generated: 0,
    skipped: 0,
    failed: 0,
    entries: [],
  }

  for (const scope of scopes) {
    let result: GenerationResult
    try {
      result = await generateBlogPost({ trigger: opts.trigger, scope, svc })
    } catch (err) {
      summary.failed += 1
      summary.entries.push({
        scope: describeScope(scope),
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      })
      continue
    }

    if (result.status === 'generated') summary.generated += 1
    else if (result.status === 'failed') summary.failed += 1
    else summary.skipped += 1

    summary.entries.push({
      scope: describeScope(scope),
      status: result.status,
      ...(result.status === 'skipped' ? { reason: result.reason } : {}),
      ...(result.status === 'generated' ? { title: result.title } : {}),
      ...(result.status === 'failed' ? { error: result.error } : {}),
    })
  }

  return summary
}

/**
 * Uma volta de leitura de feeds por escopo.
 *
 * Separado da geração e num horário próprio: os itens precisam já estar na fila
 * quando a hora de publicar de um restaurante chegar. Acoplado à geração, uma
 * casa que publica uma vez por dia só veria itens publicados no minuto exato em
 * que ela publica.
 */
export async function runRssSweep(svc?: ServiceClient): Promise<{
  scopesConsidered: number
  sourcesProcessed: number
  itemsUpserted: number
  errors: Array<{ scope: string; sourceName: string; message: string }>
}> {
  const client = svc ?? createServiceClient()
  const { data } = await client.from('blog_settings').select('tenant_id, enabled, rss_enabled')
  const rows = (data ?? []) as Array<{ tenant_id: string | null; enabled: boolean; rss_enabled: boolean }>
  const scopes = rows.filter((r) => r.enabled && r.rss_enabled).map((r) => r.tenant_id)

  let sourcesProcessed = 0
  let itemsUpserted = 0
  const errors: Array<{ scope: string; sourceName: string; message: string }> = []

  for (const scope of scopes) {
    try {
      const result = await fetchAllRssSources(client, scope)
      sourcesProcessed += result.sourcesProcessed
      itemsUpserted += result.itemsUpserted
      for (const e of result.errors) {
        errors.push({ scope: describeScope(scope), sourceName: e.sourceName, message: e.message })
      }
    } catch (err) {
      // Um escopo com a lista de feeds quebrada não pode parar a varredura.
      errors.push({
        scope: describeScope(scope),
        sourceName: '(sweep)',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { scopesConsidered: scopes.length, sourcesProcessed, itemsUpserted, errors }
}
