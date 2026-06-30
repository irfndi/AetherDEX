// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import "forge-std/Test.sol";
import {AetherFactory} from "src/factory/AetherFactory.sol";
import {IAetherFactory} from "src/interfaces/IAetherFactory.sol";
import {Errors} from "src/lib/Errors.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";

/// @title AetherFactory Unit Tests
/// @notice Tests for AetherFactory — pool creation, validation, deterministic poolId
contract AetherFactoryTest is Test {
    AetherFactory factory;
    MockPoolManager mockPM;
    address constant HOOK = address(0x80C0);

    // Sorted: TOKEN_A < TOKEN_B
    address constant TOKEN_A = address(0xA000);
    address constant TOKEN_B = address(0xB000);

    uint160 constant INITIAL_SQRT_PRICE = 79228162514264337593543950336; // ≈ price of 1

    event PoolCreated(
        bytes32 indexed poolId,
        address indexed creator,
        address indexed token0,
        address token1,
        uint24 fee,
        int24 tickSpacing,
        uint160 sqrtPriceX96,
        int24 tick
    );

    function setUp() public {
        mockPM = new MockPoolManager();
        factory = new AetherFactory(IPoolManager(address(mockPM)), IHooks(HOOK), address(this));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════════

    function test_constructor_setsCorrectValues() public view {
        assertEq(address(factory.poolManager()), address(mockPM));
        assertEq(address(factory.hook()), HOOK);
        assertEq(factory.owner(), address(this));
    }

    function test_constructor_revertsZeroPoolManager() public {
        vm.expectRevert(Errors.ZeroAddress.selector);
        new AetherFactory(IPoolManager(address(0)), IHooks(HOOK), address(this));
    }

    function test_constructor_revertsZeroHook() public {
        vm.expectRevert(Errors.ZeroAddress.selector);
        new AetherFactory(IPoolManager(address(mockPM)), IHooks(address(0)), address(this));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  CREATE POOL — HAPPY PATH
    // ═══════════════════════════════════════════════════════════════════════════

    function test_createPool_succeeds() public {
        PoolKey memory expectedKey = _testPoolKey();
        bytes32 expectedId = keccak256(abi.encode(expectedKey));

        bytes32 actualId = factory.createPool(TOKEN_A, TOKEN_B, 3000, 60, INITIAL_SQRT_PRICE);

        assertEq(actualId, expectedId, "PoolId should be deterministic keccak256(PoolKey)");
    }

    function test_createPool_emitsEvent() public {
        PoolKey memory key = _testPoolKey();
        bytes32 poolId = keccak256(abi.encode(key));

        vm.expectEmit(true, true, true, true);
        emit PoolCreated(poolId, address(this), TOKEN_A, TOKEN_B, 3000, 60, INITIAL_SQRT_PRICE, 0);

        factory.createPool(TOKEN_A, TOKEN_B, 3000, 60, INITIAL_SQRT_PRICE);
    }

    function test_createPool_storesPoolKey() public {
        bytes32 id = factory.createPool(TOKEN_A, TOKEN_B, 3000, 60, INITIAL_SQRT_PRICE);

        PoolKey memory key = factory.getPool(id);
        assertEq(Currency.unwrap(key.currency0), TOKEN_A);
        assertEq(Currency.unwrap(key.currency1), TOKEN_B);
        assertEq(key.fee, 3000);
        assertEq(key.tickSpacing, 60);
        assertEq(address(key.hooks), HOOK);
    }

    function test_createPool_storesCreator() public {
        bytes32 id = factory.createPool(TOKEN_A, TOKEN_B, 3000, 60, INITIAL_SQRT_PRICE);

        assertTrue(factory.poolCreatedBy(address(this), id), "Creator should be tracked");
    }

    function test_createPool_addsToAllPools() public {
        assertEq(factory.poolCount(), 0);

        factory.createPool(TOKEN_A, TOKEN_B, 3000, 60, INITIAL_SQRT_PRICE);

        assertEq(factory.poolCount(), 1);
        assertEq(factory.getPoolAt(0).fee, 3000);
    }

    function test_createPool_multiplePools() public {
        factory.createPool(TOKEN_A, TOKEN_B, 3000, 60, INITIAL_SQRT_PRICE);

        address TOKEN_C = address(0xC000);
        factory.createPool(TOKEN_A, TOKEN_C, 500, 10, INITIAL_SQRT_PRICE);

        assertEq(factory.poolCount(), 2);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  CREATE POOL — VALIDATION
    // ═══════════════════════════════════════════════════════════════════════════

    function test_createPool_revertsSameToken() public {
        vm.expectRevert(Errors.InvalidPair.selector);
        factory.createPool(TOKEN_A, TOKEN_A, 3000, 60, INITIAL_SQRT_PRICE);
    }

    function test_createPool_revertsUnsortedTokens() public {
        vm.expectRevert(Errors.InvalidPair.selector);
        factory.createPool(TOKEN_B, TOKEN_A, 3000, 60, INITIAL_SQRT_PRICE);
    }

    function test_createPool_revertsZeroPrice() public {
        vm.expectRevert(Errors.ZeroAmount.selector);
        factory.createPool(TOKEN_A, TOKEN_B, 3000, 60, 0);
    }

    function test_createPool_revertsZeroFee() public {
        vm.expectRevert(Errors.InvalidFee.selector);
        factory.createPool(TOKEN_A, TOKEN_B, 0, 60, INITIAL_SQRT_PRICE);
    }

    function test_createPool_revertsDuplicate() public {
        factory.createPool(TOKEN_A, TOKEN_B, 3000, 60, INITIAL_SQRT_PRICE);

        vm.expectRevert(Errors.PoolAlreadyExists.selector);
        factory.createPool(TOKEN_A, TOKEN_B, 3000, 60, INITIAL_SQRT_PRICE);
    }

    function test_createPool_differentFeeSucceeds() public {
        // Same tokens but different fee tier → different PoolKey → different poolId
        factory.createPool(TOKEN_A, TOKEN_B, 3000, 60, INITIAL_SQRT_PRICE);
        factory.createPool(TOKEN_A, TOKEN_B, 10000, 200, INITIAL_SQRT_PRICE);

        assertEq(factory.poolCount(), 2, "Different fee tiers should create different pools");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  GET POOL
    // ═══════════════════════════════════════════════════════════════════════════

    function test_getPool_revertsForNonexistent() public {
        vm.expectRevert(Errors.PoolNotFound.selector);
        factory.getPool(bytes32("nonexistent"));
    }

    function test_getPool_revertsForZeroFeeKey() public {
        // A key with fee=0 is not a valid pool (fee is 0 by default for uninitialized mapping)
        vm.expectRevert(Errors.PoolNotFound.selector);
        factory.getPool(bytes32(0));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  GET POOL AT
    // ═══════════════════════════════════════════════════════════════════════════

    function test_getPoolAt_succeeds() public {
        factory.createPool(TOKEN_A, TOKEN_B, 3000, 60, INITIAL_SQRT_PRICE);

        PoolKey memory key = factory.getPoolAt(0);
        assertEq(Currency.unwrap(key.currency0), TOKEN_A);
        assertEq(key.fee, 3000);
    }

    function test_getPoolAt_revertsOutOfBounds() public {
        vm.expectRevert(Errors.PoolIndexOutOfBounds.selector);
        factory.getPoolAt(0);
    }

    function test_getPoolAt_revertsBeyondLength() public {
        factory.createPool(TOKEN_A, TOKEN_B, 3000, 60, INITIAL_SQRT_PRICE);

        vm.expectRevert(Errors.PoolIndexOutOfBounds.selector);
        factory.getPoolAt(1);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  POOL COUNT
    // ═══════════════════════════════════════════════════════════════════════════

    function test_poolCount_startsZero() public view {
        assertEq(factory.poolCount(), 0);
    }

    function test_poolCount_incrementsOnCreate() public {
        factory.createPool(TOKEN_A, TOKEN_B, 3000, 60, INITIAL_SQRT_PRICE);
        assertEq(factory.poolCount(), 1);

        factory.createPool(TOKEN_A, TOKEN_B, 10000, 200, INITIAL_SQRT_PRICE);
        assertEq(factory.poolCount(), 2);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  DETERMINISTIC POOL ID
    // ═══════════════════════════════════════════════════════════════════════════

    function test_deterministicPoolId() public {
        PoolKey memory key = _testPoolKey();
        bytes32 expectedId = keccak256(abi.encode(key));

        bytes32 id1 = factory.createPool(TOKEN_A, TOKEN_B, 3000, 60, INITIAL_SQRT_PRICE);

        // Compute what a second call would produce (same params)
        bytes32 wouldBeId = keccak256(abi.encode(key));

        assertEq(id1, expectedId, "PoolId should be deterministic");
        assertEq(id1, wouldBeId, "Same params should produce same id");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  HELPERS
    // ═══════════════════════════════════════════════════════════════════════════

    function _testPoolKey() internal view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(TOKEN_A),
            currency1: Currency.wrap(TOKEN_B),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(HOOK)
        });
    }
}

/// @notice Mock PoolManager for factory tests — only implements initialize
contract MockPoolManager {
    int24 public lastTick;

    function initialize(PoolKey memory, uint160) external returns (int24) {
        lastTick = 0;
        return 0;
    }
}
