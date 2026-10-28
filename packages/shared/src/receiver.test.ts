// arc-studio-allow-onchain-literal
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { keccak256, type Hex } from 'viem';
import { deriveFactoryAddress, deriveReceiverAddress } from './receiver';
import { PAYMENT_RECEIVER_CREATION_CODE, PAYMENT_RECEIVER_CREATION_CODE_HASH } from './receiver-bytecode';

const distributor = '0x00000000000000000000000000000000000d1570';
const hashA: Hex = `0x${'11'.repeat(32)}`;
const hashB: Hex = `0x${'22'.repeat(32)}`;

void describe('offline address derivation', () => {
  void it('is deterministic and unique per terms hash and distributor', () => {
    assert.equal(deriveReceiverAddress(distributor, hashA), deriveReceiverAddress(distributor, hashA));
    assert.notEqual(deriveReceiverAddress(distributor, hashA), deriveReceiverAddress(distributor, hashB));
    assert.notEqual(
      deriveReceiverAddress(distributor, hashA),
      deriveReceiverAddress('0x00000000000000000000000000000000000d1571', hashA),
    );
    assert.notEqual(deriveFactoryAddress(distributor), distributor);
  });

  void it('embeds the creation code that matches the compiled artifact when one is present', () => {
    assert.equal(keccak256(PAYMENT_RECEIVER_CREATION_CODE), PAYMENT_RECEIVER_CREATION_CODE_HASH);
    const path = 'contracts/out/PaymentReceiver.sol/PaymentReceiver.json';
    if (!existsSync(path)) return;
    const artifact = JSON.parse(readFileSync(path, 'utf8')) as { bytecode: { object: Hex } };
    assert.equal(artifact.bytecode.object, PAYMENT_RECEIVER_CREATION_CODE, 'stale receiver-bytecode.ts: run `bun run contracts:codegen`');
  });
});
