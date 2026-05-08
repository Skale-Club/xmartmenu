# Requirements: v1.8 KDS+

## KDS Thresholds

- [x] **KDS-07**: `tenant_settings` recebe `amber_threshold_minutes INT NOT NULL DEFAULT 10` e `red_threshold_minutes INT NOT NULL DEFAULT 20` — migration 027 com `IF NOT EXISTS`
- [x] **KDS-08**: Admin configura os thresholds no Store Settings — dois campos numéricos (1-120 min) com validação server-side: `amber < red`, ambos `> 0`; salva via upsert existente
- [x] **KDS-09**: `useElapsedTime` hook aceita `amberMinutes` e `redMinutes` como props (em vez de constantes hardcoded `AMBER_MINUTES=10`, `RED_MINUTES=20`); `OrdersClient` passa os valores do tenant

## Filter Chips

- [ ] **KDS-10**: KDS exibe chips de filtro acima do grid: "Pendentes" (`pending`), "Em preparo" (`preparing`), "Prontos" (`ready`), "Todos" — padrão `['pending', 'preparing']`; filtro aplicado localmente sobre os pedidos já carregados
- [ ] **KDS-11**: Filtro ativo persiste em localStorage por tenant (`kds_filter_{tenantId}`); restaurado ao montar o componente via `useEffect`

## Alerta Sonoro

- [ ] **KDS-12**: KDS emite um beep via Web Audio API (`AudioContext`) quando um novo pedido `pending` chega via Realtime INSERT; não toca quando `muted` está ativo; não toca para status updates (só INSERT)
- [ ] **KDS-13**: Botão mute/unmute no cabeçalho do KDS (ícone Bell/BellOff de lucide-react); estado `muted` persiste em localStorage (`kds_mute_{tenantId}`)

## Out of Scope

- Notificações push (PWA) — defer
- Sons customizáveis por tenant — defer
- Filtros múltiplos simultâneos (ex: pending E ready ao mesmo tempo) — defer; chips são mutuamente exclusivos ou "Todos"
- Threshold de som separado do threshold visual — defer

## Traceability

| Req ID | Phase | Status |
|--------|-------|--------|
| KDS-07 | Phase 26 | Done (26-01) |
| KDS-08 | Phase 26 | Done (26-01) |
| KDS-09 | Phase 26 | Done (26-01) |
| KDS-10 | Phase 27 | Pending |
| KDS-11 | Phase 27 | Pending |
| KDS-12 | Phase 27 | Pending |
| KDS-13 | Phase 27 | Pending |
