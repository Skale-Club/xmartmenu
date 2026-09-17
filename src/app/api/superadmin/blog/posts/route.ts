/**
 * The approval queue and the job history (autoblog-parity XM-09).
 *
 * GET returns generated drafts awaiting a decision plus recent runs; POST
 * approves or rejects one draft.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'

import { createServiceClient } from '@/lib/supabase/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { scopeColumn, scopeFilter } from '@/lib/blog/scope'

export async function GET() {
  if (!(await assertSuperadmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient()

  // Generated drafts only. A hand-written draft is someone's work in progress,
  // not something waiting on an approval decision.
  // Escopo da PLATAFORMA. Sem isto, depois de XM-11, esta fila mostraria os
  // rascunhos de todos os restaurantes misturados aos da plataforma — e
  // aprovar um publicaria no site de um cliente a partir do console
  // superadmin, sem nem dizer de quem era.
  const { data: drafts } = await scopeFilter(service.from('blog_posts'), null)
    .select('id, title, excerpt, created_at')
    .eq('status', 'draft')
    .eq('ai_generated', true)
    .order('created_at', { ascending: false })
    .limit(50)

  const { data: jobs } = await scopeFilter(service.from('blog_generation_jobs'), null)
    .select('id, status, trigger, source, pillar_id, topic, error_message, durations_ms, created_at, completed_at')
    .order('created_at', { ascending: false })
    .limit(20)

  return NextResponse.json({ drafts: drafts ?? [], jobs: jobs ?? [] })
}

const decisionSchema = z.object({
  postId: z.string().uuid(),
  action: z.enum(['approve', 'reject']),
  reason: z.string().max(1000).optional(),
})

export async function POST(request: Request) {
  if (!(await assertSuperadmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = decisionSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Validation failed' }, { status: 400 })
  }

  const service = createServiceClient()
  const { data: post } = await scopeFilter(service.from('blog_posts'), null)
    .select('id, title, excerpt, status')
    .eq('id', parsed.data.postId)
    .maybeSingle()
  if (!post) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const row = post as { id: string; title: string; excerpt: string | null; status: string }

  if (parsed.data.action === 'approve') {
    // Already published means a second click, or two people deciding at once.
    // Idempotent, not an error.
    if (row.status !== 'published') {
      await service
        .from('blog_posts')
        .update({
          status: 'published',
          published_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)

      // Best-effort: the post is published either way, and losing the learning
      // signal must not undo the decision.
      await service
        .from('blog_post_feedback')
        .insert({
          ...scopeColumn(null),
          post_id: row.id,
          post_title: row.title,
          post_excerpt: row.excerpt,
          verdict: 'approved',
          decided_by: 'admin',
        })
        .then(undefined, () => undefined)
    }
    revalidatePath('/blog')
    return NextResponse.json({ ok: true, action: 'approved' })
  }

  // Reject: feedback is written BEFORE the delete and snapshots the title and
  // excerpt, because the whole point is that the signal survives the post. The
  // reason is the strongest part of it — it tells the next run what to avoid,
  // not merely that something was wrong.
  await service.from('blog_post_feedback').insert({
    ...scopeColumn(null),
    post_id: row.id,
    post_title: row.title,
    post_excerpt: row.excerpt,
    verdict: 'rejected',
    reason: parsed.data.reason?.trim() || null,
    decided_by: 'admin',
  })
  await service.from('blog_posts').delete().eq('id', row.id)

  return NextResponse.json({ ok: true, action: 'rejected' })
}
