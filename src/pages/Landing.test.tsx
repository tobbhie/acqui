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
    assert.equal((section.match(/<li /g) ?? []).length, 5)
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
})
