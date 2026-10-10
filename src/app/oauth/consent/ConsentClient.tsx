'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type OAuthClient = { id: string; name: string; uri: string; logo_uri: string }
type Details = {
  authorization_id: string
  redirect_uri: string
  client: OAuthClient
  user: { id: string; email: string }
  scope: string
}

type View =
  | { k: 'loading' }
  | { k: 'need-login'; loginHref: string }
  | { k: 'consent'; details: Details; email: string }
  | { k: 'working' }
  | { k: 'error'; message: string }

export default function ConsentClient() {
  const params = useSearchParams()
  const authorizationId = params.get('authorization_id')
  const [view, setView] = useState<View>({ k: 'loading' })
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      if (!authorizationId) {
        if (active) setView({ k: 'error', message: 'Requisição de autorização inválida (authorization_id ausente).' })
        return
      }
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        const back = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`
        if (active) setView({ k: 'need-login', loginHref: `/auth/login?from=${encodeURIComponent(back)}` })
        return
      }

      const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId)
      if (!active) return
      if (error || !data) {
        setView({ k: 'error', message: error?.message ?? 'Não foi possível carregar os detalhes da autorização.' })
        return
      }
      // Already consented / auto-approved → Supabase returns a ready redirect_url.
      if ('redirect_url' in data && data.redirect_url) {
        window.location.href = data.redirect_url
        setView({ k: 'working' })
        return
      }
      if ('authorization_id' in data) {
        setView({ k: 'consent', details: data as Details, email: user.email ?? '' })
        return
      }
      setView({ k: 'error', message: 'Resposta de autorização inesperada.' })
    })()
    return () => {
      active = false
    }
  }, [authorizationId])

  const decide = useCallback(
    async (approve: boolean) => {
      if (!authorizationId) return
      setBusy(approve ? 'approve' : 'deny')
      const oauth = createClient().auth.oauth
      const { data, error } = approve
        ? await oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
        : await oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true })
      if (error || !data?.redirect_url) {
        setBusy(null)
        setView({ k: 'error', message: error?.message ?? 'Falha ao processar a decisão.' })
        return
      }
      setView({ k: 'working' })
      window.location.href = data.redirect_url
    },
    [authorizationId],
  )

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 px-4 relative overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/5 rounded-full blur-[120px] opacity-40 pointer-events-none" />
      <div className="w-full max-w-md relative z-10">
        <div className="bg-zinc-900/50 backdrop-blur-xl border border-white/10 rounded-[1.25rem] p-8">
          {view.k === 'loading' || view.k === 'working' ? (
            <div className="py-10 text-center text-zinc-400 text-sm font-bold">
              {view.k === 'working' ? 'Redirecionando…' : 'Carregando…'}
            </div>
          ) : view.k === 'need-login' ? (
            <div className="text-center">
              <h1 className="text-xl font-black text-white">Entre para continuar</h1>
              <p className="text-sm text-zinc-400 mt-2 mb-6">
                Faça login na sua conta XmartMenu para autorizar o acesso.
              </p>
              <a
                href={view.loginHref}
                className="inline-flex w-full items-center justify-center bg-primary text-primary-foreground py-3.5 rounded-full text-base font-black hover:bg-white transition-all"
              >
                Ir para o login
              </a>
            </div>
          ) : view.k === 'error' ? (
            <div className="text-center">
              <h1 className="text-xl font-black text-white">Não foi possível autorizar</h1>
              <p className="text-sm text-red-400 mt-3 break-words">{view.message}</p>
            </div>
          ) : (
            <>
              <div className="text-center mb-6">
                <h1 className="text-xl font-black text-white">Autorizar acesso</h1>
                <p className="text-sm text-zinc-400 mt-2">
                  <span className="font-black text-white">{view.details.client.name || 'Um aplicativo'}</span> quer
                  acessar o XmartMenu como <span className="text-zinc-300">{view.email}</span>.
                </p>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-xs text-zinc-400 space-y-2 mb-6">
                <div className="flex justify-between gap-4">
                  <span className="font-bold uppercase tracking-widest text-zinc-500">Escopos</span>
                  <span className="text-right text-zinc-300 break-all">{view.details.scope || '—'}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="font-bold uppercase tracking-widest text-zinc-500">Redireciona para</span>
                  <span className="text-right text-zinc-300 break-all">{view.details.redirect_uri}</span>
                </div>
              </div>

              <p className="text-[11px] text-zinc-500 mb-5 leading-relaxed">
                O acesso à gestão da plataforma via MCP é permitido apenas para contas superadmin. Aprove somente se
                você reconhece este aplicativo.
              </p>

              <div className="flex gap-3">
                <button
                  onClick={() => decide(false)}
                  disabled={busy !== null}
                  className="flex-1 py-3.5 rounded-full text-sm font-black text-white bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-50 transition-all"
                >
                  {busy === 'deny' ? 'Negando…' : 'Negar'}
                </button>
                <button
                  onClick={() => decide(true)}
                  disabled={busy !== null}
                  className="flex-1 py-3.5 rounded-full text-sm font-black bg-primary text-primary-foreground hover:bg-white disabled:opacity-50 transition-all"
                >
                  {busy === 'approve' ? 'Autorizando…' : 'Autorizar'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
