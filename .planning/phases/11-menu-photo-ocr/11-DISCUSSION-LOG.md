# Phase 11: Menu Photo OCR — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-07
**Phase:** 11-menu-photo-ocr
**Areas discussed:** Multi-photo / multi-page handling, Processing model (sync vs async)

---

## Gray Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Parsing de preço (locale) | R$12,50 vs €12.50 — LLMs erram fácil. Definir approach explicitamente. | |
| Múltiplas páginas/fotos | Upload de uma foto por vez vs múltiplas; cada upload um job ou batch combinado. | ✓ |
| Conflito com dados existentes + UX | Dedup strategy e processing UX (sync vs async) | |
| Escopo de extração + pré-processamento | Quais campos extrair; client-side resize ou não | |

**User's choice:** Múltiplas páginas/fotos (single area selected)

---

## Multi-photo / Multi-page Handling

### Sub-decision 1: Upload Mode

| Option | Description | Selected |
|--------|-------------|----------|
| Múltiplas fotos por sessão, processadas juntas | 1–6 fotos drag-and-drop, processadas em sequência ou batch numa chamada GPT. Resultado consolidado. | |
| Uma foto por vez (síncrono) | Sobe foto → vê resultado escrito → sobe a próxima. Simples, dedup natural via D-07 additive. | ✓ |
| Só 1 foto, sem suporte multi-página | MVP mínimo; multi-página vira deferred. | |

**User's choice:** Uma foto por vez (síncrono)
**Rationale:** Simplest MVP; the additive D-07 rule from Phase 9 naturally handles overlapping page headers (e.g., "Pizzas" on multiple pages). User can upload pages sequentially.

### Sub-decision 2: Processing Model

| Option | Description | Selected |
|--------|-------------|----------|
| Chamada síncrona simples | POST único, ~30s loading spinner, retorna {category_count, product_count, errors}. Sem ai_jobs/polling. | ✓ |
| Reusar `ai_jobs` + polling (consistência com Fase 10) | Mesmo padrão da Fase 10: cria ai_jobs row → dispara → polling. Mais código, robusto pra timeout. | |
| Você decide (Claude pega o melhor pra MVP) | Claude escolhe baseado no balanço complexidade/robustez. | |

**User's choice:** Chamada síncrona simples
**Rationale:** GPT-4.1-mini vision typically completes in 10-30s, well within Vercel's 300s Pro limit. No need for the async/polling pattern that Phase 10 needed for multi-image generation.

---

## Wrap-up Decision

**Question:** Decidimos: 1 foto por vez, síncrona. Quer explorar mais alguma decisão antes de criar CONTEXT.md?

| Option | Description | Selected |
|--------|-------------|----------|
| Pronto pra criar CONTEXT.md | Decisões restantes viram Claude's Discretion com defaults sensatos | ✓ |
| Discutir parsing de preço (locale) | R$12,50 vs €12.50 explicit handling | |
| Discutir escopo de extração | Só nome+preço, ou também descrição/categoria/imagem? | |
| Discutir conflito com dados existentes | Match strategy for dedup | |

**User's choice:** Pronto pra criar CONTEXT.md
**Rationale:** User trusted Claude's defaults for the remaining areas — those are documented as Claude's Discretion in CONTEXT.md.

---

## Claude's Discretion (delegated to planner)

- **Price locale parsing:** Default to pt-BR (R$12,50 with comma as decimal). Pass `business_type` and tenant primary language as hints in the OCR prompt for non-Brazilian menus. On parse failure → save as `0` (per AI-12).
- **Extraction scope:** Extract category name + product name + product price + product description (when visible). Do NOT crop product images from the photo.
- **Client-side preprocessing:** Resize to ~2MP (1920×1080) using `canvas.toBlob()` if photo > 3 MB; skip below 3 MB.
- **OCR prompt + JSON schema:** Planner designs structured output `{ categories: [{ name, products: [{ name, description?, price_raw, price_parsed }] }] }`.
- **API route structure:** Planner decides single route vs split (`ocr-upload-token` + `ocr-process`).
- **Client UI layout:** Planner places the upload control + result display in the AI Tools section.

## Deferred Ideas

- Multi-page batch upload (single combined LLM call for 6 photos)
- Review/staging screen before commit (explicitly out of scope per REQUIREMENTS.md)
- Product image cropping from menu photo
- Handwritten menu enhancement
- Tenant-facing OCR (self-service)
- Daily rate limiting
- Async processing with ai_jobs (deferred unless latency exceeds Vercel limits in practice)
