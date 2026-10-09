import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LAUNCH_CHECKLIST_CATEGORIES,
  LAUNCH_CHECKLIST_ITEMS,
  resolveLaunchChecklistLink,
  summarizeLaunchChecklist,
  type LaunchChecklistEntry,
} from '../launch-checklist'
import { deriveLaunchChecklistSignals, type LaunchChecklistSignalInput } from './launch-checklist-signals'

const settings: NonNullable<LaunchChecklistSignalInput['settings']> = {
  seo_title: 'Bella Vista',
  seo_description: 'Italian kitchen',
  seo_og_image_url: null,
  seo_noindex: false,
  logo_url: 'https://cdn.example/logo.png',
  phone: '+1 555 0100',
  address: '1 Main St',
  city: 'Austin',
  latitude: 30.26,
}
const live: LaunchChecklistSignalInput = { isActive: true, customDomain: 'bellavista.com', customDomainVerified: true, settings }
const entry = (status: LaunchChecklistEntry['status']): LaunchChecklistEntry => ({ status, note: '', updatedBy: null, updatedAt: null })

test('catalog keys are unique, categorised and labelled', () => {
  const keys = LAUNCH_CHECKLIST_ITEMS.map((i) => i.key)
  assert.equal(new Set(keys).size, keys.length)
  for (const item of LAUNCH_CHECKLIST_ITEMS) {
    assert.ok(LAUNCH_CHECKLIST_CATEGORIES.includes(item.category), item.key)
    assert.ok(item.label && item.description, item.key)
  }
})

test('done and N/A count as finished; retired keys are ignored', () => {
  const s = summarizeLaunchChecklist({ ga4: entry('done'), clarity: entry('na'), gtm: entry('pending'), retired: entry('done') })
  assert.equal(s.done, 1)
  assert.equal(s.na, 1)
  assert.equal(s.pending, LAUNCH_CHECKLIST_ITEMS.length - 2)
})

test('links use the menu address, encoded for third-party tools; {domain} needs a custom domain', () => {
  assert.equal(resolveLaunchChecklistLink('{url}/robots.txt', 'https://bellavista.com', 'bellavista.com'), 'https://bellavista.com/robots.txt')
  assert.equal(
    resolveLaunchChecklistLink('https://pagespeed.web.dev/analysis?url={url}', 'https://xmartmenu.skale.club/bella', null),
    'https://pagespeed.web.dev/analysis?url=https%3A%2F%2Fxmartmenu.skale.club%2Fbella',
  )
  assert.equal(resolveLaunchChecklistLink('https://www.ssllabs.com/ssltest/analyze.html?d={domain}', 'https://xmartmenu.skale.club/bella', null), null)
})

test('an active, indexable restaurant on a verified domain', () => {
  const s = deriveLaunchChecklistSignals(live)
  assert.equal(s.site_published.ok, true)
  assert.equal(s.robots_txt.ok, true)
  assert.deepEqual(s.custom_domain, { ok: true, value: 'bellavista.com' })
  assert.equal(s.meta_titles.ok, true)
  assert.deepEqual(s.og_image, { ok: true, reason: 'ogGenerated' })
  assert.equal(s.structured_data.ok, true)
  assert.equal(s.nap.ok, true)
})

test('inactive, noindex and unverified states explain themselves', () => {
  assert.equal(deriveLaunchChecklistSignals({ ...live, isActive: false }).site_published.reason, 'tenantNotActive')
  assert.equal(deriveLaunchChecklistSignals({ ...live, settings: { ...settings, seo_noindex: true } }).site_published.reason, 'robotsNoindex')
  assert.equal(deriveLaunchChecklistSignals({ ...live, customDomainVerified: false }).custom_domain.reason, 'domainUnverified')
  assert.equal(deriveLaunchChecklistSignals({ ...live, customDomain: null }).custom_domain.reason, 'noDomain')
  assert.equal(deriveLaunchChecklistSignals({ ...live, settings: { ...settings, seo_title: null } }).meta_titles.reason, 'usingFallback')
})

test('no settings row: only active/domain signals', () => {
  const s = deriveLaunchChecklistSignals({ ...live, settings: null })
  assert.deepEqual(Object.keys(s).sort(), ['custom_domain', 'robots_txt', 'site_published', 'sitemap_xml'])
})
