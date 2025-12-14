---
name: "[CRITICAL] Fix Vyper Bytecode Deployment in AetherFactory"
about: Pool creation is blocked - Missing Vyper bytecode injection
title: 'Fix AetherFactory Vyper bytecode deployment'
labels: ['critical', 'smart-contracts', 'blocker', 'production']
assignees: ''
---

## 🔴 Critical Issue: Vyper Bytecode Deployment Missing

**Priority:** P0 - BLOCKER
**Component:** Smart Contracts
**File:** `packages/contracts/src/primary/AetherFactory.sol:192`

### Problem

Pool creation will **FAIL** because AetherFactory is using a placeholder minimal proxy instead of the actual compiled Vyper bytecode for AetherPool.vy.

**Current code (line 192):**
```solidity
function getPoolBytecode() internal view returns (bytes memory bytecode) {
    // TODO: Replace with actual compiled Vyper bytecode
    // This is a placeholder - in practice, you would include the compiled
    // Vyper bytecode for AetherPool.vy here

    // For now, we'll use a minimal proxy pattern as a fallback
    bytes memory implementationBytecode = hex"3d602d80600a3d3981f3363d3d3d363d73";
    bytes memory implementationAddress = abi.encodePacked(address(this));
    bytes memory suffix = hex"5af43d82803e903d91602b57fd5bf3";

    bytecode = abi.encodePacked(implementationBytecode, implementationAddress, suffix);
}
```

### Impact

- ❌ Pool creation via factory will fail or create incorrect pools
- ❌ Cannot deploy liquidity pools on-chain
- ❌ Blocks entire DEX functionality
- ❌ Production deployment impossible

### Solution

**Step 1: Compile Vyper Pool**
```bash
cd packages/contracts
vyper --evm-version cancun src/security/AetherPool.vy -f bytecode > AetherPool.bin
```

**Step 2: Inject Bytecode**

Replace `getPoolBytecode()` function with:

```solidity
function getPoolBytecode() internal pure returns (bytes memory bytecode) {
    // Compiled Vyper bytecode for AetherPool.vy (v0.4.3, EVM: cancun)
    // Compilation date: [INSERT DATE]
    // Vyper version: 0.4.3
    // Compiler command: vyper --evm-version cancun src/security/AetherPool.vy
    bytecode = hex"[INSERT COMPILED BYTECODE HERE]";
}
```

**Step 3: Verify Bytecode**

Create test to verify pool deployment:
```solidity
function testFactoryDeploysValidPool() public {
    address pool = factory.createPool(tokenA, tokenB, fee);
    assertNotEq(pool, address(0), "Pool address should not be zero");

    // Verify pool bytecode matches expected
    bytes memory poolCode = pool.code;
    assertTrue(poolCode.length > 100, "Pool should have substantial bytecode");

    // Verify pool interface
    IAetherPool poolContract = IAetherPool(pool);
    assertEq(poolContract.token0(), tokenA, "Token0 mismatch");
    assertEq(poolContract.token1(), tokenB, "Token1 mismatch");
}
```

### Acceptance Criteria

- [ ] AetherPool.vy compiles successfully with Vyper 0.4.3
- [ ] Compiled bytecode injected into `getPoolBytecode()`
- [ ] Factory deploys pool successfully in tests
- [ ] Pool has correct token addresses and fee
- [ ] Pool swap functionality works
- [ ] TODO comment removed from code
- [ ] Bytecode compilation date and version documented

### Testing Checklist

- [ ] Unit test: Factory creates pool
- [ ] Unit test: Pool has correct bytecode length
- [ ] Unit test: Pool implements IAetherPool interface
- [ ] Integration test: Pool accepts liquidity
- [ ] Integration test: Pool executes swaps
- [ ] Gas analysis: Pool deployment cost acceptable

### Related Files

- `packages/contracts/src/primary/AetherFactory.sol` - Update line 192
- `packages/contracts/src/security/AetherPool.vy` - Source contract
- `packages/contracts/test/primary/AetherFactory.t.sol` - Add verification test

### Timeline

- **Target:** This sprint (Week 1)
- **Estimated effort:** 4-6 hours
- **Blocker for:** All pool-dependent functionality

### Additional Notes

**Why minimal proxy won't work:**
- Minimal proxy delegates to an implementation contract
- We need each pool to have its own state (reserves, liquidity)
- Proxies would share state, breaking pool isolation

**Compilation notes:**
- Use Vyper 0.4.3 (same version as development)
- EVM version: Cancun (match Solidity config)
- Optimization: Default Vyper optimization
- Include compilation metadata in comments

---

**Priority:** 🔴 CRITICAL - Production Blocker
**Labels:** `critical`, `smart-contracts`, `blocker`, `production`
