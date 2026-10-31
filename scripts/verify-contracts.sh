#!/usr/bin/env bash
# Publishes the source of PaymentDistributor and the PaymentFactory it created on the Arc explorer (Blockscout),
# so anyone can read the code behind the addresses. Needs no private key: verification is not a transaction.
#
#   NETWORK=mainnet DISTRIBUTOR=0x... ATTESTER=0x... FEE_SAFE=0x... bash scripts/verify-contracts.sh
#
# Optional: NETWORK=testnet, USDC, MAX_KEEPER_REIMBURSEMENT_UNITS (default 50000), RECOVERY_DELAY_SECONDS (default 86400),
# EXPLORER_API (override the verifier URL), MANUAL=1 (only write the files to upload in the explorer's web form).
set -euo pipefail

fail() { echo "STOP: $*" >&2; exit 1; }
need() { [ -n "${!1:-}" ] || fail "$1 is not set"; }

NETWORK="${NETWORK:-mainnet}"
case "$NETWORK" in
  mainnet) CHAIN_ID=5042; EXPLORER="https://explorer.arc.io" ;;
  testnet) CHAIN_ID=5042002; EXPLORER="https://explorer.testnet.arc.io" ;;
  *) fail "NETWORK must be mainnet or testnet" ;;
esac
EXPLORER_API="${EXPLORER_API:-$EXPLORER/api/}"
USDC="${USDC:-0x3600000000000000000000000000000000000000}"
MAX_KEEPER_REIMBURSEMENT_UNITS="${MAX_KEEPER_REIMBURSEMENT_UNITS:-50000}"
RECOVERY_DELAY_SECONDS="${RECOVERY_DELAY_SECONDS:-86400}"
OUT=".verify"

command -v forge >/dev/null && command -v cast >/dev/null || fail "forge and cast are required"
need DISTRIBUTOR; need ATTESTER; need FEE_SAFE

FACTORY="$(cast compute-address "$DISTRIBUTOR" --nonce 1 | awk '{print $NF}')"
ARGS_DISTRIBUTOR="$(cast abi-encode 'constructor(address,address,address,uint256,uint64)' "$USDC" "$ATTESTER" "$FEE_SAFE" "$MAX_KEEPER_REIMBURSEMENT_UNITS" "$RECOVERY_DELAY_SECONDS")"
ARGS_FACTORY="$(cast abi-encode 'constructor(address)' "$DISTRIBUTOR")"

echo "Network      $NETWORK (chain ID $CHAIN_ID), explorer $EXPLORER"
echo "Distributor  $DISTRIBUTOR"
echo "Factory      $FACTORY (created by the distributor)"
forge build >/dev/null

mkdir -p "$OUT"
for name in PaymentDistributor PaymentFactory; do
  address="$DISTRIBUTOR"; args="$ARGS_DISTRIBUTOR"
  [ "$name" = "PaymentFactory" ] && { address="$FACTORY"; args="$ARGS_FACTORY"; }
  forge verify-contract "$address" "contracts/$name.sol:$name" --show-standard-json-input > "$OUT/$name.standard-input.json"
  echo "$args" > "$OUT/$name.constructor-args.txt"
done

if [ "${MANUAL:-}" = "1" ]; then
  cat <<MANUAL

Files written to $OUT/ . In the explorer open the contract address, choose Verify & Publish, then:
  method            Solidity (Standard JSON input)
  compiler          v0.8.28+commit.7893614a
  contract name     PaymentDistributor (address $DISTRIBUTOR) or PaymentFactory (address $FACTORY)
  standard input    $OUT/<contract>.standard-input.json
  constructor args  paste the hex from $OUT/<contract>.constructor-args.txt
MANUAL
  exit 0
fi

for name in PaymentDistributor PaymentFactory; do
  address="$DISTRIBUTOR"; args="$ARGS_DISTRIBUTOR"
  [ "$name" = "PaymentFactory" ] && { address="$FACTORY"; args="$ARGS_FACTORY"; }
  echo; echo "Verifying $name at $address ..."
  forge verify-contract "$address" "contracts/$name.sol:$name" \
    --chain-id "$CHAIN_ID" --verifier blockscout --verifier-url "$EXPLORER_API" \
    --constructor-args "$args" --watch
done
echo; echo "Done. Open $EXPLORER/address/$DISTRIBUTOR#code and $EXPLORER/address/$FACTORY#code"
