import type { Address } from '@acqui/shared';
import type { MerchantRow } from './context';
import type { Q } from './db';
import { conflict } from './lib/errors';
import { parseOrigin, parseWebhookUrl } from './lib/urls';

export async function createMerchant(q: Q, userId: string, displayName: string): Promise<MerchantRow> {
  const rows = await q<MerchantRow[]>`
    INSERT INTO merchants (owner_user_id, display_name) VALUES (${userId}, ${displayName})
    ON CONFLICT (owner_user_id) DO NOTHING RETURNING *`;
  const row = rows[0];
  if (!row) throw conflict('merchant_exists', 'This account already has a merchant');
  return row;
}

export async function getMerchantByUser(q: Q, userId: string): Promise<MerchantRow | null> {
  const rows = await q<MerchantRow[]>`SELECT * FROM merchants WHERE owner_user_id = ${userId}`;
  return rows[0] ?? null;
}

export async function getMerchantById(q: Q, id: string): Promise<MerchantRow | null> {
  const rows = await q<MerchantRow[]>`SELECT * FROM merchants WHERE id = ${id}`;
  return rows[0] ?? null;
}

export interface SettingsPatch {
  display_name?: string | undefined;
  allowed_return_origin?: string | null | undefined;
  webhook_url?: string | null | undefined;
}

/** Payout address is deliberately not editable here: it has its own reviewed / confirmed flows. */
export async function updateSettings(q: Q, merchant: MerchantRow, patch: SettingsPatch, production: boolean): Promise<MerchantRow> {
  const displayName = patch.display_name ?? merchant.display_name;
  const origin = patch.allowed_return_origin === undefined
    ? merchant.allowed_return_origin
    : patch.allowed_return_origin === null ? null : parseOrigin(patch.allowed_return_origin, 'allowed_return_origin', production);
  const webhook = patch.webhook_url === undefined
    ? merchant.webhook_url
    : patch.webhook_url === null ? null : parseWebhookUrl(patch.webhook_url, production);
  const rows = await q<MerchantRow[]>`
    UPDATE merchants SET display_name = ${displayName}, allowed_return_origin = ${origin}, webhook_url = ${webhook}, updated_at = now()
    WHERE id = ${merchant.id} RETURNING *`;
  const row = rows[0];
  if (!row) throw new Error('merchant update failed');
  return row;
}

/** First payout address only. Once set, changes require the emailed one-time confirmation. */
export async function setInitialPayout(q: Q, merchantId: string, address: Address): Promise<MerchantRow> {
  const rows = await q<MerchantRow[]>`
    UPDATE merchants SET payout_address = ${address.toLowerCase()}, payout_address_set_at = now(), updated_at = now()
    WHERE id = ${merchantId} AND payout_address IS NULL RETURNING *`;
  const row = rows[0];
  if (!row) throw conflict('payout_already_set', 'A payout address is already set. Use the emailed confirmation flow to change it');
  return row;
}

export function merchantSettingsView(m: MerchantRow, extra: { payoutChangesEnabled: boolean; hasWebhookSecret: boolean }) {
  return {
    merchant_id: m.id,
    display_name: m.display_name,
    payout_address: m.payout_address,
    payout_address_set_at: m.payout_address_set_at?.toISOString() ?? null,
    allowed_return_origin: m.allowed_return_origin,
    webhook_url: m.webhook_url,
    webhook_secret_configured: extra.hasWebhookSecret,
    payout_changes_enabled: extra.payoutChangesEnabled,
    created_at: m.created_at.toISOString(),
  };
}
