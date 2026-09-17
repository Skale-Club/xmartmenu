// =============================================================================
// O webhook de aprovações, por escopo (autoblog-parity XM-16).
//
// UM endpoint serve a plataforma e todos os restaurantes, e O SEGREDO É O
// ESCOPO. Estes testes existem por causa da consequência: o id do post vem do
// callback_data, que é de quem tocar no botão. Se a resolução do escopo falhar
// para o lado errado, o bot de um restaurante publica no site de outro.
// =============================================================================
import { describe, expect, it, vi, beforeEach } from 'vitest'

// ─── um Supabase falso, com o mínimo do PostgREST que a rota usa ────────────

interface Row { [k: string]: unknown }

/**
 * Um Supabase falso com o mínimo do PostgREST que a rota usa — e, sobretudo,
 * com a MESMA ORDEM de encadeamento: `scopeFilter` filtra o resultado de
 * `from()`, antes do `.select()`. Um duplo que só aceitasse a ordem inversa
 * passaria em testes que o código real nunca executa.
 *
 * `.eq` compara; `.is('tenant_id', null)` casa só com NULL — é essa a diferença
 * de que o escopo da plataforma depende.
 */
function makeClient(tables: Record<string, Row[]>) {
  function builder(table: string) {
    const filters: Array<(r: Row) => boolean> = []
    let op: 'select' | 'update' | 'insert' | 'delete' = 'select'
    let payload: Row | undefined

    const matching = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)))

    const run = () => {
      const rows = matching()
      if (op === 'update') for (const r of rows) Object.assign(r, payload)
      if (op === 'delete') tables[table] = (tables[table] ?? []).filter((r) => !rows.includes(r))
      if (op === 'insert') (tables[table] ??= []).push(payload as Row)
      return { data: rows, error: null }
    }

    const chain = {
      select: () => chain,
      update(next: Row) { op = 'update'; payload = next; return chain },
      insert(next: Row) { op = 'insert'; payload = next; return chain },
      delete() { op = 'delete'; return chain },
      eq(col: string, val: unknown) { filters.push((r) => r[col] === val); return chain },
      is(col: string, val: unknown) {
        filters.push((r) => (val === null ? r[col] === null || r[col] === undefined : r[col] === val))
        return chain
      },
      maybeSingle: async () => ({ data: run().data[0] ?? null }),
      // Thenable a sério, e não um atalho: a rota faz
      // `.then(undefined, () => undefined)` no insert de feedback, para que
      // perder o sinal nunca desfaça a decisão já tomada. Um `then` que
      // assumisse sempre uma função rebentaria exatamente nesse caminho.
      then(
        resolve?: ((v: { data: Row[]; error: null }) => unknown) | null,
        reject?: ((e: unknown) => unknown) | null,
      ) {
        try {
          const value = run()
          return Promise.resolve(resolve ? resolve(value) : value)
        } catch (err) {
          return reject ? Promise.resolve(reject(err)) : Promise.reject(err)
        }
      },
    }
    return chain
  }

  return { tables, from: (table: string) => builder(table) }
}

let client = makeClient({})

vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => client }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { POST } = await import('@/app/api/internal/blog/telegram-webhook/route')

const PLATFORM_SECRET = 'a'.repeat(64)
const REST_A_SECRET = 'b'.repeat(64)
const PLATFORM_CHAT = '-1001000000000'
const REST_A_CHAT = '-1002000000000'

function seed() {
  return makeClient({
    telegram_settings: [
      {
        id: 's0', tenant_id: null, webhook_secret: PLATFORM_SECRET,
        enabled: true, approvals_enabled: true,
        bot_token: null, approvals_bot_token: null,
        chat_ids: [PLATFORM_CHAT], approvals_chat_ids: [],
      },
      {
        id: 's1', tenant_id: 'rest-a', webhook_secret: REST_A_SECRET,
        enabled: true, approvals_enabled: true,
        bot_token: null, approvals_bot_token: null,
        // Com tópico de fórum, para provar que a comparação usa a parte do chat
        // e não a string inteira.
        chat_ids: [`${REST_A_CHAT}:42`], approvals_chat_ids: [],
      },
    ],
    blog_posts: [
      { id: 'post-plataforma', tenant_id: null, title: 'P', excerpt: null, status: 'draft' },
      { id: 'post-a', tenant_id: 'rest-a', title: 'A', excerpt: null, status: 'draft' },
      { id: 'post-b', tenant_id: 'rest-b', title: 'B', excerpt: null, status: 'draft' },
    ],
    blog_post_feedback: [],
    tenants: [{ id: 'rest-a', slug: 'pizzaria-do-ze' }],
  })
}

function tap(
  secret: string | null,
  postId: string,
  action = 'approve',
  chatId: string = secret === PLATFORM_SECRET ? PLATFORM_CHAT : REST_A_CHAT,
) {
  return POST(
    new Request('https://x.com/api/internal/blog/telegram-webhook', {
      method: 'POST',
      headers: secret ? { 'x-telegram-bot-api-secret-token': secret } : {},
      body: JSON.stringify({
        callback_query: {
          id: 'cb1',
          data: `blog:${action}:${postId}`,
          message: { chat: { id: Number(chatId) } },
        },
      }),
    }),
  )
}

beforeEach(() => { client = seed() })

describe('autenticação', () => {
  it('recusa sem cabeçalho', async () => {
    expect((await tap(null, 'post-a')).status).toBe(401)
  })

  it('recusa um segredo que não é de ninguém', async () => {
    expect((await tap('c'.repeat(64), 'post-a')).status).toBe(401)
  })

  it('recusa o segredo de um escopo com aprovações desligadas', async () => {
    client.tables.telegram_settings[1].approvals_enabled = false
    expect((await tap(REST_A_SECRET, 'post-a')).status).toBe(401)
  })
})

describe('o chat de origem', () => {
  it('recusa um toque vindo de uma conversa não configurada', async () => {
    // O bot pode ser adicionado a outro grupo, por engano ou não. Um chat que
    // não pode RECEBER um cartão também não pode agir sobre um.
    const res = await tap(REST_A_SECRET, 'post-a', 'approve', '-1009999999999')
    expect(await res.json()).toEqual({ ok: true, ignored: true })
    expect(client.tables.blog_posts.find((p) => p.id === 'post-a')!.status).toBe('draft')
  })

  it('recusa um toque sem chat de origem nenhum', async () => {
    const res = await POST(
      new Request('https://x.com/w', {
        method: 'POST',
        headers: { 'x-telegram-bot-api-secret-token': REST_A_SECRET },
        body: JSON.stringify({ callback_query: { id: 'cb1', data: 'blog:approve:post-a' } }),
      }),
    )
    expect(await res.json()).toEqual({ ok: true, ignored: true })
    expect(client.tables.blog_posts.find((p) => p.id === 'post-a')!.status).toBe('draft')
  })

  it('aceita o chat configurado com tópico de fórum', async () => {
    // chat_ids guarda "-100...:42"; o Telegram envia só o número do chat.
    const res = await tap(REST_A_SECRET, 'post-a', 'approve', REST_A_CHAT)
    expect(await res.json()).toEqual({ ok: true, action: 'approved' })
  })
})

describe('o segredo decide o escopo', () => {
  it('o restaurante aprova o post dele', async () => {
    const res = await tap(REST_A_SECRET, 'post-a')
    expect(await res.json()).toEqual({ ok: true, action: 'approved' })
    expect(client.tables.blog_posts.find((p) => p.id === 'post-a')!.status).toBe('published')
    // O feedback fica com o escopo certo, senão a aprendizagem de um
    // restaurante alimentaria o prompt de outro.
    expect(client.tables.blog_post_feedback[0]).toMatchObject({
      tenant_id: 'rest-a',
      verdict: 'approved',
      decided_by: 'telegram',
    })
  })

  it('o restaurante NÃO alcança o post da plataforma, mesmo acertando no id', async () => {
    const res = await tap(REST_A_SECRET, 'post-plataforma')
    expect(await res.json()).toEqual({ ok: true, ignored: true })
    expect(client.tables.blog_posts.find((p) => p.id === 'post-plataforma')!.status).toBe('draft')
  })

  it('o restaurante NÃO alcança o post de outro restaurante', async () => {
    // É este o caso que custa dinheiro a um cliente: publicar no site de outro.
    const res = await tap(REST_A_SECRET, 'post-b')
    expect(await res.json()).toEqual({ ok: true, ignored: true })
    expect(client.tables.blog_posts.find((p) => p.id === 'post-b')!.status).toBe('draft')
  })

  it('a plataforma NÃO alcança o post de um restaurante', async () => {
    const res = await tap(PLATFORM_SECRET, 'post-a')
    expect(await res.json()).toEqual({ ok: true, ignored: true })
    expect(client.tables.blog_posts.find((p) => p.id === 'post-a')!.status).toBe('draft')
  })

  it('a plataforma aprova o post dela', async () => {
    const res = await tap(PLATFORM_SECRET, 'post-plataforma')
    expect(await res.json()).toEqual({ ok: true, action: 'approved' })
    expect(client.tables.blog_post_feedback[0]).toMatchObject({ tenant_id: null })
  })

  it('fora do escopo responde igual a inexistente', async () => {
    // Responder diferente diria a quem tentasse que o id existe noutro blog.
    const foraDoEscopo = await (await tap(REST_A_SECRET, 'post-b')).json()
    const inexistente = await (await tap(REST_A_SECRET, 'nao-existe')).json()
    expect(foraDoEscopo).toEqual(inexistente)
  })
})

describe('rejeição', () => {
  it('grava o feedback ANTES de apagar, e no escopo certo', async () => {
    const res = await tap(REST_A_SECRET, 'post-a', 'reject')
    expect(await res.json()).toEqual({ ok: true, action: 'rejected' })
    // O sinal tem de sobreviver ao post — é para isso que existe.
    expect(client.tables.blog_post_feedback[0]).toMatchObject({
      tenant_id: 'rest-a',
      post_title: 'A',
      verdict: 'rejected',
    })
    expect(client.tables.blog_posts.find((p) => p.id === 'post-a')).toBeUndefined()
  })
})

describe('idempotência', () => {
  it('um segundo toque em Aprovar não duplica nada', async () => {
    await tap(REST_A_SECRET, 'post-a')
    await tap(REST_A_SECRET, 'post-a')
    // Dois editores a tocar ao mesmo tempo, ou um toque repetido, não são erro.
    expect(client.tables.blog_post_feedback).toHaveLength(1)
  })

  it('uma atualização que não é um toque é reconhecida e ignorada', async () => {
    // O Telegram repete tudo o que não for 2xx: responder erro a uma mensagem
    // normal do grupo poria o endpoint num ciclo de repetições.
    const res = await POST(
      new Request('https://x.com/w', {
        method: 'POST',
        headers: { 'x-telegram-bot-api-secret-token': REST_A_SECRET },
        body: JSON.stringify({ message: { text: 'bom dia' } }),
      }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, ignored: true })
  })
})
