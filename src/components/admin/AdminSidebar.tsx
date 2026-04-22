'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { Menu, UserRole } from '@/types/database'

const mainItems = [
  { href: '/dashboard', label: 'Dashboard', icon: '📊' },
  { href: '/menus', label: 'Menus', icon: '📋' },
  { href: '/menu/categories', label: 'Categories', icon: '📂' },
  { href: '/menu/products', label: 'Products', icon: '🍽️' },
  { href: '/orders', label: 'Orders', icon: '📦' },
]

const adminPanelItems = [
  { href: '/settings/store', label: 'Store', icon: '🏪' },
  { href: '/settings/branding', label: 'Branding', icon: '🎨' },
  { href: '/settings/qrcode', label: 'QR Code', icon: '📱' },
  { href: '/settings/password', label: 'Change Password', icon: '🔑' },
  { href: '/settings/staff', label: 'Staff', icon: '👥' },
]

type SidebarMenu = Pick<Menu, 'id' | 'name' | 'slug' | 'is_active' | 'is_default'>

export default function AdminSidebar({
  tenantName,
  tenantSlug,
  role,
  appName = 'XmartMenu',
  menus = [],
  activeMenuId = null,
}: {
  tenantName: string
  tenantSlug?: string
  role: UserRole
  appName?: string
  menus?: SidebarMenu[]
  activeMenuId?: string | null
}) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const isInSettings = pathname.startsWith('/settings')
  const [panelOpen, setPanelOpen] = useState(isInSettings)
  const [selectedMenuId, setSelectedMenuId] = useState<string | null>(activeMenuId)
  const [menuLoading, setMenuLoading] = useState(false)
  const isStaff = role === 'store-staff'
  const visibleMainItems = isStaff
    ? mainItems.filter((item) => item.href !== '/menus')
    : mainItems
  const visibleAdminPanelItems = isStaff
    ? adminPanelItems.filter((item) => item.href === '/settings/qrcode' || item.href === '/settings/password')
    : adminPanelItems

  useEffect(() => {
    setSelectedMenuId(activeMenuId)
  }, [activeMenuId])

  const activeMenu = menus.find(menu => menu.id === selectedMenuId) ?? menus.find(menu => menu.is_default) ?? menus[0]
  const menuPublicPath = tenantSlug
    ? `/${tenantSlug}${activeMenu && !activeMenu.is_default ? `/${activeMenu.slug}` : ''}`
    : null

  async function handleSelectMenu(menuId: string) {
    setSelectedMenuId(menuId)
    setMenuLoading(true)
    await fetch('/api/admin/menus/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ menu_id: menuId }),
    })
    router.refresh()
    setMenuLoading(false)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  return (
    <aside className="w-60 flex-shrink-0 bg-white border-r border-zinc-200 flex flex-col">
      <div className="p-5 border-b border-zinc-200">
        <Link href="/" className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1 hover:text-zinc-600 transition-colors">{appName}</Link>
        <p className="text-sm font-semibold text-zinc-900 truncate">{tenantName}</p>
        {menus.length > 0 && (
          <div className="mt-3">
            <label className="block text-[11px] font-semibold text-zinc-400 uppercase tracking-wide mb-1">Active menu</label>
            <select
              value={selectedMenuId ?? ''}
              onChange={(e) => void handleSelectMenu(e.target.value)}
              disabled={menuLoading}
              className="w-full px-2.5 py-2 rounded-lg border border-zinc-200 text-xs text-zinc-700 bg-white focus:outline-none focus:ring-2 focus:ring-zinc-900"
            >
              {menus.map((menu) => (
                <option key={menu.id} value={menu.id}>
                  {menu.name}{menu.is_default ? ' (default)' : ''}{!menu.is_active ? ' (off)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {visibleMainItems.map(item => (
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

        {/* Admin Panel collapsible */}
        <div className="pt-1">
          <button
            onClick={() => setPanelOpen(o => !o)}
            className={cn(
              'w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
              isInSettings ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100'
            )}
          >
            <span className="flex items-center gap-3">
              <span>⚙️</span> Admin Panel
            </span>
            <span className={cn('text-xs transition-transform', panelOpen ? 'rotate-180' : '')}>▼</span>
          </button>

          {panelOpen && (
            <div className="mt-0.5 ml-3 pl-3 border-l border-zinc-200 space-y-0.5">
              {visibleAdminPanelItems.map(item => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                    pathname.startsWith(item.href)
                      ? 'bg-zinc-100 text-zinc-900 font-semibold'
                      : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900'
                  )}
                >
                  <span>{item.icon}</span>
                  {item.label}
                </Link>
              ))}
            </div>
          )}
        </div>
      </nav>

      <div className="p-3 border-t border-zinc-200 space-y-1">
        {menuPublicPath && (
          <a href={menuPublicPath} target="_blank" rel="noopener noreferrer"
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-zinc-600 hover:bg-zinc-100 transition-colors">
            <span>🔗</span> View menu
          </a>
        )}
        <button onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-zinc-600 hover:bg-zinc-100 transition-colors">
          <span>🚪</span> Sign out
        </button>
      </div>
    </aside>
  )
}
