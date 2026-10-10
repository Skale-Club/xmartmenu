/**
 * Shared shell for /terms and /privacy.
 *
 * Content comes from `platform_settings.legal`, edited in the superadmin
 * Platform Settings panel. While a document is unpublished the page keeps the
 * original placeholder instead of rendering an empty shell — a legal page that
 * silently goes blank is worse than one that says it is being prepared.
 */
import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/server'
import { pickLegalDoc, renderLegalBody, type LegalDoc } from '@/lib/marketing/legal-doc'

export type LegalKey = 'terms' | 'privacy'

const FALLBACK_TITLE: Record<LegalKey, string> = {
  terms: 'Terms of Service',
  privacy: 'Privacy Policy',
}

export async function getLegalDoc(key: LegalKey): Promise<LegalDoc | null> {
  try {
    const service = createServiceClient()
    const { data } = await service.from('platform_settings').select('legal').single()
    return pickLegalDoc(data?.legal, key)
  } catch {
    // Settings unreachable: fall back to the placeholder rather than 500ing a
    // page that legal/compliance links point at.
    return null
  }
}

export function legalTitle(key: LegalKey, doc: LegalDoc | null): string {
  return doc?.title ?? FALLBACK_TITLE[key]
}

export default async function LegalPage({ docKey }: { docKey: LegalKey }) {
  const doc = await getLegalDoc(docKey)
  const title = legalTitle(docKey, doc)

  return (
    <main className="max-w-2xl mx-auto px-4 py-16">
      <h1 className="text-3xl font-bold text-zinc-900 mb-2">{title}</h1>

      {doc?.updated_at && (
        <p className="text-xs text-zinc-400 mb-8">Last updated: {doc.updated_at}</p>
      )}

      {doc?.body ? (
        <div className={doc.updated_at ? '' : 'mt-6'}>{renderLegalBody(doc.body)}</div>
      ) : (
        <p className="text-base text-zinc-600 leading-relaxed mt-6">
          Coming soon | our legal documents are being prepared.
        </p>
      )}

      <div className="mt-12">
        <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900 transition-colors">
          ← Back to home
        </Link>
      </div>
    </main>
  )
}
