import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeGatewayFee } from './policy';
import { TERMS_TYPEHASH, hashTerms, protocolFeeTerms, type ContractTerms } from './contracts';

const terms: ContractTerms = {
  intentId: `0x${'11'.repeat(32)}`,
  attemptId: `0x${'22'.repeat(32)}`,
  merchant: '0x00000000000000000000000000000000000000a1',
  refundAddress: '0x00000000000000000000000000000000000000b2',
  amount: 10_000_000n,
  expiry: 1_800_000_000n,
  keeperReimbursement: 20_000n,
  ...protocolFeeTerms(),
};

void describe('contract bindings', () => {
  void it('uses the typehash from the Solidity source string', () => {
    // `cast keccak` of the exact Terms type string in contracts/AcquiTerms.sol.
    assert.equal(TERMS_TYPEHASH, '0x94ee8be03a5d3864eef4600da9ad7ca1923d49dccd72d63dc6fd235eb48020a1');
  });
  void it('binds the hash to the chain id', () => {
    assert.notEqual(hashTerms(5042n, terms), hashTerms(5042002n, terms));
  });
  void it('changes the hash when any term changes', () => {
    const base = hashTerms(5042002n, terms);
    assert.notEqual(base, hashTerms(5042002n, { ...terms, attemptId: `0x${'33'.repeat(32)}` }));
    assert.notEqual(base, hashTerms(5042002n, { ...terms, amount: 10_000_001n }));
    assert.notEqual(base, hashTerms(5042002n, { ...terms, expiry: terms.expiry + 1n }));
  });
  void it('matches the worked fee example: 10 USDC gross, 0.02 reimbursement, 9.88 net', () => {
    const fee = computeGatewayFee(terms.amount);
    assert.equal(fee, 100_000n);
    assert.equal(terms.amount - fee - terms.keeperReimbursement, 9_880_000n);
  });
});
