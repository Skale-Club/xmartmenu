import { Clock } from 'lucide-react'
import { createServiceClient } from '@/lib/supabase/server'

export default async function PendingPage() {
  const service = createServiceClient()
  const { data: ps } = await service.from('platform_settings').select('favicon_url').single()
  const logoUrl = ps?.favicon_url ?? '/icon.png'

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 px-4">
      {/* Background Glows */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/5 rounded-full blur-[120px] opacity-40 pointer-events-none" />

      <div className="bg-zinc-900/50 backdrop-blur-xl border border-white/10 rounded-[1.25rem] p-10 max-w-sm w-full text-center relative z-10">
        <img src={logoUrl} alt="Logo" className="w-12 h-12 mx-auto mb-6" />
        <div className="w-20 h-20 bg-primary/10 border border-primary/20 rounded-full flex items-center justify-center mx-auto mb-8">
          <Clock className="w-10 h-10 text-primary" />
        </div>
        <h1 className="text-2xl font-black text-white mb-4 tracking-tight">Account under review</h1>
        <p className="text-sm font-medium text-zinc-500 mb-8 leading-relaxed">
          Your access has not been configured yet. Please contact support or wait for your account to be activated by an administrator.
        </p>
        <a
          href="/auth/login"
          className="inline-flex items-center justify-center bg-primary text-primary-foreground px-8 py-4 rounded-full text-base font-black hover:bg-white transition-all hover:scale-[1.02] active:scale-95"
        >
          Back to login
        </a>
      </div>
    </div>
  )
}
