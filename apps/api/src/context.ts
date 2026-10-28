import type { ApiConfig, Address } from '@acqui/shared';
import type { Db } from './db';
import type { GoogleAuth } from './auth/google';
import type { SessionUser } from './auth/session';

/** Verified facts about the deployed contracts (read from the chain at startup). */
export interface ContractsInfo {
  chainId: number;
  distributor: Address;
  factory: Address;
  usdc: Address;
  attester: Address;
  feeSafe: Address;
  maxKeeperReimbursement: bigint;
  recoveryDelaySeconds: bigint;
}

export interface ChainReader {
  /** USDC issuer blocklist check. Throws if the chain cannot be reached (callers fail closed). */
  isBlacklisted(address: Address): Promise<boolean>;
}

export interface Mailer {
  send(message: { to: string; subject: string; text: string }): Promise<void>;
}

export interface AppDeps {
  db: Db;
  config: ApiConfig;
  googleAuth: GoogleAuth;
  /** Null when no verified email channel is configured: payout changes are then disabled. */
  mailer: Mailer | null;
  chain: ChainReader;
  /** Null until the distributor address is configured and verified: intents are then refused. */
  contracts: ContractsInfo | null;
  now: () => Date;
  /** How the demo store server calls this API as a merchant would. Defaults to global fetch over HTTP. */
  selfFetch?: (url: string, init: RequestInit) => Promise<Response>;
}

export interface MerchantRow {
  id: string;
  owner_user_id: string;
  display_name: string;
  payout_address: string | null;
  payout_address_set_at: Date | null;
  allowed_return_origin: string | null;
  webhook_url: string | null;
  created_at: Date;
  updated_at: Date;
}

export type AuthKind = 'session' | 'api_key';

export interface HonoEnv {
  Variables: {
    session: SessionUser;
    merchant: MerchantRow;
    authKind: AuthKind;
    apiKeyId: string;
  };
}
