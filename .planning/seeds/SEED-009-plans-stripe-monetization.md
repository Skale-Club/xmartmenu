---
id: SEED-009
status: ready
planted: 2026-05-08
trigger_when: now — v1.9 shipped, order system functional
scope: large
depends_on: SEED-002 (shipped v1.1), SEED-003 (superseded by this seed)
supersedes: SEED-003
---

# SEED-009: Plans, Pricing & Stripe Connect Monetization

## Why This Matters

xmartmenu agora tem 3 camadas de valor reais para vender porta a porta nos EUA:
um menu digital, um sistema de pedidos, e pagamentos diretos ao restaurante.
Nada disso está monetizado hoje — qualquer tenant usa tudo sem pagar.

Este seed fecha esse gap: um sistema de planos editável pelo superadmin,
com override por tenant, Stripe Connect para o fluxo de pagamentos,
e feature gating limpo. Zero valores hardcoded no código.

## Modelo de negócio

### Planos base (seed inicial no DB — editáveis via superadmin)

| Slug | Nome | Mensal | Anual | Taxa por transação |
|------|------|--------|-------|--------------------|
| `menu` | Digital Menu | $49/mês | $490/ano | 0% |
| `orders` | Menu + Orders | $99/mês | $990/ano | 0% |
| `payments` | Menu + Payments | $179/mês | $1.790/ano | 0.5% |

### Regras de negócio
- Setup fee (downpayment) é tratado offline — **não está no sistema**
- Superadmin pode editar qualquer campo de qualquer plano sem deploy
- Superadmin pode fazer override de preço por tenant (desconto, deal especial)
- Override tem campo de `notes` para registrar motivo
- Tenant em plano `menu` tem `orders_enabled = false` forçado
- Tenant em plano `orders` tem `orders_enabled = true`, sem Stripe
- Tenant em plano `payments` pode conectar Stripe e aceitar pagamentos
- Plano `payments` cobra taxa de 0.5% via `application_fee` do Stripe Connect
  além da taxa padrão Stripe (2.9% + $0.30)

### Stripe Connect — fluxo tenant
- Tenant acessa Settings → Subscription → botão "Connect Stripe"
  (visível apenas no plano `payments`)
- OAuth Standard: tenant tem dashboard Stripe próprio, máximo controle
- Dinheiro vai direto para o Stripe do tenant — nunca passa pela plataforma
- Plataforma captura `application_fee_amount` por charge
- Tenant pode desconectar a qualquer momento (desabilita pagamentos online)

---

## Schema DB necessário

### Tabela `plans`
```sql
CREATE TABLE plans (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,                    -- "Digital Menu"
  slug        TEXT NOT NULL UNIQUE,             -- "menu" | "orders" | "payments"
  description TEXT,
  monthly_price     NUMERIC(10,2) NOT NULL,     -- 49.00
  annual_price      NUMERIC(10,2) NOT NULL,     -- 490.00
  transaction_fee_pct NUMERIC(5,4) DEFAULT 0,   -- 0.0050 = 0.5%
  features    JSONB NOT NULL DEFAULT '[]',      -- ["orders","payments","analytics"]
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
```

### Tabela `tenant_subscriptions`
```sql
CREATE TABLE tenant_subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id         UUID NOT NULL REFERENCES plans(id),
  billing_cycle   TEXT NOT NULL CHECK (billing_cycle IN ('monthly','annual')),
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','cancelled','trial','past_due')),
  -- Override campos: NULL = usa valor do plano; valor = preço customizado
  override_monthly_price      NUMERIC(10,2),
  override_annual_price       NUMERIC(10,2),
  override_transaction_fee_pct NUMERIC(5,4),
  override_notes  TEXT,  -- "6-month deal, close at Masa's Restaurant 2026-05-08"
  -- Stripe
  stripe_customer_id      TEXT,
  stripe_subscription_id  TEXT,
  current_period_start    TIMESTAMPTZ,
  current_period_end      TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id)  -- um tenant, um plano ativo
);
```

### Tabela `stripe_connections` (Stripe Connect por tenant)
```sql
CREATE TABLE stripe_connections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
  stripe_account_id TEXT NOT NULL,              -- "acct_xxx"
  scope             TEXT NOT NULL DEFAULT 'read_write',
  connected_at      TIMESTAMPTZ DEFAULT now(),
  is_active         BOOLEAN NOT NULL DEFAULT true,
  UNIQUE(tenant_id)
);
```

### Tabela `processed_stripe_events` (idempotência webhooks)
```sql
CREATE TABLE processed_stripe_events (
  stripe_event_id TEXT PRIMARY KEY,
  processed_at    TIMESTAMPTZ DEFAULT now()
);
```

### Colunas adicionadas em `tenants`
Nenhuma — tudo via `tenant_subscriptions` e `stripe_connections`.
O feature gating lê o `plan.slug` do join `tenant → tenant_subscriptions → plans`.

---

## Scope por fase (estimativa)

### Fase A — Schema + Planos Base
**O que entrega:**
- Migration: tabelas `plans`, `tenant_subscriptions`, `stripe_connections`,
  `processed_stripe_events`
- Seed dos 3 planos com valores corretos (Digital Menu / Menu+Orders / Menu+Payments)
- Todos os tenants existentes migrados para plano `payments` (grandfathered)
- Types em `src/types/database.ts`
- Helper `getTenantPlan(tenantId)` retorna plano efetivo com overrides aplicados

**Critério de sucesso:**
- `SELECT * FROM plans` retorna 3 linhas com preços corretos
- Todos os tenants têm entrada em `tenant_subscriptions`
- `getTenantPlan` retorna override quando presente, valor do plano quando não

---

### Fase B — Superadmin: Gestão de Planos + Subscriptions
**O que entrega:**
- `/superadmin/plans` — lista de planos com edit inline (nome, preço mensal/anual,
  taxa de transação, features, is_active) — qualquer campo editável sem deploy
- `/superadmin/tenants/[id]` — aba "Subscription": plano atual, billing cycle,
  campos de override (monthly_price, annual_price, transaction_fee_pct, notes),
  botão "Save Override"
- Tabela de todos os tenants com plano atual visível na listagem

**Critério de sucesso:**
- Superadmin edita `monthly_price` de um plano → novo valor reflete imediatamente
  na consulta `getTenantPlan`
- Override salvo para tenant X → `getTenantPlan(X)` retorna override, não base
- Campo `override_notes` salvo e visível

---

### Fase C — Stripe Connect OAuth
**O que entrega:**
- Rota `/api/stripe/connect/oauth` — inicia OAuth redirect para Stripe
- Rota `/api/stripe/connect/callback` — recebe `code`, troca por
  `stripe_account_id` via `stripe.oauth.token()`, salva em `stripe_connections`
- Rota `/api/stripe/connect/disconnect` — desativa conexão
- Tenant Settings → aba "Subscription": botão "Connect Stripe" (visível apenas
  no plano `payments`), status da conexão, botão "Disconnect"
- Feature gate: `stripe_enabled` = plano é `payments` AND `stripe_connections` ativo

**Critério de sucesso:**
- Tenant em plano `payments` consegue completar OAuth e `stripe_connections`
  tem `stripe_account_id` salvo
- Tenant em plano `menu` ou `orders` não vê botão de conexão
- Disconnect desativa `is_active` na conexão

---

### Fase D — Payment Intent + Webhook
**O que entrega:**
- Ordem de pedido: se tenant tem Stripe conectado e plano `payments`,
  cria `PaymentIntent` com:
  - `amount`: total do pedido em centavos
  - `application_fee_amount`: `amount * transaction_fee_pct` do plano/override
  - `transfer_data.destination`: `stripe_account_id` do tenant
- Checkout na tela do cliente: Stripe Elements (hosted, fora do nosso PCI scope)
- Webhook handler `/api/stripe/webhook`:
  - `payment_intent.succeeded` → `orders.payment_status = 'paid'`
  - `payment_intent.payment_failed` → `orders.payment_status = 'failed'`
  - `charge.refunded` → `orders.payment_status = 'refunded'`
  - Idempotência via `processed_stripe_events`
- Nova coluna `orders.payment_status` e `orders.stripe_payment_intent_id`

**Critério de sucesso:**
- Pedido criado com Stripe ativo tem `stripe_payment_intent_id` não-nulo
- Webhook `payment_intent.succeeded` atualiza `payment_status = 'paid'`
- Evento duplicado não processa duas vezes (idempotência verificada)

---

### Fase E — Tenant Subscription UI
**O que entrega:**
- Tenant Settings → aba "Subscription": plano atual, preço efetivo (base ou override),
  billing cycle, data de renovação
- Botão "Upgrade" → mostra comparação dos 3 planos com preços atuais
  (lidos do DB, não hardcoded)
- KDS e menu público: se `payment_status` disponível, exibe badge de pagamento
  no card da ordem

**Critério de sucesso:**
- Tenant vê seu plano atual e preço efetivo (não hardcoded)
- Se superadmin aplicou override, tenant vê o preço customizado (não o base)
- Tabela de comparação de planos lê 100% do DB

---

## Regras críticas de implementação

1. **Zero hardcode de preços no código** — toda leitura de preço passa por
   `getTenantPlan()` que resolve override → base
2. **Stripe Standard OAuth** — tenant mantém controle total do seu Stripe dashboard
3. **Dinheiro nunca passa pela plataforma** — `transfer_data.destination` sempre
   apontando para o tenant
4. **PCI scope zero** — usar Stripe Elements/hosted Checkout, nunca capturar
   dados de cartão no nosso domínio
5. **Webhook idempotência** — `processed_stripe_events` com PK no `stripe_event_id`
6. **Override fields são nullable** — NULL = usa base do plano, valor = override;
   nunca misturar os dois
7. **Grandfathering** — tenants existentes ficam no plano mais alto na migração,
   com `override_notes = 'grandfathered on launch'`

---

## Breadcrumbs no codebase atual

- `src/types/database.ts` — adicionar `Plan`, `TenantSubscription`, `StripeConnection`
- `src/app/(admin)/settings/store/StoreClient.tsx` — adicionar aba "Subscription"
- `src/app/(superadmin)/` — novas páginas `/plans` e extensão `/tenants/[id]`
- `src/app/api/orders/route.ts` — ponto de injeção do PaymentIntent (Fase D)
- `supabase/migrations/` — próxima: `029_plans_subscriptions.sql`
- `.env.local` — adicionar: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `STRIPE_CLIENT_ID` (OAuth), `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`

---

## Notas

- **Billing da assinatura SaaS** (tenant pagando xmartmenu) está fora deste seed —
  cobrança é manual/offline por enquanto; sistema só gerencia qual plano o tenant tem
- **Free trial** — status `trial` está no schema, implementação futura
- **Múltiplos planos por tenant** — schema não suporta (UNIQUE em tenant_id),
  intencional para v1
- **Plano inativo** (`is_active = false`) não aparece para novos tenants mas
  tenants existentes no plano mantêm acesso (grandfather)
- **Refunds** — refund proporcional: plataforma devolve sua `application_fee`
  também; Stripe suporta isso via `refund.application_fee_refund`
