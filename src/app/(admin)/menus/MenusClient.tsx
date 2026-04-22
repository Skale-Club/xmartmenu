'use client'
import { type Dispatch, type ReactNode, type SetStateAction, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ConfirmDialog from '@/components/ui/ConfirmDialog'

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
  position: number
}

interface MenuDraft {
  name: string
  language: string
  supported_languages: string[]
  translations: Record<string, { name: string; description: string }>
  purpose: string
  description: string
}

const EMPTY_DRAFT: MenuDraft = {
  name: '',
  language: 'en',
  supported_languages: ['en'],
  translations: {},
  purpose: 'restaurant',
  description: '',
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-white rounded-xl border border-zinc-200 shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200">
          <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-800">✕</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

function MenuFormFields({
  draft,
  setDraft,
  inputClassName,
}: {
  draft: MenuDraft
  setDraft: Dispatch<SetStateAction<MenuDraft>>
  inputClassName: string
}) {
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
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-zinc-600 mb-1">Name *</label>
          <input required className={inputClassName} value={draft.name} onChange={e => setDraft(f => ({ ...f, name: e.target.value }))} placeholder="Dinner Menu" />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-600 mb-1">Purpose</label>
          <select className={inputClassName} value={draft.purpose} onChange={e => setDraft(f => ({ ...f, purpose: e.target.value }))}>
            {PURPOSES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-600 mb-1">Default language</label>
          <select className={inputClassName} value={draft.language} onChange={e => setBaseLanguage(e.target.value)}>
            {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-600 mb-1">Description</label>
          <input className={inputClassName} value={draft.description} onChange={e => setDraft(f => ({ ...f, description: e.target.value }))} placeholder="Optional" />
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-zinc-600 mb-2">Supported languages</p>
        <div className="flex flex-wrap gap-2">
          {LANGUAGES.map(lang => {
            const checked = supported.includes(lang.value)
            const isBase = draft.language === lang.value
            return (
              <label key={lang.value} className={`text-xs px-3 py-1.5 rounded-full border cursor-pointer ${checked ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-600 border-zinc-200'}`}>
                <input type="checkbox" className="hidden" checked={checked} onChange={() => toggleLanguage(lang.value)} disabled={isBase} />
                {lang.label}{isBase ? ' (default)' : ''}
              </label>
            )
          })}
        </div>
      </div>

      {supported.filter(lang => lang !== draft.language).map(lang => (
        <div key={lang} className="grid grid-cols-2 gap-4 p-3 bg-zinc-50 rounded-lg border border-zinc-200">
          <div className="col-span-2 text-xs font-semibold text-zinc-700">{LANGUAGES.find(x => x.value === lang)?.label ?? lang} translation</div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">Translated name</label>
            <input
              className={inputClassName}
              value={draft.translations[lang]?.name ?? ''}
              onChange={e => setDraft(f => ({ ...f, translations: { ...f.translations, [lang]: { ...(f.translations[lang] ?? { name: '', description: '' }), name: e.target.value } } }))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">Translated description</label>
            <input
              className={inputClassName}
              value={draft.translations[lang]?.description ?? ''}
              onChange={e => setDraft(f => ({ ...f, translations: { ...f.translations, [lang]: { ...(f.translations[lang] ?? { name: '', description: '' }), description: e.target.value } } }))}
            />
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

  const input = 'w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900'

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
    <div className="p-8 max-w-4xl">
      <ConfirmDialog open={!!confirmId} title="Delete menu" message="Delete this menu? All categories and products in it will also be deleted." onConfirm={handleDelete} onCancel={() => setConfirmId(null)} />

      <Modal open={createOpen} title="New menu" onClose={() => setCreateOpen(false)}>
        <form onSubmit={handleCreate} className="space-y-4">
          <MenuFormFields draft={createForm} setDraft={setCreateForm} inputClassName={input} />
          <div className="flex gap-3">
            <button type="submit" disabled={loading} className="bg-zinc-900 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-zinc-800 disabled:opacity-50">{loading ? 'Creating...' : 'Create menu'}</button>
            <button type="button" onClick={() => setCreateOpen(false)} className="px-5 py-2 rounded-lg text-sm font-medium text-zinc-600 hover:bg-zinc-100">Cancel</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!editingId} title="Edit menu" onClose={cancelEdit}>
        <form onSubmit={saveEdit} className="space-y-4">
          <MenuFormFields draft={editForm} setDraft={setEditForm} inputClassName={input} />
          <div className="flex gap-3">
            <button type="submit" disabled={loading} className="bg-zinc-900 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-zinc-800 disabled:opacity-50">{loading ? 'Saving...' : 'Save changes'}</button>
            <button type="button" onClick={cancelEdit} className="px-5 py-2 rounded-lg text-sm font-medium text-zinc-600 hover:bg-zinc-100">Cancel</button>
          </div>
        </form>
      </Modal>

      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-2xl font-bold text-zinc-900">Menus</h1><p className="text-sm text-zinc-500 mt-1">{menus.length} menu(s)</p></div>
        <button onClick={() => setCreateOpen(true)} className="bg-zinc-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-zinc-800 transition-colors">+ New menu</button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 text-sm text-red-700 flex justify-between">{error}<button onClick={() => setError(null)}>✕</button></div>}

      <div className="space-y-3">
        {menus.map(menu => (
          <div key={menu.id} className="bg-white border border-zinc-200 rounded-xl p-5 flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-semibold text-zinc-900">{menu.name}</p>
                {menu.is_default && <span className="text-xs bg-zinc-900 text-white px-2 py-0.5 rounded-full">Default</span>}
                {selectedMenuId === menu.id && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Editing</span>}
                {!menu.is_active && <span className="text-xs bg-zinc-100 text-zinc-500 px-2 py-0.5 rounded-full">Inactive</span>}
              </div>
              <p className="text-xs text-zinc-400 mt-1">/{menu.slug} · {menu.language.toUpperCase()} · {menu.purpose}</p>
              <p className="text-xs text-zinc-500 mt-1">Languages: {(menu.supported_languages?.length ? menu.supported_languages : [menu.language]).map(x => x.toUpperCase()).join(', ')}</p>
              {menu.description && <p className="text-xs text-zinc-500 mt-0.5">{menu.description}</p>}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={async () => {
                  await selectMenu(menu.id)
                  router.push('/menu/categories')
                }}
                className="text-xs px-3 py-1.5 border border-blue-200 text-blue-700 rounded-lg hover:bg-blue-50"
              >
                Manage items
              </button>
              <Link
                href={`/${tenantSlug}${menu.is_default ? '' : `/${menu.slug}`}`}
                target="_blank"
                className="text-xs px-3 py-1.5 border border-zinc-200 text-zinc-600 rounded-lg hover:bg-zinc-50"
              >
                View menu
              </Link>
              <button onClick={() => startEdit(menu)} className="text-xs px-3 py-1.5 border border-zinc-200 text-zinc-600 rounded-lg hover:bg-zinc-50">Edit</button>
              {!menu.is_default && (
                <button onClick={() => handleToggle(menu, 'is_default')} className="text-xs px-3 py-1.5 border border-zinc-200 text-zinc-600 rounded-lg hover:bg-zinc-50">Set default</button>
              )}
              <button onClick={() => handleToggle(menu, 'is_active')} className="text-xs px-3 py-1.5 border border-zinc-200 text-zinc-600 rounded-lg hover:bg-zinc-50">{menu.is_active ? 'Deactivate' : 'Activate'}</button>
              {!menu.is_default && (
                <button onClick={() => setConfirmId(menu.id)} className="text-xs px-3 py-1.5 border border-red-200 text-red-600 rounded-lg hover:bg-red-50">Delete</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
