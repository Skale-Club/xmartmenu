/**
 * RSS sources (autoblog-parity XM-05/XM-09).
 *
 * POST with { action: 'fetch' } ingests every feed now — without it, "I just
 * added a feed" means "wait for the next sweep to find out whether the URL even
 * works".
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'

import { createServiceClient } from '@/lib/supabase/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { fetchAllRssSources } from '@/lib/blog/rss'
import { scopeColumn, scopeFilter } from '@/lib/blog/scope'

export async function GET() {
  if (!(await assertSuperadmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient()
  // Escopo da plataforma: os feeds de um restaurante são geridos no admin dele.
  const { data: sources } = await scopeFilter(service.from('blog_rss_sources').select('*'), null)
    .order('created_at', { ascending: true })
  const { data: items } = await scopeFilter(service.from('blog_rss_items').select('id, source_id, title, url, status, published_at'), null)
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(50)

  return NextResponse.json({ sources: sources ?? [], items: items ?? [] })
}

const bodySchema = z.union([
  z.object({ action: z.literal('add'), name: z.string().min(1).max(200), url: z.string().url().max(2000) }),
  z.object({ action: z.literal('delete'), id: z.string().uuid() }),
  // Pausing, not deleting. Deleting and re-adding is what people reach for
  // otherwise, and it throws away every item already ingested from the feed —
  // the publisher's whole current window then comes back in as if it were new.
  z.object({ action: z.literal('toggle'), id: z.string().uuid(), enabled: z.boolean() }),
  z.object({ action: z.literal('fetch') }),
])

export async function POST(request: Request) {
  if (!(await assertSuperadmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Validation failed' }, { status: 400 })
  }

  const service = createServiceClient()

  if (parsed.data.action === 'add') {
    const { error } = await service
      .from('blog_rss_sources')
      .insert({ ...scopeColumn(null), name: parsed.data.name, url: parsed.data.url, enabled: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true })
  }

  if (parsed.data.action === 'toggle') {
    const { error } = await scopeFilter(
      service
        .from('blog_rss_sources')
        .update({ enabled: parsed.data.enabled, updated_at: new Date().toISOString() }),
      null,
    ).eq('id', parsed.data.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true })
  }

  if (parsed.data.action === 'delete') {
    // blog_rss_items.source_id cascades, so the source's items go with it.
    const { error } = await scopeFilter(service.from('blog_rss_sources').delete(), null).eq(
      'id',
      parsed.data.id,
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true })
  }

  const summary = await fetchAllRssSources(service, null)
  return NextResponse.json(summary)
}
