#!/usr/bin/env bash
# Deploys PaymentDistributor (which creates the factory) and records the result.
# YOU run this, with your own key. Arc Studio does not deploy to or sign for mainnet.
#
#   export PRIVATE_KEY=$(cat .mainnet-deployer/deployer-key.txt)
#   export ATTESTER=0x...      # new mainnet signing address (not the testnet one)
#   export FEE_SAFE=0x...      # fee recipient, immutable
#   bash scripts/deploy-mainnet.sh
#
# Optional: MAX_KEEPER_REIMBURSEMENT_UNITS (default 50000 = 0.05 USDC, must be <= 100000), RECOVERY_DELAY_SECONDS (default 86400),
# ARC_MAINNET_RPC_URL, USDC, ALLOW_EOA_FEE_SAFE=1 (accept a fee recipient without contract code), DRY_RUN=1 (checks only, sends nothing).
set -euo pipefail

RPC_URL="${ARC_MAINNET_RPC_URL:-https://rpc.mainnet.arc.io}"   # Circle docs: Connect to Arc, Mainnet
EXPECTED_CHAIN_ID="${EXPECTED_CHAIN_ID:-5042}"                # Circle docs: Arc Mainnet chain ID
USDC="${USDC:-0x3600000000000000000000000000000000000000}"    # Circle docs: Contract addresses, Mainnet USDC (6-decimal ERC-20 view)
MAX_KEEPER_REIMBURSEMENT_UNITS="${MAX_KEEPER_REIMBURSEMENT_UNITS:-50000}"
RECOVERY_DELAY_SECONDS="${RECOVERY_DELAY_SECONDS:-86400}"
OUT_DIR=".mainnet-deployer"

fail() { echo "STOP: $*" >&2; exit 1; }
need() { [ -n "${!1:-}" ] || fail "$1 is not set"; }
lower() { echo "$1" | tr 'A-F' 'a-f'; }

command -v forge >/dev/null && command -v cast >/dev/null || fail "forge and cast are required"
need PRIVATE_KEY; need ATTESTER; need FEE_SAFE
cast to-check-sum-address "$ATTESTER" >/dev/null 2>&1 || fail "ATTESTER is not a valid address"
cast to-check-sum-address "$FEE_SAFE" >/dev/null 2>&1 || fail "FEE_SAFE is not a valid address"
[ "$(lower "$ATTESTER")" != "$(lower "$FEE_SAFE")" ] || fail "ATTESTER and FEE_SAFE must differ"
[ "$MAX_KEEPER_REIMBURSEMENT_UNITS" -le 100000 ] || fail "MAX_KEEPER_REIMBURSEMENT_UNITS must be <= 100000 (0.10 USDC)"
[ "$RECOVERY_DELAY_SECONDS" -ge 3600 ] && [ "$RECOVERY_DELAY_SECONDS" -le 2592000 ] || fail "RECOVERY_DELAY_SECONDS must be between 3600 and 2592000"

DEPLOYER="$(cast wallet address --private-key "$PRIVATE_KEY")"
[ "$(lower "$DEPLOYER")" != "$(lower "$ATTESTER")" ] || fail "do not use the deployer key as the attester"

CHAIN_ID="$(cast chain-id --rpc-url "$RPC_URL")"
[ "$CHAIN_ID" = "$EXPECTED_CHAIN_ID" ] || fail "RPC reports chain ID $CHAIN_ID, expected $EXPECTED_CHAIN_ID"

[ "$(cast code "$USDC" --rpc-url "$RPC_URL")" != "0x" ] || fail "no contract at USDC $USDC"
[ "$(cast call "$USDC" 'decimals()(uint8)' --rpc-url "$RPC_URL")" = "6" ] || fail "USDC decimals() is not 6"
if [ "$(cast code "$FEE_SAFE" --rpc-url "$RPC_URL")" = "0x" ] && [ "${ALLOW_EOA_FEE_SAFE:-}" != "1" ]; then
  fail "FEE_SAFE has no contract code on this chain. Is the Safe deployed here? Set ALLOW_EOA_FEE_SAFE=1 only if a plain wallet is intended"
fi
BALANCE_WEI="$(cast balance "$DEPLOYER" --rpc-url "$RPC_URL")"
python3 - "$BALANCE_WEI" <<'PY' || fail "deployer balance is below 0.10 USDC; fund it with about 0.30 USDC"
import sys; sys.exit(0 if int(sys.argv[1]) >= 10**17 else 1)
PY

cat <<SUMMARY

  Network        chain ID $CHAIN_ID via $RPC_URL
  Deployer       $DEPLOYER   (balance $(cast from-wei "$BALANCE_WEI") USDC)
  USDC           $USDC
  Attester       $ATTESTER
  Fee recipient  $FEE_SAFE   (permanent: every protocol fee goes here, it cannot be changed)
  Max keeper reimbursement  $MAX_KEEPER_REIMBURSEMENT_UNITS units   Recovery delay  $RECOVERY_DELAY_SECONDS seconds
  This cannot be undone. Real USDC will be spent on gas.

SUMMARY
[ "${DRY_RUN:-}" != "1" ] || { echo "DRY_RUN=1: all checks passed, nothing was sent."; exit 0; }

# Typed confirmation. The skip is honoured only off mainnet, for rehearsals.
if [ "${ACQUI_SKIP_CONFIRM:-}" = "1" ] && [ "$CHAIN_ID" != "5042" ]; then :; else
  read -r -p 'Type DEPLOY to continue: ' answer
  [ "$answer" = "DEPLOY" ] || fail "cancelled, nothing was sent"
fi

forge build >/dev/null
RESULT="$(forge create contracts/PaymentDistributor.sol:PaymentDistributor \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --broadcast --json \
  --constructor-args "$USDC" "$ATTESTER" "$FEE_SAFE" "$MAX_KEEPER_REIMBURSEMENT_UNITS" "$RECOVERY_DELAY_SECONDS")"
DISTRIBUTOR="$(echo "$RESULT" | python3 -c 'import json,sys; print(json.load(sys.stdin)["deployedTo"])')"
TX="$(echo "$RESULT" | python3 -c 'import json,sys; print(json.load(sys.stdin)["transactionHash"])')"
BLOCK="$(cast receipt "$TX" blockNumber --rpc-url "$RPC_URL")"
FACTORY_EXPECTED="$(cast compute-address "$DISTRIBUTOR" --nonce 1 | awk '{print $NF}')"

echo; echo "Reading the contract back from the chain:"
ok=1
check() { # label expected actual
  if [ "$(lower "$2")" = "$(lower "$3")" ]; then echo "  ok    $1 = $3"; else echo "  FAIL  $1: expected $2, got $3"; ok=0; fi
}
check USDC "$USDC" "$(cast call "$DISTRIBUTOR" 'USDC()(address)' --rpc-url "$RPC_URL")"
check ATTESTER "$ATTESTER" "$(cast call "$DISTRIBUTOR" 'ATTESTER()(address)' --rpc-url "$RPC_URL")"
check FEE_SAFE "$FEE_SAFE" "$(cast call "$DISTRIBUTOR" 'FEE_SAFE()(address)' --rpc-url "$RPC_URL")"
check FACTORY "$FACTORY_EXPECTED" "$(cast call "$DISTRIBUTOR" 'FACTORY()(address)' --rpc-url "$RPC_URL")"
check DEPLOYED_CHAIN_ID "$CHAIN_ID" "$(cast call "$DISTRIBUTOR" 'DEPLOYED_CHAIN_ID()(uint256)' --rpc-url "$RPC_URL" | awk '{print $1}')"

mkdir -p "$OUT_DIR"
python3 - "$OUT_DIR/deployment.json" "$CHAIN_ID" "$DISTRIBUTOR" "$FACTORY_EXPECTED" "$BLOCK" "$TX" "$DEPLOYER" "$USDC" "$ATTESTER" "$FEE_SAFE" "$MAX_KEEPER_REIMBURSEMENT_UNITS" "$RECOVERY_DELAY_SECONDS" <<'PY'
import json, sys
k = ["chainId","distributor","factory","deploymentBlock","deploymentTx","deployer","usdc","attester","feeSafe","maxKeeperReimbursementUnits","recoveryDelaySeconds"]
json.dump(dict(zip(k, sys.argv[2:])), open(sys.argv[1], "w"), indent=2); open(sys.argv[1], "a").write("\n")
PY

if [ "$CHAIN_ID" = "5042" ]; then EXPLORER="https://explorer.arc.io"; else EXPLORER="https://explorer.testnet.arc.io"; fi
cat <<DONE

  Distributor         $DISTRIBUTOR
  Factory             $FACTORY_EXPECTED
  Deployment block    $BLOCK
  Deployment tx       $TX
  Explorer            $EXPLORER/address/$DISTRIBUTOR
  Saved to            $OUT_DIR/deployment.json

DONE
[ "$ok" = "1" ] || fail "one or more read-back checks FAILED. Do not use this deployment"
echo "All read-back checks passed. Send me the distributor address and deployment block."
