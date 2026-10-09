'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Building2, ClipboardList, LayoutDashboard, LogOut, Rocket, Settings, Users } from 'lucide-react'
import { cn } from '@/lib/utils'

const items = [
  { href: '/overview', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/tenants', label: 'Clients', icon: Building2 },
  { href: '/tenants/launch', label: 'Launch checklist', icon: Rocket },
  { href: '/users', label: 'Users', icon: Users },
  { href: '/plans', label: 'Plans', icon: ClipboardList, separated: true },
  { href: '/admin', label: 'Settings', icon: Settings },
]

export default function SuperadminSidebar({ appName, logoUrl }: { appName: string; logoUrl?: string | null }) {
  const pathname = usePathname()

  return (
    <aside className="flex h-full w-full flex-col border-r border-zinc-800 bg-zinc-950 text-zinc-400">
      <div className="border-b border-zinc-800/50 p-6 pr-16 lg:pr-6">
        <div className="mb-1 flex items-center gap-2">
          <img src={logoUrl ?? '/icon.png'} alt="" className="size-6 rounded-md object-contain outline outline-1 -outline-offset-1 outline-white/10" />
          <Link href="/" className="truncate text-xs font-bold uppercase tracking-[0.2em] text-white transition-colors hover:text-primary">{appName}</Link>
        </div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Super Admin Console</p>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-4 scrollbar-hide" aria-label="Super admin navigation">
        {items.map(({ href, label, icon: Icon, separated }) => {
          // Longest match wins, so /tenants/launch highlights only "Launch
          // checklist", not "Clients" as well.
          const matches = (h: string) => pathname === h || pathname.startsWith(`${h}/`)
          const active = matches(href) && !items.some((other) => other.href.length > href.length && matches(other.href))
          return (
            <div key={href} className={separated ? 'pt-4' : undefined}>
              {separated && <div className="mb-4 h-px bg-zinc-800/50" />}
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'group flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm font-bold transition-[background-color,color,scale] duration-150 active:scale-[0.98]',
                  active ? 'bg-primary text-primary-foreground' : 'text-zinc-500 hover:bg-zinc-900 hover:text-white',
                )}
              >
                <Icon className={cn('size-4 flex-shrink-0 transition-colors', active ? 'text-primary-foreground' : 'text-zinc-500 group-hover:text-primary')} />
                {label}
              </Link>
            </div>
          )
        })}
      </nav>

      <div className="border-t border-zinc-800/50 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <form action="/api/auth/signout" method="post">
          <button type="submit" className="group flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-bold text-zinc-500 transition-[background-color,color,scale] duration-150 active:scale-[0.98] hover:bg-red-500/10 hover:text-red-500">
            <LogOut className="size-4" />
            Sign out
          </button>
        </form>
      </div>
    </aside>
  )
}
