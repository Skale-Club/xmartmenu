# XmartMenu — plano de execução de estabilização

Data: 26/10/2026. Estado: plano de execução; correções ainda não iniciadas.

Base: `main`, commit `ef182ea1c69a6ad48198e854af6403d442322118`.
O checkout foi atualizado por fast-forward de `bd29b46` para essa revisão: 62 commits, 375 arquivos alterados. `origin/main` estava nessa mesma revisão ao concluir a sincronização. Branches de funcionalidades ainda não integradas à main não fazem parte desta base.

## 1. Objetivo e resultado esperado

Permitir que um restaurante opere cardápio, atendimento, pedidos e cobrança com isolamento entre clientes, preços consistentes e publicação condicionada à validação da versão entregue.

O ciclo estará concluído quando:

- Visitantes, clientes, funcionários e administradores acessarem somente os dados e ações permitidos.
- Um pedido inválido for rejeitado sem gravar dados parciais; um pedido válido usar preços e relações canônicos do servidor.
- Pagamentos com falha, repetição, concorrência e eventos atrasados convergirem para o estado correto.
- Cardápio, login e checkout funcionarem tanto no endereço da plataforma quanto no domínio próprio.
- Conteúdo privado e histórico de pedidos não aparecerem para outra pessoa nem por cache, JSON, HTML ou RSC.
- A imagem publicada corresponder ao commit aprovado pelos testes obrigatórios.
- As funcionalidades recém-integradas continuarem funcionando: planos, garçom/mesa, feed, chat, IA, blog, analytics e mídia.

Este documento é o plano dedicado desta iniciativa. Não substitui automaticamente o milestone v2.4 registrado em `.planning/STATE.md`, nem considera a integração externa Xphere desbloqueada. A reconciliação desse histórico está em EX-00.

## 2. Reclassificação da análise anterior

A primeira análise usou `bd29b46`, que estava desatualizado. Seus números e conclusões não devem ser tratados como uma auditoria integral da versão sincronizada. A revisão abaixo distingue defeitos persistentes, correções já recebidas e verificações ainda necessárias.

| ID | Achado | Situação em ef182ea | Execução |
|---|---|---|---|
| A01 | Atualização do próprio `profiles.role`/`tenant_id` | Política permissiva continua no schema versionado; grants e eventuais proteções reais precisam ser inspecionados | EX-01 |
| A02 | Opções inexistentes zeram preço de meio a meio | Persiste; cálculo foi extraído para `src/lib/menu/option-pricing.ts` | EX-03 |
| A03 | Sucesso após falha e cancelamento de outro PaymentIntent | Predicados problemáticos permanecem no webhook | EX-04 |
| A04 | Domínio próprio reescreve API, callback e checkout | Regra abrangente de reescrita permanece | EX-05 |
| A05 | Cardápio privado exposto por outras entradas | Persiste na raiz e API pública; loader remove detalhes, mas mantém produtos/categorias para visitante sem acesso | EX-06 |
| A06 | Histórico associado pelos últimos oito dígitos | Helper e consulta permanecem | EX-07 |
| A07 | Dependências com avisos de segurança | Reexecutar auditoria sobre o lockfile atualizado; não reutilizar a contagem antiga | EX-10 |
| A08 | Ausência de testes no CI e deploy independente | Parcialmente corrigido: Vitest, E2E e Lighthouse do build existem; deploy continua independente, e suítes legadas ficam fora do Vitest | EX-02 |
| A09 | `noindex` aplicado ao domínio canônico | Condição baseada apenas na existência do domínio permanece | EX-05 |
| A10 | Opções ausentes na página principal | Corrigido para o fluxo público normal pelo loader compartilhado; preservar com regressão | EX-06 |
| A11 | Confirmação de pagamento baseada em query string | Persiste | EX-04 |
| A12 | Checkout com moeda fixa em reais | Corrigido: usa `formatPrice` e moeda do restaurante; preservar e testar consistência histórica | EX-04 |
| A13 | Modalidades de pedido e relações entre entidades | Capacidades de plano/modalidade já implementadas; ainda revisar menu/produto/localização e criação atômica | EX-03 |
| A14 | Inserção pública de conversas/mensagens no banco | Políticas permissivas continuam nas migrations; conferir estado aplicado | EX-01, EX-09 |
| A15 | Segredos em build args | Persiste; inclui também `SENTRY_AUTH_TOKEN` na versão atual | EX-02 |
| A16 | Cache/consultas do cardápio | Cache de dados por restaurante e consultas agrupadas já entregues; validar isolamento, invalidação e desempenho | EX-06, EX-11 |
| A17 | Assert antigo de deduplicação Xphere | Falha reproduzida novamente; implementação inclui `eventId` e teste ainda espera chave antiga | EX-02 |
| A18 | Observabilidade/readiness | Já existe request ID, auditoria, readiness e monitoramento; validar cobertura operacional, sem reconstruir | EX-11, EX-12 |
| V01 | Onboarding interrompido e recuperação | Frente de validação; confirmar comportamento antes de classificar novos defeitos | EX-08 |
| V02 | IA paga, blog/Telegram e integrações novas | Frente de validação da versão recebida; não são vulnerabilidades presumidas | EX-09 |

### Evidência já coletada nesta revisão

- `npm ci --no-audit --no-fund`: concluído; dependências alinhadas ao novo lockfile.
- `npm test`: 36 arquivos e 428 testes passaram.
- `node --import tsx scripts/xphere-queue-check.ts`: falhou na expectativa da chave de deduplicação.
- `npm run build`: aprovado na revisão atual, incluindo TypeScript e geração das páginas. Upload ao Sentry desabilitado nesta execução; avisos registrados na seção 12.
- Nenhuma migration aplicada, cobrança realizada ou configuração externa alterada nesta preparação do plano.
- Testes E2E, policies reais, grants e estado operacional de produção ainda não foram validados nesta revisão.

## 3. Regras de execução

1. Usar o código sincronizado como base. Antes de cada PR, conferir se a main avançou e reconciliar alterações sem reintroduzir problemas já corrigidos.
2. Aproveitar Vitest, Playwright, Supabase local, fixtures, loader de cardápio, capacidades por plano, observabilidade e runner de migrations existentes.
3. Testes que escrevem dados devem usar Supabase local ou homologação isolada. Manter a proteção de `tests/e2e/fixtures/db.ts` contra banco remoto real.
4. Toda correção de segurança ou dinheiro terá regressão que falha antes e passa depois. Testar comportamento e fronteiras de autorização, não apenas mocks que repetem a implementação.
5. Alterações SQL serão migrations novas e compatíveis com o código anterior quando possível. Não reescrever migrations aplicadas nem executar `--baseline` sem reconciliar o catálogo real.
6. Código, identificadores e textos padrão do produto continuam em inglês; documentação desta iniciativa em português. Preservar suporte aos idiomas já entregues.
7. Deploy continua Docker/GHCR/Coolify. Preservar a base compartilhada `node:24-alpine`; alinhar o CI à versão de runtime escolhida, sem migrar a hospedagem.
8. Nenhuma correção pode remover a trilha de auditoria nem introduzir telefone, segredo, token ou conteúdo sensível nos logs.
9. Entregas pequenas por comportamento. Evitar PR único juntando atualização de dependências, migrations, pagamentos e refatoração visual.
10. As etapas de execução abaixo são trabalho futuro. Criar o plano não inicia deploy, integração paga, disparos de mensagens ou migração de produção.

## 4. Ordem, dependências e entregas

Tamanho relativo: P = mudança localizada; M = vários módulos/testes; G = transações, dados históricos ou integração externa. Não representa prazo prometido.

| Fase | Entrega verificável | Prioridade | Depende de | Tamanho |
|---|---|---|---|---|
| EX-00 | Baseline atual e ambiente isolado reproduzíveis | P0 | — | M |
| EX-01 | Privilégios e escrita no banco protegidos | P0 | EX-00 | G |
| EX-02 | Somente versão validada pode ser publicada; segredos protegidos | P0 | EX-00 | M |
| EX-03 | Pedido calculado e persistido corretamente | P0 | EX-00, EX-01 | G |
| EX-04 | Cobrança e pedido convergem sob falhas/retries | P0 | EX-03 | G |
| EX-05 | Fluxo completo e SEO em domínio próprio | P1 | EX-00 | M |
| EX-06 | Cardápio privado protegido em todas as superfícies | P0 | EX-00, EX-01 | M |
| EX-07 | Histórico vinculado a identidade comprovada | P0 | EX-00, EX-01 | G |
| EX-08 | Onboarding retomável sem registros incompletos | P1 | EX-01, EX-03 | M |
| EX-09 | IA/blog/integrações validados com falhas controladas | P1 | EX-01, EX-03, EX-04, EX-06 | G |
| EX-10 | Dependências corrigidas e runtime coerente | P1; elevar se exposição crítica confirmada | EX-00 | M/G |
| EX-11 | UX, desempenho e observabilidade comprovados | P1 | EX-03 a EX-07, EX-09, EX-10 | M |
| EX-12 | Publicação gradual, reconciliação e encerramento | P0 para qualquer release | Gates das fases incluídas + EX-02 | M |

O fluxo de preparação não deve atrasar uma correção crítica confirmada. EX-01 pode produzir um hotfix pequeno assim que o cenário for reproduzido. EX-02 é obrigatório antes de usar a publicação automatizada desta iniciativa.

Sequência recomendada com um executor: EX-00 → EX-01 → EX-02 → EX-06 → EX-03 → EX-04 → EX-07 → EX-05 → EX-10 → EX-08 → EX-09 → EX-11. EX-12 é usado em cada lote e encerra o ciclo completo.

EX-05 e EX-10 têm independência lógica das correções de pedidos. Isso não pressupõe execução simultânea: se houver múltiplos responsáveis, dividir propriedade por módulo e manter responsáveis únicos por `package-lock.json`, migrations, middleware e webhook Stripe.

## 5. Fases executáveis

### EX-00 — Fixar a realidade técnica e operacional

**Resultado:** qualquer executor consegue reproduzir o baseline e sabe quais constatações se aplicam ao ambiente servido aos clientes.

**Trabalho:**
- Registrar SHA local/remoto, release reportada pelo readiness, runtime, imagem implantada e estado dos checks desse SHA. Não assumir que main e produção são idênticas.
- Executar a suíte atual, as seis suítes legadas em `src`, os seis verificadores Xphere e o build; registrar cada grupo separadamente.
- Subir Supabase local a partir das migrations e seed existentes; verificar a sequência antes de resetar qualquer banco local já em uso.
- Executar Playwright API/mobile/desktop. Registrar falhas, evidências e dependências de ambiente; não chamar configuração presente de teste aprovado.
- Fazer inventário somente de leitura de policies, grants por coluna/tabela, triggers, funções privilegiadas e ledger de migrations em produção, sem exportar dados pessoais.
- Conferir presença/configuração, sem imprimir valores, de Stripe, OTP, Redis, R2, Sentry, QStash e credenciais de IA.
- Reconciliar `.planning/STATE.md`, roadmap e planos de blog com os commits: registrar entregas existentes e bloqueios externos ainda reais, sem marcar fases não verificadas como concluídas.

**Fontes:** `package.json`, `vitest.config.ts`, `playwright.config.ts`, `tests/e2e/README.md`, `supabase/seed.sql`, `docs/runbooks/migracoes.md`, `docs/observability.md`, `.planning`.

**Aceite:** baseline com SHA e comandos; ambiente de teste isolado; catálogo SQL comparado ao repositório; cada achado classificado como confirmado, condicionado ao ambiente, corrigido ou pendente de prova. A falta de acesso a uma integração bloqueia apenas sua validação operacional.

### EX-01 — Autorizações e isolamento no banco

**Resultado:** conta comum não altera privilégios, não muda de restaurante e não escreve diretamente em superfícies que exigem validação do servidor.

**Trabalho:**
- Testar `profiles` com anon, cliente, staff, administrador de loja e superadmin de dois tenants. Incluir REST/Supabase direto, além das rotas Next.
- Restringir updates de `role`, `tenant_id` e campos de controle de acesso. Definir allowlist dos campos pessoais editáveis; proteger todas as vias de escrita, inclusive RPCs.
- Revisar policies de configurações, catálogo, pedidos, chat e funções `SECURITY DEFINER`; explicitar privilégio por operação, não somente por pertencimento ao tenant.
- Remover inserções públicas irrestritas de conversas/mensagens quando os produtores autorizados usarem o servidor. Preservar criação legítima de sessão e persistência do chat.
- Centralizar guards de papel e troca obrigatória de senha onde aplicável. Evitar bloquear somente `store-staff` e aceitar implicitamente qualquer outro papel.
- Garantir que preview de superadmin tenha escopo e autoria auditáveis. Não permitir selecionar tenant por cookie para um usuário sem esse papel.
- Criar migrations aditivas e testes de isolamento no banco local real.

**Fontes:** `supabase/migrations/001_initial_schema.sql`, migrations de chat, `src/lib/get-effective-tenant.ts`, `src/lib/superadmin-auth.ts`, `src/lib/auth/password-guard.ts`, rotas admin/superadmin e MCP.

**Aceite:** promoção e troca de tenant negadas no banco; acesso cruzado negado; campos pessoais permitidos continuam editáveis; fluxos admin e chat continuam funcionando. Guardar evidência dos testes SQL/API, não tokens.

**Publicação/retorno:** validar políticas em homologação; aplicar endurecimento compatível com os escritores atuais. Se houver bloqueio legítimo, corrigir a política específica; não restaurar a política ampla vulnerável como rollback padrão.

### EX-02 — CI, artefato de release e segredos

**Resultado:** commit reprovado não chega ao Coolify e a imagem publicada é rastreável à validação aprovada.

**Trabalho:**
- Conectar `checks`, `e2e` e deploy por dependência explícita. Preferir workflow reutilizável ou pipeline único com `needs`; se usar `workflow_run`, fixar e validar o SHA/branch de origem.
- Fechar também o caminho `workflow_dispatch`: ele não poderá contornar os checks obrigatórios.
- Preservar Vitest com cobertura, Playwright e Lighthouse no build local do CI. A auditoria informativa do site publicado não substitui esses gates.
- Incluir as suítes `tsx` legadas e verificadores Xphere no comando agregado/CI. Corrigir o teste de deduplicação para provar: mesmo evento deduplica; eventos distintos não colapsam; sem `eventId` mantém contrato previsto.
- Excluir worktrees e artefatos gerados do lint. Não rebaixar regras adicionais para esconder erros.
- Substituir `ARG`/`ENV` de `SUPABASE_SERVICE_ROLE_KEY` e `SENTRY_AUTH_TOKEN` por BuildKit secrets. Avaliar leitura pública restrita no prerender para reduzir necessidade de chave privilegiada.
- Usar imagem por SHA/digest no deploy, incluindo retorno à imagem anterior. Evitar que uma corrida em `latest` publique um commit diferente do aprovado.
- Preparar builds/checks com banco local e credenciais de teste; revisar o job que hoje constrói usando secrets remotos.
- Investigar o aviso NFT do Turbopack no caminho `next.config.ts` → `src/lib/media/video.ts` → upload de superadmin: limitar o rastreamento aos arquivos necessários e inspecionar o conteúdo/tamanho do artefato standalone. O aviso indica rastreamento amplo; não comprova sozinho inclusão de segredos.

**Fontes:** `.github/workflows/ci.yml`, `build-deploy.yml`, `lighthouse-ci.yml`, `Dockerfile`, `docker-compose.yaml`, `eslint.config.mjs`, `scripts/xphere-queue-check.ts`.

**Aceite:** teste intencionalmente falho em branch de CI impede o deploy; rerun/manual respeita o mesmo SHA; todos os grupos de testes aparecem nos relatórios; inspecionar histórico/metadados/cache de build com segredo sintético sem encontrá-lo. Não declarar ausência de vazamento histórico sem inspecionar os artefatos existentes.

### EX-03 — Preço, autorização comercial e integridade do pedido

**Resultado:** preço exibido e cobrado são consistentes; payload inválido não produz pedido parcial nem item gratuito indevido.

**Trabalho:**
- Criar contrato de entrada completo com limites de itens, quantidade, tamanho de texto, identificadores e seleções. Reusar Zod e tipos existentes.
- Tornar `option-pricing` estrito: validar existência, produto/grupo de origem, disponibilidade, obrigatoriedade, min/max, duplicação e regras de meio a meio. Identificador inexistente gera erro, nunca preço substituto zero.
- Buscar metadados necessários dos grupos/ingredientes; falha da consulta de preços deve impedir a compra, não tratar catálogo indisponível como vazio.
- Derivar nome do produto, descrições dos complementos e preço do catálogo. Não persistir `selected_options` e nomes inventados como verdade da cozinha.
- Validar relações `tenant → menu → produto`, localização ativa do mesmo tenant, mesa e modalidade. Impedir omissão de `menu_id` como caminho para contornar autorização de produto privado.
- Preservar controles de planos/modalidades/tips já recebidos. Aplicar a mesma regra canônica aos caminhos público, garçom e chat.
- Aplicar multiplicador autorizado exatamente uma vez a produto/opções/ingredientes; rejeitar menu inexistente/inativo em vez de aceitar silenciosamente preço padrão.
- Persistir pedido e itens em transação por função de banco protegida ou equivalente. Adicionar chave de idempotência para reenvio da mesma tentativa; payload diferente com a mesma chave gera conflito.
- Fixar snapshot de moeda, valor e componentes cobrados no pedido. Usar representação monetária exata; definir migração histórica sem inferir moeda antiga a partir de uma configuração atual mutável.

**Fontes:** `src/app/api/orders/route.ts`, `src/lib/menu/option-pricing.ts`, `src/lib/chat-agent.ts`, `src/lib/service-modes.ts`, `src/lib/service-settings.ts`, `src/components/menu/price-multiplier.ts`, schema de pedidos.

**Aceite:** preço zero indevido reproduzido anteriormente é rejeitado; opção obrigatória não pode ser omitida; localização/produto de outro tenant são rejeitados; catálogo indisponível não barateia compra; reenvio não duplica pedido; falha nos itens não deixa cabeçalho órfão; KDS não recebe pedido parcialmente gravado.

### EX-04 — Pagamentos e confirmação confiáveis

**Resultado:** o estado financeiro resulta do provedor e converge com o pedido sob falha, concorrência e repetição.

**Trabalho:**
- Centralizar a matriz de transições hoje distribuída entre webhook, PATCH de pedidos, checkout e KDS. Preservar estados operacionais existentes e distinguir evidência de pagamento de avanço da cozinha.
- Validar PaymentIntent atual, tenant, moeda, valor esperado e vínculo ao pedido antes de aplicar evento. Eventos de intents descartados não alteram o pedido válido.
- Tornar retomável uma tentativa falha; sucesso posterior do intent atual precisa ser reconhecido.
- Fazer processamento idempotente com controle de concorrência. Persistir mudança de estado e resultado do evento de forma consistente; falha de banco precisa permitir retry.
- Revisar criação/claim/cancelamento de intents concorrentes; nunca devolver client secret de intent cancelado ou não vinculado após falha de persistência.
- Exibir confirmação somente após estado confiável do servidor. Query string é indicação de navegação, não prova. Implementar atualização limitada para webhook atrasado e ação clara de retomada.
- Preservar formatação de moeda já corrigida; usar snapshot do pedido de EX-03. Não implementar novamente a troca de `R$` fixo, pois já foi entregue.
- Revisar analytics para registrar conclusão/cancelamento apenas quando a transição correspondente ocorreu, com deduplicação.
- Criar reconciliação em modo relatório entre pedidos e Stripe para detectar registros já pagos no provedor e incoerentes no sistema. Reparos financeiros serão separados da inspeção.

| Cenário obrigatório | Comportamento esperado |
|---|---|
| Falha e depois sucesso do intent atual | Pagamento reconhecido; pedido segue uma única vez |
| Sucesso e depois evento antigo de falha | Pagamento confirmado não regride |
| Cancelamento de intent perdedor | Pedido do vencedor permanece intacto |
| Mesmo evento entregue duas vezes/concomitantemente | Uma transição efetiva e efeitos idempotentes |
| Banco falha durante processamento | Retry pode concluir, sem evento falsamente marcado como processado |
| Pedido já cancelado recebe pagamento válido | Registrar divergência e encaminhar reconciliação; não reabrir cozinha automaticamente |
| `redirect_status=succeeded` inventado | Não mostra comprovante de sucesso sem evidência do servidor |
| Cozinha já avançou | Evento tardio não retrocede estado operacional |

**Fontes:** `src/lib/stripe.ts`, `src/app/api/stripe/webhooks/route.ts`, `src/app/api/stripe/payment-intents/route.ts`, `src/app/api/orders/[id]/route.ts`, páginas de checkout, analytics de pedidos.

**Aceite:** cenários acima cobertos por testes automatizados e Stripe em modo de teste para o fluxo integrado. Chamadas offline simuladas não substituem a prova do webhook assinado e do checkout de homologação.

### EX-05 — Domínio próprio, sessão e SEO

**Resultado:** visitante conclui navegação, autenticação e pedido no domínio próprio; a versão canônica pode ser indexada conforme a preferência do restaurante.

**Trabalho:**
- Extrair resolução de rota por host/caminho para função testável. Excluir APIs globais, checkout, callbacks, recursos internos, arquivos e metadados que não pertencem ao namespace do tenant.
- Definir tratamento explícito de `/`, menu/filial, feed, blog, `/me`, garçom, QR/mesa e rotas administrativas. Usar limite de segmento, não prefixo ambíguo de slug.
- Preservar refresh de sessão e `x-request-id`. Verificar o caminho `/` no domínio próprio, inclusive o atalho de marketing do middleware de sessão.
- Validar origem de redirects e retorno do Stripe. Conferir URLs de callback autorizadas no ambiente de homologação.
- Decidir canonical/noindex com base no host efetivo e regras do tenant. O domínio próprio canônico deve respeitar a preferência de indexação, não ser desindexado apenas por existir.
- Cobrir robots, sitemap, OG/Twitter e blog por host; impedir caminhos duplicados e referências à plataforma quando a URL pública correta é o domínio próprio.

**Fontes:** `src/middleware.ts`, `src/lib/supabase/middleware.ts`, `src/lib/feed-route.ts`, `src/lib/site-url.ts`, `src/lib/seo.ts`, páginas/metadados públicos.

**Aceite:** E2E com host da plataforma e host de teste verificado; `POST /api/orders`, callback e checkout chegam aos handlers corretos; menu/filial/blog/me resolvem; domínio canônico sem noindex indevido; tenant explicitamente noindex e menu privado continuam protegidos.

### EX-06 — Privacidade e consistência do cardápio com cache

**Resultado:** todas as entradas compartilham a mesma autorização e o cache não transforma leitura autorizada em conteúdo público.

**Trabalho:**
- Reusar `loadPublicMenuData` nas superfícies aplicáveis. Corrigir a raiz do tenant, a API pública e qualquer contexto de IA que exponha catálogo privado.
- Negar conteúdo privado antes da serialização: produtos, categorias, preços, complementos, ingredientes, mídia e JSON-LD. Apenas retirar detalhes não é proteção suficiente.
- Aplicar autenticação por telefone verificado a cada requisição privada, fora do cache compartilhado; preservar as permissões de staff/superadmin definidas em EX-01.
- Revisar policies públicas de produtos, categorias, menus e opções para não contornar a regra usando diretamente o SDK. Confirmar o que já está aplicado em produção.
- Preservar paridade de opções entre raiz, menu específico, filial, feed e chat. O carregamento compartilhado de opções já existe; adicionar regressão, não reconstruir.
- Garantir invalidação e autorização imediata quando um menu muda de público para privado, tenant é desativado ou plano é revogado. Não depender somente de TTL/stale-while-revalidate para revogar acesso.
- Testar isolamento de cache por restaurante/segmento e dados de sessão/mesa fora da entrada compartilhada. Conferir invalidações disparadas por APIs, ações administrativas e MCP.
- Corrigir paridade de multiplicador na raiz e seção quando reproduzida, reutilizando os helpers de preço existentes.

**Fontes:** `src/lib/menu/public-menu-data.ts`, `public-menu-cache.ts`, `menu-cache-hooks.ts`, `src/app/(public)/[slug]/page.tsx`, `[menuSlug]/page.tsx`, `src/app/api/public/[slug]/route.ts`, policies públicas.

**Aceite:** visitante sem sessão não encontra dados privados em HTML, RSC, JSON, JSON-LD ou SDK; sessão autorizada recebe o menu; cache aquecido por um usuário não autoriza o seguinte; revogação de acesso não deixa conteúdo privado servido pela entrada antiga.

### EX-07 — Identidade do cliente e histórico

**Resultado:** cliente vê apenas pedidos cuja associação à sua identidade foi comprovada.

**Trabalho:**
- Substituir chave de oito dígitos como critério de autorização por identificador de cliente autenticado e/ou telefone completo E.164 verificado.
- No checkout autenticado, associar pedido à identidade da sessão; telefone digitado por visitante permanece contato, não prova de propriedade.
- Definir aquisição de histórico de pedidos anônimos por verificação do telefone completo, com associação auditável; jamais usar apenas o sufixo.
- Adicionar campos/índices necessários sem apagar imediatamente o legado. Fazer backfill em modo relatório; casos ambíguos ficam sem associação automática.
- Definir país/região na entrada para números locais. Não assumir silenciosamente um país universal.
- Remover fallback permissivo na consulta do painel. Preservar política de cliente sem OTP configurado com mensagem clara já existente.

**Fontes:** `src/lib/phone.ts`, `src/app/(public)/[slug]/me/page.tsx`, login OTP, criação de pedido, schema de clientes/pedidos, `docs/guest-login.md`.

**Aceite:** dois números com os mesmos oito dígitos finais não compartilham histórico; telefone não verificado não concede acesso; cliente de um tenant não lê histórico de outro; migração não associa registros ambíguos automaticamente.

### EX-08 — Onboarding e retomada

**Resultado:** criação ou retomada de restaurante termina com perfil, plano, configurações e catálogo inicial consistentes.

**Trabalho:**
- Injetar falhas após cada escrita do onboarding e testar requisições concorrentes/repetidas.
- Confirmar primeiro quais falhas ainda existem; aproveitar correções recentes do mirror de plano e `handle_new_user`.
- Tornar o núcleo de escrita atômico ou implementar checkpoints idempotentes verificáveis quando envolver serviços externos.
- Evitar tenant órfão, perfil vinculado sem assinatura e menus padrão duplicados. Tratar slug reservado e colisões por constraint/retentativa controlada.
- Retomada deve reparar etapas faltantes, não somente pular a criação do tenant já associado.
- Enfileirar CRM após commit; indisponibilidade da fila não desfaz criação válida. Definir mecanismo recuperável de ressincronização sem duplicar notas.

**Fontes:** `src/app/api/onboarding/route.ts`, `src/lib/admin/tenant-management.ts`, migrations de planos/perfis, `src/lib/xphere/queue.ts`.

**Aceite:** interrupção e repetição produzem um conjunto coerente; criação concorrente não duplica a mesma operação; falha do CRM não bloqueia onboarding; retomada não omite assinatura/configurações.

### EX-09 — Validação das novas integrações e cobrança de IA

**Resultado:** recursos recebidos do remoto funcionam com escopo, custo e falhas controlados.

**Trabalho em entregas separadas:**
- **IA/chat:** preservar agente, contexto de carrinho e cálculo de preço existentes. Testar limites de corpo/contexto/áudio, tenant/menu autorizado, canais e capacidades por plano. O identificador de conversa e um telefone digitado não substituem a autenticação necessária para dados privados.
- **Custos e cobrança:** testar chave global versus chave própria, autorização de configuração, falha do provedor, concorrência, agregação e reentrega de eventos/faturas. Uma chamada não pode ser cobrada duas vezes; chamada não faturada deve continuar reconciliável. Usar OpenRouter falso e Stripe de teste.
- **Proteção de consumo:** conferir Redis em produção, origem confiável do IP no proxy, limite por tenant e fallback sob indisponibilidade. Definir bloqueio controlado para operações caras sem limite disponível; manter menu navegável.
- **Blog/Telegram:** validar escopo plataforma/tenant, downgrade, jobs repetidos, lock, URLs RSS/imagens, segredo e chat autorizado em callbacks. Conferir se scheduler e webhook estão registrados antes de declarar automação operacional.
- **Xphere:** preservar contrato, kill switch e verificação QStash. Revalidar disponibilidade do endpoint externo; executar conformance somente se pronto. Não alterar repositório Xphere nem ligar sincronização por inferência do estado de planejamento antigo.

**Fontes:** `src/lib/ai/*`, `src/lib/chat-agent.ts`, `chat-context.ts`, `src/lib/blog/*`, `src/lib/xphere/*`, rotas correspondentes, `docs/ai-billing.md`, plano autoblog existente.

**Aceite:** integração entre tenants negada; duplicatas financeiras neutralizadas; falhas externas observáveis; menus/pedidos não dependem da disponibilidade do CRM; scheduler e callbacks têm evidência por ambiente. A integração externa bloqueada pode ficar desativada com status explícito, sem impedir hotfixes independentes.

### EX-10 — Dependências e compatibilidade

**Resultado:** dependências de produção sem vulnerabilidade crítica/alta aplicável e não tratada, com regressões verificadas.

**Trabalho:**
- Reexecutar `npm audit --omit=dev` no novo lockfile e conferir advisories primários, caminho de dependência e pré-condições de exploração.
- Atualizar em lotes: Next/React/ecossistema; MCP; Sharp/mídia; IA/Zod; demais transitivas. Coordenar `next`, analyzer e ESLint compatíveis.
- Testar geração OG, otimização/conversão de imagens, vídeo/ffmpeg, uploads, MCP/OAuth, validação de schemas, SDK de IA e inicialização Sentry.
- Alinhar Node e pacotes nativos entre CI e Docker. Tratar deprecações de middleware/Sentry apenas na medida necessária à atualização, com regressão de rotas.
- Cada exceção terá advisory, justificativa de não aplicabilidade, responsável, compensação e data de reavaliação; não confundir alerta transitivo com exploração comprovada.

**Fontes:** `package.json`, `package-lock.json`, `next.config.ts`, Dockerfile e CI; advisories consultados novamente durante a execução.

**Aceite:** lockfile reproduzível, suítes e imagem Linux aprovadas; nenhuma atualização sem revisão de breaking changes; nenhum risco crítico/alto aplicável sem correção ou tratamento explícito. Não reaproveitar os 29 alertas da auditoria anterior como contagem atual.

### EX-11 — Experiência, desempenho e operação

**Resultado:** fluxos principais utilizáveis no celular/desktop e evidência operacional suficiente para detectar regressão.

**Trabalho:**
- Exercitar lista/feed, produto/opções, carrinho, checkout, OTP, garçom, chamados de mesa, KDS e configurações com os modos de plano existentes.
- Auditar teclado, foco e retorno de foco, Escape, rolagem, leitores de tela, contraste, toque e movimento reduzido. Reusar `Modal`/`ModalPortal` entregues.
- Medir home e menu com build de produção, cache frio/quente e fixture pequena/grande. Preservar o limite Lighthouse já configurado de 0,88 por mediana de três execuções.
- Registrar p50/p95, consultas por visita e payload do cardápio; estabelecer orçamento adicional a partir do baseline, antes de otimizar. Não afirmar latência de produção com base em comentários do código.
- Revisar invalidação de cache e mídia no Docker real; limitar CPU/memória e duração de processamento onde a medição mostrar risco.
- Melhorar tipos e dividir componentes apenas nas fronteiras alteradas. Não abrir uma reescrita geral motivada pelo número antigo de avisos de lint.
- Validar readiness, release SHA, request IDs, erros de pagamento, falhas de fila e alertas existentes. Garantir que a observabilidade não capture segredos nem PII desnecessária.

**Aceite:** fluxos completos aprovados nos dispositivos-alvo; nenhuma regressão de orçamento de performance; alertas testados com falha sintética; troubleshooting identifica request/release sem dados sensíveis.

### EX-12 — Release, dados históricos e encerramento

**Resultado:** cada lote chega ao ambiente correto, é verificado e tem retorno definido.

**Antes de cada release:**
1. Fixar SHA e lista de correções/migrations; conferir jobs obrigatórios e imagem/digest.
2. Validar migration em banco novo e em cópia anonimizada com o estado anterior; executar primeiro simulação pelo runner existente.
3. Conferir backup e procedimento de restauração; verificar compatibilidade entre código anterior/novo e schema aditivo.
4. Preparar smoke test, critérios de interrupção, imagem anterior e responsável por acompanhar.

**Durante e depois:**
1. Aplicar somente migrations aprovadas e publicar a imagem validada, na ordem definida por sua compatibilidade.
2. Conferir liveness, readiness e SHA servido; testar acesso anônimo/admin, domínio próprio e isolamento de tenant.
3. Fazer primeiro piloto com tenant de teste, depois restaurante piloto; validação financeira usa ambiente de teste apropriado, sem cobranças reais automáticas.
4. Comparar erros, duplicação de pedidos, divergências financeiras, latência e filas. Interromper o lote se houver exposição de dados, duplicidade de cobrança ou incompatibilidade de schema.
5. Rodar relatório de reconciliação de pagamentos e identidades legadas; reparar somente registros com evidência suficiente e trilha de auditoria.
6. Reverter aplicação por SHA/digest quando seguro. Não reintroduzir política insegura nem desfazer backfill financeiro em massa como retorno automático.
7. Anexar testes, migrations aplicadas, evidências de homologação/piloto e riscos remanescentes; atualizar o planejamento com o estado efetivamente comprovado.

**Encerramento:** todos os achados confirmados têm correção verificada ou tratamento explicitamente aceito; recursos novos preservados; pendências externas separadas de entrega local; runbook permite publicar e recuperar a versão sem depender da memória desta conversa.

## 6. Matriz mínima de validação integrada

| Dimensão | Casos necessários |
|---|---|
| Atores | Anônimo, cliente OTP, cliente sem verificação, staff, store-admin, superadmin em preview |
| Isolamento | Dois tenants; UUIDs válidos pertencentes ao outro tenant; acesso direto ao Supabase; chamadas API e MCP |
| Planos | Cardápio, garçom e autoatendimento; upgrade/downgrade; ativo, trial, past_due e cancelado |
| URLs | Plataforma, domínio próprio, raiz, menu, filial, feed, blog, QR/mesa, login/callback e checkout |
| Visibilidade | Público/privado, tenant ativo/inativo, produto disponível/indisponível, cache frio/quente, mudança de permissão |
| Preços | Simples, single, meio a meio, múltipla escolha, ingredientes, multiplicador, taxa de entrega e gorjeta |
| Pedidos | Retentativa, concorrência, perda de resposta, falha entre gravações, relação inválida e catálogo indisponível |
| Pagamentos | Sucesso, falha/sucesso, sucesso/falha atrasada, cancelamento de outro intent, repetição, falha de banco e reconciliação |
| Identidade | Telefone completo verificado; mesma terminação em números diferentes; dados legados ambíguos |
| Integrações | Falha/timeout/duplicata em IA, Stripe, QStash, Xphere e blog; ambiente e credenciais de teste |
| Experiência | Mobile e desktop; teclado; overlays; moedas/idiomas; interrupção e retomada |
| Operação | Commit reprovado não publica; SHA correto em readiness; migration compatível; rollback ensaiado |

Fixtures adicionais devem ampliar as existentes, com dois tenants e identidades sintéticas. Testes de isolamento precisam executar sob os papéis correspondentes: cliente service-role sozinho não prova RLS.

## 7. Comandos e gates

Comandos já existentes que devem compor a validação (não implicam que todos já foram executados na base atual):

```text
npm ci
npm run lint
npm run check:routes
npm test
npm run test:coverage
npm run test:tenant-management
npm run test:analytics
npm run test:menu
npm run test:feed-route
npm run test:launch-checklist
npm run xphere:check
npm run xphere:check:client
npm run xphere:check:queue
npm run xphere:check:backfill
npm run xphere:check:obs
npm run xphere:worker:check
npm run build
npm audit --omit=dev
```

Para E2E, seguir `tests/e2e/README.md`: Docker/Supabase local, seed isolado, Playwright e ffmpeg disponíveis; depois `npm run test:e2e`. A suíte atual usa OpenRouter falso. Adicionar cenários Stripe com credenciais de teste e banco isolado; não reutilizar a configuração remota de `.env.local` para testes que criam pedidos.

Para migrations, seguir `docs/runbooks/migracoes.md`: `npm run db:migrate` simula por padrão. Conferir o destino e o plano antes de usar `--apply`. Não automatizar baseline do histórico para simplesmente eliminar erro de migration.

## 8. Organização dos PRs

- Um PR por fase ou comportamento menor, com prefixo de branch `codex/` e título descritivo.
- EX-01: separar permissões de profiles de políticas do chat se forem validáveis/publicáveis independentemente.
- EX-03: separar validação/preço de persistência atômica/idempotência se isso antecipar a correção de cobrança indevida.
- EX-04: separar transições de webhook, confirmação/retomada e reconciliação histórica.
- EX-09 e EX-10: múltiplos PRs por integração/família de dependências.
- Descrição de cada PR: problema reproduzido, mudança observável, testes, migration, compatibilidade e forma de retorno.
- Critério para merge: todos os gates relevantes aprovados, revisão do diff e nenhum achado de segurança/dinheiro sem regressão.

## 9. Lotes de publicação

| Lote | Conteúdo | Condição |
|---|---|---|
| A — contenção | Permissões, privacidade, histórico de cliente, preço inválido | Regressões específicas aprovadas; EX-02 para publicação automatizada; pode ser subdividido em hotfixes |
| B — transação completa | Persistência do pedido, Stripe, confirmação, domínio próprio | Fluxo integrado de pedido/pagamento e callback em homologação aprovado |
| C — robustez | Onboarding, IA/blog/integrações, dependências e operação | Testes das integrações e compatibilidade do lote aprovados |
| D — experiência e encerramento | UX/desempenho, dados históricos e documentação | Piloto e reconciliação concluídos, gates finais aprovados |

Dependência crítica aplicável pode sair como hotfix antes dos demais lotes após a triagem. Não aguardar melhorias visuais para remover exposição de dados ou cobrança incorreta.

## 10. Responsabilidades e decisões pendentes

| Responsabilidade | Entrega |
|---|---|
| Executor da fase | Código, migration quando necessária, regressões e evidências |
| Revisor técnico | Fronteiras de autorização, correção transacional, compatibilidade e escopo |
| Responsável pela plataforma | Ambiente, backup, secrets, proxy/DNS e acompanhamento de release |
| Responsável pelo produto | Validar experiência do cliente/loja e decisões comerciais que não estejam documentadas |

Antes de alterar dados/comportamento correspondente, resolver:

- O schema de produção contém proteções que ainda não foram versionadas? EX-00/EX-01 verificam por leitura.
- Qual regra deve conceder acesso aos pedidos anônimos antigos? Padrão do plano: só identidade comprovada; casos ambíguos não são associados automaticamente.
- Qual é o procedimento comercial para pagamento confirmado após cancelamento do pedido? Padrão: registrar divergência e reconciliar, sem reabrir cozinha nem estornar automaticamente.
- Qual país/região deve ser usado quando o cliente digita telefone local? Obter configuração/contexto explícito, não deduzir pelos últimos dígitos.
- Scheduler de blog, OTP e Xphere estão operacionais no ambiente atual? Descobrir pelo estado real; não exigir novas configurações se já estiverem corretas.
- Quem é o piloto e qual janela de acompanhamento cabe à operação? Definir no preparo da primeira release; isso não bloqueia implementação e testes locais.

## 11. Fora do escopo

- Reescrever o sistema, trocar hospedagem ou redesenhar integralmente a interface.
- Implementar novamente cache, suíte E2E, observabilidade, modos de plano ou formatação de moeda já recebidos.
- Alterar o repositório externo Xphere ou juntar branches remotas de funcionalidades ainda não integradas.
- Aplicar correções de dados ambíguos, cobranças, estornos ou publicação de conteúdo sem evidência e procedimento específico.

## 12. Registro de verificação da preparação

| Item | Resultado |
|---|---|
| Sincronização Git | Fast-forward para ef182ea; 62 commits; sem conflitos |
| Instalação do lockfile atualizado | Concluída |
| Vitest atual | 428/428 testes; 36/36 arquivos |
| Verificador Xphere queue | Falha confirmada por assert desatualizado; incluída em EX-02 |
| Build atual | Aprovado: compilação, TypeScript e geração de 74 páginas; upload ao Sentry desabilitado |
| Avisos do build | Rastreamento NFT amplo no processamento de vídeo (EX-02); depreciações de middleware e configuração Sentry para avaliar em EX-10 |
| E2E e políticas reais do banco | Não executados nesta preparação; gates de EX-00/EX-01 |
| Implementação das correções | Não iniciada |

### Referências técnicas da análise

- [Supabase — Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Stripe — Webhooks](https://docs.stripe.com/webhooks)
- [Docker — Build secrets](https://docs.docker.com/build/building/secrets/)

Revalidar documentação/versionamento ao implementar cada alteração; esses links não substituem a prova no código, schema e ambiente usados pelo projeto.
