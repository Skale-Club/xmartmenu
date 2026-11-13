/**
 * Restaurant subdomains (docs/product/tenant-subdomains.md): a restaurant can
 * live at https://<label>.<base>/ (e.g. aurora.xprout.app) instead
 * of https://<platform>/<slug>. Opt-in per restaurant (tenants.subdomain, NULL
 * = none) and off for everyone until TENANT_SUBDOMAIN_BASE is set, which is
 * only done once the wildcard DNS record and TLS certificate exist.
 *
 * A subdomain host is served exactly like a verified custom domain (the same
 * rewrite into /<slug>/…, src/lib/custom-domain-routing.ts). Precedence of the
 * restaurant's canonical address: verified custom domain › subdomain › slug path.
 *
 * Zero imports on purpose: bundled into the Edge middleware.
 */

/** One DNS label: 1-63 chars, lower-case letters, digits and inner hyphens. */
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/
const BASE = /^(?=.{3,200}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

/**
 * Labels no restaurant may take: infrastructure names, platform areas and
 * anything that reads as ours. Kept short and explicit; extend when needed.
 */
export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  'www', 'app', 'api', 'admin', 'superadmin', 'dashboard', 'panel', 'auth', 'login', 'identity', 'oauth', 'id',
  'mail', 'email', 'smtp', 'imap', 'pop', 'mx', 'ns', 'ns1', 'ns2', 'dns', 'ftp', 'sftp', 'ssh', 'vpn',
  'cdn', 'static', 'assets', 'media', 'img', 'images', 'files', 'storage', 'uploads',
  'blog', 'help', 'support', 'docs', 'status', 'billing', 'pay', 'payments', 'checkout', 'stripe',
  'dev', 'staging', 'stage', 'test', 'qa', 'demo', 'sandbox', 'preview', 'beta', 'local', 'localhost',
  'xmartmenu', 'xprout', 'skale', 'skaleclub', 'coolify', 'traefik', 'monitoring', 'metrics', 'grafana', 'sentry',
])

/** The subdomain base (e.g. "xprout.app"), or null when the feature is off. */
export function subdomainBase(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env.TENANT_SUBDOMAIN_BASE?.trim().toLowerCase().replace(/^\.+|\.+$/g, '')
  return raw && BASE.test(raw) ? raw : null
}

export type SubdomainCheck = { ok: true; label: string | null } | { ok: false; error: string }

/** Validates what a superadmin typed. Empty clears the subdomain. */
export function validateSubdomainLabel(value: unknown): SubdomainCheck {
  if (value === null || value === undefined) return { ok: true, label: null }
  if (typeof value !== 'string') return { ok: false, error: 'Invalid subdomain' }
  const label = value.trim().toLowerCase()
  if (!label) return { ok: true, label: null }
  if (!LABEL.test(label)) return { ok: false, error: 'Use 1-63 lower-case letters, digits or hyphens, not starting or ending with a hyphen' }
  if (/^xn--/.test(label) || label.includes('--')) return { ok: false, error: 'Double hyphens are not allowed' }
  if (RESERVED_SUBDOMAINS.has(label)) return { ok: false, error: 'This subdomain is reserved' }
  return { ok: true, label }
}

/** The suggestion for a restaurant: its slug, when the slug is a valid, free-to-use label. */
export function suggestedSubdomain(slug: string): string | null {
  const check = validateSubdomainLabel(slug)
  return check.ok ? check.label : null
}

/**
 * The restaurant label of a request host on the subdomain base, or null.
 * Only one level: "a.b.<base>" and the bare base are not restaurants.
 */
export function subdomainLabelFromHost(host: string | null | undefined, base: string | null): string | null {
  if (!host || !base) return null
  const normalized = host.split(':')[0].trim().toLowerCase().replace(/\.$/, '')
  const suffix = `.${base}`
  if (!normalized.endsWith(suffix)) return null
  const label = normalized.slice(0, -suffix.length)
  if (!label || label.includes('.')) return null
  const check = validateSubdomainLabel(label)
  return check.ok ? check.label : null
}

/** "aurora.xprout.app" for a restaurant with a subdomain, when the feature is on. */
export function tenantSubdomainHost(subdomain: string | null | undefined, base: string | null): string | null {
  if (!subdomain || !base) return null
  const check = validateSubdomainLabel(subdomain)
  return check.ok && check.label ? `${check.label}.${base}` : null
}
