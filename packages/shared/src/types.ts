/** Core Acqui domain types. JSON-facing amounts are base-unit strings; internal math uses bigint. */

export type Address = `0x${string}`;
export type Hex = `0x${string}`;

/** Integer USDC base units (6 decimals) serialized as a decimal string. */
export type UsdcBaseUnits = string;

export type NetworkId = 'arc-testnet';

export interface Merchant {
  id: string;
  ownerEmail: string;
  displayName: string;
  /** Null until configured. Once set it is frozen unless email-confirmed change is available. */
  payoutAddress: Address | null;
  payoutAddressFrozen: boolean;
  webhookUrl: string | null;
  returnOrigin: string | null;
  createdAt: string;
}

/** Revocable credential. The secret is shown once; only a hash is stored. */
export interface ApiKeyRecord {
  id: string;
  merchantId: string;
  label: string;
  /** Non-secret display prefix, for example "acq_live_ab12". */
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/**
 * Lifecycle. `settled` may only be set after a verified onchain settlement transaction.
 * `payment_detected` means funds were seen at the receiver, not that the merchant was paid.
 */
export type PaymentIntentStatus =
  | 'awaiting_payment'
  | 'payment_detected'
  | 'settling'
  | 'settled'
  | 'expired'
  | 'underpaid'
  | 'failed';

export interface PaymentIntent {
  id: string;
  /** Opaque public id used in checkout URLs. Never a secret. */
  publicId: string;
  merchantId: string;
  network: NetworkId;
  amount: UsdcBaseUnits;
  reference: string | null;
  /** Immutable snapshot of the merchant payout address at creation time. */
  merchantPayoutAddress: Address;
  status: PaymentIntentStatus;
  createdAt: string;
}

export interface PaymentAttempt {
  id: string;
  paymentIntentId: string;
  attemptNumber: number;
  /** Deterministic CREATE2 receiver. Never reused across attempts. */
  receiverAddress: Address;
  salt: Hex;
  expiresAt: string;
  createdAt: string;
}

export interface SettlementRecord {
  paymentIntentId: string;
  attemptId: string;
  txHash: Hex;
  blockNumber: string;
  gross: UsdcBaseUnits;
  gatewayFee: UsdcBaseUnits;
  keeperReimbursement: UsdcBaseUnits;
  merchantNet: UsdcBaseUnits;
}

export type WebhookEventType = 'payment.settled' | 'payment.expired';

export interface WebhookEvent {
  id: string;
  type: WebhookEventType;
  createdAt: string;
  data: {
    paymentIntentId: string;
    publicId: string;
    reference: string | null;
    network: NetworkId;
    amount: UsdcBaseUnits;
    settlement: SettlementRecord | null;
  };
}

/** Headers on every outbound webhook. Signature = HMAC-SHA256 over `${timestamp}.${rawBody}`. */
export const WEBHOOK_SIGNATURE_HEADER = 'acqui-signature';
export const WEBHOOK_TIMESTAMP_HEADER = 'acqui-timestamp';
