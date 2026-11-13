# Restaurant subdomains

A restaurant can have its own address on our domain, for example
`https://aurora.xmartmenu.skale.club/` instead of
`https://xmartmenu.skale.club/aurora`. It is **opt-in per
restaurant**: most keep the slug path, the ones that want (or that we want to
give) a subdomain get one. A verified custom domain (`menu.aurora.com`) still
wins over both.

| Restaurant has | Canonical address | Other addresses |
|---|---|---|
| nothing | `https://<platform>/<slug>` | — |
| subdomain | `https://<label>.<base>/` | `/<slug>` keeps working; its canonical tag points to the subdomain |
| verified custom domain (with or without subdomain) | `https://<custom domain>/` | slug path and subdomain keep working, point to the custom domain, and the subdomain's robots.txt says `Disallow` |

Everything under the address works as on a custom domain: `/drinks` (menu or
branch), `/blog`, `/me`, `/waiter`, `/sitemap.xml`, `/robots.txt`,
`/preview/<token>` (menu staging), with the API, checkout and auth routes kept
global (`src/lib/custom-domain-routing.ts`).

## Turning it on (infrastructure, once)

Nothing answers until these exist. Code and schema can ship before them.

1. **DNS**: a wildcard record `*.<base>` (e.g. `*.xmartmenu.skale.club`) to the
   same server as the platform (A/AAAA or CNAME to the platform host).
2. **TLS**: a certificate for `*.<base>`. Let's Encrypt issues wildcards only
   through the DNS-01 challenge, so configure Traefik in Coolify with the DNS
   provider's API token (Coolify › Servers › Proxy › dynamic configuration /
   certificate resolver with `dnsChallenge`). Alternative without a wildcard:
   add each enabled restaurant's host (`aurora.xmartmenu.skale.club`) to the
   app's domains in Coolify so it gets its own HTTP-01 certificate (one manual
   step per restaurant).
3. **Routing**: Coolify must send `*.<base>` to the xmartmenu app (add the
   wildcard host to the app's domains, or a Traefik `HostRegexp` rule).
4. **App**: set the runtime variable `TENANT_SUBDOMAIN_BASE=<base>` in Coolify
   and redeploy (no rebuild of the code needed). Unset = off for everyone.
5. **Schema**: run the Owned schema workflow with
   `docs/owned-schema/20261111140000_tenant_subdomain.sql` (plan, then apply).

## Giving a restaurant a subdomain

Superadmin › Restaurants › the restaurant › **Subdomain** card: type the label
(suggested: the slug) and **Turn on**; **Turn off** removes it. Rules: one DNS
label, 1-63 lower-case letters, digits or inner hyphens, no `--`, unique, and
not a reserved name (`www`, `api`, `admin`, `mail`, `preview`, `staging`, … in
`RESERVED_SUBDOMAINS`, `src/lib/tenant-subdomain.ts`). Only platform
administrators can set it (restaurant owners cannot). It can be saved while the
feature is off; it starts answering when step 4 above is done. The public menu
cache is dropped on save, so the canonical address changes right away.

## How it works

- `tenants.subdomain` (NULL = none; CHECK on the label; unique index).
  Owned: `docs/owned-schema/20261111140000_tenant_subdomain.sql`; legacy:
  `supabase/migrations/20261111140000_tenant_subdomain.sql`. Every reader
  tolerates the column being absent (information_schema probe or `to_jsonb`).
- `src/lib/tenant-subdomain.ts` (zero imports, Edge-safe): base from
  `TENANT_SUBDOMAIN_BASE`, label validation, host → label (one level only).
- Host → restaurant: the middleware asks `/api/internal/resolve-domain`
  (owned mode), which now runs `readHostTenantSlug` (`src/lib/data/tenant-domain.ts`):
  `<label>.<base>` by `tenants.subdomain` (active tenants only), else a verified
  custom domain. Answers are cached 60 s per host, misses 30 s, like custom
  domains. Legacy (Supabase) mode has no subdomains.
- Canonical: `tenantOwnHost` / `getCanonicalUrl` in `src/lib/seo.ts`
  (custom domain › subdomain › slug path). Used by page metadata, JSON-LD,
  sitemaps and robots. The platform sitemap leaves out restaurants on their own
  host (they list themselves at `<their host>/sitemap.xml`). A restaurant's
  robots.txt disallows every host except its own.
- Superadmin: `updateTenant` accepts `subdomain` (`src/lib/data/tenant-administration.ts`);
  UI `src/app/(superadmin)/tenants/[id]/TenantSubdomainCard.tsx`.

## Not done yet / known limits

- No automatic redirect from `/<slug>` to the subdomain (canonical tags only).
  Add a 308 once a few restaurants run on subdomains and nothing depends on the
  old path.
- Guest sign-in (phone/Google) does not run on a subdomain, as on custom
  domains: the owned sign-in answers only on the identity origin. Browsing,
  ordering and checkout work.
- Restaurant owners cannot request or change their subdomain from their panel.
- QR codes already printed keep the URL they were printed with (still valid).
- Tests: `tests/unit/tenant-subdomain.test.ts`, the subdomain cases in
  `tests/integration/owned-remaining-reads.test.ts` and
  `tests/integration/public-menu.test.ts`, and the operator test in
  `scripts/ops/test_xprout_owned_schema.py` (CI, Docker).
