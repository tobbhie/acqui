// arc-studio-allow-onchain-literal (local anvil only, throwaway keys, no real funds)
/**
 * Keeper against the REAL Acqui contracts on a local anvil: real attestation signature, real settle(), real reverts,
 * real receipts. Anvil is a standard EVM, so the EIP-7708 system logs do not exist here; the scanner and the deposit
 * re-verification are covered by the scripted tests and by Arc Testnet runs. Skipped when anvil or the build is missing.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createPublicClient, createTestClient, createWalletClient, defineChain, getAddress, http, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { deriveFactoryAddress, type Address } from '@acqui/shared';
import { makeHarness, intentBody, idem, type Harness } from '../../api/src/testing';
import { recordDeposit } from '../../api/src/payments/state';
import { createKeeperChain, encodeSettle } from './chain';
import { evaluateIntent } from './evaluate';
import { keeperTick, termsOf, type IntentRow, type KeeperCtx } from './keeper';
import { recoveryTick } from './recovery';
import { createAlerts } from './alerts';
import { silentLogger } from './types';

const PORT = 8546;
const RPC = `http://127.0.0.1:${PORT}`;
const CHAIN_ID = 31337;
const artifact = (name: string, file = name) => `contracts/out/${file}.sol/${name}.json`;
const ready = existsSync(artifact('PaymentDistributor')) && existsSync(artifact('MockUSDC'));
const erc20Abi = [
  { type: 'function', name: 'mint', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

void describe('keeper against the real contracts on anvil', { skip: !ready }, () => {
  let anvil: ChildProcess;
  let h: Harness;
  const chain = defineChain({ id: CHAIN_ID, name: 'anvil', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
  const client = createPublicClient({ chain, transport: http(RPC) });
  const test = createTestClient({ chain, transport: http(RPC), mode: 'anvil' });
  const deployer = privateKeyToAccount(generatePrivateKey());
  const attesterKey = generatePrivateKey();
  const attester = privateKeyToAccount(attesterKey);
  const keeperKey = generatePrivateKey();
  const keeper = privateKeyToAccount(keeperKey);
  const feeSafe = privateKeyToAccount(generatePrivateKey()).address;
  const merchant = privateKeyToAccount(generatePrivateKey()).address;
  const wallet = createWalletClient({ account: deployer, chain, transport: http(RPC) });
  let usdc: Address;
  let distributor: Address;
  let ctx: KeeperCtx;
  let apiKey: string;
  let real: ReturnType<typeof createKeeperChain>;

  const deploy = async (name: string, args: readonly unknown[], file = name): Promise<Address> => {
    const art = JSON.parse(readFileSync(artifact(name, file), 'utf8')) as { abi: never; bytecode: { object: Hex } };
    const hash = await wallet.deployContract({ abi: art.abi, bytecode: art.bytecode.object, args: args });
    const receipt = await client.waitForTransactionReceipt({ hash });
    return getAddress(receipt.contractAddress as string);
  };
  const mint = async (to: Address, amount: bigint): Promise<Hex> => {
    const hash = await wallet.writeContract({ address: usdc, abi: erc20Abi, functionName: 'mint', args: [to, amount] });
    await client.waitForTransactionReceipt({ hash });
    return hash;
  };
  const balance = (a: Address) => client.readContract({ address: usdc, abi: erc20Abi, functionName: 'balanceOf', args: [a] });

  before(async () => {
    anvil = spawn('anvil', ['--port', String(PORT), '--silent'], { stdio: 'ignore' });
    for (let i = 0; i < 50; i += 1) {
      try { await client.getChainId(); break; } catch { await new Promise((r) => setTimeout(r, 200)); }
    }
    for (const a of [deployer.address, keeper.address]) await test.setBalance({ address: a, value: 10n ** 20n });
    usdc = await deploy('MockUSDC', [], 'MockUSDC');
    distributor = await deploy('PaymentDistributor', [usdc, attester.address, feeSafe, 100_000n, 86_400n]);
    const factory = deriveFactoryAddress(distributor);

    h = await makeHarness({
      contracts: { chainId: CHAIN_ID, distributor, factory, usdc, attester: attester.address, feeSafe, maxKeeperReimbursement: 100_000n, recoveryDelaySeconds: 86_400n },
    });
    h.clock.now = new Date();
    apiKey = (await h.onboard('e2e', { payout: merchant })).apiKey;
    const alerts = createAlerts({ log: silentLogger, now: () => h.clock.now, cooldownMs: 0 });
    real = createKeeperChain({
      client, chain, distributor, usdc, keeperKey, maxFeePerGasWei: 200n * 10n ** 9n, minFeePerGasWei: 20n * 10n ** 9n,
      emitter: getAddress('0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE'),
    });
    // Anvil is a standard EVM and never emits Arc's system logs, so only the deposit re-check is stubbed.
    const keeperChain = Object.assign(Object.create(real) as typeof real, { verifyDeposit: () => Promise.resolve(true) });
    ctx = {
      db: h.db, chain: keeperChain, attester, alerts, log: silentLogger, now: () => h.clock.now, sleep: () => new Promise((r) => setTimeout(r, 50)),
      contracts: { chainId: CHAIN_ID, distributor, usdc, recoveryDelaySeconds: 86_400n },
      config: { CONFIRMATIONS: 1, MIN_KEEPER_BALANCE_WEI: 10n ** 12n, STUCK_SETTLEMENT_ALERT_SECONDS: 300 },
    };
  });
  after(async () => {
    anvil.kill();
    await h.close();
  });

  async function fundedIntent(units: bigint) {
    const res = await h.call('POST', '/v1/payment-intents', { apiKey, body: intentBody({ order_id: `e2e-${Math.random()}` }), headers: { 'idempotency-key': idem() } });
    assert.equal(res.status, 201, res.text);
    const row = (await h.db<IntentRow[]>`SELECT * FROM payment_intents WHERE receiver_address = ${(res.body.receiver_address as string).toLowerCase()}`)[0];
    const receiver = getAddress(row.receiver_address);
    assert.equal(await client.getCode({ address: receiver }), undefined, 'the receiver does not exist before the payment');
    const txHash = await mint(receiver, units);
    const block = await client.getBlock();
    await recordDeposit(h.db, {
      paymentIntentId: row.id, chainId: CHAIN_ID, txHash, logIndex: 0, blockNumber: block.number,
      blockTimestamp: new Date(Number(block.timestamp) * 1000), fromAddress: null, amountUnits: units, onTime: true,
    });
    await evaluateIntent({ db: h.db, chainId: CHAIN_ID, recoveryDelaySeconds: 86_400n, log: silentLogger, now: () => h.clock.now }, row.id);
    return { row: (await h.db<IntentRow[]>`SELECT * FROM payment_intents WHERE id = ${row.id}`)[0], receiver };
  }

  void it('settles for real: merchant net, keeper reimbursement and protocol fee, then refuses a second settlement', async () => {
    const { row, receiver } = await fundedIntent(10_000_000n);
    assert.equal(row.status, 'verifying');
    const keeperBefore = await balance(keeper.address);
    await keeperTick(ctx); // sign
    await keeperTick(ctx); // settle on the real contract
    const after = (await h.db<IntentRow[]>`SELECT * FROM payment_intents WHERE id = ${row.id}`)[0];
    assert.equal(after.status, 'settled');
    assert.equal(await balance(merchant), 9_880_000n, 'merchant gets gross minus fee minus reimbursement');
    assert.equal(await balance(keeper.address) - keeperBefore, 20_000n, 'keeper gets exactly the precommitted reimbursement');
    assert.equal(await balance(distributor), 100_000n, 'protocol fee accrued in the distributor');
    assert.equal(await balance(receiver), 0n);
    assert.equal(((await h.db`SELECT settlement_tx_hash FROM payment_intents WHERE id = ${row.id}`)[0]?.settlement_tx_hash as string).length, 66);

    const nonce = await client.getTransactionCount({ address: keeper.address });
    await keeperTick(ctx); await keeperTick(ctx);
    assert.equal(await client.getTransactionCount({ address: keeper.address }), nonce, 'no further transaction after settlement');

    // The same attestation replayed straight at the contract is rejected with a decoded error.
    const att = (await h.db`SELECT evidence, signature FROM settlement_attempts WHERE payment_intent_id = ${row.id}`)[0];
    const ev = att?.evidence as { eligibleAmount: string; depositTimestamp: string; evidenceTxHash: Hex; evidenceBlock: string };
    const replay = await real.simulate(encodeSettle(termsOf(after), {
      eligibleAmount: BigInt(ev.eligibleAmount), depositTimestamp: BigInt(ev.depositTimestamp), evidenceTxHash: ev.evidenceTxHash, evidenceBlock: BigInt(ev.evidenceBlock),
    }, att?.signature as Hex));
    assert.deepEqual(replay.ok ? null : replay.error, 'AlreadySettled');
  });

  void it('returns an overpayment to the committed refund address through the real recover()', async () => {
    const { row, receiver } = await fundedIntent(10_000_000n);
    await mint(receiver, 2_000_000n);
    const block = await client.getBlock();
    await recordDeposit(h.db, { paymentIntentId: row.id, chainId: CHAIN_ID, txHash: `0x${'ee'.repeat(32)}`, logIndex: 0, blockNumber: block.number, blockTimestamp: new Date(Number(block.timestamp) * 1000), fromAddress: null, amountUnits: 2_000_000n, onTime: true });
    await keeperTick(ctx); await keeperTick(ctx);
    assert.equal((await h.db`SELECT status FROM payment_intents WHERE id = ${row.id}`)[0]?.status, 'settled');
    assert.equal(await balance(receiver), 2_000_000n, 'settlement took the invoice amount only');
    await evaluateIntent({ db: h.db, chainId: CHAIN_ID, recoveryDelaySeconds: 86_400n, log: silentLogger, now: () => h.clock.now }, row.id);
    const before = await balance(merchant); // the default refund address is the merchant payout address
    await recoveryTick({ db: h.db, chain: ctx.chain, contracts: { chainId: CHAIN_ID, distributor }, autoExecute: true, minBalanceWei: 0n, alerts: ctx.alerts, log: silentLogger, now: () => h.clock.now, sleep: ctx.sleep });
    assert.equal(await balance(merchant) - before, 2_000_000n);
    assert.equal(await balance(receiver), 0n);
    assert.equal((await h.db`SELECT status FROM recovery_cases WHERE payment_intent_id = ${row.id}`)[0]?.status, 'recovered');
  });

  void it('waits when the keeper cannot pay gas and settles once it is funded', async () => {
    const { row } = await fundedIntent(10_000_000n);
    await test.setBalance({ address: keeper.address, value: 1_000n });
    await keeperTick(ctx); await keeperTick(ctx);
    assert.equal((await h.db`SELECT status FROM payment_intents WHERE id = ${row.id}`)[0]?.status, 'settling');
    assert.equal((await h.db`SELECT error_code FROM settlement_attempts WHERE payment_intent_id = ${row.id}`)[0]?.error_code, 'insufficient_gas');
    await test.setBalance({ address: keeper.address, value: 10n ** 20n });
    await keeperTick(ctx);
    assert.equal((await h.db`SELECT status FROM payment_intents WHERE id = ${row.id}`)[0]?.status, 'settled');
  });
});
