# Arc Microgrants: Built with Arc Studio, submission checklist

Source: the program listing texts for "Arc Microgrants: Built with Arc Studio" (Arc community page and its DoraHacks listing, mirrored by hackathon directories). I could not open the DoraHacks page itself, so **re-read the official rules there before you submit**. Submissions close **November 1, 2026**. The earlier "Arc Microgrants" round (closed October 14) is a different program.

## What the listing says you must submit
- Your **Arc Studio project URL** (the address bar of this project: `https://studio.arc.io/app/<id>`). This is how they confirm it was built in Arc Studio.
- A **link to the live app** (public).
- Your **contract address(es)** and **one example transaction hash**, with an explorer link on explorer.arc.io.
- A **public repo** (done: https://github.com/tobbhie/acqui).
- A **video walkthrough** showing the build in Arc Studio and the mainnet transaction.
- A **short description** of what the project does and how Arc Studio was used to build it.
- A **public builder profile** (GitHub, X or Farcaster).
- Contracts must be **written and tested in Arc Studio and deployed to Arc mainnet**, and at least one **mainnet transaction must move real USDC through the contract and the app**. Testnet-only builds are not eligible.

## How it is scored
Real USDC on Arc mainnet with addresses and hashes (30%), use of Arc Studio across contracts, tests and app (25%), a working product (25%), potential to go further (20%).

## No badge required
The listing does not ask for a "Built with Arc Studio" badge on the site. The project URL is the proof, so the footer watermark was removed. The README keeps a one-line attribution.

## Evidence to collect on mainnet (you run these, outside Arc Studio)
| Item | Where it comes from |
|---|---|
| Distributor and factory addresses | your deployment (`docs/MAINNET_DEPLOY.md`) |
| Customer to receiver transaction | the customer wallet's transfer |
| Settlement transaction (merchant payout, fee retained, keeper reimbursement) | the worker's `payment_settled` log, or the payment's `settlement.tx_hash` |
| Fee collection transaction to the Safe | `collectFees()` |
| Webhook delivery and merchant dashboard screenshot | dashboard Payments tab |

## Honesty notes for the description and video
- The settlement attester is a trusted signer; recovery pays only the refund address fixed when the payment was created; the contracts were not independently audited.
- Only USDC on Arc is live. Base, other chains and fiat are roadmap items.
