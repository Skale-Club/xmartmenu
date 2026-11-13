'use client'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

type Details={ authorization_id:string; client:{ id:string; name:string }; redirect_uri:string; scope:string; user:{ id:string; full_name:string|null } }
export default function NativeConsentClient() {
  const id=useSearchParams().get('authorization_id') ?? ''
  const [details,setDetails]=useState<Details|null>(null),[error,setError]=useState(''),[login,setLogin]=useState(false),[busy,setBusy]=useState(false)
  useEffect(()=>{
    const controller=new AbortController()
    void(async()=>{
      try {
        const response=await fetch(`/oauth/details?authorization_id=${encodeURIComponent(id)}`,{ cache:'no-store',signal:controller.signal })
        if (response.status===401) { setLogin(true); return }
        const body=await response.json()
        if (!response.ok) { setError(body.error_description ?? 'Não foi possível carregar esta autorização. Reconecte o cliente MCP.'); return }
        setDetails(body)
      } catch { if (!controller.signal.aborted) setError('Não foi possível carregar esta autorização. Reconecte o cliente MCP.') }
    })()
    return()=>controller.abort()
  },[id])
  async function decide(approve:boolean) {
    if (busy || !details) return
    setBusy(true)
    try {
      const response=await fetch('/oauth/decision',{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify({ authorization_id:id,approve }),cache:'no-store' })
      const body=await response.json()
      if (!response.ok || typeof body.redirect_url!=='string') { setError(body.error_description ?? 'Autorização indisponível. Reconecte o cliente MCP.'); return }
      window.location.assign(body.redirect_url)
    } catch { setError('O resultado desta autorização é incerto. Reconecte o cliente MCP para iniciar uma nova solicitação.') }
    finally { setBusy(false) }
  }
  const back=`/oauth/consent?authorization_id=${encodeURIComponent(id)}`
  return <main className="min-h-screen flex items-center justify-center bg-zinc-950 px-4 text-white">
    <section className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900 p-8" aria-labelledby="consent-heading">
      <h1 id="consent-heading" className="text-xl font-bold">Autorizar acesso MCP</h1>
      {login ? <><p className="my-4 text-zinc-300">Entre na sua conta Xprout para continuar.</p><a href={`/auth/login?from=${encodeURIComponent(back)}`} className="inline-block rounded-full bg-primary px-5 py-3 text-primary-foreground">Entrar</a></>
        : error ? <p role="alert" className="mt-4 text-red-300">{error}</p>
          : !details ? <p className="mt-4 text-zinc-300" role="status">Carregando autorização…</p>
            : <><p className="mt-4"><strong>{details.client.name}</strong> solicita acesso como <strong>{details.user.full_name ?? details.user.id}</strong>.</p>
              <p className="mt-4 text-sm text-zinc-300">Este acesso permite gerenciar a plataforma e todos os restaurantes como superadmin, incluindo usuários, catálogo e assinaturas. Autorize somente um cliente que você reconhece.</p>
              <dl className="my-5 space-y-2 break-all text-sm"><dt className="font-bold">Escopo</dt><dd>{details.scope}</dd><dt className="font-bold">Retorno do cliente</dt><dd>{details.redirect_uri}</dd></dl>
              <p className="mb-5 text-xs text-zinc-400">O cliente poderá renovar este acesso por até 30 dias. Revogar acesso, alterar a versão da conta ou desabilitar a identidade invalida a autorização.</p>
              <div className="flex gap-3"><button type="button" disabled={busy} onClick={()=>void decide(false)} className="flex-1 rounded-full border border-white/20 px-4 py-3 disabled:opacity-50">Negar</button>
                <button type="button" disabled={busy} onClick={()=>void decide(true)} className="flex-1 rounded-full bg-primary px-4 py-3 text-primary-foreground disabled:opacity-50">{busy ? 'Processando…' : 'Autorizar'}</button></div></>}
    </section>
  </main>
}
