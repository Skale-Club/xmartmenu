
## 2026-11-13 — Move Celes Confections to the /celes slug

- Type: Chore · Area: Public Menu, Database · Status: Done · Agent: Claude Code · Model: claude-opus-5-5
- Repo / Branch: xmartmenu / dev → main · Commits / PR: f0b5d27 (CI run 43431030289)
- Tests: tsc clean; 239 unit tests (menu, delivery-image) passed; CI green incl. e2e and deploy; /celes 200 with dish details and AR model; /celes-confections 308 → /celes.
- Summary: Celes Confections now lives at xprout.app/celes. Slug-keyed contact e-mail, dish details and extra photos follow the new slug; /celes-confections redirects 308 to /celes so old links and QR codes keep working.

### Context
The owner asked to shorten the Celes Confections slug from `celes-confections` to `celes`.

### What changed
- `src/lib/public-contacts.ts`, `public-dish-details.ts`, `public-dish-media.ts`: Celes entries keyed by `celes`.
- `next.config.ts`: permanent redirects `/celes-confections` and `/celes-confections/:path*` → `/celes`.
- Production `tenants.slug` set to `celes` (advisory lock, single UPDATE) right after the deploy finished.
- AR manifest renamed to `scripts/ar/dishes/celes.json` and the Drive model folder to `ar-models/celes`.
- The photo folder `/brands/celes-confections/` keeps its name (a static path, not the slug).

### How it was built
Code first (commit, push dev, release dev:main, CI + Coolify), then the database switch, so slug-keyed content was never missing for more than seconds.

### Decisions and why
Redirect instead of a plain rename: an old slug 404s otherwise (Aurora's rename showed this), and printed QR codes may point at it.

### Tests and evidence
After the switch: /celes 200 with the Classic GLB and the same dish details as before; xprout.app/celes-confections and xmartmenu.skale.club/celes-confections land on /celes.

### Not done / risks
Redirects for renamed tenants are hard-coded in next.config.ts; a slug-history table would make renames self-service.
Also pending in Notion: set "Commits / PR" of entry 417b7a68-6121-810a-bf4b-d550b6cb4a38 (Celes Classic AR dish) to f0b5d27.

### Next
None requested.
