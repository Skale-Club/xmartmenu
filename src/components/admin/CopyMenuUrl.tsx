'use client'

import { useEffect, useState } from 'react'
import { Copy, Check, ChevronDown, ExternalLink, Globe2, Menu } from 'lucide-react'
import Link from 'next/link'

export function CopyMenuUrl({
  homePath,
  menus,
}: {
  homePath: string
  menus?: Array<{ name: string; path: string; isActive: boolean }>
}) {
  const [copied, setCopied] = useState(false)
  const [origin, setOrigin] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => setOrigin(window.location.origin), 0)
    return () => window.clearTimeout(timer)
  }, [])

  const normalizedHomePath = homePath.startsWith('/') ? homePath : `/${homePath}`
  const homeUrl = origin ? `${origin}${normalizedHomePath}` : ''

  const handleCopy = async () => {
    if (!homeUrl) return
    try {
      await navigator.clipboard.writeText(homeUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy text: ', err)
    }
  }

  if (!homeUrl) return null

  return (
    <div className="w-full max-w-2xl">
      <p className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">Public access</p>
      <div className="grid gap-2 sm:grid-cols-[minmax(12rem,1fr)_auto_auto]">
        <div className="group relative flex min-w-0 items-center">
        <input
          type="text"
          readOnly
          value={homeUrl}
          aria-label="Public homepage URL"
          className="block min-h-11 w-full rounded-xl border border-zinc-200 bg-zinc-100/50 px-4 pr-12 text-xs font-bold text-zinc-600 outline-none transition-[background-color,border-color,box-shadow] duration-150 group-hover:border-zinc-300 group-hover:bg-white focus:border-primary focus:ring-4 focus:ring-primary/10"
        />
        <button
          onClick={handleCopy}
          className="absolute right-1.5 flex size-10 items-center justify-center rounded-lg text-zinc-400 transition-[background-color,color,scale] duration-150 hover:bg-zinc-100 hover:text-primary active:scale-96"
          aria-label="Copy homepage URL"
        >
          {copied ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
        </button>
      </div>
      <Link
        href={homePath}
        target="_blank"
        className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-xs font-black uppercase tracking-wider text-primary-foreground shadow-sm transition-[background-color,color,box-shadow,scale] duration-150 hover:bg-zinc-950 hover:text-white hover:shadow-md active:scale-96"
      >
        <Globe2 size={15} />
        View site
        <ExternalLink size={13} className="opacity-60" />
      </Link>
      {menus && menus.length > 0 && (
        <details className="group relative">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-center gap-2 rounded-xl bg-zinc-900 px-4 text-xs font-bold text-white transition-[background-color,scale] duration-150 hover:bg-zinc-800 active:scale-96 [&::-webkit-details-marker]:hidden">
            <Menu size={15} />
            Menus
            <span className="min-w-5 rounded-full bg-white/15 px-1.5 py-0.5 text-[10px] tabular-nums">{menus.length}</span>
            <ChevronDown size={13} className="opacity-60 transition-transform duration-150 group-open:rotate-180" />
          </summary>
          <div className="absolute right-0 top-full z-20 mt-2 w-56 overflow-hidden rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl">
            {menus.map(menu => (
              <Link
                key={menu.path}
                href={menu.path}
                target="_blank"
                className="flex min-h-10 items-center justify-between gap-3 rounded-lg px-3 text-xs font-bold text-zinc-700 transition-colors hover:bg-zinc-100"
              >
                <span className="truncate">{menu.name}</span>
                <span className="flex shrink-0 items-center gap-2">
                  {menu.isActive && <span className="rounded-full bg-green-50 px-2 py-0.5 text-[9px] uppercase text-green-700">Active</span>}
                  <ExternalLink size={12} className="text-zinc-400" />
                </span>
              </Link>
            ))}
          </div>
        </details>
      )}
      </div>
    </div>
  )
}
