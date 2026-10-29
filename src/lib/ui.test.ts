// arc-studio-allow-onchain-literal (test fixtures only)
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatCountdown, looksLikeAddress, safeHttpUrl, sanitizeText, shortAddress, toOrigin, txUrl } from './format'
import { checkoutPhase, isFinalPhase, pollIntervalMs, remainingMs, statusTone } from './status'
import type { PaymentStatus } from './types'

void describe('checkout phases come only from server status', () => {
  const all: PaymentStatus[] = ['created', 'awaiting_payment', 'deposit_detected', 'verifying', 'settling', 'settled', 'expired', 'underpaid', 'recovery_required', 'retryable_failure']

  void it('maps every API status, and only settled is a success', () => {
    assert.deepEqual(all.map(checkoutPhase), ['awaiting', 'awaiting', 'observed', 'settling', 'settling', 'settled', 'expired', 'underpaid', 'recovery', 'settling'])
    assert.deepEqual(all.filter((s) => statusTone(s) === 'success'), ['settled'])
  })

  void it('stops polling only when nothing more can change, and slows down for refunds', () => {
    assert.equal(pollIntervalMs('settled'), false)
    assert.equal(pollIntervalMs('expired'), 15_000)
    assert.equal(pollIntervalMs('awaiting'), 4000)
    assert.equal(pollIntervalMs('settling'), 4000)
    assert.equal(pollIntervalMs('recovery'), 15_000)
    assert.equal(isFinalPhase('settling'), false)
  })

  void it('counts down on the server clock, not the device clock', () => {
    const expires = '2026-10-28T12:30:00.000Z'
    const serverNow = Date.parse('2026-10-28T12:00:00.000Z')
    // Device clock is one hour fast: remaining time must still be 30 minutes.
    const deviceReceived = serverNow + 3_600_000
    assert.equal(remainingMs(expires, '2026-10-28T12:00:00.000Z', deviceReceived, deviceReceived), 30 * 60_000)
    assert.equal(remainingMs(expires, '2026-10-28T12:00:00.000Z', deviceReceived, deviceReceived + 60_000), 29 * 60_000)
    assert.equal(remainingMs(expires, undefined, serverNow, serverNow + 1000), 30 * 60_000 - 1000)
  })
})

void describe('display helpers', () => {
  void it('formats the countdown and never goes negative', () => {
    assert.equal(formatCountdown(30 * 60_000), '30:00')
    assert.equal(formatCountdown(61_999), '01:01')
    assert.equal(formatCountdown(-5000), '00:00')
  })

  void it('strips control and bidirectional override characters from merchant text', () => {
    assert.equal(sanitizeText('Shop\u202eevil\u0000name\n\t x'), 'Shop evil name x')
    assert.equal(sanitizeText('a'.repeat(300), 10).length, 10)
    assert.equal(sanitizeText(null), '')
    assert.equal(sanitizeText('<img src=x onerror=alert(1)>'), '<img src=x onerror=alert(1)>')
  })

  void it('only allows plain http(s) links without credentials', () => {
    assert.equal(safeHttpUrl('https://shop.example.com/thanks'), 'https://shop.example.com/thanks')
    assert.equal(safeHttpUrl('javascript:alert(1)'), null)
    assert.equal(safeHttpUrl('data:text/html,hi'), null)
    assert.equal(safeHttpUrl('https://user:pw@shop.example.com'), null)
    assert.equal(safeHttpUrl('not a url'), null)
    assert.equal(safeHttpUrl(null), null)
  })

  void it('validates address shape and shortens it', () => {
    assert.equal(looksLikeAddress(`0x${'a'.repeat(40)}`), true)
    assert.equal(looksLikeAddress(`0x${'a'.repeat(39)}`), false)
    assert.equal(looksLikeAddress(`${'a'.repeat(42)}`), false)
    assert.equal(shortAddress(`0x${'1'.repeat(40)}`), '0x1111…1111')
  })

  void it('builds explorer links for known chains and returns null for unknown ones', () => {
    assert.match(txUrl(5042002, `0x${'ab'.repeat(32)}`) ?? '', /\/tx\/0xabab/)
    assert.equal(txUrl(999999, `0x${'ab'.repeat(32)}`), null)
  })

  void it('cuts a pasted page URL down to its origin', () => {
    assert.equal(toOrigin('https://localhost.com/demo'), 'https://localhost.com')
    assert.equal(toOrigin('https://shop.example.com/a/b?x=1#y'), 'https://shop.example.com')
    assert.equal(toOrigin('http://localhost:5173/demo'), 'http://localhost:5173')
    assert.equal(toOrigin('shop.example.com/cart'), 'https://shop.example.com')
    assert.equal(toOrigin('javascript:alert(1)'), null)
    assert.equal(toOrigin('   '), null)
  })
})
