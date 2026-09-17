/**
 * As leituras públicas dos DOIS blogs (autoblog-parity XM-18).
 *
 * A aritmética dos arquivos e a correspondência de etiquetas são testadas como
 * funções puras: são elas que decidem, e testá-las contra o PostgREST seria
 * testar o PostgREST.
 */
import { describe, expect, it } from 'vitest'

import { parseTags, tagSlug } from '@/lib/blog/public-queries'

describe('parseTags', () => {
  it('divide, apara e descarta vazios', () => {
    expect(parseTags('massa, pizza ,  , forno')).toEqual(['massa', 'pizza', 'forno'])
  })

  it('devolve vazio para null, undefined e só espaços', () => {
    expect(parseTags(null)).toEqual([])
    expect(parseTags(undefined)).toEqual([])
    expect(parseTags('  ')).toEqual([])
  })
})

describe('tagSlug', () => {
  it('normaliza acentos e espaços', () => {
    expect(tagSlug('Massa Fresca')).toBe('massa-fresca')
    expect(tagSlug('Pão de Queijo')).toBe('pao-de-queijo')
  })

  it('distingue etiquetas que um LIKE confundiria', () => {
    // É o caso que justifica comparar o slug inteiro: um `ilike '%pizza%'`
    // devolveria "pizzaria" para a etiqueta "pizza".
    expect(tagSlug('pizza')).not.toBe(tagSlug('pizzaria'))
  })

  it('duas grafias da mesma etiqueta colapsam num só URL', () => {
    // Dois URLs para a mesma listagem seriam duas páginas indexáveis com o
    // mesmo conteúdo.
    expect(tagSlug('Delivery')).toBe(tagSlug('delivery'))
  })
})

/** A mesma aritmética de `listPostsByMonth`. */
function monthWindow(year: number, month: number | undefined, now: Date) {
  const from = new Date(Date.UTC(year, month ? month - 1 : 0, 1))
  const periodEnd = month
    ? new Date(Date.UTC(year, month, 1))
    : new Date(Date.UTC(year + 1, 0, 1))
  const to = periodEnd.getTime() < now.getTime() ? periodEnd : now
  return { from, to }
}

describe('janela de um arquivo', () => {
  const now = new Date('2026-09-17T12:00:00Z')

  it('um mês passado usa o mês inteiro, meio-aberto', () => {
    const { from, to } = monthWindow(2026, 8, now)
    expect(from.toISOString()).toBe('2026-08-01T00:00:00.000Z')
    // Fechado dos dois lados, um post de 1 de setembro às 00:00 apareceria em
    // agosto E em setembro.
    expect(to.toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })

  it('o mês CORRENTE pára em agora, não no fim do mês', () => {
    // Sem isto, um post agendado aparecia no arquivo deste mês enquanto a
    // contagem, que tem a guarda, dizia outro número.
    expect(monthWindow(2026, 9, now).to.getTime()).toBe(now.getTime())
  })

  it('o ano corrente também pára em agora', () => {
    expect(monthWindow(2026, undefined, now).to.getTime()).toBe(now.getTime())
  })

  it('dezembro rola para janeiro do ano seguinte', () => {
    const { to } = monthWindow(2026, 12, new Date('2027-06-01T00:00:00Z'))
    expect(to.toISOString()).toBe('2027-01-01T00:00:00.000Z')
  })
})
