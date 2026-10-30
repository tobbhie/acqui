import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, loadApiConfig, loadWorkerConfig } from './config';

const validApi = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/acqui',
  GOOGLE_CLIENT_ID: 'id',
  GOOGLE_CLIENT_SECRET: 'secret',
  GOOGLE_REDIRECT_URI: 'http://localhost:8080/auth/google/callback',
  SESSION_SECRET: 's'.repeat(32),
  API_KEY_PEPPER: 'p'.repeat(32),
  WEBHOOK_SECRET_ENCRYPTION_KEY: 'ab'.repeat(32),
};

void describe('loadApiConfig', () => {
  void it('accepts a minimal valid env and freezes payout changes without email', () => {
    const config = loadApiConfig(validApi);
    assert.equal(config.ACQUI_NETWORK, 'arc-testnet');
    assert.equal(config.payoutChangesEnabled, false);
  });
  void it('lists every missing variable', () => {
    assert.throws(() => loadApiConfig({}), (error: unknown) => error instanceof ConfigError && error.issues.length >= 5);
  });
  void it('accepts mainnet only when selected explicitly', () => {
    assert.equal(loadApiConfig({ ...validApi, ACQUI_NETWORK: 'arc-mainnet' }).ACQUI_NETWORK, 'arc-mainnet');
  });
  void it('requires a managed RPC in production', () => {
    assert.throws(() => loadApiConfig({ ...validApi, NODE_ENV: 'production' }), ConfigError);
  });
  void it('treats blank values as unset', () => {
    assert.equal(loadApiConfig({ ...validApi, ARC_RPC_URL: '  ' }).ARC_RPC_URL, undefined);
  });
});

void describe('loadWorkerConfig', () => {
  void it('rejects a malformed keeper key', () => {
    assert.throws(
      () => loadWorkerConfig({ DATABASE_URL: validApi.DATABASE_URL, KEEPER_PRIVATE_KEY: '0x123' }),
      ConfigError,
    );
  });
});

const validWorker = {
  DATABASE_URL: validApi.DATABASE_URL,
  KEEPER_PRIVATE_KEY: `0x${'11'.repeat(32)}`,
  ATTESTER_PRIVATE_KEY: `0x${'22'.repeat(32)}`,
  DISTRIBUTOR_ADDRESS: '0x00000000000000000000000000000000000d1570',
  WEBHOOK_SECRET_ENCRYPTION_KEY: 'ab'.repeat(32),
};

void describe('loadWorkerConfig (step 04)', () => {
  void it('applies safe defaults', () => {
    const c = loadWorkerConfig(validWorker);
    assert.equal(c.SCAN_INTERVAL_MS, 10_000);
    assert.equal(c.CONFIRMATIONS, 1);
    assert.equal(c.MIN_KEEPER_BALANCE_USDC, 2_000_000n);
    assert.equal(c.RECOVERY_AUTOEXECUTE, 'true');
  });
  void it('requires separate-looking keys and a distributor', () => {
    assert.throws(() => loadWorkerConfig({ ...validWorker, DISTRIBUTOR_ADDRESS: '' }), ConfigError);
    assert.throws(() => loadWorkerConfig({ ...validWorker, ATTESTER_PRIVATE_KEY: 'nope' }), ConfigError);
  });
});
