import type { Address } from '@acqui/shared';
import type { AppDeps, MerchantRow } from './context';
import type { Q } from './db';
import { conflict, unavailable, unprocessable } from './lib/errors';
import { randomToken, sha256 } from './lib/crypto';

export const PAYOUT_TOKEN_TTL_MS = 15 * 60 * 1000;

const INVALID_TOKEN = () => unprocessable('invalid_or_expired_token', 'This confirmation link is invalid, expired or already used');

/** Fail closed: an unreachable chain means we cannot prove the address is not blocklisted. */
export async function assertNotBlocklisted(deps: AppDeps, address: Address): Promise<void> {
  let blocked: boolean;
  try {
    blocked = await deps.chain.isBlacklisted(address);
  } catch {
    throw unavailable('chain_unavailable', 'Could not verify the address against the chain, try again');
  }
  if (blocked) throw unprocessable('address_blocklisted', 'This address is blocklisted by the USDC issuer');
}

/**
 * Step 1: sends a one-time token to the account's verified Google email. The current payout address stays
 * in force until the token is confirmed. Disabled entirely when no email channel is configured.
 */
export async function requestPayoutChange(
  deps: AppDeps,
  merchant: MerchantRow,
  user: { userId: string; email: string },
  newAddress: Address,
): Promise<{ expiresAt: Date }> {
  const { mailer, db } = deps;
  if (!mailer) {
    throw unavailable('payout_change_unavailable', 'Payout address changes are disabled until a verified email channel is configured');
  }
  if (!merchant.payout_address) throw conflict('payout_not_set', 'Set the initial payout address first');
  if (merchant.payout_address === newAddress.toLowerCase()) throw unprocessable('payout_unchanged', 'This is already your payout address');
  await assertNotBlocklisted(deps, newAddress);

  const now = deps.now();
  const token = randomToken(32);
  const expiresAt = new Date(now.getTime() + PAYOUT_TOKEN_TTL_MS);
  await db.begin(async (tx) => {
    // A newer request supersedes older pending ones, so only one token is ever live.
    await tx`UPDATE payout_address_changes SET status = 'cancelled' WHERE merchant_id = ${merchant.id} AND status = 'pending'`;
    await tx`
      INSERT INTO payout_address_changes (merchant_id, requested_by_user_id, old_address, new_address, token_hash, expires_at)
      VALUES (${merchant.id}, ${user.userId}, ${merchant.payout_address}, ${newAddress.toLowerCase()}, ${sha256(token)}, ${expiresAt})`;
  });

  const base = (deps.config.DASHBOARD_BASE_URL ?? deps.config.CHECKOUT_BASE_URL).replace(/\/+$/, '');
  // Token travels in the URL fragment so it is not sent to servers or logged by proxies.
  try {
    await mailer.send({
      to: user.email,
      subject: 'Confirm your Acqui payout address change',
      text:
        `A request was made to change the payout address for ${merchant.display_name} to ${newAddress}.\n\n` +
        `Confirm within 15 minutes (signed in as this account): ${base}/dashboard/payout/confirm#token=${token}\n\n` +
        `Your current payout address (${merchant.payout_address}) stays active until you confirm. If you did not ask for this, ignore this email.`,
    });
  } catch {
    // A token nobody received must not stay live.
    await db`UPDATE payout_address_changes SET status = 'cancelled' WHERE token_hash = ${sha256(token)} AND status = 'pending'`;
    throw unavailable('email_send_failed', 'The confirmation email could not be sent, try again later');
  }
  return { expiresAt };
}

/** Step 2: single-use, session-bound confirmation. Applies the change and notifies the account afterwards. */
export async function confirmPayoutChange(
  deps: AppDeps,
  merchant: MerchantRow,
  user: { userId: string; email: string },
  token: string,
): Promise<MerchantRow> {
  const now = deps.now();
  const updated = await deps.db.begin(async (tx: Q) => {
    const rows = await tx<{ id: string; old_address: string | null; new_address: string; expires_at: Date; requested_by_user_id: string }[]>`
      SELECT id, old_address, new_address, expires_at, requested_by_user_id FROM payout_address_changes
      WHERE token_hash = ${sha256(token)} AND merchant_id = ${merchant.id} AND status = 'pending' FOR UPDATE`;
    const change = rows[0];
    if (!change || change.expires_at.getTime() <= now.getTime() || change.requested_by_user_id !== user.userId) throw INVALID_TOKEN();
    if (change.old_address !== merchant.payout_address) throw INVALID_TOKEN();
    await tx`UPDATE payout_address_changes SET status = 'confirmed', used_at = ${now} WHERE id = ${change.id}`;
    const m = await tx<MerchantRow[]>`
      UPDATE merchants SET payout_address = ${change.new_address}, payout_address_set_at = ${now}, updated_at = now()
      WHERE id = ${merchant.id} RETURNING *`;
    const row = m[0];
    if (!row) throw new Error('merchant missing');
    return { merchant: row, oldAddress: change.old_address, newAddress: change.new_address };
  });

  if (deps.mailer) {
    try {
      await deps.mailer.send({
        to: user.email,
        subject: 'Your Acqui payout address was changed',
        text: `The payout address for ${merchant.display_name} changed from ${updated.oldAddress ?? 'none'} to ${updated.newAddress}. Payments created earlier keep the address they were created with. If this was not you, revoke your API keys and sign out everywhere now.`,
      });
    } catch {
      console.error('payout change notification email failed');
    }
  }
  return updated.merchant;
}
