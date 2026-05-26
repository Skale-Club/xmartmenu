'use client'

export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import { ShieldCheck, Lock, Key, CheckCircle2, AlertCircle, Save, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function PasswordPage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const supabase = createClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  const forced = searchParams.get('forced') === '1'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      setMessage({ type: 'error', text: 'Passwords do not match' })
      return
    }
    if (password.length < 8) {
      setMessage({ type: 'error', text: 'Password must be at least 8 characters' })
      return
    }
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setMessage({ type: 'error', text: error.message })
    } else {
      const { data: authData } = await supabase.auth.getUser()
      if (authData.user) {
        await supabase
          .from('profiles')
          .update({
            must_change_password: false,
            password_changed_at: new Date().toISOString(),
          })
          .eq('id', authData.user.id)
      }
      setMessage({ type: 'success', text: 'Password updated successfully!' })
      setPassword('')
      setConfirm('')
      if (forced) {
        router.replace('/dashboard')
      }
    }
    setLoading(false)
  }

  const inputClassName = "w-full px-5 py-3.5 bg-zinc-50 border border-zinc-200 rounded-2xl text-sm text-zinc-950 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
  const labelClassName = "block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2 ml-1"

  return (
    <div className="p-8 w-full space-y-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 pb-6 border-b border-zinc-100">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">Security Terminal</span>
          </div>
          <h1 className="text-4xl font-black text-zinc-950 tracking-tight">Access Control</h1>
          <p className="text-sm font-bold text-zinc-500 mt-1">Update your authentication credentials</p>
        </div>
      </div>

      <div className="max-w-2xl">
        {forced && (
          <div className="mb-8 p-6 bg-amber-50 border border-amber-100 rounded-[2rem] flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-500 shrink-0">
              <Info className="w-6 h-6" />
            </div>
            <div>
              <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-1">First-time Access</p>
              <p className="text-sm font-bold text-amber-900 leading-relaxed">
                You are currently using a temporary password. For your security, you must define a unique private password to access the dashboard.
              </p>
            </div>
          </div>
        )}

        {message && (
          <div className={cn(
            "mb-8 p-6 rounded-[2rem] flex items-center gap-4 border shadow-sm",
            message.type === 'success' ? "bg-green-50 border-green-100 text-green-700" : "bg-red-50 border-red-100 text-red-700"
          )}>
            {message.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
            <p className="text-sm font-bold">{message.text}</p>
          </div>
        )}

        <div className="bg-white border border-zinc-100 rounded-[2.5rem] p-10 shadow-sm relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-[80px] -mr-32 -mt-32 opacity-50" />
          
          <form onSubmit={handleSubmit} className="relative z-10 space-y-8">
            <div className="space-y-6">
              <div>
                <label className={labelClassName}>New Password</label>
                <div className="relative">
                  <div className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-400">
                    <Lock className="w-5 h-5" />
                  </div>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Minimum 8 characters"
                    className={cn(inputClassName, "pl-14")}
                  />
                </div>
              </div>
              <div>
                <label className={labelClassName}>Verify Password</label>
                <div className="relative">
                  <div className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-400">
                    <Key className="w-5 h-5" />
                  </div>
                  <input
                    type="password"
                    required
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    placeholder="Repeat password"
                    className={cn(inputClassName, "pl-14")}
                  />
                </div>
              </div>
            </div>

            <div className="pt-6 border-t border-zinc-50 flex flex-col sm:flex-row items-center justify-between gap-6">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-zinc-400" />
                <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">End-to-End Encrypted</p>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full sm:w-auto bg-zinc-950 text-white px-12 py-5 rounded-full text-sm font-black uppercase tracking-widest hover:bg-primary hover:text-primary-foreground transition-all active:scale-95 disabled:opacity-50 shadow-xl shadow-zinc-950/10 flex items-center justify-center gap-3"
              >
                {loading ? 'Securing...' : (
                  <>
                    <Save className="w-5 h-5" />
                    Update Credentials
                  </>
                )}
              </button>
            </div>
          </form>
        </div>

        <p className="mt-8 text-[10px] font-medium text-zinc-400 text-center uppercase tracking-widest leading-relaxed px-10">
          Make sure to use a strong password that you don't use elsewhere. After updating, you will need to use the new password for all future sessions.
        </p>
      </div>
    </div>
  )
}
