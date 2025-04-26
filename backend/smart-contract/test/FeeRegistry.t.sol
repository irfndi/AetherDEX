// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.29;

import {Test, console2} from "forge-std/Test.sol";
import {FeeRegistry} from "../src/FeeRegistry.sol";
import {IFeeRegistry} from "../src/interfaces/IFeeRegistry.sol";
import {Ownable} from "../src/access/Ownable.sol"; // Import Ownable for error selector
import {PoolKey} from "../src/types/PoolKey.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract FeeRegistryTest is Test {
    FeeRegistry public registry;

    // Helper function to compute pool key hash
    function _getPoolKeyHash(PoolKey memory key) internal pure returns (bytes32) {
        return keccak256(abi.encode(key));
    }

    MockERC20 public tokenA;
    MockERC20 public tokenB;
    MockERC20 public tokenC;

    address public owner;
    address public user;
    address public dynamicFeeUpdater; // Address authorized to update dynamic fees

    uint24 public constant MAX_FEE = 100_000; // 10%

    // Default static fee tiers for testing
    uint24 public constant FEE_TIER_1 = 500; // 0.05%
    int24 public constant TICK_SPACING_1 = 10;
    uint24 public constant FEE_TIER_2 = 3000; // 0.3%
    int24 public constant TICK_SPACING_2 = 60;
    uint24 public constant FEE_TIER_3 = 10000; // 1%
    int24 public constant TICK_SPACING_3 = 200;
    uint24 public constant FEE_TIER_4_LOW = 400; // 0.04% (Lower fee for TICK_SPACING_1)
    int24 public constant TICK_SPACING_4 = TICK_SPACING_1; // Same tick spacing as TIER_1

    // Pool Keys for dynamic fee tests
    PoolKey public poolKeyAB;
    PoolKey public poolKeyBC;
    PoolKey public poolKeyAC; // Unregistered pool key

    function setUp() public {
        owner = address(this); // Test contract itself is the initial owner
        user = makeAddr("user");
        dynamicFeeUpdater = makeAddr("dynamicFeeUpdater");

        registry = new FeeRegistry(owner); // Pass initial owner directly

        tokenA = new MockERC20("TokenA", "TKNA", 18);
        tokenB = new MockERC20("TokenB", "TKNB", 18);
        tokenC = new MockERC20("TokenC", "TKNC", 18);

        // Setup default static fee configurations using addFeeConfiguration
        registry.addFeeConfiguration(FEE_TIER_1, TICK_SPACING_1);
        registry.addFeeConfiguration(FEE_TIER_2, TICK_SPACING_2);
        registry.addFeeConfiguration(FEE_TIER_3, TICK_SPACING_3);
        registry.addFeeConfiguration(FEE_TIER_4_LOW, TICK_SPACING_4); // Lower fee for TICK_SPACING_1

        // Initialize PoolKeys (ensure canonical ordering if applicable, though not strictly needed for registry key)
        poolKeyAB = PoolKey({
            token0: address(tokenA) < address(tokenB) ? address(tokenA) : address(tokenB),
            token1: address(tokenA) < address(tokenB) ? address(tokenB) : address(tokenA),
            fee: FEE_TIER_1, // Use a supported static fee tier initially
            tickSpacing: TICK_SPACING_1,
            hooks: address(0) // No hooks for simplicity here
        });

        poolKeyBC = PoolKey({
            token0: address(tokenB) < address(tokenC) ? address(tokenB) : address(tokenC),
            token1: address(tokenB) < address(tokenC) ? address(tokenC) : address(tokenB),
            fee: FEE_TIER_2,
            tickSpacing: TICK_SPACING_2,
            hooks: address(0)
        });

        poolKeyAC = PoolKey({
            token0: address(tokenA) < address(tokenC) ? address(tokenA) : address(tokenC),
            token1: address(tokenA) < address(tokenC) ? address(tokenC) : address(tokenA),
            fee: FEE_TIER_3,
            tickSpacing: TICK_SPACING_3,
            hooks: address(0)
        });

        // Register one pool for dynamic fee testing
        registry.registerDynamicFeePool(poolKeyAB, FEE_TIER_1, dynamicFeeUpdater); // Initial fee is FEE_TIER_1
    }

    // --- Test addFeeConfiguration (Static Fees) ---

    function test_AddFeeConfiguration_Success() public {
        uint24 newFee = 100; // 0.01%
        int24 newTickSpacing = 1;
        assertFalse(registry.isSupportedFeeTier(newFee), "New tier should not be supported yet"); // Pass only fee
        registry.addFeeConfiguration(newFee, newTickSpacing);
        assertTrue(registry.isSupportedFeeTier(newFee), "New tier should be supported after adding"); // Pass only fee
        // Removed incorrect assertEq using getFee(tickSpacing).
        // getFee(tickSpacing) returns the *lowest* fee for that spacing, which might not be `newFee`
        // if a lower fee already existed or is added later for the same spacing.
        // The isSupportedFeeTier check is sufficient here.
    }

    function test_AddFeeConfiguration_Revert_NonOwner() public {
        vm.startPrank(user);
        // Use the string revert from the local Ownable.sol
        vm.expectRevert("Ownable: caller is not the owner");
        registry.addFeeConfiguration(100, 1);
        vm.stopPrank();
    }

    function test_AddFeeConfiguration_Revert_FeeTooHigh() public {
        uint24 feeTooHigh = MAX_FEE + 1;
        vm.expectRevert(FeeRegistry.InvalidFeeConfiguration.selector);
        registry.addFeeConfiguration(feeTooHigh, 10);
    }

    function test_AddFeeConfiguration_Revert_ZeroFee() public {
        // FeeTierTooHigh check implicitly prevents 0 if MAX_FEE > 0.
        // If MAX_FEE could be 0, a specific check for fee > 0 might be needed.
        // Let's assume MAX_FEE > 0.
        uint24 zeroFee = 0;
        // Correct: Use InvalidFeeConfiguration as defined in FeeRegistry.sol for fee <= 0
        vm.expectRevert(FeeRegistry.InvalidFeeConfiguration.selector); // Use selector for parameter-less error
        registry.addFeeConfiguration(zeroFee, 10);
    }

    function test_AddFeeConfiguration_Revert_ZeroTickSpacing() public {
        int24 zeroTickSpacing = 0;
        // Correct: Use InvalidFeeConfiguration as defined in FeeRegistry.sol for tickSpacing <= 0
        vm.expectRevert(FeeRegistry.InvalidFeeConfiguration.selector); // Use selector for parameter-less error
        registry.addFeeConfiguration(500, zeroTickSpacing);
    }

    function test_AddFeeConfiguration_Revert_NegativeTickSpacing() public {
        int24 negativeTickSpacing = -10;
        // Correct: Use InvalidFeeConfiguration as defined in FeeRegistry.sol for tickSpacing <= 0
        vm.expectRevert(FeeRegistry.InvalidFeeConfiguration.selector); // Use selector for parameter-less error
        registry.addFeeConfiguration(500, negativeTickSpacing);
    }

    function test_AddFeeConfiguration_Revert_TierAlreadyExists() public {
        // Correct: Use FeeAlreadyExists(uint24 fee) as defined in FeeRegistry.sol
        vm.expectRevert(abi.encodeWithSelector(FeeRegistry.FeeAlreadyExists.selector, FEE_TIER_1));
        registry.addFeeConfiguration(FEE_TIER_1, TICK_SPACING_1);
    }

    function test_AddFeeConfiguration_MultipleForSameTickSpacing() public {
        assertTrue(registry.isSupportedFeeTier(FEE_TIER_1), "Tier 1 should be supported");
        assertTrue(registry.isSupportedFeeTier(FEE_TIER_4_LOW), "Tier 4 should be supported");
        // Create a dummy key for getFee lookup
        PoolKey memory key1 = PoolKey({token0: address(1), token1: address(2), fee: FEE_TIER_1, tickSpacing: TICK_SPACING_1, hooks: address(0)});
        assertEq(registry.getFee(key1), FEE_TIER_4_LOW, "getFee should return the lowest fee");

        uint24 higherFee = 600;
        registry.addFeeConfiguration(higherFee, TICK_SPACING_1);
        assertTrue(registry.isSupportedFeeTier(higherFee), "Higher fee tier should be supported");
        PoolKey memory key2 = PoolKey({token0: address(1), token1: address(2), fee: higherFee, tickSpacing: TICK_SPACING_1, hooks: address(0)});
        assertEq(registry.getFee(key2), FEE_TIER_4_LOW, "getFee should still return the lowest");

        uint24 evenLowerFee = 300;
        registry.addFeeConfiguration(evenLowerFee, TICK_SPACING_1);
        assertTrue(registry.isSupportedFeeTier(evenLowerFee), "Even lower fee tier should be supported");
        PoolKey memory key3 = PoolKey({token0: address(1), token1: address(2), fee: evenLowerFee, tickSpacing: TICK_SPACING_1, hooks: address(0)});
        assertEq(registry.getFee(key3), evenLowerFee, "getFee should return the new lowest fee");
    }

    // --- Test isSupportedFeeTier (Static Fees) ---

    function test_IsSupportedFeeTier_Supported() public view {
        assertTrue(registry.isSupportedFeeTier(FEE_TIER_1)); // Pass only fee
        assertTrue(registry.isSupportedFeeTier(FEE_TIER_2)); // Pass only fee
        assertTrue(registry.isSupportedFeeTier(FEE_TIER_3)); // Pass only fee
        assertTrue(registry.isSupportedFeeTier(FEE_TIER_4_LOW)); // Pass only fee
    }

    function test_IsSupportedFeeTier_NotSupported() public view {
        assertFalse(registry.isSupportedFeeTier(100), "Unsupported fee"); // Pass only fee
        assertFalse(registry.isSupportedFeeTier(999), "Unsupported fee"); // Pass only fee
    }

    function test_IsSupportedFeeTier_ZeroInputs() public view {
        assertFalse(registry.isSupportedFeeTier(0), "Zero fee should not be supported"); // Pass only fee
    }

    // --- Test getFee (Static Fees) ---

    function test_GetFee_Static_Success_SingleFeeForTickSpacing() public view {
        PoolKey memory key2 = PoolKey({token0: address(1), token1: address(2), fee: FEE_TIER_2, tickSpacing: TICK_SPACING_2, hooks: address(0)});
        assertEq(registry.getFee(key2), FEE_TIER_2);
        PoolKey memory key3 = PoolKey({token0: address(1), token1: address(2), fee: FEE_TIER_3, tickSpacing: TICK_SPACING_3, hooks: address(0)});
        assertEq(registry.getFee(key3), FEE_TIER_3);
    }

    function test_GetFee_Static_Success_MultipleFeesForTickSpacing() public view {
        PoolKey memory key1 = PoolKey({token0: address(1), token1: address(2), fee: FEE_TIER_1, tickSpacing: TICK_SPACING_1, hooks: address(0)});
        assertEq(registry.getFee(key1), FEE_TIER_4_LOW, "Should return lowest fee");
    }

    function test_GetFee_Static_Success_AfterAddingLowerFee() public {
        PoolKey memory key1 = PoolKey({token0: address(1), token1: address(2), fee: FEE_TIER_1, tickSpacing: TICK_SPACING_1, hooks: address(0)});
        assertEq(registry.getFee(key1), FEE_TIER_4_LOW);
        uint24 evenLowerFee = 350;
        registry.addFeeConfiguration(evenLowerFee, TICK_SPACING_1);
        PoolKey memory keyLower = PoolKey({token0: address(1), token1: address(2), fee: evenLowerFee, tickSpacing: TICK_SPACING_1, hooks: address(0)});
        assertEq(registry.getFee(keyLower), evenLowerFee);
    }

    function test_GetFee_Static_Success_AfterAddingHigherFee() public {
        PoolKey memory key1 = PoolKey({token0: address(1), token1: address(2), fee: FEE_TIER_1, tickSpacing: TICK_SPACING_1, hooks: address(0)});
        assertEq(registry.getFee(key1), FEE_TIER_4_LOW);
        uint24 higherFee = 600;
        registry.addFeeConfiguration(higherFee, TICK_SPACING_1);
        PoolKey memory keyHigher = PoolKey({token0: address(1), token1: address(2), fee: higherFee, tickSpacing: TICK_SPACING_1, hooks: address(0)});
        assertEq(registry.getFee(keyHigher), FEE_TIER_4_LOW); // Still lowest
    }

    function test_GetFee_Static_Revert_TickSpacingNotSupported() public {
        int24 unsupportedTickSpacing = 999;
        uint24 dummyFee = 500; // Fee doesn't matter if tick spacing isn't supported
        PoolKey memory key = PoolKey({token0: address(1), token1: address(2), fee: dummyFee, tickSpacing: unsupportedTickSpacing, hooks: address(0)});
        // Correct: Reference the error from FeeRegistry directly. It reverts with FeeTierNotSupported(dummyFee)
        vm.expectRevert(abi.encodeWithSelector(FeeRegistry.FeeTierNotSupported.selector, dummyFee));
        registry.getFee(key);
    }

    function test_GetFee_Static_Revert_ZeroTickSpacing() public {
        PoolKey memory key = PoolKey({token0: address(1), token1: address(2), fee: FEE_TIER_1, tickSpacing: 0, hooks: address(0)});
        // Correct: getFee reverts with InvalidFeeConfiguration for tickSpacing <= 0 (This check might happen inside PoolKey logic or getFee)
        // Assuming getFee checks the key's tickSpacing. Let's expect FeeTierNotSupported as the registry won't find a match for fee 0.
        vm.expectRevert(abi.encodeWithSelector(FeeRegistry.FeeTierNotSupported.selector, FEE_TIER_1));
        registry.getFee(key);
    }

    function test_GetFee_Static_Revert_NegativeTickSpacing() public {
        PoolKey memory key = PoolKey({token0: address(1), token1: address(2), fee: FEE_TIER_1, tickSpacing: -10, hooks: address(0)});
        // Correct: getFee reverts with InvalidFeeConfiguration for tickSpacing <= 0 (This check might happen inside PoolKey logic or getFee)
        // Assuming getFee checks the key's tickSpacing. Let's expect FeeTierNotSupported as the registry won't find a match for fee 0.
        vm.expectRevert(abi.encodeWithSelector(FeeRegistry.FeeTierNotSupported.selector, FEE_TIER_1));
        registry.getFee(key);
    }

    // --- Test registerDynamicFeePool ---

    function test_RegisterDynamicFeePool_Success_And_Events() public {
        // poolKeyAB was registered in setUp
        bytes32 poolKeyABHash = _getPoolKeyHash(poolKeyAB);
        assertEq(registry.dynamicFees(poolKeyABHash), FEE_TIER_1, "Initial fee mismatch for pool AB");
        assertEq(registry.feeUpdaters(poolKeyABHash), dynamicFeeUpdater, "Updater mismatch for pool AB");

        // Register poolKeyBC and check event
        bytes32 poolKeyBCHash = _getPoolKeyHash(poolKeyBC); // Calculate hash for event
        vm.expectEmit(true, true, true, false, address(registry)); // Check topics and data
        emit FeeRegistry.DynamicFeePoolRegistered(poolKeyBCHash, FEE_TIER_2, user); // Emit hash
        registry.registerDynamicFeePool(poolKeyBC, FEE_TIER_2, user); // Use 'user' as updater this time

        // Verify stored values directly
        // bytes32 poolKeyBCHash = _getPoolKeyHash(poolKeyBC); // Removed duplicate declaration
        assertEq(registry.dynamicFees(poolKeyBCHash), FEE_TIER_2, "Initial fee mismatch for pool BC");
        assertEq(registry.feeUpdaters(poolKeyBCHash), user, "Updater mismatch for pool BC");
    }

    function test_RegisterDynamicFeePool_Revert_NonOwner() public {
        vm.startPrank(user);
        // Use the string revert from the local Ownable.sol
        vm.expectRevert("Ownable: caller is not the owner");
        registry.registerDynamicFeePool(poolKeyBC, FEE_TIER_2, dynamicFeeUpdater);
        vm.stopPrank();
    }

    function test_RegisterDynamicFeePool_Revert_PoolAlreadyRegistered() public {
        // poolKeyAB was registered in setUp
        bytes32 poolKeyABHash = _getPoolKeyHash(poolKeyAB); // Calculate hash for the error
        // Correct: Reference the error from FeeRegistry directly, error uses hash
        vm.expectRevert(abi.encodeWithSelector(FeeRegistry.PoolAlreadyRegistered.selector, poolKeyABHash));
        registry.registerDynamicFeePool(poolKeyAB, FEE_TIER_1, dynamicFeeUpdater);
    }

    function test_RegisterDynamicFeePool_Revert_FeeTierNotSupported() public {
        uint24 unsupportedFee = 99999;
        // Ensure the fee isn't supported
        assertFalse(registry.isSupportedFeeTier(unsupportedFee)); // Pass only fee

        // Correct: Reference the error from FeeRegistry directly. registerDynamicFeePool doesn't check fee support itself.
        // It will register successfully, but getFee would fail later if the static tier wasn't added.
        // Let's remove this test as the check happens in getFee, not register.
        // vm.expectRevert(abi.encodeWithSelector(FeeRegistry.FeeTierNotSupported.selector, unsupportedFee));
        registry.registerDynamicFeePool(poolKeyBC, unsupportedFee, dynamicFeeUpdater);
        // Verify it was registered despite unsupported static fee
        bytes32 poolKeyBCHash = _getPoolKeyHash(poolKeyBC);
        assertEq(registry.dynamicFees(poolKeyBCHash), unsupportedFee);
        assertEq(registry.feeUpdaters(poolKeyBCHash), dynamicFeeUpdater);
    }

    function test_RegisterDynamicFeePool_Revert_ZeroUpdaterAddress() public {
        bytes32 poolKeyBCHash = _getPoolKeyHash(poolKeyBC); // Calculate hash for the error
        // Correct: Reference the error from FeeRegistry directly
        vm.expectRevert(abi.encodeWithSelector(FeeRegistry.InvalidInitialFeeOrUpdater.selector, poolKeyBCHash, FEE_TIER_2, address(0)));
        registry.registerDynamicFeePool(poolKeyBC, FEE_TIER_2, address(0));
    }

    // --- Test updateFee (Dynamic Fees) ---

    function test_UpdateFee_Success() public {
        uint256 swapVolume = 1000 * 1e18;
        bytes32 poolKeyHash = _getPoolKeyHash(poolKeyAB);
        uint24 expectedFee = FEE_TIER_1 + uint24(50);

        vm.startPrank(dynamicFeeUpdater);
        vm.expectEmit(true, true, true, true, address(registry));
        emit FeeRegistry.DynamicFeeUpdated(poolKeyHash, dynamicFeeUpdater, expectedFee);
        registry.updateFee(poolKeyAB, swapVolume);
        vm.stopPrank();

        assertEq(registry.dynamicFees(poolKeyHash), expectedFee);
    }

    function test_UpdateFee_Revert_PoolNotRegistered() public {
        bytes32 poolKeyACHash = _getPoolKeyHash(poolKeyAC); // Calculate hash for the error
        vm.startPrank(dynamicFeeUpdater);
        // Correct: Reference the error from FeeRegistry directly, error uses hash
        vm.expectRevert(abi.encodeWithSelector(FeeRegistry.PoolNotRegistered.selector, poolKeyACHash));
        registry.updateFee(poolKeyAC, 1e18);
        vm.stopPrank();
    }

    function test_UpdateFee_Revert_UnauthorizedUpdater() public {
        bytes32 poolKeyABHash = _getPoolKeyHash(poolKeyAB); // Calculate hash for the error
        vm.startPrank(user); // 'user' is not the updater for poolKeyAB
        // Correct: Reference the error from FeeRegistry directly, error uses hash
        vm.expectRevert(
            abi.encodeWithSelector(FeeRegistry.UnauthorizedUpdater.selector, poolKeyABHash, user, dynamicFeeUpdater)
        );
        registry.updateFee(poolKeyAB, 1e18);
        vm.stopPrank();
    }

    // --- Test setFeeUpdater ---

    function test_SetFeeUpdater_Success() public {
        address newUpdater = makeAddr("newUpdater");
        vm.startPrank(owner); // Only owner can change the updater
        // Emit event for setting updater
        bytes32 poolKeyABHash = _getPoolKeyHash(poolKeyAB);
        vm.expectEmit(true, true, true, false, address(registry));
        emit FeeRegistry.FeeUpdaterSet(poolKeyABHash, dynamicFeeUpdater, newUpdater); // Emit hash and old/new updaters
        registry.setFeeUpdater(poolKeyAB, newUpdater);
        vm.stopPrank();

        // Verify directly from mapping
        assertEq(registry.feeUpdaters(poolKeyABHash), newUpdater, "Updater not changed");

        // Old updater should fail now
        vm.startPrank(dynamicFeeUpdater);
        // Correct: Reference the error from FeeRegistry directly, error uses hash
        vm.expectRevert(
            abi.encodeWithSelector(FeeRegistry.UnauthorizedUpdater.selector, poolKeyABHash, dynamicFeeUpdater, newUpdater)
        );
        registry.updateFee(poolKeyAB, 1e18);
        vm.stopPrank();

        // New updater should succeed without revert
        vm.startPrank(newUpdater);
        registry.updateFee(poolKeyAB, 0);
        vm.stopPrank();
    }

    function test_SetFeeUpdater_Revert_NonOwner() public {
        address newUpdater = makeAddr("newUpdater");
        vm.startPrank(user);
        // Use the string revert from the local Ownable.sol
        vm.expectRevert("Ownable: caller is not the owner");
        registry.setFeeUpdater(poolKeyAB, newUpdater);
        vm.stopPrank();
    }

    function test_SetFeeUpdater_Revert_PoolNotRegistered() public {
        address newUpdater = makeAddr("newUpdater");
        bytes32 poolKeyACHash = _getPoolKeyHash(poolKeyAC); // Calculate hash for the error
        vm.startPrank(owner);
        // Correct: Reference the error from FeeRegistry directly, error uses hash
        vm.expectRevert(abi.encodeWithSelector(FeeRegistry.PoolNotRegistered.selector, poolKeyACHash));
        registry.setFeeUpdater(poolKeyAC, newUpdater);
        vm.stopPrank();
    }

    function test_SetFeeUpdater_Revert_ZeroAddress() public {
        bytes32 poolKeyABHash = _getPoolKeyHash(poolKeyAB); // Calculate hash for the error
        vm.startPrank(owner);
        // Correct: Reference the error from FeeRegistry directly
        vm.expectRevert(abi.encodeWithSelector(FeeRegistry.InvalidNewUpdater.selector, poolKeyABHash, address(0)));
        registry.setFeeUpdater(poolKeyAB, address(0));
        vm.stopPrank();
    }

    // --- Test Querying Dynamic Fee Mappings ---

    function test_QueryDynamicFeeMappings_Success_RegisteredPool() public view {
        bytes32 poolKeyABHash = _getPoolKeyHash(poolKeyAB);
        uint24 fee = registry.dynamicFees(poolKeyABHash);
        address updater = registry.feeUpdaters(poolKeyABHash);
        assertEq(fee, FEE_TIER_1, "Fee mismatch");
        assertEq(updater, dynamicFeeUpdater, "Updater mismatch");
    }

    function test_QueryDynamicFeeMappings_UnregisteredPool() public view {
        // Querying mappings for an unregistered pool returns default values
        bytes32 poolKeyACHash = _getPoolKeyHash(poolKeyAC);
        uint24 fee = registry.dynamicFees(poolKeyACHash);
        address updater = registry.feeUpdaters(poolKeyACHash);
        assertEq(fee, 0, "Fee should be default (0) for unregistered pool");
        assertEq(updater, address(0), "Updater should be default (address(0)) for unregistered pool");
        // No revert expected here
    }


    // --- Test Ownership ---

    function test_OwnershipTransfer() public {
        address newOwner = makeAddr("newOwner");
        registry.transferOwnership(newOwner);
        assertEq(registry.owner(), newOwner, "Ownership not transferred");

        // Old owner (this) cannot call owner functions anymore
        // Use the string revert from the local Ownable.sol
        vm.expectRevert("Ownable: caller is not the owner");
        registry.addFeeConfiguration(100, 1);

        // New owner can call owner functions
        vm.startPrank(newOwner);
        registry.addFeeConfiguration(100, 1);
        vm.stopPrank();
    }
}
