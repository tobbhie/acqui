# Mainnet deployment (done by you, outside Arc Studio)

Arc Studio does not deploy to, sign for or fund mainnet. Read the mainnet warning in the project README first. Before you start: independent audit, testnet soak, and re-check every address below on the official explorer.

## Decide and prepare
1. **Fee recipient**: the Safe that receives all protocol fees. Immutable.
2. **Attester**: the address whose signatures approve settlements. Immutable per distributor, so rotating it means deploying a new distributor. It can be an EOA or an ERC-1271 contract wallet (a Safe's own signatures are not supported by the worker). Keep its key only in the worker's secret manager, separate from the keeper key.
3. **Keeper wallet**: a separate hot wallet with a small USDC balance for gas.
4. **Max keeper reimbursement** (<= 0.10 USDC) and **recovery delay** (1 hour to 30 days). Testnet used 0.05 USDC and 86400 seconds. Measured gas for a settlement was about 0.011 to 0.013 USDC on testnet.

## Deploy
Take the RPC URL and the USDC address from Circle's official Arc documentation, not from memory, and keep the key in an environment variable:

    forge build
    forge create contracts/PaymentDistributor.sol:PaymentDistributor \
      --rpc-url "$ARC_MAINNET_RPC_URL" --private-key "$PRIVATE_KEY" --broadcast \
      --constructor-args "$USDC" "$ATTESTER" "$FEE_SAFE" "$MAX_KEEPER_REIMBURSEMENT_UNITS" "$RECOVERY_DELAY_SECONDS"

Constructor arguments in order: USDC, attester, fee Safe, max keeper reimbursement (6-decimal units, for example 50000), recovery delay (seconds).

## After deploying
- Record the distributor address and its deployment block. The factory address is derived from the distributor (created by it, nonce 1) and is checked by the API and worker at startup.
- Set \`DISTRIBUTOR_ADDRESS\` and \`DISTRIBUTOR_DEPLOY_BLOCK\` for the API and worker. They refuse to start if the chain ID, USDC address, attester or factory do not match.
- Confirm on the explorer: chain ID, \`FEE_SAFE\`, \`ATTESTER\`, \`USDC\`, \`DEPLOYED_CHAIN_ID\`.
- Run a small live payment end to end and keep the public transaction hashes for the submission.
