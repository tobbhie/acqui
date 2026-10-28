// arc-studio-allow-onchain-literal (test fixtures: fake distributor and party addresses, never real funds)
/** Test harness: real PostgreSQL, real routes. Only Google, email and the chain reader are replaced by fakes. */
import { getAddress } from 'viem';
import { ARC_TESTNET, loadApiConfig, type Address, type ApiConfig } from '@acqui/shared';
import { createApp, DEFAULT_LIMITS, type Limits } from './app';
import type { GoogleAuth, GoogleProfile } from './auth/google';
import type { AppDeps, ChainReader, ContractsInfo, Mailer } from './context';
import { createDb, migrate, type Db } from './db';

export const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/acqui_test';
export const DISTRIBUTOR: Address = getAddress('0x00000000000000000000000000000000000d1570');
export const USDC: Address = ARC_TESTNET.usdcErc20;
export const ORIGIN = 'http://localhost:5173';
export const MERCHANT_ADDRESS = '0x1111111111111111111111111111111111111111';
export const OTHER_ADDRESS = '0x2222222222222222222222222222222222222222';
export const CUSTOMER_ADDRESS = '0x3333333333333333333333333333333333333333';

export const testContracts: ContractsInfo = {
  chainId: ARC_TESTNET.chainId, distributor: DISTRIBUTOR, factory: getAddress('0x00000000000000000000000000000000000fac70'),
  usdc: USDC, attester: getAddress('0x00000000000000000000000000000000000a7e57'),
  feeSafe: getAddress('0x00000000000000000000000000000000005afe00'), maxKeeperReimbursement: 100_000n, recoveryDelaySeconds: 86_400n,
};

export interface Resp { status: number; headers: Headers; body: Record<string, unknown>; text: string }
export interface Session { cookie: string; csrf: string }
export interface CallOptions { session?: Session; apiKey?: string; body?: unknown; headers?: Record<string, string>; csrf?: boolean; origin?: string | null }

export interface Harness {
  db: Db;
  deps: AppDeps;
  app: ReturnType<typeof createApp>;
  clock: { now: Date; advance(ms: number): void };
  mails: { to: string; subject: string; text: string }[];
  blocklist: Set<string>;
  chainState: { fail: boolean; calls: number };
  profiles: Map<string, GoogleProfile>;
  call(method: string, path: string, opts?: CallOptions): Promise<Resp>;
  login(sub: string, email?: string): Promise<Session>;
  onboard(sub: string, opts?: { origin?: string; payout?: string }): Promise<{ session: Session; apiKey: string; merchantId: string }>;
  close(): Promise<void>;
}

export const BASE_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: TEST_DB_URL,
  GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret',
  GOOGLE_REDIRECT_URI: 'http://localhost:8080/auth/google/callback',
  SESSION_SECRET: 's'.repeat(32), API_KEY_PEPPER: 'p'.repeat(32), WEBHOOK_SECRET_ENCRYPTION_KEY: 'ab'.repeat(32),
  CHECKOUT_BASE_URL: ORIGIN, DASHBOARD_BASE_URL: ORIGIN, KEEPER_REIMBURSEMENT_USDC: '0.02',
};

const TABLES = `users, merchants, sessions, oauth_flows, api_keys, webhook_secrets, payment_intents,
  payment_status_events, deposits, settlement_attempts, chain_cursors, webhook_deliveries, payout_address_changes, recovery_cases, demo_orders`;

export async function makeHarness(opts: { env?: Record<string, string>; contracts?: ContractsInfo | null; email?: boolean; limits?: Limits } = {}): Promise<Harness> {
  const db = createDb(TEST_DB_URL, 5);
  await migrate(db);
  await db.unsafe(`TRUNCATE ${TABLES} CASCADE`);

  const email = opts.email ?? true;
  const emailEnv = email ? { EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.test', SMTP_PORT: '587', SMTP_USER: 'u', SMTP_PASSWORD: 'p', EMAIL_FROM: 'noreply@acqui.test' } : {};
  const config: ApiConfig = loadApiConfig({ ...BASE_ENV, ...emailEnv, ...opts.env });
  const clock = { now: new Date('2026-10-28T12:00:00.000Z'), advance(ms: number) { this.now = new Date(this.now.getTime() + ms); } };
  const mails: Harness['mails'] = [];
  const mailer: Mailer = { send: (m) => { mails.push(m); return Promise.resolve(); } };
  const blocklist = new Set<string>();
  const chainState = { fail: false, calls: 0 };
  const chain: ChainReader = {
    isBlacklisted: (address) => {
      chainState.calls += 1;
      if (chainState.fail) return Promise.reject(new Error('rpc down'));
      return Promise.resolve(blocklist.has(address.toLowerCase()));
    },
  };
  const profiles = new Map<string, GoogleProfile>();
  const googleAuth: GoogleAuth = {
    createAuthorization: () => {
      const flow = { state: crypto.randomUUID(), codeVerifier: 'v'.repeat(43), nonce: crypto.randomUUID() };
      return Promise.resolve({ url: `https://accounts.example/auth?state=${flow.state}`, flow });
    },
    exchange: (url, flow) => {
      if (url.searchParams.get('state') !== flow.state) return Promise.reject(new Error('state mismatch'));
      const profile = profiles.get(url.searchParams.get('code') ?? '');
      return profile ? Promise.resolve(profile) : Promise.reject(new Error('bad code'));
    },
  };
  const deps: AppDeps = {
    db, config, googleAuth, chain, mailer: email ? mailer : null,
    contracts: opts.contracts === undefined ? testContracts : opts.contracts,
    now: () => clock.now,
  };
  const app = createApp(deps, opts.limits ?? { ...DEFAULT_LIMITS, perIpPerMinute: 100_000, perKeyPerMinute: 100_000, authPerIpPerMinute: 100_000 });

  const call: Harness['call'] = async (method, path, o = {}) => {
    const headers: Record<string, string> = { ...o.headers };
    if (o.body !== undefined) headers['content-type'] ??= 'application/json';
    if (o.apiKey) headers.authorization = `Bearer ${o.apiKey}`;
    if (o.session) {
      headers.cookie = o.session.cookie;
      if (o.csrf !== false && method !== 'GET') headers['x-csrf-token'] = o.session.csrf;
      if (o.origin !== null && method !== 'GET') headers.origin = o.origin ?? ORIGIN;
    }
    const init: RequestInit = { method, headers };
    if (o.body !== undefined) init.body = typeof o.body === 'string' ? o.body : JSON.stringify(o.body);
    const res = await app.request(path, init);
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try { body = text ? (JSON.parse(text) as Record<string, unknown>) : {}; } catch { body = {}; }
    return { status: res.status, headers: res.headers, body, text };
  };

  const login: Harness['login'] = async (sub, mail = `${sub}@example.com`) => {
    profiles.set(sub, { sub, email: mail, emailVerified: true, name: sub });
    const start = await app.request('/auth/google/start');
    const state = new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? '';
    const oauthCookie = (start.headers.getSetCookie().find((c) => c.startsWith('acqui_oauth_state=')) ?? '').split(';')[0] ?? '';
    const cb = await app.request(`/auth/google/callback?state=${state}&code=${sub}`, { headers: { cookie: oauthCookie } });
    const sessionCookie = (cb.headers.getSetCookie().find((c) => c.startsWith('acqui_session=')) ?? '').split(';')[0] ?? '';
    if (!sessionCookie) throw new Error('login failed');
    const me = (await (await app.request('/auth/session', { headers: { cookie: sessionCookie } })).json()) as { csrf_token: string };
    return { cookie: sessionCookie, csrf: me.csrf_token };
  };

  const onboard: Harness['onboard'] = async (sub, o = {}) => {
    const session = await login(sub);
    const created = await call('POST', '/v1/merchant', { session, body: { display_name: `Shop ${sub}` } });
    const merchantId = created.body.merchant_id as string;
    const payout = o.payout ?? MERCHANT_ADDRESS;
    await call('POST', '/v1/merchant/payout-address', { session, body: { payout_address: payout, confirm_address: payout, acknowledge: true } });
    if (o.origin) await call('PATCH', '/v1/merchant', { session, body: { allowed_return_origin: o.origin } });
    const key = await call('POST', '/v1/merchant/api-keys', { session, body: { label: 'test' } });
    return { session, apiKey: key.body.secret as string, merchantId };
  };

  return { db, deps, app, clock, mails, blocklist, chainState, profiles, call, login, onboard, close: () => db.end() };
}

let counter = 0;
export const idem = () => `idem-${Date.now()}-${(counter += 1)}-${Math.random().toString(36).slice(2, 8)}`;
export const intentBody = (over: Record<string, unknown> = {}) => ({
  amount: '10.00', currency: 'USDC', network: 'arc', order_id: 'order-1', ...over,
});
