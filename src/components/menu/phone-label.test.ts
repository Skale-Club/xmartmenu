import assert from 'node:assert/strict'
import test from 'node:test'

import { contactLinks, phoneLabel, phoneRegion, telUrl, whatsappUrl } from './showcase'

const BR = { country: 'BR', currency: 'BRL' }

test('a US number is shown the way it is said aloud', () => {
  assert.equal(phoneLabel('+1 330-313-0832'), '(330) 313-0832')
  assert.equal(phoneLabel('330.313.0832'), '(330) 313-0832')
  assert.equal(phoneLabel('(330) 313-0832'), '(330) 313-0832')
})

test('a Brazilian restaurant shows its local number the Brazilian way', () => {
  assert.equal(phoneLabel('11999998888', BR), '(11) 99999-8888')
  assert.equal(phoneLabel('5511999998888', BR), '(11) 99999-8888')
  assert.equal(phoneLabel('+55 11 3333-4444', BR), '(11) 3333-4444')
})

test('the country comes from the settings, then the currency', () => {
  assert.equal(phoneRegion({ country: 'Brasil' }), 'BR')
  assert.equal(phoneRegion({ country: 'pt' }), 'PT')
  assert.equal(phoneRegion({ currency: 'BRL' }), 'BR')
  assert.equal(phoneRegion(null), 'US')
})

test('a foreign number keeps its country code', () => {
  assert.equal(phoneLabel('+55 11 91234-5678'), '+55 11 91234 5678')
  assert.equal(phoneLabel('+1 330-313-0832', BR), '+1 330 313 0832')
})

test('a Brazilian local number is never mistaken for a US one', () => {
  // 11 digits starting with 1 used to become "(199) 999-8888".
  assert.equal(phoneLabel('11999998888', { currency: 'BRL' }), '(11) 99999-8888')
  assert.equal(phoneLabel('11999998888'), '11999998888')
})

test('anything unrecognizable is shown as typed', () => {
  assert.equal(phoneLabel('  '), '')
  assert.equal(phoneLabel('ext 12'), 'ext 12')
})

test('call and WhatsApp links carry the full international number', () => {
  assert.equal(telUrl('11999998888', BR), 'tel:+5511999998888')
  assert.equal(whatsappUrl('(11) 99999-8888', null, BR), 'https://wa.me/5511999998888')
  const { phone, whatsapp, whatsappLabel } = contactLinks({ phone: '+1 330-313-0832', whatsapp: '5511999998888', ...BR })
  assert.deepEqual(phone, { url: 'tel:+13303130832', label: '+1 330 313 0832' })
  assert.equal(whatsapp, 'https://wa.me/5511999998888')
  assert.equal(whatsappLabel, '(11) 99999-8888')
})

test('the call link keeps the full number while the label is the readable one', () => {
  const { phone } = contactLinks({ phone: '+1 330-313-0832' })
  assert.deepEqual(phone, { url: 'tel:+13303130832', label: '(330) 313-0832' })
})

test('a phone field starts with the restaurant country code and accepts local numbers', async () => {
  const { callingCodePrefix, toE164Phone } = await import('./showcase')
  assert.equal(callingCodePrefix(BR), '+55 ')
  assert.equal(callingCodePrefix(null), '+1 ')
  assert.equal(toE164Phone('+55 (11) 99999-8888', BR), '+5511999998888')
  assert.equal(toE164Phone('11 99999-8888', BR), '+5511999998888')
  assert.equal(toE164Phone('+55 ', BR), null)
})
