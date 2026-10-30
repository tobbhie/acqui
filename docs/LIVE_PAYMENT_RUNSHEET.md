# Live payment run sheet (Arc mainnet)

Goal: one real payment that moves USDC through the Acqui contract to a merchant and accounts for the protocol fee, with every hash saved. Use the 1.00 USDC minimum.

Expected split for 1.00 USDC: **merchant 0.88, Acqui fee 0.10, network fee 0.02.**

## Before you start
- [ ] Open https://acqui.pages.dev/api/public/config: `"livemode": true`, `"chain_id": 5042`, `"payments_ready": true`.
- [ ] The worker is running and its log shows the mainnet contract check passed and the first scan starting at block 28630653.
- [ ] The keeper wallet holds enough USDC for gas (a few cents per payment).
- [ ] The merchant has a payout wallet and a return site set. Note its address.
- [ ] A separate **customer wallet** holds at least 1.05 USDC on Arc mainnet.
- [ ] Note starting balances: merchant wallet, fee recipient `0x78b9…d00F`, payment contract `0xdb03…0418`, keeper wallet.
- [ ] Start screen recording. Hide any key, `.env` or secret.

## Steps
1. Open https://acqui.pages.dev/demo and press **Pay with USDC** on the 1.00 USDC item. Copy the **public id** from the checkout URL.
2. On checkout, check: amount 1.00 USDC, network Arc mainnet, chain ID 5042, the 30-minute countdown, the payment address and QR.
3. From the customer wallet, send exactly **1.00 USDC** to that payment address. Copy the **deposit transaction hash**.
4. Watch the checkout move through payment seen, settling and settled. Do not refresh the demo order page for proof: it asks the API.
5. Copy the **settlement transaction hash** from the "View transaction" link on checkout (also `settlement.tx_hash` in the API and `settlement_tx_hash` in the webhook).
6. Open the settlement hash on https://explorer.arc.io/tx/<hash>. Show: USDC to the merchant wallet (0.88), the fee (0.10) and the network fee (0.02).
7. Merchant dashboard, Payments tab: the payment shows settled with the same hash.
8. Collect the fee (anyone can call it, it always pays the fixed fee recipient). Copy the **fee collection hash**:
   `cast send 0xdb03b5D5738E44E873bcC0fA7b75A27C3Bf10418 "collectFees()" --rpc-url https://rpc.mainnet.arc.io --private-key "$PRIVATE_KEY"`
   (run it yourself with a funded wallet, outside Arc Studio).
9. Note closing balances and confirm: merchant +0.88, fee recipient +0.10, keeper −gas +0.02.

## Hashes to capture
| What | Where it comes from | Value |
|---|---|---|
| Contract deployment tx | `docs/DEPLOYMENTS.md` | `0xd665e0454470282ac23314bec48b54bac3ec7dfe410f6d25dafb8d8150a28571` (block 28630653) |
| Payment id and public id | create reply / checkout URL | |
| Customer deposit tx | customer wallet or explorer | |
| **Settlement tx** (main proof) | checkout, API, webhook | |
| Fee collection tx | step 8 | |
| Merchant payout wallet | address, balance before and after | |

Explorer links: `https://explorer.arc.io/tx/<hash>` and `https://explorer.arc.io/address/<address>`.

## If something looks wrong
- Stuck at "payment seen" for over two minutes: check the worker log. Do not send again.
- Sent a different amount: less is refunded after the waiting period, more settles and the excess is returned. Note the hashes anyway.
- Page says expired but you paid just before the countdown ended: keep it open, the worker still confirms by block time.
