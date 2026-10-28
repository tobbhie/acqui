/** Response shapes of the Acqui API as the browser consumes them. Amounts are decimal strings. */
export type PaymentStatus =
  | 'created' | 'awaiting_payment' | 'deposit_detected' | 'verifying' | 'settling'
  | 'settled' | 'expired' | 'underpaid' | 'recovery_required' | 'retryable_failure'

export interface PublicConfig {
  network: string
  chain_id: number
  livemode: boolean
  payments_ready: boolean
  payout_changes_enabled: boolean
  demo_enabled: boolean
}

export interface Settlement { tx_hash: string; settled_at: string | null }

export interface PublicPayment {
  public_id: string
  status: PaymentStatus
  merchant_name: string
  order_reference: string
  description: string | null
  amount: string
  received: string
  currency: 'USDC'
  chain_id: number
  livemode: boolean
  receiver_address: string
  usdc_address: string
  expires_at: string
  success_url: string | null
  cancel_url: string | null
  settlement: Settlement | null
}

export interface PublicStatus {
  public_id: string
  status: PaymentStatus
  received: string
  expires_at: string
  server_time: string
  settlement: Settlement | null
}

export interface SessionInfo {
  user: { email: string; name: string | null }
  csrf_token: string
  merchant: { merchant_id: string; display_name: string } | null
}

export interface MerchantSettings {
  merchant_id: string
  display_name: string
  payout_address: string | null
  payout_address_set_at: string | null
  allowed_return_origin: string | null
  webhook_url: string | null
  webhook_secret_configured: boolean
  payout_changes_enabled: boolean
  created_at: string
}

export interface ApiKeyInfo {
  id: string
  prefix: string
  label: string
  created_at: string
  last_used_at: string | null
  expires_at: string | null
  revoked_at: string | null
}

export interface MerchantPayment {
  payment_id: string
  public_id: string
  status: PaymentStatus
  amount: string
  order_id: string
  description: string | null
  checkout_url: string
  chain_id: number
  created_at: string
  expires_at: string
  fees: { protocol_fee: string; keeper_reimbursement: string; merchant_net: string }
  settlement: Settlement | null
}

export interface DemoProduct { id: string; name: string; blurb: string; price: string }

export interface DemoOrder {
  order_id: string
  product: { id: string; name: string } | null
  amount: string
  fulfilment: 'pending' | 'paid' | 'expired' | 'attention' | 'failed'
  payment_status: string | null
  verification: 'verified' | 'unavailable' | 'none'
  confirmed_via: 'api' | 'webhook' | null
  settlement_tx_hash: string | null
  checkout_url: string | null
}
