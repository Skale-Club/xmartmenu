# Feature Landscape: AI-Powered Tenant Onboarding (v1.2)

**Domain:** AI-assisted SaaS onboarding — restaurant/food-service digital menu platform
**Researched:** 2026-05-06
**Milestone scope:** NEW features only — LLM text seeding, AI image seeding, menu photo OCR

---

## Context: What Already Exists

The following are in production and out of scope for this milestone:

- Multi-tenant menu management (categories, products, option groups)
- Admin panel (menus, products, settings, branding, staff)
- Supabase Storage with WebP image conversion (Sharp)
- Onboarding wizard: 4-step flow collecting company name, business type, contact info, menu name, first category + product
- `business_type` captured at step 1 and stored as `menu.purpose` (values: restaurant, bar, cafe, hotel, salon, retail, other)
- `TenantSettings.banner_url` and `Product.image_url` / `Product.image_urls` fields ready to receive images

These are the integration points the AI features write into.

---

## Feature 1: LLM Text Seeding

### What This Is

After the user selects their business type and company name in the onboarding wizard, an LLM generates a full starter menu: multiple categories with realistic names, 3–6 products per category with names, descriptions, and suggested prices. The user gets a populated menu instead of a blank canvas.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---|---|---|---|
| Generate categories from business type | Users expect AI to know "pizzeria" → ["Pizzas", "Calzones", "Drinks", "Desserts"] | Low | Entirely in the prompt |
| Generate product names per category | Without items, the seeding is useless | Low | 3–6 items per category is the right density |
| Generate product descriptions (1–2 sentences) | Empty description fields look broken in the public menu; descriptions drive purchase decisions | Low | Tone should match business type (casual for bar, appetizing for restaurant) |
| Suggested prices | Users need a number to start from — even if they change it | Low-Medium | Must be locale-agnostic (no hardcoded "$"). Return a numeric value; the existing currency setting handles symbol display |
| Progress indicator / loading state | LLM calls take 2–8 seconds; blank UI with no feedback causes users to click away | Low | Spinner + "Generating your menu..." message is sufficient |
| Error handling + retry | If the LLM call fails, the user must not be stuck | Low | Single retry button; never auto-commit silently on error |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| Company name injected into copy | "Welcome to Joe's Pizza" tagline instead of generic lorem ipsum | Low | Pass `company_name` into the prompt; tiny lift, high perceived personalization |
| Edit-before-save review screen | User sees the generated content in an editable table/list before it's committed to DB | Medium | This is the trust mechanism — see UX Flow below |
| Streaming generation (token-by-token) | Content appears word-by-word, faster perceived response | Medium | Vercel AI SDK `streamObject` with `useObject` hook. Requires route handler returning a stream. Only worth it if generation exceeds ~4 seconds |
| Regenerate individual item | User can click a refresh icon on a single product to re-roll just that description | Medium | Separate API call scoped to one item; prevents full regeneration on minor dissatisfaction |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|---|---|---|
| Auto-commit generated content without review | OCR and LLM output is imperfect; auto-saving wrong data destroys trust in the feature | Always show a review/edit screen before writing to DB |
| Generate prices in a specific currency symbol | Hard-codes assumptions about locale; breaks for non-USD tenants | Return raw numeric values; let the existing `currency` field in `TenantSettings` handle display |
| Generate allergen/ingredient lists | Out of scope for v1.2; introduces legal risk if inaccurate | Defer to v1.3+. Do not hallucinate medical/dietary data |
| Use a different AI model per call | Multiple provider dependencies add complexity and cost ambiguity | Pick one provider (OpenAI) for this milestone; swap later if needed |
| Attempt to generate option groups / variants | The option group schema is complex (type, price_rule, required, min/max); LLM-generated variants require deep review and have high error rate | Seed flat products only; users add option groups manually in the admin panel |

### UX Flow (Text Seeding)

```
Onboarding step 1: user enters company_name + selects business_type
                         |
                         v
Onboarding step 2–4: contact info, menu name (existing steps — unchanged)
                         |
                         v
[NEW STEP 4.5 — AI Seed Offer]
  Card shown: "Let AI populate your menu"
  Toggle: "Generate categories and products" (default ON)
  CTA: "Generate my menu" or "Skip, I'll add manually"
                         |
         ┌───────────────┴────────────────┐
         v                                v
   [AI Generation]                   [Manual path]
   Loading state                     Existing step 5
   "Generating your menu..."         (finish / dashboard)
         |
         v
   [Review Screen — NEW PAGE]
   Editable list of categories, each with
   expandable product rows (name, description, price)
   - Edit any field inline
   - Delete a row
   - Add a row manually
   - "Regenerate" icon per category or per item
   CTA: "Save this menu" → writes to DB → success screen
   Alt: "Start from scratch" → discards, goes to empty admin
```

### Dependencies on Existing System

- `business_type` (Step 1, already collected) → primary LLM context variable
- `company_name` (Step 1, already collected) → injected into prompt for personalization
- `menu_id` (created during existing onboarding submit) → categories and products write to this menu
- `tenant_id` → RLS scoping for all inserts
- `categories` and `products` tables → target tables for seeded data
- `Product.description` field → currently nullable, receives generated text
- Existing `/api/onboarding` route → the new AI seeding routes are separate; onboarding route remains for tenant/menu creation

---

## Feature 2: AI Image Seeding

### What This Is

After text seeding (or independently), the system generates a cover/banner photo for the restaurant (`TenantSettings.banner_url`) and optionally per-item product photos (`Product.image_url`) using an image generation API. All images go through a review/approve step before being saved to Supabase Storage.

### The Core Decision: Generation vs. Stock Photos

**MEDIUM confidence finding.** Two production approaches exist:

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| AI generation (DALL-E 3 / GPT Image) | Unique images, can be prompted with business context | $0.04–$0.12 per image, quality inconsistent for specific dishes, images don't show actual food | Use for cover/banner only |
| Stock photo API (Unsplash / Pexels) | Free, high quality, instant, reliable | Generic, requires attribution in some cases, not specific to the tenant's actual dishes | Use for per-item product photos |
| Hybrid (AI for cover, stock for items) | Best cost/quality tradeoff | Two integrations | Recommended approach |

**Key insight from research:** AI-generated food images are a known trust risk. Customers order expecting the photo to match what arrives. For per-item photos, a high-quality generic stock photo of "margherita pizza" is safer and better-looking than a DALL-E hallucination of a margherita pizza. Use AI generation for the cover/hero banner where brand tone matters more than food accuracy.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---|---|---|---|
| Cover/banner image generated | `TenantSettings.banner_url` is empty by default; a blank banner makes the public menu look unfinished | Medium | One API call per tenant; prompt = business_type + company_name |
| Per-item images from stock API | `Product.image_url` is empty for all seeded products; product cards without images look sparse | Medium | Query = product name + business_type; Unsplash or Pexels search |
| Review/approve screen before saving | Images write to Supabase Storage; bad images must be rejectable | Medium | See UX Flow below |
| Upload to Supabase Storage (existing infra) | Consistent with how existing product images are stored | Low | Re-use existing storage bucket and WebP pipeline |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| Per-item image swap (try another) | If the stock photo result is wrong, user can request a different one without regenerating everything | Medium | Re-query the stock API with the same search term, return next result |
| Skip individual items | Some items don't need photos; user can uncheck them before saving | Low | Checkbox per row in review screen |
| Opt-in toggle (separate from text seeding) | Image generation is visually impactful but not everyone wants it; opt-in respects hesitation | Low | Independent toggle in the AI Seed Offer card |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|---|---|---|
| Auto-save images without review | Cover images may be wildly off-brand (e.g., DALL-E generates a fast food look for a fine dining restaurant) | Show all generated images in a grid review screen with approve/swap/skip per item |
| Generate images for every product simultaneously at generation click | 10+ parallel image API calls on click is expensive, slow, and may hit rate limits | Queue sequentially or batch in groups of 3–5; show progress per item |
| Allow unlimited image generation per tenant in free tier | At $0.04–$0.12 per DALL-E image, 10 products = $0.40–$1.20 per tenant onboarding; costs accumulate fast | Rate-limit image generation per tenant per day (e.g., 1 cover + 10 items max in free tier). Store a counter in `tenant_settings` or a new `ai_usage` table |
| Use AI generation for per-item product photos | See The Core Decision above — misleads customers about actual food appearance | Use stock photo APIs for per-item; AI only for cover |
| Store raw image URLs from external sources | External URLs break; Unsplash hotlinking has ToS constraints | Always download and re-upload to Supabase Storage |

### UX Flow (Image Seeding)

```
[Review Screen from Text Seeding] or [Separate entry from Admin Panel]
                         |
                         v
[Image Seed Offer Card]
  "Add photos to your menu"
  Checkboxes:
    [x] Cover / banner photo (AI generated)
    [x] Product photos (from stock library)
  CTA: "Generate photos"
                         |
                         v
[Image Generation Loading]
  Progress: "1 of 12 photos..."
  Sequential/batched calls to DALL-E (cover) + Pexels/Unsplash (products)
                         |
                         v
[Image Review Grid]
  Row per item:
    Thumbnail | Item name | [Approve] [Try another] [Skip]
  "Save approved photos" → uploads to Supabase Storage → writes URLs to DB
  "Skip all" → continues without images
```

### Dependencies on Existing System

- `TenantSettings.banner_url` → target field for cover image
- `Product.image_url` → target field for per-item images
- Supabase Storage bucket + existing WebP Sharp pipeline → re-use exactly as-is
- `tenant_id` → rate-limit tracking and storage path scoping
- Text seeding product list → the image seeding needs product names to query the stock API; text seeding should complete first or run in parallel with names available

---

## Feature 3: Menu Photo OCR

### What This Is

The user photographs their existing printed menu (one or multiple pages). The image is sent to GPT-4o Vision which extracts the text, then an LLM pass structures it into categories and items with names, descriptions (if present), and prices. The extracted data goes through a mandatory review/edit screen before being committed to the database.

### Why GPT-4o Vision Is the Right Tool (HIGH confidence)

Traditional OCR (Tesseract, Google Vision) reads characters but doesn't understand food service domain semantics — it can't distinguish a section header from an item name, or a price from a weight. GPT-4o Vision handles layout understanding + domain reasoning in a single call. For menus with non-standard layouts, handwritten specials boards, or mixed languages, the single-model approach outperforms OCR + NLP pipelines.

**Structured Outputs** (OpenAI `response_format: {type: "json_schema"}`) eliminate JSON parsing errors and ensure the extraction always returns the expected schema shape.

### The Mandatory Pitfall: OCR Will Be Wrong

Blurry photos, handwritten text, unusual fonts, multi-column layouts, page overlap, and glare all degrade extraction quality. A production OCR pipeline must assume some extraction failure and make correction easy, not hide it. The review screen is not optional polish — it is a functional requirement.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---|---|---|---|
| Photo upload (mobile + desktop) | The primary use case is a restaurant owner photographing their laminated menu on a table — mobile camera, not a scanner | Low | Standard `<input type="file" accept="image/*" capture="environment">` |
| Send image to GPT-4o Vision + structured extraction | Core feature — returns `{categories: [{name, items: [{name, description?, price?}]}]}` JSON | Medium | Single API call; use OpenAI Structured Outputs for schema enforcement |
| Loading/progress state | Extraction takes 5–20 seconds depending on menu complexity | Low | "Reading your menu..." spinner is sufficient |
| Review/edit screen before saving | Mandatory — prices will be wrong, items will be merged or split, descriptions will be garbled | High | This is the most important UX investment in the whole feature — see UX Flow |
| Ability to delete extracted items | User may not want everything from the old menu in the digital version | Low | Delete row button in review screen |
| Ability to edit all fields | Name, description, price — all must be editable before commit | Low-Medium | Inline editing in the review table |
| Error state for bad image quality | Graceful failure when the model can't extract enough data | Low | Show error + "Try a clearer photo" message |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| Multi-page support (upload multiple images) | Long menus span multiple pages; a single-photo limit forces multiple onboarding sessions | Medium | Accept multiple files; send each image separately; merge results client-side before review |
| Image quality pre-check | Warn user before sending if image is too small/blurry (via canvas analysis) | Medium | Reduces failed API calls and user frustration |
| Manual add row in review screen | User may notice a missing item and add it without re-uploading | Low | "+ Add item" button per category row |
| Move item between categories in review | OCR may place items in the wrong category | Medium | Drag-and-drop or category selector dropdown per item row |
| "Save as draft" | User can stop mid-review and return later | High | Requires persisting draft state; defer unless explicitly required |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|---|---|---|
| Auto-commit extracted data without review | Price extraction errors are common (e.g., $12 parsed as $1.2, or weight confused with price); auto-committing wrong prices directly damages the business | Mandatory review screen — never skip it |
| Show raw OCR text to user | Users don't care about intermediate OCR output; showing it creates confusion and appears unpolished | Show only the structured extraction result in the review table |
| Upload full-resolution images to OCR API | A 12MP phone photo is 3–6MB; sending full-res wastes tokens and time | Resize to max 2048px on the longest side before sending; JPEG at 80% quality |
| Extract and commit ingredients/allergens | High error rate; legal liability if wrong | Only extract: category, item name, description (optional), price (optional) |
| Accept PDFs | PDF parsing adds a different code path (pdf → image conversion); scope creep for v1 | Image files only (JPEG, PNG, WebP). Add PDF in v1.3+ |
| Attempt to map OCR items to existing catalog | The tenant is new; there is no existing catalog to map to | Insert as net-new items; user manages deduplication manually if needed |

### UX Flow (Menu Photo OCR)

```
Entry points:
  A) Onboarding AI Seed Offer card: "Or scan your existing menu" link
  B) Admin panel: Menu > "Import from photo" button (post-onboarding)

                         v
[Upload Screen]
  Drag-and-drop or camera button
  Accept: JPEG, PNG, WebP (multiple files for multi-page)
  Max: 10MB per file, 5 files total
  CTA: "Extract menu items"
                         |
                         v
[Image resize (client-side, before upload)]
  Canvas resize to max 2048px
                         |
                         v
[API Route: POST /api/ai/ocr-menu]
  Sends image(s) to GPT-4o Vision
  Prompt: extract categories + items + prices → JSON schema via Structured Outputs
  Returns: { categories: [{ name, items: [{ name, description, price }] }] }
                         |
                         v
[Loading State: "Reading your menu..." 5–20s]
                         |
         ┌───────────────┴────────────────┐
         v                                v
   [Extraction success]             [Extraction failure]
   Review screen                    Error message + retry
         |
         v
[Review + Edit Screen]
  Table grouped by category
  Each row: [ ] checkbox | Item name (editable) | Description (editable) | Price (editable) | [Delete]
  Category header: editable name | [+ Add item] | [Delete category]
  Footer: [+ Add category]
  "Save to menu" → bulk inserts via existing categories/products DB pattern → success
  "Discard" → nothing saved, back to menu
```

### Dependencies on Existing System

- `Category` and `Product` DB tables + RLS → the review screen commits to these exact tables using the same shape as the existing onboarding API
- `menu_id` → must be known before committing; the OCR flow is always scoped to a specific menu
- `tenant_id` → RLS isolation
- `Product.description` (nullable) → receives extracted descriptions
- `Product.price` (number) → receives extracted prices; default 0 if not found
- Supabase client (service role for bulk insert) → same pattern as `/api/onboarding`

---

## Feature Dependencies

```
Text Seeding
  └── requires: business_type (Step 1) + company_name (Step 1) + menu_id (post-creation)
  └── writes to: categories + products tables

Image Seeding
  └── soft-requires: Text Seeding (needs product names for stock photo queries)
  └── requires: tenant_id + product IDs (to update image_url)
  └── writes to: tenant_settings.banner_url + products.image_url (via Supabase Storage)

Menu Photo OCR
  └── fully independent of Text Seeding and Image Seeding
  └── requires: menu_id + tenant_id
  └── writes to: categories + products tables
  └── can run post-onboarding from Admin panel (most common real-world path)
```

---

## MVP Recommendation

**Phase ordering for v1.2:**

1. **Text Seeding first** — lowest risk, no external image APIs, no file handling. Uses only OpenAI Chat Completions with Structured Outputs. Proves the LLM integration pattern and delivers the most immediate time-savings for a new tenant. The review screen built here is reused by OCR.

2. **Menu Photo OCR second** — the "killer feature" per the seed doc. Most restaurants already have a printed menu. Builds on the review screen pattern from Text Seeding. Uses GPT-4o Vision + same Structured Outputs pattern. Requires image upload handling (new, but contained).

3. **Image Seeding third** — most expensive (two external APIs + storage writes), most complex UX (image grid review), and highest risk of cost overrun. Do last so it can be scoped down if time is short. Image seeding is nice-to-have; the other two are need-to-have.

**Defer:**
- "Save as draft" for OCR review → adds state persistence complexity; user can always re-upload
- Per-item regeneration in Text Seeding → deliver in v1.3 if users request it
- Multi-page OCR → deliver single-image first; add multi-file in a fast-follow phase
- PDF OCR support → v1.3+
- AI usage dashboard for superadmin → v1.3+

---

## Confidence Assessment

| Area | Confidence | Notes |
|---|---|---|
| OCR technical approach (GPT-4o Vision + Structured Outputs) | HIGH | Verified by OpenAI docs and multiple production examples found in research |
| Text seeding LLM pattern | HIGH | Standard OpenAI Chat Completions + Structured Outputs — well-documented |
| Vercel AI SDK for streaming | HIGH | Official docs and production guides confirm compatibility with Next.js App Router |
| Stock photo APIs (Unsplash/Pexels) for product images | MEDIUM | APIs verified as free and production-ready; attribution requirements need re-checking before shipping |
| DALL-E 3 pricing ($0.04–$0.12/image) | MEDIUM | Multiple sources agree but OpenAI pricing changes frequently; verify at implementation time |
| "Generate then review" UX pattern as table stakes | MEDIUM | Research confirms it is the standard pattern for AI-seeded SaaS content; no single authoritative UX study found |
| Image quality pre-check (canvas analysis) | LOW | Described in research as a best practice but no canonical implementation found; may be over-engineering for v1 |

---

## Sources

- OpenAI Structured Outputs documentation: https://developers.openai.com/api/docs/guides/structured-outputs
- OpenAI Images & Vision API: https://developers.openai.com/api/docs/guides/images-vision
- DALL-E 3 model page: https://developers.openai.com/api/docs/models/dall-e-3
- DALL-E pricing analysis: https://tokenmix.ai/blog/dall-e-api-pricing
- Vercel AI SDK: https://ai-sdk.dev/
- Restaurant menu OCR pipeline (production example): https://medium.com/@zafarobad/from-fuzzy-photos-to-perfect-data-building-an-ai-powered-ocr-system-for-restaurant-menus-bb575b16db59
- Plate Parser modular LLM menu digitization: https://medium.com/@hrishikesh19202/plate-parser-a-modular-llm-powered-system-for-intelligent-menu-digitization-and-retrieval-f30c1acade8b
- AI food photo generation risk (MenuCapture): https://www.menucapture.com/ai-food-photography
- Snappr AI menu photo with human review: https://www.snappr.com/ai/menus
- Pexels API: https://www.pexels.com/api/documentation/
- Unsplash API: https://unsplash.com/developers
- OCR benchmark (OmniAI): https://getomni.ai/blog/ocr-benchmark
- Data extraction with GPT-4o (OpenAI Cookbook): https://cookbook.openai.com/examples/data_extraction_transformation
