# Phase 3: CI/CD — Context

**Gathered:** 2026-05-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Add a GitHub Actions workflow that blocks broken PRs. Single plan, single deliverable.

**Current state:**
- Only `.github/workflows/supabase-keepalive.yml` exists
- No lint/build/type-check in CI
- Scripts available: `npm run lint` (eslint), `npm run build` (next build)
- No test suite exists yet — skip test step

**Out of scope:** test runner setup, deployment, Lighthouse CI budget

</domain>

<decisions>
## Implementation Decisions

Create `.github/workflows/ci.yml`:
- Trigger: `push` to main, `pull_request` to main
- Node version: 20 (matches @types/node)
- Steps: checkout → setup-node with cache → npm ci → lint → build (which includes tsc)
- Fail fast: yes (lint blocks build)
- Cache: npm cache via `cache: 'npm'` in setup-node action

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run build
    env:
      NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY }}
      SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

Note: Next.js build needs env vars even if Supabase isn't hit during build — the `!` assertions in client.ts would fail without them. Using GitHub secrets. If secrets aren't set, the build step will fail with a clear env error (acceptable — tells the user to add secrets).

</decisions>

<canonical_refs>
- `.github/workflows/supabase-keepalive.yml` — existing workflow, reference for secret names
- `package.json` — scripts: lint, build
- `.env.example` — env var names needed
</canonical_refs>

<deferred>
- Test runner (no tests exist yet)
- Lighthouse CI
- Deploy workflow
</deferred>

---
*Phase: 03-ci-cd | Context: 2026-05-06*
