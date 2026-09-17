// =============================================================================
// Guarda estática do escopo do blog (autoblog-parity XM-11).
//
// Antes de XM-11 o blog era só da plataforma: `blog_settings` e
// `telegram_settings` eram singletons com `id INTEGER PRIMARY KEY DEFAULT 1` e
// um CHECK a garanti-lo, e nenhuma tabela tinha `tenant_id`. Agora cada
// restaurante tem as suas linhas, e as duas suposições antigas passaram a ser
// bugs silenciosos:
//
//   1. `.eq('id', 1)` deixou de identificar a linha da plataforma — `id` é UUID.
//   2. `upsert(row, { onConflict: 'id' })` já não encontra conflito nenhum, por
//      isso INSERE uma linha nova a cada gravação; a leitura seguinte, que faz
//      `maybeSingle()`, rebenta com "multiple rows". O índice único do escopo
//      também não serve de ON CONFLICT: é PARCIAL (WHERE tenant_id IS NULL) e o
//      PostgREST não o alcança.
//
// Nenhum dos dois falha nos testes de unidade nem no typecheck — só em
// produção, depois da segunda gravação. Daí este varrimento do código-fonte.
// =============================================================================
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = [
  'src/lib/blog',
  'src/app/api/superadmin/blog',
  'src/app/api/internal/blog',
  'src/app/(admin)/blog',
  'src/app/(superadmin)/blog',
]

/** Tabelas que passaram a ter uma linha por escopo em XM-11. */
const SCOPED_TABLES = [
  'blog_settings',
  'telegram_settings',
  'blog_posts',
  'blog_generation_jobs',
  'blog_post_feedback',
  'blog_rss_sources',
  'blog_rss_items',
]

function sourceFiles(dir: string): string[] {
  let out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out = out.concat(sourceFiles(full))
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

const FILES = ROOTS.flatMap((root) => {
  try {
    return sourceFiles(root)
  } catch {
    return []
  }
}).map((path) => ({ path, source: readFileSync(path, 'utf8') }))

describe('guarda de escopo do blog', () => {
  it('encontra os ficheiros que diz varrer', () => {
    // Um caminho renomeado tornaria todas as asserções abaixo vacuamente
    // verdadeiras — é exatamente assim que um guarda destes morre em silêncio.
    expect(FILES.length).toBeGreaterThan(5)
  })

  it('não deixou nenhum `.eq(\'id\', 1)` da era do singleton', () => {
    const offenders = FILES.filter(({ source }) => /\.eq\(\s*['"]id['"]\s*,\s*['"]?1['"]?\s*\)/.test(source))
    expect(offenders.map((f) => f.path)).toEqual([])
  })

  it('não faz upsert por `id` em nenhuma tabela escopada', () => {
    const offenders: string[] = []
    for (const { path, source } of FILES) {
      for (const table of SCOPED_TABLES) {
        // .from('<tabela>') seguido de um upsert com onConflict: 'id', com o
        // encadeamento possivelmente partido por linhas.
        const pattern = new RegExp(
          `from\\(\\s*['"]${table}['"]\\s*\\)[\\s\\S]{0,400}?upsert\\([\\s\\S]{0,400}?onConflict:\\s*['"]id['"]`,
        )
        if (pattern.test(source)) offenders.push(`${path} (${table})`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('só o `blog_rss_items` faz upsert, e por (source_id, guid)', () => {
    // A de-duplicação do RSS é a única que legitimamente precisa de upsert, e
    // apoia-se num índice único TOTAL, não parcial — por isso o ON CONFLICT
    // alcança-o. Se outra tabela passar a fazer upsert, é para ser revisto aqui.
    for (const { path, source } of FILES) {
      for (const match of source.matchAll(/from\(\s*['"](\w+)['"]\s*\)[\s\S]{0,300}?upsert\(/g)) {
        expect(`${path}: ${match[1]}`).toBe(`${path}: blog_rss_items`)
      }
    }
  })
})
