export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'

import { loadTenantBlogState } from './actions'
import TenantBlogClient from './TenantBlogClient'

/**
 * Blog do restaurante (autoblog-parity XM-14).
 *
 * O estado inicial é lido AQUI, no server component: a rota já é autenticada e
 * já espera o Supabase, então ler aqui não custa nada e o painel renderiza com
 * valores reais em vez de piscar vazio.
 *
 * `loadTenantBlogState` também é o gate: ele recusa quando o plano do
 * restaurante não carrega a capacidade `blog`, e aí a página redireciona em vez
 * de mostrar controles que nenhuma ação vai aceitar.
 */
export default async function TenantBlogPage() {
  const state = await loadTenantBlogState()
  if (!state.ok) redirect('/dashboard')

  return <TenantBlogClient initialState={state.data} />
}
