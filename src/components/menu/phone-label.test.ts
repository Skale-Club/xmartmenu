import assert from 'node:assert/strict'
import test from 'node:test'

import { contactLinks, phoneLabel } from './showcase'

test('a US number is shown the way it is said aloud', () => {
  assert.equal(phoneLabel('+1 330-313-0832'), '(330) 313-0832')
  assert.equal(phoneLabel('330.313.0832'), '(330) 313-0832')
  assert.equal(phoneLabel('(330) 313-0832'), '(330) 313-0832')
})

test('other numbers are shown as typed', () => {
  assert.equal(phoneLabel('+55 11 91234-5678'), '+55 11 91234-5678')
  assert.equal(phoneLabel('  '), '')
})

test('the call link keeps the full number while the label is the readable one', () => {
  const { phone } = contactLinks({ phone: '+1 330-313-0832' })
  assert.deepEqual(phone, { url: 'tel:+13303130832', label: '(330) 313-0832' })
})
