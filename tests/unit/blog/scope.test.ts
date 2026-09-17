// tests/unit/blog/scope.test.ts
// Auto-blog parity XM-11 — o seletor de escopo.
//
// Isto parece trivial e não é: em PostgREST, `tenant_id = NULL` não casa com
// nada. Um `.eq('tenant_id', null)` escrito por hábito devolveria ZERO linhas
// para o blog da plataforma, e um filtro esquecido devolveria as linhas de
// TODOS os tenants. Os dois são silenciosos.
import { describe, it, expect } from 'vitest'
import { describeScope, isPlatformScope, scopeColumn, scopeFilter } from '@/lib/blog/scope'

/** Registra qual método de filtro foi chamado, como o PostgREST veria.
 *  `scopeFilter` é genérico sobre o objeto inteiro, então um dublê com eq/is
 *  basta — e é justamente o que prova que o método certo foi escolhido. */
function fakeQuery() {
  const calls: Array<{ method: string; column: string; value: unknown }> = []
  const q = {
    calls,
    eq(column: string, value: unknown) { calls.push({ method: 'eq', column, value }); return q },
    is(column: string, value: null) { calls.push({ method: 'is', column, value }); return q },
  }
  return q
}

describe('scopeFilter', () => {
  it('usa IS NULL para a plataforma, nunca = NULL', () => {
    const q = fakeQuery()
    scopeFilter(q, null)
    expect(q.calls).toEqual([{ method: 'is', column: 'tenant_id', value: null }])
  })

  it('usa igualdade para um tenant', () => {
    const q = fakeQuery()
    scopeFilter(q, 'e7b6f0aa-0000-4000-8000-000000000001')
    expect(q.calls).toEqual([
      { method: 'eq', column: 'tenant_id', value: 'e7b6f0aa-0000-4000-8000-000000000001' },
    ])
  })

  it('sempre aplica exatamente um filtro — nunca zero', () => {
    // Zero filtros é o bug que devolve as linhas de todos os tenants.
    for (const scope of [null, 'e7b6f0aa-0000-4000-8000-000000000002']) {
      const q = fakeQuery()
      scopeFilter(q, scope)
      expect(q.calls).toHaveLength(1)
      expect(q.calls[0].column).toBe('tenant_id')
    }
  })
})

describe('scopeColumn', () => {
  it('escreve NULL para a plataforma e o id para um tenant', () => {
    expect(scopeColumn(null)).toEqual({ tenant_id: null })
    expect(scopeColumn('abc')).toEqual({ tenant_id: 'abc' })
  })

  it('sempre inclui a coluna, para que um insert não possa omiti-la', () => {
    // Uma linha sem tenant_id vira, por acidente, uma linha da plataforma.
    expect(Object.keys(scopeColumn(null))).toEqual(['tenant_id'])
  })
})

describe('helpers', () => {
  it('isPlatformScope distingue os dois', () => {
    expect(isPlatformScope(null)).toBe(true)
    expect(isPlatformScope('abc')).toBe(false)
  })

  it('describeScope rotula log e job', () => {
    expect(describeScope(null)).toBe('platform')
    expect(describeScope('abc')).toBe('tenant:abc')
  })
})
