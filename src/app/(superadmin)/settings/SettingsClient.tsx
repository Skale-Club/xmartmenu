'use client'

import { useState } from 'react'

const DEFAULT_LANDING = {
  hero: { badge: 'Cardápio digital para restaurantes', heading: 'Seu cardápio no celular', heading_highlight: 'com um QR Code', subheading: 'Crie seu cardápio digital em minutos, gere um QR Code e deixe seus clientes pedindo pelo WhatsApp. Sem app, sem complicação.', cta_primary: 'Começar grátis', cta_secondary: 'Ver como funciona' },
  how_it_works: { title: 'Como funciona', subtitle: 'Em 3 passos simples você já está no ar', steps: [{ step: '01', icon: '📋', title: 'Cadastre seu cardápio', desc: 'Crie categorias e adicione seus produtos com fotos, descrições e preços no painel de controle.' }, { step: '02', icon: '🎨', title: 'Personalize o visual', desc: 'Adicione seu logotipo, cores do restaurante e informações de contato para deixar com a sua cara.' }, { step: '03', icon: '📱', title: 'Gere e imprima o QR Code', desc: 'Com um clique gere seu QR Code único. Coloque nas mesas e deixe seus clientes acessarem na hora.' }] },
  features: { title: 'Tudo que você precisa', subtitle: 'Funcionalidades pensadas para restaurantes', items: [{ icon: '🔗', title: 'Link único por restaurante', desc: 'Cada cliente tem seu próprio endereço de cardápio digital.' }, { icon: '📲', title: 'Pedido pelo WhatsApp', desc: 'O cliente clica no produto e já abre o WhatsApp pronto para pedir.' }, { icon: '🎨', title: 'Branding personalizado', desc: 'Logo, cores e identidade visual do seu restaurante.' }, { icon: '📊', title: 'Contagem de scans', desc: 'Veja quantas vezes seu QR Code foi escaneado.' }, { icon: '🔍', title: 'Busca no cardápio', desc: 'Clientes encontram qualquer produto em segundos.' }, { icon: '⚡', title: 'Sem instalar app', desc: 'Tudo abre direto no navegador do celular, sem fricção.' }] },
  pricing: { title: 'Planos simples', subtitle: 'Comece grátis, escale quando precisar', plans: [{ name: 'Free', price: 'R$ 0', period: '/mês', desc: 'Para começar', features: ['Cardápio digital', 'QR Code gerado', 'Até 20 produtos', 'Branding básico'], cta: 'Começar grátis', highlight: false }, { name: 'Pro', price: 'R$ 49', period: '/mês', desc: 'Para crescer', features: ['Tudo do Free', 'Produtos ilimitados', 'Branding completo', 'Analytics de scans', 'Suporte prioritário'], cta: 'Assinar Pro', highlight: true }, { name: 'Enterprise', price: 'R$ 149', period: '/mês', desc: 'Para redes', features: ['Tudo do Pro', 'Múltiplas unidades', 'Domínio próprio', 'Onboarding dedicado', 'SLA garantido'], cta: 'Falar com vendas', highlight: false }] },
  cta: { heading: 'Pronto para digitalizar\nseu cardápio?', text: 'Crie sua conta agora e tenha seu QR Code em menos de 5 minutos.', button: 'Criar conta grátis' },
  footer: { copyright: 'Xmartmenu. Todos os direitos reservados.' },
}

interface Props { settings: any }

export default function SettingsClient({ settings }: Props) {
  const s = settings ?? {}
  const l = { ...DEFAULT_LANDING, ...(s.landing ?? {}) }

  const [platform, setPlatform] = useState({
    app_name: s.app_name ?? 'Xmartmenu',
    brand_name: s.brand_name ?? 'Xmartmenu',
    default_primary_color: s.default_primary_color ?? '#000000',
    default_accent_color: s.default_accent_color ?? '#FF5722',
    menu_footer_brand: s.menu_footer_brand ?? 'Xmartmenu',
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
        <h1 className="text-2xl font-bold text-zinc-900">Configurações da plataforma</h1>
        <p className="text-sm text-zinc-500 mt-1">Gerencie textos, cores e conteúdo da landing page</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-6 text-sm text-red-700 flex items-center justify-between">
          {error}<button onClick={() => setError(null)} className="ml-4 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">

        {/* Plataforma */}
        <div className={section}>
          <h2 className={sectionTitle}>Plataforma</h2>
          <div className="grid grid-cols-2 gap-4">
            <div><label className={label}>Nome do app</label><input className={input} value={platform.app_name} onChange={e => setPlatform({ ...platform, app_name: e.target.value })} /></div>
            <div><label className={label}>Nome da marca</label><input className={input} value={platform.brand_name} onChange={e => setPlatform({ ...platform, brand_name: e.target.value })} /></div>
            <div><label className={label}>Rodapé do cardápio público</label><input className={input} value={platform.menu_footer_brand} onChange={e => setPlatform({ ...platform, menu_footer_brand: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label}>Cor primária padrão (novos tenants)</label>
              <div className="flex items-center gap-3">
                <input type="color" value={platform.default_primary_color} onChange={e => setPlatform({ ...platform, default_primary_color: e.target.value })} className="w-10 h-10 rounded-lg border border-zinc-300 cursor-pointer p-0.5" />
                <input className={input} value={platform.default_primary_color} onChange={e => setPlatform({ ...platform, default_primary_color: e.target.value })} />
              </div>
            </div>
            <div>
              <label className={label}>Cor de destaque padrão (novos tenants)</label>
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
            <div><label className={label}>Badge (topo)</label><input className={input} value={hero.badge} onChange={e => setHero({ ...hero, badge: e.target.value })} /></div>
            <div><label className={label}>Destaque em gradiente</label><input className={input} value={hero.heading_highlight} onChange={e => setHero({ ...hero, heading_highlight: e.target.value })} /></div>
          </div>
          <div><label className={label}>Título principal</label><input className={input} value={hero.heading} onChange={e => setHero({ ...hero, heading: e.target.value })} /></div>
          <div><label className={label}>Subtítulo</label><textarea rows={2} className={textarea} value={hero.subheading} onChange={e => setHero({ ...hero, subheading: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className={label}>Botão primário</label><input className={input} value={hero.cta_primary} onChange={e => setHero({ ...hero, cta_primary: e.target.value })} /></div>
            <div><label className={label}>Botão secundário</label><input className={input} value={hero.cta_secondary} onChange={e => setHero({ ...hero, cta_secondary: e.target.value })} /></div>
          </div>
        </div>

        {/* Como funciona */}
        <div className={section}>
          <h2 className={sectionTitle}>Landing Page — Como funciona</h2>
          <div className="grid grid-cols-2 gap-4">
            <div><label className={label}>Título da seção</label><input className={input} value={howItWorks.title} onChange={e => setHowItWorks({ ...howItWorks, title: e.target.value })} /></div>
            <div><label className={label}>Subtítulo</label><input className={input} value={howItWorks.subtitle} onChange={e => setHowItWorks({ ...howItWorks, subtitle: e.target.value })} /></div>
          </div>
          {howItWorks.steps.map((step: any, i: number) => (
            <div key={i} className="bg-zinc-50 rounded-lg p-4 space-y-2">
              <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Passo {step.step}</p>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>Ícone (emoji)</label><input className={input} value={step.icon} onChange={e => updateStep(i, 'icon', e.target.value)} /></div>
                <div><label className={label}>Título</label><input className={input} value={step.title} onChange={e => updateStep(i, 'title', e.target.value)} /></div>
              </div>
              <div><label className={label}>Descrição</label><textarea rows={2} className={textarea} value={step.desc} onChange={e => updateStep(i, 'desc', e.target.value)} /></div>
            </div>
          ))}
        </div>

        {/* Funcionalidades */}
        <div className={section}>
          <h2 className={sectionTitle}>Landing Page — Funcionalidades</h2>
          <div className="grid grid-cols-2 gap-4">
            <div><label className={label}>Título da seção</label><input className={input} value={features.title} onChange={e => setFeatures({ ...features, title: e.target.value })} /></div>
            <div><label className={label}>Subtítulo</label><input className={input} value={features.subtitle} onChange={e => setFeatures({ ...features, subtitle: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {features.items.map((item: any, i: number) => (
              <div key={i} className="bg-zinc-50 rounded-lg p-3 space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <div><label className={label}>Ícone</label><input className={input} value={item.icon} onChange={e => updateFeature(i, 'icon', e.target.value)} /></div>
                  <div className="col-span-2"><label className={label}>Título</label><input className={input} value={item.title} onChange={e => updateFeature(i, 'title', e.target.value)} /></div>
                </div>
                <div><label className={label}>Descrição</label><input className={input} value={item.desc} onChange={e => updateFeature(i, 'desc', e.target.value)} /></div>
              </div>
            ))}
          </div>
        </div>

        {/* Planos */}
        <div className={section}>
          <h2 className={sectionTitle}>Landing Page — Planos</h2>
          <div className="grid grid-cols-2 gap-4">
            <div><label className={label}>Título da seção</label><input className={input} value={pricing.title} onChange={e => setPricing({ ...pricing, title: e.target.value })} /></div>
            <div><label className={label}>Subtítulo</label><input className={input} value={pricing.subtitle} onChange={e => setPricing({ ...pricing, subtitle: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {pricing.plans.map((plan: any, i: number) => (
              <div key={i} className="bg-zinc-50 rounded-lg p-4 space-y-2">
                <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">{plan.name}</p>
                <div><label className={label}>Nome</label><input className={input} value={plan.name} onChange={e => updatePlan(i, 'name', e.target.value)} /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className={label}>Preço</label><input className={input} value={plan.price} onChange={e => updatePlan(i, 'price', e.target.value)} /></div>
                  <div><label className={label}>Período</label><input className={input} value={plan.period} onChange={e => updatePlan(i, 'period', e.target.value)} /></div>
                </div>
                <div><label className={label}>Descrição</label><input className={input} value={plan.desc} onChange={e => updatePlan(i, 'desc', e.target.value)} /></div>
                <div><label className={label}>Texto do botão</label><input className={input} value={plan.cta} onChange={e => updatePlan(i, 'cta', e.target.value)} /></div>
                <div>
                  <label className={label}>Funcionalidades (uma por linha)</label>
                  <textarea rows={5} className={textarea} value={plan.features.join('\n')} onChange={e => updatePlan(i, 'features', e.target.value.split('\n').filter(Boolean))} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CTA Final */}
        <div className={section}>
          <h2 className={sectionTitle}>Landing Page — CTA Final</h2>
          <div><label className={label}>Título</label><input className={input} value={cta.heading} onChange={e => setCta({ ...cta, heading: e.target.value })} /></div>
          <div><label className={label}>Texto</label><input className={input} value={cta.text} onChange={e => setCta({ ...cta, text: e.target.value })} /></div>
          <div><label className={label}>Botão</label><input className={input} value={cta.button} onChange={e => setCta({ ...cta, button: e.target.value })} /></div>
        </div>

        {/* Rodapé */}
        <div className={section}>
          <h2 className={sectionTitle}>Landing Page — Rodapé</h2>
          <div><label className={label}>Texto de copyright (use {'{year}'} para o ano)</label><input className={input} value={footer.copyright} onChange={e => setFooter({ ...footer, copyright: e.target.value })} /></div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-zinc-100 -mx-8 px-8 py-4 flex items-center gap-4">
          <button type="submit" disabled={loading}
            className="bg-zinc-900 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-zinc-800 disabled:opacity-50 transition-colors">
            {loading ? 'Salvando...' : saved ? '✓ Salvo!' : 'Salvar configurações'}
          </button>
          {saved && <p className="text-sm text-green-600">Alterações salvas com sucesso.</p>}
        </div>
      </form>
    </div>
  )
}
