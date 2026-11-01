import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { useRevealOnce } from './hooks'

function Probe() {
  const [, shown] = useRevealOnce<HTMLDivElement>()
  return createElement('span', null, shown ? 'shown' : 'hidden')
}

void describe('useRevealOnce', () => {
  void it('shows content immediately when the browser cannot observe visibility, so nothing stays hidden', () => {
    assert.equal(typeof IntersectionObserver, 'undefined')
    assert.ok(renderToString(createElement(Probe)).includes('shown'))
  })
})
