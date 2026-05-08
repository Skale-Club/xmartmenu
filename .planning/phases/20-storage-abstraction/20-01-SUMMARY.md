---
phase: 20
plan: 01
subsystem: storage
tags: [infrastructure, storage, s3, hetzner, abstraction, migration]
dependency_graph:
  requires: []
  provides: [storage-abstraction-layer]
  affects: [admin-upload, superadmin-upload, seed-image, ocr-menu, ocr-upload-token]
tech_stack:
  added: ["@aws-sdk/client-s3@^3", "@aws-sdk/s3-request-presigner@^3"]
  patterns: [factory-pattern, lazy-imports, provider-abstraction]
key_files:
  created:
    - src/lib/storage/index.ts
  modified:
    - src/app/api/admin/products/upload/route.ts
    - src/app/api/superadmin/tenants/[id]/upload/route.ts
    - src/app/api/superadmin/tenants/[id]/seed-image/route.ts
    - src/app/api/superadmin/tenants/[id]/ocr-menu/route.ts
    - src/app/api/superadmin/tenants/[id]/ocr-upload-token/route.ts
    - src/app/(admin)/settings/branding/BrandingClient.tsx
    - package.json
decisions:
  - "SupabaseStorageClient is default — STORAGE_PROVIDER=s3 opt-in, zero config change for existing deploys"
  - "S3StorageClient uses lazy dynamic imports so @aws-sdk is not bundled when Supabase mode is active"
  - "Supabase createSignedUploadUrl does not accept expiresIn option in storage-js this version — _expiresIn param kept in interface for future compat, ignored in Supabase impl"
  - "ocr-menu download refactored to use getStorageClient().download() and infer mime type from path extension instead of Blob.type"
  - "BrandingClient.tsx intentionally not migrated — client-side direct upload; migration path documented in comment"
metrics:
  duration: "~25min"
  completed_date: "2026-05-08"
  tasks_completed: 2
  files_modified: 7
---

# Phase 20 Plan 01: Storage Abstraction Layer Summary

## One-liner

Provider-agnostic storage abstraction with IStorageClient, SupabaseStorageClient, and S3StorageClient — swap to Hetzner/R2/B2 via STORAGE_PROVIDER=s3.

## What Was Built

A `src/lib/storage/index.ts` module that:

1. Defines `IStorageClient` interface with `upload()`, `getPublicUrl()`, `download()`, and `createSignedUploadUrl()` methods
2. Implements `SupabaseStorageClient` wrapping the existing `createServiceClient()` pattern — zero behavior change for current deployments
3. Implements `S3StorageClient` with lazy `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` imports — only bundled when `STORAGE_PROVIDER=s3`
4. Exports `getStorageClient()` factory cached per-process, and `resetStorageClient()` for test teardown

All 5 server routes that touched Supabase Storage were updated to call `getStorageClient()`. `BrandingClient.tsx` (client-side) received a migration comment instead of a full refactor (architectural — requires new server route for S3 compatibility).

## Routes Refactored

| Route | Method | Change |
|---|---|---|
| /api/admin/products/upload | upload() | getStorageClient().upload('product-images', ...) |
| /api/superadmin/tenants/[id]/upload | upload() | getStorageClient().upload('tenant-assets', ...) |
| /api/superadmin/tenants/[id]/seed-image | upload() x4 | getStorageClient().upload('tenant-assets', ...) |
| /api/superadmin/tenants/[id]/ocr-menu | download() | getStorageClient().download('tenant-assets', ...) |
| /api/superadmin/tenants/[id]/ocr-upload-token | createSignedUploadUrl() | getStorageClient().createSignedUploadUrl('tenant-assets', ...) |

## Migration Path (Supabase → Hetzner)

See `src/lib/storage/index.ts` header comment for the full 7-step checklist. Short version:
1. Create buckets in Hetzner Console
2. Generate S3 credentials
3. Set 7 env vars in Vercel
4. `rclone sync` existing files
5. Set `STORAGE_PROVIDER=s3` and redeploy

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript type error in superadmin upload route**
- **Found during:** Task 2 build verification
- **Issue:** `conversion.buffer` typed as `Buffer | undefined` from discriminated union — passed directly to `getStorageClient().upload()` which requires non-undefined
- **Fix:** Added `const webpBuffer = conversion.buffer as Buffer` assertion (same pattern already used in products/upload)
- **Commit:** d9f520c

**2. [Rule 1 - Bug] Supabase createSignedUploadUrl does not accept expiresIn option**
- **Found during:** Task 2 build verification
- **Issue:** `@supabase/storage-js` installed version only accepts `{ upsert?: boolean }` — `{ expiresIn }` causes TypeScript error
- **Fix:** Changed `_expiresIn` (prefixed underscore = intentionally unused), removed option from Supabase call. Interface retains `expiresIn` param for S3 impl compatibility.
- **Commit:** d9f520c

## Known Stubs

None — all upload/download paths are fully wired through the abstraction.

## Self-Check: PASSED
