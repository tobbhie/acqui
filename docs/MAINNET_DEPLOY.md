# Mainnet deployment (done by you, outside Arc Studio)

Arc Studio does not deploy to, sign for or fund mainnet. Read the mainnet warning in the project README first. Before you start: independent audit, testnet soak, and re-check every address below on the official explorer.

## Decide and prepare
1. **Fee recipient**: the Safe that receives all protocol fees. Immutable.
2. **Attester**: the address whose signatures approve settlements. Immutable per distributor, so rotating it means deploying a new distributor. It can be an EOA or an ERC-1271 contract wallet (a Safe's own signatures are not supported by the worker). Keep its key only in the worker's secret manager, separate from the keeper key.
3. **Keeper wallet**: a separate hot wallet with a small USDC balance for gas.
4. **Max keeper reimbursement** (<= 0.10 USDC) and **recovery delay** (1 hour to 30 days). Testnet used 0.05 USDC and 86400 seconds. Measured gas for a settlement was about 0.011 to 0.013 USDC on testnet.

## Deployer wallet
A throwaway wallet has no power over the contracts after deployment (they have no owner), so it only needs a little USDC for gas. Keep its key in your own storage, never in the repository or in chat. Load it into the shell only for the deployment, for example `export PRIVATE_KEY=0x...` typed at the prompt, then unset it. Send any leftover USDC back to your own wallet afterwards.

## Deploy
Run the helper script yourself in the Code panel terminal. It checks the chain ID (5042), that USDC at `0x3600…0000` answers with 6 decimals, that the fee recipient has contract code, that the deployer holds enough USDC, and that the attester differs from the fee recipient and the deployer. It shows the full plan and only continues after you type `DEPLOY`. Afterwards it reads the contract back and compares USDC, attester, fee recipient, factory and chain ID, then writes `.mainnet-deployer/deployment.json`.

    export PRIVATE_KEY=0x...   # your deployer key, from your own storage
    export ATTESTER=0x...      # new mainnet signing address
    export FEE_SAFE=0x...      # fee recipient, permanent
    DRY_RUN=1 bash scripts/deploy-mainnet.sh    # checks only, sends nothing
    bash scripts/deploy-mainnet.sh              # the real deployment

The RPC URL (`https://rpc.mainnet.arc.io`), chain ID (5042) and USDC address come from Circle's "Connect to Arc" and "Contract addresses" pages. Override the RPC with `ARC_MAINNET_RPC_URL` if you use a provider. Defaults: max keeper reimbursement 50000 units (0.05 USDC), recovery delay 86400 seconds.

The script was rehearsed on Arc Testnet (all read-back checks passed) but never run against mainnet by Arc Studio.

## After deploying
- Record the distributor address and its deployment block. The factory address is derived from the distributor (created by it, nonce 1) and is checked by the API and worker at startup.
- Set \`DISTRIBUTOR_ADDRESS\` and \`DISTRIBUTOR_DEPLOY_BLOCK\` for the API and worker. They refuse to start if the chain ID, USDC address, attester or factory do not match.
- Confirm on the explorer: chain ID, \`FEE_SAFE\`, \`ATTESTER\`, \`USDC\`, \`DEPLOYED_CHAIN_ID\`.
- Run a small live payment end to end and keep the public transaction hashes for the submission.
