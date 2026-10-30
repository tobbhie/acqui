# Deployments

## Arc Testnet (chain ID 5042002), deployed 2026-10-28

| Item | Value |
|---|---|
| PaymentDistributor | `0xCEe00AB9e0F960F4bEb161ccF6f9B7CCc1FC7AEe` |
| PaymentFactory (created by the distributor) | `0xe56e733240Af69ba950eFaf9750bEA3f7384eBd0` |
| USDC (ERC-20 view) | `0x3600000000000000000000000000000000000000` |
| Fee recipient (immutable) | `0x78b96a800a3a6cd349cb2b0016148F20621cd00F` (a contract with code on testnet; not USDC-blocklisted) |
| Attester (immutable, signs settlement approvals) | `0x16895d78C9CFCeB985b3fF1df09C85a7E68f70aF` (testnet key held in the sandbox `.env` only) |
| Keeper (pays gas, not an on-chain role) | `0x64c413c6Fc564d3216dbE7d1E63CE6272D44334F` |
| Max keeper reimbursement (immutable) | 0.05 USDC (the API writes 0.02 USDC into each payment) |
| Recovery delay (immutable) | 86400 seconds |
| Deployment tx | `0x4b3877ed820d341108da381521698c6b4387c940a9b813e29205843bfb08d7c9` (block 69477093) |
| Explorer | https://explorer.testnet.arc.io/address/0xcee00ab9e0f960f4beb161ccf6f9b7ccc1fc7aee |

Deployed with Arc Studio's shared testnet deployer. The contracts have no owner, so that wallet has no power over them. The attester and keeper keys above are throwaway testnet keys: never reuse them on mainnet.

## What was run live on this deployment
1. `bun run integration:settle -- --native` (customer pays with a native USDC send): 15 of 16 checks passed. The one failure was a one-unit rounding in the script's gas arithmetic, since fixed.
2. `bun run integration:settle` (customer pays with an ERC-20 transfer): 16 of 16 checks passed.
3. Full stack run: API created a 1.00 USDC payment, a native 1 USDC deposit was sent to the receiver, the worker detected it, verified it, signed the attestation, settled on chain and marked it settled. Settlement tx `0xb2b5ecbc937cd29ba35412fa167d25c38e47952ac38089ae34b18a9daa85d926` (block 69477438), merchant received 0.88, fee 0.10 stayed in the distributor until `collectFees()`.

## Arc Mainnet (chain ID 5042), deployed 2026-10-30

| Item | Value |
|---|---|
| PaymentDistributor | `0xdb03b5D5738E44E873bcC0fA7b75A27C3Bf10418` |
| PaymentFactory (created by the distributor) | `0x17CEbb877c79b8c75787be551B30ee6FC82CADEd` |
| USDC (ERC-20 view) | `0x3600000000000000000000000000000000000000` |
| Fee recipient (immutable) | `0x78b96a800a3a6cd349cb2b0016148F20621cd00F` |
| Attester (immutable) | `0xf8f13e6E63d5FBAaa9Dd0A9607D9040c80Ff54bc` |
| Max keeper reimbursement (immutable) | 0.05 USDC (the API writes 0.02 USDC into each payment) |
| Recovery delay (immutable) | 86400 seconds |
| Deployment tx | `0xd665e0454470282ac23314bec48b54bac3ec7dfe410f6d25dafb8d8150a28571` (block 28630653) |
| Explorer | https://explorer.arc.io/address/0xdb03b5D5738E44E873bcC0fA7b75A27C3Bf10418 |

The transaction receipt succeeded and the deployed contract was read back on 2026-10-30. USDC, attester, fee recipient, factory and `DEPLOYED_CHAIN_ID` matched the deployment record.
