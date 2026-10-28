# Verified constants (Step 02)

"Live" means read from the network RPC by a script or tool in this build. "Docs" means taken from official Arc documentation and not yet read from the network. Mainnet is locked in this build, so no mainnet RPC was called; every mainnet value below is docs-only until you run the checks yourself.

| Constant | Value | Testnet (5042002) | Mainnet (5042) |
| --- | --- | --- | --- |
| Chain ID | 5042002 / 5042 | Live: `eth_chainId` returned 5042002 | Docs only |
| USDC ERC-20 address | `0x3600000000000000000000000000000000000000` | Live: has code | Docs only |
| USDC ERC-20 decimals | 6 | Live: `decimals()` returned 6, `symbol()` USDC | Docs only |
| USDC native (gas) decimals | 18, so 1 USDC unit = 1e12 native wei | Docs | Docs |
| USDC token type | Upgradeable FiatToken proxy with blocklist (`isBlacklisted(address)` exists) | Live: proxy found, `isBlacklisted` call succeeds | Docs only |
| System emitter for native Transfer logs | `0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE`, 18 decimals | Live: logs seen from this emitter | Docs only |
| Transfer topic0 | `0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef` | Live | Docs only |
| One ERC-20 transfer emits two logs | ERC-20 (6 dec) and system (18 dec) | Live: 518 of 518 sampled ERC-20 transfer txs also had a system log | Docs only |
| Block timestamps | Non-decreasing, not strictly increasing | Docs | Docs |
| Minimum `maxFeePerGas` | 20 gwei | Docs, not measured | Docs only |
| Finality | Deterministic on inclusion | Docs, not measured | Docs only |
| Sending native value to a contract | Not guaranteed to succeed | Docs | Docs |

Acqui contract constants, enforced onchain and mirrored in `packages/shared/src/policy.ts`:

| Constant | Value |
| --- | --- |
| `MIN_PAYMENT` | 1_000_000 (1 USDC) |
| `MIN_FEE` | 100_000 (0.10 USDC) |
| `FEE_BPS` / `BPS_DENOMINATOR` | 10 / 10_000, fee rounded up |
| `MAX_KEEPER_REIMBURSEMENT` | constructor argument, at most `MIN_FEE`. Value not chosen yet. |
| `RECOVERY_DELAY` | constructor argument, 1 hour to 30 days. Value not chosen yet. |
| Terms typehash | `0x94ee8be03a5d3864eef4600da9ad7ca1923d49dccd72d63dc6fd235eb48020a1` |
| EIP-712 domain | name `AcquiPaymentDistributor`, version `1` |

Worked example (tested): 10 USDC gross, fee 0.10, reimbursement 0.02, merchant receives 9.88.

Gas note (estimate, not a live measurement): a settlement test that includes receiver deployment and test setup reports about 580k gas. At the documented 20 gwei floor that would be roughly 0.012 USDC at most, below a 0.02 USDC reimbursement. Measure on Arc Testnet before fixing the reimbursement.

## To verify yourself on mainnet before any deployment

1. `eth_chainId` on your mainnet RPC returns 5042.
2. `decimals()` on `0x3600…0000` returns 6 and `eth_getCode` is non-empty.
3. A small transfer to a fresh address shows one system-emitter log and one ERC-20 log, and `balanceOf` and `eth_getBalance / 1e12` agree.
4. The distributor constructor arguments (USDC, attester, Safe) are exactly what you intend, and the Safe address is checked on the explorer.
