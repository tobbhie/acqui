-- Worker support: scanner watermark, settlement attempt evidence, webhook outbox bodies, recovery scheduling.

-- The scanner watermark: timestamp of the last fully scanned block. Intents only expire or become
-- underpaid once the watermark is past their expiry, so an unscanned on-time deposit can never be missed.
ALTER TABLE chain_cursors
  ADD COLUMN last_block_timestamp timestamptz,
  ADD COLUMN head_block bigint,
  ADD COLUMN head_seen_at timestamptz;

ALTER TABLE settlement_attempts
  ADD COLUMN evidence jsonb,
  ADD COLUMN signature text,
  ADD COLUMN raw_tx text,
  ADD COLUMN nonce bigint,
  ADD COLUMN submitted_at timestamptz,
  ADD COLUMN receipt_block bigint,
  ADD COLUMN gas_used bigint,
  ADD COLUMN error_code text;

-- At most one live attempt per payment: prevents two workers or two loops from racing to pay out.
CREATE UNIQUE INDEX settlement_attempts_one_live ON settlement_attempts(payment_intent_id)
  WHERE status IN ('pending','submitted');

-- Exact signed bytes. JSONB would reorder keys and break the signature.
ALTER TABLE webhook_deliveries
  ADD COLUMN body text,
  ADD COLUMN url text,
  ADD COLUMN last_attempt_at timestamptz;

ALTER TABLE recovery_cases
  ADD COLUMN after_settlement boolean NOT NULL DEFAULT false,
  ADD COLUMN executable_at timestamptz,
  ADD COLUMN error text;
CREATE UNIQUE INDEX recovery_cases_one_open ON recovery_cases(payment_intent_id)
  WHERE status IN ('open','submitted');

CREATE INDEX deposits_chain_block_idx ON deposits(chain_id, block_number);
