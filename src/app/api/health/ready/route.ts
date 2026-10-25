/**
 * GET /api/health/ready — readiness: can this instance serve real requests?
 * 200 ok/degraded, 503 when the database can't be reached. Used by the uptime
 * monitor (.github/workflows/uptime.yml). Send `Authorization: Bearer
 * $HEALTH_TOKEN` to also see which integrations are configured.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { withApi } from '@/lib/observability/with-api'
import { getRequestContext } from '@/lib/observability/context'
import { log } from '@/lib/observability/log'
import { buildHealthReport, tokenMatches, type CheckResult } from '@/lib/observability/health'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function checkDatabase(): Promise<CheckResult> {
  const started = performance.now()
  try {
    const { error } = await createServiceClient()
      .from('plans')
      .select('id', { head: true, count: 'exact' })
      .limit(1)
      .abortSignal(AbortSignal.timeout(3000))
    const latency_ms = Math.round(performance.now() - started)
    if (error) return { ok: false, latency_ms, error: error.message.slice(0, 200) }
    return { ok: true, latency_ms }
  } catch (error) {
    return { ok: false, latency_ms: Math.round(performance.now() - started), error: error instanceof Error ? error.message.slice(0, 200) : 'unknown' }
  }
}

export const GET = withApi('GET /api/health/ready', async (request) => {
  const database = await checkDatabase()
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null
  const report = buildHealthReport({
    database,
    uptimeSeconds: process.uptime(),
    includeConfig: tokenMatches(bearer, process.env.HEALTH_TOKEN),
  })
  if (report.status !== 'ok') log.warn('health.not_ok', { status: report.status, database })
  return NextResponse.json(
    { ...report, request_id: getRequestContext()?.requestId },
    { status: report.status === 'down' ? 503 : 200, headers: { 'Cache-Control': 'no-store' } },
  )
})
