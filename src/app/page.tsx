export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/server'

const D = {
  app_name: 'XmartMenu',
  brand_name: 'XmartMenu',
  menu_footer_brand: 'XmartMenu',
  hero: { badge: 'Digital menu for restaurants', heading: 'Your menu on your phone', heading_highlight: 'with a QR Code', subheading: 'Create your digital menu in minutes, generate a QR Code and let your customers order via WhatsApp. No app, no hassle.', cta_primary: 'Get started free', cta_secondary: 'See how it works' },
  how_it_works: { title: 'How it works', subtitle: 'Up and running in 3 simple steps', steps: [{ step: '01', icon: '📋', title: 'Build your menu', desc: 'Create categories and add your products with photos, descriptions and prices in the dashboard.' }, { step: '02', icon: '🎨', title: 'Customize the look', desc: 'Add your logo, restaurant colors and contact information to make it your own.' }, { step: '03', icon: '📱', title: 'Generate & print the QR Code', desc: 'Generate your unique QR Code with one click. Place it on tables and let customers access it instantly.' }] },
  features: { title: 'Everything you need', subtitle: 'Features designed for restaurants', items: [{ icon: '🔗', title: 'Unique link per restaurant', desc: 'Each customer has their own digital menu address.' }, { icon: '📲', title: 'Order via WhatsApp', desc: 'Customers tap a product and WhatsApp opens ready to order.' }, { icon: '🎨', title: 'Custom branding', desc: 'Logo, colors and visual identity for your restaurant.' }, { icon: '📊', title: 'Scan counter', desc: 'See how many times your QR Code has been scanned.' }, { icon: '🔍', title: 'Menu search', desc: 'Customers find any product in seconds.' }, { icon: '⚡', title: 'No app required', desc: 'Everything opens directly in the phone browser, zero friction.' }] },
  pricing: { title: 'Simple plans', subtitle: 'Start free, scale when you need', plans: [{ name: 'Free', price: '$0', period: '/mo', desc: 'To get started', features: ['Digital menu', 'QR Code generated', 'Up to 20 products', 'Basic branding'], cta: 'Get started free', highlight: false }, { name: 'Pro', price: '$49', period: '/mo', desc: 'To grow', features: ['Everything in Free', 'Unlimited products', 'Full branding', 'Scan analytics', 'Priority support'], cta: 'Subscribe to Pro', highlight: true }, { name: 'Enterprise', price: '$149', period: '/mo', desc: 'For chains', features: ['Everything in Pro', 'Multiple locations', 'Custom domain', 'Dedicated onboarding', 'Guaranteed SLA'], cta: 'Talk to sales', highlight: false }] },
  cta: { heading: 'Ready to digitize\nyour menu?', text: 'Create your account now and have your QR Code in less than 5 minutes.', button: 'Create free account' },
  footer: { copyright: 'XmartMenu. All rights reserved.' },
}

export default async function LandingPage() {
  const service = await createServiceClient()
  const { data: raw } = await service.from('platform_settings').select('*').single()

  const cfg = raw ?? {}
  const landing = cfg.landing ?? {}
  const appName = cfg.app_name ?? D.app_name
  const brandName = cfg.brand_name ?? D.brand_name
  const hero = { ...D.hero, ...(landing.hero ?? {}) }
  const hiw = { ...D.how_it_works, ...(landing.how_it_works ?? {}) }
  const feat = { ...D.features, ...(landing.features ?? {}) }
  const price = { ...D.pricing, ...(landing.pricing ?? {}) }
  const ctaSection = { ...D.cta, ...(landing.cta ?? {}) }
  const footerData = { ...D.footer, ...(landing.footer ?? {}) }
  const year = new Date().getFullYear()
  const copyright = footerData.copyright.replace('{year}', String(year))

  return (
    <div className="min-h-screen bg-white text-zinc-900">
      {/* Nav */}
      <header className="fixed top-0 inset-x-0 z-50 bg-white/80 backdrop-blur border-b border-zinc-100">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-zinc-900 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 13a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1H4a1 1 0 01-1-1v-3zM13 4a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1V4zM13 13a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-3z" /></svg>
            </div>
            <span className="font-bold text-zinc-900">{appName}</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="#how-it-works" className="text-sm text-zinc-500 hover:text-zinc-900 transition-colors hidden sm:block">How it works</a>
            <a href="#pricing" className="text-sm text-zinc-500 hover:text-zinc-900 transition-colors hidden sm:block">Pricing</a>
            <Link href="/auth/login" className="text-sm font-medium bg-zinc-900 text-white px-4 py-2 rounded-lg hover:bg-zinc-800 transition-colors">Go to dashboard</Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="pt-32 pb-24 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <span className="inline-block text-xs font-semibold bg-zinc-100 text-zinc-600 px-3 py-1 rounded-full mb-6 tracking-wide uppercase">{hero.badge}</span>
          <h1 className="text-5xl sm:text-6xl font-extrabold text-zinc-900 leading-tight mb-6">
            {hero.heading}<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-500 to-pink-500">{hero.heading_highlight}</span>
          </h1>
          <p className="text-lg text-zinc-500 max-w-xl mx-auto mb-10">{hero.subheading}</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/auth/login" className="w-full sm:w-auto bg-zinc-900 text-white px-8 py-3.5 rounded-xl text-sm font-semibold hover:bg-zinc-800 transition-colors shadow-lg">{hero.cta_primary}</Link>
            <a href="#how-it-works" className="w-full sm:w-auto border border-zinc-200 text-zinc-700 px-8 py-3.5 rounded-xl text-sm font-semibold hover:bg-zinc-50 transition-colors">{hero.cta_secondary}</a>
          </div>
        </div>
        {/* Phone mock */}
        <div className="max-w-xs mx-auto mt-16">
          <div className="bg-zinc-900 rounded-3xl p-3 shadow-2xl">
            <div className="bg-white rounded-2xl overflow-hidden">
              <div className="bg-zinc-900 px-4 py-5">
                <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-white/20" /><div><div className="w-24 h-3 bg-white/80 rounded mb-1.5" /><div className="w-16 h-2 bg-white/40 rounded" /></div></div>
                <div className="mt-3 bg-white/10 rounded-lg h-9" />
              </div>
              <div className="px-3 py-2 flex gap-2 border-b border-zinc-100">
                {['All', 'Burgers', 'Drinks'].map((c, i) => (<div key={c} className={`text-xs px-3 py-1 rounded-full font-medium ${i === 0 ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-500'}`}>{c}</div>))}
              </div>
              <div className="p-3 space-y-2">
                {[{ name: 'X-Burguer Clássico', price: 'R$ 22,90', highlight: true }, { name: 'Batata Frita', price: 'R$ 18,90', highlight: false }, { name: 'Milk Shake', price: 'R$ 19,90', highlight: false }].map(p => (
                  <div key={p.name} className="flex items-center gap-2 bg-zinc-50 rounded-xl p-2">
                    <div className="w-14 h-14 rounded-lg bg-zinc-200 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1 mb-1"><div className="text-xs font-semibold text-zinc-900 truncate">{p.name}</div>{p.highlight && <span className="text-xs bg-amber-100 text-amber-600 px-1 rounded">Featured</span>}</div>
                      <div className="text-xs text-zinc-400 mb-1">Item description...</div>
                      <div className="text-xs font-bold text-orange-500">{p.price}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="py-24 px-6 bg-zinc-50">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14"><h2 className="text-3xl font-extrabold text-zinc-900 mb-3">{hiw.title}</h2><p className="text-zinc-500">{hiw.subtitle}</p></div>
          <div className="grid sm:grid-cols-3 gap-8">
            {hiw.steps.map((item: any) => (
              <div key={item.step} className="bg-white rounded-2xl p-7 border border-zinc-200">
                <div className="text-3xl mb-4">{item.icon}</div>
                <div className="text-xs font-bold text-zinc-400 mb-2 tracking-widest">STEP {item.step}</div>
                <h3 className="text-base font-bold text-zinc-900 mb-2">{item.title}</h3>
                <p className="text-sm text-zinc-500 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Funcionalidades */}
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14"><h2 className="text-3xl font-extrabold text-zinc-900 mb-3">{feat.title}</h2><p className="text-zinc-500">{feat.subtitle}</p></div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {feat.items.map((f: any) => (
              <div key={f.title} className="flex gap-4 p-5 rounded-2xl border border-zinc-100 hover:border-zinc-200 hover:bg-zinc-50 transition-colors">
                <div className="text-2xl flex-shrink-0">{f.icon}</div>
                <div><h4 className="text-sm font-semibold text-zinc-900 mb-1">{f.title}</h4><p className="text-sm text-zinc-500">{f.desc}</p></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-24 px-6 bg-zinc-50">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-14"><h2 className="text-3xl font-extrabold text-zinc-900 mb-3">{price.title}</h2><p className="text-zinc-500">{price.subtitle}</p></div>
          <div className="grid sm:grid-cols-3 gap-6">
            {price.plans.map((plan: any) => (
              <div key={plan.name} className={`rounded-2xl p-7 border ${plan.highlight ? 'bg-zinc-900 border-zinc-900 text-white shadow-xl scale-105' : 'bg-white border-zinc-200'}`}>
                <div className="text-xs font-bold uppercase tracking-widest mb-2 text-zinc-400">{plan.name}</div>
                <div className="flex items-end gap-1 mb-1">
                  <span className={`text-3xl font-extrabold ${plan.highlight ? 'text-white' : 'text-zinc-900'}`}>{plan.price}</span>
                  <span className="text-sm mb-1 text-zinc-400">{plan.period}</span>
                </div>
                <p className={`text-sm mb-6 ${plan.highlight ? 'text-zinc-400' : 'text-zinc-500'}`}>{plan.desc}</p>
                <ul className="space-y-2 mb-7">
                  {plan.features.map((f: string) => (
                    <li key={f} className={`flex items-center gap-2 text-sm ${plan.highlight ? 'text-zinc-300' : 'text-zinc-600'}`}>
                      <span className={`text-base ${plan.highlight ? 'text-green-400' : 'text-green-500'}`}>✓</span>{f}
                    </li>
                  ))}
                </ul>
                <Link href="/auth/login" className={`block text-center py-2.5 rounded-xl text-sm font-semibold transition-colors ${plan.highlight ? 'bg-white text-zinc-900 hover:bg-zinc-100' : 'bg-zinc-900 text-white hover:bg-zinc-800'}`}>{plan.cta}</Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="py-24 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-4xl font-extrabold text-zinc-900 mb-4" style={{ whiteSpace: 'pre-line' }}>{ctaSection.heading}</h2>
          <p className="text-zinc-500 mb-8">{ctaSection.text}</p>
          <Link href="/auth/login" className="inline-block bg-zinc-900 text-white px-10 py-4 rounded-xl text-sm font-semibold hover:bg-zinc-800 transition-colors shadow-lg">{ctaSection.button}</Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-100 py-8 px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-zinc-900 flex items-center justify-center">
              <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 13a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1H4a1 1 0 01-1-1v-3zM13 4a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1V4zM13 13a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-3z" /></svg>
            </div>
            <span className="text-sm font-semibold text-zinc-700">{appName}</span>
          </div>
          <p className="text-xs text-zinc-400">© {year} {copyright}</p>
        </div>
      </footer>
    </div>
  )
}
