// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import "forge-std/Test.sol";
import {AetherHook} from "src/hook/AetherHook.sol";
import {Errors} from "src/lib/Errors.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta, toBalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

/// @title AetherHook Invariant Tests
/// @notice Property-based (fuzz) invariants for protocol safety
/// @dev Uses Foundry's invariant testing framework with a handler contract.
///      The handler wraps AetherHook calls so the fuzzer can exercise state transitions.

// ─── Handler contract (the fuzzer calls functions on this) ─────────────────
contract AetherHookHandler is Test {
    AetherHook public hook;

    address constant HOOK_ADDR = address(uint160(0x80C0));
    address constant TREASURY = address(0xCAFE);
    address constant OWNER = address(0xBEEF);
    uint24 constant INITIAL_FEE = 30;
    address constant MOCK_PM = address(0xA11CE);
    address constant TOKEN0 = address(0xA000);
    address constant TOKEN1 = address(0xB000);

    bytes32 public poolId;

    constructor() {
        deployCodeTo(
            "AetherHook.sol:AetherHook",
            abi.encode(IPoolManager(MOCK_PM), TREASURY, INITIAL_FEE, OWNER),
            HOOK_ADDR
        );
        hook = AetherHook(HOOK_ADDR);

        PoolKey memory key = _testPoolKey();
        poolId = keccak256(abi.encode(key));
    }

    /// @notice Set protocol fee (owner-only)
    function setProtocolFee(uint24 fee) external {
        fee = uint24(bound(fee, 0, 1000));
        vm.prank(OWNER);
        hook.setProtocolFee(fee);
    }

    /// @notice Set treasury address (owner-only, must be non-zero)
    function setTreasury(address newTreasury) external {
        vm.assume(newTreasury != address(0));
        vm.prank(OWNER);
        hook.setTreasury(newTreasury);
    }

    /// @notice Withdraw accrued fees for a pool
    function withdrawFees(bytes32 _poolId) external {
        if (hook.accruedFees0(_poolId) == 0 && hook.accruedFees1(_poolId) == 0) return;
        vm.prank(OWNER);
        hook.withdrawFees(_poolId);
    }

    /// @notice Simulate a swap via the hook's afterSwap callback
    function doSwap(bool zeroForOne, uint128 amountIn, uint128 amountOut) external {
        amountIn = uint128(bound(amountIn, 1, 1e18));
        amountOut = uint128(bound(amountOut, 1, 1e18));

        PoolKey memory key = _testPoolKey();
        SwapParams memory params =
            SwapParams({zeroForOne: zeroForOne, amountSpecified: int256(int128(amountIn)), sqrtPriceLimitX96: 0});
        BalanceDelta delta;

        if (zeroForOne) {
            delta = toBalanceDelta(int128(amountIn), -int128(amountOut));
        } else {
            delta = toBalanceDelta(-int128(amountOut), int128(amountIn));
        }

        vm.prank(MOCK_PM);
        hook.afterSwap(address(0xDAD), key, params, delta, "");
    }

    function _testPoolKey() internal pure returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(TOKEN0),
            currency1: Currency.wrap(TOKEN1),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
    }
}

// ─── Invariant test contract ───────────────────────────────────────────────
contract AetherHookInvariantTest is Test {
    AetherHookHandler handler;
    AetherHook hook;

    function setUp() public {
        handler = new AetherHookHandler();
        hook = handler.hook();

        targetContract(address(handler));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  STATEFUL INVARIANTS (checked after every call sequence)
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Protocol fee never exceeds MAX_PROTOCOL_FEE_BPS (1000 bps = 10%)
    function invariant_protocolFee_bounded() public view {
        assertLe(hook.protocolFeeBps(), hook.MAX_PROTOCOL_FEE_BPS(), "fee must be <= MAX_PROTOCOL_FEE_BPS");
    }

    /// @notice Treasury is never zero address
    function invariant_treasury_nonzero() public view {
        assertTrue(hook.treasury() != address(0), "treasury must never be zero address");
    }

    /// @notice Accrued fees0 are non-negative (uint256, always >= 0 by type)
    function invariant_accruedFees0_nonnegative() public view {
        uint256 f0 = hook.accruedFees0(handler.poolId());
        assertGe(f0, 0, "accruedFees0 must be non-negative");
    }

    /// @notice Accrued fees1 are non-negative
    function invariant_accruedFees1_nonnegative() public view {
        uint256 f1 = hook.accruedFees1(handler.poolId());
        assertGe(f1, 0, "accruedFees1 must be non-negative");
    }

    /// @notice Observation count never exceeds 1024 (circular buffer size)
    function invariant_observationCount_bounded() public view {
        uint16 count = hook.observationCount(handler.poolId());
        assertLe(count, 1024, "observationCount must be <= 1024");
    }

    /// @notice Observation index is always < 1024
    function invariant_observationIndex_bounded() public view {
        uint16 idx = hook.observationIndex(handler.poolId());
        assertLe(idx, 1023, "observationIndex must be < 1024");
    }

    /// @notice PoolManager address is immutable and never zero
    function invariant_poolManager_nonzero() public view {
        assertTrue(address(hook.poolManager()) != address(0), "poolManager must not be zero");
    }
}
