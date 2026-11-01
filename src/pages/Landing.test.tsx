import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { renderToString } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Landing } from './Landing'

;(globalThis as { window?: unknown }).window = { location: { pathname: '/', hash: '', origin: 'http://localhost' } }

const html = renderToString(<QueryClientProvider client={new QueryClient()}><Landing /></QueryClientProvider>).replace(/<!-- -->/g, '')
const section = /<section id="how-it-works"[\s\S]*?<\/section>/.exec(html)?.[0] ?? ''
const text = section.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')

const mock = /<div class="hidden justify-self-end xl:block" data-testid="cart-mockup">[\s\S]*?Complete Order<\/div><\/div><\/div>/.exec(html)?.[0] ?? ''
const mockText = mock.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')

void describe('landing: how it works', () => {
  void it('presents Acqui as infrastructure behind the merchant checkout, in five steps', () => {
    assert.ok(section, 'section with id how-it-works exists')
    assert.ok(text.includes('Add crypto payments to the checkout you already have.'))
    const steps = ['Integrate Acqui', 'Create a payment', 'Customer completes checkout', 'Acqui verifies the payment', 'Your business gets paid']
    let at = -1
    for (const step of steps) {
      const found = text.indexOf(step)
      assert.ok(found > at, `${step} appears, in order`)
      at = found
    }
    assert.equal((section.match(/<li[ >]/g) ?? []).length, 5)
    for (const chip of ['API + hosted checkout', 'Created from your backend', 'No customer signup', 'Onchain verification', 'USDC + webhook']) {
      assert.ok(text.includes(chip), chip)
    }
  })

  void it('does not carry the old closing statement', () => {
    assert.ok(!text.includes('Acqui works behind your storefront'))
    assert.ok(!html.includes('systems it already uses'))
  })

  void it('no longer starts the story at the customer', () => {
    assert.ok(!text.includes('From customer payment to business settlement'))
    assert.ok(text.indexOf('Integrate Acqui') < text.indexOf('Customer completes checkout'))
  })

  void it('floats a decorative cart beside the heading on wide screens only', () => {
    assert.ok(mock, 'mockup is rendered inside a wrapper that is hidden below xl')
    for (const needle of ['Your checkout', 'Canvas tote bag', '$49.00', 'Credit Card', 'PayPal', 'Pay with Crypto', 'USDC', 'Complete Order']) {
      assert.ok(mockText.includes(needle), needle)
    }
    assert.ok(mock.indexOf('Credit Card') < mock.indexOf('PayPal') && mock.indexOf('PayPal') < mock.indexOf('Pay with Crypto'))
    assert.match(mock, /aria-hidden="true"/)
    assert.ok(mock.includes('pointer-events-none'), 'it is not interactive')
    assert.ok(mock.includes('border-blue-600 bg-blue-50'), 'crypto is the selected option')
  })

  void it('marks the crypto row as the part Acqui adds, and shows the amount in USDC', () => {
    assert.ok(mockText.includes('Powered by Acqui'))
    assert.ok(mockText.includes('49.00 USDC'))
    assert.ok(mock.includes('/acqui-icon.svg'))
  })

  void it('keeps the mockup crisp: no tilt and no constant drifting animation', () => {
    assert.ok(!/rotate|float-slow/.test(mock))
    assert.ok(mock.includes('pulse-soft'), 'one gentle pulse on the selected option')
    assert.ok(!/text-\[10px\]|text-\[11px\] font-semibold uppercase tracking-\[0\.1em\] text-slate-400/.test(mock), 'no tiny pale labels')
  })

  void it('shows who owns each part with lane brackets and a numbered sequence on wide screens', () => {
    const lanes = /<div aria-hidden="true" class="mt-14 hidden lg:block" data-testid="flow-lanes">[\s\S]*?<\/div><\/div>/.exec(html)?.[0] ?? ''
    assert.ok(lanes, 'lane block is decorative and hidden below lg')
    const laneText = lanes.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
    for (const label of ['In your store', 'Behind the scenes', 'Back in your systems']) assert.ok(laneText.includes(label), label)
    assert.deepEqual([...lanes.matchAll(/ring-4[^>]*>(\d)<\/span>/g)].map((m) => m[1]), ['1', '2', '3', '4', '5'])
  })

  void it('keeps each card short enough to scan', () => {
    for (const body of [...section.matchAll(/<p class="mt-2 flex-1[^>]*>([^<]*)<\/p>/g)].map((m) => m[1] ?? '')) {
      assert.ok(body.length > 0 && body.length <= 110, `card copy too long (${body.length}): ${body}`)
    }
  })

  void it('fills the space under the heading with the merchant side of the story, wide screens only', () => {
    const side = /<div class="hidden xl:block"><div aria-hidden="true"[^>]*data-testid="merchant-side">[\s\S]*?49\.00 USDC<\/span><\/div><\/div><\/div>/.exec(html)?.[0] ?? ''
    assert.ok(side, 'cluster is inside a wrapper that is hidden below xl and hidden from assistive tech')
    const sideText = side.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
    for (const needle of ['Your orders', 'Sample data', '#1041', 'Paid · card', '#1042', 'Canvas tote bag', '$49.00', 'Paid · crypto', 'payment.settled', 'Signed message received', 'Settled on Arc', '49.00 USDC']) {
      assert.ok(sideText.includes(needle), needle)
    }
    // Arrives in the order the story happens: order list, webhook, settlement.
    assert.ok(sideText.indexOf('Your orders') < sideText.indexOf('payment.settled') && sideText.indexOf('payment.settled') < sideText.indexOf('Settled on Arc'))
    assert.ok(side.includes('pointer-events-none'))
  })

  void it('plays the cluster once, never on a loop, and never hides it from reduced-motion visitors', () => {
    const side = /data-testid="merchant-side">[\s\S]*?49\.00 USDC/.exec(html)?.[0] ?? ''
    assert.ok(!/animate-|infinite/.test(side), 'no looping animation')
    assert.ok(side.includes('motion-reduce:opacity-100') && side.includes('motion-reduce:transition-none'))
  })
})
