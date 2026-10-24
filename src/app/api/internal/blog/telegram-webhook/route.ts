/**
 * Telegram approval webhook (autoblog-parity XM-08 + XM-16).
 *
 * This is a PUBLIC endpoint. What proves a request actually came from Telegram
 * is the shared secret echoed in X-Telegram-Bot-Api-Secret-Token, registered
 * with setWebhook. The chat_id and the callback_data in the body are entirely
 * attacker-controlled and prove nothing on their own — which is why the check
 * below is the FIRST thing that happens, before the body is even read.
 *
 * UM endpoint serve a plataforma E todos os restaurantes, porque O SEGREDO É O
 * ESCOPO: cada linha de telegram_settings tem o seu, 32 bytes aleatórios, único
 * na tabela por índice. Autenticar e identificar são portanto a mesma operação,
 * e nunca podem discordar. A alternativa — um URL por restaurante — punha o id
 * do tenant no caminho, ou seja punha a identidade num sítio que o atacante
 * escolhe, ao lado de um segredo que ele não escolhe. Não vale a pena ter as
 * duas coisas quando só uma delas prova alguma coisa.
 *
 * O escopo assim resolvido filtra TUDO o que se segue. Um bot de restaurante
 * não alcança o rascunho da plataforma nem o de outro restaurante, mesmo que
 * lhe acertem no id: o id vem do callback_data, que é do atacante.
 *
 * @server-only: called by Telegram, never from a browser.
 */
import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { revalidatePath } from 'next/cache'

import { createServiceClient } from '@/lib/supabase/server'
import {
  answerCallbackQuery,
  isChatAllowed,
  parseApprovalCallbackData,
  resolveApprovalsBotToken,
  type TelegramSettingsRow,
} from '@/lib/blog/telegram'
import { decryptApiKey } from '@/lib/crypto'
import { scopeColumn, scopeFilter, type BlogScope } from '@/lib/blog/scope'

/**
 * O toque no botão só dá retorno por aqui. Quem aprovou está no telemóvel, num
 * grupo — não vê painel nenhum, portanto este texto é tudo o que recebe. Em
 * português para o dono do restaurante, em inglês para a equipa da plataforma.
 */
const TOASTS = {
  approved: { platform: 'Published.', tenant: 'Publicado no seu site.' },
  rejected: { platform: 'Rejected and deleted.', tenant: 'Descartado.' },
  gone: { platform: 'That draft is no longer available.', tenant: 'Esse rascunho já não existe.' },
  unauthorised: { platform: 'This chat is not authorised.', tenant: 'Esta conversa não tem permissão.' },
  unsupported: { platform: 'Unsupported action.', tenant: 'Ação não reconhecida.' },
} as const

/** Um token que não decifra é um token perdido, não uma exceção a propagar. */
function decryptOrNull(encrypted: string | null | undefined): string | null {
  if (!encrypted) return null
  try {
    return decryptApiKey(encrypted) || null
  } catch {
    return null
  }
}

function secretMatches(provided: string, expected: string): boolean {
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
  const provided = request.headers.get('x-telegram-bot-api-secret-token')
  // Sem cabeçalho não há nada de legítimo a chegar aqui. 401 e não 503: quem
  // não está autenticado não aprende nada de qualquer maneira, e mantém o modo
  // de falha uniforme.
  if (!provided) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const svc = createServiceClient()

  // Procura pelo segredo, não pelo escopo — é o segredo que diz qual é o
  // escopo. O índice único parcial em webhook_secret (migração 059) é o que
  // garante que esta pergunta tem no máximo uma resposta; sem ele, dois escopos
  // com o mesmo segredo dariam uma confusão de escopo silenciosa.
  const { data } = await svc
    .from('telegram_settings')
    .select('*')
    .eq('webhook_secret', provided)
    .maybeSingle()

  const settings = data as (TelegramSettingsRow & { tenant_id: string | null }) | null

  // A comparação constante repete o que o `.eq` já fez. Não é redundância
  // inútil: o `.eq` é uma comparação de índice do Postgres, e é aqui que a
  // decisão final é tomada — se um dia a procura passar a ser por outra coisa,
  // esta linha continua a ser a que decide.
  if (
    !settings?.webhook_secret ||
    !settings.approvals_enabled ||
    !secretMatches(provided, settings.webhook_secret)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const scope: BlogScope = settings.tenant_id

  const update = (await request.json().catch(() => null)) as {
    callback_query?: {
      id?: string
      data?: string
      from?: { id?: number }
      message?: { chat?: { id?: number } }
    }
  } | null

  const query = update?.callback_query
  const callbackData = query?.data
  if (!callbackData) {
    // Telegram retries anything that is not a 2xx, and a message update we do
    // not handle is not an error — acknowledging it stops the retry loop.
    return NextResponse.json({ ok: true, ignored: true })
  }

  // O bot com que respondemos é o MESMO que enviou o cartão — responder com
  // outro daria "query is too old" e o botão ficava a rodar na mesma.
  const plainSettings: TelegramSettingsRow = {
    ...settings,
    bot_token: decryptOrNull(settings.bot_token),
    approvals_bot_token: decryptOrNull(settings.approvals_bot_token),
  }
  const botToken = resolveApprovalsBotToken(plainSettings)
  const toast = (key: keyof typeof TOASTS) =>
    TOASTS[key][scope === null ? 'platform' : 'tenant']

  // Terceira barreira, depois do segredo: um chat que não pode RECEBER um
  // cartão também não pode agir sobre um. Protege o caso de o bot ser
  // adicionado a outro grupo — por engano ou não — e alguém lá tocar no botão
  // de um cartão reencaminhado.
  if (!isChatAllowed(plainSettings, query?.message?.chat?.id)) {
    if (botToken && query?.id) await answerCallbackQuery(botToken, query.id, toast('unauthorised'))
    return NextResponse.json({ ok: true, ignored: true })
  }

  const parsed = parseApprovalCallbackData(callbackData)
  if (!parsed) {
    if (botToken && query?.id) await answerCallbackQuery(botToken, query.id, toast('unsupported'))
    return NextResponse.json({ ok: true, ignored: true })
  }

  const { data: post } = await scopeFilter(svc.from('blog_posts').select('id, title, excerpt, status'), scope)
    .eq('id', parsed.postId)
    .maybeSingle()

  // Não encontrado é o mesmo que fora do escopo, de propósito: responder de
  // forma diferente diria a quem tentasse que o id existe noutro blog.
  if (!post) {
    if (botToken && query?.id) await answerCallbackQuery(botToken, query.id, toast('gone'))
    return NextResponse.json({ ok: true, ignored: true })
  }
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
          ...scopeColumn(scope),
          post_id: row.id,
          post_title: row.title,
          post_excerpt: row.excerpt,
          verdict: 'approved',
          decided_by: 'telegram',
        })
        .then(undefined, () => undefined)
    }
    await revalidateForScope(svc, scope)
    if (botToken && query?.id) await answerCallbackQuery(botToken, query.id, toast('approved'))
    return NextResponse.json({ ok: true, action: 'approved' })
  }

  // Reject: the feedback row is written BEFORE the delete and snapshots the
  // title and excerpt, because the whole point is that the signal survives the
  // post it came from.
  await svc.from('blog_post_feedback').insert({
    ...scopeColumn(scope),
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

  if (botToken && query?.id) await answerCallbackQuery(botToken, query.id, toast('rejected'))
  return NextResponse.json({ ok: true, action: 'rejected' })
}

/**
 * A página a revalidar depende do escopo: o blog da plataforma vive em /blog, o
 * de um restaurante em /<slug>/blog. Revalidar a errada deixaria o post
 * aprovado invisível até o cache expirar sozinho — o autor tocaria em Aprovar,
 * veria "ok", e não encontraria nada no site.
 */
async function revalidateForScope(
  svc: ReturnType<typeof createServiceClient>,
  scope: BlogScope,
): Promise<void> {
  if (scope === null) {
    revalidatePath('/blog')
    return
  }
  const { data } = await svc.from('tenants').select('slug').eq('id', scope).maybeSingle()
  const slug = (data as { slug: string } | null)?.slug
  if (slug) {
    revalidatePath(`/${slug}/blog`)
    revalidatePath(`/${slug}/blog/[postSlug]`, 'page')
  }
}
