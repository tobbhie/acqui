-- Keep merchant identities and settings while allowing a clean testnet-to-mainnet cutover.
-- The same merchant idempotency key may be used once on each chain, never twice on one chain.
ALTER TABLE payment_intents DROP CONSTRAINT payment_intents_idem;
ALTER TABLE payment_intents
  ADD CONSTRAINT payment_intents_idem UNIQUE (merchant_id, chain_id, idempotency_key);
