import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { renderToString } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Shell } from './Shell'

// usePath reads window.location during render, so give the string renderer a minimal one.
;(globalThis as { window?: unknown }).window = { location: { pathname: '/', hash: '', origin: 'http://localhost' } }

const render = (minimal = false) =>
  renderToString(<QueryClientProvider client={new QueryClient()}><Shell minimal={minimal}><p>page</p></Shell></QueryClientProvider>)

void describe('site navigation', () => {
  void it('links to the how it works section and offers a hamburger button for small screens', () => {
    const html = render()
    assert.match(html, /href="\/#how-it-works"[^>]*>How it works</)
    assert.match(html, /aria-label="Open menu"[^>]*aria-expanded="false"|aria-expanded="false"[^>]*aria-label="Open menu"/)
    // The desktop links are hidden below the md breakpoint, the hamburger is hidden from md up.
    assert.match(html, /hidden items-center gap-3 md:flex/)
    assert.match(html, /md:hidden/)
    assert.ok(!html.includes('id="mobile-menu"'), 'menu panel is closed by default')
  })

  void it('shows no navigation on hosted checkout', () => {
    const html = render(true)
    assert.ok(!html.includes('How it works'))
    assert.ok(!html.includes('Open menu'))
  })
})
