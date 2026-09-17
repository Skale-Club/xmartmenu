// =============================================================================
// src/lib/blog/prompt.ts
//
// SOURCE OF TRUTH for the MACHINERY: xkedule/shared/blog-prompt.ts — sync
// changes to pickNextPillar / pickSeeded / assignPillar / buildPillarSection /
// buildInternalLinksSection / buildKeywordDedupSection / sanitizeGeneratedLinks
// back there (autoblog-parity XM-04, MASTER §5).
//
// The PILLARS are Xmartmenu's own. This is the PLATFORM's marketing blog, not a
// per-tenant feature: the reader is a restaurant owner we are selling to, not
// their diner. So the posts are about running and selling food — menu
// engineering, delivery margins, WhatsApp orders, photos that sell — and the
// product appears as the thing that helps, never as the subject.
//
// Why pillars exist at all: a single "write something useful for restaurants"
// instruction collapses onto one archetype within a handful of posts. Breadth
// cannot be requested in an adjective; it has to be scheduled. One pillar per
// run, rotated least-recently-used, plus a title shape and a length band.
//
// Pure module: no I/O, no clock of its own, so every fragment is assertable.
// =============================================================================

/**
 * Tell the model what day it is.
 *
 * A model has no clock. Asked for something "timely" it guesses from its
 * training distribution rather than from today — which for a restaurant blog is
 * how you end up publishing a Christmas-menu piece in March.
 */
export function todaySection(at: Date, timeZone: string): string {
  const format = (tz: string) =>
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: tz,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(at)

  let today: string
  let zone = timeZone
  try {
    today = format(timeZone)
  } catch {
    zone = 'UTC'
    today = format('UTC')
  }

  return [
    `HOJE É ${today}, no fuso da plataforma (${zone}).`,
    'Você não tem relógio próprio: trate isso como fato e derive daí qualquer referência temporal.',
    'Gancho de data comemorativa, estação ou alta temporada só vale se bater com essa data — as semanas atuais ou as próximas, nunca uma que já passou.',
  ].join('\n')
}

// ─── Length and title shape ──────────────────────────────────────────────────

export interface BlogLengthProfile {
  id: 'quick' | 'standard' | 'deep'
  words: string
  guidance: string
}

export const BLOG_LENGTH_PROFILES: readonly BlogLengthProfile[] = [
  { id: 'quick', words: '700-1000', guidance: 'Resposta direta e focada. Sem encher linguiça para parecer maior.' },
  { id: 'standard', words: '1200-1600', guidance: 'Artigo sólido, com detalhe concreto e exemplos de operação real.' },
  { id: 'deep', words: '2000-2600', guidance: 'Guia definitivo: completo, estruturado, com um FAQ no final.' },
] as const

export const BLOG_TITLE_STYLES: Readonly<Record<string, string>> = {
  question: 'Escreva o título como a pergunta que um dono de restaurante digitaria no Google.',
  'how-to': 'Comece o título com "Como ...".',
  numbered: 'Use um título de lista numerada (ex.: "7 ..."), e entregue exatamente essa lista.',
  statement: 'Use uma afirmação direta e confiante como título. Sem dois-pontos, sem subtítulo.',
  'two-part': 'Um título em duas partes com dois-pontos é permitido aqui ("Tema: o que muda no seu salão").',
}

// ─── Editorial pillars (Xmartmenu: cardápio digital para restaurantes) ───────

export interface BlogPillar {
  id: string
  label: string
  /** Injected into the system message for both the topic and the content call. */
  guidance: string
  titleStyles: readonly string[]
  lengths: readonly BlogLengthProfile['id'][]
  /** Data the pillar cannot work without; used to filter availability. */
  requires?: 'rss' | 'menu' | 'address'
}

export const BLOG_PILLARS: readonly BlogPillar[] = [
  {
    id: 'menu-engineering',
    label: 'Engenharia de cardápio',
    guidance:
      'Como a estrutura do cardápio muda o ticket: ordem dos itens, o que destacar, o que esconder, como nomear e descrever um prato para ele vender mais. Concreto o bastante para o dono aplicar no cardápio dele hoje. NUNCA invente percentuais de margem ou benchmarks de mercado — raciocine sobre mecanismos.',
    titleStyles: ['how-to', 'numbered', 'statement'],
    lengths: ['standard', 'deep'],
  },
  {
    id: 'pricing-margin',
    label: 'Preço e margem',
    guidance:
      'Como o preço de um prato é realmente formado: CMV, perda, embalagem, taxa de aplicativo, o que sobra no fim. Explique a mecânica e o que empurra cada número para cima ou para baixo. Sem números inventados.',
    titleStyles: ['question', 'statement', 'two-part'],
    lengths: ['standard', 'deep'],
  },
  {
    id: 'delivery-vs-direct',
    label: 'Delivery próprio x marketplace',
    guidance:
      'O trade-off real entre vender pelo aplicativo de terceiro e vender direto: alcance contra comissão, quem fica com o cliente, o que muda na operação. Dê um veredito por cenário, inclusive quando o marketplace é a escolha certa.',
    titleStyles: ['question', 'statement', 'numbered'],
    lengths: ['standard'],
  },
  {
    id: 'operations',
    label: 'Operação de salão e cozinha',
    guidance:
      'Um problema concreto do dia a dia — fila no caixa, pedido errado, cozinha afogada no pico, garçom refém do bloquinho — e como resolver: o que muda no processo, quem faz o quê, como saber que melhorou.',
    titleStyles: ['how-to', 'numbered', 'question'],
    lengths: ['quick', 'standard'],
  },
  {
    id: 'mistake-teardown',
    label: 'Erro que custa caro',
    guidance:
      'UM erro que silenciosamente drena dinheiro em restaurante: como ele aparece, por que parece razoável na hora, o que custa em um mês e o que fazer no lugar. Sem espantalho: tem que ser um erro que gente competente comete.',
    titleStyles: ['statement', 'question'],
    lengths: ['quick', 'standard'],
  },
  {
    id: 'photos-and-copy',
    label: 'Foto e descrição que vendem',
    guidance:
      'Como fotografar e descrever prato para cardápio digital: luz, ângulo, o que cortar, quantas palavras, o que a descrição precisa responder antes do cliente perguntar. Prático a ponto de ser executado com um celular.',
    titleStyles: ['how-to', 'numbered'],
    lengths: ['quick', 'standard'],
  },
  {
    id: 'myth-busting',
    label: 'Derrubando mitos',
    guidance:
      'Pegue afirmações que circulam no setor sobre cardápio, delivery, preço ou tecnologia e teste cada uma: veredito primeiro (verdade / mentira / depende), depois o raciocínio. Direto e específico.',
    titleStyles: ['numbered', 'question'],
    lengths: ['quick', 'standard'],
  },
  {
    id: 'industry-reaction',
    label: 'Reagindo à notícia',
    guidance:
      'Parta do item de FONTE no system message e explique o que ele muda NA PRÁTICA para um restaurante brasileiro neste mês: o que fazer com isso, o que ignorar, e por quê. Não resuma a fonte — reaja a ela com opinião.',
    titleStyles: ['statement', 'question', 'two-part'],
    lengths: ['quick', 'standard'],
    requires: 'rss',
  },
] as const

export interface PillarAvailabilityData {
  /** Whether this run has an RSS item to react to. */
  hasRssItem: boolean
  /** Whether the restaurant has dishes on its menu (tenant blogs only). */
  hasMenu?: boolean
  /** Whether the restaurant has an address (tenant blogs only). */
  hasAddress?: boolean
}

/**
 * The catalogue a run rotates over.
 *
 * `catalogue` defaults to the PLATFORM pillars so every existing caller keeps
 * its behaviour; a tenant run passes TENANT_BLOG_PILLARS. The two audiences are
 * genuinely different — see the comment above TENANT_BLOG_PILLARS — and sharing
 * one list would mean a restaurant's blog lecturing its own diners about menu
 * engineering.
 */
export function availablePillars(
  data: PillarAvailabilityData,
  catalogue: readonly BlogPillar[] = BLOG_PILLARS,
): BlogPillar[] {
  return catalogue.filter((p) => {
    if (p.requires === 'rss') return data.hasRssItem
    if (p.requires === 'menu') return data.hasMenu === true
    if (p.requires === 'address') return data.hasAddress === true
    return true
  })
}

/**
 * Least-recently-used rotation. `recentPillarIds` is newest-first (the order job
 * history naturally comes back in). A pillar never used wins outright; otherwise
 * the one whose last use is furthest back. Ties keep catalogue order, so the walk
 * through the pillars is stable and predictable.
 */
export function pickNextPillar(recentPillarIds: string[], available: BlogPillar[]): BlogPillar {
  if (available.length === 0) throw new Error('no pillars available')
  let best = available[0]
  let bestAge = -1
  for (const pillar of available) {
    const idx = recentPillarIds.indexOf(pillar.id)
    const age = idx === -1 ? Number.POSITIVE_INFINITY : idx
    if (age > bestAge) {
      best = pillar
      bestAge = age
    }
  }
  return best
}

/** Deterministic pick — seeded per run so runs vary but tests do not. */
export function pickSeeded<T>(options: readonly T[], seed: number): T {
  if (options.length === 0) throw new Error('no options')
  return options[Math.abs(Math.trunc(seed)) % options.length]
}

export interface PillarAssignment {
  pillar: BlogPillar
  titleStyleId: string
  length: BlogLengthProfile
}

/** djb2-style string hash. No cryptographic property needed — see assignPillar. */
function hashString(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i)
  }
  return Math.abs(h | 0)
}

/**
 * The seed alone collapses in steady state whenever it advances by a constant:
 * the rotation cycles N pillars in a stable order, so one pillar's seeds form an
 * arithmetic sequence, and if gcd(N, titleStyles.length) > 1, indexing by the raw
 * seed locks that pillar onto a SINGLE title shape forever. Adding a constant
 * cannot fix it — the residue is unchanged. Hashing the seed INTO the pillar id
 * does, because the hash outputs for k, k+N, k+2N are not a progression at all.
 */
export function assignPillar(
  recentPillarIds: string[],
  data: PillarAvailabilityData,
  seed: number,
  catalogue: readonly BlogPillar[] = BLOG_PILLARS,
): PillarAssignment {
  const pillar = pickNextPillar(recentPillarIds, availablePillars(data, catalogue))
  const titleStyleId = pickSeeded(pillar.titleStyles, hashString(`${pillar.id}:${seed}`))
  const lengthId = pickSeeded(pillar.lengths, hashString(`${pillar.id}:len:${seed}`))
  const length = BLOG_LENGTH_PROFILES.find((l) => l.id === lengthId)!
  return { pillar, titleStyleId, length }
}

export function buildPillarSection(a: PillarAssignment, extras?: string): string {
  const lines = [
    `PAUTA DESTE POST — pilar "${a.pillar.label}":`,
    a.pillar.guidance,
    `FORMATO DO TÍTULO: ${BLOG_TITLE_STYLES[a.titleStyleId] ?? BLOG_TITLE_STYLES.statement} Não use o formato "Tema: Subtítulo Explicativo" a menos que este formato permita explicitamente.`,
    `TAMANHO ALVO: ${a.length.words} palavras. ${a.length.guidance}`,
    'UM POST, UM ASSUNTO: comprometa-se com o assunto único desta pauta. Outros temas ganham no máximo uma frase de passagem com link interno onde couber — nunca uma seção própria.',
  ]
  if (extras && extras.trim()) lines.push(extras.trim())
  return lines.join('\n')
}

// ─── Grounded context sections ───────────────────────────────────────────────

export interface InternalLink {
  label: string
  path: string
}

export function buildInternalLinksSection(links: InternalLink[]): string {
  if (links.length === 0) return ''
  return [
    'LINKS INTERNOS — inclua de 1 a 3 destes no corpo do post como âncoras HTML, onde ajudarem de verdade o leitor:',
    ...links.map((l) => `- <a href="${l.path}">${l.label}</a>`),
    'Use cada um no máximo uma vez, com texto âncora natural (reescreva o rótulo para caber na frase). Estes são os ÚNICOS links permitidos — nenhum outro caminho interno, nenhuma URL externa.',
  ].join('\n')
}

export function buildKeywordDedupSection(recentFocusKeywords: string[]): string {
  const kws = Array.from(
    new Set(recentFocusKeywords.map((k) => k.trim().toLowerCase()).filter(Boolean)),
  ).slice(0, 10)
  if (kws.length === 0) return ''
  return [
    'PALAVRAS-CHAVE FOCO JÁ USADAS RECENTEMENTE (cada uma já tem um post disputando por ela):',
    kws.join(', '),
    'Escolha uma palavra-chave foco DIFERENTE para este post, para que os posts do site não compitam entre si.',
  ].join('\n')
}

/**
 * Enforcement for buildInternalLinksSection: models occasionally invent hrefs,
 * and a hallucinated link on a live marketing page is worse than no link at all.
 *
 * Every surviving anchor points at exactly one of `allowedPaths`; everything else
 * is unwrapped to its inner text, so the prose survives and only the link dies.
 * Rebuilt anchors carry href only, so a stray target or onclick cannot survive
 * even on a link we keep.
 *
 * Non-string input returns '' rather than throwing: the caller feeds this model
 * output, where an optional field is often missing entirely.
 */
export function sanitizeGeneratedLinks(html: unknown, allowedPaths: string[]): string {
  if (typeof html !== 'string') return ''
  const allowed = new Set(allowedPaths.map((p) => p.trim()).filter(Boolean))

  return html.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, (match, inner: string) => {
    const hrefMatch = /\bhref\s*=\s*["']([^"']*)["']/i.exec(match)
    const href = hrefMatch?.[1]?.trim() ?? ''
    return allowed.has(href) ? `<a href="${href}">${inner}</a>` : inner
  })
}

// ─── Pilares do blog DE UM RESTAURANTE (autoblog-parity XM-11) ──────────────
//
// O catálogo acima escreve PARA O DONO do restaurante — é o blog de marketing
// da Xmartmenu, vendendo a plataforma. Estes pilares escrevem para quem vai
// COMER, e o objetivo é outro: SEO local.
//
// A diferença é o produto inteiro. "Engenharia de cardápio" é um assunto que
// interessa a um dono e a mais ninguém; um cliente procurando onde jantar nunca
// digitou isso na vida. O que ele digita é "melhor pizza em <bairro>", "onde
// almoçar com criança no domingo", "restaurante sem glúten perto de mim" — e é
// exatamente isso que estes pilares atacam.
//
// Dois princípios que valem para todos eles:
//   - NUNCA inventar. Nada de prêmio que o restaurante não ganhou, chef que não
//     existe, ingrediente que não está no cardápio. O post sai no nome do
//     cliente, e uma invenção aqui é ele mentindo para o público dele.
//   - O lugar é o ativo. Bairro, cidade e referências próximas entram onde
//     couber naturalmente, porque é isso que faz a busca local funcionar.

export const TENANT_BLOG_PILLARS: readonly BlogPillar[] = [
  {
    id: 'dish-spotlight',
    label: 'Um prato por vez',
    guidance:
      'Escolha UM prato do cardápio e conte a história dele: o que leva, como é feito, por que tem esse sabor, com o que combina, quando pedir. Trate como comida de verdade, não como copy de anúncio. Só fale de pratos que estão no CARDÁPIO listado — inventar um prato é o cliente mentindo para o público dele.',
    titleStyles: ['statement', 'question', 'two-part'],
    lengths: ['quick', 'standard'],
    requires: 'menu',
  },
  {
    id: 'neighbourhood',
    label: 'O bairro',
    guidance:
      'Escreva sobre onde o restaurante FICA: como chegar, o que tem por perto, qual o melhor horário, como é o movimento, o que a vizinhança tem de particular. É o pilar mais valioso para busca local — alguém procurando "onde comer em <bairro>" precisa achar esta página. Use só o endereço e a região informados; não invente pontos de referência.',
    titleStyles: ['question', 'statement', 'numbered'],
    lengths: ['quick', 'standard'],
    requires: 'address',
  },
  {
    id: 'occasion',
    label: 'A ocasião',
    guidance:
      'Uma ocasião concreta e a resposta prática para ela: almoço de domingo em família, jantar de aniversário, encontro rápido no almoço de trabalho, comemoração com grupo grande. Diga o que pedir, quanto tempo leva, o que funciona para quantas pessoas. É intenção de busca pura — quem procura assim já decidiu que vai sair.',
    titleStyles: ['question', 'how-to', 'numbered'],
    lengths: ['quick', 'standard'],
  },
  {
    id: 'dietary',
    label: 'Restrições e preferências',
    guidance:
      'Opções para quem tem restrição ou preferência: vegetariano, vegano, sem glúten, sem lactose, sem açúcar, leve. Liste SOMENTE o que o cardápio realmente oferece e seja honesto sobre o que não há — uma promessa errada aqui vira reclamação na mesa e avaliação ruim. Cauda longa de altíssima intenção.',
    titleStyles: ['question', 'numbered', 'statement'],
    lengths: ['quick', 'standard'],
    requires: 'menu',
  },
  {
    id: 'behind-the-scenes',
    label: 'Bastidores',
    guidance:
      'Como a casa funciona por dentro: a rotina da cozinha, o preparo que começa de madrugada, o cuidado que ninguém vê da mesa. Constrói confiança e dá ao post algo que nenhum concorrente pode copiar. Só conte o que os dados do restaurante sustentam; não invente equipe, prêmio nem história de família.',
    titleStyles: ['statement', 'two-part'],
    lengths: ['quick', 'standard'],
  },
  {
    id: 'how-to-order',
    label: 'Como pedir',
    guidance:
      'O prático: como funciona o delivery, a retirada, a reserva, o pedido para grupo grande, o que muda no horário de pico. Responde a dúvida antes de ela virar uma ligação — e é o tipo de página que o Google mostra para "delivery <bairro>". Use só os canais que o restaurante realmente tem.',
    titleStyles: ['how-to', 'question', 'numbered'],
    lengths: ['quick', 'standard'],
  },
  {
    id: 'seasonal',
    label: 'Sazonal',
    guidance:
      'O que faz sentido AGORA: o que entrou no cardápio nesta época, o que combina com o clima destes dias, a data comemorativa que está chegando. Ancore na data informada em TODAY IS e nunca em uma estação que já passou — um post sobre inverno publicado em novembro no Brasil é um post errado.',
    titleStyles: ['statement', 'numbered', 'two-part'],
    lengths: ['quick', 'standard'],
  },
  {
    id: 'local-reaction',
    label: 'O que está acontecendo',
    guidance:
      'Reaja ao item do feed como um restaurante da região reagiria: o que aquilo significa para quem come aqui, o que muda na prática, o que a casa pensa sobre isso. NÃO resuma nem reescreva a fonte — a matéria é o ponto de partida, o post é original e da casa.',
    titleStyles: ['statement', 'question', 'two-part'],
    lengths: ['quick', 'standard'],
    requires: 'rss',
  },
]
