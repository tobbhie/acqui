import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getNetwork } from './chains';

void describe('network registry', () => {
  void it('keeps testnet as a non-mainnet network', () => {
    const network = getNetwork('arc-testnet');
    assert.equal(network.chainId, 5_042_002);
    assert.equal(network.isMainnet, false);
  });

  void it('maps Arc mainnet to the verified registry facts', () => {
    const network = getNetwork('arc-mainnet');
    assert.equal(network.chainId, 5_042);
    assert.equal(network.isMainnet, true);
    assert.equal(network.usdcErc20.toLowerCase(), '0x3600000000000000000000000000000000000000');
    assert.equal(network.usdcErc20Decimals, 6);
  });
});
