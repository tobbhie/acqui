import { z } from 'zod';
import { parseUsdc } from '../../../src/onchain-money';
import { addressSchema } from './schemas';

/** Treat blank env values (common in copied .env files) as unset. */
function clean(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    out[key] = value === undefined || value.trim() === '' ? undefined : value.trim();
  }
  return out;
}

const secret32 = z.string().min(32, 'must be at least 32 characters');

const baseShape = {
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Only arc-testnet is accepted until mainnet is explicitly unlocked. */
  ACQUI_NETWORK: z.enum(['arc-testnet']).default('arc-testnet'),
  DATABASE_URL: z.string().url().startsWith('postgres', 'must be a postgres:// URL'),
  /** Managed Arc RPC. Required in production; otherwise the public fallback is used. */
  ARC_RPC_URL: z.string().url().optional(),
  CHECKOUT_BASE_URL: z.string().url().default('http://localhost:5173'),
  /** Immutable fee recipient (Safe). Set after Step 02 deployment. */
  FEE_RECIPIENT_SAFE: addressSchema.optional(),
  /** Decimal USDC cap for keeper reimbursement. No default: decided in Step 02. */
  KEEPER_REIMBURSEMENT_CAP_USDC: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/)
    .transform((value) => parseUsdc(value))
    .optional(),
};

const apiShape = {
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  SESSION_SECRET: secret32,
  /** Pepper mixed into API key hashes. */
  API_KEY_PEPPER: secret32,
  /** 32-byte hex key that encrypts per-merchant webhook secrets at rest. */
  WEBHOOK_SECRET_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex characters'),
  /** Optional transactional email. Absent means payout address changes stay frozen. */
  EMAIL_PROVIDER: z.enum(['oqumail', 'smtp']).optional(),
  /** Oqumail per-mailbox API key (POST https://api.oqumail.com/api/v1/emails, Bearer auth). The only Oqumail setting: the sender is configured in Oqumail. */
  OQUMAIL_API_KEY: z.string().min(8).optional(),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(3).optional(),
  GOOGLE_REDIRECT_URI: z.string().url(),
  /** Where the dashboard lives (redirects after login, CSRF origin check, links in emails). */
  DASHBOARD_BASE_URL: z.string().url().optional(),
  /** Deployed PaymentDistributor. Without it payment intents are refused (no mocked receivers). */
  DISTRIBUTOR_ADDRESS: addressSchema.optional(),
  /** Fixed keeper reimbursement written into every new intent. Must not exceed the contract's immutable cap. */
  KEEPER_REIMBURSEMENT_USDC: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/)
    .transform((value) => parseUsdc(value))
    .optional(),
  /** Demo store only: the demo merchant's API key. It stays on the server and is never sent to a browser. */
  DEMO_MERCHANT_API_KEY: z.string().regex(/^aq_live_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$/, 'must be an Acqui API key').optional(),
  /** Demo store only: signing secret of the demo merchant's webhook (whsec_...). */
  DEMO_WEBHOOK_SECRET: z.string().min(20).optional(),
  /** Where the demo server reaches this API. Defaults to http://127.0.0.1:PORT. */
  DEMO_API_BASE_URL: z.string().url().optional(),
  /** Set to "true" only behind a trusted proxy so X-Forwarded-For can be used for rate limiting. */
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
};

const hexKey = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'must be a 0x-prefixed 32-byte hex key').transform((v) => v as `0x${string}`);
const decimalUsdc = z.string().regex(/^\d+(\.\d{1,6})?$/).transform((value) => parseUsdc(value));
const int = (min: number, max: number, fallback: number) => z.coerce.number().int().min(min).max(max).default(fallback);

const workerShape = {
  /** Pays gas for settlement and recovery transactions. Holds only a small working balance. */
  KEEPER_PRIVATE_KEY: hexKey,
  /** Signs settlement attestations. Must be the distributor's immutable ATTESTER. Never reuse the keeper key. */
  ATTESTER_PRIVATE_KEY: hexKey,
  DISTRIBUTOR_ADDRESS: addressSchema,
  /** Decrypts per-merchant webhook signing secrets. */
  WEBHOOK_SECRET_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex characters'),
  /** Comma separated backup RPC URLs, tried when the primary fails. */
  ARC_RPC_FALLBACK_URLS: z.string().optional(),
  /** Required on the very first run when payment intents already exist (never scan from block 0). */
  SCANNER_START_BLOCK: z.coerce.bigint().nonnegative().optional(),
  /** Block the distributor was deployed in. Bounds the search for an existing settlement during crash recovery. */
  DISTRIBUTOR_DEPLOY_BLOCK: z.coerce.bigint().nonnegative().optional(),
  SCAN_INTERVAL_MS: int(1000, 120_000, 10_000),
  KEEPER_INTERVAL_MS: int(500, 60_000, 3_000),
  RECONCILE_INTERVAL_MS: int(1000, 300_000, 15_000),
  SCAN_MAX_BLOCKS: int(10, 5_000, 500),
  REPLAY_OVERLAP_BLOCKS: int(0, 200, 5),
  /** Blocks after the inclusion block before a receipt is trusted. Arc finalizes on inclusion, so 1 is enough. */
  CONFIRMATIONS: int(1, 50, 1),
  /** Hard ceiling for the keeper's maxFeePerGas, in gwei. Arc's floor is 20 gwei. */
  MAX_FEE_PER_GAS_GWEI: int(20, 10_000, 200),
  MIN_KEEPER_BALANCE_USDC: decimalUsdc.default('2'),
  CURSOR_LAG_ALERT_SECONDS: int(10, 86_400, 120),
  STUCK_SETTLEMENT_ALERT_SECONDS: int(30, 86_400, 300),
  ALERT_WEBHOOK_URL: z.string().url().optional(),
  RECOVERY_AUTOEXECUTE: z.enum(['true', 'false']).default('true'),
  HEALTH_PORT: int(1, 65_535, 8081),
};

const apiSchema = z.object({ ...baseShape, ...apiShape });
const workerSchema = z.object({ ...baseShape, ...workerShape });

export type ApiConfig = z.infer<typeof apiSchema> & { payoutChangesEnabled: boolean; emailProvider: 'oqumail' | 'smtp' | null };
export type WorkerConfig = z.infer<typeof workerSchema>;

export class ConfigError extends Error {
  readonly issues: readonly string[];
  constructor(service: string, issues: readonly string[]) {
    super(`Invalid ${service} configuration:\n - ${issues.join('\n - ')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
}

function requireProductionRpc(service: string, data: { NODE_ENV: string; ARC_RPC_URL?: string }): void {
  if (data.NODE_ENV === 'production' && !data.ARC_RPC_URL) {
    throw new ConfigError(service, ['ARC_RPC_URL: required in production (managed Arc RPC)']);
  }
}

export function loadApiConfig(env: Record<string, string | undefined>): ApiConfig {
  const parsed = apiSchema.safeParse(clean(env));
  if (!parsed.success) throw new ConfigError('api', formatIssues(parsed.error));
  requireProductionRpc('api', parsed.data);
  const d = parsed.data;
  // Payout changes need a working email channel. Oqumail needs only its API key: the sender address is set up in the
  // provider. Plain SMTP needs full credentials plus a From address. Otherwise payout changes stay disabled.
  const smtpReady = Boolean(d.SMTP_HOST && d.SMTP_PORT && d.SMTP_USER && d.SMTP_PASSWORD && d.EMAIL_FROM);
  const oqumailReady = Boolean(d.OQUMAIL_API_KEY);
  const emailProvider: ApiConfig['emailProvider'] =
    d.EMAIL_PROVIDER === 'smtp' ? (smtpReady ? 'smtp' : null)
    : d.EMAIL_PROVIDER === 'oqumail' ? (oqumailReady ? 'oqumail' : null)
    : oqumailReady ? 'oqumail' : smtpReady ? 'smtp' : null;
  return { ...d, emailProvider, payoutChangesEnabled: emailProvider !== null };
}

export function loadWorkerConfig(env: Record<string, string | undefined>): WorkerConfig {
  const parsed = workerSchema.safeParse(clean(env));
  if (!parsed.success) throw new ConfigError('worker', formatIssues(parsed.error));
  requireProductionRpc('worker', parsed.data);
  return parsed.data;
}

/** Safe-to-log summary: booleans and non-secret values only. */
export function describeConfig(config: ApiConfig | WorkerConfig): Record<string, string | number | boolean> {
  return {
    network: config.ACQUI_NETWORK,
    nodeEnv: config.NODE_ENV,
    managedRpc: Boolean(config.ARC_RPC_URL),
    feeRecipientConfigured: Boolean(config.FEE_RECIPIENT_SAFE),
    keeperCapConfigured: config.KEEPER_REIMBURSEMENT_CAP_USDC !== undefined,
    ...('payoutChangesEnabled' in config ? { payoutChangesEnabled: config.payoutChangesEnabled } : {}),
  };
}
