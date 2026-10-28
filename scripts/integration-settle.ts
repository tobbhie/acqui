/**
 * Integration script: receiver funding -> attested settlement -> merchant, keeper, protocol fee -> fee collection,
 * plus overpayment recovery. Run `bun run integration:settle -- --local` against a local anvil (deploys a mock USDC),
 * or point it at Arc Testnet with the INTEGRATION_* variables below. Refuses to run on Arc mainnet (chain 5042).
 *
 * Live variables: RPC_URL, INTEGRATION_DEPLOYER_KEY, INTEGRATION_ATTESTER_KEY, INTEGRATION_CUSTOMER_KEY,
 * INTEGRATION_KEEPER_KEY, INTEGRATION_MERCHANT_ADDRESS, INTEGRATION_FEE_SAFE_ADDRESS, optional DISTRIBUTOR_ADDRESS,
 * optional `--native` to fund the receiver with a native send instead of an ERC-20 transfer.
 */
import { readFileSync } from 'node:fs';
import {
  createPublicClient, createTestClient, createWalletClient, defineChain, getAddress, http, parseAbi,
  type Abi, type Address, type Hex, type PublicClient, type WalletClient,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import {
  distributorAbi, hashTerms, protocolFeeTerms, settlementTypedData, type ContractTerms, type SettlementEvidence,
} from '../packages/shared/src/contracts';
import { ARC_TESTNET } from '../packages/shared/src/chains';
import { computeGatewayFee } from '../packages/shared/src/policy';
import { deriveFactoryAddress, deriveReceiverAddress } from '../packages/shared/src/receiver';

const ARC_MAINNET_CHAIN_ID = 5042;
const MIN_ARC_FEE = 20_000_000_000n; // 20 gwei floor documented for Arc
const AMOUNT = 10_000_000n; // 10 USDC
const REIMBURSEMENT = 20_000n; // 0.02 USDC
const OVERPAY = 1_000_000n;
const NATIVE_PER_USDC_UNIT = 1_000_000_000_000n;
const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function transfer(address,uint256) returns (bool)',
  'function mint(address,uint256)',
]);

interface Artifact { abi: Abi; bytecode: { object: Hex } }
const loadArtifact = (path: string): Artifact => JSON.parse(readFileSync(path, 'utf8')) as Artifact;
const results: { label: string; ok: boolean; detail: string }[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  results.push({ label, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `: ${detail}` : ''}`);
}
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
}
const keyFor = (name: string, local: boolean): Hex => (local ? generatePrivateKey() : (requireEnv(name) as Hex));

async function main(): Promise<void> {
  const local = process.argv.includes('--local');
  const native = process.argv.includes('--native');
  const rpcUrl = local ? (process.env.RPC_URL ?? 'http://127.0.0.1:8545') : requireEnv('RPC_URL');
  const probe = createPublicClient({ transport: http(rpcUrl) });
  const chainId = await probe.getChainId();
  if (chainId === ARC_MAINNET_CHAIN_ID) throw new Error('Refusing to run against Arc mainnet. Mainnet is locked.');
  if (local && chainId === ARC_TESTNET.chainId) throw new Error('--local must not point at Arc Testnet');

  const arc = chainId === ARC_TESTNET.chainId;
  const chain = defineChain({
    id: chainId, name: arc ? 'Arc Testnet' : 'local',
    nativeCurrency: { name: arc ? 'USDC' : 'Ether', symbol: arc ? 'USDC' : 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const pub: PublicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const accounts = {
    deployer: privateKeyToAccount(keyFor('INTEGRATION_DEPLOYER_KEY', local)),
    attester: privateKeyToAccount(keyFor('INTEGRATION_ATTESTER_KEY', local)),
    customer: privateKeyToAccount(keyFor('INTEGRATION_CUSTOMER_KEY', local)),
    keeper: privateKeyToAccount(keyFor('INTEGRATION_KEEPER_KEY', local)),
  };
  const merchant = local ? privateKeyToAccount(generatePrivateKey()).address : getAddress(requireEnv('INTEGRATION_MERCHANT_ADDRESS'));
  const feeSafe = local ? privateKeyToAccount(generatePrivateKey()).address : getAddress(requireEnv('INTEGRATION_FEE_SAFE_ADDRESS'));
  if (local) {
    const test = createTestClient({ chain, mode: 'anvil', transport: http(rpcUrl) });
    for (const a of Object.values(accounts)) await test.setBalance({ address: a.address, value: 10n ** 21n });
  }

  const fees = async () => {
    const est = await pub.estimateFeesPerGas();
    const max = est.maxFeePerGas ?? 0n;
    return { maxFeePerGas: arc && max < MIN_ARC_FEE ? MIN_ARC_FEE : max, maxPriorityFeePerGas: est.maxPriorityFeePerGas ?? 0n };
  };
  const wallet = (account: PrivateKeyAccount): WalletClient => createWalletClient({ account, chain, transport: http(rpcUrl) });
  const send = async (account: PrivateKeyAccount, address: Address, abi: Abi, fn: string, args: readonly unknown[]) => {
    const hash = await wallet(account).writeContract({ address, abi, functionName: fn, args, chain, account, ...(await fees()) });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error(`${fn} reverted (${hash})`);
    return receipt;
  };
  const deploy = async (account: PrivateKeyAccount, artifact: Artifact, args: readonly unknown[]): Promise<Address> => {
    const hash = await wallet(account).deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args, chain, account, ...(await fees()) });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new Error('deploy failed');
    return receipt.contractAddress;
  };
  const bal = (token: Address, who: Address) => pub.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [who] });

  // ---- USDC and distributor ----
  let usdc: Address = ARC_TESTNET.usdcErc20;
  if (local) usdc = await deploy(accounts.deployer, loadArtifact('contracts/out/MockUSDC.sol/MockUSDC.json'), []);
  const decimals = await pub.readContract({ address: usdc, abi: erc20Abi, functionName: 'decimals' });
  check('USDC ERC-20 decimals == 6', decimals === 6, `decimals=${decimals}, chainId=${chainId}`);

  let distributor = process.env.DISTRIBUTOR_ADDRESS as Address | undefined;
  if (!distributor) {
    distributor = await deploy(accounts.deployer, loadArtifact('contracts/out/PaymentDistributor.sol/PaymentDistributor.json'),
      [usdc, accounts.attester.address, feeSafe, REIMBURSEMENT, 3600n]);
  }
  const dist = distributor;
  const read = <T>(fn: string, args: readonly unknown[] = []) =>
    pub.readContract({ address: dist, abi: distributorAbi, functionName: fn as never, args: args }) as Promise<T>;
  check('distributor records deployment chain id', (await read<bigint>('DEPLOYED_CHAIN_ID')) === BigInt(chainId));
  check('distributor FEE_SAFE matches', getAddress(await read<Address>('FEE_SAFE')) === feeSafe);

  // ---- terms ----
  const block = await pub.getBlock();
  const terms: ContractTerms = {
    intentId: `0x${'ab'.repeat(32)}`, attemptId: `0x${Date.now().toString(16).padStart(64, '0')}`,
    merchant, refundAddress: accounts.customer.address, amount: AMOUNT, expiry: block.timestamp + 1800n,
    keeperReimbursement: REIMBURSEMENT, ...protocolFeeTerms(),
  };
  const termsHash = hashTerms(BigInt(chainId), terms);
  check('TypeScript terms hash == onchain hashTerms', (await read<Hex>('hashTerms', [terms])) === termsHash);
  const receiver = await read<Address>('predictReceiver', [terms]);
  check('offline receiver derivation == onchain predictReceiver', deriveReceiverAddress(dist, termsHash) === receiver, `receiver=${receiver}`);
  check('offline factory derivation == onchain FACTORY', deriveFactoryAddress(dist) === getAddress(await read<Address>('FACTORY')));
  check('receiver has no code before payment (counterfactual)', (await pub.getCode({ address: receiver })) === undefined);

  // ---- customer funds the counterfactual receiver ----
  const before = {
    merchant: await bal(usdc, merchant), keeper: await bal(usdc, accounts.keeper.address),
    safe: await bal(usdc, feeSafe), customer: await bal(usdc, accounts.customer.address),
  };
  if (local) await send(accounts.deployer, usdc, erc20Abi, 'mint', [accounts.customer.address, AMOUNT + OVERPAY]);
  let fundHash: Hex;
  if (native && arc) {
    fundHash = await wallet(accounts.customer).sendTransaction({ account: accounts.customer, chain, to: receiver, value: AMOUNT * NATIVE_PER_USDC_UNIT, ...(await fees()) });
    await pub.waitForTransactionReceipt({ hash: fundHash });
    const nativeBal = await pub.getBalance({ address: receiver });
    check('native send: eth_getBalance == amount * 1e12', nativeBal === AMOUNT * NATIVE_PER_USDC_UNIT, `native=${nativeBal}`);
  } else {
    fundHash = (await send(accounts.customer, usdc, erc20Abi, 'transfer', [receiver, AMOUNT])).transactionHash;
  }
  const fundReceipt = await pub.getTransactionReceipt({ hash: fundHash });
  check('ERC-20 balanceOf(receiver) == invoice amount', (await bal(usdc, receiver)) === AMOUNT);
  if (arc) {
    const system = fundReceipt.logs.filter((l) => l.address.toLowerCase() === ARC_TESTNET.nativeTransferEmitter.toLowerCase()).length;
    const erc20 = fundReceipt.logs.filter((l) => l.address.toLowerCase() === usdc.toLowerCase()).length;
    check('economic payment counted once via system emitter', system === 1, `systemLogs=${system}, erc20Logs=${erc20}, countedPayments=${system}`);
  }
  const fundBlock = await pub.getBlock({ blockNumber: fundReceipt.blockNumber });

  // ---- attestation and settlement ----
  const evidence: SettlementEvidence = {
    eligibleAmount: AMOUNT, depositTimestamp: fundBlock.timestamp, evidenceTxHash: fundHash, evidenceBlock: fundReceipt.blockNumber,
  };
  const signature = await accounts.attester.signTypedData(
    settlementTypedData({ chainId: BigInt(chainId), verifyingContract: dist }, termsHash, evidence));
  const settleReceipt = await send(accounts.keeper, dist, distributorAbi, 'settle', [terms, evidence, signature]);

  const fee = computeGatewayFee(AMOUNT);
  const net = AMOUNT - fee - REIMBURSEMENT;
  check('merchant received net amount', (await bal(usdc, merchant)) - before.merchant === net, `net=${net}`);
  const gasUsdc = arc ? (settleReceipt.gasUsed * settleReceipt.effectiveGasPrice) / NATIVE_PER_USDC_UNIT : 0n;
  const keeperDelta = (await bal(usdc, accounts.keeper.address)) - before.keeper;
  check('keeper received reimbursement (net of gas on Arc)', keeperDelta === REIMBURSEMENT - gasUsdc,
    `reimbursement=${REIMBURSEMENT}, gasUsdc=${gasUsdc}, delta=${keeperDelta}, reimbursementCoversGas=${REIMBURSEMENT >= gasUsdc}`);
  check('distributor holds exactly the protocol fee', (await bal(usdc, dist)) === fee, `fee=${fee}`);
  check('receiver emptied of invoice amount', (await bal(usdc, receiver)) === 0n);

  let replayRejected = false;
  try {
    await pub.simulateContract({ address: dist, abi: distributorAbi, functionName: 'settle', args: [terms, evidence, signature], account: accounts.keeper });
  } catch { replayRejected = true; }
  check('replay of the same settlement is rejected', replayRejected);

  // ---- overpayment recovery ----
  await send(accounts.customer, usdc, erc20Abi, 'transfer', [receiver, OVERPAY]);
  const custBefore = await bal(usdc, accounts.customer.address);
  await send(accounts.keeper, dist, distributorAbi, 'recover', [terms]);
  check('overpayment recovered to refundAddress only', (await bal(usdc, accounts.customer.address)) - custBefore === OVERPAY);

  // ---- fee collection ----
  await send(accounts.keeper, dist, distributorAbi, 'collectFees', []);
  check('collectFees sent the fee to the Safe', (await bal(usdc, feeSafe)) - before.safe === fee);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed on chain ${chainId}`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
