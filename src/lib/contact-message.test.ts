import assert from 'node:assert/strict'
import test from 'node:test'

import { buildMailtoUrl } from './contact-message'

const message = { name: 'Maya Lopez', email: 'maya@example.com', phone: '617 555 0100', subject: 'Whole cake', message: 'Do you have a 10-inch for Saturday?' }

test('the link goes to the restaurant with the subject and the message written', () => {
  const url = new URL(buildMailtoUrl('hello@celes.test', message))
  assert.equal(url.protocol, 'mailto:')
  assert.equal(decodeURIComponent(url.pathname), 'hello@celes.test')
  assert.equal(url.searchParams.get('subject'), 'Whole cake')
  const body = url.searchParams.get('body') ?? ''
  assert.match(body, /Do you have a 10-inch for Saturday\?/)
  assert.match(body, /Name: Maya Lopez/)
  assert.match(body, /Email: maya@example\.com/)
  assert.match(body, /Phone: 617 555 0100/)
})

test('a missing subject falls back to the sender, and an empty phone is left out', () => {
  const url = new URL(buildMailtoUrl('hello@celes.test', { ...message, subject: '  ', phone: '' }))
  assert.equal(url.searchParams.get('subject'), 'Message from Maya Lopez')
  assert.doesNotMatch(url.searchParams.get('body') ?? '', /Phone:/)
})

test('special characters and very long messages stay a valid, bounded link', () => {
  const url = buildMailtoUrl('hello@celes.test', { ...message, message: '&=? ñ ' + 'x'.repeat(5000) })
  assert.ok(url.length < 4000)
  assert.equal(new URL(url).searchParams.get('subject'), 'Whole cake')
})
