# Requirements: v1.6 Operations

## KDS Dashboard

- [ ] **KDS-01**: Admin vê pedidos em grid de cards — uma card por pedido com status colorido (pending=azul, preparing=amarelo, ready=verde, done=cinza, cancelled=vermelho)
- [ ] **KDS-02**: Cada card exibe: número do pedido, lista resumida de itens, total, tempo decorrido desde `created_at`
- [ ] **KDS-03**: Timer de tempo decorrido atualiza a cada ~30s; chip fica âmbar >10min, vermelho >20min
- [ ] **KDS-04**: Admin avança status do pedido diretamente no card (Pendente → Em preparo → Pronto → Concluído / Cancelado)
- [ ] **KDS-05**: Toggle grid/lista — grid = tablet de cozinha (cards grandes), lista = tabela atual mantida; preferência persiste em localStorage por tenant
- [ ] **KDS-06**: Novos pedidos aparecem sem reload manual — Supabase Realtime subscription ou polling 15s como fallback

## Per-Item Notes

- [ ] **NOTE-01**: Tenant habilita notas por item via `item_notes_enabled` boolean (no mesmo padrão de `direct_orders_enabled`)
- [ ] **NOTE-02**: Cliente vê textarea "Observações" no modal de produto, limitado a 140 chars com contador, quando flag ativada
- [ ] **NOTE-03**: Nota salva em `order_items.notes TEXT` — validada e truncada server-side; strip de control chars
- [ ] **NOTE-04**: KDS card e tabela admin orders renderizam nota por item de forma visualmente destacada (ícone, itálico ou cor distinta)

## Out of Scope

- Thresholds configuráveis por tenant (amber/red timing) — defer v1.7
- Alerta sonoro para novos pedidos — defer v1.7
- Catálogo de ingredientes (SEED-008 Phases A-C) — defer v1.7
- Stripe Connect (SEED-003) — defer posterior
- Filtros por status no KDS (mostrar só pending/preparing) — defer v1.7
- WhatsApp export com notes por item — defer v1.7 (junto com KDS completo)

## Traceability

| Req ID | Phase | Status |
|--------|-------|--------|
| KDS-01 | Phase 21 | Pending |
| KDS-02 | Phase 21 | Pending |
| KDS-03 | Phase 21 | Pending |
| KDS-04 | Phase 21 | Pending |
| KDS-05 | Phase 21 | Pending |
| KDS-06 | Phase 22 | Pending |
| NOTE-01 | Phase 22 | Pending |
| NOTE-02 | Phase 22 | Pending |
| NOTE-03 | Phase 22 | Pending |
| NOTE-04 | Phase 22 | Pending |
