import { unitsToDecimal } from '../lib/units';
import type { PaymentStatus } from './state';

export interface PaymentRow {
  id: string;
  public_id: string;
  merchant_id: string;
  order_id: string;
  description: string | null;
  chain_id: number;
  network: string;
  gross_units: string;
  receiver_address: string;
  payout_address: string;
  refund_address: string;
  protocol_fee_units: string;
  keeper_reimbursement_units: string;
  merchant_net_units: string;
  success_url: string | null;
  cancel_url: string | null;
  status: PaymentStatus;
  created_at: Date;
  expires_at: Date;
  settlement_tx_hash: string | null;
  settled_at: Date | null;
}

export const paymentIdOf = (id: string) => `pi_${id.replace(/-/g, '')}`;

export function parsePaymentId(value: string): string | null {
  const m = /^pi_([0-9a-f]{32})$/.exec(value);
  const h = m?.[1];
  if (!h) return null;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export interface ViewContext {
  checkoutBaseUrl: string;
  usdcAddress: string;
  livemode: boolean;
}

/** Full merchant-facing view. Never includes keys, tokens or internal terms hashes. */
export function merchantView(row: PaymentRow, ctx: ViewContext) {
  return {
    payment_id: paymentIdOf(row.id),
    public_id: row.public_id,
    status: row.status,
    amount: unitsToDecimal(BigInt(row.gross_units)),
    currency: 'USDC',
    network: 'arc',
    chain_id: row.chain_id,
    livemode: ctx.livemode,
    order_id: row.order_id,
    description: row.description,
    checkout_url: `${ctx.checkoutBaseUrl.replace(/\/+$/, '')}/pay/${row.public_id}`,
    receiver_address: row.receiver_address,
    usdc_address: ctx.usdcAddress,
    expires_at: row.expires_at.toISOString(),
    created_at: row.created_at.toISOString(),
    payout_address: row.payout_address,
    refund_address: row.refund_address,
    fees: {
      protocol_fee: unitsToDecimal(BigInt(row.protocol_fee_units)),
      keeper_reimbursement: unitsToDecimal(BigInt(row.keeper_reimbursement_units)),
      merchant_net: unitsToDecimal(BigInt(row.merchant_net_units)),
    },
    success_url: row.success_url,
    cancel_url: row.cancel_url,
    settlement: row.settlement_tx_hash
      ? { tx_hash: row.settlement_tx_hash, settled_at: row.settled_at?.toISOString() ?? null }
      : null,
  };
}

/** A pending payment past its window is shown as expired without waiting for the worker. Display only. */
export function effectiveStatus(row: Pick<PaymentRow, 'status' | 'expires_at'>, now: Date): PaymentStatus {
  return row.status === 'awaiting_payment' && row.expires_at.getTime() <= now.getTime() ? 'expired' : row.status;
}

export type PublicRow = PaymentRow & { merchant_name: string; received_units: string };

const settlementOf = (row: Pick<PaymentRow, 'status' | 'settlement_tx_hash' | 'settled_at'>) =>
  // A transaction hash is only ever shown for a payment the worker verified as settled.
  row.status === 'settled' && row.settlement_tx_hash
    ? { tx_hash: row.settlement_tx_hash, settled_at: row.settled_at?.toISOString() ?? null }
    : null;

/**
 * Safe for the customer's browser: no merchant ids, payout addresses, refund addresses or fee internals.
 * The order reference and description are shown on purpose: the merchant chose them for the customer to read.
 */
export function publicView(row: PublicRow, ctx: ViewContext, now: Date) {
  return {
    public_id: row.public_id,
    status: effectiveStatus(row, now),
    merchant_name: row.merchant_name,
    order_reference: row.order_id,
    description: row.description,
    amount: unitsToDecimal(BigInt(row.gross_units)),
    received: unitsToDecimal(BigInt(row.received_units)),
    currency: 'USDC',
    network: 'arc',
    chain_id: row.chain_id,
    livemode: ctx.livemode,
    receiver_address: row.receiver_address,
    usdc_address: ctx.usdcAddress,
    expires_at: row.expires_at.toISOString(),
    success_url: row.success_url,
    cancel_url: row.cancel_url,
    settlement: settlementOf(row),
  };
}

export function publicStatusView(
  row: Pick<PaymentRow, 'public_id' | 'status' | 'expires_at' | 'settlement_tx_hash' | 'settled_at'> & { received_units: string },
  now: Date,
) {
  return {
    public_id: row.public_id,
    status: effectiveStatus(row, now),
    received: unitsToDecimal(BigInt(row.received_units)),
    expires_at: row.expires_at.toISOString(),
    server_time: now.toISOString(),
    settlement: settlementOf(row),
  };
}
