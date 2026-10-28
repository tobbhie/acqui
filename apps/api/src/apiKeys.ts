import { randomBytes } from 'node:crypto';
import type { Q } from './db';
import { conflict, notFound } from './lib/errors';
import { keyedDigest, randomToken, safeEqual } from './lib/crypto';

export const KEY_PREFIX = 'aq_live_';
export const MAX_ACTIVE_KEYS = 10;
const KEY_PATTERN = /^aq_live_([0-9a-f]{16})_([A-Za-z0-9_-]{43})$/;

interface KeyRow {
  id: string;
  merchant_id: string;
  key_id: string;
  secret_digest: Buffer;
  label: string;
  created_at: Date;
  expires_at: Date | null;
  revoked_at: Date | null;
  last_used_at: Date | null;
}

export function apiKeyView(k: KeyRow) {
  return {
    id: k.id,
    prefix: `${KEY_PREFIX}${k.key_id}`,
    label: k.label,
    created_at: k.created_at.toISOString(),
    expires_at: k.expires_at?.toISOString() ?? null,
    revoked_at: k.revoked_at?.toISOString() ?? null,
    last_used_at: k.last_used_at?.toISOString() ?? null,
  };
}

/** The full secret is returned once, here, and never stored. Only a keyed digest is persisted. */
export async function createApiKey(q: Q, merchantId: string, label: string, pepper: string, now: Date) {
  const active = await q<{ n: string }[]>`
    SELECT count(*) AS n FROM api_keys WHERE merchant_id = ${merchantId} AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ${now})`;
  if (Number(active[0]?.n ?? 0) >= MAX_ACTIVE_KEYS) throw conflict('too_many_keys', `At most ${MAX_ACTIVE_KEYS} active API keys`);
  const keyId = randomBytes(8).toString('hex');
  const secret = randomToken(32);
  const rows = await q<KeyRow[]>`
    INSERT INTO api_keys (merchant_id, key_id, secret_digest, label)
    VALUES (${merchantId}, ${keyId}, ${keyedDigest(pepper, secret)}, ${label}) RETURNING *`;
  const row = rows[0];
  if (!row) throw new Error('api key insert failed');
  return { key: apiKeyView(row), secret: `${KEY_PREFIX}${keyId}_${secret}` };
}

export async function listApiKeys(q: Q, merchantId: string) {
  const rows = await q<KeyRow[]>`SELECT * FROM api_keys WHERE merchant_id = ${merchantId} ORDER BY created_at DESC`;
  return rows.map(apiKeyView);
}

export async function revokeApiKey(q: Q, merchantId: string, id: string): Promise<void> {
  const rows = await q<{ id: string }[]>`
    UPDATE api_keys SET revoked_at = COALESCE(revoked_at, now()) WHERE id = ${id} AND merchant_id = ${merchantId} RETURNING id`;
  if (rows.length === 0) throw notFound('API key not found');
}

/** New key first, then the old key is revoked (immediately, or after a grace window to roll deployments). */
export async function rotateApiKey(q: Q, merchantId: string, id: string, graceSeconds: number, pepper: string, now: Date) {
  const old = await q<KeyRow[]>`SELECT * FROM api_keys WHERE id = ${id} AND merchant_id = ${merchantId} AND revoked_at IS NULL FOR UPDATE`;
  const oldRow = old[0];
  if (!oldRow) throw notFound('Active API key not found');
  const created = await createApiKey(q, merchantId, oldRow.label, pepper, now);
  if (graceSeconds === 0) {
    await q`UPDATE api_keys SET revoked_at = ${now} WHERE id = ${id}`;
  } else {
    await q`UPDATE api_keys SET expires_at = ${new Date(now.getTime() + graceSeconds * 1000)} WHERE id = ${id}`;
  }
  return created;
}

/** Returns the owning merchant for a valid, unrevoked, unexpired key. Constant-time digest comparison. */
export async function authenticateApiKey(q: Q, bearer: string, pepper: string, now: Date): Promise<{ merchantId: string; keyRowId: string } | null> {
  const m = KEY_PATTERN.exec(bearer);
  const keyId = m?.[1];
  const secret = m?.[2];
  if (!keyId || !secret) return null;
  const rows = await q<KeyRow[]>`SELECT * FROM api_keys WHERE key_id = ${keyId}`;
  const row = rows[0];
  // Compare against a digest even when the key id is unknown so timing does not reveal which ids exist.
  const expected = row?.secret_digest ?? Buffer.alloc(32);
  const matches = safeEqual(keyedDigest(pepper, secret), expected);
  if (!row || !matches) return null;
  if (row.revoked_at || (row.expires_at && row.expires_at.getTime() <= now.getTime())) return null;
  await q`UPDATE api_keys SET last_used_at = ${now} WHERE id = ${row.id} AND (last_used_at IS NULL OR last_used_at < ${new Date(now.getTime() - 60_000)})`;
  return { merchantId: row.merchant_id, keyRowId: row.id };
}
