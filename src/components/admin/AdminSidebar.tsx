'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { Menu, UserRole } from '@/types/database'
import { 
  LayoutDashboard, 
  ClipboardList, 
  FolderOpen, 
  UtensilsCrossed, 
  Package, 
  Store, 
  CreditCard, 
  Palette, 
  QrCode, 
  Key, 
  Users, 
  Settings,
  ChevronDown,
  ExternalLink,
  LogOut,
  Salad
} from 'lucide-react'

const mainItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/menus', label: 'Menus', icon: ClipboardList },
  { href: '/menu/categories', label: 'Categories', icon: FolderOpen },
  { href: '/menu/products', label: 'Products', icon: UtensilsCrossed },
  { href: '/orders', label: 'Orders', icon: Package },
]

const adminPanelItems = [
  { href: '/settings/store', label: 'Store', icon: Store },
  { href: '/settings/subscription', label: 'Subscription', icon: CreditCard },
  { href: '/settings/branding', label: 'Branding', icon: Palette },
  { href: '/settings/qrcode', label: 'QR Code', icon: QrCode },
  { href: '/settings/password', label: 'Change Password', icon: Key },
  { href: '/settings/staff', label: 'Staff', icon: Users },
]

type SidebarMenu = Pick<Menu, 'id' | 'name' | 'slug' | 'is_active' | 'is_default'>

export default function AdminSidebar({
  tenantName,
  tenantSlug,
  role,
  appName = 'XmartMenu',
  menus = [],
  activeMenuId = null,
  ingredientCustomizationEnabled = false,
}: {
  tenantName: string
  tenantSlug?: string
  role: UserRole
  appName?: string
  menus?: SidebarMenu[]
  activeMenuId?: string | null
  ingredientCustomizationEnabled?: boolean
}) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const isInSettings = pathname.startsWith('/settings')
  const [panelOpen, setPanelOpen] = useState(isInSettings)
  const [selectedMenuId, setSelectedMenuId] = useState<string | null>(activeMenuId)
  const [menuLoading, setMenuLoading] = useState(false)
  const isStaff = role === 'store-staff'

  const ingredientItem = { href: '/menu/ingredients', label: 'Ingredients', icon: Salad }
  const visibleMainItems = [
    ...mainItems,
    ...(ingredientCustomizationEnabled ? [ingredientItem] : []),
  ].filter(item => isStaff ? item.href !== '/menus' : true)
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
    <aside className="w-64 flex-shrink-0 bg-zinc-950 text-zinc-400 flex flex-col border-r border-zinc-800">
      <div className="p-6 border-b border-zinc-800/50">
        <div className="flex items-center gap-2 mb-4">
          <img src="/icon.png" alt="XmartMenu Logo" className="w-6 h-6 object-cover rounded-sm" />
          <Link href="/" className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] hover:text-primary transition-colors">{appName}</Link>
        </div>
        <p className="text-lg font-black text-white truncate tracking-tight">{tenantName}</p>
        
        {menus.length > 0 && (
          <div className="mt-4">
            <label className="block text-[10px] font-bold text-zinc-600 uppercase tracking-widest mb-1.5 ml-1">Active menu</label>
            <div className="relative">
              <select
                value={selectedMenuId ?? ''}
                onChange={(e) => void handleSelectMenu(e.target.value)}
                disabled={menuLoading}
                className="w-full pl-3 pr-8 py-2 rounded-lg border border-zinc-800 text-xs font-bold text-zinc-300 bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-primary appearance-none cursor-pointer transition-all hover:border-primary/50"
              >
                {menus.map((menu) => (
                  <option key={menu.id} value={menu.id}>
                    {menu.name}{menu.is_default ? ' (default)' : ''}{!menu.is_active ? ' (off)' : ''}
                  </option>
                ))}
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-500">
                <ChevronDown className="w-3 h-3" />
              </div>
            </div>
          </div>
        )}
      </div>

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto scrollbar-hide">
        {visibleMainItems.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'group flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-bold transition-all duration-200',
                active
                  ? 'bg-primary text-zinc-950'
                  : 'text-zinc-500 hover:bg-zinc-900 hover:text-white'
              )}
            >
              <Icon className={cn('w-4 h-4 transition-transform group-hover:scale-110', active ? 'text-zinc-950' : 'text-zinc-500 group-hover:text-primary')} />
              {label}
            </Link>
          )
        })}

        {/* Admin Panel collapsible */}
        <div className="pt-2">
          <button
            onClick={() => setPanelOpen(o => !o)}
            className={cn(
              'w-full group flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg text-sm font-bold transition-all duration-200',
              isInSettings 
                ? 'bg-zinc-900 text-white' 
                : 'text-zinc-500 hover:bg-zinc-900 hover:text-white'
            )}
          >
            <span className="flex items-center gap-3">
              <Settings className={cn('w-4 h-4', isInSettings ? 'text-primary' : 'text-zinc-500')} />
              Admin Panel
            </span>
            <ChevronDown className={cn('w-3.5 h-3.5 transition-transform duration-300', panelOpen ? 'rotate-180' : '')} />
          </button>

          {panelOpen && (
            <div className="mt-1 ml-4 pl-4 border-l border-zinc-800 space-y-1">
              {visibleAdminPanelItems.map(({ href, label, icon: Icon }) => {
                const active = pathname.startsWith(href)
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      'group flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-bold transition-all duration-200',
                      active
                        ? 'text-primary'
                        : 'text-zinc-500 hover:text-white'
                    )}
                  >
                    <Icon className={cn('w-4 h-4 transition-all', active ? 'text-primary scale-110' : 'text-zinc-600 group-hover:text-primary')} />
                    {label}
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </nav>

      <div className="p-4 border-t border-zinc-800/50 space-y-1">
        {menuPublicPath && (
          <a 
            href={menuPublicPath} 
            target="_blank" 
            rel="noopener noreferrer"
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-bold text-zinc-500 hover:bg-zinc-900 hover:text-white transition-all"
          >
            <ExternalLink className="w-4 h-4 text-zinc-500" />
            View public menu
          </a>
        )}
        <button 
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-bold text-zinc-500 hover:bg-red-500/10 hover:text-red-500 transition-all group"
        >
          <LogOut className="w-4 h-4 text-zinc-500 group-hover:text-red-500 transition-colors" />
          Sign out
        </button>
      </div>
    </aside>
  )
}
