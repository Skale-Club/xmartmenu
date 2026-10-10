import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getSafeExitPreviewDestination,
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

test('exiting preview only returns to tenant management pages', () => {
  assert.equal(getSafeExitPreviewDestination('/tenants/0e62fa0c-b4c6-460c-bf29-f2d1f93fa2db'), '/tenants/0e62fa0c-b4c6-460c-bf29-f2d1f93fa2db')
  assert.equal(getSafeExitPreviewDestination('/tenants'), '/tenants')
  assert.equal(getSafeExitPreviewDestination('/dashboard'), '/tenants')
  assert.equal(getSafeExitPreviewDestination('https://example.com'), '/tenants')
  assert.equal(getSafeExitPreviewDestination('//example.com'), '/tenants')
})
