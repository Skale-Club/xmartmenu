// =============================================================================
// Telegram por escopo (autoblog-parity XM-16).
//
// O blog de cada restaurante opera pelo Telegram como o da plataforma. Um só
// endpoint serve todos, e o que decide de quem é cada toque é O SEGREDO: cada
// linha de telegram_settings tem o seu, e o webhook procura a linha por ele.
//
// O que estes testes protegem é a consequência disso. Se a resolução do escopo
// falhar para o lado errado, o bot de um restaurante publica no site de outro —
// e o id do post vem do callback_data, que é de quem tocar no botão.
// =============================================================================
import { describe, expect, it } from 'vitest'

import {
  buildApprovalCallbackData,
  parseApprovalCallbackData,
  resolveApprovalsBotToken,
  resolveApprovalsChatIds,
  sendDraftForApproval,
  webhookUrl,
  type TelegramSettingsRow,
} from '@/lib/blog/telegram'

function settings(over: Partial<TelegramSettingsRow> = {}): TelegramSettingsRow {
  return {
    enabled: true,
    bot_token: 'bot-geral',
    chat_ids: ['-100111'],
    approvals_enabled: true,
    approvals_bot_token: null,
    approvals_chat_ids: [],
    webhook_secret: 'segredo',
    ...over,
  }
}

describe('URL do webhook', () => {
  it('é o mesmo para a plataforma e para todos os restaurantes', () => {
    // Um URL por restaurante poria o id do tenant no caminho, ou seja poria a
    // identidade num sítio que o atacante escolhe, ao lado de um segredo que
    // ele não escolhe. Só o segredo prova alguma coisa, portanto só ele decide.
    expect(webhookUrl('https://xmartmenu.com')).toBe(
      'https://xmartmenu.com/api/internal/blog/telegram-webhook',
    )
  })

  it('não duplica a barra quando o site já traz uma', () => {
    expect(webhookUrl('https://xmartmenu.com/')).toBe(
      'https://xmartmenu.com/api/internal/blog/telegram-webhook',
    )
  })
})

describe('cartão de aprovação', () => {
  function capture() {
    const sent: Array<{ url: string; body: Record<string, unknown> }> = []
    const original = globalThis.fetch
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      sent.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) })
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as typeof fetch
    return { sent, restore: () => { globalThis.fetch = original } }
  }

  it('fala português e aponta para o painel do restaurante', async () => {
    const { sent, restore } = capture()
    try {
      await sendDraftForApproval(
        settings(),
        { id: 'p1', title: 'A melhor pizza do bairro', excerpt: null, pillarLabel: 'Bairro' },
        { panelUrl: 'https://xmartmenu.com/posts', audience: 'tenant', label: 'Pizzaria do Zé' },
      )
    } finally {
      restore()
    }
    const text = String(sent[0].body.text)
    expect(text).toContain('Novo rascunho do blog à espera de aprovação')
    // O nome vai no cartão porque quem aprova pode gerir mais do que um
    // restaurante; sem ele, dois cartões seguidos são indistinguíveis.
    expect(text).toContain('Pizzaria do Zé')
    expect(text).toContain('https://xmartmenu.com/posts')
    expect(text).not.toContain('superadmin')

    const keyboard = sent[0].body.reply_markup as {
      inline_keyboard: Array<Array<{ text: string; callback_data: string }>>
    }
    expect(keyboard.inline_keyboard[0][0].text).toContain('Aprovar')
    expect(keyboard.inline_keyboard[0][1].text).toContain('Rejeitar')
  })

  it('fala inglês e aponta para o console da plataforma', async () => {
    const { sent, restore } = capture()
    try {
      await sendDraftForApproval(
        settings(),
        { id: 'p1', title: 'Menu engineering', excerpt: null },
        { panelUrl: 'https://xmartmenu.com/admin/blog', audience: 'platform' },
      )
    } finally {
      restore()
    }
    const text = String(sent[0].body.text)
    expect(text).toContain('New blog draft awaiting approval')
    expect(text).toContain('https://xmartmenu.com/admin/blog')
  })

  it('escapa HTML no título — o título vem de um modelo, não de nós', async () => {
    const { sent, restore } = capture()
    try {
      await sendDraftForApproval(
        settings(),
        { id: 'p1', title: 'Pizza <b>&</b> massa', excerpt: null },
        { panelUrl: 'https://x.com/posts', audience: 'tenant' },
      )
    } finally {
      restore()
    }
    const text = String(sent[0].body.text)
    // parse_mode é HTML: um título com tags desformataria a mensagem, e no
    // limite injetaria um link no cartão de aprovação.
    expect(text).toContain('Pizza &lt;b&gt;&amp;&lt;/b&gt; massa')
  })

  it('não envia nada quando as aprovações estão desligadas', async () => {
    const { sent, restore } = capture()
    try {
      const result = await sendDraftForApproval(
        settings({ approvals_enabled: false }),
        { id: 'p1', title: 'x', excerpt: null },
        { panelUrl: 'https://x.com/posts', audience: 'tenant' },
      )
      expect(result).toBeNull()
    } finally {
      restore()
    }
    expect(sent).toHaveLength(0)
  })

  it('usa o bot dedicado de aprovações quando existe', () => {
    // O bot que carrega um webhook público não deve ser o que envia tudo o
    // resto: pode ser revogado sozinho, e um segredo vazado não compra nada no
    // canal de notificações.
    expect(resolveApprovalsBotToken(settings({ approvals_bot_token: 'bot-aprovacoes' }))).toBe(
      'bot-aprovacoes',
    )
    expect(resolveApprovalsBotToken(settings())).toBe('bot-geral')
  })

  it('cai para chat_ids só quando não há lista de aprovações', () => {
    expect(resolveApprovalsChatIds(settings({ approvals_chat_ids: ['-100222'] }))).toEqual(['-100222'])
    expect(resolveApprovalsChatIds(settings())).toEqual(['-100111'])
  })
})

describe('callback_data', () => {
  it('cabe nos 64 bytes do Telegram com um uuid', () => {
    const data = buildApprovalCallbackData('approve', '123e4567-e89b-12d3-a456-426614174000')
    expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64)
    expect(parseApprovalCallbackData(data)).toEqual({
      action: 'approve',
      postId: '123e4567-e89b-12d3-a456-426614174000',
    })
  })

  it('recusa o que não reconhece em vez de adivinhar', () => {
    // O callback_data é de quem toca no botão. Qualquer indulgência aqui é uma
    // decisão tomada com um dado que o atacante escolheu.
    for (const bad of ['', 'blog:', 'blog:approve:', 'blog:delete:x', 'outro:approve:x', 'blog:approve:x:y']) {
      expect(parseApprovalCallbackData(bad)).toBeNull()
    }
  })
})
