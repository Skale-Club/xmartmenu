'use client'
import { type Dispatch, type ReactNode, type SetStateAction, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { Plus, LayoutDashboard, Globe, Settings, Trash2, Eye, Edit3, CheckCircle2, ChevronRight, X, ArrowRight, Lock, Unlock } from 'lucide-react'
import { cn } from '@/lib/utils'

const PURPOSES = ['restaurant', 'bar', 'cafe', 'hotel', 'salon', 'retail', 'other']
const LANGUAGES = [
  { value: 'en', label: 'English' }, { value: 'pt', label: 'Portuguese' },
  { value: 'es', label: 'Spanish' }, { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' }, { value: 'it', label: 'Italian' },
]

type MenuTranslations = Record<string, { name?: string; description?: string }>
interface Menu {
  id: string
  name: string
  slug: string
  language: string
  supported_languages?: string[]
  translations?: MenuTranslations
  purpose: string
  description: string | null
  is_active: boolean
  is_default: boolean
  is_private: boolean
  price_multiplier: number
  position: number
}

interface MenuDraft {
  name: string
  language: string
  supported_languages: string[]
  translations: Record<string, { name: string; description: string }>
  purpose: string
  description: string
  is_private: boolean
  price_multiplier: number
}

const EMPTY_DRAFT: MenuDraft = {
  name: '',
  language: 'en',
  supported_languages: ['en'],
  translations: {},
  purpose: 'restaurant',
  description: '',
  is_private: false,
  price_multiplier: 1.00,
}

function toDraft(menu?: Menu): MenuDraft {
  if (!menu) return { ...EMPTY_DRAFT }
  const supported = menu.supported_languages?.length ? menu.supported_languages : [menu.language]
  const safeSupported = supported.includes(menu.language) ? supported : [menu.language, ...supported]
  const translations = menu.translations ?? {}
  const nextTranslations: Record<string, { name: string; description: string }> = {}

  for (const lang of safeSupported) {
    nextTranslations[lang] = {
      name: translations[lang]?.name ?? '',
      description: translations[lang]?.description ?? '',
    }
  }

  return {
    name: menu.name,
    language: menu.language,
    supported_languages: safeSupported,
    translations: nextTranslations,
    purpose: menu.purpose,
    description: menu.description ?? '',
    is_private: menu.is_private ?? false,
    price_multiplier: menu.price_multiplier ?? 1.00,
  }
}

function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white rounded-lg border border-zinc-200 shadow-2xl">
        <div className="flex items-center justify-between px-8 py-6 border-b border-zinc-100">
          <h2 className="text-xl font-black text-zinc-950 tracking-tight">{title}</h2>
          <button type="button" onClick={onClose} className="p-2 hover:bg-zinc-100 rounded-full transition-colors"><X className="w-5 h-5 text-zinc-400" /></button>
        </div>
        <div className="p-8">{children}</div>
      </div>
    </div>
  )
}

function MenuFormFields({
  draft,
  setDraft,
}: {
  draft: MenuDraft
  setDraft: Dispatch<SetStateAction<MenuDraft>>
}) {
  const inputClassName = "w-full px-5 py-3.5 bg-zinc-50 border border-zinc-200 rounded-lg text-sm text-zinc-950 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
  
  const supported = draft.supported_languages.includes(draft.language)
    ? draft.supported_languages
    : [draft.language, ...draft.supported_languages]

  function toggleLanguage(lang: string) {
    const isBase = draft.language === lang
    if (isBase) return
    const has = draft.supported_languages.includes(lang)
    const nextSupported = has
      ? draft.supported_languages.filter(x => x !== lang)
      : [...draft.supported_languages, lang]

    setDraft({
      ...draft,
      supported_languages: nextSupported,
      translations: has
        ? Object.fromEntries(Object.entries(draft.translations).filter(([key]) => key !== lang))
        : { ...draft.translations, [lang]: draft.translations[lang] ?? { name: '', description: '' } },
    })
  }

  function setBaseLanguage(lang: string) {
    const nextSupported = draft.supported_languages.includes(lang) ? draft.supported_languages : [lang, ...draft.supported_languages]
    setDraft({
      ...draft,
      language: lang,
      supported_languages: nextSupported,
      translations: { ...draft.translations, [lang]: draft.translations[lang] ?? { name: '', description: '' } },
    })
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div>
          <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2 ml-1">Menu Name *</label>
          <input required className={inputClassName} value={draft.name} onChange={e => setDraft(f => ({ ...f, name: e.target.value }))} placeholder="Dinner Menu" />
        </div>
        <div>
          <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2 ml-1">Purpose</label>
          <select className={inputClassName} value={draft.purpose} onChange={e => setDraft(f => ({ ...f, purpose: e.target.value }))}>
            {PURPOSES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2 ml-1">Default language</label>
          <select className={inputClassName} value={draft.language} onChange={e => setBaseLanguage(e.target.value)}>
            {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2 ml-1">Brief Description</label>
          <input className={inputClassName} value={draft.description} onChange={e => setDraft(f => ({ ...f, description: e.target.value }))} placeholder="Optional" />
        </div>
      </div>

      <div>
        <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-3 ml-1">Enable multi-language support</label>
        <div className="flex flex-wrap gap-2">
          {LANGUAGES.map(lang => {
            const checked = supported.includes(lang.value)
            const isBase = draft.language === lang.value
            return (
              <label key={lang.value} className={cn(
                "text-xs px-4 py-2 rounded-full border font-bold cursor-pointer transition-all active:scale-95",
                checked 
                  ? 'bg-zinc-950 text-white border-zinc-950' 
                  : 'bg-white text-zinc-500 border-zinc-200 hover:border-zinc-400'
              )}>
                <input type="checkbox" className="hidden" checked={checked} onChange={() => toggleLanguage(lang.value)} disabled={isBase} />
                {lang.label}{isBase ? ' (Default)' : ''}
              </label>
            )
          })}
        </div>
      </div>

      {/* Privacy & Pricing */}
      <div className="border-t border-zinc-100 pt-6 space-y-4">
        <div className="flex items-center gap-3">
          {draft.is_private ? <Lock className="w-4 h-4 text-amber-500" /> : <Unlock className="w-4 h-4 text-zinc-400" />}
          <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Access & Pricing</span>
        </div>
        <div
          className="flex items-center justify-between p-4 rounded-lg bg-zinc-50 hover:bg-zinc-100 transition-all cursor-pointer"
          onClick={() => setDraft(f => ({ ...f, is_private: !f.is_private }))}
        >
          <div>
            <p className="text-sm font-black text-zinc-950">Private Menu</p>
            <p className="text-[10px] text-zinc-500 font-medium mt-0.5">Requires phone OTP login to access. Use for in-store pricing.</p>
          </div>
          <button
            type="button"
            className={cn(
              "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none flex-shrink-0",
              draft.is_private ? "bg-amber-400" : "bg-zinc-200"
            )}
          >
            <span className={cn(
              "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200",
              draft.is_private ? "translate-x-5" : "translate-x-0.5"
            )} />
          </button>
        </div>
        {draft.is_private && (
          <div className="space-y-2 px-4">
            <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest">Price Multiplier</label>
            <input
              type="number"
              min={1.0}
              max={5.0}
              step={0.05}
              value={draft.price_multiplier}
              onChange={e => setDraft(f => ({ ...f, price_multiplier: Math.max(1, Number(Number(e.target.value).toFixed(2))) }))}
              className={inputClassName}
            />
            <p className="text-[10px] font-medium text-zinc-400 ml-1">
              1.00 = no change · 1.15 = 15% higher than public prices
            </p>
          </div>
        )}
      </div>

      {supported.filter(lang => lang !== draft.language).map(lang => (
        <div key={lang} className="p-6 bg-zinc-50 rounded-lg border border-zinc-100 space-y-4">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-primary" />
            <span className="text-[10px] font-black text-zinc-950 uppercase tracking-widest">{LANGUAGES.find(x => x.value === lang)?.label ?? lang} Translation</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2 ml-1">Translated name</label>
              <input
                className={inputClassName}
                value={draft.translations[lang]?.name ?? ''}
                onChange={e => setDraft(f => ({ ...f, translations: { ...f.translations, [lang]: { ...(f.translations[lang] ?? { name: '', description: '' }), name: e.target.value } } }))}
              />
            </div>
            <div>
              <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2 ml-1">Translated description</label>
              <input
                className={inputClassName}
                value={draft.translations[lang]?.description ?? ''}
                onChange={e => setDraft(f => ({ ...f, translations: { ...f.translations, [lang]: { ...(f.translations[lang] ?? { name: '', description: '' }), description: e.target.value } } }))}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function MenusClient({ menus: initial, tenantSlug, activeMenuId }: { menus: Menu[]; tenantSlug: string; activeMenuId: string | null }) {
  const [menus, setMenus] = useState(initial)
  const [selectedMenuId, setSelectedMenuId] = useState(activeMenuId)
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState<MenuDraft>(EMPTY_DRAFT)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<MenuDraft>(EMPTY_DRAFT)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const router = useRouter()

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const supported = createForm.supported_languages.includes(createForm.language)
      ? createForm.supported_languages
      : [createForm.language, ...createForm.supported_languages]
    const payload = { ...createForm, supported_languages: supported }
    const res = await fetch('/api/admin/menus', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const data = await res.json()
    if (!res.ok) { setError(data.error); setLoading(false); return }
    setMenus(m => [...m, data])
    setCreateOpen(false)
    setCreateForm({ ...EMPTY_DRAFT })
    setLoading(false)
  }

  async function handleToggle(menu: Menu, field: 'is_active' | 'is_default') {
    const update = { [field]: !menu[field] }
    const res = await fetch(`/api/admin/menus/${menu.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(update) })
    const data = await res.json()
    if (res.ok) {
      if (field === 'is_default') setMenus(m => m.map(x => ({ ...x, is_default: x.id === menu.id })))
      else setMenus(m => m.map(x => x.id === menu.id ? { ...x, ...data } : x))
    }
  }

  async function handleDelete() {
    if (!confirmId) return
    const res = await fetch(`/api/admin/menus/${confirmId}`, { method: 'DELETE' })
    if (res.ok) setMenus(m => m.filter(x => x.id !== confirmId))
    else { const d = await res.json(); setError(d.error) }
    setConfirmId(null)
  }

  async function selectMenu(menuId: string) {
    const res = await fetch('/api/admin/menus/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ menu_id: menuId }),
    })

    if (!res.ok) {
      const d = await res.json()
      setError(d.error ?? 'Failed to select menu')
      return
    }

    setSelectedMenuId(menuId)
  }

  function startEdit(menu: Menu) {
    setEditingId(menu.id)
    setEditForm(toDraft(menu))
  }

  function cancelEdit() {
    setEditingId(null)
    setEditForm({ ...EMPTY_DRAFT })
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editingId) return
    setLoading(true)
    setError(null)

    const supported = editForm.supported_languages.includes(editForm.language)
      ? editForm.supported_languages
      : [editForm.language, ...editForm.supported_languages]

    const payload = {
      ...editForm,
      supported_languages: supported,
      description: editForm.description || null,
    }

    const res = await fetch(`/api/admin/menus/${editingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Failed to update menu'); setLoading(false); return }

    setMenus(m => m.map(x => x.id === editingId ? { ...x, ...data } : x))
    cancelEdit()
    setLoading(false)
  }

  return (
    <div className="p-8 w-full space-y-8">
      <ConfirmDialog open={!!confirmId} title="Delete menu" message="Delete this menu? All categories and products in it will also be deleted." onConfirm={handleDelete} onCancel={() => setConfirmId(null)} />

      <Modal open={createOpen} title="New Menu Instance" onClose={() => setCreateOpen(false)}>
        <form onSubmit={handleCreate} className="space-y-8">
          <MenuFormFields draft={createForm} setDraft={setCreateForm} />
          <div className="flex gap-4 pt-4">
            <button type="submit" disabled={loading} className="flex-1 bg-primary text-zinc-950 py-4 rounded-full text-base font-black hover:bg-zinc-950 hover:text-white transition-all active:scale-95 disabled:opacity-50">
              {loading ? 'Creating...' : 'Create Instance'}
            </button>
            <button type="button" onClick={() => setCreateOpen(false)} className="px-8 py-4 rounded-full text-base font-bold text-zinc-500 hover:bg-zinc-100 transition-colors">Cancel</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!editingId} title="Edit Menu Settings" onClose={cancelEdit}>
        <form onSubmit={saveEdit} className="space-y-8">
          <MenuFormFields draft={editForm} setDraft={setEditForm} />
          <div className="flex gap-4 pt-4">
            <button type="submit" disabled={loading} className="flex-1 bg-primary text-zinc-950 py-4 rounded-full text-base font-black hover:bg-zinc-950 hover:text-white transition-all active:scale-95 disabled:opacity-50">
              {loading ? 'Saving...' : 'Save Configuration'}
            </button>
            <button type="button" onClick={cancelEdit} className="px-8 py-4 rounded-full text-base font-bold text-zinc-500 hover:bg-zinc-100 transition-colors">Cancel</button>
          </div>
        </form>
      </Modal>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 pb-6 border-b border-zinc-100">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Plus className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">Instances</span>
          </div>
          <h1 className="text-4xl font-black text-zinc-950 tracking-tight">Menus</h1>
          <p className="text-sm font-bold text-zinc-500 mt-1">Manage your active digital menu instances.</p>
        </div>
        <button 
          onClick={() => setCreateOpen(true)} 
          className="bg-primary text-zinc-950 px-8 py-4 rounded-full text-sm font-black hover:bg-zinc-950 hover:text-white transition-all active:scale-95 flex items-center gap-2 uppercase tracking-widest shadow-sm"
        >
          <Plus className="w-4 h-4" />
          New Menu
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-100 rounded-lg px-6 py-4 text-sm font-bold text-red-600 flex justify-between items-center">{error}<button onClick={() => setError(null)} className="p-1 hover:bg-red-100 rounded-full transition-colors"><X className="w-4 h-4" /></button></div>}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {menus.map(menu => {
          const isEditing = selectedMenuId === menu.id
          return (
            <div 
              key={menu.id} 
              className={cn(
                "group bg-white border rounded-lg p-8 transition-all duration-300 flex flex-col sm:flex-row gap-8 items-start sm:items-center",
                isEditing ? "border-primary ring-4 ring-primary/10 shadow-lg shadow-primary/5" : "border-zinc-100 hover:border-zinc-200"
              )}
            >
              <div className="flex-1 min-w-0 space-y-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <h3 className="text-2xl font-black text-zinc-950 truncate tracking-tight">{menu.name}</h3>
                  <div className="flex gap-2">
                    {menu.is_default && <span className="text-[9px] font-black uppercase tracking-widest bg-zinc-950 text-white px-2.5 py-1 rounded-full">Default</span>}
                    {isEditing && <span className="text-[9px] font-black uppercase tracking-widest bg-primary text-zinc-950 px-2.5 py-1 rounded-full">Editing</span>}
                    {!menu.is_active && <span className="text-[9px] font-black uppercase tracking-widest bg-zinc-100 text-zinc-400 px-2.5 py-1 rounded-full">Off</span>}
                    {menu.is_private && <span className="text-[9px] font-black uppercase tracking-widest bg-amber-100 text-amber-700 px-2.5 py-1 rounded-full flex items-center gap-1"><Lock className="w-2.5 h-2.5" />Private</span>}
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs font-bold text-zinc-400">
                  <span className="flex items-center gap-1.5 font-mono">/{menu.slug}</span>
                  <span className="opacity-30">•</span>
                  <span className="flex items-center gap-1.5 uppercase tracking-wider">{menu.language}</span>
                  <span className="opacity-30">•</span>
                  <span className="flex items-center gap-1.5 capitalize">{menu.purpose}</span>
                </div>
                <div className="pt-2 flex flex-wrap gap-2">
                  {(menu.supported_languages?.length ? menu.supported_languages : [menu.language]).map(lang => (
                    <span key={lang} className="text-[10px] font-black uppercase tracking-tighter text-zinc-300 border border-zinc-100 px-2 py-0.5 rounded-md">{lang}</span>
                  ))}
                </div>
                {menu.description && <p className="text-sm font-medium text-zinc-500 line-clamp-2 leading-relaxed">{menu.description}</p>}
              </div>

              <div className="flex flex-wrap sm:flex-col gap-2 flex-shrink-0 w-full sm:w-auto">
                <button
                  onClick={async () => {
                    await selectMenu(menu.id)
                    router.push('/menu/categories')
                  }}
                  className="flex-1 sm:w-40 flex items-center justify-between gap-2 px-5 py-3 rounded-lg bg-zinc-950 text-white text-xs font-black hover:bg-primary hover:text-zinc-950 transition-all active:scale-95 group/btn"
                >
                  Manage Items
                  <ArrowRight className="w-3.5 h-3.5 group-hover/btn:translate-x-1 transition-transform" />
                </button>
                <div className="grid grid-cols-2 gap-2 w-full">
                  <Link
                    href={`/${tenantSlug}${menu.is_default ? '' : `/${menu.slug}`}`}
                    target="_blank"
                    className="flex items-center justify-center p-3 rounded-lg border border-zinc-100 text-zinc-500 hover:bg-zinc-50 hover:text-zinc-950 transition-all"
                    title="View Public Menu"
                  >
                    <Eye className="w-4 h-4" />
                  </Link>
                  <button 
                    onClick={() => startEdit(menu)} 
                    className="flex items-center justify-center p-3 rounded-lg border border-zinc-100 text-zinc-500 hover:bg-zinc-50 hover:text-zinc-950 transition-all"
                    title="Edit Settings"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                </div>
                {!menu.is_default && (
                  <button 
                    onClick={() => handleToggle(menu, 'is_default')} 
                    className="text-[10px] font-black uppercase tracking-widest py-2 rounded-lg border border-zinc-100 text-zinc-400 hover:text-zinc-950 hover:border-zinc-300 transition-all"
                  >
                    Set Default
                  </button>
                )}
                <div className="flex gap-2 w-full">
                  <button 
                    onClick={() => handleToggle(menu, 'is_active')} 
                    className={cn(
                      "flex-1 text-[10px] font-black uppercase tracking-widest py-2 rounded-lg border transition-all",
                      menu.is_active ? "border-zinc-100 text-zinc-400 hover:text-zinc-950" : "border-green-100 text-green-500 bg-green-50/50"
                    )}
                  >
                    {menu.is_active ? 'Off' : 'On'}
                  </button>
                  {!menu.is_default && (
                    <button 
                      onClick={() => setConfirmId(menu.id)} 
                      className="p-2 rounded-lg border border-red-50 text-red-300 hover:bg-red-50 hover:text-red-500 transition-all"
                      title="Delete Instance"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
