# Troca final: Supabase para o PostgreSQL próprio

Runbook único: troca, observação de 7 dias e rollback. A operação é o workflow
`.github/workflows/final-cutover.yml` (somente em `main`, `workflow_dispatch`),
com `mode=plan|apply|rollback`. O código é `scripts/ops/xmartmenu-final-cutover.py`
(roda como root no host do PostgreSQL, enviado por SSH pelo
`scripts/ops/run-xmartmenu-final-cutover.sh`).

Nada aqui foi executado em produção. O que foi provado e o que só `plan` em
produção prova estão na seção "Evidência".

## Pré-requisitos (uma vez)

Segredos do repositório (o `plan` diz quais faltam, só por nome):

| Nome | Para quê |
| --- | --- |
| `COOLIFY_TOKEN` | já existe; parar, gravar variáveis e publicar |
| `SUPABASE_SOURCE_DATABASE_URL` | URL SQL do Supabase (pooler de sessão IPv4 ou direta), usuário `postgres`/`postgres.<ref>` |
| `SUPABASE_SERVICE_ROLE_KEY` | já existe; só para importar subjects Google |
| `CUTOVER_SSH_HOST`, `CUTOVER_SSH_KEY`, `CUTOVER_SSH_HOST_KEY` | root no host `skaleclub-mail` (49.13.197.250); a terceira é a linha da chave pública do host (sem TOFU) |

Variável: `NEXT_PUBLIC_SUPABASE_URL` (já existe). No Coolify já devem estar as 8
variáveis `GOOGLE_AUTH_*` (staged com `ENABLED=false`) e `HEALTH_TOKEN`.
`apply` e `rollback` exigem `confirm_sha` = 8 primeiros caracteres do commit de
`main`, CI verde nele e imagem no GHCR. Mesmo `concurrency` do deploy.

## O que cada modo faz

**plan** (não altera nada; só contagens e rótulos): saúde do app (HTTP, banco,
release, modo), presença de segredos e de variáveis do Coolify, acesso ao
candidato (tabelas, ledger, contas, papel `xmartmenu_runtime`), quais propostas
SQL faltam e a ordem, diferença de linhas das 47 tabelas entre Supabase e
candidato, orçamento de conexões (limite 12, pool único de 5, 2 contêineres no
rollout + 1 heartbeat = 11, folga 1), capacidade do host, se há execução
interrompida, e `ready=true|false` com os bloqueios. Todo SQL do plano roda em
`BEGIN READ ONLY`; as chamadas HTTP são só GET.

**apply**, em ordem (cada fase grava marcador durável em
`/opt/xmartmenu/cutover/state.json`, 0600, com fsync):

1. `preflight`: host, segredos, app saudável, nenhuma flag ligada, `GOOGLE_AUTH_*` staged, candidato PG17 com papéis NOLOGIN e 7 contas, mesmas tabelas nos dois lados, fundação de identidade aplicada, SHA dos arquivos de proposta.
2. `backup-verified`: `pg_dump -Fc` do candidato (0400, SHA256), restaurado num banco descartável e comparado por digest com o vivo.
3. `app-stopped`: Coolify `stop`.
4. `source-fenced`: no Supabase, `ACCESS EXCLUSIVE` nas 47 tabelas e um gatilho `BEFORE INSERT/UPDATE/DELETE/TRUNCATE ... ENABLE ALWAYS` que rejeita com SQLSTATE `XM001`. Vale para REST do navegador, RPC e gatilhos de Auth (a escrita que eles fazem em `public` falha); leituras e Auth continuam. Verificado tabela por tabela. Reversível (`DROP TRIGGER`, função e schema `xm_cutover_fence`).
5. `rehearsal-ok` e `data-copied`: dump final do Supabase (`pg_dump --data-only`, só blocos `COPY` das tabelas esperadas); primeiro ensaio na cópia descartável, depois uma transação no candidato: `DELETE` + `COPY` com `session_replication_role=replica`, controles de conta reconciliados, FKs validadas, e só então `COMMIT` se as 47 tabelas (contagem + digest de cada linha), os 6 grupos de UUID e os próximos valores das sequences forem idênticos aos do Supabase congelado. IDs preservados.
6. `proposal.*`: as propostas pendentes, como `xmartmenu_owner`, na ordem identidade (já aplicada) → `native-tenant-effects` → `native-tenant-effects-dispatch` → `native-tenant-operations` → `native-customer-account-fks` → `native-waiter-actor` → `native-registration` → `native-account-administration` → `native-subscription-billing` → `native-stripe-oauth` → `native-ai-billing` → `native-mcp-oauth`. Cada uma é transacional e verificada por sentinela.
7. `runtime-grants`: tabelas criadas pelas propostas sem nenhum privilégio do runtime recebem `SELECT,INSERT,UPDATE` (as propostas deixam isso "para revisão"; nenhum código faz `DELETE` nelas) e as sequences de tabelas inseríveis recebem `USAGE,SELECT`. **Revise esta suposição.**
8. `runtime-login-enabled`: `LOGIN` com senha nova (verificador SCRAM calculado no operador; a senha nunca vai em SQL, log ou arquivo), limite 12 mantido.
9. `google-subjects`: importa subject→conta do Auth Admin API (porte em Python de `import-google-subject-claims.ts`; só existe quando esse arquivo está no commit, isto é, depois do PR #68). Enquanto não existir, `apply` recusa, a menos que se marque `skip_google_subjects` (aceitando que os 2 usuários Google não entram até o vínculo).
10. `post-manifest-recorded` e `env-written`: manifesto de tudo que o app escreve (sem `app_sessions`/`app_identity_challenges`); depois as 14 flags `OWNED_*`, `GOOGLE_AUTH_ENABLED`, `STORAGE_PROVIDER=s3`, `IDENTITY_ORIGIN`, `PROD_DATABASE_HOST/NAME`, as 6 `*_DATABASE_URL`/`*_DATABASE_SSL` no mesmo alvo (`10.0.4.1:15432`) e `IMAGE_TAG`, com valores anteriores guardados.
11. `deployed`: um único deploy do SHA de `main`.
12. `verified`: `/api/health/ready` com `release` correto, banco ok, `database_mode=owned` e `storage=s3` (com `HEALTH_TOKEN`), sessão de `xmartmenu_runtime` no banco (prova que o app está no banco certo), cardápio público (200) e `/identity` (200).
13. `completed`: marcador em `/opt/xmartmenu/cutover/COMPLETED` e em `xmartmenu_cutover.markers`.

**Falha antes da primeira escrita nova** (qualquer coisa até o deploy): volta
sozinha na ordem parar app → papel `NOLOGIN` e sessões encerradas → variáveis
anteriores (apagando as que não existiam) → desbloqueio do Supabase (verificado)
→ banco descartável removido → republicação da imagem anterior. Se já houve
deploy, o app é parado primeiro e o manifesto é comparado: com escrita nova a
volta é recusada (veja rollback).

**Interrupção** (runner cancelado, SSH caiu): o operador ignora SIGHUP e termina
sozinho; se morrer, o estado fica `running` e o próximo `apply` ou `rollback`
detecta, desfaz tudo (mesmo caminho acima) e sai com código 10, sem tentar
aplicar de novo; redispare `apply`. Um deploy interrompido não deixa o app preso:
a volta sempre termina com uma republicação.

**rollback**: só enquanto o banco próprio não recebeu escrita nova (manifesto das
tabelas de negócio, contas, vínculos e tabelas das propostas igual ao gravado
antes do deploy; sessões de login e desafios não contam). O app é parado antes da
comparação. Sem escrita: desfaz flags, `NOLOGIN`, desbloqueia o Supabase e
republica a imagem anterior. Com escrita: **recusa** (`check=new-writes-detected`,
código 3), republica o app como estava (próprio banco) e mantém o Supabase
congelado. Nunca se aponta para um Supabase desatualizado; depois de escrita
nova, a saída é reconciliar manualmente.

## Rótulos de log

Linhas `xmartmenu-cutover phase=<fase> status=<ok|failed|refused|...> check=<rótulo>`.
Só contagens, booleanos e rótulos fixos (`sqlstate-XXXXX` para erros de SQL);
valores com outros caracteres viram `redacted`. Nunca URL, senha, token, linha
ou texto de erro do driver. Códigos de saída: 0 ok, 1 falhou e voltou, 2
recusado antes de mudar algo, 3 volta recusada, 10 execução interrompida
recuperada.

## Observação de 7 dias

- Dia 0: conferir os logs do `apply`, `/api/health/ready` (com token), um pedido de teste e um login (telefone e Google). O Supabase fica **congelado, não apagado**: é a segunda cópia dos dados do momento da troca.
- Diário: `plan` (somente leitura) para ver sessões do papel, contagens e `rows`; Sentry sem erros de conexão; limite 12 respeitado (rollout = 11).
- Rollback continua possível só até a primeira escrita nova. Na prática isso vale minutos, não dias: depois, o plano de volta é reconciliação manual.
- Dia 7: aposentar credenciais do Supabase que não são mais usadas (Auth continua até a migração de identidade), arquivar `public` do Supabase, rotacionar a senha do runtime se desejado (novo `apply` não existe; faça `ALTER ROLE` manual e atualize as 6 URLs).

## Backup

Dentro da operação: dump do candidato verificado por restauração (antes de
qualquer alteração) e dump final do Supabase, ambos em
`/opt/xmartmenu/cutover/<run>/`, 0400. **Fora do host: não existe.** O de Xmail
(`docs/xmail-owned-backup.md`, `xmail-offsite-backup.md`) é por aplicativo
(chave SSH própria, receptor forçado, diretório e banco fixos em `49 -> 188`);
não serve como está para o banco `xmartmenu`. Falta um perfil Xmartmenu desse
mecanismo (chave dedicada, receptor em 188, diretório e allowlist de banco),
instalado antes da observação; sem serviço novo nem custo. O `plan` imprime
`offhost-backup present=false` até lá.

## Evidência

Provado em CI contra PostgreSQL 17 descartável (`cutover-postgres`) e offline:
cópia com digest/UUID/sequences, ensaio, bloqueio (INSERT/UPDATE/DELETE/TRUNCATE
rejeitados com `XM001`, também em modo replica) e desbloqueio, as 11 propostas
reais na ordem, grants, `LOGIN` com SCRAM que autentica de verdade, `apply` →
`rollback`, rollback recusado após escrita nova, volta automática por falha de
deploy, recuperação de execução interrompida, `plan` sem nenhuma escrita e sem
vazar segredo.

Só `plan` em produção prova: acesso SSH/root, nome do contêiner e usuário
`xmail_owner`, privilégios de `xmartmenu_owner` sobre `auth.users` e tabelas,
URL do Supabase aceita (CA fixada), formas reais das tabelas (47), variáveis do
Coolify (`GOOGLE_AUTH_*`, `HEALTH_TOKEN`), caminho do app até `10.0.4.1:15432`
(só provado pela sessão do runtime no passo `verified`), e capacidade do host.
