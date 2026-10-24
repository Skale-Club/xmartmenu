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
 * Onde a aprovação é feita no ecrã, e em que língua o cartão fala.
 *
 * A plataforma e um restaurante aprovam em painéis diferentes, e falam a
 * públicos diferentes: um é a equipa da Skale Club, o outro é o dono de um
 * restaurante que não sabe o que é um "pillar". Um cartão só, em inglês, a
 * apontar para /superadmin/blog, servia um e mentia ao outro.
 */
export interface ApprovalCardTarget {
  /** Link absoluto para o painel onde este rascunho se aprova. */
  panelUrl: string
  audience: 'platform' | 'tenant'
  /** Nome do restaurante, para o cartão dizer de quem é o rascunho. */
  label?: string
}

const CARD_COPY = {
  platform: {
    heading: 'New blog draft awaiting approval',
    pillar: 'Pillar',
    approve: '✅ Approve & publish',
    reject: '❌ Reject',
  },
  tenant: {
    heading: 'Novo rascunho do blog à espera de aprovação',
    pillar: 'Tema',
    approve: '✅ Aprovar e publicar',
    reject: '❌ Rejeitar',
  },
} as const

/**
 * Push a generated draft to the approval chats with Approve/Reject buttons.
 *
 * Fire-and-forget at the call site: the post is already saved, and a
 * notification problem must never fail a generation run.
 */
export async function sendDraftForApproval(
  settings: TelegramSettingsRow,
  draft: { id: string; title: string; excerpt: string | null; pillarLabel?: string },
  target: ApprovalCardTarget,
): Promise<SendResult | null> {
  if (!settings.enabled || !settings.approvals_enabled) return null

  const botToken = resolveApprovalsBotToken(settings)
  const chatIds = resolveApprovalsChatIds(settings)
  if (!botToken || chatIds.length === 0) return null

  const copy = CARD_COPY[target.audience]
  const lines = [`<b>${copy.heading}</b>`]
  // O nome do restaurante vai no cartão porque quem aprova pode gerir mais do
  // que um. Sem ele, dois cartões seguidos são indistinguíveis.
  if (target.label) lines.push(escapeHtml(target.label))
  lines.push('', `<b>${escapeHtml(draft.title)}</b>`)
  if (draft.excerpt) lines.push('', escapeHtml(draft.excerpt))
  if (draft.pillarLabel) lines.push('', `${copy.pillar}: ${escapeHtml(draft.pillarLabel)}`)
  lines.push('', target.panelUrl)

  return sendToAll(botToken, chatIds, lines.join('\n'), {
    inline_keyboard: [
      [
        { text: copy.approve, callback_data: buildApprovalCallbackData('approve', draft.id) },
        { text: copy.reject, callback_data: buildApprovalCallbackData('reject', draft.id) },
      ],
    ],
  })
}

// ─── Registo do webhook ──────────────────────────────────────────────────────
//
// Até aqui o webhook tinha de ser registado à mão, com um curl, por cada bot.
// Para a plataforma isso era um incómodo; para os restaurantes seria o fim da
// funcionalidade — ninguém vai pedir ao dono de uma pizzaria que faça um pedido
// à API do Telegram. O registo passa a acontecer quando ele grava as definições.

/** O URL público deste webhook. Um só, para a plataforma e para todos os restaurantes. */
export function webhookUrl(siteUrl: string): string {
  return `${siteUrl.replace(/\/$/, '')}/api/internal/blog/telegram-webhook`
}

/**
 * Regista o webhook com o segredo deste escopo.
 *
 * `allowed_updates: ['callback_query']` não é afinação: sem isso o Telegram
 * envia TODAS as mensagens do chat para o endpoint, e um grupo com conversa
 * passa a martelá-lo por nada.
 */
export async function setTelegramWebhook(
  botToken: string,
  url: string,
  secretToken: string,
): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${botToken}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, secret_token: secretToken, allowed_updates: ['callback_query'] }),
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
    })
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string }
    if (!res.ok || !json.ok) {
      return { ok: false, message: json.description ?? `Telegram setWebhook falhou (${res.status})` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}

/** O que o Telegram julga que o webhook é — a entrada do reconciliador. */
export async function getTelegramWebhookInfo(
  botToken: string,
): Promise<{ ok: boolean; url?: string; lastErrorMessage?: string; message?: string }> {
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${botToken}/getWebhookInfo`, {
      method: 'GET',
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
    })
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      description?: string
      result?: { url?: string; last_error_message?: string }
    }
    if (!res.ok || !json.ok) {
      return { ok: false, message: json.description ?? `getWebhookInfo falhou (${res.status})` }
    }
    return { ok: true, url: json.result?.url, lastErrorMessage: json.result?.last_error_message }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}

/** Desregista. Chamado quando as aprovações são desligadas, para o bot deixar de nos chamar. */
export async function deleteTelegramWebhook(
  botToken: string,
): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${botToken}/deleteWebhook`, {
      method: 'POST',
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
    })
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string }
    if (!res.ok || !json.ok) {
      return { ok: false, message: json.description ?? `deleteWebhook falhou (${res.status})` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}

/**
 * Responde ao toque no botão.
 *
 * Sem isto o Telegram deixa o botão a rodar até desistir sozinho: quem aprovou
 * não sabe se aprovou. O texto é o único retorno que a pessoa recebe, porque
 * ela não está no painel — está no telemóvel, num grupo.
 *
 * Nunca lança: chega DEPOIS da decisão estar tomada e gravada, portanto uma
 * falha aqui não pode desfazer nada nem transformar-se num erro para o Telegram
 * (que reentregaria a mesma atualização durante horas).
 */
export async function answerCallbackQuery(
  botToken: string,
  callbackQueryId: string,
  text: string,
): Promise<void> {
  try {
    await fetch(`${TELEGRAM_API}/bot${botToken}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text, show_alert: false }),
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
    })
  } catch {
    // Deliberadamente engolido — ver acima.
  }
}

/**
 * O chat de onde veio o toque está autorizado a agir?
 *
 * Um chat que não pode RECEBER um cartão de aprovação também não pode agir
 * sobre um. Compara-se contra a mesma lista para onde o cartão foi enviado, e
 * o id chega como número no corpo do Telegram mas está guardado como texto,
 * possivelmente com o tópico colado ("-100123:42") — daí comparar pela parte
 * do chat e não pela string inteira.
 */
export function isChatAllowed(settings: TelegramSettingsRow, chatId: unknown): boolean {
  if (chatId === undefined || chatId === null) return false
  const incoming = String(chatId)
  return resolveApprovalsChatIds(settings).some((entry) => {
    const target = parseTelegramTarget(entry)
    return (target?.chatId ?? entry) === incoming
  })
}
