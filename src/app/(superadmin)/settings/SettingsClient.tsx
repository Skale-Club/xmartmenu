'use client'

import { useState } from 'react'

const DEFAULT_LANDING = {
  hero: { badge: 'Digital menu for restaurants', heading: 'Your menu on your phone', heading_highlight: 'with a QR Code', subheading: 'Create your digital menu in minutes, generate a QR Code and let your customers order via WhatsApp. No app, no hassle.', cta_primary: 'Get started free', cta_secondary: 'See how it works' },
  how_it_works: { title: 'How it works', subtitle: 'Up and running in 3 simple steps', steps: [{ step: '01', icon: '📋', title: 'Build your menu', desc: 'Create categories and add your products with photos, descriptions and prices in the dashboard.' }, { step: '02', icon: '🎨', title: 'Customize the look', desc: 'Add your logo, restaurant colors and contact information to make it your own.' }, { step: '03', icon: '📱', title: 'Generate & print the QR Code', desc: 'Generate your unique QR Code with one click. Place it on tables and let customers access it instantly.' }] },
  features: { title: 'Everything you need', subtitle: 'Features designed for restaurants', items: [{ icon: '🔗', title: 'Unique link per restaurant', desc: 'Each customer has their own digital menu address.' }, { icon: '📲', title: 'Order via WhatsApp', desc: 'Customers tap a product and WhatsApp opens ready to order.' }, { icon: '🎨', title: 'Custom branding', desc: 'Logo, colors and visual identity for your restaurant.' }, { icon: '📊', title: 'Scan counter', desc: 'See how many times your QR Code has been scanned.' }, { icon: '🔍', title: 'Menu search', desc: 'Customers find any product in seconds.' }, { icon: '⚡', title: 'No app required', desc: 'Everything opens directly in the phone browser, zero friction.' }] },
  pricing: { title: 'Simple plans', subtitle: 'Start free, scale when you need', plans: [{ name: 'Free', price: '$0', period: '/mo', desc: 'To get started', features: ['Digital menu', 'QR Code generated', 'Up to 20 products', 'Basic branding'], cta: 'Get started free', highlight: false }, { name: 'Pro', price: '$49', period: '/mo', desc: 'To grow', features: ['Everything in Free', 'Unlimited products', 'Full branding', 'Scan analytics', 'Priority support'], cta: 'Subscribe to Pro', highlight: true }, { name: 'Enterprise', price: '$149', period: '/mo', desc: 'For chains', features: ['Everything in Pro', 'Multiple locations', 'Custom domain', 'Dedicated onboarding', 'Guaranteed SLA'], cta: 'Talk to sales', highlight: false }] },
  cta: { heading: 'Ready to digitize\nyour menu?', text: 'Create your account now and have your QR Code in less than 5 minutes.', button: 'Create free account' },
  footer: { copyright: 'XmartMenu. All rights reserved.' },
}

interface Props { settings: any }

export default function SettingsClient({ settings }: Props) {
  const s = settings ?? {}
  const l = { ...DEFAULT_LANDING, ...(s.landing ?? {}) }

  const [platform, setPlatform] = useState({
    app_name: s.app_name ?? 'XmartMenu',
    brand_name: s.brand_name ?? 'XmartMenu',
    default_primary_color: s.default_primary_color ?? '#000000',
    default_accent_color: s.default_accent_color ?? '#FF5722',
    menu_footer_brand: s.menu_footer_brand ?? 'XmartMenu',
  })

  const [hero, setHero] = useState({ ...DEFAULT_LANDING.hero, ...(l.hero ?? {}) })
  const [howItWorks, setHowItWorks] = useState({ ...DEFAULT_LANDING.how_it_works, ...(l.how_it_works ?? {}) })
  const [features, setFeatures] = useState({ ...DEFAULT_LANDING.features, ...(l.features ?? {}) })
  const [pricing, setPricing] = useState({ ...DEFAULT_LANDING.pricing, ...(l.pricing ?? {}) })
  const [cta, setCta] = useState({ ...DEFAULT_LANDING.cta, ...(l.cta ?? {}) })
  const [footer, setFooter] = useState({ ...DEFAULT_LANDING.footer, ...(l.footer ?? {}) })

  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const res = await fetch('/api/superadmin/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...platform,
        landing: { hero, how_it_works: howItWorks, features, pricing, cta, footer },
      }),
    })

    if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
    else { const d = await res.json(); setError(d.error ?? 'Erro ao salvar') }
    setLoading(false)
  }

  function updateStep(i: number, key: string, val: string) {
    const steps = [...howItWorks.steps]
    steps[i] = { ...steps[i], [key]: val }
    setHowItWorks({ ...howItWorks, steps })
  }

  function updateFeature(i: number, key: string, val: string) {
    const items = [...features.items]
    items[i] = { ...items[i], [key]: val }
    setFeatures({ ...features, items })
  }

  function updatePlan(i: number, key: string, val: any) {
    const plans = [...pricing.plans]
    plans[i] = { ...plans[i], [key]: val }
    setPricing({ ...pricing, plans })
  }

  const input = 'w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900'
  const textarea = input + ' resize-none'
  const label = 'block text-xs font-medium text-zinc-600 mb-1'
  const section = 'bg-white border border-zinc-200 rounded-xl p-5 space-y-4'
  const sectionTitle = 'text-sm font-semibold text-zinc-900 pb-2 border-b border-zinc-100'

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-900">Platform settings</h1>
        <p className="text-sm text-zinc-500 mt-1">Manage text, colors and landing page content</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-6 text-sm text-red-700 flex items-center justify-between">
          {error}<button onClick={() => setError(null)} className="ml-4 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">

        {/* Plataforma */}
        <div className={section}>
          <h2 className={sectionTitle}>Platform</h2>
          <div className="grid grid-cols-2 gap-4">
            <div><label className={label}>App name</label><input className={input} value={platform.app_name} onChange={e => setPlatform({ ...platform, app_name: e.target.value })} /></div>
            <div><label className={label}>Brand name</label><input className={input} value={platform.brand_name} onChange={e => setPlatform({ ...platform, brand_name: e.target.value })} /></div>
            <div><label className={label}>Public menu footer</label><input className={input} value={platform.menu_footer_brand} onChange={e => setPlatform({ ...platform, menu_footer_brand: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label}>Default primary color (new tenants)</label>
              <div className="flex items-center gap-3">
                <input type="color" value={platform.default_primary_color} onChange={e => setPlatform({ ...platform, default_primary_color: e.target.value })} className="w-10 h-10 rounded-lg border border-zinc-300 cursor-pointer p-0.5" />
                <input className={input} value={platform.default_primary_color} onChange={e => setPlatform({ ...platform, default_primary_color: e.target.value })} />
              </div>
            </div>
            <div>
              <label className={label}>Default accent color (new tenants)</label>
              <div className="flex items-center gap-3">
                <input type="color" value={platform.default_accent_color} onChange={e => setPlatform({ ...platform, default_accent_color: e.target.value })} className="w-10 h-10 rounded-lg border border-zinc-300 cursor-pointer p-0.5" />
                <input className={input} value={platform.default_accent_color} onChange={e => setPlatform({ ...platform, default_accent_color: e.target.value })} />
              </div>
            </div>
          </div>
        </div>

        {/* Hero */}
        <div className={section}>
          <h2 className={sectionTitle}>Landing Page — Hero</h2>
          <div className="grid grid-cols-2 gap-4">
            <div><label className={label}>Badge (top)</label><input className={input} value={hero.badge} onChange={e => setHero({ ...hero, badge: e.target.value })} /></div>
            <div><label className={label}>Gradient highlight</label><input className={input} value={hero.heading_highlight} onChange={e => setHero({ ...hero, heading_highlight: e.target.value })} /></div>
          </div>
          <div><label className={label}>Main heading</label><input className={input} value={hero.heading} onChange={e => setHero({ ...hero, heading: e.target.value })} /></div>
          <div><label className={label}>Subheading</label><textarea rows={2} className={textarea} value={hero.subheading} onChange={e => setHero({ ...hero, subheading: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className={label}>Primary button</label><input className={input} value={hero.cta_primary} onChange={e => setHero({ ...hero, cta_primary: e.target.value })} /></div>
            <div><label className={label}>Secondary button</label><input className={input} value={hero.cta_secondary} onChange={e => setHero({ ...hero, cta_secondary: e.target.value })} /></div>
          </div>
        </div>

        {/* Como funciona */}
        <div className={section}>
          <h2 className={sectionTitle}>Landing Page — How it works</h2>
          <div className="grid grid-cols-2 gap-4">
            <div><label className={label}>Section title</label><input className={input} value={howItWorks.title} onChange={e => setHowItWorks({ ...howItWorks, title: e.target.value })} /></div>
            <div><label className={label}>Subtitle</label><input className={input} value={howItWorks.subtitle} onChange={e => setHowItWorks({ ...howItWorks, subtitle: e.target.value })} /></div>
          </div>
          {howItWorks.steps.map((step: any, i: number) => (
            <div key={i} className="bg-zinc-50 rounded-lg p-4 space-y-2">
              <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Step {step.step}</p>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>Icon (emoji)</label><input className={input} value={step.icon} onChange={e => updateStep(i, 'icon', e.target.value)} /></div>
                <div><label className={label}>Title</label><input className={input} value={step.title} onChange={e => updateStep(i, 'title', e.target.value)} /></div>
              </div>
              <div><label className={label}>Description</label><textarea rows={2} className={textarea} value={step.desc} onChange={e => updateStep(i, 'desc', e.target.value)} /></div>
            </div>
          ))}
        </div>

        {/* Funcionalidades */}
        <div className={section}>
          <h2 className={sectionTitle}>Landing Page — Features</h2>
          <div className="grid grid-cols-2 gap-4">
            <div><label className={label}>Section title</label><input className={input} value={features.title} onChange={e => setFeatures({ ...features, title: e.target.value })} /></div>
            <div><label className={label}>Subtitle</label><input className={input} value={features.subtitle} onChange={e => setFeatures({ ...features, subtitle: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {features.items.map((item: any, i: number) => (
              <div key={i} className="bg-zinc-50 rounded-lg p-3 space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <div><label className={label}>Icon</label><input className={input} value={item.icon} onChange={e => updateFeature(i, 'icon', e.target.value)} /></div>
                  <div className="col-span-2"><label className={label}>Title</label><input className={input} value={item.title} onChange={e => updateFeature(i, 'title', e.target.value)} /></div>
                </div>
                <div><label className={label}>Description</label><input className={input} value={item.desc} onChange={e => updateFeature(i, 'desc', e.target.value)} /></div>
              </div>
            ))}
          </div>
        </div>

        {/* Planos */}
        <div className={section}>
          <h2 className={sectionTitle}>Landing Page — Pricing</h2>
          <div className="grid grid-cols-2 gap-4">
            <div><label className={label}>Section title</label><input className={input} value={pricing.title} onChange={e => setPricing({ ...pricing, title: e.target.value })} /></div>
            <div><label className={label}>Subtitle</label><input className={input} value={pricing.subtitle} onChange={e => setPricing({ ...pricing, subtitle: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {pricing.plans.map((plan: any, i: number) => (
              <div key={i} className="bg-zinc-50 rounded-lg p-4 space-y-2">
                <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">{plan.name}</p>
                <div><label className={label}>Name</label><input className={input} value={plan.name} onChange={e => updatePlan(i, 'name', e.target.value)} /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className={label}>Price</label><input className={input} value={plan.price} onChange={e => updatePlan(i, 'price', e.target.value)} /></div>
                  <div><label className={label}>Period</label><input className={input} value={plan.period} onChange={e => updatePlan(i, 'period', e.target.value)} /></div>
                </div>
                <div><label className={label}>Description</label><input className={input} value={plan.desc} onChange={e => updatePlan(i, 'desc', e.target.value)} /></div>
                <div><label className={label}>Button text</label><input className={input} value={plan.cta} onChange={e => updatePlan(i, 'cta', e.target.value)} /></div>
                <div>
                  <label className={label}>Features (one per line)</label>
                  <textarea rows={5} className={textarea} value={plan.features.join('\n')} onChange={e => updatePlan(i, 'features', e.target.value.split('\n').filter(Boolean))} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CTA Final */}
        <div className={section}>
          <h2 className={sectionTitle}>Landing Page — Final CTA</h2>
          <div><label className={label}>Heading</label><input className={input} value={cta.heading} onChange={e => setCta({ ...cta, heading: e.target.value })} /></div>
          <div><label className={label}>Text</label><input className={input} value={cta.text} onChange={e => setCta({ ...cta, text: e.target.value })} /></div>
          <div><label className={label}>Button</label><input className={input} value={cta.button} onChange={e => setCta({ ...cta, button: e.target.value })} /></div>
        </div>

        {/* Rodapé */}
        <div className={section}>
          <h2 className={sectionTitle}>Landing Page — Footer</h2>
          <div><label className={label}>Copyright text (use {'{year}'} for the year)</label><input className={input} value={footer.copyright} onChange={e => setFooter({ ...footer, copyright: e.target.value })} /></div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-zinc-100 -mx-8 px-8 py-4 flex items-center gap-4">
          <button type="submit" disabled={loading}
            className="bg-zinc-900 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-zinc-800 disabled:opacity-50 transition-colors">
            {loading ? 'Saving...' : saved ? '✓ Saved!' : 'Save settings'}
          </button>
          {saved && <p className="text-sm text-green-600">Changes saved successfully.</p>}
        </div>
      </form>
    </div>
  )
}
