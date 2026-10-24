import Link from 'next/link'

import type { ArchiveEntry, PublicPostCard } from '@/lib/blog/public-queries'

const MONTHS = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

export function monthName(month: number): string {
  return MONTHS[month - 1] ?? String(month)
}

export function formatDate(value: string | null): string {
  if (!value) return ''
  return new Intl.DateTimeFormat('pt-BR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value))
}

/**
 * A listagem que o índice, as etiquetas e os arquivos partilham — nos DOIS
 * blogs, o da plataforma e o de cada restaurante.
 *
 * `basePath` é o que os distingue: `/blog` para a plataforma,
 * `/<slug>/blog` para um restaurante. Um componente só porque seis vistas
 * copiadas seriam seis sítios onde o cartão, o aviso de vazio ou a barra
 * lateral podem divergir sem ninguém reparar.
 */
export function BlogPostList({
  heading,
  lead,
  posts,
  basePath,
  archive = [],
  tags = [],
  emptyMessage = 'Nenhum post publicado ainda.',
}: {
  heading: string
  lead?: string | null
  posts: PublicPostCard[]
  basePath: string
  archive?: ArchiveEntry[]
  tags?: Array<{ slug: string; name: string; count: number }>
  emptyMessage?: string
}) {
  const byYear = new Map<number, ArchiveEntry[]>()
  for (const entry of archive) {
    const list = byYear.get(entry.year) ?? []
    list.push(entry)
    byYear.set(entry.year, list)
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6">
      <header className="mb-12">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{heading}</h1>
        {lead && <p className="mt-3 text-base text-muted-foreground">{lead}</p>}
      </header>

      <div className="flex flex-col gap-12 lg:flex-row">
        <div className="flex-1">
          {posts.length === 0 ? (
            <p className="text-muted-foreground">{emptyMessage}</p>
          ) : (
            <ul className="space-y-10">
              {posts.map((post) => (
                <li key={post.slug}>
                  <article>
                    {/* Sem <Image> do Next: a URL vem do Supabase Storage e não
                        está no remotePatterns, então o otimizador recusaria em
                        produção. `loading="lazy"` + aspect-ratio fixo evitam o
                        layout shift que o <Image> traria de graça. */}
                    {post.cover_image_url && (
                      <Link href={`${basePath}/${post.slug}`} className="mb-4 block">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={post.cover_image_url}
                          alt=""
                          loading="lazy"
                          className="aspect-video w-full rounded-xl object-cover"
                        />
                      </Link>
                    )}
                    <h2 className="text-xl font-medium tracking-tight">
                      <Link href={`${basePath}/${post.slug}`} className="hover:underline">
                        {post.title}
                      </Link>
                    </h2>
                    {post.excerpt && <p className="mt-2 text-muted-foreground">{post.excerpt}</p>}
                    <p className="mt-2 text-sm text-muted-foreground">
                      {formatDate(post.published_at)}
                      {post.reading_time_minutes
                        ? ` · ${post.reading_time_minutes} min de leitura`
                        : ''}
                    </p>
                  </article>
                </li>
              ))}
            </ul>
          )}
        </div>

        {(tags.length > 0 || byYear.size > 0) && (
          <aside className="flex w-full flex-col gap-8 lg:w-56 lg:shrink-0">
            {tags.length > 0 && (
              <nav aria-label="Assuntos" className="flex flex-col gap-2">
                <h2 className="font-medium">Assuntos</h2>
                <ul className="flex flex-wrap gap-x-3 gap-y-1">
                  {tags.map((tag) => (
                    <li key={tag.slug}>
                      <Link
                        href={`${basePath}/tag/${tag.slug}`}
                        className="text-sm text-muted-foreground hover:text-foreground"
                      >
                        #{tag.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            )}

            {byYear.size > 0 && (
              <nav aria-label="Arquivo" className="flex flex-col gap-4">
                <h2 className="font-medium">Arquivo</h2>
                {Array.from(byYear.entries())
                  .sort((a, b) => b[0] - a[0])
                  .map(([year, months]) => (
                    <div key={year} className="flex flex-col gap-1">
                      <Link href={`${basePath}/archive/${year}`} className="font-medium hover:underline">
                        {year}
                      </Link>
                      <ul className="flex flex-col gap-0.5 pl-3">
                        {months
                          .sort((a, b) => b.month - a.month)
                          .map((entry) => (
                            <li key={entry.month}>
                              <Link
                                href={`${basePath}/archive/${entry.year}/${String(entry.month).padStart(2, '0')}`}
                                className="text-sm text-muted-foreground hover:text-foreground"
                              >
                                {monthName(entry.month)}{' '}
                                <span className="opacity-60">({entry.count})</span>
                              </Link>
                            </li>
                          ))}
                      </ul>
                    </div>
                  ))}
              </nav>
            )}
          </aside>
        )}
      </div>
    </main>
  )
}
