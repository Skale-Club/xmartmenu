/**
 * Telegram approval webhook (autoblog-parity XM-08, MASTER §6).
 *
 * This is a PUBLIC endpoint. What proves a request actually came from Telegram
 * is the shared secret echoed in X-Telegram-Bot-Api-Secret-Token, registered
 * with setWebhook. The chat_id and the callback_data in the body are entirely
 * attacker-controlled and prove nothing on their own — which is why the check
 * below is the FIRST thing that happens, before the body is even read.
 *
 * @server-only: called by Telegram, never from a browser.
 */
import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'

import { createServiceClient } from '@/lib/supabase/server'
import { parseApprovalCallbackData, type TelegramSettingsRow } from '@/lib/blog/telegram'
import { revalidatePath } from 'next/cache'
import { scopeColumn, scopeFilter } from '@/lib/blog/scope'

function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export async function POST(request: Request) {
  const svc = createServiceClient()
  // O webhook da PLATAFORMA. O blog de um restaurante que queira aprovações no
  // Telegram usa a linha dele — e um webhook próprio, não este.
  const { data } = await scopeFilter(svc.from('telegram_settings').select('*'), null).maybeSingle()
  const settings = data as TelegramSettingsRow | null

  // No configured secret means no registered webhook, so nothing legitimate can
  // be arriving here. 401 rather than 503: an unauthenticated caller learns
  // nothing either way, and it keeps the failure mode uniform.
  if (!settings?.webhook_secret || !settings.approvals_enabled) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!secretMatches(request.headers.get('x-telegram-bot-api-secret-token'), settings.webhook_secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const update = (await request.json().catch(() => null)) as {
    callback_query?: { data?: string; from?: { id?: number } }
  } | null

  const callbackData = update?.callback_query?.data
  if (!callbackData) {
    // Telegram retries anything that is not a 2xx, and a message update we do
    // not handle is not an error — acknowledging it stops the retry loop.
    return NextResponse.json({ ok: true, ignored: true })
  }

  const parsed = parseApprovalCallbackData(callbackData)
  if (!parsed) return NextResponse.json({ ok: true, ignored: true })

  // Escopado à PLATAFORMA, e não só por arrumação: o id do post vem do
  // callback_data do Telegram. Sem este filtro, quem descobrisse o segredo do
  // webhook publicaria o rascunho de um restaurante no site dele a partir daqui.
  // O restaurante que quiser aprovações no Telegram usa a linha dele e um
  // webhook próprio — nunca este.
  const { data: post } = await scopeFilter(svc.from('blog_posts'), null)
    .select('id, title, excerpt, status')
    .eq('id', parsed.postId)
    .maybeSingle()

  if (!post) return NextResponse.json({ ok: true, ignored: true })
  const row = post as { id: string; title: string; excerpt: string | null; status: string }

  if (parsed.action === 'approve') {
    // Already published means a second tap on the same card, or two editors
    // tapping at once. Idempotent, not an error.
    if (row.status !== 'published') {
      await svc
        .from('blog_posts')
        .update({
          status: 'published',
          published_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)

      await svc
        .from('blog_post_feedback')
        .insert({
          ...scopeColumn(null),
          post_id: row.id,
          post_title: row.title,
          post_excerpt: row.excerpt,
          verdict: 'approved',
          decided_by: 'telegram',
        })
        .then(undefined, () => undefined)
    }
    revalidatePath('/blog')
    return NextResponse.json({ ok: true, action: 'approved' })
  }

  // Reject: the feedback row is written BEFORE the delete and snapshots the
  // title and excerpt, because the whole point is that the signal survives the
  // post it came from.
  await svc.from('blog_post_feedback').insert({
    ...scopeColumn(null),
    post_id: row.id,
    post_title: row.title,
    post_excerpt: row.excerpt,
    verdict: 'rejected',
    // A tap carries no reason. The admin panel's reject flow does, and that is
    // the stronger signal — recording null here is honest about the difference.
    reason: null,
    decided_by: 'telegram',
  })
  await svc.from('blog_posts').delete().eq('id', row.id)

  return NextResponse.json({ ok: true, action: 'rejected' })
}
