'use client'

import { useEffect, useState } from 'react'
import { Copy, Check, ExternalLink } from 'lucide-react'
import Link from 'next/link'

export function CopyMenuUrl({ path }: { path: string }) {
  const [copied, setCopied] = useState(false)
  const [url, setUrl] = useState('')

  useEffect(() => {
    setUrl(`${window.location.origin}${path.startsWith('/') ? path : `/${path}`}`)
  }, [path])

  const handleCopy = async () => {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy text: ', err)
    }
  }

  if (!url) return null

  return (
    <div className="flex flex-col sm:flex-row items-center gap-3 w-full max-w-lg">
      <div className="relative flex-1 flex items-center w-full group">
        <input
          type="text"
          readOnly
          value={url}
          className="w-full bg-zinc-100/50 border border-zinc-200 text-zinc-600 text-xs font-bold rounded-2xl focus:ring-primary focus:border-primary block px-4 py-3 pr-12 transition-all group-hover:bg-white group-hover:border-zinc-300"
        />
        <button
          onClick={handleCopy}
          className="absolute right-2 p-2 text-zinc-400 hover:text-primary transition-colors"
          title="Copy URL"
        >
          {copied ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
        </button>
      </div>
      <Link
        href={url}
        target="_blank"
        className="flex items-center justify-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-full font-black hover:bg-zinc-950 hover:text-white transition-all shrink-0 w-full sm:w-auto text-xs uppercase tracking-widest shadow-sm active:scale-95"
      >
        <ExternalLink size={14} />
        Open Menu
      </Link>
    </div>
  )
}
