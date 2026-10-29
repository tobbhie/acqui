# Acqui — Roadmap UI & Future Payment Architecture Addendum
**28 October 2026 | MVP frontend implementation + future-only engineering design**
**Repository:** https://github.com/tobbhie/acqui

> Arc Studio: This is an additive change to the existing Acqui project. Preserve all deployed contracts, payment flows, APIs, database schema, worker logic, and test coverage. Implement the UI sections now. The cross-chain, FX, off-ramp, and escrow architecture is documentation only, not functional MVP scope.

## 1. Product direction

Acqui is a **payment gateway**, initially accepting **USDC on Arc**, with **USDC on Arc** as the merchant settlement asset. The long-term model is **accept assets across multiple networks; convert and route to USDC on Arc; settle merchants through Acqui's existing contracts**.

Arc is a **blockchain settlement network**, not a currency. USDC is the settlement asset. Future fiat off-ramping, FX, escrow, and marketplace payouts are opportunities, not current capabilities. They depend on providers, liquidity, security, compliance, and jurisdiction.

Suggested positioning: **“More ways to pay. One settlement destination.”** Supporting line: **“Accept crypto payments through a simple API. Live with USDC on Arc today, built for broader payment acceptance tomorrow.”**

Do not imply that multi-chain routes or fiat payouts work today.

## 2. Verified repository context (do not override)

Connected repository: `tobbhie/acqui`, default branch `main`.
- React 18 + Vite + TypeScript + Tailwind frontend in `src/`.
- Bun/Hono/PostgreSQL API in `apps/api/`; viem/Bun worker in `apps/worker/`.
- Solidity/Foundry contracts in `contracts/`: AcquiTerms, PaymentReceiver, PaymentFactory, PaymentDistributor.
- Shared policies and types in `packages/shared/`.
- `docs/VERIFIED_CONSTANTS.md` reports Arc Testnet chain ID `5042002`, USDC ERC-20 `0x3600000000000000000000000000000000000000` with 6 decimals, and native transfer system emitter `0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE`. `docs/chain-verification-arc-testnet.json` records RPC checks.
- `docs/OPEN_QUESTIONS.md` lists testnet **fee Safe** `0x78b96a800a3a6cd349cb2b0016148F20621cd00F`. **This is not a distributor/factory deployment address.**
- At inspection time README and `docs/ARCHITECTURE.md` still state nothing deployed. User reports a more recent testnet deployment. Find actual deployment manifest/receipts and update documentation separately; do not invent contract addresses.

This feature must **not** change contract code, CREATE2 receiver behavior, USDC detection, 30-minute expiration, refund handling, attester, keeper, fee accounting, or current REST API.

## 3. Landing page: implement now

### Hero
Headline: **“Crypto payments. USDC settlement on Arc.”**
Subhead: **“A hosted checkout and simple API for businesses. Accept USDC on Arc today, with more currencies and networks on the roadmap.”**
CTAs: **Try the demo** (`/demo`) and **For merchants** (`/merchants`).

### Payment paths illustration
A compact, readable flow:
**Customer payment methods → Acqui payment routing → USDC on Arc → Merchant**

Only **USDC on Arc** is live. Label swap/bridge routing **“Planned”**. The diagram is a product vision, not a transaction visualization.

### Supported / planned payment methods
Display a curated set of cards, with asset, network and status. Only the first is enabled.

| Asset | Network | UI status |
|---|---|---|
| USDC | Arc | **Live** |
| USDC | Base | Coming soon |
| USDC | Ethereum | Coming soon |
| ETH | Ethereum | Planned |
| ETH | Base | Planned |
| USDC | Solana | Exploring |
| SOL | Solana | Exploring |
| USDT | Selected networks | Exploring |

These are examples of possible future routes, **not confirmed integrations or committed launch dates**. Use subdued cards and clear text; no fake exchange partner logos, route quotes or chain availability.

### Roadmap section
**Now — USDC on Arc:** hosted checkout, unique payment receiver, merchant settlement, payment status and signed webhooks.

**Next — Multi-chain acceptance:** source-chain swaps, USDC bridging, destination verification, and Arc settlement. Subject to liquidity and bridge support.

**Later — Financial payment primitives:** optional fiat off-ramp/FX provider integrations, programmable escrow, and marketplace payouts. Not available yet.

### Why settle on Arc?
Explain one consistent USDC accounting and settlement destination, simplifying merchant integration. Potential off-ramps may convert USDC to fiat in supported jurisdictions. Avoid claiming universal off-ramp availability, fixed fees, guaranteed liquidity, or regulatory approval.

## 4. Checkout: implement now

- Keep actual payment mechanism unchanged.
- Show **Pay with: USDC · Arc (Available now)**.
- Optional small disabled entry: **Other networks and assets — Coming soon**.
- Disabled entries must not generate quotes, addresses, bridge calls, or payment intents.
- Warn clearly: **“Only send USDC on Arc to this address.”**
- Preserve 30-minute countdown, QR/address, payment states, and merchant return flow.
- No fake multi-chain progress state.

## 5. Merchant dashboard: implement now

Add one compact panel:
- **Accepted today:** USDC on Arc.
- **Settlement:** USDC on Arc.
- **Planned:** more networks and currencies, with Acqui handling conversion and routing.
- Keep merchant onboarding, payout wallet, API keys, and transaction history unchanged.
- Do not add functional FX, escrow, off-ramp, token management or liquidity settings.

## 6. Minimal code scaffold (frontend only)

Create a typed static capability manifest in the frontend's existing configuration convention:

```ts
type Availability = 'live' | 'planned' | 'exploring';
type PaymentCapability = {
  id: string;
  asset: string;
  network: string;
  availability: Availability;
  settlementAsset: 'USDC';
  settlementNetwork: 'arc';
};
```

Only `USDC/arc` has `availability: 'live'`. Other entries are display-only. Share this configuration across landing, checkout, and merchant dashboard. **Do not rely on frontend state for payment authorization:** the existing API and contracts must continue rejecting unsupported currencies/chains.

No new database migrations, RPC watchers, routing provider keys, background jobs, or contracts.

## 7. Future multi-chain engineering design (documentation only)

### Future flow
1. Merchant creates a payment intent denominated in USDC on Arc.
2. Customer selects a supported source chain and token.
3. Acqui queries one or more quote providers for source amount, slippage, network fees, bridge fee, minimum Arc USDC received, expiry and route details.
4. Customer executes source payment. Source swap occurs if necessary.
5. Supported bridge transfers stablecoin to **the correct Arc payment receiver**, or a controlled route that can unambiguously attribute payment to the intent.
6. **Route tracker** monitors source transaction, swap, bridge message/attestation, destination transaction, and shortfalls.
7. **Existing Arc settlement keeper** verifies destination USDC and settles the merchant. It does not need to monitor source bridges itself.
8. Merchant receives signed `payment.settled` webhook only after Arc payout.

The route tracker and keeper may share one worker process but have separate logical responsibilities.

### Provider model
A provider adapter may combine source-chain liquidity aggregation and a stablecoin bridge. Tower's Arc-focused swaps and CCTP USDC bridge are possible components, but **do not assume Tower can swap arbitrary tokens on arbitrary chains in one step**. Verify supported source chains, destination address behavior, quote guarantees, and provider APIs before implementation.

### Proposed future route record
```ts
type FutureRoute = {
  routeId: string;
  paymentIntentId: string;
  sourceChain: string;
  sourceToken: string;
  sourceAmount: string;
  destinationChain: 'arc';
  destinationToken: 'USDC';
  minimumDestinationAmount: string;
  quoteExpiry: string;
  provider: string;
  sourceTxHash?: string;
  bridgeMessageId?: string;
  destinationTxHash?: string;
  status: 'quoted' | 'awaiting_source' | 'source_confirmed' |
    'swapping' | 'bridging' | 'destination_confirmed' |
    'settling' | 'settled' | 'needs_action' | 'refunding' | 'refunded';
};
```
This is **documentation-only**. Do not add production DB tables or API endpoints now.

### Bridge failure reporting
- Source transaction reverts → failed before bridging; offer new attempt.
- Swap succeeds, bridge pending → processing; do not claim failure.
- Bridge attestation delayed → delayed; track and retry.
- Destination receives less than invoice → shortfall/recovery, not settled.
- Destination receives full amount, keeper fails → settlement retry.
- Irrecoverable route failure → actionable recovery information, source/destination transaction links, provider references.
- Never call a merchant payment completed until actual Arc settlement is verified.

**Expiry caveat:** For cross-chain checkout, the 30-minute deadline should generally govern source payment initiation, not bridge completion. Existing Arc receiver expiry/attestation logic **cannot be reused unchanged** without proving how delayed bridge arrivals remain eligible. This requires a separate security design and tests before release.

### FX/off-ramp extension
After Arc USDC settlement, merchants could optionally request a licensed provider to quote conversion to supported fiat and send a bank payout. This adds provider APIs, KYC/AML and geographic restrictions. **No fiat conversion, custody, or bank payout in this MVP.**

### Escrow extension
Escrow is a separate payment primitive with conditional release, dispute and refund rules. It must have independent contracts, authorization and threat model. Do not alter the current immediate-payout distributor to behave as escrow.

## 8. Design and implementation rules

- Preserve existing Acqui visual identity and routes; targeted additions, not redesign.
- Mobile responsive, accessible disabled states, keyboard navigation.
- “Live” must be prominent; future options muted and unclickable.
- No misleading support badges, fake liquidity numbers, fake quotes, or unsupported partner names.
- Static frontend data only; no extra RPC/API calls to render roadmap.
- Do not touch deployed/testnet contracts, payment API, worker, fees, scanner, attestation, database, or webhooks.

## 9. Acceptance checklist

- [ ] Landing page clearly communicates current Arc USDC acceptance and future multi-chain acceptance.
- [ ] Arc is described as settlement network, USDC as settlement asset.
- [ ] Only USDC on Arc is enabled everywhere.
- [ ] Disabled methods cannot start a payment.
- [ ] FX/off-ramp/escrow are explicitly future concepts.
- [ ] Existing checkout works unchanged.
- [ ] Merchant API and contract tests remain unaffected.
- [ ] Typecheck, lint and mobile layout pass.
- [ ] New future routing architecture documented separately.
- [ ] No invented deployment addresses or mainnet support claims.

## 10. Arc Studio follow-up prompt (paste separately)

Implement this Acqui addendum **only as an additive frontend change** to the existing React/Vite project. Inspect existing components/routes first. Add a compact landing section describing the vision “more ways to pay, USDC settlement on Arc,” a clear visual flow, a payment-method grid with only USDC on Arc active and others labeled Coming soon/Exploring, and a concise roadmap for multi-chain routing, FX/off-ramp, and escrow. Add an informational supported-methods panel to merchant UI and a disabled “more payment methods coming soon” entry to checkout. Create a typed static frontend capabilities manifest; add `docs/FUTURE_PAYMENT_ROUTING.md` with future provider, bridge tracking, failure, refund and expiry design. Do not add any live bridging, FX, escrow, database migrations, API endpoints, contracts or worker logic. Preserve the current Arc USDC checkout and all tests. Report exact changed files and verify typecheck and mobile UI. Do not invent deployed contract addresses; if a deployment manifest exists, cite its actual values.
