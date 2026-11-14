# Dados reais em desenvolvimento: `npm run db:pull` (só emergência)

> **Política (regra universal do dono, 2026-11-07, `skaleclub-apps/agents/RULES.md` §4):** o banco
> de desenvolvimento usa um conjunto **fictício** e robusto (empresas fictícias cobrindo todo
> plano, status e caso extremo), descrito em [`docs/dev-fake-dataset.md`](../dev-fake-dataset.md).
> Produção **nunca** é copiada para desenvolvimento por padrão. O `db:pull` abaixo é ferramenta de
> **emergência** (por exemplo, reproduzir um bug que só aparece com dados reais): cada execução
> precisa do OK explícito do dono, e depois o banco de dev volta ao conjunto fictício. Não é passo
> de rotina nem pendência.
>
> Estado em 2026-11-08: o projeto de dev ainda guarda os dados reais de quando era produção (até o
> cutover de 2026-11-06). Eles serão substituídos pelo conjunto fictício conforme o plano.

> **Atualização 2026-11-07 (decisão do dono):** produção roda só no PostgreSQL próprio desde o
> cutover de 2026-11-06. O antigo projeto Supabase de produção (`ktogbpqookfcqilqvici`) passou a
> ser o projeto de **desenvolvimento**: as variáveis `DEV_SUPABASE_*`, `DEV_DATABASE_URL` e
> `DEV_MIGRATION_DATABASE_URL` do `.env.local` apontam para ele, e o bloqueio de escrita do
> cutover (`xm_cutover_fence`) foi removido. Não há clientes e o login é Google Identity, então
> esses dados não são protegidos. Com isso, o aviso abaixo sobre "candidato congelado" ficou
> desatualizado: o banco `xmartmenu` do cluster **é** a produção, e o `db:pull` traz dados atuais
> (precisa de `XPROUT_PROD_SSH` e acesso SSH ao host do cluster).

`npm run dev` usa um projeto Supabase de **desenvolvimento** (`DEV_DATABASE_URL`).
`npm run db:pull` copia, sob demanda, um retrato do banco `xmartmenu` do cluster
PostgreSQL compartilhado para esse projeto. `npm run dev` **nunca** copia nada sozinho.

## Atenção: a origem é um candidato congelado

O banco próprio do Xprout (`xmartmenu`, no container `e12scyfsrp822dag7m9wwd4x`, o mesmo
cluster do Xmail) foi importado em **2026-11-04**. Produção ainda lê a fonte anterior
(Supabase), então esse banco **não é atualizado pela produção**: o `db:pull` traz dados
parados na importação. O comando funciona assim mesmo, imprime esse aviso em toda
execução (`SOURCE_CANDIDATE_NOTICE`) e a constante `SOURCE_IS_CANDIDATE` em
`scripts/lib/dev-db-pull.ts` deve virar `false` no corte da aplicação (um teste fixa o
valor para a mudança ser deliberada). Detalhes do banco: `docs/xprout-shared-postgres-admission.md`
e `docs/xprout-private-postgres-transport.md`.

A leitura usa o administrador do cluster, em transação `REPEATABLE READ READ ONLY` e apenas
no banco `xmartmenu` (o nome nunca vem do container, que também guarda o banco do Xmail).
Os papéis do próprio Xprout seguem `NOLOGIN` e não são usados.

## Como o `npm run dev` escolhe o banco

`scripts/dev.mjs` → `developmentEnvironment()` (`scripts/lib/dev-environment.mjs`) →
`developmentConfig()` (`scripts/lib/database-target.mjs`): só `DEV_SUPABASE_PROJECT_REF`,
`DEV_SUPABASE_URL`, `DEV_DATABASE_URL` e as chaves `DEV_SUPABASE_*`. Nenhum alias
(`DATABASE_URL`, etc.) é aceito como alternativa. Os projetos de
`PRODUCTION_PROJECT_REFS` (hoje `ktogbpqookfcqilqvici`) são recusados tanto pelo dev quanto
pelo `db:pull`.

Preferred configuration uses XPROUT_PROD_*; existing XMARTMENU_PROD_* aliases remain supported independently. Physical database names and emergency-only authorization are unchanged.

## Configuração (nenhum valor é segredo, exceto a URL do banco de dev)

```
DEV_SUPABASE_PROJECT_REF=<ref de 20 letras do projeto de dev>
DEV_DATABASE_URL=postgresql://postgres.<ref>:<senha>@aws-...pooler.supabase.com:5432/postgres
XPROUT_PROD_SSH=root@<host do cluster>
# opcional: XPROUT_PROD_DB_CONTAINER (padrão e12scyfsrp822dag7m9wwd4x)
# opcional: XPROUT_PROD_DB_NAME (padrão xmartmenu)
# opcional: DEV_DATABASE_CA_FILE (PEM para verificar o certificado do banco de dev)
```

O SSH precisa funcionar sem senha (`BatchMode=yes`): chave já autorizada no servidor.

## O que o comando faz, em ordem

1. Valida o destino: só o projeto declarado em `DEV_SUPABASE_PROJECT_REF`. Recusa
   `NODE_ENV=production` e qualquer projeto de produção conhecido.
2. Backup JSON do destino em `../xmartmenu-db-backups/dev-<data>.json` (fora do repo, 0600).
3. Leva o schema do destino ao estado do repo com `scripts/apply-migrations.mjs --apply`
   (migrações SQL, cada uma numa transação). **Nunca `db:push`.**
4. Descobre por SSH o IP e as credenciais do container (só em memória), abre um túnel só em
   `127.0.0.1` e lê a origem numa transação `REPEATABLE READ READ ONLY`.
5. Compara os schemas. Tabela ou coluna da origem ausente no destino, tipo diferente, ou
   coluna só do destino `NOT NULL` sem default **aborta antes de mexer nos dados**.
6. Substitui os dados do destino numa **única transação** (erro = ROLLBACK). Triggers de
   usuário ficam desligados nela (`session_replication_role = replica`); se o papel não
   puder, o comando para (`--allow-triggers` só se o destino não tiver triggers).
7. Acerta as sequências e fecha o túnel.

## O que não é copiado

- **Segredos** (`SCRUBBED_COLUMNS`, fixado por teste): `telegram_settings` (`bot_token`,
  `approvals_bot_token`, `webhook_secret`) e as chaves de IA guardadas em linhas
  (`platform_ai_settings`, `tenant_ai_settings`, `chat_addon_settings`, `blog_settings`).
  As colunas existem, mas ficam NULL. Credenciais de Stripe e Xphere vivem em variáveis
  de ambiente, não no banco.
- **Estado de login** (`EXCLUDED_TABLES`): `app_sessions`, `app_identity_challenges`,
  `oauth_codes`. Quem aponta por chave estrangeira para uma tabela copiada é esvaziado.
- O ledger `supabase_migrations.schema_migrations`.

## Sem pagamento, CRM, Telegram nem IA em dev

- `developmentEnvironment()` esvazia as credenciais herdadas do shell ou do `.env`
  (`BLANKED_PROVIDER_ENV`: Stripe e Connect, Xphere, Telegram, OpenRouter/OpenAI/Gemini,
  QStash, Upstash, Sentry, `CRON_SECRET`) e força `XPHERE_SYNC_ENABLED=false`.
- Segunda trava, no nível do socket: `scripts/lib/dev-outbound-guard.mjs` é pré-carregado
  (`NODE_OPTIONS=--import=...`) em todo processo do servidor de dev, incluindo os
  workers do Next. Toda conexão TCP para host que não seja loopback, banco de dev ou
  projeto Supabase de dev é destruída com `EDEVOUTBOUND` antes de enviar um byte.
- `DEV_OUTBOUND_ALLOW_HOSTS` (hosts exatos, separados por vírgula) libera um host. Não há
  curinga nem chave "liberar tudo". Se o login Google de dev precisar de hosts do Google,
  libere-os um a um.

## Primeira vez: ledger de migrações vazio

Se o banco de dev nunca teve `supabase_migrations.schema_migrations`, o passo 3 para. Faça
o baseline uma vez com `npm run db:migrate -- --baseline=<versão> --apply` (ver
`docs/runbooks/migracoes.md`) e confira com `npm run db:migrate`.

## Ensaio

`npm run test:dev-db-pull` roda as políticas offline. O CI também ensaia a cópia inteira
entre dois bancos descartáveis num PostgreSQL descartável (job `dev-db-pull`), incluindo o
descarte de segredos, o rollback em erro e o aborto por deriva de schema. O caminho
SSH/túnel não tem teste automatizado e nunca foi executado contra o servidor.
