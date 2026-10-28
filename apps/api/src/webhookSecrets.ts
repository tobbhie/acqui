import type { Q } from './db';
import { decryptSecret, encryptSecret, randomToken } from './lib/crypto';

const PREFIX = 'whsec_';

export async function hasActiveWebhookSecret(q: Q, merchantId: string): Promise<boolean> {
  const rows = await q`SELECT 1 FROM webhook_secrets WHERE merchant_id = ${merchantId} AND revoked_at IS NULL`;
  return rows.length > 0;
}

/** Creates (or rotates) the signing secret. The plaintext is returned once; storage is AES-256-GCM ciphertext. */
export async function rotateWebhookSecret(q: Q, merchantId: string, encryptionKeyHex: string): Promise<{ secret: string; createdAt: Date }> {
  const secret = `${PREFIX}${randomToken(32)}`;
  const { ciphertext, nonce } = encryptSecret(encryptionKeyHex, secret);
  await q`UPDATE webhook_secrets SET revoked_at = now() WHERE merchant_id = ${merchantId} AND revoked_at IS NULL`;
  const rows = await q<{ created_at: Date }[]>`
    INSERT INTO webhook_secrets (merchant_id, ciphertext, nonce) VALUES (${merchantId}, ${ciphertext}, ${nonce}) RETURNING created_at`;
  const row = rows[0];
  if (!row) throw new Error('webhook secret insert failed');
  return { secret, createdAt: row.created_at };
}

/** Worker-only: decrypts the active secret to sign a delivery. Never exposed over HTTP. */
export async function loadActiveWebhookSecret(q: Q, merchantId: string, encryptionKeyHex: string): Promise<string | null> {
  const rows = await q<{ ciphertext: Buffer; nonce: Buffer }[]>`
    SELECT ciphertext, nonce FROM webhook_secrets WHERE merchant_id = ${merchantId} AND revoked_at IS NULL`;
  const row = rows[0];
  return row ? decryptSecret(encryptionKeyHex, row.ciphertext, row.nonce) : null;
}
