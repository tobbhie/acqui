# Future payment routing

This document describes a possible extension of Acqui. It is not implemented, and it does not represent current network, token, bridge, FX, off-ramp or escrow support. The live MVP accepts USDC on Arc and settles merchants in USDC on Arc through the existing contracts.

## Proposed route

1. A merchant creates an Arc-USDC payment intent.
2. The customer selects a supported source chain and token.
3. A future routing service obtains expiring quotes containing the source amount, slippage, network and bridge fees, minimum Arc USDC received, and route details.
4. The customer executes the source transaction. A source-chain swap may occur when needed.
5. A supported bridge delivers stablecoin to the correct Arc receiver, or through a route that still attributes the destination funds unambiguously to that intent.
6. A route tracker follows the source transaction, swap, bridge message or attestation, destination transaction, and any shortfall.
7. The existing Arc settlement keeper acts only after eligible Arc USDC reaches the receiver.
8. `payment.settled` is emitted only after the existing receipt verification proves the merchant payout on Arc.

The route tracker and settlement keeper could share a process, but they must remain separate logical responsibilities. The Arc keeper must not infer settlement from a source-chain or bridge status.

## Provider boundary

A future adapter may combine liquidity aggregation with a stablecoin bridge. Candidate providers must be verified for supported chains and assets, destination-address behavior, quote guarantees, expiry, failure recovery and API security. No provider should be assumed to support arbitrary token-to-Arc routing in one operation.

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

This type is illustrative only. There is no production table or API for it.

## Failures and recovery

- Source transaction reverts: the attempt failed before bridging; offer a fresh attempt.
- Swap succeeds but bridge is pending: continue to report processing, not failure.
- Bridge attestation is delayed: preserve route evidence and retry tracking.
- Destination receives less than the invoice: classify it as a shortfall and recovery case; never settle it.
- Destination receives enough but the keeper fails: retry settlement through the existing keeper flow.
- Irrecoverable route failure: give actionable recovery instructions and source/destination transaction references.

The merchant payment is complete only when the existing Arc settlement receipt proves the merchant payout.

## Expiry security boundary

The current 30-minute deadline and settlement attestation bind eligibility to the Arc deposit timestamp. A cross-chain checkout would usually want the deadline to govern source initiation rather than bridge completion. Those meanings are not equivalent. The current receiver and attestation design cannot safely be reused for delayed bridge arrivals without a separate threat model, eligibility proof, contract/API design and adversarial tests.

## FX, off-ramp and escrow

After Arc settlement, a merchant might optionally ask a licensed provider to quote fiat conversion and a bank payout. That requires provider integrations, KYC/AML controls, geographic restrictions, reconciliation and a separate failure model. Acqui does not currently provide fiat conversion, custody or bank payouts.

Escrow is also a separate primitive. Conditional release, disputes and refunds require independent contracts, authorization rules and a threat model. The immediate-payout distributor must not be repurposed as escrow.
