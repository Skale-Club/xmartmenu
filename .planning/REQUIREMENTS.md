# Requirements: v1.7 Customization

## Schema & Infrastructure

- [ ] **INGR-01**: Tabela `ingredients` criada com RLS por tenant — campos: `id`, `tenant_id`, `name TEXT NOT NULL`, `image_url TEXT`, `default_extra_price NUMERIC(10,2) DEFAULT 0`, `default_add_price NUMERIC(10,2) DEFAULT 0`, `is_available BOOLEAN DEFAULT true`, `position INTEGER DEFAULT 0`, `translations JSONB DEFAULT '{}'`
- [ ] **INGR-02**: Tabela `product_ingredients` join criada com RLS — campos: `product_id`, `ingredient_id`, `tenant_id`, `is_default BOOLEAN DEFAULT false`, `extra_price_override NUMERIC(10,2)`, `add_price_override NUMERIC(10,2)`, `position INTEGER DEFAULT 0`; UNIQUE(product_id, ingredient_id); índice em (product_id, tenant_id)
- [ ] **INGR-03**: Flag `ingredient_customization_enabled BOOLEAN NOT NULL DEFAULT false` adicionada em `tenant_settings`
- [ ] **INGR-04**: Coluna `ingredient_modifications JSONB` adicionada em `order_items` para persistir remoções, extras e adições estruturadas

## Admin Catalog

- [ ] **INGR-05**: Página `/admin/menu/ingredients` com CRUD completo — criar/editar/excluir ingrediente (name, default_extra_price, default_add_price, availability toggle, drag-to-reorder), visível apenas quando `ingredient_customization_enabled` está ativa
- [ ] **INGR-06**: Tab "Ingredientes" no editor de produto (`/admin/menu/products/[id]`) — multi-select picker do catálogo de ingredientes; para cada ingrediente selecionado: toggle `is_default` e campos de override de preço por produto (fallback para preços do catálogo quando vazios)

## Customer UI

- [ ] **INGR-07**: Painel de customização no `ProductModal` — chips pré-marcados com stepper −/+ para ingredientes com `is_default=true` (−1=remover grátis, 0=padrão, +1=extra com preço se > 0), botão "Adicionar ingrediente" com lista de ingredientes `is_default=false` disponíveis; painel visível apenas quando `ingredient_customization_enabled` e produto tem `product_ingredients`
- [ ] **INGR-08**: Preço recalculado em tempo real no painel conforme modificações; chip de preço visível apenas quando custo > 0 (ex: "+R$5,00"); remoção sempre gratuita em v1.7
- [ ] **INGR-09**: Modificações persistidas em `order_items.ingredient_modifications JSONB` via orders POST API com estrutura `{removed:[{ingredient_id, name}], extras:[{ingredient_id, name, qty, unit_price}], added:[{ingredient_id, name, qty, unit_price}]}`

## Kitchen Display

- [ ] **INGR-10**: KDS card e modal admin orders renderizam `ingredient_modifications` de forma destacada — ingredientes removidos com prefixo "SEM" (vermelho/strikethrough), extras com "+qty" (âmbar), adicionados com "+" (verde)

## Out of Scope

- Cobrar por remoção de ingrediente — defer v1.8 (raro, adiciona complexidade de display)
- Nutrition info / allergen tagging — futuro
- Ingrediente inline no editor de produto (sempre via catálogo) — por design
- WhatsApp export com modificações — defer (junto com KDS Phase C completo)
- Responsive variants / AVIF — fora de escopo desta milestone
- Drag-to-reorder para `product_ingredients` (só catálogo tem reorder em v1.7)

## Traceability

| Req ID | Phase | Status |
|--------|-------|--------|
| INGR-01 | Phase 23 | Pending |
| INGR-02 | Phase 23 | Pending |
| INGR-03 | Phase 23 | Pending |
| INGR-04 | Phase 23 | Pending |
| INGR-05 | Phase 24 | Pending |
| INGR-06 | Phase 24 | Pending |
| INGR-07 | Phase 25 | Pending |
| INGR-08 | Phase 25 | Pending |
| INGR-09 | Phase 25 | Pending |
| INGR-10 | Phase 25 | Pending |
