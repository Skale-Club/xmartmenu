'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { normalizeRole } from '@/lib/auth/role-utils'

type Step = 1 | 2 | 3 | 4 | 5

const BUSINESS_TYPES = [
  { value: 'restaurant', label: 'Restaurant' },
  { value: 'bar', label: 'Bar' },
  { value: 'cafe', label: 'Cafe' },
  { value: 'restaurant', label: 'Pizzeria' },
  { value: 'restaurant', label: 'Snack Bar' },
  { value: 'cafe', label: 'Bakery' },
  { value: 'cafe', label: 'Ice Cream Shop' },
  { value: 'other', label: 'Other' },
]

const TOTAL_STEPS = 4

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>(1)
  const [loading, setLoading] = useState(false)
  const [checkingAccess, setCheckingAccess] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [menuUrl, setMenuUrl] = useState<string | null>(null)

  const [companyName, setCompanyName] = useState('')
  const [businessType, setBusinessType] = useState('restaurant')
  const [responsibleName, setResponsibleName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [menuName, setMenuName] = useState('')
  const [categoryName, setCategoryName] = useState('')
  const [productName, setProductName] = useState('')
  const [productPrice, setProductPrice] = useState('')

  useEffect(() => {
    let active = true

    async function checkAccess() {
      const supabase = createClient()
      const { data: authData } = await supabase.auth.getUser()
      const user = authData.user
      if (!user) {
        router.replace('/auth/login')
        return
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id, role')
        .eq('id', user.id)
        .single()

      if (normalizeRole(profile?.role) === 'superadmin') {
        router.replace('/overview')
        return
      }

      if (profile?.tenant_id) {
        const { data: existingMenu } = await supabase
          .from('menus')
          .select('id')
          .eq('tenant_id', profile.tenant_id)
          .limit(1)
          .maybeSingle()

        if (existingMenu) {
          router.replace('/dashboard')
          return
        }
      }

      if (active) setCheckingAccess(false)
    }

    void checkAccess()
    return () => { active = false }
  }, [router])

  async function handleSubmit() {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: companyName,
          business_type: businessType,
          responsible_name: responsibleName,
          phone: phone.trim() || null,
          address,
          menu_name: menuName,
          category_name: categoryName,
          product_name: productName,
          product_price: parseFloat(productPrice) || 0,
        }),
      })

      const contentType = res.headers.get('content-type') ?? ''
      const data = contentType.includes('application/json')
        ? await res.json()
        : { error: 'Server returned an unexpected response format.' }

      if (!res.ok) {
        const details = typeof data.details === 'string' && data.details.trim() ? ` (${data.details})` : ''
        setError(`${data.error ?? 'Failed to create your store'}${details}`)
        setLoading(false)
        return
      }

      if (data.already_configured) {
        router.replace('/dashboard')
        return
      }

      setMenuUrl(`/${data.tenant_slug}/${data.menu_slug}`)
      setStep(5)
      setLoading(false)
    } catch (submitError) {
      console.error('onboarding.submit_error', submitError)
      setError('Unable to complete onboarding right now. Please try again.')
      setLoading(false)
    }
  }

  const inputClass =
    'w-full px-4 py-3 border border-zinc-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 placeholder:text-zinc-400'
  const primaryBtn =
    'flex-1 bg-zinc-900 text-white py-3 rounded-xl text-sm font-semibold hover:bg-zinc-800 disabled:opacity-50 transition-colors'
  const secondaryBtn =
    'px-5 py-3 rounded-xl text-sm font-semibold text-zinc-700 border border-zinc-200 hover:bg-zinc-50 transition-colors'

  if (checkingAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 px-4">
        <p className="text-sm text-zinc-500">Loading...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-lg">
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-8">
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-bold text-zinc-900">XmartMenu</span>
              {step <= TOTAL_STEPS && (
                <span className="text-xs text-zinc-400">Step {step} of {TOTAL_STEPS}</span>
              )}
            </div>
            {step <= TOTAL_STEPS && (
              <div className="w-full h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-zinc-900 rounded-full transition-all duration-300"
                  style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
                />
              </div>
            )}
          </div>

          {step === 1 && (
            <div>
              <h1 className="text-xl font-bold text-zinc-900 mb-1">Welcome</h1>
              <p className="text-sm text-zinc-500 mb-6">
                Let&apos;s set up your digital menu. First, tell us about your business.
              </p>
              <div className="space-y-5">
                <div>
                  <label htmlFor="company-name" className="block text-sm font-medium text-zinc-700 mb-1.5">
                    Company name *
                  </label>
                  <input
                    id="company-name"
                    name="companyName"
                    autoFocus
                    value={companyName}
                    onChange={e => setCompanyName(e.target.value)}
                    placeholder="e.g. Joe's Pizza"
                    className={inputClass}
                    onKeyDown={e => e.key === 'Enter' && companyName.trim() && setStep(2)}
                  />
                </div>
                <fieldset>
                  <legend className="block text-sm font-medium text-zinc-700 mb-1.5">
                    Business type *
                  </legend>
                  <div className="grid grid-cols-2 gap-2">
                    {BUSINESS_TYPES.map(type => (
                      <button
                        key={`${type.value}-${type.label}`}
                        type="button"
                        onClick={() => setBusinessType(type.value)}
                        className={`px-4 py-2.5 rounded-xl text-sm font-medium border transition-colors text-left ${
                          businessType === type.value
                            ? 'bg-zinc-900 text-white border-zinc-900'
                            : 'bg-white text-zinc-700 border-zinc-200 hover:border-zinc-400'
                        }`}
                      >
                        {type.label}
                      </button>
                    ))}
                  </div>
                </fieldset>
              </div>
              <button
                onClick={() => setStep(2)}
                disabled={!companyName.trim()}
                className={`mt-6 w-full ${primaryBtn}`}
              >
                Continue
              </button>
            </div>
          )}

          {step === 2 && (
            <div>
              <h1 className="text-xl font-bold text-zinc-900 mb-1">Contact info</h1>
              <p className="text-sm text-zinc-500 mb-6">
                This information may appear on your public menu.
              </p>
              <div className="space-y-4">
                <div>
                  <label htmlFor="owner-name" className="block text-sm font-medium text-zinc-700 mb-1.5">
                    Owner name *
                  </label>
                  <input
                    id="owner-name"
                    name="responsibleName"
                    autoFocus
                    value={responsibleName}
                    onChange={e => setResponsibleName(e.target.value)}
                    placeholder="Your full name"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="owner-phone" className="block text-sm font-medium text-zinc-700 mb-1.5">
                    Phone
                  </label>
                  <input
                    id="owner-phone"
                    name="phone"
                    type="tel"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="+1 555-123-4567"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="store-address" className="block text-sm font-medium text-zinc-700 mb-1.5">
                    Address
                  </label>
                  <input
                    id="store-address"
                    name="address"
                    value={address}
                    onChange={e => setAddress(e.target.value)}
                    placeholder="Street, city, state"
                    className={inputClass}
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button onClick={() => setStep(1)} className={secondaryBtn}>
                  Back
                </button>
                <button
                  onClick={() => setStep(3)}
                  disabled={!responsibleName.trim()}
                  className={primaryBtn}
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <h1 className="text-xl font-bold text-zinc-900 mb-1">Your digital menu</h1>
              <p className="text-sm text-zinc-500 mb-6">
                Give your first menu a name. You can create more menus later.
              </p>
              <div>
                <label htmlFor="menu-name" className="block text-sm font-medium text-zinc-700 mb-1.5">
                  Menu name *
                </label>
                <input
                  id="menu-name"
                  name="menuName"
                  autoFocus
                  value={menuName}
                  onChange={e => setMenuName(e.target.value)}
                  placeholder="e.g. Main Menu"
                  className={inputClass}
                  onKeyDown={e => e.key === 'Enter' && menuName.trim() && setStep(4)}
                />
                <p className="text-xs text-zinc-400 mt-2">
                  Suggestions: &quot;Main Menu&quot;, &quot;Happy Hour&quot;, &quot;Delivery&quot;
                </p>
              </div>
              <div className="flex gap-3 mt-6">
                <button onClick={() => setStep(2)} className={secondaryBtn}>
                  Back
                </button>
                <button
                  onClick={() => setStep(4)}
                  disabled={!menuName.trim()}
                  className={primaryBtn}
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div>
              <h1 className="text-xl font-bold text-zinc-900 mb-1">Your first product</h1>
              <p className="text-sm text-zinc-500 mb-6">
                Add one category and one product to get started.
              </p>
              <div className="space-y-4">
                <div>
                  <label htmlFor="category-name" className="block text-sm font-medium text-zinc-700 mb-1.5">
                    Category name *
                  </label>
                  <input
                    id="category-name"
                    name="categoryName"
                    autoFocus
                    value={categoryName}
                    onChange={e => setCategoryName(e.target.value)}
                    placeholder="e.g. Pizzas, Drinks, Starters"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="product-name" className="block text-sm font-medium text-zinc-700 mb-1.5">
                    Product name *
                  </label>
                  <input
                    id="product-name"
                    name="productName"
                    value={productName}
                    onChange={e => setProductName(e.target.value)}
                    placeholder="e.g. Margherita Pizza"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="product-price" className="block text-sm font-medium text-zinc-700 mb-1.5">
                    Price
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-zinc-500 select-none">
                      $
                    </span>
                    <input
                      id="product-price"
                      name="productPrice"
                      type="number"
                      min="0"
                      step="0.01"
                      value={productPrice}
                      onChange={e => setProductPrice(e.target.value)}
                      placeholder="0.00"
                      className="w-full pl-10 pr-4 py-3 border border-zinc-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 placeholder:text-zinc-400"
                    />
                  </div>
                </div>
              </div>
              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-4">
                  {error}
                </p>
              )}
              <div className="flex gap-3 mt-6">
                <button onClick={() => setStep(3)} className={secondaryBtn}>
                  Back
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={loading || !categoryName.trim() || !productName.trim()}
                  className={primaryBtn}
                >
                  {loading ? 'Creating your menu...' : 'Finish'}
                </button>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-5">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h1 className="text-xl font-bold text-zinc-900 mb-2">Menu created!</h1>
              <p className="text-sm text-zinc-500 mb-6">
                Your digital menu is ready. Preview it now or add more products.
              </p>
              {menuUrl && (
                <a
                  href={menuUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-2 w-full mb-4 px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-xs text-zinc-600 font-mono hover:bg-zinc-100 transition-colors break-all"
                >
                  <svg className="w-4 h-4 shrink-0 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  {typeof window !== 'undefined' ? window.location.origin : ''}{menuUrl}
                </a>
              )}
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => router.push('/menu/products')}
                  className="w-full bg-zinc-900 text-white py-3 rounded-xl text-sm font-semibold hover:bg-zinc-800 transition-colors"
                >
                  Add more products
                </button>
                <button
                  onClick={() => router.push('/dashboard')}
                  className="w-full bg-white text-zinc-700 py-3 rounded-xl text-sm font-semibold border border-zinc-200 hover:bg-zinc-50 transition-colors"
                >
                  Go to dashboard
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
