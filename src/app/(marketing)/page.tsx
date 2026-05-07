export const dynamic = 'force-static'

import { Globe, QrCode, Sparkles, ShoppingCart, ChevronDown, Camera, MessageCircle, UserPlus, UtensilsCrossed } from 'lucide-react'

// ─── Section data (all copy locked from CONTEXT.md D-10 through D-21) ───────

const steps = [
  {
    num: 1,
    icon: UserPlus,
    title: 'Create your account',
    body: 'Sign up in seconds, no credit card required.',
  },
  {
    num: 2,
    icon: UtensilsCrossed,
    title: 'Build your menu',
    body: "Add categories, products, images and prices. We'll help with AI.",
  },
  {
    num: 3,
    icon: QrCode,
    title: 'Share your QR code',
    body: 'Print it, display it at the table, and let customers browse.',
  },
]

const features = [
  {
    icon: Globe,
    title: 'Multi-language menus',
    body: 'Serve customers in Portuguese, English, Spanish and more — your menu adapts to every language automatically.',
  },
  {
    icon: QrCode,
    title: 'QR code, ready in seconds',
    body: 'Every menu gets a unique QR code. Print it, share it, or embed it anywhere.',
  },
  {
    icon: Sparkles,
    title: 'AI-powered setup',
    body: 'Our team can populate your entire menu in minutes using AI — categories, descriptions, and photos included.',
  },
  {
    icon: ShoppingCart,
    title: 'Online ordering',
    body: 'Let customers order directly from the table. Available as an add-on.',
  },
]

const faqs = [
  {
    q: 'Is it free?',
    a: "Yes, xmartmenu is free during beta. We'll announce pricing changes with advance notice.",
  },
  {
    q: 'Do I need a developer?',
    a: 'No. You set up your menu from a simple admin panel — no code required.',
  },
  {
    q: 'Can my menu be in multiple languages?',
    a: 'Yes. You can enable multiple languages and your menu content will be available in each.',
  },
  {
    q: 'What happens to my data if I cancel?',
    a: "Your data is yours. Contact us and we'll export everything before you leave.",
  },
  {
    q: 'How do QR codes work?',
    a: 'Every menu gets a unique QR code. Customers scan it and see your live menu instantly.',
  },
  {
    q: 'Is online ordering available?',
    a: 'Online ordering is available as an add-on. Contact us to enable it for your restaurant.',
  },
]

// ─── Components ──────────────────────────────────────────────────────────────

function Nav() {
  return (
    <nav className="sticky top-0 z-50 h-16 bg-white border-b border-zinc-200 flex items-center px-4 sm:px-6">
      <div className="max-w-5xl mx-auto w-full flex items-center justify-between">
        <span className="text-xl font-bold text-zinc-900">XmartMenu</span>
        <a
          href="/auth/register"
          className="bg-zinc-900 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-zinc-800 transition-colors min-h-[44px] inline-flex items-center focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2"
        >
          Get started
        </a>
      </div>
    </nav>
  )
}

function Hero() {
  return (
    <section className="bg-zinc-50 py-24 px-4">
      <div className="max-w-2xl mx-auto text-center">
        <h1 className="text-4xl sm:text-5xl font-bold text-zinc-900 leading-tight">
          Your restaurant menu, online in minutes
        </h1>
        <p className="text-xl text-zinc-600 mt-4 leading-relaxed">
          Create a beautiful digital menu, generate a QR code, and start taking orders — no tech skills needed.
        </p>
        <div className="mt-8">
          <a
            href="/auth/register"
            className="inline-flex items-center justify-center bg-zinc-900 text-white px-8 py-3.5 rounded-xl text-base font-bold hover:bg-zinc-800 transition-colors min-h-[44px] focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2"
          >
            Get started free
          </a>
        </div>
        <p className="mt-3 text-sm text-zinc-500">No credit card required.</p>
      </div>
    </section>
  )
}

function HowItWorks() {
  return (
    <section className="bg-white py-16 px-4">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-3xl font-bold text-zinc-900 text-center mb-12">How It Works</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
          {steps.map(({ num, icon: Icon, title, body }) => (
            <div key={num} className="flex flex-col items-center text-center sm:items-start sm:text-left">
              <div className="w-10 h-10 rounded-full bg-zinc-900 text-white flex items-center justify-center text-sm font-bold shrink-0">
                {num}
              </div>
              <p className="text-xl font-bold text-zinc-900 mt-4 mb-2">{title}</p>
              <p className="text-base text-zinc-600 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function FeatureBlocks() {
  return (
    <section className="bg-zinc-50 py-16 px-4">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-3xl font-bold text-zinc-900 text-center mb-12">
          Everything your restaurant needs
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {features.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="bg-white rounded-2xl border border-zinc-200 p-6"
            >
              <div className="w-10 h-10 rounded-lg bg-zinc-100 flex items-center justify-center mb-4">
                <Icon className="w-5 h-5 text-zinc-700" />
              </div>
              <p className="text-xl font-bold text-zinc-900 mb-2">{title}</p>
              <p className="text-base text-zinc-600 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function FAQ() {
  return (
    <section className="bg-white py-16 px-4">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-3xl font-bold text-zinc-900 text-center mb-10">
          Frequently asked questions
        </h2>
        <div className="divide-y divide-zinc-200">
          {faqs.map(({ q, a }) => (
            <details key={q} className="py-4 group">
              <summary className="text-base font-bold text-zinc-900 cursor-pointer list-none flex justify-between items-center min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900">
                {q}
                <ChevronDown className="w-4 h-4 text-zinc-500 shrink-0 ml-4 group-open:rotate-180 transition-transform" />
              </summary>
              <p className="text-base text-zinc-600 leading-relaxed mt-3 pb-1">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}

function FooterCTABand() {
  return (
    <section className="bg-zinc-900 py-16 px-4">
      <div className="max-w-2xl mx-auto text-center">
        <h2 className="text-3xl font-bold text-white mb-4">Ready to get started?</h2>
        <p className="text-zinc-400 mb-8">Join the first restaurants using xmartmenu.</p>
        <a
          href="/auth/register"
          className="inline-flex items-center justify-center bg-white text-zinc-900 px-8 py-3.5 rounded-xl text-base font-bold hover:bg-zinc-100 transition-colors min-h-[44px] focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-zinc-900"
        >
          Get started free
        </a>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="bg-zinc-900 px-4 pb-8">
      <div className="max-w-5xl mx-auto border-t border-zinc-800 pt-8">
        <div className="flex flex-col sm:flex-row sm:justify-between gap-8">
          {/* Logo + tagline */}
          <div>
            <p className="text-white font-bold text-base">XmartMenu</p>
            <p className="text-zinc-400 text-sm mt-1">Cardápio digital para restaurantes</p>
            {/* Social icons */}
            <div className="flex gap-4 mt-4">
              <a
                href="#"
                aria-label="Instagram"
                className="text-zinc-400 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-400"
              >
                <Camera className="w-5 h-5" />
              </a>
              <a
                href="#"
                aria-label="WhatsApp"
                className="text-zinc-400 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-400"
              >
                <MessageCircle className="w-5 h-5" />
              </a>
            </div>
          </div>
          {/* Legal links */}
          <div>
            <p className="text-sm font-bold text-zinc-400 uppercase tracking-wider mb-3">Legal</p>
            <ul className="flex flex-col gap-2">
              <li>
                <a href="/privacy" className="text-sm text-zinc-400 hover:text-white transition-colors">
                  Privacy Policy
                </a>
              </li>
              <li>
                <a href="/terms" className="text-sm text-zinc-400 hover:text-white transition-colors">
                  Terms of Service
                </a>
              </li>
            </ul>
          </div>
        </div>
        <p className="text-sm text-zinc-500 mt-8 text-center">
          © 2026 xmartmenu. All rights reserved.
        </p>
      </div>
    </footer>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <HowItWorks />
        <FeatureBlocks />
        <FAQ />
        <FooterCTABand />
      </main>
      <Footer />
    </>
  )
}
