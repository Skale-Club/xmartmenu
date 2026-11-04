import { authorizeAdminActor, type AdminActorContext } from './admin-actor'
import { AdminMenuError, type AdminMenuQuery } from './admin-menus'
import { readPublicChatAddon } from './public-chat-session'

export interface AdminChatContext extends AdminActorContext { tenantId: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SETTINGS = 'tenant_id,enabled,openrouter_model,audio_enabled,text_enabled,audio_provider,rate_limit_per_phone_per_day,created_at,updated_at'
const CONVERSATION = 'id,tenant_id,phone_hash,started_at,last_message_at,message_count,status,admin_note'
const dateValues = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]))
async function authorized(query: AdminMenuQuery, context: AdminChatContext, write = false) {
  if (!UUID.test(context.tenantId)) throw new AdminMenuError(403, 'Forbidden')
  await authorizeAdminActor(query, context, write)
}
function id(value: string) { if (!UUID.test(value)) throw new AdminMenuError(404, 'Not found') }
function object(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AdminMenuError(400, 'Invalid request')
  return value as Record<string, unknown>
}
async function conversation(query: AdminMenuQuery, context: AdminChatContext, conversationId: string) {
  id(conversationId)
  const result = await query(`SELECT ${CONVERSATION} FROM public.chat_conversations WHERE id=$1 AND tenant_id=$2`, [conversationId, context.tenantId])
  if (result.rows.length !== 1) throw new AdminMenuError(404, 'Conversation not found')
  return result.rows[0]
}
export async function readAdminChatSettings(query: AdminMenuQuery, context: AdminChatContext) {
  await authorized(query, context)
  const result = await query(`SELECT ${SETTINGS} FROM public.chat_addon_settings WHERE tenant_id=$1 LIMIT 2`, [context.tenantId])
  if (result.rows.length > 1) throw new AdminMenuError(503, 'Settings unavailable')
  return { settings: result.rows[0] ? dateValues(result.rows[0]) : null, status: (await readPublicChatAddon(query, context.tenantId)).status }
}
export async function writeAdminChatSettings(query: AdminMenuQuery, context: AdminChatContext, input: unknown) {
  await authorized(query, context, true)
  const body = object(input), patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const field of ['enabled', 'audio_enabled', 'text_enabled'] as const) if (typeof body[field] === 'boolean') patch[field] = body[field]
  if (typeof body.openrouter_model === 'string') patch.openrouter_model = body.openrouter_model
  if (body.audio_provider === null || body.audio_provider === 'whisper' || body.audio_provider === 'deepgram') patch.audio_provider = body.audio_provider
  if (typeof body.rate_limit_per_phone_per_day === 'number') {
    if (!Number.isFinite(body.rate_limit_per_phone_per_day)) throw new AdminMenuError(400, 'Invalid rate limit')
    patch.rate_limit_per_phone_per_day = Math.max(1, Math.min(500, Math.floor(body.rate_limit_per_phone_per_day)))
  }
  const columns = Object.keys(patch)
  await query(`INSERT INTO public.chat_addon_settings(tenant_id,${columns.join(',')}) VALUES($1,${columns.map((_, index) => `$${index + 2}`).join(',')})
    ON CONFLICT(tenant_id) DO UPDATE SET ${columns.map(column => `${column}=EXCLUDED.${column}`).join(',')}`, [context.tenantId, ...Object.values(patch)])
  return { ok: true }
}
export async function readAdminChatConversations(query: AdminMenuQuery, context: AdminChatContext, search: URLSearchParams) {
  await authorized(query, context)
  const status = ['active', 'blocked'].includes(search.get('status') ?? '') ? search.get('status') : null
  const page = Math.max(1, Math.floor(Number(search.get('page')) || 1)), pageSize = Math.min(100, Math.max(1, Math.floor(Number(search.get('page_size')) || 50))), offset = (page - 1) * pageSize
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(pageSize)) throw new AdminMenuError(400, 'Invalid page')
  const total = await query('SELECT count(*)::int AS n FROM public.chat_conversations WHERE tenant_id=$1 AND ($2::text IS NULL OR status=$2)', [context.tenantId, status])
  const result = await query(`SELECT id,phone_hash,started_at,last_message_at,message_count,status,admin_note FROM public.chat_conversations WHERE tenant_id=$1 AND ($2::text IS NULL OR status=$2) ORDER BY last_message_at DESC LIMIT $3 OFFSET $4`, [context.tenantId, status, pageSize, offset])
  return { conversations: result.rows.map(dateValues), total: total.rows[0]?.n ?? 0, page, page_size: pageSize }
}
export async function readAdminChatThread(query: AdminMenuQuery, context: AdminChatContext, conversationId: string) {
  await authorized(query, context)
  const current = await conversation(query, context, conversationId)
  const messages = await query(`SELECT m.id,m.role,m.content,m.created_at,m.has_audio,m.tokens_used FROM public.chat_messages m JOIN public.chat_conversations c ON c.id=m.conversation_id WHERE m.conversation_id=$1 AND c.tenant_id=$2 ORDER BY m.created_at ASC LIMIT 10001`, [conversationId, context.tenantId])
  if (messages.rows.length > 10000) throw new AdminMenuError(503, 'Conversation is too large')
  return { conversation: dateValues(current), messages: messages.rows.map(dateValues) }
}
export async function writeAdminChatNote(query: AdminMenuQuery, context: AdminChatContext, conversationId: string, input: unknown) {
  await authorized(query, context, true); id(conversationId)
  const body = object(input), note = body.admin_note ?? null
  if (note !== null && typeof note !== 'string') throw new AdminMenuError(400, 'Invalid note')
  const result = await query('UPDATE public.chat_conversations SET admin_note=$3 WHERE id=$1 AND tenant_id=$2 RETURNING id', [conversationId, context.tenantId, note])
  if (result.rows.length !== 1) throw new AdminMenuError(404, 'Conversation not found')
  return { ok: true }
}
export async function readAdminChatBlocked(query: AdminMenuQuery, context: AdminChatContext) {
  await authorized(query, context)
  const result = await query('SELECT id,phone_hash,blocked_at,reason FROM public.chat_blocked_phones WHERE tenant_id=$1 ORDER BY blocked_at DESC LIMIT 10001', [context.tenantId])
  if (result.rows.length > 10000) throw new AdminMenuError(503, 'Blocklist is too large')
  return { blocked: result.rows.map(dateValues) }
}
async function phoneLock(query: AdminMenuQuery, context: AdminChatContext, hash: unknown) {
  if (typeof hash !== 'string') throw new AdminMenuError(503, 'Invalid conversation')
  await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`xmartmenu-chat-session:${context.tenantId}:${hash}`])
}
export async function blockAdminChatPhone(query: AdminMenuQuery, context: AdminChatContext, conversationId: string, input: unknown) {
  await authorized(query, context, true)
  const current = await conversation(query, context, conversationId), reason = object(input).reason ?? null
  if (reason !== null && typeof reason !== 'string') throw new AdminMenuError(400, 'Invalid reason')
  await phoneLock(query, context, current.phone_hash)
  const locked = await query('SELECT phone_hash FROM public.chat_conversations WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [conversationId, context.tenantId])
  if (locked.rows.length !== 1 || locked.rows[0].phone_hash !== current.phone_hash) throw new AdminMenuError(409, 'Conversation identity changed')
  await query(`INSERT INTO public.chat_blocked_phones(tenant_id,phone_hash,blocked_by,reason) VALUES($1,$2,$3,$4)
    ON CONFLICT(tenant_id,phone_hash) DO UPDATE SET blocked_by=EXCLUDED.blocked_by,reason=EXCLUDED.reason`, [context.tenantId, current.phone_hash, context.actorId, reason])
  await query("UPDATE public.chat_conversations SET status='blocked' WHERE tenant_id=$1 AND phone_hash=$2", [context.tenantId, current.phone_hash])
  return { ok: true }
}
export async function unblockAdminChatPhone(query: AdminMenuQuery, context: AdminChatContext, blockedId: string) {
  await authorized(query, context, true); id(blockedId)
  const current = await query('SELECT phone_hash FROM public.chat_blocked_phones WHERE id=$1 AND tenant_id=$2', [blockedId, context.tenantId])
  if (current.rows.length !== 1) throw new AdminMenuError(404, 'Not found')
  const hash = current.rows[0].phone_hash
  await phoneLock(query, context, hash)
  const deleted = await query('DELETE FROM public.chat_blocked_phones WHERE id=$1 AND tenant_id=$2 AND phone_hash=$3 RETURNING id', [blockedId, context.tenantId, hash])
  if (deleted.rows.length !== 1) throw new AdminMenuError(404, 'Not found')
  await query("UPDATE public.chat_conversations SET status='active' WHERE tenant_id=$1 AND phone_hash=$2", [context.tenantId, hash])
  return { ok: true }
}
