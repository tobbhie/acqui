-- Demo store orders. The demo server creates payments exactly as an outside merchant backend would
-- and only marks an order paid after the payment API (or a signed webhook) says it settled.

CREATE TABLE demo_orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          text NOT NULL,
  amount_units        bigint NOT NULL CHECK (amount_units > 0),
  payment_id          text UNIQUE,
  public_id           text,
  status              text NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'pending', 'paid', 'failed')),
  settlement_tx_hash  text,
  confirmed_via       text CHECK (confirmed_via IN ('api', 'webhook')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT demo_paid_needs_tx CHECK (status <> 'paid' OR (settlement_tx_hash IS NOT NULL AND confirmed_via IS NOT NULL))
);
