# Xprout

Multi-tenant restaurant menu and operations platform built with Next.js, Supabase, and Stripe.

## Product Language

Xprout (formerly XmartMenu) is English-first. New tenant and menu defaults should use English (`en`) for language and `USD` for currency unless a specific customer configuration says otherwise.

Portuguese can be enabled as an additional menu language, but it is not the default product language or positioning.

## Getting Started

First, run the development server:

```bash
cp .env.example .env.local
```

Configure the explicit `DEV_SUPABASE_*` and `DEV_DATABASE_URL` values for an
isolated development project in `.env.local`, then run:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

The development command rejects the current production-source Supabase project
and does not inherit its `DATABASE_URL`. It never copies production data.
Migration status, account-preservation rules and deployment coordination are in
[docs/supabase-production-exit.md](docs/supabase-production-exit.md).

The application uses the Next.js App Router under `src/app`.

Every image and video must follow the mandatory [application-wide media policy](docs/product/media-policy.md): optimized bytes before publication, fast delivery, and bounded server processing.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Production Deployment

Production runs as a **Next.js standalone Docker container on Coolify**, at [xprout.app](https://xprout.app). Vercel is not a deployment target for this repository.

The release pipeline is:

1. A push to `main` starts `.github/workflows/build-deploy.yml`.
2. GitHub Actions builds the Docker image using `Dockerfile`.
3. The image is published to `ghcr.io/skale-club/xmartmenu` with `latest` and commit-SHA tags.
4. The workflow calls the Coolify API for application `gmaayluj11x1m6j7baogonfn`.
5. Coolify pulls the prebuilt image through `docker-compose.yaml`, starts it, and checks container health.

Runtime secrets are configured in Coolify. Public variables required by the Next.js build are configured as GitHub Actions variables; build-only secrets stay in GitHub Actions secrets. Do not commit environment files or duplicate production secrets in `docker-compose.yaml`.

After every release, verify:

```bash
curl --fail https://xprout.app/api/health
```

Deployment configuration lives in:

- `.github/workflows/build-deploy.yml` — CI build, GHCR push, and Coolify trigger
- `Dockerfile` — multi-stage standalone Next.js image
- `docker-compose.yaml` — Coolify runtime service and health check

## Xphere CRM Sync — Ops

One-way outbound sync mirrors every tenant into the Xphere CRM org. It ships dark and is gated by env. Operational notes:

- **Kill switch:** `XPHERE_SYNC_ENABLED` is the authoritative producer gate. Leave it empty/`false`/`0` to halt ALL syncing with no code change (safe-dark default: disabled unless explicitly enabled). Set it to `true` to activate — note the worker also needs `XPHERE_API_URL` + `XPHERE_API_KEY` to actually call Xphere. The flip is a single env change; no deploy of new code is required to stop syncing.
- **DLQ:** Permanent failures (worker responds `489` + `Upstash-NonRetryable-Error`) route to the QStash Dead Letter Queue. Inspect and replay them from the Upstash QStash dashboard.
- **Post-deploy reachability check:** an UNSIGNED POST to the public worker URL must return `401` (route reachable but signature-protected):

  ```bash
  curl -i -X POST https://xprout.app/api/internal/xphere-sync
  # expect: HTTP/.. 401
  ```

  A non-`401` response (connection refused, `404`, or `200`) means the route is unreachable or the auth wall is misconfigured — investigate before enabling sync.
- **Secrets:** all `XPHERE_*` / `QSTASH_*` vars are SERVER-ONLY — never prefix them with `NEXT_PUBLIC_` (that would leak secrets into the browser bundle). `.env.example` holds placeholders only.
