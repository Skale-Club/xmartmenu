// =============================================================================
// src/lib/blog/telegram.ts
//
// Telegram delivery for blog approval cards (autoblog-parity XM-08, MASTER §6).
//
// Destinations come from telegram_settings.chat_ids / approvals_chat_ids, arrays
// whose entries are a chat id or "<chat_id>:<thread_id>" for a forum topic. One
// shape covers a private chat, a group, a supergroup and a topic inside one.
//
// Why the thread matters: a supergroup with forum topics enabled REFUSES a
// message that carries no message_thread_id when its General topic is closed,
// and files it in the wrong topic otherwise. Both failures are invisible from
// inside the product — the send "succeeds" and nobody sees the message.
//
// Approvals ride a SEPARATE bot token when one is set. The bot carrying a public
// webhook should not be the one sending other notifications: it can be revoked on its own,
// and a leaked webhook secret buys nothing on the notification channel.
// =============================================================================
import { parseTelegramTarget, type TelegramApprovalAction } from '@/lib/blog/contract'

const TELEGRAM_API = 'https://api.telegram.org'
const TELEGRAM_TIMEOUT_MS = 15_000

export interface TelegramSettingsRow {
  enabled: boolean
  bot_token: string | null
  chat_ids: string[]
  approvals_enabled: boolean
  approvals_bot_token: string | null
  approvals_chat_ids: string[]
  webhook_secret: string | null
}

export interface InlineKeyboard {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>
}

export interface SendResult {
  success: boolean
  delivered: number
  failures: Array<{ chatId: string; message: string }>
}

/** The bot approvals use: the dedicated one when set, otherwise the notification bot. */
export function resolveApprovalsBotToken(settings: TelegramSettingsRow): string | null {
  return settings.approvals_bot_token?.trim() || settings.bot_token?.trim() || null
}

/**
 * Where approval cards go. Kept separate from chat_ids because that list is the
 * notification list: an editor added there to receive drafts would also start getting
 * every other notification.
 */
export function resolveApprovalsChatIds(settings: TelegramSettingsRow): string[] {
  const dedicated = (settings.approvals_chat_ids ?? []).filter(Boolean)
  return dedicated.length > 0 ? dedicated : (settings.chat_ids ?? []).filter(Boolean)
}

async function sendOne(
  botToken: string,
  chatId: string,
  text: string,
  replyMarkup?: InlineKeyboard,
): Promise<{ ok: boolean; description?: string }> {
  // An unparseable id is passed through untouched so Telegram's own description
  // reaches the caller, rather than the message being dropped locally with no
  // explanation.
  const target = parseTelegramTarget(chatId)
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: target?.chatId ?? chatId,
        ...(target?.threadId ? { message_thread_id: target.threadId } : {}),
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
    })
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string }
    if (!res.ok || !json.ok) {
      return { ok: false, description: json.description ?? `Telegram API error (${res.status})` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, description: (err as Error).message }
  }
}

/**
 * Send to every destination.
 *
 * One bad destination must not silence the others: a revoked group, a bot
 * removed from a chat, or a typo in one id would otherwise take down the whole
 * notification. Each is attempted, each failure is collected, and the call
 * counts as successful if anyone received it.
 */
export async function sendToAll(
  botToken: string,
  chatIds: readonly string[],
  text: string,
  replyMarkup?: InlineKeyboard,
): Promise<SendResult> {
  const failures: SendResult['failures'] = []
  let delivered = 0

  for (const chatId of chatIds) {
    const result = await sendOne(botToken, chatId, text, replyMarkup)
    if (result.ok) delivered += 1
    else failures.push({ chatId, message: result.description ?? 'unknown error' })
  }

  return { success: delivered > 0, delivered, failures }
}

export function buildApprovalCallbackData(action: TelegramApprovalAction, postId: string): string {
  // Telegram caps callback_data at 64 bytes. "blog:approve:" + a uuid is 49.
  return `blog:${action}:${postId}`
}

export function parseApprovalCallbackData(
  data: string,
): { action: TelegramApprovalAction; postId: string } | null {
  const parts = data.split(':')
  if (parts.length !== 3 || parts[0] !== 'blog') return null
  if (parts[1] !== 'approve' && parts[1] !== 'reject') return null
  if (!parts[2]) return null
  return { action: parts[1], postId: parts[2] }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Push a generated draft to the approval chats with Approve/Reject buttons.
 *
 * Fire-and-forget at the call site: the post is already saved, and a
 * notification problem must never fail a generation run.
 */
export async function sendDraftForApproval(
  settings: TelegramSettingsRow,
  draft: { id: string; title: string; excerpt: string | null; pillarLabel?: string },
  siteUrl: string,
): Promise<SendResult | null> {
  if (!settings.enabled || !settings.approvals_enabled) return null

  const botToken = resolveApprovalsBotToken(settings)
  const chatIds = resolveApprovalsChatIds(settings)
  if (!botToken || chatIds.length === 0) return null

  const lines = [
    '<b>New blog draft awaiting approval</b>',
    '',
    `<b>${escapeHtml(draft.title)}</b>`,
  ]
  if (draft.excerpt) lines.push('', escapeHtml(draft.excerpt))
  if (draft.pillarLabel) lines.push('', `Pillar: ${escapeHtml(draft.pillarLabel)}`)
  lines.push('', `${siteUrl.replace(/\/$/, '')}/superadmin/blog`)

  return sendToAll(botToken, chatIds, lines.join('\n'), {
    inline_keyboard: [
      [
        { text: '✅ Approve & publish', callback_data: buildApprovalCallbackData('approve', draft.id) },
        { text: '❌ Reject', callback_data: buildApprovalCallbackData('reject', draft.id) },
      ],
    ],
  })
}
