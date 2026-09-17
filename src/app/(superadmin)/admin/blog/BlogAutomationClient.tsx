'use client'
/**
 * Auto-blog console (autoblog-parity XM-09).
 *
 * Every endpoint behind this page already existed and had no caller: the
 * platform blog could only be configured by editing rows in Supabase, which is
 * not a feature anyone can use.
 *
 * No secret is ever held here. The OpenRouter key and both bot tokens are
 * write-only from the browser's point of view — the page is told only whether
 * one is stored, and sends the masked sentinel to mean "leave it alone".
 */
import { useState, useTransition } from 'react'
import {
  AlertCircle, CheckCircle2, Clock, Loader2, Play, RefreshCw, Rss, Send, Trash2,
} from 'lucide-react'

/** Matches the server: "keep the stored value", as opposed to clearing it. */
const MASKED = '********'

// Where this platform's audience actually is. A 400-entry IANA list is not a
// control anyone uses, and an unknown zone degrades to UTC server-side anyway.
const TIMEZONES = ['America/Sao_Paulo', 'America/Manaus', 'America/Fortaleza', 'Europe/Lisbon', 'UTC']

/** "No fixed time" has to stay selectable: it is the behaviour with no hour
 *  pinned, and the only way back once one is set. */
const DRIFTING = 'drifting'

interface RssSource {
  id: string
  name: string
  url: string
  enabled: boolean
  last_fetched_at: string | null
  last_fetched_status: string | null
  error_message: string | null
}

interface Job {
  id: string
  status: string
  source: string | null
  pillar_id: string | null
  topic: string | null
  error_message: string | null
  durations_ms: { topic?: number; content?: number; image?: number | null; upload?: number; total?: number } | null
  created_at: string
}

interface Draft {
  id: string
  title: string
  excerpt: string | null
  created_at: string
}

export interface BlogAutomationState {
  settings: Record<string, unknown> | null
  hasOpenrouterKey: boolean
  nextScheduledRunAt: string | null
  drafts: Draft[]
  jobs: Job[]
  sources: RssSource[]
  pendingItems: number
  telegram: {
    enabled: boolean
    approvalsEnabled: boolean
    hasBotToken: boolean
    hasApprovalsBotToken: boolean
    chatIds: string[]
    approvalsChatIds: string[]
  }
}

interface SettingsForm {
  enabled: boolean
  postsPerDay: number
  postingHour: number | null
  timezone: string
  seoKeywords: string
  promptStyle: string
  systemPrompt: string
  enableTrendAnalysis: boolean
  rssEnabled: boolean
  autoPublish: boolean
  textModel: string
  imageModel: string
}

function formFrom(settings: Record<string, unknown> | null): SettingsForm {
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

/** Stage timings read as seconds — milliseconds are precision nobody acts on. */
function duration(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined) return null
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

const CARD = 'rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm'
const LABEL = 'block text-xs font-bold uppercase tracking-wider text-zinc-500'
const FIELD = 'mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-primary'
const BTN = 'inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-colors disabled:opacity-50'
const BTN_PRIMARY = `${BTN} bg-zinc-950 text-white hover:bg-zinc-800`
const BTN_GHOST = `${BTN} border border-zinc-200 text-zinc-700 hover:bg-zinc-50`

export default function BlogAutomationClient({ initialState }: { initialState: BlogAutomationState }) {
  const [state, setState] = useState(initialState)
  const [form, setForm] = useState<SettingsForm>(() => formFrom(initialState.settings))
  const [apiKey, setApiKey] = useState('')
  const [rssName, setRssName] = useState('')
  const [rssUrl, setRssUrl] = useState('')
  const [chatIdsText, setChatIdsText] = useState(() => initialState.telegram.chatIds.join('\n'))
  const [approvalChatsText, setApprovalChatsText] = useState(() => initialState.telegram.approvalsChatIds.join('\n'))
  const [botToken, setBotToken] = useState('')
  const [approvalsBotToken, setApprovalsBotToken] = useState('')
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  /** Re-read everything the page shows, so no mutation can leave it stale. */
  async function refresh() {
    const [settingsRes, postsRes, rssRes, tgRes] = await Promise.all([
      fetch('/api/superadmin/blog/settings').then((r) => r.json()),
      fetch('/api/superadmin/blog/posts').then((r) => r.json()),
      fetch('/api/superadmin/blog/rss').then((r) => r.json()),
      fetch('/api/superadmin/blog/telegram').then((r) => r.json()),
    ])
    const tg = tgRes.settings ?? {}
    setState((prev) => ({
      ...prev,
      settings: settingsRes.settings ?? null,
      hasOpenrouterKey: Boolean(settingsRes.settings?.has_openrouter_key),
      nextScheduledRunAt: settingsRes.nextScheduledRunAt ?? null,
      drafts: postsRes.drafts ?? [],
      jobs: postsRes.jobs ?? [],
      sources: rssRes.sources ?? [],
      pendingItems: (rssRes.items ?? []).filter((i: { status: string }) => i.status === 'pending').length,
      telegram: {
        enabled: Boolean(tg.enabled),
        approvalsEnabled: Boolean(tg.approvals_enabled),
        hasBotToken: Boolean(tg.has_bot_token),
        hasApprovalsBotToken: Boolean(tg.has_approvals_bot_token),
        chatIds: tg.chat_ids ?? [],
        approvalsChatIds: tg.approvals_chat_ids ?? [],
      },
    }))
    if (settingsRes.settings) setForm(formFrom(settingsRes.settings))
  }

  /** Every mutation funnels through here so none can forget to re-read. */
  function call(url: string, init: RequestInit, success: string, after?: () => void) {
    startTransition(async () => {
      setNotice(null)
      try {
        const res = await fetch(url, {
          ...init,
          headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          setNotice({ kind: 'error', text: body.error ?? `Request failed (${res.status})` })
          return
        }
        setNotice({ kind: 'ok', text: success })
        after?.()
        await refresh()
      } catch (err) {
        setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Request failed' })
      }
    })
  }

  const parseIds = (text: string) => text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)

  function saveTelegram(overrides: Partial<{ enabled: boolean; approvalsEnabled: boolean }>) {
    call(
      '/api/superadmin/blog/telegram',
      {
        method: 'PATCH',
        body: JSON.stringify({
          enabled: overrides.enabled ?? state.telegram.enabled,
          approvalsEnabled: overrides.approvalsEnabled ?? state.telegram.approvalsEnabled,
          // An untouched field must not clear a stored token, and an empty one
          // must: the sentinel is what tells those two apart.
          botToken: botToken.trim() || MASKED,
          approvalsBotToken: approvalsBotToken.trim() || MASKED,
          chatIds: parseIds(chatIdsText),
          approvalsChatIds: parseIds(approvalChatsText),
        }),
      },
      'Telegram salvo',
      () => {
        setBotToken('')
        setApprovalsBotToken('')
      },
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-zinc-950">Blog automático</h1>
          <p className="mt-1 text-sm text-zinc-500">
            O blog da plataforma — xmartmenu.com/blog. Não é o blog de nenhum cliente.
          </p>
        </div>
        <button
          className={BTN_GHOST}
          disabled={pending}
          onClick={() => call('/api/superadmin/blog/generate', { method: 'POST' }, 'Geração iniciada')}
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          Gerar agora
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

      {/* ── Schedule + voice ──────────────────────────────────────────── */}
      <section className={`${CARD} space-y-5`}>
        <h2 className="text-lg font-bold text-zinc-950">Publicação</h2>

        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="text-sm font-bold text-zinc-900">Publicação automática</span>
            <span className="mt-0.5 block text-xs text-zinc-500">Gera posts na frequência abaixo.</span>
          </span>
          <input type="checkbox" className="h-5 w-5 accent-zinc-950" checked={form.enabled}
            onChange={(e) => setForm((p) => ({ ...p, enabled: e.target.checked }))} />
        </label>

        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="text-sm font-bold text-zinc-900">Publicar sem revisão</span>
            <span className="mt-0.5 block text-xs text-zinc-500">
              Desligado: cada post espera aprovação abaixo, e cada decisão ensina o gerador.
            </span>
          </span>
          <input type="checkbox" className="h-5 w-5 accent-zinc-950" checked={form.autoPublish}
            onChange={(e) => setForm((p) => ({ ...p, autoPublish: e.target.checked }))} />
        </label>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className={LABEL} htmlFor="posts-per-day">Posts por dia</label>
            <select id="posts-per-day" className={FIELD} value={form.postsPerDay}
              onChange={(e) => setForm((p) => ({ ...p, postsPerDay: Number(e.target.value) }))}>
              {[0, 1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>{n === 0 ? 'Pausado' : `${n} / dia`}</option>
              ))}
            </select>
          </div>

          {/* Sem hora fixa o agendamento só promete "pelo menos N horas desde a
              última run", então o horário de publicação anda para frente a cada
              run até cair no meio da madrugada. */}
          <div>
            <label className={LABEL} htmlFor="posting-hour">Publicar às</label>
            <select id="posting-hour" className={FIELD}
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
            <label className={LABEL} htmlFor="timezone">Fuso horário</label>
            <select id="timezone" className={FIELD} value={form.timezone}
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
          <label className={LABEL} htmlFor="seo">Palavras-chave</label>
          <input id="seo" className={FIELD} value={form.seoKeywords}
            placeholder="cardápio digital, delivery próprio, ficha técnica"
            onChange={(e) => setForm((p) => ({ ...p, seoKeywords: e.target.value }))} />
        </div>

        <div>
          <label className={LABEL} htmlFor="style">Tom e estilo</label>
          <textarea id="style" rows={3} className={FIELD} value={form.promptStyle}
            onChange={(e) => setForm((p) => ({ ...p, promptStyle: e.target.value }))} />
        </div>

        <div>
          <label className={LABEL} htmlFor="system">Guia editorial</label>
          <textarea id="system" rows={4} className={FIELD} value={form.systemPrompt}
            onChange={(e) => setForm((p) => ({ ...p, systemPrompt: e.target.value }))} />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className={LABEL} htmlFor="text-model">Modelo de texto</label>
            <input id="text-model" className={FIELD} value={form.textModel}
              onChange={(e) => setForm((p) => ({ ...p, textModel: e.target.value }))} />
          </div>
          <div>
            <label className={LABEL} htmlFor="image-model">Modelo de imagem</label>
            <input id="image-model" className={FIELD} value={form.imageModel}
              onChange={(e) => setForm((p) => ({ ...p, imageModel: e.target.value }))} />
          </div>
          <div>
            <label className={LABEL} htmlFor="api-key">Chave OpenRouter</label>
            {/* Write-only from here: the key is encrypted at rest and never sent
                back, so the field shows whether one exists and nothing more. */}
            <input id="api-key" type="password" className={FIELD} value={apiKey}
              placeholder={state.hasOpenrouterKey ? '•••••••• (salva)' : 'sk-or-...'}
              onChange={(e) => setApiKey(e.target.value)} />
          </div>
        </div>

        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="text-sm font-bold text-zinc-900">Escrever a partir dos feeds</span>
            <span className="mt-0.5 block text-xs text-zinc-500">
              Usa o assunto de um feed quando houver algo relevante na fila. Sem isso, a pauta editorial continua normalmente.
            </span>
          </span>
          <input type="checkbox" className="h-5 w-5 accent-zinc-950" checked={form.rssEnabled}
            onChange={(e) => setForm((p) => ({ ...p, rssEnabled: e.target.checked }))} />
        </label>

        <div className="flex justify-end">
          <button className={BTN_PRIMARY} disabled={pending}
            onClick={() =>
              call(
                '/api/superadmin/blog/settings',
                {
                  method: 'PATCH',
                  body: JSON.stringify({ ...form, openrouterApiKey: apiKey.trim() || MASKED }),
                },
                'Configurações salvas',
                () => setApiKey(''),
              )
            }>
            Salvar
          </button>
        </div>
      </section>

      {/* ── Approval queue ────────────────────────────────────────────── */}
      <section className={`${CARD} space-y-4`}>
        <h2 className="text-lg font-bold text-zinc-950">
          Aguardando aprovação {state.drafts.length > 0 && <span className="text-zinc-400">({state.drafts.length})</span>}
        </h2>
        {state.drafts.length === 0 ? (
          <p className="text-sm text-zinc-500">Nada na fila.</p>
        ) : (
          <div className="space-y-2">
            {state.drafts.map((draft) => (
              <div key={draft.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-zinc-200 p-3">
                <div className="min-w-0">
                  <p className="truncate font-bold text-zinc-900">{draft.title}</p>
                  {draft.excerpt && <p className="line-clamp-2 text-sm text-zinc-500">{draft.excerpt}</p>}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button className={BTN_PRIMARY} disabled={pending}
                    onClick={() => call('/api/superadmin/blog/posts', {
                      method: 'POST',
                      body: JSON.stringify({ postId: draft.id, action: 'approve' }),
                    }, 'Post publicado')}>
                    Aprovar
                  </button>
                  <button className={BTN_GHOST} disabled={pending}
                    onClick={() => call('/api/superadmin/blog/posts', {
                      method: 'POST',
                      body: JSON.stringify({ postId: draft.id, action: 'reject' }),
                    }, 'Post rejeitado')}>
                    Rejeitar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── RSS ───────────────────────────────────────────────────────── */}
      <section className={`${CARD} space-y-4`}>
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-zinc-950">
            <Rss className="h-4 w-4" /> Feeds de notícias
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Feeds do setor de onde o gerador pode tirar o assunto. Nada daqui é copiado para o site — um item do feed é
            só o ponto de partida de um post original.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[140px] flex-1">
            <label className={LABEL} htmlFor="rss-name">Nome</label>
            <input id="rss-name" className={FIELD} value={rssName} onChange={(e) => setRssName(e.target.value)} />
          </div>
          <div className="min-w-[220px] flex-[2]">
            <label className={LABEL} htmlFor="rss-url">URL do feed</label>
            <input id="rss-url" className={FIELD} value={rssUrl} placeholder="https://exemplo.com/feed.xml"
              onChange={(e) => setRssUrl(e.target.value)} />
          </div>
          <button className={BTN_PRIMARY} disabled={pending || !rssName.trim() || !rssUrl.trim()}
            onClick={() => call('/api/superadmin/blog/rss', {
              method: 'POST',
              body: JSON.stringify({ action: 'add', name: rssName.trim(), url: rssUrl.trim() }),
            }, 'Feed adicionado — busque agora para conferir que funciona', () => {
              setRssName('')
              setRssUrl('')
            })}>
            Adicionar
          </button>
        </div>

        {state.sources.length === 0 ? (
          <p className="text-sm text-zinc-500">Nenhum feed ainda.</p>
        ) : (
          <div className="space-y-2">
            {state.sources.map((source) => (
              <div key={source.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-bold text-zinc-900">{source.name}</span>
                    {source.last_fetched_status === 'error' && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase text-red-700">Com falha</span>
                    )}
                    {source.last_fetched_status === 'ok' && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700">OK</span>
                    )}
                  </div>
                  <p className="truncate text-xs text-zinc-500">{source.url}</p>
                  {/* Um feed com falha continua conectado de propósito — uma hora
                      de instabilidade do publisher não pode cancelar a assinatura
                      sozinha — então o motivo precisa ficar visível. */}
                  {source.error_message && <p className="mt-1 text-xs text-red-600">{source.error_message}</p>}
                  {source.last_fetched_at && (
                    <p className="text-xs text-zinc-400">
                      Última verificação: {new Date(source.last_fetched_at).toLocaleString('pt-BR')}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <input type="checkbox" className="h-5 w-5 accent-zinc-950" checked={source.enabled} disabled={pending}
                    onChange={(e) => call('/api/superadmin/blog/rss', {
                      method: 'POST',
                      body: JSON.stringify({ action: 'toggle', id: source.id, enabled: e.target.checked }),
                    }, e.target.checked ? 'Feed ativado' : 'Feed pausado')} />
                  <button className="text-zinc-400 hover:text-red-600" disabled={pending} aria-label={`Remover ${source.name}`}
                    onClick={() => call('/api/superadmin/blog/rss', {
                      method: 'POST',
                      body: JSON.stringify({ action: 'delete', id: source.id }),
                    }, 'Feed removido')}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {state.sources.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-3">
            <p className="text-sm text-zinc-500">{state.pendingItems} item(ns) aguardando uso.</p>
            <button className={BTN_GHOST} disabled={pending}
              onClick={() => startTransition(async () => {
                setNotice(null)
                const res = await fetch('/api/superadmin/blog/rss', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'fetch' }),
                })
                const summary = await res.json().catch(() => ({}))
                // Uma falha parcial é reportada como falha: "3 feeds verificados"
                // com um deles morto é exatamente como um feed quebrado passa
                // semanas despercebido.
                if (summary.errors?.length > 0) {
                  setNotice({
                    kind: 'error',
                    text: `${summary.errors.length} feed(s) falharam: ${summary.errors
                      .map((e: { sourceName: string; message: string }) => `${e.sourceName}: ${e.message}`)
                      .join(' · ')}`,
                  })
                } else {
                  setNotice({
                    kind: 'ok',
                    text: `${summary.itemsUpserted ?? 0} item(ns) de ${summary.sourcesProcessed ?? 0} feed(s).`,
                  })
                }
                await refresh()
              })}>
              <RefreshCw className="h-4 w-4" /> Buscar agora
            </button>
          </div>
        )}
      </section>

      {/* ── Telegram ──────────────────────────────────────────────────── */}
      <section className={`${CARD} space-y-4`}>
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-zinc-950">
            <Send className="h-4 w-4" /> Aprovar pelo Telegram
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Manda cada rascunho para um chat do Telegram com botões de aprovar e rejeitar. Funciona em grupo e em um
            tópico específico de um grupo.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL} htmlFor="tg-token">Token do bot de alertas</label>
            <input id="tg-token" type="password" className={FIELD} value={botToken}
              placeholder={state.telegram.hasBotToken ? '•••••••• (salvo)' : '123456:ABC-DEF...'}
              onChange={(e) => setBotToken(e.target.value)} />
          </div>
          <div>
            <label className={LABEL} htmlFor="tg-approvals-token">Token do bot de aprovações</label>
            <input id="tg-approvals-token" type="password" className={FIELD} value={approvalsBotToken}
              placeholder={state.telegram.hasApprovalsBotToken ? '•••••••• (salvo)' : 'Vazio usa o bot de alertas'}
              onChange={(e) => setApprovalsBotToken(e.target.value)} />
            <p className="mt-1 text-xs text-zinc-500">
              Um bot separado é recomendado: é ele que fica exposto num webhook público, então pode ser revogado sem
              derrubar os alertas.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL} htmlFor="tg-chats">Chats de alerta</label>
            <textarea id="tg-chats" rows={3} className={FIELD} value={chatIdsText}
              placeholder="-1001234567890" onChange={(e) => setChatIdsText(e.target.value)} />
          </div>
          <div>
            <label className={LABEL} htmlFor="tg-approval-chats">Chats de aprovação</label>
            <textarea id="tg-approval-chats" rows={3} className={FIELD} value={approvalChatsText}
              placeholder="-1001234567890:42" onChange={(e) => setApprovalChatsText(e.target.value)} />
            <p className="mt-1 text-xs text-zinc-500">
              Um por linha. Use “:42” para postar num tópico do grupo. Vazio reaproveita os chats de alerta.
            </p>
          </div>
        </div>

        <label className="flex items-center justify-between gap-4">
          <span className="text-sm font-bold text-zinc-900">Notificações do Telegram</span>
          <input type="checkbox" className="h-5 w-5 accent-zinc-950" checked={state.telegram.enabled} disabled={pending}
            onChange={(e) => saveTelegram({ enabled: e.target.checked })} />
        </label>

        <label className="flex items-center justify-between gap-4">
          <span className="text-sm font-bold text-zinc-900">Mandar rascunhos para aprovação</span>
          <input type="checkbox" className="h-5 w-5 accent-zinc-950" checked={state.telegram.approvalsEnabled} disabled={pending}
            onChange={(e) => saveTelegram({ approvalsEnabled: e.target.checked })} />
        </label>

        <div className="flex justify-end">
          <button className={BTN_PRIMARY} disabled={pending} onClick={() => saveTelegram({})}>
            Salvar Telegram
          </button>
        </div>
      </section>

      {/* ── History ───────────────────────────────────────────────────── */}
      <section className={`${CARD} space-y-4`}>
        <div>
          <h2 className="text-lg font-bold text-zinc-950">Histórico de geração</h2>
          <p className="mt-1 text-sm text-zinc-500">O que rodou, quanto levou cada etapa e o que falhou.</p>
        </div>
        {state.jobs.length === 0 ? (
          <p className="text-sm text-zinc-500">Nenhuma geração ainda.</p>
        ) : (
          <div className="space-y-2">
            {state.jobs.map((job) => {
              const d = job.durations_ms
              const stages = d
                ? ([['topic', d.topic], ['content', d.content], ['image', d.image], ['upload', d.upload]] as const)
                    .map(([name, value]) => [name, duration(value)] as const)
                    .filter(([, value]) => value !== null)
                : []
              return (
                <div key={job.id} className="space-y-1 rounded-xl border border-zinc-200 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className={`rounded-full px-2 py-0.5 font-bold uppercase ${
                      job.status === 'failed' ? 'bg-red-100 text-red-700'
                        : job.status === 'completed' ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-zinc-100 text-zinc-600'
                    }`}>{job.status}</span>
                    {job.source && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600">{job.source}</span>}
                    {job.pillar_id && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600">{job.pillar_id}</span>}
                    <span className="text-zinc-400">{new Date(job.created_at).toLocaleString('pt-BR')}</span>
                  </div>
                  {job.topic && <p className="truncate text-sm text-zinc-700">{job.topic}</p>}
                  {job.error_message && <p className="text-xs text-red-600">{job.error_message}</p>}
                  {stages.length > 0 && (
                    <p className="text-xs text-zinc-500">
                      {stages.map(([name, value]) => `${name} ${value}`).join(' · ')}
                      {d?.total ? ` · total ${duration(d.total)}` : ''}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
