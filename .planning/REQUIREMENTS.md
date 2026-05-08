# Requirements: v1.4 Performance

## Observability & RUM

- [ ] **PERF-01**: Core Web Vitals (LCP, CLS, INP) são visíveis por rota no Vercel Speed Insights dashboard, com dados de produção reais
- [ ] **PERF-02**: Queries críticas do Supabase (menu público, pedidos, tenant lookup) têm timing logado e visível para análise de gargalos
- [ ] **PERF-03**: Lighthouse CI está configurado no GitHub Actions e bloqueia PRs que causem regressão de score acima de threshold definido

## Database Performance

- [ ] **DB-01**: Queries do menu público (`/{slug}`) têm EXPLAIN ANALYZE executado e índices adicionados onde o query planner usa Seq Scan desnecessário
- [ ] **DB-02**: Queries de pedidos (INSERT em orders/order_items, SELECT na orders view do admin) têm EXPLAIN ANALYZE executado e índices adicionados onde necessário
- [ ] **DB-03**: Queries de tenant lookup e auth middleware têm EXPLAIN ANALYZE executado e índices adicionados onde necessário

## Frontend Performance

- [ ] **FE-01**: Lighthouse audit na landing page (`/`) com score ≥ 90 mobile (meta definida após primeiro audit baseline)
- [ ] **FE-02**: Lighthouse audit no menu público (`/{slug}`) com score ≥ 90 mobile (meta definida após primeiro audit baseline)
- [x] **FE-03**: Bundle analysis com `@next/bundle-analyzer` identifica os maiores chunks e oportunidades de lazy loading
- [ ] **FE-04**: ISR e cache headers revisados — `revalidate` ajustado por rota com base nos padrões de acesso reais

## Future Requirements (deferred)

- RUM com plataforma externa (Datadog, New Relic) — Vercel Speed Insights cobre v1.4
- Edge caching (Cloudflare) — Vercel Edge já ativo
- Database connection pooling (PgBouncer) — escala para quando volume aumentar

## Out of Scope

- Migração de infraestrutura (novo provider, self-hosted) — Vercel + Supabase managed
- Performance de AI routes (seed, OCR) — latência aceitável por ser operação de superadmin, não crítica ao usuário final
- Mobile app performance — web-first

## Traceability

| Req ID | Phase | Status |
|--------|-------|--------|
| PERF-01 | Phase 14 | Pending |
| PERF-02 | Phase 14 | Pending |
| FE-03 | Phase 14 | Complete |
| DB-01 | Phase 15 | Pending |
| DB-02 | Phase 15 | Pending |
| DB-03 | Phase 15 | Pending |
| FE-01 | Phase 16 | Pending |
| FE-02 | Phase 16 | Pending |
| FE-04 | Phase 16 | Pending |
| PERF-03 | Phase 17 | Pending |
