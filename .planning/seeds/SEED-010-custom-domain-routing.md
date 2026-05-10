---
id: SEED-010
status: completed
completed: 2026-05-10
completed_in: v2.1 (Custom Domains milestone — phase 35)
planted: 2026-05-10
planted_during: current-session
trigger_when: quando estivermos implementando infraestrutura para domínios customizados, ou expandindo para SaaS com identidade própria por cliente
scope: Small
---

# SEED-010: Domínios customizados por cliente

## Why This Matters

Hoje o link do menu do cliente é `xmartmenu.skale.club/nomedocliente`. O objetivo é permitir que cada cliente cadastre seu próprio domínio (ex: `sitedocliente.com`) e acesse diretamente, sem o slug do XmartMenu na URL. Isso dá identidade profissional ao negócio e é um passo fundamental para consolidar o XmartMenu como plataforma SaaS com marca branca.

## When to Surface

**Trigger:** quando estivermos implementando infraestrutura para domínios customizados, ou expandindo para SaaS com identidade própria por cliente

Este seed deve ser apresentado durante `/gsd-new-milestone` quando o milestone scope envolve:
- infraestrutura de domínios customizados
- tenancy via hostname em vez de pathname
- marca branca / white-label

## Scope Estimate

**Small** — Estimativa de poucas horas a 1-2 dias. Envolve:
1. Novo campo `custom_domain` na tabela `tenants` + migração
2. Middleware que resolve tenant pelo hostname (`request.headers.get('host')`)
3. Tela no admin do cliente para cadastrar/validar o domínio
4. Instruções de DNS (CNAME) no painel do cliente
5. Bypass do slug no pathname para tenants com domínio customizado

## Breadcrumbs

- `src/middleware.ts:13` — Resolução de rotas, ponto de entrada para detectar hostname
- `src/lib/supabase/middleware.ts` — Session handling atual
- `supabase/migrations/` — Estrutura da tabela `tenants`
- `src/app/api/admin/tenants/` — API de CRUD de tenant
- `src/app/(admin)/settings/store/` — Settings atual do tenant
- `src/app/(public)/[slug]/` — Página pública do menu (será afetada pelo routing change)
- `src/types/database.ts` — Definição do tipo `Tenant`

## Notes

O middleware já tem lógica de `BLOCKED_TENANT_SLUGS` que identifica o slug do tenant pelo pathname. A mudança central é resolver o tenant pelo `host` header em vez do path — algo relativamente pontual. A complexidade maior está em:
1. Validar que o domínio aponta para o servidor (check CNAME)
2. Evitar conflitos se o domínio customizado coincidir com rotas internas
3. Experiência de setup clara para o cliente
