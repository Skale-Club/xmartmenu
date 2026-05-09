import { createServiceClient } from '@/lib/supabase/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { NextResponse } from 'next/server'

// Short-lived route: only inserts a DB row + dispatches GH Actions.
// Actual image generation happens in GH Actions (no Vercel timeout risk).
export const runtime = 'nodejs'
export const maxDuration = 15

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tenantId } = await params

  // Auth guard | assertSuperadmin returns client or null (SEC-03 pattern)
  const supabase = await assertSuperadmin()
  if (!supabase) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as { productId?: string }
  const productId = body.productId ?? '' // empty string = bulk seed

  const service = await createServiceClient()

  // Insert ai_jobs row | GH Actions script will update status as it progresses
  const featureKey = productId ? 'image_single' : 'image_seeding'
  const { data: job, error: jobErr } = await service
    .from('ai_jobs')
    .insert({
      tenant_id: tenantId,
      feature_key: featureKey,
      status: 'pending',
    })
    .select('id')
    .single()

  if (jobErr || !job) {
    return NextResponse.json({ error: 'Failed to create job record' }, { status: 500 })
  }

  const jobId = job.id

  // Dispatch GH Actions workflow_dispatch
  // CRITICAL (Pitfall 1): Returns HTTP 204 with NO body | DO NOT call .json()
  // CRITICAL (Pitfall 2): Use Fine-Grained PAT (GH_PAT), NOT GITHUB_TOKEN
  const owner = process.env.GITHUB_REPO_OWNER
  const repo = process.env.GITHUB_REPO_NAME

  if (!owner || !repo || !process.env.GH_PAT) {
    // Clean up job record if dispatch config is missing
    await service.from('ai_jobs').delete().eq('id', jobId)
    return NextResponse.json(
      { error: 'GH Actions dispatch not configured (missing GH_PAT, GITHUB_REPO_OWNER, or GITHUB_REPO_NAME)' },
      { status: 500 }
    )
  }

  const dispatchRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/image-seeding.yml/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GH_PAT}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ref: 'main',
        inputs: {
          job_id: jobId,
          tenant_id: tenantId,
          product_id: productId,
        },
      }),
    }
  )

  // workflow_dispatch returns 204 No Content on success | NEVER .json() this response
  if (dispatchRes.status !== 204) {
    const text = await dispatchRes.text()
    await service
      .from('ai_jobs')
      .update({ status: 'failed', error_message: `Dispatch failed: ${dispatchRes.status} ${text}` })
      .eq('id', jobId)
    return NextResponse.json({ error: `GH dispatch failed: ${dispatchRes.status}` }, { status: 500 })
  }

  return NextResponse.json({ jobId })
}
