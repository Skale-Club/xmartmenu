# R2 storage cutover + Cloudflare CDN — runbook

Executed 2026-08-05. Two independent layers: the CDN in front of the app, and
storage moving from Supabase to R2. Either can be rolled back without the other.

## What the audit found first

The premise did not match xkedule, so the plan changed before anything ran:

| | expected (xkedule shape) | actual (xmartmenu) |
|---|---|---|
| objects in storage | many | **4 / 17.1 MB** |
| content images | in Supabase | **77 on images.unsplash.com**, 1 in Supabase |
| `/storage/` proxy route | exists | **does not exist** — absolute URLs in the DB |

98% of storage was a single asset: `_platform/hero-bg-video.mp4` (16.7 MB), the
landing hero video, fetched from Supabase on every landing visit. At 5 GB/month
of Supabase free egress that is ~300 landing views. That video, not the image
count, was the reason to migrate.

## CDN layer (Cloudflare, skale.club zone)

`xmartmenu.skale.club` was grey-clouded (direct to 188.245.112.3, no `cf-ray`).

Order of operations, and why:

1. **Read the zone SSL mode before proxying.** `skale.club` was already
   `strict`, so no change was needed. Had it been `flexible` with
   `always_use_https: on`, proxying would have produced an infinite redirect
   loop against the Traefik origin. Check this first, always.
2. **Canary on `xmartmenu-stage.skale.club`** before touching production.
   200 + `cf-ray` confirmed Full (strict) validates the origin certificate.
3. **Proxy production**, then add the Cache Rule.

### The Cache Rule is the point, not the orange cloud

Cloudflare decides cacheability by file extension. `/_next/image?url=...` has
no extension, so it returned `cf-cache-status: DYNAMIC` — **zero** edge caching.
Every visitor forced the origin in Germany to re-optimize every image at every
width. `/_next/static/*.js|css` already cached (they have extensions).

Rule on zone `skale.club`, phase `http_request_cache_settings`:

```
(http.host eq "xmartmenu.skale.club" and
 (starts_with(http.request.uri.path, "/_next/image") or
  starts_with(http.request.uri.path, "/_next/static")))
-> cache: true, edge_ttl: respect_origin, browser_ttl: respect_origin
```

Verified: `/_next/image` went DYNAMIC -> MISS -> HIT.

The rule is host-scoped because `skale.club` carries 60+ records for unrelated
apps. Everything else on the zone was left exactly as it was.

## Storage layer (Cloudflare R2)

Two buckets in **WEUR** (the origin is Hetzner Germany), each with an R2 custom
domain of the same name on the `skale.club` zone:

| bucket | public domain |
|---|---|
| `xmartmenu-tenant-assets` | `https://xmartmenu-tenant-assets.skale.club` |
| `xmartmenu-product-images` | `https://xmartmenu-product-images.skale.club` |

Naming the domains after the buckets lets a single env var cover both:
`STORAGE_S3_PUBLIC_URL_BASE=https://{bucket}.skale.club`.

### Code changes this required (it was not config-only)

`STORAGE_PROVIDER=s3` alone would have changed nothing for the objects that
actually existed:

- `superadmin/platform/upload` and `superadmin/platform/video-upload-url` wrote
  through `createServiceClient()` directly, **bypassing the storage
  abstraction** — and those two routes own all 4 `_platform/*` objects. Both now
  use `getStorageClient()`.
- `next.config.ts` `images.remotePatterns` did not list the R2 hosts. Without
  them `next/image` refuses R2 URLs and renders broken images. Added.
- Dropped `ACL: 'public-read'` from the S3 `PutObject`. **Correction to an
  earlier assumption: R2 accepts the ACL param, it does not reject it** — it is
  simply ignored, which made the code read as if per-object ACLs governed
  visibility. Visibility actually comes from the attached custom domain.

The stale comment claiming `BrandingClient.tsx` uploads via the browser Supabase
client was wrong: it POSTs to `/api/admin/branding/upload`, which already went
through the abstraction. Comment removed rather than acted on.

### Migration

`scripts/migrate-storage-to-r2.mjs` — `--dry-run`, then `--rewrite`.

Copies, verifies each object by size, backs up every affected table to JSON,
then rewrites URLs inside a single transaction. Result:

```
copied=4 failed=0 verified=4 mismatched=0
platform_settings.favicon_url : 1 row
platform_settings.landing     : 2 rows
rows still pointing at supabase storage: 0
```

Proofs, not assumptions:

- All 4 objects **byte-identical** by sha256 against the Supabase originals.
- Mimetypes preserved (`image/webp`, `video/mp4`) — without this the browser
  downloads instead of rendering.
- Hero video returns `cf-cache-status: HIT` on the second fetch. This is the
  egress win.
- **Upload round-trip proven live**: presigned PUT with an unsigned
  `Content-Type` header returned 200, R2 stored and served `image/png`, bytes
  identical. This is the one thing that could not be verified by reading code.

Both client callers (`SettingsClient`, `TenantDetailClient`) already issue a
plain `PUT` with `Content-Type`, which works against Supabase signed URLs and R2
presigned URLs alike — so no client changes were needed.

## Deploy ordering (matters)

The DB now serves R2 URLs while production still runs the pre-merge build. That
is safe **because the landing renders these assets via `<video src>` and CSS
`background-image`, not `next/image`** — so the missing `remotePatterns` in the
old build cannot break them.

The one combination to avoid: redeploying `main` *before* merging this PR, with
`STORAGE_PROVIDER=s3` already set in Coolify. New product/branding uploads would
then land in R2 while the old build's `remotePatterns` still rejects those hosts,
breaking those images. **Merge the PR before the next deploy.**

The live landing HTML still shows Supabase URLs until Next's ISR cache
revalidates — the page carries `s-maxage=31536000`. The deploy rebuilds it.

## Rollback

- **Storage**: unset `STORAGE_PROVIDER` and restore the backup JSON the
  migration script wrote. Nothing was deleted from Supabase — both buckets are
  intact and still serve.
- **CDN**: set the `xmartmenu.skale.club` record back to grey. The Cache Rule
  becomes inert.

## Known follow-ups

- `/favicon.ico` returns 404 in production. Pre-existing, unrelated to this work
  (the favicon is served from `platform_settings.favicon_url`), not investigated.
- Delete the Supabase buckets only after production is stable — there is no cost
  pressure to hurry, and they are the rollback path.
- `scripts/configure-cdn-cache.mjs` sets cache headers on the **Supabase**
  buckets. It is now vestigial for the migrated assets; left in place because it
  still applies if `STORAGE_PROVIDER` is unset for rollback.

## Delayed failure mode to keep on the radar

Full (strict) requires a valid origin certificate. If the Let's Encrypt renewal
on Coolify ever breaks, nothing happens for up to 90 days and then every
proxied host returns 526 at once. If that appears, look at Coolify, not
Cloudflare.
