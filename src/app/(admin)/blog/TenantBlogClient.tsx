'use client'
/**
 * Painel do blog do restaurante (autoblog-parity XM-14).
 *
 * Escrito para um dono de restaurante, não para um operador de plataforma: sem
 * jargão de pipeline, sem ids na tela, e o que aparece em destaque é o que ele
 * decide — com que frequência publicar, a que horas, e se cada post espera
 * aprovação.
 *
 * Nenhum segredo passa por aqui: a chave da OpenRouter é write-only do ponto de
 * vista do browser, e o sentinela mascarado é o que distingue "não mexi neste
 * campo" de "quero apagar".
 */
import { useState, useTransition } from 'react'
import { AlertCircle, CheckCircle2, Clock, ExternalLink, Loader2, Rss, Trash2 } from 'lucide-react'

import {
  addTenantRssSource, approveTenantDraft, deleteTenantRssSource, fetchTenantRssNow,
  generateTenantPostNow, loadTenantBlogState, rejectTenantDraft, saveTenantBlogSettings,
  toggleTenantRssSource, type TenantBlogSettingsInput, type TenantBlogState,
} from './actions'

const MASKED = '********'

/** Os fusos em que os clientes deste produto realmente operam. */
const TIMEZONES = ['America/Sao_Paulo', 'America/Manaus', 'America/Fortaleza', 'America/Belem', 'UTC']

/** "Sem horário fixo" é uma escolha real: é o comportamento sem hora fixada, e
 *  o único caminho de volta depois que alguém escolhe uma. */
const DRIFTING = 'drifting'

interface Draft { id: string; title: string; excerpt: string | null; created_at: string }
interface Published { id: string; title: string; slug: string; published_at: string | null }
interface Job {
  id: string
  status: string
  source: string | null
  pillar_id: string | null
  topic: string | null
  error_message: string | null
  durations_ms: { total?: number } | null
  created_at: string
}
interface RssSource {
  id: string
  name: string
  url: string
  enabled: boolean
  last_fetched_at: string | null
  last_fetched_status: string | null
  error_message: string | null
}

function formFrom(settings: Record<string, unknown> | null): TenantBlogSettingsInput {
  const row = settings ?? {}
  return {
    enabled: Boolean(row.enabled),
    postsPerDay: Number(row.posts_per_day ?? 1),
    postingHour:
      row.posting_hour === null || row.posting_hour === undefined ? null : Number(row.posting_hour),
    timezone: String(row.timezone || 'America/Sao_Paulo'),
    seoKeywords: String(row.seo_keywords ?? ''),
    promptStyle: String(row.prompt_style ?? ''),
    systemPrompt: String(row.system_prompt ?? ''),
    enableTrendAnalysis: row.enable_trend_analysis === undefined ? true : Boolean(row.enable_trend_analysis),
    rssEnabled: Boolean(row.rss_enabled),
    autoPublish: Boolean(row.auto_publish),
    textModel: String(row.text_model ?? ''),
    imageModel: String(row.image_model ?? ''),
  }
}

const CARD = 'rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm'
const LABEL = 'block text-xs font-bold uppercase tracking-wider text-zinc-500'
const FIELD = 'mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-primary'
const BTN = 'inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-colors disabled:opacity-50'
const BTN_PRIMARY = `${BTN} bg-zinc-950 text-white hover:bg-zinc-800`
const BTN_GHOST = `${BTN} border border-zinc-200 text-zinc-700 hover:bg-zinc-50`

export default function TenantBlogClient({ initialState }: { initialState: TenantBlogState }) {
  const [state, setState] = useState(initialState)
  const [form, setForm] = useState(() => formFrom(initialState.settings))
  const [apiKey, setApiKey] = useState('')
  const [rssName, setRssName] = useState('')
  const [rssUrl, setRssUrl] = useState('')
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  async function refresh() {
    const result = await loadTenantBlogState()
    if (!result.ok) return
    setState(result.data)
    setForm(formFrom(result.data.settings))
  }

  /** Toda mutação passa por aqui, para nenhuma esquecer de reler. */
  function run(action: () => Promise<{ ok: boolean; message?: string }>, success: string, after?: () => void) {
    startTransition(async () => {
      setNotice(null)
      const result = await action()
      if (!result.ok) {
        setNotice({ kind: 'error', text: result.message ?? 'Algo deu errado' })
        return
      }
      setNotice({ kind: 'ok', text: success })
      after?.()
      await refresh()
    })
  }

  const drafts = state.drafts as unknown as Draft[]
  const published = state.published as unknown as Published[]
  const jobs = state.jobs as unknown as Job[]
  const sources = state.sources as unknown as RssSource[]

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-zinc-950">Blog</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Posts no site do seu restaurante, escritos pela IA a partir do seu cardápio e da sua região.
            É o que faz seu cardápio aparecer em buscas como “onde comer” no seu bairro.
          </p>
          <a
            href={state.publicPath}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-sm text-zinc-700 underline"
          >
            Ver o blog <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <button
          className={BTN_GHOST}
          disabled={pending}
          onClick={() => run(generateTenantPostNow, 'Geração iniciada')}
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Escrever um post agora
        </button>
      </div>

      {notice && (
        <div
          className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${
            notice.kind === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {notice.kind === 'ok' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>{notice.text}</span>
        </div>
      )}

      {/* ── Publicação ─────────────────────────────────────────────────── */}
      <section className={`${CARD} space-y-5`}>
        <h2 className="text-lg font-bold text-zinc-950">Publicação</h2>

        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="text-sm font-bold text-zinc-900">Publicar automaticamente</span>
            <span className="mt-0.5 block text-xs text-zinc-500">Escreve posts na frequência abaixo.</span>
          </span>
          <input type="checkbox" className="h-5 w-5 accent-zinc-950" checked={form.enabled}
            onChange={(e) => setForm((p) => ({ ...p, enabled: e.target.checked }))} />
        </label>

        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="text-sm font-bold text-zinc-900">Publicar sem eu revisar</span>
            <span className="mt-0.5 block text-xs text-zinc-500">
              Desligado: cada post espera sua aprovação aqui embaixo — e cada decisão sua ensina a IA.
            </span>
          </span>
          <input type="checkbox" className="h-5 w-5 accent-zinc-950" checked={form.autoPublish}
            onChange={(e) => setForm((p) => ({ ...p, autoPublish: e.target.checked }))} />
        </label>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className={LABEL} htmlFor="ppd">Posts por dia</label>
            <select id="ppd" className={FIELD} value={form.postsPerDay}
              onChange={(e) => setForm((p) => ({ ...p, postsPerDay: Number(e.target.value) }))}>
              {[0, 1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>{n === 0 ? 'Pausado' : `${n} / dia`}</option>
              ))}
            </select>
          </div>
          {/* Sem hora fixa, o agendamento só promete "pelo menos N horas desde a
              última vez", e o horário anda para frente a cada publicação até
              cair de madrugada. */}
          <div>
            <label className={LABEL} htmlFor="hour">Publicar às</label>
            <select id="hour" className={FIELD}
              value={form.postingHour === null ? DRIFTING : String(form.postingHour)}
              onChange={(e) =>
                setForm((p) => ({ ...p, postingHour: e.target.value === DRIFTING ? null : Number(e.target.value) }))
              }>
              <option value={DRIFTING}>Sem horário fixo</option>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL} htmlFor="tz">Fuso horário</label>
            <select id="tz" className={FIELD} value={form.timezone}
              onChange={(e) => setForm((p) => ({ ...p, timezone: e.target.value }))}>
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
        </div>

        {state.nextScheduledRunAt && (
          <p className="flex items-center gap-1 text-xs text-zinc-500">
            <Clock className="h-3 w-3" />
            Próximo post: {new Date(state.nextScheduledRunAt).toLocaleString('pt-BR')}
          </p>
        )}

        <div>
          <label className={LABEL} htmlFor="kw">Palavras que você quer ranquear</label>
          <input id="kw" className={FIELD} value={form.seoKeywords}
            placeholder="pizza no Butantã, rodízio em família, delivery de massa"
            onChange={(e) => setForm((p) => ({ ...p, seoKeywords: e.target.value }))} />
          <p className="mt-1 text-xs text-zinc-500">
            Separadas por vírgula. Pense no que um cliente digitaria no Google antes de escolher onde comer.
          </p>
        </div>

        <div>
          <label className={LABEL} htmlFor="style">Jeito de escrever</label>
          <textarea id="style" rows={3} className={FIELD} value={form.promptStyle}
            placeholder="Informal, direto, sem palavra difícil. Sempre convidar para experimentar."
            onChange={(e) => setForm((p) => ({ ...p, promptStyle: e.target.value }))} />
        </div>

        <div>
          <label className={LABEL} htmlFor="guide">O que a IA precisa saber sobre a casa</label>
          <textarea id="guide" rows={4} className={FIELD} value={form.systemPrompt}
            placeholder="Somos uma cantina de família desde 1998. A massa é feita na hora. Não trabalhamos com delivery aos domingos."
            onChange={(e) => setForm((p) => ({ ...p, systemPrompt: e.target.value }))} />
          <p className="mt-1 text-xs text-zinc-500">
            A IA já conhece seu cardápio e seu endereço. Use este campo para o que ela não tem como saber.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className={LABEL} htmlFor="tm">Modelo de texto</label>
            <input id="tm" className={FIELD} value={form.textModel}
              onChange={(e) => setForm((p) => ({ ...p, textModel: e.target.value }))} />
          </div>
          <div>
            <label className={LABEL} htmlFor="im">Modelo de imagem</label>
            <input id="im" className={FIELD} value={form.imageModel}
              onChange={(e) => setForm((p) => ({ ...p, imageModel: e.target.value }))} />
          </div>
          <div>
            <label className={LABEL} htmlFor="key">Chave OpenRouter</label>
            {/* Write-only daqui: a chave é criptografada em repouso e nunca volta. */}
            <input id="key" type="password" className={FIELD} value={apiKey}
              placeholder={state.hasOpenrouterKey ? '•••••••• (salva)' : 'sk-or-...'}
              onChange={(e) => setApiKey(e.target.value)} />
          </div>
        </div>

        <div className="flex justify-end">
          <button className={BTN_PRIMARY} disabled={pending}
            onClick={() => run(
              () => saveTenantBlogSettings({ ...form, openrouterApiKey: apiKey.trim() || MASKED }),
              'Configurações salvas',
              () => setApiKey(''),
            )}>
            Salvar
          </button>
        </div>
      </section>

      {/* ── Aprovação ──────────────────────────────────────────────────── */}
      <section className={`${CARD} space-y-4`}>
        <h2 className="text-lg font-bold text-zinc-950">
          Esperando você aprovar {drafts.length > 0 && <span className="text-zinc-400">({drafts.length})</span>}
        </h2>
        {drafts.length === 0 ? (
          <p className="text-sm text-zinc-500">Nada na fila.</p>
        ) : (
          <div className="space-y-2">
            {drafts.map((draft) => (
              <div key={draft.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-zinc-200 p-3">
                <div className="min-w-0">
                  <p className="truncate font-bold text-zinc-900">{draft.title}</p>
                  {draft.excerpt && <p className="line-clamp-2 text-sm text-zinc-500">{draft.excerpt}</p>}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button className={BTN_PRIMARY} disabled={pending}
                    onClick={() => run(() => approveTenantDraft(draft.id), 'Post publicado')}>
                    Publicar
                  </button>
                  <button className={BTN_GHOST} disabled={pending}
                    onClick={() => run(() => rejectTenantDraft(draft.id), 'Post descartado')}>
                    Descartar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── No ar ──────────────────────────────────────────────────────── */}
      {published.length > 0 && (
        <section className={`${CARD} space-y-3`}>
          <h2 className="text-lg font-bold text-zinc-950">No ar</h2>
          <ul className="space-y-2">
            {published.map((post) => (
              <li key={post.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <a href={`${state.publicPath}/${post.slug}`} target="_blank" rel="noreferrer"
                  className="truncate font-medium text-zinc-900 hover:underline">
                  {post.title}
                </a>
                <span className="text-xs text-zinc-400">
                  {post.published_at ? new Date(post.published_at).toLocaleDateString('pt-BR') : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Feeds ──────────────────────────────────────────────────────── */}
      <section className={`${CARD} space-y-4`}>
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-zinc-950">
            <Rss className="h-4 w-4" /> Feeds de notícias
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Opcional. Quando você liga isto, a IA pode tirar o assunto de um feed do setor — nada é copiado
            para o seu site, o item é só o ponto de partida de um texto seu.
          </p>
        </div>

        <label className="flex items-center justify-between gap-4">
          <span className="text-sm font-bold text-zinc-900">Usar os feeds como pauta</span>
          <input type="checkbox" className="h-5 w-5 accent-zinc-950" checked={form.rssEnabled}
            onChange={(e) => setForm((p) => ({ ...p, rssEnabled: e.target.checked }))} />
        </label>

        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[140px] flex-1">
            <label className={LABEL} htmlFor="rn">Nome</label>
            <input id="rn" className={FIELD} value={rssName} onChange={(e) => setRssName(e.target.value)} />
          </div>
          <div className="min-w-[220px] flex-[2]">
            <label className={LABEL} htmlFor="ru">Endereço do feed</label>
            <input id="ru" className={FIELD} value={rssUrl} placeholder="https://exemplo.com/feed.xml"
              onChange={(e) => setRssUrl(e.target.value)} />
          </div>
          <button className={BTN_PRIMARY} disabled={pending || !rssName.trim() || !rssUrl.trim()}
            onClick={() => run(
              () => addTenantRssSource({ name: rssName.trim(), url: rssUrl.trim() }),
              'Feed adicionado — busque agora para conferir que funciona',
              () => { setRssName(''); setRssUrl('') },
            )}>
            Adicionar
          </button>
        </div>

        {sources.length === 0 ? (
          <p className="text-sm text-zinc-500">Nenhum feed.</p>
        ) : (
          <div className="space-y-2">
            {sources.map((source) => (
              <div key={source.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-bold text-zinc-900">{source.name}</span>
                    {source.last_fetched_status === 'error' && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase text-red-700">Com falha</span>
                    )}
                  </div>
                  <p className="truncate text-xs text-zinc-500">{source.url}</p>
                  {/* Um feed com falha continua conectado de propósito — uma
                      instabilidade do publisher não pode cancelar a assinatura
                      sozinha — então o motivo precisa ficar visível. */}
                  {source.error_message && <p className="mt-1 text-xs text-red-600">{source.error_message}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <input type="checkbox" className="h-5 w-5 accent-zinc-950" checked={source.enabled} disabled={pending}
                    onChange={(e) => run(
                      () => toggleTenantRssSource(source.id, e.target.checked),
                      e.target.checked ? 'Feed ativado' : 'Feed pausado',
                    )} />
                  <button className="text-zinc-400 hover:text-red-600" disabled={pending}
                    aria-label={`Remover ${source.name}`}
                    onClick={() => run(() => deleteTenantRssSource(source.id), 'Feed removido')}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-3">
              <p className="text-sm text-zinc-500">{state.pendingItems} item(ns) na fila.</p>
              <button className={BTN_GHOST} disabled={pending}
                onClick={() => startTransition(async () => {
                  setNotice(null)
                  const result = await fetchTenantRssNow()
                  if (!result.ok) { setNotice({ kind: 'error', text: result.message }); return }
                  // Uma falha parcial é reportada como falha: "3 feeds
                  // verificados" com um morto é como um feed quebrado passa
                  // semanas despercebido.
                  setNotice(
                    result.data.errors.length > 0
                      ? { kind: 'error', text: `${result.data.errors.length} feed(s) falharam: ${result.data.errors.join(' · ')}` }
                      : { kind: 'ok', text: `${result.data.upserted} item(ns) de ${result.data.sources} feed(s).` },
                  )
                  await refresh()
                })}>
                Buscar agora
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── Histórico ──────────────────────────────────────────────────── */}
      {jobs.length > 0 && (
        <section className={`${CARD} space-y-3`}>
          <h2 className="text-lg font-bold text-zinc-950">Últimas tentativas</h2>
          <div className="space-y-2">
            {jobs.map((job) => (
              <div key={job.id} className="space-y-1 rounded-xl border border-zinc-200 p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={`rounded-full px-2 py-0.5 font-bold uppercase ${
                    job.status === 'failed' ? 'bg-red-100 text-red-700'
                      : job.status === 'completed' ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-zinc-100 text-zinc-600'
                  }`}>{job.status === 'completed' ? 'ok' : job.status}</span>
                  <span className="text-zinc-400">{new Date(job.created_at).toLocaleString('pt-BR')}</span>
                  {job.durations_ms?.total ? (
                    <span className="text-zinc-400">{(job.durations_ms.total / 1000).toFixed(1)}s</span>
                  ) : null}
                </div>
                {job.topic && <p className="truncate text-sm text-zinc-700">{job.topic}</p>}
                {job.error_message && <p className="text-xs text-red-600">{job.error_message}</p>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
