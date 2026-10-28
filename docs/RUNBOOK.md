# Acqui worker runbook

One worker process runs three loops. It is safe to restart at any time: every step is stored in PostgreSQL before it acts.

## Run it

```bash
bun run worker:dev      # same command on Railway: bun run apps/worker/src/index.ts
```

Run exactly one replica. A PostgreSQL session advisory lock enforces this: a second copy logs `worker_waiting_for_leader_lock` and does nothing until the first one stops. If the lock connection dies, the process exits so the platform restarts it.

Required environment: `DATABASE_URL`, `DISTRIBUTOR_ADDRESS`, `KEEPER_PRIVATE_KEY`, `ATTESTER_PRIVATE_KEY`, `WEBHOOK_SECRET_ENCRYPTION_KEY`. Optional tuning is in `.env.example`.

Startup refuses to run when:
- the address is not a real Acqui distributor on the expected chain (`No contract code at DISTRIBUTOR_ADDRESS`, wrong chain id, offline derivation differs from the contracts);
- `ATTESTER_PRIVATE_KEY` is not the distributor's immutable attester;
- the keeper and attester keys are the same.

Health: `GET :$HEALTH_PORT/health` (default 8081) returns loop status, the scanner cursor and watermark, and active alerts. It answers 503 when a loop has failed three times in a row.

## The loops

| Loop | Every | Does |
|---|---|---|
| scanner | 10 s (`SCAN_INTERVAL_MS`) | Reads the system emitter's USDC `Transfer` logs for the next block range, keeps transfers to known receivers (expired ones too), writes deposits and the cursor in one transaction, then evaluates affected payments |
| keeper | 3 s | Re-verifies deposits on chain, signs the attestation, sends `settle`, waits for the receipt, confirms the payout, marks `settled`. Then executes due recoveries |
| reconcile | 15 s | Expires unpaid intents (only behind the scanner watermark), re-evaluates payments after crashes, delivers and retries webhooks, raises lag and balance alerts |

First start: with no cursor and no payments the scanner starts at the current head. With payments already in the database it refuses until you set `SCANNER_START_BLOCK` to a block before the oldest unsettled payment. It never scans from block 0.

## Log events (JSON lines)

`deposits_recorded`, `payment_verifying`, `payment_underpaid`, `payment_late_deposit`, `settlement_attestation_signed`, `settlement_broadcast`, `payment_settled`, `settlement_attempt_failed`, `funds_recovered`, `webhooks_processed`, `webhook_attempt_failed`, `scanner_range_split`, `loop_error`, `alert`, `alert_cleared`. Logs never contain keys, tokens or webhook secrets.

## Alerts

Each alert is logged at `error` level as `{"event":"alert","code":...}` and, if `ALERT_WEBHOOK_URL` is set, posted there. Repeats are suppressed for 10 minutes. They clear on their own when the condition ends.

| Code | Meaning | What to do |
|---|---|---|
| `loop_failing:<name>` | A loop failed 3 times in a row. For the scanner this is usually the RPC | Check RPC status and the `loop_error` lines. Add `ARC_RPC_FALLBACK_URLS`. Nothing is lost: the cursor does not move on failure |
| `cursor_lag` | The last scanned block is older than `CURSOR_LAG_ALERT_SECONDS` | Same as above, or the chain halted. Payments cannot expire or become underpaid while the scanner lags (by design) |
| `keeper_balance_low` / `keeper_gas_shortage` | Keeper wallet is below the configured minimum or cannot pay for a transaction | Send USDC (the gas token) to the keeper address printed at startup. Waiting settlements resume by themselves |
| `stuck_settlements` | Payments have waited longer than `STUCK_SETTLEMENT_ALERT_SECONDS` in verifying, settling or retryable_failure | Look at `settlement_attempts.error_code` for those payments (below) |
| `settlement_reverted:<id>` | A settlement transaction reverted on chain | Read the revert in the explorer. The payment retries with backoff, up to 5 attempts, then moves to recovery |
| `deposit_unverified:<id>` / `receiver_balance_short:<id>` | The keeper could not re-confirm a recorded deposit, or the receiver holds less than the invoice | Do not force anything. Check the deposit transaction on the explorer. The payment stays in `verifying` and nothing is signed |
| `terms_integrity_failure` | Stored terms do not reproduce the committed receiver address | Treat as database tampering or a bad deploy. Nothing was signed. Compare with the contract and escalate |
| `settled_log_missing:<id>` / `settled_event_missing:<id>` / `payout_leg_missing:<id>` | The chain says settled but the receipt does not match what is expected | Inspect the transaction by hand. The payment is NOT marked settled until the receipt matches |
| `recovery_blocked:<case>` | `recover` cannot run, typically a blocklisted refund address | The funds stay safely in the receiver. See "Blocklisted refund address" in `docs/THREAT_MODEL.md` |
| `webhook_delivery_failed:<id>` | A webhook gave up after its last retry | Ask the merchant to fix their endpoint, then reset the row (below) |
| `settlement_gave_up:<id>` | Settlement abandoned, funds go to recovery | Normal for payments that cannot be settled; refund follows after the contract grace period |

## Procedures

**A payment is stuck in `settling`.** Check its latest attempt:
```sql
SELECT attempt_no, status, tx_hash, error_code, error, submitted_at FROM settlement_attempts
WHERE payment_intent_id = '<id>' ORDER BY attempt_no;
```
- `submitted` and young: wait. The keeper re-broadcasts the same signed bytes after 20 s and treats a transaction unknown for 10 minutes as dropped.
- `pending` with `insufficient_gas`: fund the keeper.
- Never insert attempts or change statuses by hand. The keeper first asks the contract whether the payout already happened, so a restart cannot pay twice.

**Resend a failed webhook** (after the merchant fixed their endpoint):
```sql
UPDATE webhook_deliveries SET status = 'pending', attempts = 0, next_attempt_at = now(), last_error = NULL WHERE id = '<delivery id>';
```
The delivery id and body stay the same, so a merchant that already processed it can deduplicate.

**Rotate keys.** Keeper key: send funds to the new address, deploy with the new `KEEPER_PRIVATE_KEY`, move the leftover balance. The attester key is the contract's immutable attester: changing it means deploying a new distributor (new receivers); keep the old worker running until its payments settle.

**Late funds.** A payment that receives money after its window is never settled. It becomes `recovery_required` with a `recovery_cases` row; the keeper returns the money to the refund address committed in the receiver once the contract's grace period (chain time) is over. Set `RECOVERY_AUTOEXECUTE=false` to review cases manually instead (anyone can still call `recover(terms)`).

## Known limits

- The scanner filters in the worker, not on the RPC: it reads every system-emitter Transfer in the range. Measured on Arc Testnet: about 6 logs per block, and a 300 block range returned in one call. If a provider limits results, ranges are split automatically.
- Rate limits and alert de-duplication live in memory (single replica).
- Gas accounting uses the native 18-decimal view (`NATIVE_WEI_PER_USDC_UNIT`); everything money-related for merchants uses 6-decimal ERC-20 units.
