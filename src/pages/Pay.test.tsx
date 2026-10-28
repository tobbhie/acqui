// arc-studio-allow-onchain-literal (test fixtures only)
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { renderToString } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Pay } from './Pay'
import type { PaymentStatus, PublicPayment, PublicStatus } from '@/lib/types'

const ID = 'AbCdEfGhIjKlMnOpQrStUv'
const RECEIVER = `0x${'ab'.repeat(20)}`
const TX = `0x${'cd'.repeat(32)}`

function render(opts: { status: PaymentStatus; minutesLeft?: number; received?: string; override?: Partial<PublicPayment> }): string {
  const expires = new Date(Date.now() + (opts.minutesLeft ?? 20) * 60_000).toISOString()
  const settlement = opts.status === 'settled' ? { tx_hash: TX, settled_at: null } : null
  const payment: PublicPayment = {
    public_id: ID, status: 'awaiting_payment', merchant_name: 'Corner Shop', order_reference: 'order-1001', description: 'Two sticker packs',
    amount: '10.00', received: '0.00', currency: 'USDC', chain_id: 5042002, livemode: false, receiver_address: RECEIVER,
    usdc_address: `0x${'11'.repeat(20)}`, expires_at: expires, success_url: 'https://shop.example.com/thanks', cancel_url: null, settlement: null,
    ...opts.override,
  }
  const status: PublicStatus = { public_id: ID, status: opts.status, received: opts.received ?? '0.00', expires_at: expires, server_time: new Date().toISOString(), settlement }
  const qc = new QueryClient()
  qc.setQueryData(['public-payment', ID], payment)
  qc.setQueryData(['public-status', ID], status)
  // React inserts <!-- --> between adjacent text nodes when rendering to a string.
  return renderToString(<QueryClientProvider client={qc}><Pay publicId={ID} /></QueryClientProvider>).replace(/<!-- -->/g, '')
}

void describe('hosted checkout rendering', () => {
  void it('shows the exact amount, address, QR, countdown and warnings while payable', () => {
    const html = render({ status: 'awaiting_payment' })
    for (const needle of ['10.00', 'USDC', RECEIVER, 'Time left to pay', 'Copy address', 'Before you send', 'Arc Testnet', 'order-1001', 'Test mode', 'holds the address only']) {
      assert.ok(html.includes(needle), `missing ${needle}`)
    }
    assert.match(html, /<svg[^>]*role="img"[^>]*aria-label="QR code/)
    assert.ok(!html.includes('Payment settled'))
  })

  void it('never offers the address once the window has closed, and does not claim success', () => {
    const html = render({ status: 'awaiting_payment', minutesLeft: -1 })
    assert.ok(html.includes('Time is up'))
    assert.ok(!html.includes(RECEIVER))
    assert.ok(!html.includes('Payment settled'))
  })

  void it('walks through observed, settling and settled using only the server status', () => {
    assert.ok(render({ status: 'deposit_detected', received: '10.00' }).includes('We can see your payment'))
    assert.ok(render({ status: 'verifying' }).includes('Settling'))
    assert.ok(render({ status: 'retryable_failure' }).includes('Settling'))
    const settled = render({ status: 'settled' })
    assert.ok(settled.includes('Payment settled'))
    assert.ok(settled.includes(`/tx/${TX}`))
    assert.ok(settled.includes('Return to merchant'))
    assert.ok(!settled.includes('Time left to pay'))
  })

  void it('explains expired, underpaid and refund states without suggesting more payment', () => {
    const expired = render({ status: 'expired' })
    assert.ok(expired.includes('This payment has expired') && !expired.includes(RECEIVER))
    const under = render({ status: 'underpaid', received: '6.00' })
    assert.ok(under.includes('Payment incomplete') && under.includes('6.00 of 10.00'))
    assert.ok(render({ status: 'recovery_required' }).includes('Refund in progress'))
  })

  void it('escapes merchant text and refuses non-http return links', () => {
    const html = render({ status: 'settled', override: { merchant_name: '<script>alert(1)</script>Shop', success_url: 'javascript:alert(1)', description: '<img src=x onerror=alert(1)>' } })
    assert.ok(!html.includes('<script>alert(1)'))
    assert.ok(!html.includes('<img src=x'))
    assert.ok(!html.includes('javascript:'))
    assert.ok(!html.includes('Return to merchant'))
  })

  void it('labels mainnet without a test-mode banner', () => {
    const html = render({ status: 'awaiting_payment', override: { livemode: true, chain_id: 5042 } })
    assert.ok(!html.includes('Test mode'))
    assert.ok(html.includes('chain ID 5042'))
  })
})
