# Requirements: v1.9 Performance Gaps

## DB Performance (RLS Indices)

- [x] **PERF-01**: `CREATE INDEX IF NOT EXISTS idx_profiles_tenant ON profiles(tenant_id)` — a função `auth_tenant_id()` usada em TODOS os RLS checks faz scan em `profiles` por `user_id`; este índice elimina o sequential scan complementar em `tenant_id`
- [x] **PERF-02**: `CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role)` — `is_superadmin()` filtra `profiles.role = 'superadmin'`; sem índice é sequential scan
- [x] **PERF-03**: `CREATE INDEX IF NOT EXISTS idx_profiles_tenant_role ON profiles(tenant_id, role)` — cobre filtros compostos em queries de staff e permissões

## CDN / Storage Headers

- [x] **PERF-04**: Buckets `tenant-assets` e `product-images` no Supabase Storage configurados com `Cache-Control: public, max-age=31536000, immutable` — toda imagem carregada serve com header de cache longo; browsers não re-solicitam a mesma URL

## MenuPage Decomposição

- [x] **PERF-05**: `ProductModal` extraído de `MenuPage.tsx` (~1200 linhas) para `src/components/menu/ProductModal.tsx` — componente autônomo com suas props explícitas; `MenuPage.tsx` importa via dynamic import com `ssr: false` para lazy-load
- [x] **PERF-06**: `CartModal` + formulário de pedido extraídos para `src/components/menu/CartModal.tsx` — mesmo padrão de dynamic import; reduz JS inicial do menu público

## Out of Scope

- N+1 na staff route — impacto baixo (rota admin, não pública)
- Edge runtime para `/{slug}` — ISR já cobre bem; complexidade vs ganho não justifica
- p99 alerting / RUM dashboards — Speed Insights já instalado cobre isso
- Responsive image variants (256w/512w) — defer

## Traceability

| Req ID | Phase | Status |
|--------|-------|--------|
| PERF-01 | Phase 28 | ✅ Done (2026-05-08) |
| PERF-02 | Phase 28 | ✅ Done (2026-05-08) |
| PERF-03 | Phase 28 | ✅ Done (2026-05-08) |
| PERF-04 | Phase 28 | ✅ Done (2026-05-08) |
| PERF-05 | Phase 29 | ✅ Done (2026-05-08) |
| PERF-06 | Phase 29 | ✅ Done (2026-05-08) |
