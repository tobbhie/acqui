# Walkthrough video: script and shot list (about 3m30s)

The Arc Microgrants listing asks for a video that **shows the build in Arc Studio and the mainnet transaction**. It is scored on real mainnet USDC (30%), use of Arc Studio across contracts, tests and app (25%), a working product (25%) and potential (20%). Record the screen yourself with a voice-over; the lines below are written to be read as they are.

## Before you press record
- [ ] Mainnet distributor deployed by you (`docs/MAINNET_DEPLOY.md`). API, worker and website running with mainnet settings, keeper funded with a little USDC.
- [ ] A demo merchant exists: payout wallet, return origin, API key set as `DEMO_MERCHANT_API_KEY`.
- [ ] A **separate customer wallet** with a few USDC on Arc (1.00 is enough for the demo sticker pack).
- [ ] Tabs ready: Arc Studio project (this chat, Contracts panel, test results), the live site, explorer.arc.io, the merchant dashboard, the GitHub repo.
- [ ] Do one full dry run first. On testnet if mainnet is not ready, but the submitted video needs the mainnet run.
- [ ] Hide secrets: no `.env`, no API key on screen (create the key off camera or blur it), no private keys, no wallet seed. The key appears only once on creation.

## Script
| Time | Show | Say |
|---|---|---|
| 0:00 | Landing page | "Businesses that want to accept USDC today have to run their own wallet watching and settlement. Acqui is a payment gateway for Arc: one API call, a hosted checkout, and real USDC settled to the merchant." |
| 0:20 | Arc Studio: the project URL, then the Contracts panel and the test results | "I built all of this in Arc Studio. It wrote the contracts, tested them, and built the app. Four contracts: a factory, a receiver per payment, and a distributor. Here are the tests: fee math, replay protection, late payment recovery, reentrancy. 93 contract tests, plus the API and worker tests." |
| 0:50 | Merchant dashboard: sign in, payout address, return origin | "A merchant signs in with Google, adds a payout wallet that must be typed twice and acknowledged, and creates an API key. The key is shown once and only a hash is stored." |
| 1:15 | Demo store: click Pay with USDC | "This demo store's server holds the key and creates the payment. The browser never sees it." |
| 1:35 | Hosted checkout | "Each payment gets its own address, a 30-minute countdown, and the exact amount. The page only trusts the server's status." |
| 2:00 | Customer wallet sends USDC to that address | "Now I send real USDC on Arc mainnet from a different wallet." |
| 2:20 | Checkout moves to settled; click the transaction link on explorer.arc.io | "The worker saw the deposit, checked it on chain, and signed an approval. The contract pays the merchant and keeps the fee. Here is the transaction." |
| 2:45 | Explorer: merchant received the net amount; distributor holds the fee; then the `collectFees` transaction to the Safe | "The merchant got the payment minus the fee. The fee goes only to this Safe, and anyone can trigger collection." |
| 3:05 | Demo order page shows Order paid; merchant dashboard Payments tab; webhook delivery | "The demo order is marked paid only because the payments API reports it settled. The merchant gets a signed webhook." |
| 3:20 | Architecture slide or README | "A trusted signer approves each settlement, and the contracts were not independently audited. Next: Base and fiat on-ramps." |

## Say these honestly
- The attester is a trusted signer: it cannot change where money goes, but it decides which deposits were on time.
- Late or partial payments are refunded to the refund address fixed when the payment was created, after a grace period.
- Only USDC on Arc is live today.

## After recording
Upload it publicly, put the link in the submission, and re-check the explorer links from the video description. Use `docs/SUBMISSION.md` as the final checklist.
