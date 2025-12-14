---
name: "[HIGH] Implement Dynamic Fee Lookup for Cross-Chain Hooks"
about: Cross-chain liquidity uses hardcoded fee parameters
title: 'Implement dynamic fee/tickSpacing lookup in CrossChainLiquidityHook'
labels: ['high-priority', 'smart-contracts', 'cross-chain', 'enhancement']
assignees: ''
---

## 🟠 High Priority: Dynamic Fee Configuration for Cross-Chain

**Priority:** P1 - HIGH
**Component:** Smart Contracts - Hooks
**File:** `packages/contracts/src/hooks/CrossChainLiquidityHook.sol:192`

### Problem

Cross-chain liquidity operations currently use hardcoded or default fee/tickSpacing parameters instead of fetching them from the actual pool configuration.

**Current code (line 192):**
```solidity
// TODO: Fee and tickSpacing should ideally come from payload or manager lookup
```

This means cross-chain liquidity might be added to pools with incorrect fee tiers, causing:
- Liquidity added to wrong price ranges
- Fee calculation mismatches
- Suboptimal capital efficiency

### Impact

- ⚠️ Cross-chain liquidity may use incorrect pool parameters
- ⚠️ Fee tier mismatches between source and destination chains
- ⚠️ Potential liquidity fragmentation
- ⚠️ User funds in suboptimal positions

### Solution Options

**Option 1: Include in Cross-Chain Payload** (Recommended)
```solidity
struct CrossChainLiquidityPayload {
    address token0;
    address token1;
    uint24 fee;           // Add fee parameter
    int24 tickSpacing;    // Add tick spacing
    uint256 amount0;
    uint256 amount1;
    address recipient;
}
```

**Option 2: Query PoolManager on Destination**
```solidity
function afterCrossChainMessage(
    bytes calldata payload
) external override {
    CrossChainLiquidityPayload memory data = abi.decode(payload, (CrossChainLiquidityPayload));

    // Query pool manager for correct fee tier
    PoolKey memory key = PoolKey({
        currency0: Currency.wrap(data.token0),
        currency1: Currency.wrap(data.token1),
        fee: 0, // Will be looked up
        tickSpacing: 0, // Will be looked up
        hooks: IHooks(address(this))
    });

    // Fetch actual pool configuration
    (uint24 fee, int24 tickSpacing) = poolManager.getPoolConfig(key);

    key.fee = fee;
    key.tickSpacing = tickSpacing;

    // Proceed with liquidity addition
    poolManager.modifyLiquidity(key, params, hookData);
}
```

**Option 3: Registry Lookup**
- Maintain fee tier registry on each chain
- Query registry for token pair → fee mapping
- Requires governance to update mappings

### Recommended Implementation

**Phase 1: Include in Payload** (Immediate)
- Add `fee` and `tickSpacing` to `CrossChainLiquidityPayload`
- Validate on source chain before sending
- Use exact values on destination chain
- **Advantage:** Explicit, no lookups needed
- **Disadvantage:** Slightly larger message payload

**Phase 2: Add Validation** (Follow-up)
- Verify fee tier exists on destination chain
- Revert if pool doesn't support specified fee
- Emit event if fee tier mismatch detected

### Implementation Steps

1. **Update Payload Struct**
```solidity
struct CrossChainLiquidityPayload {
    address token0;
    address token1;
    uint24 fee;           // NEW
    int24 tickSpacing;    // NEW
    uint256 amount0;
    uint256 amount1;
    int24 tickLower;
    int24 tickUpper;
    address recipient;
}
```

2. **Update Encoding Function**
```solidity
function encodeCrossChainPayload(
    address token0,
    address token1,
    uint24 fee,          // NEW parameter
    int24 tickSpacing,   // NEW parameter
    uint256 amount0,
    uint256 amount1,
    int24 tickLower,
    int24 tickUpper,
    address recipient
) internal pure returns (bytes memory) {
    return abi.encode(CrossChainLiquidityPayload({
        token0: token0,
        token1: token1,
        fee: fee,
        tickSpacing: tickSpacing,
        amount0: amount0,
        amount1: amount1,
        tickLower: tickLower,
        tickUpper: tickUpper,
        recipient: recipient
    }));
}
```

3. **Add Fee Validation**
```solidity
function beforeCrossChainSend(
    PoolKey calldata key,
    uint256 amount0,
    uint256 amount1
) external {
    // Validate fee tier is supported
    require(
        poolManager.isValidFee(key.fee),
        "Invalid fee tier for cross-chain liquidity"
    );

    // Encode with explicit fee/tickSpacing
    bytes memory payload = encodeCrossChainPayload(
        Currency.unwrap(key.currency0),
        Currency.unwrap(key.currency1),
        key.fee,
        key.tickSpacing,
        amount0,
        amount1,
        tickLower,
        tickUpper,
        msg.sender
    );

    // Send cross-chain message
    sendCrossChainMessage(destinationChain, payload);
}
```

4. **Update Receive Handler**
```solidity
function afterCrossChainMessage(
    bytes calldata payload
) external override {
    CrossChainLiquidityPayload memory data = abi.decode(
        payload,
        (CrossChainLiquidityPayload)
    );

    // Use exact fee/tickSpacing from payload
    PoolKey memory key = PoolKey({
        currency0: Currency.wrap(data.token0),
        currency1: Currency.wrap(data.token1),
        fee: data.fee,              // From payload
        tickSpacing: data.tickSpacing, // From payload
        hooks: IHooks(address(this))
    });

    // Validate pool exists with these parameters
    require(
        poolManager.poolExists(key),
        "Pool does not exist with specified fee tier"
    );

    // Proceed with liquidity addition
    // ...
}
```

### Acceptance Criteria

- [ ] `CrossChainLiquidityPayload` includes `fee` and `tickSpacing` fields
- [ ] Source chain validates fee tier before sending
- [ ] Destination chain uses exact fee/tickSpacing from payload
- [ ] Destination validates pool exists with specified parameters
- [ ] Unit tests for fee validation
- [ ] Integration test: Cross-chain liquidity with correct fee tier
- [ ] TODO comment removed from code
- [ ] Documentation updated

### Testing Checklist

- [ ] Unit: Payload encoding includes fee/tickSpacing
- [ ] Unit: Source validates invalid fee tier (reverts)
- [ ] Unit: Destination uses fee from payload
- [ ] Integration: Cross-chain liquidity with 0.3% fee tier
- [ ] Integration: Cross-chain liquidity with 1% fee tier
- [ ] Edge case: Destination pool doesn't exist (reverts)
- [ ] Edge case: Fee tier mismatch (reverts)

### Related Files

- `packages/contracts/src/hooks/CrossChainLiquidityHook.sol` - Update line 192
- `packages/contracts/src/interfaces/ICrossChainLiquidityHook.sol` - Update interface
- `packages/contracts/test/integration/CrossChainIntegration.t.sol` - Add tests

### Timeline

- **Target:** Sprint 2 (Week 2-3)
- **Estimated effort:** 8-12 hours
- **Dependencies:** None (can be done in parallel with other work)

### Additional Context

**Why this matters:**
- Fee tiers (0.05%, 0.3%, 1%) have different tick spacings
- Incorrect tick spacing → liquidity can't be added
- Incorrect fee → wrong price range calculations
- Critical for Uniswap V4 integration

**Alternative approaches considered:**
- ❌ Use default fee tier (0.3%) - Loses flexibility
- ❌ Query on-chain registry - Additional gas cost + complexity
- ✅ Include in payload - Explicit, gas-efficient, correct

---

**Priority:** 🟠 HIGH - Cross-Chain Accuracy
**Labels:** `high-priority`, `smart-contracts`, `cross-chain`, `enhancement`
