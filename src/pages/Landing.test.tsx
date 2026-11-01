import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { renderToString } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Landing } from './Landing'

;(globalThis as { window?: unknown }).window = { location: { pathname: '/', hash: '', origin: 'http://localhost' } }

const html = renderToString(<QueryClientProvider client={new QueryClient()}><Landing /></QueryClientProvider>).replace(/<!-- -->/g, '')
const section = /<section id="how-it-works"[\s\S]*?<\/section>/.exec(html)?.[0] ?? ''
const text = section.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')

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

  void it('ends with the line that keeps the merchant in control of the journey', () => {
    assert.ok(text.includes('Acqui works behind your storefront—not instead of it.'))
    assert.ok(text.includes('your team continues managing orders through the systems it already uses'))
  })

  void it('no longer starts the story at the customer', () => {
    assert.ok(!text.includes('From customer payment to business settlement'))
    assert.ok(text.indexOf('Integrate Acqui') < text.indexOf('Customer completes checkout'))
  })
})
