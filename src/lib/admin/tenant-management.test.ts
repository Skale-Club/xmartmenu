import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getSafePreviewDestination,
  isPendingTenantAssignment,
  validateTenantSlug,
} from './tenant-management'

test('customer accounts are never pending tenant assignment', () => {
  assert.equal(isPendingTenantAssignment({ tenant_id: null, role: 'customer' }), false)
  assert.equal(isPendingTenantAssignment({ tenant_id: null, role: 'store-admin' }), true)
  assert.equal(isPendingTenantAssignment(undefined), true)
})

test('tenant slugs are normalized and reserved application paths are rejected', () => {
  assert.deepEqual(validateTenantSlug('Bella Vista'), { ok: true, slug: 'bella-vista' })
  assert.deepEqual(validateTenantSlug('settings'), {
    ok: false,
    error: 'This URL is reserved. Choose a different restaurant URL.',
  })
  assert.deepEqual(validateTenantSlug('---'), {
    ok: false,
    error: 'Enter a valid restaurant URL.',
  })
})

test('preview redirects only allow local application paths', () => {
  assert.equal(getSafePreviewDestination('/settings/branding'), '/settings/branding')
  assert.equal(getSafePreviewDestination('https://example.com'), '/dashboard')
  assert.equal(getSafePreviewDestination('//example.com'), '/dashboard')
  assert.equal(getSafePreviewDestination('/\\example.com'), '/dashboard')
  assert.equal(getSafePreviewDestination(undefined), '/dashboard')
})
