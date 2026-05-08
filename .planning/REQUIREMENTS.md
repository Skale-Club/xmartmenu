# Requirements: v1.5 Image Optimization

## Upload Pipeline

- [x] **IMG-01**: Todo upload de produto via admin (`ProductsClient.tsx`) passa por `validateAndConvertToWebP` antes de ir para o Supabase Storage — nenhum PNG/JPEG bruto é aceito
- [ ] **IMG-02**: Upload de logo e banner via superadmin (`upload/route.ts`) passa pelo conversor WebP — arquivo bruto não atinge o Storage
- [ ] **IMG-03**: `next.config.ts` declara `formats: ['image/webp']` e `deviceSizes` alinhados com os tamanhos emitidos pelo conversor

## Rendering Admin

- [ ] **IMG-04**: `BrandingClient.tsx` — logo e banner preview usam `next/image` com `width`/`height` ou `fill` + `sizes` corretos
- [ ] **IMG-05**: `ProductsClient.tsx` — grade de produtos admin usa `next/image` com `sizes` de grid correto
- [ ] **IMG-06**: `TenantsClient.tsx` e `TenantDetailClient.tsx` — logos de tenant no superadmin usam `next/image`

## Out of Scope

- Backfill de storage legado — sem tenants reais ainda, sem urgência
- AVIF — defer; suporte Safari pré-2024 é fraco
- CDN headers — defer para SEED-004 perf milestone
- Responsive variants (256w/512w/1024w) — defer; single WebP já resolve 889 KB

## Traceability

| Req ID | Phase | Status |
|--------|-------|--------|
| IMG-01 | Phase 18 | Complete |
| IMG-02 | Phase 18 | Pending |
| IMG-03 | Phase 18 | Pending |
| IMG-04 | Phase 19 | Pending |
| IMG-05 | Phase 19 | Pending |
| IMG-06 | Phase 19 | Pending |
