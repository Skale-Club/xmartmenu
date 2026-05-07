# Phase 11: Menu Photo OCR — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-07
**Phase:** 11-menu-photo-ocr
**Areas discussed:** Additive vs merge vs replace, Extraction depth, Price failure flag (AI-12)

---

## Additive vs merge vs replace

| Option | Description | Selected |
|--------|-------------|----------|
| Additive only | Skip existing by name match; safe to re-run | ✓ |
| Replace all | Delete and rewrite; destructive | |
| Merge — update existing + add new | Complex name matching | |

**User's choice:** Additive only.
**Notes:** Matches Phase 9 D-07 policy. Superadmin clears unwanted items manually before re-running.

---

## Extraction depth

| Option | Description | Selected |
|--------|-------------|----------|
| Name + price only | Simplest; no descriptions | |
| Name + price + description | Also captures description if readable; null otherwise | ✓ |
| Name + price + description + extras | Portions, modifiers, ranges — high hallucination risk | |

**User's choice:** Name + price + description (when readable, null otherwise).
**Notes:** `products.description TEXT` column already exists. GPT-4.1-mini explicitly instructed not to hallucinate descriptions.

---

## Price failure flag (AI-12)

| Option | Description | Selected |
|--------|-------------|----------|
| price=0 is the signal | No schema change; superadmin sees $0 and knows to fix | ✓ |
| Add price_parsing_failed column | New migration; more explicit | |
| Suffix product name | Visible without opening edit; ugly | |

**User's choice:** price=0 is the signal.
**Notes:** No new migration needed. Satisfies REQ AI-12. `price NUMERIC(10,2) NOT NULL` accepts 0.

---

## Claude's Discretion

- Exact GPT-4.1-mini model string — researcher confirms
- Whether ocr-upload-token and ocr-process are separate route files or one file with GET/POST
- Position ordering for extracted categories/products
- Whether to clean up OCR photo from Storage after processing
- Exact prompt engineering for structured JSON extraction

## Deferred Ideas

- Review screen before commit (explicitly out of scope per REQUIREMENTS.md)
- Multiple photo uploads per OCR run
- Handwritten menu OCR (low-quality photo enhancement)
- Client-side image compression
