'use client'
// Restaurant subdomain (docs/product/tenant-subdomains.md): opt-in per
// restaurant, set here by a platform administrator. Saving works while the
// feature is off (TENANT_SUBDOMAIN_BASE unset); the address only answers once
// the base, the wildcard DNS record and the TLS certificate are in place.
import { useState } from 'react'
import { Globe, Loader2 } from 'lucide-react'
import { suggestedSubdomain, validateSubdomainLabel } from '@/lib/tenant-subdomain'

export default function TenantSubdomainCard({ tenantId, slug, initialSubdomain, base }: {
  tenantId: string
  slug: string
  initialSubdomain: string | null
  base: string | null
}) {
  const [saved, setSaved] = useState(initialSubdomain)
  const [value, setValue] = useState(initialSubdomain ?? suggestedSubdomain(slug) ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const check = validateSubdomainLabel(value)
  const dirty = (check.ok ? check.label : value) !== saved

  async function save(next: string | null) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/superadmin/tenants/${tenantId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subdomain: next }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error ?? 'Could not save the subdomain'); return }
      const stored = typeof data.subdomain === 'string' ? data.subdomain : null
      setSaved(stored)
      setValue(stored ?? suggestedSubdomain(slug) ?? '')
    } finally {
      setBusy(false)
    }
  }

  const address = saved && base ? `https://${saved}.${base}` : null

  return (
    <section className="mb-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600"><Globe className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-zinc-950">Subdomain</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Optional. The restaurant opens at its own address instead of /{slug}; the /{slug} link keeps working and points search engines to it. A verified custom domain still wins.
          </p>
          {!base && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
              Subdomains are off on this server (TENANT_SUBDOMAIN_BASE is not set). You can save one now; it starts answering once DNS, TLS and the base are set up.
            </p>
          )}
          <form
            className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center"
            onSubmit={event => { event.preventDefault(); if (check.ok && dirty) void save(check.label) }}
          >
            <div className="flex min-w-0 flex-1 items-center rounded-xl border border-zinc-200 bg-zinc-50 focus-within:border-zinc-400">
              <input
                value={value}
                onChange={event => setValue(event.target.value.toLowerCase())}
                placeholder={suggestedSubdomain(slug) ?? 'restaurant'}
                aria-label="Subdomain"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="min-h-11 min-w-0 flex-1 bg-transparent px-3 text-base text-zinc-950 outline-none sm:text-sm"
              />
              <span className="shrink-0 pr-3 text-sm text-zinc-500">.{base ?? '<base domain>'}</span>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={busy || !check.ok || !check.label || !dirty}
                className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-zinc-900 px-4 text-xs font-bold text-white transition-colors hover:bg-zinc-800 disabled:opacity-40"
              >
                {busy && <Loader2 className="size-3.5 animate-spin" />}
                {saved ? 'Save' : 'Turn on'}
              </button>
              {saved && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void save(null)}
                  className="min-h-11 rounded-xl px-3 text-xs font-bold text-zinc-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                >
                  Turn off
                </button>
              )}
            </div>
          </form>
          {!check.ok && <p className="mt-2 text-xs font-semibold text-red-600">{check.error}</p>}
          {error && <p className="mt-2 text-xs font-semibold text-red-600">{error}</p>}
          {address && (
            <p className="mt-2 text-xs text-zinc-600">
              Live address: <a href={address} target="_blank" rel="noopener noreferrer" className="font-semibold text-sky-700 underline underline-offset-2">{address.replace('https://', '')}</a>
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
