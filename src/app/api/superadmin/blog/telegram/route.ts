/**
 * Telegram approvals configuration (autoblog-parity XM-08).
 *
 * Both bot tokens are encrypted at rest with the same envelope every other
 * credential in this repo uses, and neither ever leaves the server — the panel
 * gets a boolean, not a mask of a token.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { randomBytes } from 'node:crypto'

import { createServiceClient } from '@/lib/supabase/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { encryptApiKey } from '@/lib/crypto'
import { parseTelegramTarget } from '@/lib/blog/contract'
import { scopeColumn, scopeFilter } from '@/lib/blog/scope'

const MASKED = '••••'

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  botToken: z.string().max(200).optional(),
  chatIds: z.array(z.string().max(100)).optional(),
  approvalsEnabled: z.boolean().optional(),
  approvalsBotToken: z.string().max(200).optional(),
  approvalsChatIds: z.array(z.string().max(100)).optional(),
})

export async function GET() {
  if (!(await assertSuperadmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient()
  const { data } = await scopeFilter(service.from('telegram_settings').select('*'), null).maybeSingle()
  if (!data) return NextResponse.json({ settings: null })

  const row = data as Record<string, unknown> & {
    bot_token: string | null
    approvals_bot_token: string | null
    webhook_secret: string | null
  }
  // Destructured out, not filtered: no token and no webhook secret may ever
  // reach a response body, and renaming a column should break this line.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { bot_token: _t, approvals_bot_token: _a, webhook_secret: _w, ...safe } = row

  return NextResponse.json({
    settings: {
      ...safe,
      has_bot_token: !!row.bot_token,
      has_approvals_bot_token: !!row.approvals_bot_token,
      has_webhook_secret: !!row.webhook_secret,
    },
  })
}

export async function PATCH(request: Request) {
  if (!(await assertSuperadmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = patchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Validation failed' }, { status: 400 })
  }

  const normalize = (ids: string[]) => Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)))
  const chatIds = parsed.data.chatIds ? normalize(parsed.data.chatIds) : undefined
  const approvalsChatIds = parsed.data.approvalsChatIds ? normalize(parsed.data.approvalsChatIds) : undefined

  // Reject a malformed destination HERE rather than discovering it on the first
  // approval card, where the only symptom is silence. An entry is a chat id,
  // optionally with a forum-topic thread (MASTER §6).
  const invalid = [...(chatIds ?? []), ...(approvalsChatIds ?? [])].filter((id) => !parseTelegramTarget(id))
  if (invalid.length > 0) {
    return NextResponse.json(
      {
        error: `Chat id inválido: ${invalid.join(', ')}. Use o id numérico, opcionalmente com o tópico do fórum como "<chat_id>:<thread_id>".`,
      },
      { status: 400 },
    )
  }

  const service = createServiceClient()
  const { data: existing } = await scopeFilter(
    service.from('telegram_settings').select('*'),
    null,
  ).maybeSingle()
  const prevRow = existing as { id: string } | null
  const current = (existing ?? {}) as { webhook_secret?: string | null }

  const update: Record<string, unknown> = { ...scopeColumn(null), updated_at: new Date().toISOString() }
  if (parsed.data.enabled !== undefined) update.enabled = parsed.data.enabled
  if (parsed.data.approvalsEnabled !== undefined) update.approvals_enabled = parsed.data.approvalsEnabled
  if (chatIds) update.chat_ids = chatIds
  if (approvalsChatIds) update.approvals_chat_ids = approvalsChatIds

  for (const [field, column] of [
    ['botToken', 'bot_token'],
    ['approvalsBotToken', 'approvals_bot_token'],
  ] as const) {
    const incoming = parsed.data[field]?.trim()
    if (incoming === undefined || incoming === MASKED) continue
    update[column] = incoming ? encryptApiKey(incoming) : null
  }

  // Rotate the webhook secret whenever approvals are (re-)enabled. It is what
  // proves a webhook call came from Telegram, so a stale one outliving a
  // disabled period is exactly the thing not to keep.
  if (parsed.data.approvalsEnabled === true && !current.webhook_secret) {
    update.webhook_secret = randomBytes(32).toString('hex')
  }
  if (parsed.data.approvalsEnabled === false) {
    update.webhook_secret = null
  }

  // Update quando a linha existe, insert quando não — nunca upsert. O `id`
  // deixou de ser o literal 1 e passou a UUID com default (XM-11), portanto um
  // upsert por `id` não encontraria conflito nenhum e inseriria uma linha nova a
  // cada gravação; o `maybeSingle()` da leitura seguinte rebentaria com "multiple
  // rows". O índice único do escopo é PARCIAL (WHERE tenant_id IS NULL) e o
  // ON CONFLICT do PostgREST também não o alcança.
  const { error } = prevRow
    ? await service.from('telegram_settings').update(update).eq('id', prevRow.id)
    : await service.from('telegram_settings').insert(update)
  if (error) {
    console.error('PATCH /api/superadmin/blog/telegram:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
