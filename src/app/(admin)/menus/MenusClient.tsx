'use client'
import { type Dispatch, type SetStateAction, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { Plus, LayoutDashboard, Globe, Settings, Trash2, Eye, Edit3, CheckCircle2, ChevronRight, X, ArrowRight, Lock, Unlock, FlaskConical, Link2, RefreshCw, Rocket, History } from 'lucide-react'
import { cn } from '@/lib/utils'
import Modal from '@/components/ui/Modal'
import { MENU_LANGUAGES } from '@/components/menu/menu-i18n'

const PURPOSES = ['restaurant', 'bar', 'cafe', 'hotel', 'salon', 'retail', 'other']
// The languages a guest can switch the menu to (English name + native name).
const LANGUAGES = MENU_LANGUAGES.map(l => ({
  value: l.code,
  label: l.englishName === l.nativeName ? l.englishName : `${l.englishName} · ${l.nativeName}`,
}))

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
  /** Menu staging (docs/product/menu-staging.md): the live menu this copy stages, or null. */
  staging_of?: string | null
  preview_token?: string | null
  /** Set on a version a publish took out of production (kept for undo). */
  replaced_at?: string | null
}

/** Live menus in their order, each followed by its open staging and then its older versions. */
function withStagingOrder(list: Menu[]): Menu[] {
  const ids = new Set(list.map(menu => menu.id))
  const copiesOf = (id: string) => list
    .filter(menu => menu.staging_of === id)
    .sort((a, b) => (a.replaced_at ? 1 : 0) - (b.replaced_at ? 1 : 0) || String(b.replaced_at ?? '').localeCompare(String(a.replaced_at ?? '')))
  const ordered: Menu[] = []
  for (const menu of list) {
    if (menu.staging_of && ids.has(menu.staging_of)) continue
    ordered.push(menu, ...copiesOf(menu.id))
  }
  return ordered
}

function previewUrl(tenantSlug: string, token: string): string {
  return `${window.location.origin}/${tenantSlug}/preview/${token}`
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

function MenuFormFields({
  draft,
  setDraft,
}: {
  draft: MenuDraft
  setDraft: Dispatch<SetStateAction<MenuDraft>>
}) {
  const inputClassName = "w-full px-5 py-3.5 bg-zinc-50 border border-zinc-200 rounded-lg text-sm text-zinc-950 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
  
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
          <label className="block text-[14px] font-semibold text-zinc-700 mb-2 ml-1">Menu Name *</label>
          <input required className={inputClassName} value={draft.name} onChange={e => setDraft(f => ({ ...f, name: e.target.value }))} placeholder="Dinner Menu" />
        </div>
        <div>
          <label className="block text-[14px] font-semibold text-zinc-700 mb-2 ml-1">Purpose</label>
          <select className={inputClassName} value={draft.purpose} onChange={e => setDraft(f => ({ ...f, purpose: e.target.value }))}>
            {PURPOSES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[14px] font-semibold text-zinc-700 mb-2 ml-1">Default language</label>
          <select className={inputClassName} value={draft.language} onChange={e => setBaseLanguage(e.target.value)}>
            {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[14px] font-semibold text-zinc-700 mb-2 ml-1">Brief Description</label>
          <input className={inputClassName} value={draft.description} onChange={e => setDraft(f => ({ ...f, description: e.target.value }))} placeholder="Optional" />
        </div>
      </div>

      <div>
        <label className="block text-[14px] font-semibold text-zinc-700 mb-3 ml-1">Enable multi-language support</label>
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
            <label className="block text-[14px] font-semibold text-zinc-700">Price Multiplier</label>
            <input
              type="number"
              min={1.0}
              max={5.0}
              step={0.05}
              value={draft.price_multiplier}
              onChange={e => setDraft(f => ({ ...f, price_multiplier: Math.max(1, Number(Number(e.target.value).toFixed(2))) }))}
              className={inputClassName}
            />
            <p className="text-[13px] font-medium text-zinc-600 ml-1">
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
              <label className="block text-[14px] font-semibold text-zinc-700 mb-2 ml-1">Translated name</label>
              <input
                className={inputClassName}
                value={draft.translations[lang]?.name ?? ''}
                onChange={e => setDraft(f => ({ ...f, translations: { ...f.translations, [lang]: { ...(f.translations[lang] ?? { name: '', description: '' }), name: e.target.value } } }))}
              />
            </div>
            <div>
              <label className="block text-[14px] font-semibold text-zinc-700 mb-2 ml-1">Translated description</label>
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
  const [publishTarget, setPublishTarget] = useState<Menu | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const router = useRouter()
  const byId = new Map(menus.map(menu => [menu.id, menu]))

  async function stagingAction(menu: Menu, action: 'create' | 'publish' | 'rotate-link') {
    setBusyId(menu.id)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/admin/menus/${menu.id}/staging`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error ?? 'Staging failed'); return null }
      return data
    } finally {
      setBusyId(null)
    }
  }

  async function createStaging(menu: Menu) {
    const staging = await stagingAction(menu, 'create') as Menu | null
    if (!staging) return
    setMenus(m => [...m, staging])
    // The team edits the copy from now on; the live menu stays as it is.
    await selectMenu(staging.id)
    setNotice(`Staging copy of "${menu.name}" created and selected for editing. Changes stay off the live menu until you publish.`)
  }

  async function publishStaging() {
    const menu = publishTarget
    setPublishTarget(null)
    if (!menu) return
    const result = await stagingAction(menu, 'publish') as { live: Menu; previous: Menu } | null
    if (!result) return
    const { live, previous } = result
    setMenus(m => m.map(x => x.id === live.id ? live : x.id === previous.id ? previous : x.staging_of === previous.id ? { ...x, staging_of: live.id } : x))
    setNotice(menu.replaced_at
      ? `Restored. "${live.name}" is live again; the version it replaced is kept below.`
      : `Published. Guests now see this version at /${live.slug}. The previous version is kept below for undo. Edits to this menu now go live: create a new staging copy for the next change.`)
  }

  async function rotateLink(menu: Menu) {
    const updated = await stagingAction(menu, 'rotate-link') as Menu | null
    if (!updated) return
    setMenus(m => m.map(x => x.id === updated.id ? updated : x))
    setNotice('New preview link created. The old link no longer opens this menu.')
  }

  async function copyLink(menu: Menu) {
    if (!menu.preview_token) return
    const url = previewUrl(tenantSlug, menu.preview_token)
    try {
      await navigator.clipboard.writeText(url)
      setNotice(`Preview link copied: ${url}`)
    } catch {
      setNotice(`Preview link: ${url}`)
    }
  }

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
      <ConfirmDialog open={!!confirmId} title={confirmId && byId.get(confirmId)?.staging_of ? 'Discard staging copy' : 'Delete menu'} message={confirmId && byId.get(confirmId)?.staging_of ? 'Discard this copy? Its categories and dishes are deleted; the live menu and the shared photos and 3D files are not touched.' : 'Delete this menu? All categories and products in it will also be deleted.'} onConfirm={handleDelete} onCancel={() => setConfirmId(null)} />
      <ConfirmDialog
        open={!!publishTarget}
        title={publishTarget?.replaced_at ? 'Restore this version' : 'Publish to production'}
        message={publishTarget
          ? `Guests will see this version instead of "${byId.get(publishTarget.staging_of ?? '')?.name ?? 'the live menu'}" at the same address, QR codes and branches, right away. The current live version is kept as a previous version, so you can restore it.`
          : ''}
        onConfirm={publishStaging}
        onCancel={() => setPublishTarget(null)}
      />

      <Modal size="lg" open={createOpen} title="New Menu Instance" onClose={() => setCreateOpen(false)}>
        <form onSubmit={handleCreate} className="space-y-8">
          <MenuFormFields draft={createForm} setDraft={setCreateForm} />
          <div className="flex flex-col gap-3 pt-4 sm:flex-row sm:gap-4">
            <button type="submit" disabled={loading} className="flex-1 bg-primary text-primary-foreground py-4 rounded-full text-base font-black hover:bg-zinc-950 hover:text-white transition-all active:scale-95 disabled:opacity-50">
              {loading ? 'Creating...' : 'Create Instance'}
            </button>
            <button type="button" onClick={() => setCreateOpen(false)} className="min-h-12 px-8 py-3 rounded-full text-base font-bold text-zinc-500 hover:bg-zinc-100 transition-colors">Cancel</button>
          </div>
        </form>
      </Modal>

      <Modal size="lg" open={!!editingId} title="Edit Menu Settings" onClose={cancelEdit}>
        <form onSubmit={saveEdit} className="space-y-8">
          <MenuFormFields draft={editForm} setDraft={setEditForm} />
          <div className="flex flex-col gap-3 pt-4 sm:flex-row sm:gap-4">
            <button type="submit" disabled={loading} className="flex-1 bg-primary text-primary-foreground py-4 rounded-full text-base font-black hover:bg-zinc-950 hover:text-white transition-all active:scale-95 disabled:opacity-50">
              {loading ? 'Saving...' : 'Save Configuration'}
            </button>
            <button type="button" onClick={cancelEdit} className="min-h-12 px-8 py-3 rounded-full text-base font-bold text-zinc-500 hover:bg-zinc-100 transition-colors">Cancel</button>
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
          className="bg-primary text-primary-foreground px-8 py-4 rounded-full text-sm font-black hover:bg-zinc-950 hover:text-white transition-all active:scale-95 flex items-center gap-2 uppercase tracking-widest shadow-sm"
        >
          <Plus className="w-4 h-4" />
          New Menu
        </button>
      </div>

      {notice && <div className="bg-emerald-50 border border-emerald-100 rounded-lg px-6 py-4 text-sm font-bold text-emerald-800 flex justify-between items-center gap-4 break-all">{notice}<button onClick={() => setNotice(null)} className="p-1 hover:bg-emerald-100 rounded-full transition-colors shrink-0"><X className="w-4 h-4" /></button></div>}
      {error && <div className="bg-red-50 border border-red-100 rounded-lg px-6 py-4 text-sm font-bold text-red-600 flex justify-between items-center">{error}<button onClick={() => setError(null)} className="p-1 hover:bg-red-100 rounded-full transition-colors"><X className="w-4 h-4" /></button></div>}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {withStagingOrder(menus).map(menu => {
          const isEditing = selectedMenuId === menu.id
          const stagedFrom = menu.staging_of ? byId.get(menu.staging_of) ?? null : null
          const isStaging = !!stagedFrom && !menu.replaced_at
          const isPrevious = !!stagedFrom && !!menu.replaced_at
          const hasOpenStaging = !menu.staging_of && menus.some(x => x.staging_of === menu.id && !x.replaced_at)
          const busy = busyId === menu.id
          return (
            <div
              key={menu.id}
              className={cn(
                'flex flex-col gap-5 rounded-2xl border bg-white p-6 transition-[border-color,box-shadow] duration-200',
                isEditing ? 'border-primary ring-4 ring-primary/10' : 'border-zinc-200 hover:border-zinc-300',
                isStaging && !isEditing && 'border-dashed border-amber-300 bg-amber-50/30',
                isPrevious && 'opacity-80'
              )}
            >
              {/* Top: name and badges, then where it lives; view and edit as quiet icons. */}
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-xl font-black tracking-tight text-zinc-950">{menu.name}</h3>
                    {menu.is_default && <span className="rounded-full bg-zinc-950 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">Default</span>}
                    {isEditing && <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary-foreground">Editing</span>}
                    {isStaging && <span className="flex items-center gap-1 rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-950"><FlaskConical className="size-2.5" />Staging</span>}
                    {isPrevious && <span className="flex items-center gap-1 rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-700"><History className="size-2.5" />Previous version</span>}
                    {!menu.is_active && !stagedFrom && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-600">Hidden</span>}
                    {menu.is_private && <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-800"><Lock className="size-2.5" />Private</span>}
                  </div>
                  {stagedFrom && (
                    <p className="mt-1.5 text-[13px] font-semibold text-amber-800">
                      {isStaging
                        ? <>Copy of <span className="font-black">{stagedFrom.name}</span> (live). Not public: share the preview link, then publish.</>
                        : <>Replaced{menu.replaced_at ? ` on ${new Date(menu.replaced_at).toLocaleDateString()}` : ''} by <span className="font-black">{stagedFrom.name}</span>. Restore to undo the publish.</>}
                    </p>
                  )}
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[13px] font-medium text-zinc-500">
                    <span className="font-mono">{stagedFrom ? 'preview link only' : `/${menu.slug}`}</span>
                    <span aria-hidden="true" className="text-zinc-300">·</span>
                    <span className="uppercase">{menu.language}</span>
                    <span aria-hidden="true" className="text-zinc-300">·</span>
                    <span className="capitalize">{menu.purpose}</span>
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Link
                    href={stagedFrom && menu.preview_token ? `/${tenantSlug}/preview/${menu.preview_token}` : `/${tenantSlug}${menu.is_default ? '' : `/${menu.slug}`}`}
                    target="_blank"
                    className="flex size-10 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-950"
                    title={stagedFrom ? 'Open preview' : 'View public menu'}
                    aria-label={stagedFrom ? 'Open preview' : 'View public menu'}
                  >
                    <Eye className="size-4" />
                  </Link>
                  <button
                    onClick={() => startEdit(menu)}
                    className="flex size-10 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-950"
                    title="Edit settings"
                    aria-label="Edit settings"
                  >
                    <Edit3 className="size-4" />
                  </button>
                </div>
              </div>

              {menu.description && <p className="-mt-1 line-clamp-2 text-sm leading-relaxed text-zinc-600">{menu.description}</p>}

              {/* Languages as tags only when there is more than the one already named above. */}
              {(menu.supported_languages?.length ?? 0) > 1 && (
                <div className="-mt-1 flex flex-wrap gap-1.5">
                  {menu.supported_languages!.map(lang => (
                    <span key={lang} className="rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] font-bold uppercase text-zinc-600">{lang}</span>
                  ))}
                </div>
              )}

              {/* Bottom: the main action, visibility as a switch, then default and delete. */}
              <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-zinc-100 pt-4">
                <button
                  onClick={async () => {
                    await selectMenu(menu.id)
                    router.push('/menu/categories')
                  }}
                  className="group/btn flex h-10 items-center gap-2 rounded-lg bg-zinc-950 px-4 text-[13px] font-bold text-white transition-colors hover:bg-primary hover:text-primary-foreground active:scale-[0.98]"
                >
                  Manage items
                  <ArrowRight className="size-3.5 transition-transform group-hover/btn:translate-x-0.5" />
                </button>
                {stagedFrom ? (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setPublishTarget(menu)}
                      className="flex h-10 items-center gap-2 rounded-lg bg-amber-400 px-4 text-[13px] font-bold text-zinc-950 transition-colors hover:bg-amber-500 active:scale-[0.98] disabled:opacity-50"
                    >
                      {isStaging ? <Rocket className="size-3.5" /> : <History className="size-3.5" />}
                      {isStaging ? 'Publish' : 'Restore'}
                    </button>
                    {menu.preview_token && (
                      <button
                        type="button"
                        onClick={() => copyLink(menu)}
                        className="flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-950"
                      >
                        <Link2 className="size-3.5" />
                        Copy preview link
                      </button>
                    )}
                    <div className="ml-auto flex items-center gap-1">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => rotateLink(menu)}
                        className="flex size-9 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-950 disabled:opacity-50"
                        title="New preview link (the old one stops working)"
                        aria-label="New preview link"
                      >
                        <RefreshCw className="size-4" />
                      </button>
                      <button
                        onClick={() => setConfirmId(menu.id)}
                        className="flex size-9 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600"
                        title={isStaging ? 'Discard staging copy' : 'Delete this version'}
                        aria-label={isStaging ? 'Discard staging copy' : 'Delete this version'}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={menu.is_active}
                      onClick={() => handleToggle(menu, 'is_active')}
                      className="flex items-center gap-2 text-[13px] font-semibold text-zinc-700"
                    >
                      <span className={cn('relative h-5 w-9 rounded-full transition-colors', menu.is_active ? 'bg-emerald-500' : 'bg-zinc-300')}>
                        <span className={cn('absolute top-0.5 size-4 rounded-full bg-white shadow-sm transition-[left]', menu.is_active ? 'left-[18px]' : 'left-0.5')} />
                      </span>
                      Visible
                    </button>
                    {!hasOpenStaging && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => createStaging(menu)}
                        className="flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold text-zinc-600 transition-colors hover:bg-amber-50 hover:text-amber-900 disabled:opacity-50"
                        title="Copy this menu to a private staging version to change, show the restaurant and publish"
                      >
                        <FlaskConical className="size-3.5" />
                        {busy ? 'Copying…' : 'Create staging'}
                      </button>
                    )}
                    {!menu.is_default && (
                      <div className="ml-auto flex items-center gap-1">
                        <button
                          onClick={() => handleToggle(menu, 'is_default')}
                          className="h-9 rounded-lg px-3 text-[13px] font-semibold text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-950"
                        >
                          Set as default
                        </button>
                        <button
                          onClick={() => setConfirmId(menu.id)}
                          className="flex size-9 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600"
                          title="Delete menu"
                          aria-label="Delete menu"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
