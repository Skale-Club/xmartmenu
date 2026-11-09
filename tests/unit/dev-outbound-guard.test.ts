import http from 'node:http'
import net from 'node:net'
import { spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  OUTBOUND_BLOCKED_CODE, connectTarget, devAllowedHosts, installDevOutboundGuard, isHostAllowed, uninstallDevOutboundGuard,
} from '../../scripts/lib/dev-outbound-guard.mjs'
import { BLANKED_PROVIDER_ENV, developmentEnvironment, guardImportOption } from '../../scripts/lib/dev-environment.mjs'

const ref = 'abcdefghijklmnopqrst'
const env = {
  DEV_DATABASE_URL: `postgresql://postgres.${ref}:x@aws-1-us-east-1.pooler.supabase.com:5432/postgres`,
  DEV_SUPABASE_PROJECT_REF: ref,
  // A wildcard must never turn into "allow everything".
  DEV_OUTBOUND_ALLOW_HOSTS: ' Extra.Example.test , * , *.evil.test ',
}
const logged: string[] = []

describe('development outbound guard (fail closed)', () => {
  beforeAll(() => { installDevOutboundGuard(env, message => logged.push(message)) })
  afterAll(() => uninstallDevOutboundGuard())

  it('allows loopback, the dev database and the dev Supabase project only', () => {
    const allowed = devAllowedHosts(env)
    for (const host of ['localhost', '127.0.0.1', 'app.localhost', '::1', '[::1]']) expect(isHostAllowed(host, allowed), host).toBe(true)
    expect(isHostAllowed('aws-1-us-east-1.pooler.supabase.com', allowed)).toBe(true)
    expect(isHostAllowed(`${ref}.supabase.co`, allowed)).toBe(true)
    expect(isHostAllowed('extra.example.test', allowed)).toBe(true)
    for (const host of [
      'api.stripe.com', 'connect.stripe.com', 'api.telegram.org', 'openrouter.ai', 'api.openai.com',
      'generativelanguage.googleapis.com', 'qstash.upstash.io', 'o1.ingest.sentry.io', 'xphere.skale.club',
      'ktogbpqookfcqilqvici.supabase.co', 'other.supabase.co', 'evil.test', '10.0.0.5',
    ]) expect(isHostAllowed(host, allowed), host).toBe(false)
  })

  it('derives the dialed host from every Socket#connect signature', () => {
    expect(connectTarget([{ host: 'api.stripe.com', port: 443 }])).toBe('api.stripe.com')
    expect(connectTarget([[{ host: 'api.stripe.com', port: 443 }, () => undefined]])).toBe('api.stripe.com')
    expect(connectTarget([{ port: 25 }])).toBe('localhost')
    expect(connectTarget([443, 'openrouter.ai'])).toBe('openrouter.ai')
    expect(connectTarget(['443', 'openrouter.ai'])).toBe('openrouter.ai')
    expect(connectTarget([{ path: '/tmp/x.sock' }])).toBeNull()
    expect(connectTarget(['/tmp/x.sock'])).toBeNull()
  })

  it('destroys a raw TCP connection to a payment, CRM, Telegram or AI host before it is dialed', async () => {
    for (const host of ['api.stripe.com', 'api.telegram.org', 'openrouter.ai', 'xphere.skale.club']) {
      const error = await new Promise<NodeJS.ErrnoException>(resolve => { net.connect({ host, port: 443 }).once('error', resolve) })
      expect(error.code, host).toBe(OUTBOUND_BLOCKED_CODE)
      expect(error.message).toContain(host)
    }
  })

  it('blocks fetch and node:http clients (Stripe, Telegram, OpenRouter, Xphere, webhooks)', async () => {
    for (const url of ['https://api.stripe.com/v1/charges', 'https://api.telegram.org/bot1/sendMessage', 'https://openrouter.ai/api/v1/chat/completions']) {
      await expect(fetch(url, { method: 'POST', body: '{}' }), url)
        .rejects.toSatisfy((e: Error & { cause?: { code?: string } }) => e.cause?.code === OUTBOUND_BLOCKED_CODE)
    }
    const error = await new Promise<NodeJS.ErrnoException>(resolve => { http.get('http://hooks.example.com/', () => undefined).once('error', resolve) })
    expect(error.code).toBe(OUTBOUND_BLOCKED_CODE)
  })

  it('still serves loopback traffic (Next, the SSH tunnel)', async () => {
    const server = http.createServer((_, res) => res.end('ok'))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const { port } = server.address() as net.AddressInfo
      expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe('ok')
    } finally {
      server.close()
    }
  })

  it('logs each blocked host once and is idempotent', () => {
    expect(installDevOutboundGuard(env)).toBe(installDevOutboundGuard(env))
    expect(logged.filter(m => m.includes('api.stripe.com'))).toHaveLength(1)
  })
})

describe('npm run dev environment', () => {
  const dev = {
    DEV_SUPABASE_PROJECT_REF: ref, DEV_SUPABASE_URL: `https://${ref}.supabase.co`, DEV_DATABASE_URL: env.DEV_DATABASE_URL,
    DEV_SUPABASE_ANON_KEY: 'sb_publishable_test', DEV_SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test',
  }

  it('blanks payments, CRM, Telegram and AI credentials inherited from the shell or .env', () => {
    const inherited = Object.fromEntries(BLANKED_PROVIDER_ENV.map(key => [key, 'production-value']))
    const result = developmentEnvironment({ ...dev, ...inherited, XPHERE_SYNC_ENABLED: 'true', NODE_ENV: 'production' })
    for (const key of BLANKED_PROVIDER_ENV) expect(result[key], key).toBe('')
    for (const key of ['STRIPE_SECRET_KEY', 'XPHERE_API_KEY', 'TELEGRAM_BOT_TOKEN', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY']) {
      expect(BLANKED_PROVIDER_ENV).toContain(key)
    }
    expect(result.XPHERE_SYNC_ENABLED).toBe('false')
    expect(result.NODE_ENV).toBe('development')
    expect(result.NODE_OPTIONS).toContain(guardImportOption())
  })

  it('fails closed without an explicit development project', () => {
    expect(() => developmentEnvironment({ DATABASE_URL: 'postgresql://prod:x@prod/app' })).toThrow()
  })

  it('preloads the guard into a real child process through NODE_OPTIONS', () => {
    const result = developmentEnvironment({ ...dev })
    const script = "require('net').connect({ host: 'api.stripe.com', port: 443 }).on('error', e => console.log(e.code))"
    const child = spawnSync(process.execPath, ['-e', script], {
      env: { ...result, PATH: process.env.PATH } as unknown as NodeJS.ProcessEnv, encoding: 'utf8', timeout: 20_000,
    })
    expect(child.stdout.trim()).toBe(OUTBOUND_BLOCKED_CODE)
  })
})

describe('DEV_OWNED_STACK', () => {
  it('turns on the owned stack, the shared project and the identity hosts only when asked', async () => {
    const { applyOwnedStack, OWNED_FLAGS, IDENTITY_HOSTS } = await import('../../scripts/lib/dev-environment.mjs')
    expect(applyOwnedStack({}, '3000')).toEqual({})
    const env = applyOwnedStack({ DEV_OWNED_STACK: 'true' }, '3010')
    for (const flag of OWNED_FLAGS) expect(env[flag]).toBe('true')
    expect(env).toMatchObject({ GOOGLE_AUTH_ENABLED: 'true', DEV_GOOGLE_AUTH_SHARED_PROJECT: 'true', DEV_GOOGLE_AUTH_PROJECT_ID: 'skaleclub', IDENTITY_ORIGIN: 'http://localhost:3010' })
    expect(IDENTITY_HOSTS).toEqual(['identitytoolkit.googleapis.com', 'www.googleapis.com'])
  })
})
