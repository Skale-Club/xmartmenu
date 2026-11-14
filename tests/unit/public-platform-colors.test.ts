import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import postcss from 'postcss'
import { compile } from 'tailwindcss'
import { BRAND_BASE, BRAND_PRIMARY } from '@/lib/brand'

const read = (path: string) => readFileSync(path, 'utf8')
const css = postcss.parse(read('src/app/globals.css'))
function declarations(selector: string) {
  const values: Record<string, string> = {}
  css.walkRules(selector, rule => { rule.walkDecls(decl => { values[decl.prop] = decl.value }) })
  return values
}
function luminance(hex: string) {
  const channels = hex.replace('#', '').match(/../g)!.map(c => parseInt(c, 16) / 255)
    .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return channels.reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0)
}
function contrast(a: string, b: string) {
  const x = luminance(a), y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

describe('public platform surface colors', () => {
  it('never lets a surface adapter replace the configured primary or its paired foreground', () => {
    css.walkRules(rule => {
      if (!rule.selector.includes('.dashboard-content') && !rule.selector.includes('.platform-')) return
      rule.walkDecls(decl => {
        expect(decl.prop).not.toBe('--primary')
        expect(decl.prop).not.toBe('--primary-foreground')
      })
    })
  })
  it('preserves raw action color while providing a readable on-dark role without relative-color support', () => {
    const dark = declarations('.platform-dark')
    const light = declarations('.platform-light')
    expect(declarations(':root')['--primary']).toBe(BRAND_PRIMARY)
    expect(dark).not.toHaveProperty('--primary')
    expect(light).not.toHaveProperty('--primary')
    expect(dark['--primary-on-dark']).toBe(BRAND_BASE)
    expect(light['background-color']).toBe(BRAND_BASE)
    expect(light.color).toBe(BRAND_PRIMARY)
    for (const background of ['#09090b', '#18181b', '#222224', BRAND_PRIMARY]) {
      expect(contrast(dark['--primary-on-dark'], background)).toBeGreaterThanOrEqual(4.5)
    }
    expect(contrast(light.color, light['background-color'])).toBeGreaterThanOrEqual(4.5)
    expect(contrast('#a1a1aa', '#222224')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('#52525b', BRAND_BASE)).toBeGreaterThanOrEqual(4.5)
  })

  it('compiles action and surface roles to distinct CSS variables', async () => {
    const theme = css.nodes.find(node => node.type === 'atrule' && node.name === 'theme')!.toString()
    const design = await compile(`${theme}
@tailwind utilities;`)
    const output = design.build(['bg-primary', 'text-primary-on-dark', 'text-primary-foreground', 'text-platform-ivory'])
    expect(output).toContain('background-color: var(--primary)')
    expect(output).toContain('color: var(--primary-on-dark)')
    expect(output).toContain('color: var(--primary-foreground)')
    expect(output).toContain('color: #F3EFE5')
  })

  it('keeps dark focus outlines distinct inside the light marketing body', () => {
    const dark = declarations('.platform-dark :is(a, button, input, select, summary):focus-visible')
    const light = declarations('.platform-light :where(a, button, input, select, summary):focus-visible')
    expect(dark.outline).toBe(`2px solid ${BRAND_BASE}`)
    expect(light.outline).toBe(`2px solid ${BRAND_PRIMARY}`)
    expect(contrast(BRAND_BASE, '#222224')).toBeGreaterThanOrEqual(3)
    expect(contrast(BRAND_PRIMARY, BRAND_BASE)).toBeGreaterThanOrEqual(3)
  })

  it('wires marketing dark surfaces to the surface role and leaves tenant login independent', () => {
    for (const path of ['src/app/(marketing)/ClientPage.tsx', 'src/app/(marketing)/pricing/PricingClient.tsx', 'src/components/marketing/MarketingChrome.tsx']) {
      const source = read(path)
      expect(source).toContain('platform-dark')
      expect(source).not.toMatch(/(?:text-primary|focus-visible:ring-primary)(?:[\s"/]|$)/)
      expect(source).not.toMatch(/via-red-|bg-yellow-/)
    }
    const identity = read('src/app/identity/IdentityPilot.tsx')
    const guest = identity.slice(identity.indexOf('  if (brand && embedded'), identity.indexOf('  if (embedded && !brand'))
    expect(guest).toContain('const accent = brand.primaryColor')
    expect(guest).toContain('const onAccent = computePrimaryForeground(accent)')
    expect(guest).not.toContain('platform-dark')
    expect(guest).not.toContain('platform-ivory')
  })

  it('keeps the pending action readable during hover and the offline page in the approved palette', () => {
    const pending = read('src/app/auth/pending/page.tsx')
    expect(pending).not.toContain('hover:brightness')
    expect(pending).not.toContain('hover:bg-white')
    const offline = read('public/offline.html')
    expect(offline).toContain(`background: ${BRAND_BASE}`)
    expect(offline).toContain(`background: ${BRAND_PRIMARY}`)
    expect(offline).not.toContain('#F52323')
  })
})
