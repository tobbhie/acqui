# Acqui contracts: threat model (Step 02)

Scope: `AcquiTerms`, `PaymentReceiver`, `PaymentFactory`, `PaymentDistributor`. Not deployed. Not independently audited. Run by a built-in review, Slither, 93 Foundry tests (incl. 5 invariants) and a local integration run. A third-party audit is required before mainnet.

## Assets

Customer USDC sitting in per-attempt receivers; merchant payouts in flight; accrued protocol fees in the distributor.

## Actors and trust

| Actor | Trusted for | Not trusted for |
| --- | --- | --- |
| Attester (immutable address, EOA or ERC-1271) | Truthfully reporting that on-time deposits of at least the invoice amount reached the receiver (deposit timestamp, amount, tx reference). | Choosing any destination, fee, reimbursement or amount. It can only authorize a settlement whose terms are fixed by the receiver address. |
| Keeper (anyone) | Paying gas and calling `settle`. | Anything. Cannot settle without an attestation, cannot alter terms, is paid only the precommitted reimbursement. |
| Backend (issues terms) | Creating terms with the merchant payout and refund address the customer was shown. | A wrong backend can create bad terms, but funds only move to the addresses inside the terms, and the attester only signs terms it issued. |
| Fee Safe (immutable) | Receiving fees. | Nothing else. It holds no power over receivers. |
| USDC issuer (Circle) | Token behavior. USDC on Arc is an upgradeable proxy with a blocklist. | Out of our control. Listed as a residual risk. |
| Customer | Declaring a refund address they control. | Funding on time and exactly. |

There is no owner, admin, pause, upgrade path or withdrawal key. Rotating the attester, Safe or limits means deploying a new distributor and factory; old receivers keep their old distributor.

## Key design decisions

1. **Settlement needs an attestation.** A transfer into a receiver never runs its code, and balance does not prove the deposit beat the deadline. The attester signs an EIP-712 `Settlement` over the recomputed terms hash plus the evidence. The contract checks `depositTimestamp <= expiry`, `eligibleAmount >= amount`, and that the receiver really holds `amount`. Settlement pays exactly the invoice amount, never the balance.
2. **Settlement and recovery windows do not overlap.** Settlement is allowed until `expiry + RECOVERY_DELAY`. Unsettled recovery opens strictly after that. A late deposit cannot be turned into a merchant payment after refunds open, and a refund cannot front-run an on-time payment during the grace period.
3. **Recovery is address-only and keyless.** The refund address is part of the terms and therefore part of the receiver address. `tx.from` of a deposit is never used. Nobody, including the attester, can choose another destination. This needs a product change: checkout must collect a refund address before it shows the receiver (the merchant address may be offered as an explicit "refund via merchant" choice).
4. **Pull model.** Receivers only act on instruction from their immutable distributor. Merchant and keeper are paid straight from the receiver, so the distributor only ever holds fees.

## Threats

| Threat | Mitigation | Residual risk | Tests |
| --- | --- | --- | --- |
| Compromised attester signs for a receiver | Cannot redirect: destination fixed by terms. Pays at most the invoice amount and only from the receiver's real balance. | Can settle a payment that arrived late (up to `expiry + RECOVERY_DELAY`) or with a wrong timestamp, paying the merchant instead of refunding the customer. Can also refuse to sign, forcing a refund after the delay. Rotation needs a redeploy. | wrong signer, tampered evidence, cheap invoice cannot drain richer receiver |
| Compromised keeper | No attestation, no settlement. Reimbursement is fixed in the terms and capped by an immutable limit. | Keeper can front-run other keepers for the reimbursement only. | keeper constraints, reimbursement to `msg.sender` |
| Duplicate settlement or signature replay | One-way `settled` flag per unique receiver; digest binds terms hash, EIP-712 domain with chain id and distributor. | None found. | duplicate, other receiver, other chain, other distributor |
| Reentrancy via token hooks | `nonReentrant` on settle, recover, collectFees; effects before interactions. | USDC has no hooks today. | malicious token hook tests |
| Fee or amount manipulation | Fee policy fixed by constants and must equal terms; ceil rounding; `fee + reimbursement + net == gross` fuzzed; net must stay positive. | None found. | fuzz and invariants |
| Fees diverted | `collectFees` is permissionless and always pays immutable `FEE_SAFE`. | Safe key compromise or loss is outside the contracts. | collection tests |
| Payment under, over or after deadline | Underpay: no settlement, refund after delay. Late: attester refuses, refund after delay. Over: invoice amount settles, excess refunded to refund address immediately. | Dust below 1e-6 USDC (native 18-decimal view) stays in the receiver. Non-USDC tokens are not recoverable. | recovery suite |
| Exchange or smart wallet payer | Refund goes to the address the customer declared, not to the sender. | Customer may declare a wrong or unusable address. Checkout must validate and warn. | refund destination fuzz |
| Same payment counted twice (native and ERC-20 logs) | One ERC-20 transfer emits two logs (6 and 18 decimals). Monitor counts only the system emitter. Contract accounting uses the ERC-20 balance view only. | Monitor bug (Step 04). | integration script counts once |
| Blocklisted merchant | `settle` reverts atomically, funds stay, customer is refunded after the delay. | Merchant unpaid until fixed. Backend should pre-check `isBlacklisted` at intent creation. | blocklist atomicity |
| **Blocklisted refund address (open decision)** | Backend should reject a blocklisted refund address (the USDC proxy exposes `isBlacklisted`). | If the address is blocklisted later, `recover` reverts and those funds stay locked. A signed-redirect escape hatch would route funds around an issuer freeze, so it was not added. See OPEN_QUESTIONS. | blocklisted refund test |
| USDC issuer pause, upgrade or freeze | None possible onchain. | Accepted. | none |
| Timestamp manipulation | Arc timestamps come from the proposer, non-decreasing, 1 second granularity. Deadline logic tolerates this by using signed deposit timestamps and a grace period. | A proposer could shift a deposit by seconds around the boundary. | 30-minute boundary tests |
| Griefing via permissionless `deployReceiver` or `recover` | Deploying only creates an inert contract. `recover` only pays the committed refund address. | Gas costs for the caller. | factory tests |
| Address collision across chains or attempts | Terms hash includes chain id and attempt id; receiver is CREATE2 from the factory with that hash. | None found. | uniqueness tests |
| Native send to a not-yet-deployed address | Behaves like a plain account. Deployed later, the same pool is visible through `balanceOf`. | Needs live verification on Arc (open). | simulated by minting before deployment |
| Upgrade or admin abuse | None exists. | Bugs are fixed only by redeploying. | n/a |

## Open items before mainnet

- Independent audit of all four contracts.
- Live Arc Testnet run of `bun run integration:settle` with a native send and an ERC-20 send, with the measured gas against the reimbursement.
- Decide the blocklisted refund address policy (OPEN_QUESTIONS).
- Choose and secure the attester (consider a multisig via ERC-1271 or an HSM-backed key) and the Safe.
- Mainnet constants re-verified live by you (see VERIFIED_CONSTANTS).
