// tests/unit/blog/tenant-blog.test.ts
// Auto-blog parity XM-11 — o blog do restaurante.
//
// Duas coisas são testadas aqui porque as duas são caras quando dão errado:
// um post falando de algo que a casa não tem (o cliente vai até a porta pedir),
// e um pilar da plataforma aparecendo no blog de um restaurante (o cliente lê
// um texto sobre engenharia de cardápio no site onde queria ver o menu).
import { describe, it, expect } from 'vitest'
import {
  BLOG_PILLARS,
  TENANT_BLOG_PILLARS,
  assignPillar,
  availablePillars,
} from '@/lib/blog/prompt'
import {
  buildBusinessSection,
  buildChannelsSection,
  buildLocationSection,
  buildMenuSection,
  type TenantBlogContext,
} from '@/lib/blog/tenant-context'

function ctx(over: Partial<TenantBlogContext> = {}): TenantBlogContext {
  return {
    tenantId: 't1',
    slug: 'cantina-do-ze',
    name: 'Cantina do Zé',
    businessType: 'cantina italiana',
    tagline: null,
    about: null,
    address: null,
    categories: [],
    dishes: [],
    channels: { delivery: false, pickup: false, dineIn: true, whatsapp: false },
    timezone: 'America/Sao_Paulo',
    ...over,
  }
}

describe('catálogos de pilares', () => {
  it('os dois catálogos são disjuntos — não há pilar compartilhado', () => {
    // Se um id aparecesse nos dois, a rotação de um restaurante acabaria
    // servindo um assunto escrito para o dono dele.
    const platform = new Set(BLOG_PILLARS.map((p) => p.id))
    const overlap = TENANT_BLOG_PILLARS.filter((p) => platform.has(p.id))
    expect(overlap).toEqual([])
  })

  it('o catálogo do restaurante tem pilares de SEO local', () => {
    const ids = TENANT_BLOG_PILLARS.map((p) => p.id)
    expect(ids).toContain('neighbourhood')
    expect(ids).toContain('dish-spotlight')
    expect(ids).toContain('occasion')
  })

  it('todo pilar declara formato de título e tamanho que consegue usar', () => {
    for (const pillar of TENANT_BLOG_PILLARS) {
      expect(pillar.titleStyles.length).toBeGreaterThan(0)
      expect(pillar.lengths.length).toBeGreaterThan(0)
    }
  })
})

describe('disponibilidade por dado', () => {
  it('sem cardápio, nenhum pilar que fala de prato entra na rotação', () => {
    // O pior erro possível do recurso é um post sobre um prato inexistente.
    const available = availablePillars({ hasRssItem: false, hasMenu: false, hasAddress: true }, TENANT_BLOG_PILLARS)
    expect(available.map((p) => p.id)).not.toContain('dish-spotlight')
    expect(available.map((p) => p.id)).not.toContain('dietary')
  })

  it('sem endereço, o pilar do bairro não entra', () => {
    const available = availablePillars({ hasRssItem: false, hasMenu: true, hasAddress: false }, TENANT_BLOG_PILLARS)
    expect(available.map((p) => p.id)).not.toContain('neighbourhood')
  })

  it('um restaurante sem cardápio e sem endereço ainda tem o que publicar', () => {
    // Senão, um cliente novo — que é justamente quem tem o cadastro vazio —
    // veria a rotação travar em vez de publicar.
    const available = availablePillars({ hasRssItem: false, hasMenu: false, hasAddress: false }, TENANT_BLOG_PILLARS)
    expect(available.length).toBeGreaterThan(0)
  })

  it('o catálogo escolhido é o que foi passado, não o padrão', () => {
    const assignment = assignPillar([], { hasRssItem: false, hasMenu: true, hasAddress: true }, 7, TENANT_BLOG_PILLARS)
    expect(TENANT_BLOG_PILLARS.map((p) => p.id)).toContain(assignment.pillar.id)
  })

  it('sem catálogo explícito, continua sendo o da plataforma', () => {
    // Compatibilidade: o blog da própria Xmartmenu não muda de comportamento.
    const assignment = assignPillar([], { hasRssItem: false }, 7)
    expect(BLOG_PILLARS.map((p) => p.id)).toContain(assignment.pillar.id)
  })
})

describe('aterramento do prompt', () => {
  it('sem endereço, a seção de localização é vazia — não um "perto de você"', () => {
    // Um modelo que não sabe a região tem que ficar calado sobre ela.
    expect(buildLocationSection(null)).toBe('')
    expect(buildLocationSection('   ')).toBe('')
  })

  it('com endereço, proíbe inventar bairro', () => {
    const section = buildLocationSection('Rua Teodoro Sampaio, 100 — Pinheiros, São Paulo')
    expect(section).toContain('Pinheiros')
    expect(section).toMatch(/NUNCA invente/)
  })

  it('o cardápio lista os pratos reais e proíbe inventar', () => {
    const section = buildMenuSection(
      ctx({
        dishes: [
          { name: 'Lasanha da casa', description: 'massa fresca, molho de tomate san marzano', category: 'Massas' },
          { name: 'Tiramisù', description: null, category: 'Sobremesas' },
        ],
      }),
    )
    expect(section).toContain('Lasanha da casa')
    expect(section).toContain('massa fresca')
    expect(section).toContain('Tiramisù')
    expect(section).toMatch(/Um prato inventado/)
  })

  it('cardápio vazio não gera seção nenhuma', () => {
    expect(buildMenuSection(ctx({ dishes: [] }))).toBe('')
  })

  it('só os canais que existem entram, e a lista é fechada', () => {
    const section = buildChannelsSection(
      ctx({ channels: { delivery: true, pickup: false, dineIn: true, whatsapp: false } }),
    )
    expect(section).toContain('delivery')
    expect(section).toContain('salão')
    expect(section).not.toContain('retirada')
    expect(section).toMatch(/Não prometa nenhum canal fora desta lista/)
  })

  it('sem canal nenhum, a seção some em vez de prometer o vazio', () => {
    expect(
      buildChannelsSection(ctx({ channels: { delivery: false, pickup: false, dineIn: false, whatsapp: false } })),
    ).toBe('')
  })

  it('a identidade só aparece quando há mais do que o nome', () => {
    // O nome sozinho já está na primeira linha do system message.
    expect(buildBusinessSection(ctx({ businessType: null, tagline: null, about: null }))).toBe('')
    expect(buildBusinessSection(ctx({ businessType: 'pizzaria' }))).toContain('pizzaria')
  })
})
