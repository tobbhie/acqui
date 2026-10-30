#!/usr/bin/env bash
# One-time VPS cutover. Run as root after /home/deploy/mainnet-worker-keys.env is staged.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo 'Run with sudo.' >&2; exit 1; }

APP_DIR=/home/deploy/acqui
API_ENV=/etc/acqui/api.env
WORKER_ENV=/etc/acqui/worker.env
KEY_FILE=/home/deploy/mainnet-worker-keys.env
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

for file in "$API_ENV" "$WORKER_ENV" "$KEY_FILE"; do
  [ -f "$file" ] || { echo "Missing $file" >&2; exit 1; }
done

set -a
# shellcheck disable=SC1090
. "$KEY_FILE"
set +a
[[ "${ATTESTER_PRIVATE_KEY:-}" =~ ^0x[0-9a-fA-F]{64}$ ]] || { echo 'Invalid staged attester key' >&2; exit 1; }
[[ "${KEEPER_PRIVATE_KEY:-}" =~ ^0x[0-9a-fA-F]{64}$ ]] || { echo 'Invalid staged keeper key' >&2; exit 1; }
[ "$ATTESTER_PRIVATE_KEY" != "$KEEPER_PRIVATE_KEY" ] || { echo 'Attester and keeper keys must differ' >&2; exit 1; }

cp -a "$API_ENV" "$API_ENV.$STAMP.bak"
cp -a "$WORKER_ENV" "$WORKER_ENV.$STAMP.bak"

rollback() {
  echo 'Cutover failed; restoring the previous environment.' >&2
  cp -a "$API_ENV.$STAMP.bak" "$API_ENV"
  cp -a "$WORKER_ENV.$STAMP.bak" "$WORKER_ENV"
  rm -f "$KEY_FILE"
  systemctl restart acqui-api acqui-worker || true
}
trap rollback ERR

set_env() {
  local file="$1" key="$2" value="$3"
  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

for file in "$API_ENV" "$WORKER_ENV"; do
  set_env "$file" ACQUI_NETWORK arc-mainnet
  set_env "$file" ARC_RPC_URL https://rpc.mainnet.arc.io
  set_env "$file" DISTRIBUTOR_ADDRESS 0xdb03b5D5738E44E873bcC0fA7b75A27C3Bf10418
  set_env "$file" FEE_RECIPIENT_SAFE 0x78b96a800a3a6cd349cb2b0016148F20621cd00F
  set_env "$file" KEEPER_REIMBURSEMENT_CAP_USDC 0.05
done

set_env "$API_ENV" CHECKOUT_BASE_URL https://acqui.pages.dev
set_env "$API_ENV" DASHBOARD_BASE_URL https://acqui.pages.dev
set_env "$API_ENV" GOOGLE_REDIRECT_URI https://api.51-68-172-236.nip.io/auth/google/callback
set_env "$API_ENV" KEEPER_REIMBURSEMENT_USDC 0.02

set_env "$WORKER_ENV" DISTRIBUTOR_DEPLOY_BLOCK 28630653
set_env "$WORKER_ENV" SCANNER_START_BLOCK 28630653
set_env "$WORKER_ENV" ATTESTER_PRIVATE_KEY "$ATTESTER_PRIVATE_KEY"
set_env "$WORKER_ENV" KEEPER_PRIVATE_KEY "$KEEPER_PRIVATE_KEY"

chown root:root "$API_ENV" "$WORKER_ENV"
chmod 600 "$API_ENV" "$WORKER_ENV"
rm -f "$KEY_FILE"
unset ATTESTER_PRIVATE_KEY KEEPER_PRIVATE_KEY

systemctl stop acqui-worker acqui-api

# Run the migration as the unprivileged service user while systemd parses the same EnvironmentFile
# as the API. This avoids sourcing or printing secrets in the operator shell.
systemd-run --quiet --collect --wait --pipe \
  --unit="acqui-mainnet-migrate-${STAMP,,}" \
  --property=User=deploy \
  --property="WorkingDirectory=$APP_DIR" \
  --property="EnvironmentFile=$API_ENV" \
  /home/deploy/.bun/bin/bun run apps/api/src/migrate.ts

systemctl start acqui-api
systemctl start acqui-worker
systemctl --no-pager --full status acqui-api acqui-worker
trap - ERR

echo "Mainnet cutover complete. Backups: $API_ENV.$STAMP.bak and $WORKER_ENV.$STAMP.bak"
