/**
 * Acqui payment policy. All amounts are integer USDC base units (6 decimals, ERC-20 view).
 * Never use `number` for money. Native 18-decimal values must go through `@/onchain-money`.
 */

/** 1 USDC in base units. */
export const USDC_ONE = 1_000_000n;

/** Minimum gross payment: 1 USDC. */
export const MIN_PAYMENT_AMOUNT = 1n * USDC_ONE;

/** Fee floor: 0.10 USDC. */
export const MIN_GATEWAY_FEE = USDC_ONE / 10n;

/** Fee rate: 0.1% = 10 basis points of gross. */
export const GATEWAY_FEE_BPS = 10n;
export const BPS_DENOMINATOR = 10_000n;

/** Checkout window: 30 minutes. A new attempt always gets a new receiver. */
export const CHECKOUT_WINDOW_SECONDS = 30 * 60;

export class PolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolicyError';
  }
}

/**
 * Gateway fee = max(0.10 USDC, 0.1% of gross), rounded UP to the next base unit.
 * Matches `PaymentDistributor.computeFee` (rounds up); both are tested against the same examples.
 */
export function computeGatewayFee(gross: bigint): bigint {
  if (gross < MIN_PAYMENT_AMOUNT) {
    throw new PolicyError('Gross amount is below the 1 USDC minimum');
  }
  const proportional = (gross * GATEWAY_FEE_BPS + (BPS_DENOMINATOR - 1n)) / BPS_DENOMINATOR;
  return proportional > MIN_GATEWAY_FEE ? proportional : MIN_GATEWAY_FEE;
}

export interface SettlementBreakdown {
  gross: bigint;
  gatewayFee: bigint;
  keeperReimbursement: bigint;
  merchantNet: bigint;
}

/**
 * Split a gross payment into fee, keeper reimbursement and merchant net.
 * `keeperReimbursementCap` has no default on purpose: the value is a Step 02 decision.
 * Reimbursement is deducted from the merchant side (same as `PaymentDistributor.previewSettlement`).
 */
export function computeSettlement(
  gross: bigint,
  keeperReimbursement: bigint,
  keeperReimbursementCap: bigint,
): SettlementBreakdown {
  if (keeperReimbursement < 0n) throw new PolicyError('Keeper reimbursement cannot be negative');
  if (keeperReimbursement > keeperReimbursementCap) {
    throw new PolicyError('Keeper reimbursement exceeds the configured cap');
  }
  const gatewayFee = computeGatewayFee(gross);
  const merchantNet = gross - gatewayFee - keeperReimbursement;
  if (merchantNet <= 0n) throw new PolicyError('Merchant net would not be positive');
  return { gross, gatewayFee, keeperReimbursement, merchantNet };
}
