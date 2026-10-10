/**
 * Guards the BLOCKED_TENANT_SLUGS invariant.
 *
 * Middleware answers any request whose first path segment is in
 * BLOCKED_TENANT_SLUGS with a hard 404, and it does so *before* Next's
 * file-system routing runs. So a slug that is both blocked and backed by a real
 * page silently takes that page offline in production — exactly what happened to
 * /terms and /privacy after commit 2628a1c added pages for slugs the list still
 * blocked.
 *
 * This script fails the build if any blocked slug resolves to a real route.
 * Run via `npm run check:routes` (wired into CI ahead of the build).
 */
import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { BLOCKED_TENANT_SLUGS } from '../src/lib/marketing/blocked-tenant-slugs'

const APP_DIR = join(process.cwd(), 'src', 'app')
const PAGE_FILES = ['page.tsx', 'page.jsx', 'page.ts', 'page.js']
const ROUTE_FILES = ['route.ts', 'route.js']

/** A segment that contributes nothing to the public URL path. */
function isTransparentSegment(name: string): boolean {
  // (group) route groups and @slot parallel routes are erased from the URL.
  return /^\(.+\)$/.test(name) || name.startsWith('@')
}

/**
 * True if the subtree holds any page/route file. The block is on the *first*
 * path segment, so a nested-only route (`/settings/store` with no `/settings`
 * page) is taken offline just the same — that is how commit 533cd8b killed every
 * /admin and /api URL. Checking the whole subtree catches that case too.
 */
function hasRouteInSubtree(dir: string): boolean {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && (PAGE_FILES.includes(entry.name) || ROUTE_FILES.includes(entry.name))) {
      return true
    }
    if (entry.isDirectory() && !entry.name.startsWith('_') && hasRouteInSubtree(join(dir, entry.name))) {
      return true
    }
  }
  return false
}

/** Collects every literal first URL segment that serves at least one route. */
function collectTopLevelRoutes(dir: string, out: Set<string>): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    // _private folders are excluded from routing entirely.
    if (entry.name.startsWith('_')) continue

    const child = join(dir, entry.name)

    if (isTransparentSegment(entry.name)) {
      // Erased from the URL — its children are still at depth 1.
      collectTopLevelRoutes(child, out)
      continue
    }

    // Dynamic segments ([slug], [...rest]) are not literal slugs.
    if (entry.name.startsWith('[')) continue

    if (hasRouteInSubtree(child)) out.add(entry.name)
  }
}

if (!existsSync(APP_DIR)) {
  console.error(`✗ ${APP_DIR} does not exist — is the working directory wrong?`)
  process.exit(1)
}

const topLevelRoutes = new Set<string>()
collectTopLevelRoutes(APP_DIR, topLevelRoutes)

if (topLevelRoutes.size === 0) {
  console.error(`✗ No routes found under ${APP_DIR} — is the working directory wrong?`)
  process.exit(1)
}

const conflicts = [...BLOCKED_TENANT_SLUGS].filter((slug) => topLevelRoutes.has(slug)).sort()

if (conflicts.length > 0) {
  console.error('✗ BLOCKED_TENANT_SLUGS conflicts with real App Router routes.')
  console.error('  Middleware 404s these before file-system routing, taking the pages offline:')
  for (const slug of conflicts) console.error(`    /${slug}`)
  console.error('\n  Fix: remove them from src/lib/marketing/blocked-tenant-slugs.ts.')
  console.error('  (They stay in RESERVED_PATHS — that set only blocks tenant registration.)')
  process.exit(1)
}

console.log(
  `✓ BLOCKED_TENANT_SLUGS (${BLOCKED_TENANT_SLUGS.size}) conflicts with none of the ` +
    `${topLevelRoutes.size} top-level routes.`,
)
