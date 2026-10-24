---
initiative: autoblog-parity
repo: xmartmenu
phase: P5
role: builds the whole system from zero
status: planned
---

# Auto-Blog Parity — Xmartmenu

Read [`MASTER.md`](./MASTER.md) first.

Xmartmenu has **no blog at all** — `blog` appears only in
`src/lib/marketing/reserved-paths.ts` as a reserved slug. This is the largest build of the
initiative: public blog, admin, super-admin gate, generator, scheduler and Telegram, all new.

It is also the repo with the **least** scheduling infrastructure: no `node-cron`, no Inngest,
no Vercel cron. Scheduling comes entirely from the org's `skale-cron` crontab hitting an HTTP
endpoint (MASTER D-07). No new infrastructure is needed.

Multi-tenant: every table carries `tenant_id`, the super-admin gate applies, and generation
runs on the **tenant's own** OpenRouter key (MASTER D-05).


## XM-00 — Decision gate: ANSWERED, DEPOIS REVERTIDO (2026-09-17)

**Primeira resposta:** o blog era só o da Xmartmenu. Os restaurantes não teriam
blog nenhum — o leitor era o dono do restaurante a quem vendemos, não o cliente
dele. Isso encolhia a fase: sem tenancy, sem chave de IA por tenant, sem gate de
plano, sem rota `/[slug]/blog`.

**Resposta atual:** os restaurantes TÊM blog. O argumento que mudou a decisão é
de SEO: um menu que consegue ranquear localmente vale mais do que um que não
consegue, e o blog é a peça que o permite. Um restaurante que escreva sobre o
bairro, sobre um prato, sobre uma data, entra em pesquisas onde um menu sozinho
nunca entraria — e a plataforma passa a vender isso.

O blog da plataforma **não muda**: continua em `/blog`, editado no superadmin.
O dos restaurantes vive ao lado, em `/[slug]/blog`, gated pelo plano. As duas
audiências não se tocam — os pilares editoriais de um falam de margem e de
operação a um dono de restaurante; os do outro falam de pratos e de bairro a
quem vai jantar.

O trabalho está em **XM-14**, abaixo. (Os primeiros commits desse trabalho, e
esta tabela antes desta revisão, chamavam-lhe XM-11, que já era do Telegram; o
código foi renumerado, o histórico de commits não.)

## Tasks

| id | task | status |
|---|---|---|
| ~~XM-01~~ | ~~`src/lib/blog/contract.ts`~~ | **DONE** (P0) |
| ~~XM-02~~ | ~~Schema + RLS~~ | **DONE, depois REESCRITA por XM-14** — `058_platform_blog.sql`. As oito tabelas levam `tenant_id` nullable (NULL = plataforma); `blog_settings` e `telegram_settings` deixaram de ser singletons com `id INTEGER DEFAULT 1` e passaram a UUID, uma linha por escopo, com índices únicos **parciais** (os NULLs são distintos num índice único, portanto `UNIQUE (tenant_id, slug)` não garantiria nada às linhas da plataforma). RLS ligada em todas, sem política exceto `blog_posts`, que mantém a leitura pública dos publicados porque é para isso que existe. A migração nunca chegou a produção antes da reescrita, portanto é um ficheiro só, não duas |
| ~~XM-03~~ | ~~Public routes~~ | **DONE** — `/blog` and `/blog/[slug]` under `(marketing)`, plus sitemap entries in their own try/catch so a blog read failing cannot cost the tenant entries. `blog` was already a reserved slug, so no tenant can shadow it |
| ~~XM-04~~ | ~~`prompt.ts` + `schedule.ts`~~ | **DONE** — schedule byte-identical; the 8 pillars are this blog's own (menu engineering, margin, delivery vs marketplace, operations, photos and copy, …), written in pt-BR for a Brazilian restaurant owner |
| **XM-05** | Generator | **DONE** — imagens incluídas (`src/lib/blog/cover-image.ts`: 16:9 + WebP + upload em `_platform/blog/`, best-effort para que um modelo de imagem ocupado nunca custe um post; as páginas públicas e o card de OG passaram a exibi-las) — pillar/RSS topic → content → link whitelist → tag allowlist → 600–4000 bounds → draft or publish → job row with stage timings → cost logged. The AI key lives on `blog_settings`, **encrypted at rest**, because this repo has no platform-wide credential. **No cover generation yet** |
| ~~XM-06~~ | ~~RSS + validator + retry~~ | **DONE** — `rss.ts` (fetcher + ranker), `content-validator.ts`, `ai-retry.ts`. RSS optional: an empty or off-topic feed falls back to the pillar rotation |
| **XM-07** | Scheduling | **DONE in code** — `POST /api/internal/blog/cron/generate` and `/fetch-rss` behind `CRON_SECRET`. This repo has NO in-process scheduler, so this is the only path, not a break-glass twin. **Still to do — OPS, not code: register both in the `skale-cron` crontab and set `CRON_SECRET` in Coolify.** Until that happens this repo's blog never generates on its own; the superadmin console's "Gerar agora" works regardless. |
| ~~XM-08~~ | ~~DB lock~~ | **DONE** — one conditional UPDATE on `lock_acquired_at`, stale after 10 min. Necessary here: the pull-always Coolify deploy can briefly overlap two instances |
| **XM-09** | Superadmin surface | — | **DONE** — `/blog` in the superadmin console: schedule (posting hour + timezone + the server-computed next run), voice/models, the encrypted OpenRouter key as a write-only field, approval queue, RSS feeds with fetch-now and per-feed errors, Telegram (separate alert vs approval bots and chats, forum topics), and generation history with per-stage timings. Initial state is read by the SERVER page — the encrypted key is destructured out there, so it never reaches the RSC payload. A `toggle` action was added to the RSS route so pausing a feed does not mean deleting and re-adding it. |
| ~~XM-10~~ | ~~Tests~~ | **DONE** — 47 tests in `tests/unit/blog/`. This repo had no test runner at all; it gains a deliberately narrow vitest config rather than shipping these modules unguarded |
| ~~XM-11~~ | ~~Telegram approvals~~ | **DONE except setWebhook** — separate approvals bot, group + forum-topic delivery, fan-out surviving one bad destination, chat-id validation at save, encrypted tokens, webhook authenticated by the shared secret. **The secret must be registered with Telegram manually** |
| ~~XM-12~~ | ~~Plan gating~~ | **DONE por XM-14** — era "não aplicável" enquanto o blog fosse só da plataforma. Com o blog por restaurante passou a ser o contrário: `plan.features.includes('blog')` decide se o item aparece no menu do admin, se as ações do painel respondem, e se as rotas públicas `/[slug]/blog` existem ou dão 404. Os três, não só o menu — esconder o link deixaria as rotas abertas |
| **XM-14** | **Blog por restaurante (tenant)** | **DONE** — reversão do XM-00. `tenant_id` nas 8 tabelas + `src/lib/blog/scope.ts` (`scopeFilter`/`scopeColumn`, e `scope === null` resolve para `.is('tenant_id', null)`, porque no PostgREST um `.eq` com NULL não corresponde a nada e um filtro esquecido devolve as linhas de toda a gente). `TENANT_BLOG_PILLARS`: 8 pilares virados para quem vai jantar, alguns condicionados a haver menu ou morada. `loadTenantBlogContext` fundamenta o prompt no menu, no bairro e nos canais reais do restaurante, e devolve null para tenant inativo. Rotas públicas `/[slug]/blog` e `/[slug]/blog/[postSlug]`, gated por `plan.features.includes('blog')`. Painel em pt-BR no admin do restaurante; o escopo vem sempre da SESSÃO, nunca do corpo do pedido. `runBlogSweep` varre todos os escopos numa chamada, com a falha de um isolada, portanto a entrada do crontab nunca muda à medida que entram restaurantes. O console superadmin foi escopado à plataforma — sem isso passaria a mostrar (e a aprovar) os rascunhos de todos os restaurantes |
| **XM-16** | **Telegram para o blog do restaurante** | **DONE** — o dono recebe o rascunho no Telegram dele e decide ali: Aprovar publica no site dele, Rejeitar apaga e guarda o sinal. UM endpoint serve a plataforma e todos os restaurantes, porque **o segredo é o escopo**: o webhook procura a linha de `telegram_settings` pelo segredo recebido, e é essa linha que diz de quem é o toque (índice único parcial na 059 garante que a pergunta tem uma só resposta). Três barreiras: o segredo, o chat de origem ter de estar na lista para onde o cartão foi enviado, e o escopo a filtrar a procura do post — o id vem do `callback_data`, que é de quem toca no botão. `answerCallbackQuery` fecha o toque (sem ele o botão roda para sempre) e fala pt-BR ao restaurante, inglês à plataforma. O `setWebhook` passa a acontecer ao gravar, nas duas pontas, o que fecha de caminho a lacuna antiga do XM-11 ("o segredo tem de ser registado manualmente") — um incómodo para a equipa, o fim da funcionalidade para um dono de pizzaria |
| **XM-17** | **Conflito de rotas /blog** | **DONE** — `(marketing)/blog`, `(superadmin)/blog` e `(admin)/blog` resolviam os três para `/blog`, e o `next build` recusava-se a construir. Os grupos de rotas do Next não entram no URL: o espaço de caminhos é um só e partilhado. Fica `/blog` para o blog público da plataforma (é o URL de SEO, não se mexe), `/admin/blog` para o console superadmin, `/posts` para o painel do restaurante, e `posts` entra em `RESERVED_PATHS` para nenhum restaurante ser engolido pela rota estática. Nem o typecheck nem os testes constroem rotas — só o build via isto |
| **XM-15** | **Runner de migrações** | **DONE** — `npm run db:migrate`, registo em `supabase_migrations.schema_migrations` (a mesma tabela do Supabase CLI), simulação por omissão, cada ficheiro numa transação com o seu registo, `--baseline` para bases de dados anteriores ao registo, e deteção de versões duplicadas (este repo tem dois pares). Correr a 058 contra um Postgres real foi o que apanhou o bug de RLS descrito em XM-14 |

## Still open

- **Cover images.** Posts publish without one; `durations_ms.image` is null.
- **`setWebhook` on save + a reconcile job.** Without them a revoked token or a
  domain change leaves the Approve/Reject buttons dead with no signal in the
  product: sending still works, only the taps go nowhere.
- **The superadmin React panel.** Every endpoint exists; nothing renders them.
- **Crontab + `CRON_SECRET`.** Nothing runs on a schedule until both are set.

## Guardrails specific to this repo

- **Tenant isolation.** Every new query is tenant-scoped through the existing
  `get-effective-tenant` / RLS path. A blog post must never be readable across tenants, and
  the public route must resolve the tenant from the slug, not from a session.
- **Encrypted credentials.** This repo already encrypts the chat-addon OpenRouter key at
  rest. The blog key uses the same `src/lib/crypto.ts` — do not introduce a plaintext column
  to match what the older repos currently do; they are the ones migrating to this standard
  (MASTER D-06).
- **Deploy** is a prebuilt GHCR image pulled by Coolify via `docker-compose.yaml`. New env
  vars (`CRON_SECRET`, `BLOG_AI_TIMEOUT_MS`, `PUBLIC_ORIGIN`) are set in the Coolify app
  configuration, not in the compose file.
- **Reserved paths.** `blog` is currently reserved as a tenant slug — keep that reservation
  and make sure the new route does not collide with it.

## Order of work

1. XM-00 (gate — do not start without an answer)
2. XM-01, XM-02 (contract + schema + RLS)
3. XM-03 (public blog, manual posts only — ships value before any AI)
4. XM-09 partial (post CRUD admin)
5. XM-04, XM-05, XM-08 (prompt, generator, lock)
6. XM-07 (scheduling)
7. XM-06 (RSS)
8. XM-11 (Telegram + groups)
9. XM-10, XM-12, XM-09 complete, XM-13
