import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { LIVE_PAYMENT_CAPABILITY, PAYMENT_CAPABILITIES } from './payment-capabilities'

void describe('payment capability manifest', () => {
  void it('enables only USDC on Arc', () => {
    const live = PAYMENT_CAPABILITIES.filter((item) => item.availability === 'live')
    assert.deepEqual(live, [LIVE_PAYMENT_CAPABILITY])
    assert.equal(LIVE_PAYMENT_CAPABILITY.asset, 'USDC')
    assert.equal(LIVE_PAYMENT_CAPABILITY.network, 'Arc')
    assert.equal(LIVE_PAYMENT_CAPABILITY.settlementAsset, 'USDC')
    assert.equal(LIVE_PAYMENT_CAPABILITY.settlementNetwork, 'arc')
  })
})
