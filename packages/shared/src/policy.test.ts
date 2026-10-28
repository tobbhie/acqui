import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PolicyError, computeGatewayFee, computeSettlement } from './policy';
import { createPaymentIntentRequestSchema } from './schemas';

void describe('computeGatewayFee', () => {
  void it('charges the 0.10 USDC floor on small payments', () => {
    assert.equal(computeGatewayFee(1_000_000n), 100_000n);
    assert.equal(computeGatewayFee(100_000_000n), 100_000n); // 100 USDC => 0.1% == 0.10
  });
  void it('charges 0.1% above the floor', () => {
    assert.equal(computeGatewayFee(1_000_000_000n), 1_000_000n); // 1000 USDC => 1 USDC
  });
  void it('rounds the proportional fee up', () => {
    assert.equal(computeGatewayFee(100_000_001n), 100_001n);
  });
  void it('rejects payments under 1 USDC', () => {
    assert.throws(() => computeGatewayFee(999_999n), PolicyError);
  });
});

void describe('computeSettlement', () => {
  void it('conserves value exactly', () => {
    const s = computeSettlement(50_000_000n, 20_000n, 50_000n);
    assert.equal(s.gatewayFee + s.keeperReimbursement + s.merchantNet, s.gross);
    assert.equal(s.merchantNet, 49_880_000n);
  });
  void it('rejects reimbursement above the cap', () => {
    assert.throws(() => computeSettlement(50_000_000n, 60_000n, 50_000n), PolicyError);
  });
  void it('rejects a non-positive merchant net', () => {
    assert.throws(() => computeSettlement(1_000_000n, 900_000n, 900_000n), PolicyError);
  });
});

void describe('createPaymentIntentRequestSchema', () => {
  void it('parses decimal USDC into base units', () => {
    const parsed = createPaymentIntentRequestSchema.parse({ amount: '12.5' });
    assert.equal(parsed.amount, 12_500_000n);
  });
  void it('rejects sub-minimum and over-precise amounts', () => {
    assert.equal(createPaymentIntentRequestSchema.safeParse({ amount: '0.99' }).success, false);
    assert.equal(createPaymentIntentRequestSchema.safeParse({ amount: '1.0000001' }).success, false);
  });
});
