---
status: partial
phase: 10-image-seeding
source: [10-VERIFICATION.md]
started: 2026-05-07
updated: 2026-05-07
---

## Current Test

[awaiting human testing]

## Tests

### 1. Apply migration 023 in Supabase SQL editor
expected: ai_jobs table exists with columns id, tenant_id, feature_key, status, created_at, completed_at, error_message and policy ai_jobs_superadmin
result: [pending]

### 2. Set 5 GitHub repository secrets
expected: GOOGLE_GENERATIVE_AI_API_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VERCEL_REVALIDATE_URL, VERCEL_REVALIDATE_SECRET visible in repo Settings → Secrets and variables → Actions
result: [pending]

### 3. Set 4 Vercel env vars
expected: GH_PAT (Fine-Grained PAT), GITHUB_REPO_OWNER, GITHUB_REPO_NAME, VERCEL_REVALIDATE_SECRET set in Production + Preview
result: [pending]

### 4. Trigger bulk image seeding (AI-07/AI-08)
expected: From superadmin tenant detail, click "Seed all images" → polling banner appears → after a few minutes, success banner; tenant_settings.banner_url populated; products without image_url get image_url; cover.webp and products/{id}.webp exist in tenant-assets bucket
result: [pending]

### 5. Trigger per-product image seeding (AI-09)
expected: Click "Seed image" on a product row → only that product's image is generated; product.image_url updated; cover photo NOT regenerated; button text "Seeding..." during run
result: [pending]

### 6. Confirm products with existing image_url are skipped (D-09 additive)
expected: Per-product list shows "has image" label (no Seed button) for products with image_url; bulk re-runs do not regenerate existing covers
result: [pending]

### 7. Confirm public menu ISR cache is invalidated after seeding completes
expected: Visiting /{tenantSlug} after a successful seed shows new cover and product images without manual refresh delay
result: [pending]

### 8. Confirm failure path
expected: Simulating Gemini API key missing or storage upload error → ai_jobs.status='failed' with error_message; UI shows red banner with the error; polling stops
result: [pending]

### 9. Confirm polling timeout
expected: Job exceeds ~5 min (100 polls) → polling stops; UI shows "Image seeding timed out. Check GH Actions logs."
result: [pending]

### 10. Confirm ai_usage telemetry recorded
expected: After successful seed, row in ai_usage with feature_key='image_seeding', call_count=N (number of images), today's date
result: [pending]

## Summary

total: 10
passed: 0
issues: 0
pending: 10
skipped: 0
blocked: 0

## Gaps
