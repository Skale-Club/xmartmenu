'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: '📊' },
  { href: '/menu/categories', label: 'Categorias', icon: '📂' },
  { href: '/menu/products', label: 'Produtos', icon: '🍽️' },
  { href: '/settings/branding', label: 'Branding', icon: '🎨' },
  { href: '/settings/qrcode', label: 'QR Code', icon: '📱' },
]

export default function AdminSidebar({ tenantName }: { tenantName: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  return (
    <aside className="w-60 flex-shrink-0 bg-white border-r border-zinc-200 flex flex-col">
      <div className="p-5 border-b border-zinc-200">
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1">Skale QR Menu</p>
        <p className="text-sm font-semibold text-zinc-900 truncate">{tenantName}</p>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
              pathname.startsWith(item.href)
                ? 'bg-zinc-900 text-white'
                : 'text-zinc-600 hover:bg-zinc-100'
            )}
          >
            <span>{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="p-3 border-t border-zinc-200">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-zinc-600 hover:bg-zinc-100 transition-colors"
        >
          <span>🚪</span>
          Sair
        </button>
      </div>
    </aside>
  )
}
