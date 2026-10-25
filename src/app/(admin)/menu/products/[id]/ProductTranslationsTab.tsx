'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import TranslationEditor, { type TranslationField, type TranslationValues } from '@/components/admin/TranslationEditor'
import { addEditorValues as addValues, pickEditorTranslations as pickTranslations, type TextTranslations } from '@/lib/menu-translations'
import { menuLanguage } from '@/components/menu/menu-i18n'
import type { Product } from '@/types/database'
import type { GroupWithOptions } from './page'

const groupKey = (id: string) => `group:${id}`
const optionKey = (id: string) => `option:${id}`

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {})

export default function ProductTranslationsTab({
  product,
  groups,
  baseLanguage,
  supportedLanguages,
  canManage,
  onSaved,
}: {
  product: Product
  groups: GroupWithOptions[]
  baseLanguage: string
  supportedLanguages: string[]
  canManage: boolean
  onSaved: (update: { product: TextTranslations; groups: Record<string, TextTranslations>; options: Record<string, TextTranslations> }) => void
}) {
  const languages = supportedLanguages.filter(lang => lang !== baseLanguage)

  const fields = useMemo<TranslationField[]>(() => [
    { key: 'name', label: 'Dish name', base: product.name },
    { key: 'description', label: 'Description', base: product.description ?? '', multiline: true },
    ...groups.flatMap(group => [
      { key: groupKey(group.id), label: `Option group · ${group.name}`, base: group.name },
      ...group.options.map(option => ({ key: optionKey(option.id), label: `${group.name} · option`, base: option.name })),
    ]),
  ], [product.name, product.description, groups])

  const initialValues = useMemo(() => {
    const values: TranslationValues = {}
    addValues(values, product.translations, { name: 'name', description: 'description' })
    for (const group of groups) {
      addValues(values, group.translations, { name: groupKey(group.id) })
      for (const option of group.options) addValues(values, option.translations, { name: optionKey(option.id) })
    }
    return values
  }, [product.translations, groups])

  const [values, setValues] = useState<TranslationValues>(initialValues)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)
  const supabase = createClient()

  if (!languages.length) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-600 shadow-sm">
        <p className="font-medium text-zinc-900">This menu is only in {menuLanguage(baseLanguage).nativeName}.</p>
        <p className="mt-1">
          Add more languages to the menu to translate dish names, descriptions and options.{' '}
          <Link href="/menus" className="font-medium text-zinc-900 underline underline-offset-2">Manage menu languages</Link>
        </p>
      </div>
    )
  }

  async function handleSave() {
    setSaving(true)
    setStatus(null)
    try {
      const productTranslations = pickTranslations(values, { name: 'name', description: 'description' })
      const writes: PromiseLike<{ error: { message: string } | null }>[] = []
      if (!same(productTranslations, product.translations)) {
        writes.push(supabase.from('products').update({ translations: productTranslations }).eq('id', product.id))
      }
      const groupUpdates: Record<string, TextTranslations> = {}
      const optionUpdates: Record<string, TextTranslations> = {}
      for (const group of groups) {
        const next = pickTranslations(values, { name: groupKey(group.id) })
        groupUpdates[group.id] = next
        if (!same(next, group.translations)) {
          writes.push(supabase.from('product_option_groups').update({ translations: next }).eq('id', group.id))
        }
        for (const option of group.options) {
          const nextOption = pickTranslations(values, { name: optionKey(option.id) })
          optionUpdates[option.id] = nextOption
          if (!same(nextOption, option.translations)) {
            writes.push(supabase.from('product_options').update({ translations: nextOption }).eq('id', option.id))
          }
        }
      }
      const results = await Promise.all(writes)
      const failed = results.find(r => r.error)
      if (failed?.error) throw new Error(failed.error.message)
      onSaved({ product: productTranslations, groups: groupUpdates, options: optionUpdates })
      setStatus({ kind: 'ok', text: writes.length ? 'Translations saved.' : 'Nothing changed.' })
    } catch (error) {
      setStatus({ kind: 'error', text: error instanceof Error ? error.message : 'Could not save the translations' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="mb-5">
        <h2 className="text-base font-semibold text-zinc-900">Translations</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Guests reading the menu in another language see these texts. Anything left empty shows in {menuLanguage(baseLanguage).nativeName}. Orders always reach the kitchen in {menuLanguage(baseLanguage).nativeName}.
        </p>
      </div>

      <TranslationEditor
        baseLanguage={baseLanguage}
        languages={languages}
        fields={fields}
        values={values}
        onChange={setValues}
        disabled={!canManage || saving}
      />

      {canManage && (
        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save translations'}
          </button>
          {status && (
            <p role={status.kind === 'error' ? 'alert' : 'status'} className={`text-sm ${status.kind === 'error' ? 'text-red-600' : 'text-emerald-700'}`}>
              {status.text}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
