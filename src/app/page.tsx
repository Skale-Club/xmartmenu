'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()

    async function redirect(userId: string | undefined) {
      if (userId) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', userId)
          .single()
        router.replace(profile?.role === 'superadmin' ? '/tenants' : '/dashboard')
      } else {
        router.replace('/auth/login')
      }
    }

    // Verifica sessão atual imediatamente
    supabase.auth.getSession().then(({ data: { session } }) => {
      redirect(session?.user?.id)
    })

    // Também escuta mudanças (ex: magic link no hash da URL)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN') {
        redirect(session?.user?.id)
      }
    })

    return () => subscription.unsubscribe()
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50">
      <div className="text-center">
        <p className="text-sm text-zinc-500">Carregando...</p>
      </div>
    </div>
  )
}
