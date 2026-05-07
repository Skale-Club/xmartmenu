import { createServiceClient } from '@/lib/supabase/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'

// Polling endpoint — called every 3s by TenantDetailClient.
// When status transitions to 'complete', revalidates the tenant's public menu ISR cache
// so newly seeded images become visible without an extra round-trip from GH Actions.
export const runtime = 'nodejs'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tenantId } = await params

  // Auth guard — assertSuperadmin returns client or null (SEC-03 pattern)
  const supabase = await assertSuperadmin()
  if (!supabase) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const jobId = searchParams.get('jobId')

  if (!jobId) return NextResponse.json({ error: 'jobId is required' }, { status: 400 })

  const service = await createServiceClient()

  // tenant_id filter prevents cross-tenant reads even if the caller tampers with jobId
  const { data: job, error } = await service
    .from('ai_jobs')
    .select('status, error_message')
    .eq('id', jobId)
    .eq('tenant_id', tenantId)
    .single()

  if (error || !job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  // On complete: revalidate ISR cache so the public menu shows new images
  if (job.status === 'complete') {
    const { data: tenant } = await service
      .from('tenants')
      .select('slug')
      .eq('id', tenantId)
      .single()

    if (tenant?.slug) {
      revalidatePath(`/${tenant.slug}`)
    }
  }

  return NextResponse.json({
    status: job.status as 'pending' | 'running' | 'complete' | 'failed',
    errorMessage: job.error_message ?? null,
  })
}
