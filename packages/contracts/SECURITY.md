# AetherDEX Smart Contracts — Security Analysis

## Slither Static Analysis

**Run**: `slither . --filter-paths "lib/|test/"`  
**Version**: Slither 0.11.5  
**Date**: 2026-06-30

### Results

| Severity    | Count | Status |
|-------------|-------|--------|
| Critical    | 0     | —      |
| High        | 0     | —      |
| Medium      | 0     | 1 fixed (reentrancy-no-eth in AetherFactory.createPool) |
| Low         | 3     | Accepted |
| Informational | 4   | Accepted |

### Fixed Findings

#### MEDIUM — reentrancy-no-eth (AetherFactory.createPool)

**Detector**: [reentrancy-vulnerabilities-2](https://github.com/crytic/slither/wiki/Detector-Documentation#reentrancy-vulnerabilities-2)

**Issue**: State variables (`poolKeys`, `poolCreatedBy`, `allPools`) were written after an external call to `poolManager.initialize()`. If `poolManager` called back into `AetherFactory`, state would be inconsistent.

**Fix**: Applied **CEI (Checks-Effects-Interactions) pattern** — state writes moved BEFORE the external call:

```solidity
// BEFORE (vulnerable):
int24 tick = poolManager.initialize(key, sqrtPriceX96);  // external call
poolKeys[poolId] = key;  // state write after call
poolCreatedBy[msg.sender][poolId] = true;
allPools.push(poolId);

// AFTER (fixed):
poolKeys[poolId] = key;  // state write BEFORE call
poolCreatedBy[msg.sender][poolId] = true;
allPools.push(poolId);
int24 tick = poolManager.initialize(key, sqrtPriceX96);  // external call after state
```

### Low Findings (Accepted)

1. **locked-ether** — `AetherRouter.receive()` has no ETH withdrawal function.  
   **Rationale**: The `receive()` prevents accidentally sent ETH from reverting. The router handles ERC-20 tokens only; ETH received is accepted but intentionally not withdrawable (minimal impact, dust amounts).

2. **uninitialized-local** — `previousCumulative` in `AetherHook.getCurrentTwap()` defaults to 0.  
   **Rationale**: This is correct behavior. When `count <= lookbackSafe`, the TWAP is simply the full cumulative price (current - 0). The variable is intentionally uninitialized to represent zero.

3. **unused-return** — `poolManager.settle()` return value ignored in Router handlers.  
   **Rationale**: `settle()` returns the amount settled, which the router doesn't need since it already knows the amounts from the `BalanceDelta`. The return value is unused by design in the Uniswap V4 unlock pattern.

### Informational Findings (Accepted)

1. **reentrancy-events** — Event emitted after external call in `AetherFactory.createPool`.  
   Safe: state is already written before the call (CEI fix).

2. **timestamp** — `block.timestamp > deadline` comparisons in Router.  
   Standard DeFi pattern for transaction deadlines. Not exploitable.

3. **naming-convention** — `_newFeeBps`, `_newTreasury` use underscore prefix.  
   Style preference consistent with the rest of the codebase.

4. **unindexed-event-address** — `TreasuryUpdated` event missing indexed parameters.  
   Minor gas optimization for off-chain indexing.

---

## Echidna / Foundry Fuzz Testing

**Run**: `forge test --match-path "test/fuzz/*" --fuzz-runs 256`  
**Date**: 2026-06-30

### Invariants Tested

| # | Invariant | Description | Status |
|---|-----------|-------------|--------|
| 1 | `invariant_protocolFee_bounded` | Protocol fee never exceeds MAX_PROTOCOL_FEE_BPS (1000 bps = 10%) | ✅ PASS (256 runs, 128K+ calls) |
| 2 | `invariant_treasury_nonzero` | Treasury is never zero address | ✅ PASS |
| 3 | `invariant_accruedFees0_nonnegative` | Accrued token0 fees are non-negative | ✅ PASS |
| 4 | `invariant_accruedFees1_nonnegative` | Accrued token1 fees are non-negative | ✅ PASS |
| 5 | `invariant_observationCount_bounded` | Observation count never exceeds 1024 (circular buffer) | ✅ PASS |
| 6 | `invariant_observationIndex_bounded` | Observation index is always < 1024 | ✅ PASS |
| 7 | `invariant_poolManager_nonzero` | PoolManager address is immutable and non-zero | ✅ PASS |

### Handler Functions (Stateful Fuzzing)

- `setProtocolFee(uint24)` — Random fee in [0, 1000]
- `setTreasury(address)` — Random non-zero address
- `withdrawFees(bytes32)` — Withdraw accrued fees for any pool
- `doSwap(bool, uint128, uint128)` — Simulate swap via afterSwap callback

---

## Test Coverage

**Run**: `forge coverage --report summary`  
**Date**: 2026-06-30

| File | Lines | Statements | Branches | Functions |
|------|-------|------------|----------|-----------|
| AetherFactory.sol | 100.00% | 100.00% | 100.00% | 100.00% |
| AetherHook.sol | 100.00% | 100.00% | 100.00% | 100.00% |
| AetherRouter.sol | 98.40% | 98.15% | 82.14% | 100.00% |
| **Total** | **95.44%** | **94.83%** | **89.47%** | **94.55%** |

- Total tests: 108 (unit + fuzz + invariant)
- All passing

---

## Manual Review Notes

### AetherHook
- **Access control**: `onlyPoolManager` modifier on `beforeSwap` / `afterSwap` callbacks
- **Admin control**: `onlyOwner` (OZ) on `setProtocolFee`, `setTreasury`, `withdrawFees`
- **TWAP**: Circular buffer (1024 observations) with overflow protection
- **Fee calculation**: `(amountIn * protocolFeeBps) / 10_000` — no overflow risk for uint256
- **Hook permissions**: Constructor validates address bits 6+7 via `Hooks.validateHookPermissions()`

### AetherRouter
- **Reentrancy protection**: OpenZeppelin `ReentrancyGuard` on all user-facing functions
- **Slippage protection**: `minAmountOut` / `maxAmountIn` parameters on all swap functions
- **Deadline checks**: `block.timestamp > deadline` on all user-facing functions
- **Callback authorization**: `unlockCallback` checks `msg.sender == poolManager`

### AetherFactory
- **Pool identity**: Deterministic via `keccak256(abi.encode(PoolKey))`
- **Duplicate prevention**: Checks `poolKeys[poolId].fee != 0` before creation
- **Token ordering**: Enforces `token0 < token1`
- **CEI pattern**: State written before external call (fixed in T9)

---

## Security Recommendations

1. **Pre-mainnet audit**: Engage a professional auditing firm before mainnet deployment
2. **Bug bounty**: Launch a bug bounty program (Immunefi or Code4rena)
3. **Monitoring**: Set up on-chain monitoring for abnormal fee accruals or TWAP deviations
4. **Emergency pause**: Consider adding a pausable mechanism for the router in case of exploit
