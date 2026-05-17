"use client"

import { motion } from 'framer-motion'
import { Globe, QrCode, Sparkles, ShoppingCart, ChevronDown, Camera, MessageCircle, UserPlus, UtensilsCrossed, ArrowRight } from 'lucide-react'

// ─── Section data ───────

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
    body: 'Serve customers in English, Spanish and more. Your menu adapts to every language automatically.',
  },
  {
    icon: QrCode,
    title: 'QR code, ready in seconds',
    body: 'Every menu gets a unique QR code. Print it, share it, or embed it anywhere.',
  },
  {
    icon: Sparkles,
    title: 'AI-powered setup',
    body: 'Our team can structure your menu with AI, including categories, descriptions, and photos.',
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
    a: "Yes, XmartMenu is free during beta. We'll announce pricing changes with advance notice.",
  },
  {
    q: 'Do I need a developer?',
    a: 'No. You set up your menu from a simple admin panel. No code required.',
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
    <motion.nav 
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="fixed top-0 inset-x-0 z-50 h-16 border-b border-white/10 bg-zinc-950/50 backdrop-blur-xl flex items-center px-4 sm:px-6"
    >
      <div className="w-full max-w-[1320px] mx-auto px-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <a href="/" className="flex items-center gap-3">
            <img src="/icon.png" alt="XmartMenu Logo" className="w-8 h-8 object-cover" />
            <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-zinc-200">XmartMenu</span>
          </a>
        </div>
        <a
          href="/auth/login"
          className="relative group overflow-hidden bg-primary text-zinc-950 px-5 py-2 rounded-full text-sm font-bold transition-all hover:scale-105 active:scale-95 inline-flex items-center gap-2"
        >
          <span className="relative z-10">Sign In</span>
          <ArrowRight className="w-4 h-4 relative z-10 group-hover:translate-x-1 transition-transform" />
        </a>
      </div>
    </motion.nav>
  )
}

function Hero() {
  return (
    <section className="relative pt-8 pb-4 px-4 overflow-hidden min-h-[20vh] flex flex-col justify-center">
      {/* Background Glows */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/10 rounded-full blur-[120px] opacity-40 pointer-events-none" />
      <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-yellow-400/5 rounded-full blur-[100px] opacity-30 pointer-events-none" />
      
      <div className="max-w-[1320px] mx-auto px-8 pt-32 pb-20 relative z-10 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-primary text-sm font-medium mb-8">
            <Sparkles className="w-4 h-4" />
            The future of dining is here
          </span>
        </motion.div>
        
        <motion.h1 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="text-5xl sm:text-7xl font-extrabold text-white leading-tight tracking-tight mb-6"
        >
          Your restaurant menu, <br className="hidden sm:block" />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-yellow-200 to-white">
            built for service.
          </span>
        </motion.h1>
        
        <motion.p 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="text-xl sm:text-2xl text-zinc-400 mb-10 max-w-2xl mx-auto leading-relaxed"
        >
          Create a beautiful digital menu, generate a QR code, and start taking orders. No tech skills needed.
        </motion.p>
        
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.5 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <a
            href="/auth/login"
            className="w-full sm:w-auto inline-flex items-center justify-center bg-primary text-zinc-950 px-8 py-4 rounded-full text-lg font-bold hover:bg-white transition-all hover:scale-105"
          >
            Sign in to dashboard
          </a>
          <a
            href="#how-it-works"
            className="w-full sm:w-auto inline-flex items-center justify-center bg-white/5 border border-white/10 text-white px-8 py-4 rounded-full text-lg font-bold hover:bg-white/10 transition-colors"
          >
            See how it works
          </a>
        </motion.div>
      </div>
    </section>
  )
}

function HowItWorks() {
  return (
    <section id="how-it-works" className="py-24 px-4 relative">
      <div className="max-w-[1320px] mx-auto px-8">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl sm:text-5xl font-bold text-white mb-6">How It Works</h2>
          <p className="text-xl text-zinc-400">Three simple steps to transform your restaurant's digital presence.</p>
        </motion.div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
          {/* Connecting Line (Desktop) */}
          <div className="hidden md:block absolute top-12 left-[15%] right-[15%] h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
          
          {steps.map(({ num, icon: Icon, title, body }, i) => (
            <motion.div 
              key={num}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.2 }}
              className="relative bg-zinc-900/50 backdrop-blur-sm border border-white/5 p-8 rounded-[1.25rem] hover:bg-zinc-900 transition-colors group"
            >
              <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center text-xl font-bold mb-6 mx-auto md:mx-0 group-hover:scale-110 group-hover:bg-primary group-hover:text-zinc-950 transition-all duration-300">
                <Icon className="w-8 h-8" />
              </div>
              <p className="text-2xl font-bold text-white mt-4 mb-3 text-center md:text-left">{title}</p>
              <p className="text-zinc-400 leading-relaxed text-center md:text-left">{body}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

function FeatureBlocks() {
  return (
    <section className="py-24 px-4 relative">
      <div className="absolute inset-0 bg-zinc-950" />
      <div className="max-w-[1320px] mx-auto px-8 relative z-10">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl sm:text-5xl font-bold text-white mb-6">
            Everything your restaurant needs
          </h2>
          <p className="text-xl text-zinc-400">Powerful features wrapped in a beautifully simple interface.</p>
        </motion.div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {features.map(({ icon: Icon, title, body }, i) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              whileHover={{ y: -5 }}
              className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-[1.25rem] p-8 relative overflow-hidden group"
            >
              {/* Hover gradient effect */}
              <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-yellow-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              
              <div className="relative z-10">
                <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center mb-6">
                  <Icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-2xl font-bold text-white mb-3">{title}</h3>
                <p className="text-lg text-zinc-400 leading-relaxed">{body}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

function FAQ() {
  return (
    <section className="py-24 px-4">
      <div className="max-w-[1320px] mx-auto px-8">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl sm:text-5xl font-bold text-white mb-6">
            Frequently asked questions
          </h2>
        </motion.div>
        
        <div className="space-y-4">
          {faqs.map(({ q, a }, i) => (
            <motion.details 
              key={q} 
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="group bg-white/5 border border-white/10 rounded-xl overflow-hidden [&_summary::-webkit-details-marker]:hidden"
            >
              <summary className="p-6 text-lg font-bold text-white cursor-pointer flex justify-between items-center focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                {q}
                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center group-open:rotate-180 transition-transform duration-300 shrink-0 ml-4">
                  <ChevronDown className="w-4 h-4 text-white" />
                </div>
              </summary>
              <div className="p-6 pt-0 text-zinc-400 text-lg leading-relaxed border-t border-white/5 group-open:animate-in group-open:fade-in group-open:slide-in-from-top-4 duration-300">
                {a}
              </div>
            </motion.details>
          ))}
        </div>
      </div>
    </section>
  )
}

function FooterCTABand() {
  return (
    <section className="py-24 px-8 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-zinc-950" />
      <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      
      <div className="max-w-[1320px] mx-auto relative z-10 bg-zinc-950/40 backdrop-blur-xl border border-white/10 p-12 sm:p-20 rounded-[2rem] text-center">
        <motion.h2 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-4xl sm:text-6xl font-bold text-white mb-6"
        >
          Ready to get started?
        </motion.h2>
        <motion.p 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 }}
          className="text-xl text-zinc-300 mb-10 max-w-2xl mx-auto"
        >
          Join the first restaurants using XmartMenu and transform your customer experience today.
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 }}
        >
          <a
            href="/auth/login"
            className="inline-flex items-center justify-center bg-primary text-zinc-950 px-10 py-5 rounded-full text-xl font-bold hover:bg-white transition-all hover:scale-105 active:scale-95"
          >
            Sign in now
          </a>
        </motion.div>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="border-t border-white/10 bg-zinc-950 px-4 pt-16 pb-8">
      <div className="max-w-[1320px] mx-auto px-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 mb-12">
          {/* Logo + tagline */}
          <div>
            <div className="flex items-center gap-3 mb-4">
               <img src="/icon.png" alt="XmartMenu Logo" className="w-6 h-6 object-cover" />
              <span className="text-lg font-bold text-white">XmartMenu</span>
            </div>
            <p className="text-zinc-400 text-base max-w-sm">
              Digital menu for restaurants. Modernize the way your customers order.
            </p>
            {/* Social icons */}
            <div className="flex gap-4 mt-6">
              <a
                href="#"
                aria-label="Instagram"
                className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-primary hover:border-primary/50 transition-colors"
              >
                <Camera className="w-5 h-5" />
              </a>
              <a
                href="#"
                aria-label="WhatsApp"
                className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-primary hover:border-primary/50 transition-colors"
              >
                <MessageCircle className="w-5 h-5" />
              </a>
            </div>
          </div>
          {/* Legal links */}
          <div className="md:text-right">
            <p className="text-sm font-bold text-white uppercase tracking-wider mb-4">Legal</p>
            <ul className="flex flex-col md:items-end gap-3">
              <li>
                <a href="/privacy" className="text-zinc-400 hover:text-white transition-colors">
                  Privacy Policy
                </a>
              </li>
              <li>
                <a href="/terms" className="text-zinc-400 hover:text-white transition-colors">
                  Terms of Service
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-sm text-zinc-500">
            © 2026 XmartMenu. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ClientLandingPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 selection:bg-primary/30">
      <Nav />
      <main>
        <Hero />
        <HowItWorks />
        <FeatureBlocks />
        <FAQ />
        <FooterCTABand />
      </main>
      <Footer />
    </div>
  )
}
