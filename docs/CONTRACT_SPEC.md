# Acqui contract specification (Step 02)

Solidity 0.8.28, Foundry root `contracts/`, OpenZeppelin 5.6.1 (already installed, import from `@openzeppelin/contracts/...`). No upgradeability, no owner, no admin, no pause, no proxies. All amounts are integer USDC ERC-20 base units (6 decimals).

## Files (flat in `contracts/`, so artifacts land at `contracts/out/<Name>.sol/<Name>.json`)

- `contracts/AcquiTerms.sol`: `Terms` struct and `AcquiTerms` library (hash).
- `contracts/PaymentReceiver.sol`
- `contracts/PaymentFactory.sol`
- `contracts/PaymentDistributor.sol`

Existing `contracts/script/Create2Factory.sol` and `DeployCreate2.s.sol` are sandbox helpers: do not modify, do not depend on them.

## Arc facts that shape the design

- USDC ERC-20 is at `0x3600000000000000000000000000000000000000`, 6 decimals. Native gas view is the same balance at 18 decimals. A plain native send to an address and an ERC-20 transfer both raise `USDC.balanceOf(address)`. Always account in the ERC-20 view.
- Receiving a transfer never executes the receiver's code. Contract balance alone does not prove a deposit arrived before expiry. Hence the signed settlement attestation below.
- Value transfers to or from USDC-blocklisted addresses revert. A zero address transfer reverts.
- Block timestamps are non-decreasing, not strictly increasing.

## AcquiTerms

```solidity
struct Terms {
    bytes32 intentId;             // keccak256 of the off-chain payment intent public id
    bytes32 attemptId;            // unique per checkout attempt; new attempt means new receiver
    address merchant;             // payout address snapshot
    address refundAddress;        // customer-declared (or merchant, by product choice) refund destination
    uint256 amount;               // invoice amount in USDC base units
    uint64  expiry;               // unix seconds; deposits with block timestamp <= expiry are on time
    uint16  feeBps;               // must equal distributor FEE_BPS (10)
    uint256 minFee;               // must equal distributor MIN_FEE (100_000)
    uint256 keeperReimbursement;  // fixed, precommitted, <= distributor MAX_KEEPER_REIMBURSEMENT
}
```

`AcquiTerms.hash(Terms memory/calldata t)` returns
`keccak256(abi.encode(TERMS_TYPEHASH, block.chainid, t.intentId, t.attemptId, t.merchant, t.refundAddress, t.amount, t.expiry, t.feeBps, t.minFee, t.keeperReimbursement))`
with `TERMS_TYPEHASH = keccak256("Terms(uint256 chainId,bytes32 intentId,bytes32 attemptId,address merchant,address refundAddress,uint256 amount,uint64 expiry,uint16 feeBps,uint256 minFee,uint256 keeperReimbursement)")`. The hash is chain-bound.

## PaymentReceiver (minimal, no keys, no admin)

- `constructor(address distributor_, bytes32 termsHash_)` stores both as immutables, public getters `distributor()` and `termsHash()`.
- `receive() external payable {}` so native USDC sent after deployment is accepted.
- `function pull(IERC20 token, address to, uint256 amount) external`: reverts unless `msg.sender == distributor`; `SafeERC20.safeTransfer(token, to, amount)`.
- Nothing else. No selfdestruct, no delegatecall, no other state.

## PaymentFactory

- `constructor(address distributor_)`: immutable `distributor`, immutable `DEPLOYED_CHAIN_ID = block.chainid`.
- `function predictReceiver(bytes32 termsHash) public view returns (address)`: CREATE2 address with `salt = termsHash` and init code `abi.encodePacked(type(PaymentReceiver).creationCode, abi.encode(distributor, termsHash))`.
- `function deployReceiver(bytes32 termsHash) external returns (address receiver)`: permissionless and idempotent. If code already exists at the predicted address return it; otherwise deploy with `new PaymentReceiver{salt: termsHash}(distributor, termsHash)`. On deploy set `termsHashOf[receiver] = termsHash` and emit `ReceiverDeployed(bytes32 indexed termsHash, address indexed receiver)`.
- `mapping(address => bytes32) public termsHashOf` (registry; zero means not registered by this factory).
- `function isRegistered(address receiver) external view returns (bool)`.

## PaymentDistributor (EIP-712 domain `"AcquiPaymentDistributor"`, version `"1"`, OZ `EIP712`; OZ `ReentrancyGuard`)

Immutables and constants:

- `IERC20 public immutable USDC`, `address public immutable ATTESTER` (EOA or ERC-1271 contract; verify with OZ `SignatureChecker.isValidSignatureNow`), `address public immutable FEE_SAFE`, `PaymentFactory public immutable FACTORY`, `uint256 public immutable DEPLOYED_CHAIN_ID`, `uint256 public immutable MAX_KEEPER_REIMBURSEMENT`, `uint64 public immutable RECOVERY_DELAY`.
- `uint256 public constant MIN_PAYMENT = 1_000_000; MIN_FEE = 100_000; uint16 FEE_BPS = 10; BPS_DENOMINATOR = 10_000;`
- Constructor `(IERC20 usdc, address attester, address feeSafe, uint256 maxKeeperReimbursement, uint64 recoveryDelay)`. Reverts on: zero addresses; `attester == feeSafe`; `usdc` without code; `IERC20Metadata(usdc).decimals() != 6`; `maxKeeperReimbursement > MIN_FEE`; `recoveryDelay` outside `[1 hours, 30 days]`. Deploys the factory: `FACTORY = new PaymentFactory(address(this))`. Emits `DistributorDeployed(address indexed factory, uint256 chainId, address usdc, address attester, address feeSafe, uint256 maxKeeperReimbursement, uint64 recoveryDelay)`.
- No function can change any of these. No receive/fallback (native sends to the distributor revert).

State:

```solidity
struct SettlementRecord { bool settled; uint256 gross; uint256 fee; uint256 keeperReimbursement; uint256 merchantNet; }
mapping(address receiver => SettlementRecord) public settlements;
mapping(address receiver => uint256) public recoveredAmount;   // cumulative refunded
uint256 public accruedFees;           // fees not yet collected
uint256 public totalFeesAccrued;
uint256 public totalFeesCollected;
uint256 public totalGrossSettled;
```

Pure/view helpers:

- `computeFee(uint256 amount) returns (uint256)`: `max(MIN_FEE, ceilDiv(amount * FEE_BPS, BPS_DENOMINATOR))`. Rounds up (matches TypeScript `computeGatewayFee`).
- `previewSettlement(uint256 amount, uint256 keeperReimbursement) returns (uint256 fee, uint256 merchantNet)`; reverts if amount < MIN_PAYMENT, reimbursement > MAX, or net would be zero.
- `hashTerms(Terms calldata t) returns (bytes32)`; `predictReceiver(Terms calldata t) returns (address)`.
- `settlementDigest(Terms calldata t, SettlementEvidence calldata e) returns (bytes32)`: the EIP-712 digest the attester signs.

Terms validation (internal `_validate(Terms calldata t)`, used by settle and recover): `merchant != 0`, `refundAddress != 0`, neither equals `address(this)` or `address(FACTORY)`; `amount >= MIN_PAYMENT`; `expiry != 0`; `feeBps == FEE_BPS`; `minFee == MIN_FEE`; `keeperReimbursement <= MAX_KEEPER_REIMBURSEMENT`; and the computed receiver address is neither `merchant` nor `refundAddress`. Net must be positive (guaranteed by the constructor bound, but assert).

### settle

```solidity
struct SettlementEvidence { uint256 eligibleAmount; uint64 depositTimestamp; bytes32 evidenceTxHash; uint64 evidenceBlock; }
function settle(Terms calldata t, SettlementEvidence calldata e, bytes calldata signature) external nonReentrant
```

EIP-712 type: `Settlement(bytes32 termsHash,uint256 eligibleAmount,uint64 depositTimestamp,bytes32 evidenceTxHash,uint64 evidenceBlock)`. The contract recomputes `termsHash` from `t`; the signature never carries a caller-chosen hash.

Checks in order: validate terms; `block.timestamp <= uint256(t.expiry) + RECOVERY_DELAY` (settlement window) else `SettlementWindowClosed`; `e.depositTimestamp <= t.expiry` else `DepositAfterExpiry` (a deposit at exactly `expiry` is on time, `expiry + 1` is late); `e.depositTimestamp <= block.timestamp`; `e.eligibleAmount >= t.amount`; valid attester signature else `InvalidAttestation`; `receiver = FACTORY.deployReceiver(termsHash)`; `!settlements[receiver].settled` else `AlreadySettled`; `USDC.balanceOf(receiver) >= t.amount` else `InsufficientReceiverBalance`.

Effects (before interactions): record settlement, `accruedFees += fee`, `totalFeesAccrued += fee`, `totalGrossSettled += amount`. Amounts: `gross = t.amount` (never the balance; excess stays in the receiver), `fee = computeFee(gross)`, `keeperReimbursement = t.keeperReimbursement`, `merchantNet = gross - fee - keeperReimbursement`.

Interactions, each via `receiver.pull(USDC, to, amount)`: merchantNet to `t.merchant`; keeperReimbursement to `msg.sender` (skip if zero); fee to `address(this)`. Exactly `gross` leaves the receiver.

Emit `PaymentSettled(address indexed receiver, bytes32 indexed intentId, address indexed merchant, bytes32 attemptId, uint256 gross, uint256 fee, uint256 keeperReimbursement, uint256 merchantNet, address keeper, uint64 depositTimestamp, bytes32 evidenceTxHash, uint64 evidenceBlock)`.

Replay protection: the receiver address is unique per terms and `settled` is a one-way flag. A signature cannot be replayed for another receiver (digest binds `termsHash`), another chain or another distributor (EIP-712 domain).

### recover (constrained, address-only, permissionless)

The refund destination is `t.refundAddress`, fixed at attempt creation inside the receiver address. Nobody, including the attester, can choose a different destination, and `tx.from` of the deposit is never used.

```solidity
function recover(Terms calldata t) external nonReentrant returns (uint256 amount)
```

Rules:

- Validate terms; `receiver = FACTORY.deployReceiver(hash)`.
- If not settled: require `block.timestamp > uint256(t.expiry) + RECOVERY_DELAY` else `RecoveryNotOpen`. The settlement window and the recovery window never overlap, so a late deposit cannot be converted into a merchant payment after recovery opens, and recovery cannot front-run an on-time payment during the grace period.
- If settled: recovery is open immediately (the invoice is paid; the remaining balance is overpayment or a later deposit).
- `amount = USDC.balanceOf(receiver)`; revert `NothingToRecover` if zero.
- `recoveredAmount[receiver] += amount` before the interaction; `receiver.pull(USDC, t.refundAddress, amount)`; emit `FundsRecovered(address indexed receiver, bytes32 indexed intentId, address indexed refundAddress, uint256 amount, bool afterSettlement, address caller)`.
- No fee is taken on recovery. The caller pays gas.
- May be called repeatedly for further deposits.

Known limits to document, not fix: sub-1e-6 native dust is not representable in the ERC-20 view and stays in the receiver; non-USDC tokens sent to a receiver are not recoverable; a blocklisted refund address makes `recover` revert.

### collectFees

`function collectFees() external nonReentrant returns (uint256 amount)`: permissionless; `amount = USDC.balanceOf(address(this))`; revert `NothingToCollect` if zero; capture `accounted = accruedFees`, then set `accruedFees = 0` and `totalFeesCollected += amount` before the transfer; `USDC.safeTransfer(FEE_SAFE, amount)`; emit `FeesCollected(address indexed feeSafe, uint256 amount, uint256 accountedFees)`. The destination is always `FEE_SAFE`. Because merchant and keeper amounts are paid straight from receivers, the distributor balance is only fees plus any accidental transfer, which also goes to the Safe.

## Errors

Use custom errors for every revert (`ZeroAddress`, `InvalidTerms`, `AmountBelowMinimum`, `KeeperReimbursementTooHigh`, `SettlementWindowClosed`, `DepositAfterExpiry`, `InsufficientEligibleAmount`, `InvalidAttestation`, `AlreadySettled`, `InsufficientReceiverBalance`, `RecoveryNotOpen`, `NothingToRecover`, `NothingToCollect`, and constructor errors). Add NatSpec to every external function and event. Use `SafeERC20` for all token transfers.
