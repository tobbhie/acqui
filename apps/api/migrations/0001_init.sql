-- Acqui initial schema. Amounts are integer USDC base units (6 decimals) stored as bigint.
-- Addresses are stored lowercase (0x + 40 hex) so uniqueness is case-insensitive by construction.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE DOMAIN eth_address AS text CHECK (VALUE ~ '^0x[0-9a-f]{40}$');
CREATE DOMAIN eth_hash AS text CHECK (VALUE ~ '^0x[0-9a-f]{64}$');
CREATE DOMAIN usdc_units AS bigint CHECK (VALUE >= 0);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub text NOT NULL UNIQUE,
  email text NOT NULL,
  email_verified boolean NOT NULL CHECK (email_verified),
  name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE oauth_flows (
  state_hash bytea PRIMARY KEY,
  code_verifier text NOT NULL,
  nonce text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  csrf_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE merchants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 80),
  payout_address eth_address,
  payout_address_set_at timestamptz,
  allowed_return_origin text,
  webhook_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION merchants_immutable_ids() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'merchant id, owner and created_at are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER merchants_immutable BEFORE UPDATE ON merchants
  FOR EACH ROW EXECUTE FUNCTION merchants_immutable_ids();

-- Merchant identity is independent of keys. Only a keyed digest of the secret is stored.
CREATE TABLE api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  key_id text NOT NULL UNIQUE,
  secret_digest bytea NOT NULL,
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz
);
CREATE INDEX api_keys_merchant_idx ON api_keys(merchant_id);

-- Signing secret for outgoing webhooks, encrypted at rest (AES-256-GCM).
CREATE TABLE webhook_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  ciphertext bytea NOT NULL,
  nonce bytea NOT NULL,
  key_version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE UNIQUE INDEX webhook_secrets_active_idx ON webhook_secrets(merchant_id) WHERE revoked_at IS NULL;

CREATE TABLE payment_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  order_id text NOT NULL CHECK (char_length(order_id) BETWEEN 1 AND 128),
  description text CHECK (char_length(description) <= 500),
  idempotency_key text NOT NULL,
  request_hash bytea NOT NULL,
  chain_id int NOT NULL,
  network text NOT NULL,
  currency text NOT NULL CHECK (currency = 'USDC'),
  gross_units usdc_units NOT NULL CHECK (gross_units >= 1000000),
  -- Snapshot of the terms committed to the receiver address. Never updated after insert.
  receiver_address eth_address NOT NULL UNIQUE,
  distributor_address eth_address NOT NULL,
  terms_hash eth_hash NOT NULL UNIQUE,
  intent_ref eth_hash NOT NULL,
  attempt_ref eth_hash NOT NULL,
  payout_address eth_address NOT NULL,
  refund_address eth_address NOT NULL,
  fee_bps int NOT NULL,
  min_fee_units usdc_units NOT NULL,
  protocol_fee_units usdc_units NOT NULL,
  keeper_reimbursement_units usdc_units NOT NULL,
  merchant_net_units usdc_units NOT NULL,
  success_url text,
  cancel_url text,
  status text NOT NULL DEFAULT 'created' CHECK (status IN (
    'created','awaiting_payment','deposit_detected','verifying','settling','settled',
    'expired','underpaid','recovery_required','retryable_failure')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Set only by the confirmed settlement receipt path.
  settlement_tx_hash eth_hash,
  settlement_log_index int,
  settlement_block bigint,
  settled_at timestamptz,
  CONSTRAINT payment_intents_idem UNIQUE (merchant_id, idempotency_key),
  CONSTRAINT payment_intents_amounts CHECK (
    protocol_fee_units + keeper_reimbursement_units + merchant_net_units = gross_units),
  CONSTRAINT payment_intents_expiry CHECK (expires_at > created_at),
  CONSTRAINT payment_intents_settled_needs_receipt CHECK (
    status <> 'settled' OR (settlement_tx_hash IS NOT NULL AND settled_at IS NOT NULL))
);
CREATE INDEX payment_intents_merchant_created_idx ON payment_intents(merchant_id, created_at DESC, id DESC);
CREATE INDEX payment_intents_status_idx ON payment_intents(status, expires_at);

CREATE FUNCTION payment_intents_freeze_terms() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.receiver_address IS DISTINCT FROM OLD.receiver_address
     OR NEW.payout_address IS DISTINCT FROM OLD.payout_address
     OR NEW.refund_address IS DISTINCT FROM OLD.refund_address
     OR NEW.gross_units IS DISTINCT FROM OLD.gross_units
     OR NEW.protocol_fee_units IS DISTINCT FROM OLD.protocol_fee_units
     OR NEW.keeper_reimbursement_units IS DISTINCT FROM OLD.keeper_reimbursement_units
     OR NEW.merchant_net_units IS DISTINCT FROM OLD.merchant_net_units
     OR NEW.terms_hash IS DISTINCT FROM OLD.terms_hash
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id THEN
    RAISE EXCEPTION 'payment intent terms are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_intents_freeze BEFORE UPDATE ON payment_intents
  FOR EACH ROW EXECUTE FUNCTION payment_intents_freeze_terms();

CREATE TABLE payment_status_events (
  id bigserial PRIMARY KEY,
  payment_intent_id uuid NOT NULL REFERENCES payment_intents(id),
  from_status text,
  to_status text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_status_events_intent_idx ON payment_status_events(payment_intent_id, id);

-- One row per observed deposit movement. Native (system emitter) and ERC-20 logs for the same
-- transfer must not both be inserted: the monitor records the system emitter only.
CREATE TABLE deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_intent_id uuid NOT NULL REFERENCES payment_intents(id),
  chain_id int NOT NULL,
  tx_hash eth_hash NOT NULL,
  log_index int NOT NULL,
  block_number bigint NOT NULL,
  block_timestamp timestamptz NOT NULL,
  from_address eth_address,
  amount_units usdc_units NOT NULL CHECK (amount_units > 0),
  on_time boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deposits_event_key UNIQUE (chain_id, tx_hash, log_index)
);
CREATE INDEX deposits_intent_idx ON deposits(payment_intent_id);

CREATE TABLE settlement_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_intent_id uuid NOT NULL REFERENCES payment_intents(id),
  attempt_no int NOT NULL CHECK (attempt_no >= 1),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','submitted','confirmed','failed')),
  chain_id int NOT NULL,
  tx_hash eth_hash,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT settlement_attempts_no UNIQUE (payment_intent_id, attempt_no),
  CONSTRAINT settlement_attempts_tx UNIQUE (chain_id, tx_hash)
);

CREATE TABLE chain_cursors (
  chain_id int NOT NULL,
  name text NOT NULL,
  last_block bigint NOT NULL CHECK (last_block >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, name)
);

CREATE TABLE webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  payment_intent_id uuid NOT NULL REFERENCES payment_intents(id),
  event_type text NOT NULL CHECK (event_type IN ('payment.settled','payment.expired')),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','failed')),
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_status_code int,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  CONSTRAINT webhook_deliveries_once UNIQUE (payment_intent_id, event_type)
);
CREATE INDEX webhook_deliveries_due_idx ON webhook_deliveries(next_attempt_at) WHERE status = 'pending';

CREATE TABLE payout_address_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  requested_by_user_id uuid NOT NULL REFERENCES users(id),
  old_address eth_address,
  new_address eth_address NOT NULL,
  token_hash bytea NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  CONSTRAINT payout_change_used CHECK ((status = 'confirmed') = (used_at IS NOT NULL))
);
CREATE INDEX payout_changes_merchant_idx ON payout_address_changes(merchant_id, created_at DESC);

CREATE TABLE recovery_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_intent_id uuid NOT NULL REFERENCES payment_intents(id),
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  reason text NOT NULL CHECK (reason IN ('underpaid','late','overpaid','settlement_failed')),
  amount_units usdc_units,
  refund_address eth_address NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','submitted','recovered','closed')),
  recovery_tx_hash eth_hash,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recovery_cases_intent_idx ON recovery_cases(payment_intent_id);
