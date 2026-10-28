import type { Q } from '../db';
import { badRequest } from '../lib/errors';
import type { PaymentStatus } from './state';
import type { PaymentRow, PublicRow } from './views';

/** Every merchant query carries merchant_id: a payment of another merchant is indistinguishable from a missing one. */
export async function getPaymentForMerchant(q: Q, merchantId: string, id: string): Promise<PaymentRow | null> {
  const rows = await q<PaymentRow[]>`SELECT * FROM payment_intents WHERE id = ${id} AND merchant_id = ${merchantId}`;
  return rows[0] ?? null;
}

export function encodeCursor(row: Pick<PaymentRow, 'created_at' | 'id'>): string {
  return Buffer.from(`${row.created_at.toISOString()}|${row.id}`).toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const createdAt = new Date(iso ?? '');
  if (!iso || !id || Number.isNaN(createdAt.getTime()) || !/^[0-9a-f-]{36}$/.test(id)) throw badRequest('invalid_cursor', 'Invalid cursor');
  return { createdAt, id };
}

/** Keyset pagination, newest first. Fetches one extra row to know whether another page exists. */
export async function listPayments(
  q: Q,
  merchantId: string,
  opts: { limit: number; cursor?: string | undefined; status?: PaymentStatus | undefined },
): Promise<{ rows: PaymentRow[]; nextCursor: string | null }> {
  const after = opts.cursor ? decodeCursor(opts.cursor) : null;
  const rows = await q<PaymentRow[]>`
    SELECT * FROM payment_intents
    WHERE merchant_id = ${merchantId}
      ${opts.status ? q`AND status = ${opts.status}` : q``}
      ${after ? q`AND (created_at, id) < (${after.createdAt}, ${after.id})` : q``}
    ORDER BY created_at DESC, id DESC
    LIMIT ${opts.limit + 1}`;
  const page = rows.slice(0, opts.limit);
  const last = page[page.length - 1];
  return { rows: page, nextCursor: rows.length > opts.limit && last ? encodeCursor(last) : null };
}

export async function getPublicByPublicId(q: Q, publicId: string): Promise<PublicRow | null> {
  const rows = await q<PublicRow[]>`
    SELECT p.*, m.display_name AS merchant_name,
           COALESCE((SELECT SUM(d.amount_units) FROM deposits d WHERE d.payment_intent_id = p.id), 0)::text AS received_units
    FROM payment_intents p JOIN merchants m ON m.id = p.merchant_id
    WHERE p.public_id = ${publicId}`;
  return rows[0] ?? null;
}
