import net from 'node:net'

/**
 * Fail-closed network guard for the development server (and `npm run db:pull`).
 *
 * `npm run db:pull` puts a copy of real restaurants (customers, phone numbers, orders,
 * provider settings stored in rows) into the development database. From then on, any
 * code path that reached an external provider with that data would hit real people or
 * real money: Stripe (payments, Connect), the Xphere CRM, Telegram, OpenRouter and every
 * other AI provider, QStash workers, Sentry, webhooks.
 *
 * Auditing each call site is not enough (a new one appears every week), so the guard
 * sits at the lowest layer all of them share: `net.Socket#connect`. `fetch` (undici),
 * `http(s)`, `tls`, `ws` and the provider SDKs end up here. A connection to a host that
 * is not on the allow-list is destroyed with `EDEVOUTBOUND` before a byte is sent.
 *
 * Allowed by default: loopback (Next, the SSH tunnel), the pinned development database
 * host and the pinned development Supabase project. Everything else needs an explicit,
 * host-by-host `DEV_OUTBOUND_ALLOW_HOSTS` entry. There is deliberately no
 * "allow everything" switch.
 */

export const OUTBOUND_BLOCKED_CODE = 'EDEVOUTBOUND'

const LOOPBACK = /^(localhost|.*\.localhost|127(\.\d{1,3}){3}|::1|0:0:0:0:0:0:0:1)$/

/** @param {string} host */
export function normalizeHost(host) {
  return host.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
}

/**
 * Hosts the dev process may talk to, derived from the declared development settings.
 * @param {Record<string, string | undefined>} env
 */
export function devAllowedHosts(env) {
  const hosts = new Set()
  /** @param {string | undefined} value */
  const add = value => {
    if (!value) return
    try { hosts.add(normalizeHost(new URL(value).hostname)) } catch { /* ignore malformed */ }
  }
  add(env.DEV_DATABASE_URL)
  add(env.DEV_MIGRATION_DATABASE_URL)
  // Derived from the declared DEV project, never from NEXT_PUBLIC_SUPABASE_URL (which
  // may still hold the production value in a shell or .env).
  const ref = env.DEV_SUPABASE_PROJECT_REF?.trim().toLowerCase()
  if (ref && /^[a-z0-9]+$/.test(ref)) hosts.add(`${ref}.supabase.co`)
  for (const entry of (env.DEV_OUTBOUND_ALLOW_HOSTS ?? '').split(',')) {
    const host = normalizeHost(entry)
    // A bare wildcard would be the "allow everything" switch in disguise.
    if (host && host !== '*' && !host.startsWith('*') && !host.includes('/')) hosts.add(host)
  }
  return [...hosts]
}

/**
 * @param {string} host
 * @param {readonly string[]} allowed
 */
export function isHostAllowed(host, allowed) {
  const h = normalizeHost(host)
  return LOOPBACK.test(h) || allowed.includes(h)
}

/**
 * The host a `Socket#connect(...)` call is about to dial, or null for a unix socket.
 * @param {unknown[]} args
 * @returns {string | null}
 */
export function connectTarget(args) {
  let first = args[0]
  if (Array.isArray(first)) first = first[0] // node's internal normalized form [options, cb]
  if (first && typeof first === 'object') {
    const options = /** @type {{ host?: string, path?: string }} */ (first)
    if (options.path) return null
    return options.host || 'localhost'
  }
  if (typeof first === 'number' || (typeof first === 'string' && /^\d+$/.test(first))) {
    return typeof args[1] === 'string' ? args[1] : 'localhost'
  }
  return null // a string path: unix domain socket
}

const installed = Symbol.for('xmartmenu.devOutboundGuard')
const original = Symbol.for('xmartmenu.devOutboundGuard.original')

/**
 * Install the guard on `net.Socket.prototype.connect`. Idempotent. Returns the list of
 * hosts that were blocked (live array, for tests and diagnostics).
 * @param {Record<string, string | undefined>} env
 * @param {(message: string) => void} [log]
 * @returns {string[]}
 */
export function installDevOutboundGuard(env, log = message => console.warn(message)) {
  const proto = /** @type {any} */ (net.Socket.prototype)
  if (proto[installed]) return proto[installed]

  /** @type {string[]} */
  const blocked = []
  const real = proto.connect
  proto.connect = function guardedConnect(/** @type {unknown[]} */ ...args) {
    const host = connectTarget(args)
    if (host === null || isHostAllowed(host, devAllowedHosts(env))) return real.apply(this, args)
    const error = Object.assign(
      new Error(
        `Outbound connection to ${normalizeHost(host)} blocked: development never contacts external providers ` +
        '(add the host to DEV_OUTBOUND_ALLOW_HOSTS only if it is safe with real data).',
      ),
      { code: OUTBOUND_BLOCKED_CODE },
    )
    if (!blocked.includes(normalizeHost(host))) {
      blocked.push(normalizeHost(host))
      log(`[dev-guard] ${error.message}`)
    }
    process.nextTick(() => this.destroy(error))
    return this
  }
  proto[installed] = blocked
  proto[original] = real
  return blocked
}

/** Test helper: put the real `connect` back. Never called by the application. */
export function uninstallDevOutboundGuard() {
  const proto = /** @type {any} */ (net.Socket.prototype)
  if (!proto[installed]) return
  proto.connect = proto[original]
  delete proto[installed]
  delete proto[original]
}
