// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.29;

import {Test, console2} from "forge-std/Test.sol";
import {FeeRegistry} from "../src/primary/FeeRegistry.sol";
import {IFeeRegistry} from "../src/interfaces/IFeeRegistry.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol"; // Import OpenZeppelin's Ownable to match FeeRegistry
import {PoolKey} from "../lib/v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
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

        registry = new FeeRegistry(owner, address(this), 500); // Pass initial owner, treasury, and 5% protocol fee

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
            currency0: Currency.wrap(address(tokenA) < address(tokenB) ? address(tokenA) : address(tokenB)),
            currency1: Currency.wrap(address(tokenA) < address(tokenB) ? address(tokenB) : address(tokenA)),
            fee: FEE_TIER_1, // Use a supported static fee tier initially
            tickSpacing: TICK_SPACING_1,
            hooks: IHooks(address(0)) // No hooks for simplicity here
        });

        poolKeyBC = PoolKey({
            currency0: Currency.wrap(address(tokenB) < address(tokenC) ? address(tokenB) : address(tokenC)),
            currency1: Currency.wrap(address(tokenB) < address(tokenC) ? address(tokenC) : address(tokenB)),
            fee: FEE_TIER_2,
            tickSpacing: TICK_SPACING_2,
            hooks: IHooks(address(0))
        });

        poolKeyAC = PoolKey({
            currency0: Currency.wrap(address(tokenA) < address(tokenC) ? address(tokenA) : address(tokenC)),
            currency1: Currency.wrap(address(tokenA) < address(tokenC) ? address(tokenC) : address(tokenA)),
            fee: FEE_TIER_3,
            tickSpacing: TICK_SPACING_3,
            hooks: IHooks(address(0))
        });

        // Register one pool for dynamic fee testing
        registry.registerDynamicFeePool(poolKeyAB, FEE_TIER_1, dynamicFeeUpdater); // Initial fee is FEE_TIER_1
    }

    // --- Test addFeeConfiguration (Static Fees) ---

    function test_AddFeeConfiguration_Success() public {
        uint24 newFee = 100; // 0.01%
        int24 newTickSpacing = 1;

        // Use the addedFeeTier event to test event properties
        vm.expectEmit(true, true, true, true);
        emit FeeRegistry.FeeConfigurationAdded(newFee, newTickSpacing);
        registry.addFeeConfiguration(newFee, newTickSpacing);

        // Basic validation that the fee configuration was added
        assertTrue(registry.isSupportedFeeTier(newFee), "Fee tier should be supported after adding");
        assertEq(registry.getTickSpacing(newFee), newTickSpacing, "Tick spacing mismatch");
    }

    function test_AddFeeConfiguration_Revert_NonOwner() public {
        vm.startPrank(user);
        // Use the string revert from the local Ownable.sol
        // Update to match OpenZeppelin's Ownable error format
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, user));
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

        vm.expectRevert(FeeRegistry.InvalidFeeConfiguration.selector); // Use selector for parameter-less error
        registry.addFeeConfiguration(zeroFee, 10);
    }

    function test_AddFeeConfiguration_Revert_ZeroTickSpacing() public {
        int24 zeroTickSpacing = 0;

        vm.expectRevert(FeeRegistry.InvalidFeeConfiguration.selector); // Use selector for parameter-less error
        registry.addFeeConfiguration(500, zeroTickSpacing);
    }

    function test_AddFeeConfiguration_Revert_NegativeTickSpacing() public {
        int24 negativeTickSpacing = -1;

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
        assertTrue(registry.isSupportedFeeTier(FEE_TIER_4_LOW), "Lower fee tier should be supported");

        // Already have FEE_TIER_1 & FEE_TIER_4_LOW with TICK_SPACING_1
        // Adding another fee for the same tick spacing should work
        uint24 lowerFee = 450;
        registry.addFeeConfiguration(lowerFee, TICK_SPACING_1);
        assertTrue(registry.isSupportedFeeTier(lowerFee), "New lower fee tier should be supported");

        PoolKey memory key1 = PoolKey({
            currency0: Currency.wrap(address(1)),
            currency1: Currency.wrap(address(2)),
            fee: FEE_TIER_1,
            tickSpacing: TICK_SPACING_1,
            hooks: IHooks(address(0))
        });

        // Even though the key specifies FEE_TIER_1, the lowest fee for TICK_SPACING_1 is returned
        assertEq(registry.getFee(key1), FEE_TIER_4_LOW, "getFee should return the lower fee for TICK_SPACING_1");

        // Add an even lower fee for the same tick spacing
        uint24 evenLowerFee = 300;
        registry.addFeeConfiguration(evenLowerFee, TICK_SPACING_1);
        assertTrue(registry.isSupportedFeeTier(evenLowerFee), "Even lower fee tier should be supported");
        PoolKey memory key3 = PoolKey({
            currency0: Currency.wrap(address(1)),
            currency1: Currency.wrap(address(2)),
            fee: evenLowerFee,
            tickSpacing: TICK_SPACING_1,
            hooks: IHooks(address(0))
        });
        assertEq(registry.getFee(key3), evenLowerFee, "getFee should return the new lowest fee");
    }

    // --- Test isSupportedFeeTier (Static Fees) ---

    function test_IsSupportedFeeTier_Supported() public view {
        assertTrue(registry.isSupportedFeeTier(FEE_TIER_1)); // Pass only fee
        // Passing a fee+tick combo here depends on how isSupportedFeeTier is implemented
        // In our design, fee tier is the primary validation, tick checking is separate
    }

    function test_IsSupportedFeeTier_Unsupported() public view {
        assertFalse(registry.isSupportedFeeTier(99999), "Unsupported fee should return false"); // Pass only fee
    }

    function test_IsSupportedFeeTier_ZeroInputs() public view {
        assertFalse(registry.isSupportedFeeTier(0), "Zero fee should not be supported"); // Pass only fee
    }

    // --- Test getFee (Static Fees) ---

    function test_GetFee_Static_Success_SingleFeeForTickSpacing() public view {
        PoolKey memory key2 = PoolKey({
            currency0: Currency.wrap(address(1)),
            currency1: Currency.wrap(address(2)),
            fee: FEE_TIER_2,
            tickSpacing: TICK_SPACING_2,
            hooks: IHooks(address(0))
        });

        assertEq(registry.getFee(key2), FEE_TIER_2, "Should return FEE_TIER_2");
    }

    function test_GetFee_Static_Success_MultipleFeesForTickSpacing_ReturnsLowest() public view {
        // FEE_TIER_1 and FEE_TIER_4_LOW are both configured for TICK_SPACING_1
        // FEE_TIER_4_LOW < FEE_TIER_1
        PoolKey memory key1 = PoolKey({
            currency0: Currency.wrap(address(1)),
            currency1: Currency.wrap(address(2)),
            fee: FEE_TIER_1,
            tickSpacing: TICK_SPACING_1,
            hooks: IHooks(address(0))
        });
        assertEq(registry.getFee(key1), FEE_TIER_4_LOW, "Should return lowest fee");
    }

    function test_GetFee_Static_Success_AfterAddingLowerFee() public {
        uint24 evenLowerFee = 300;
        registry.addFeeConfiguration(evenLowerFee, TICK_SPACING_1);

        PoolKey memory keyLower = PoolKey({
            currency0: Currency.wrap(address(1)),
            currency1: Currency.wrap(address(2)),
            fee: evenLowerFee,
            tickSpacing: TICK_SPACING_1,
            hooks: IHooks(address(0))
        });
        assertEq(registry.getFee(keyLower), evenLowerFee);
    }

    function test_GetFee_Static_Success_AfterAddingHigherFee() public {
        uint24 higherFee = 900; // Higher than both FEE_TIER_1 (500) and FEE_TIER_4_LOW (400)
        registry.addFeeConfiguration(higherFee, TICK_SPACING_1);

        PoolKey memory keyHigher = PoolKey({
            currency0: Currency.wrap(address(1)),
            currency1: Currency.wrap(address(2)),
            fee: higherFee,
            tickSpacing: TICK_SPACING_1,
            hooks: IHooks(address(0))
        });

        // Still returns the lowest fee for the tick spacing
        assertEq(registry.getFee(keyHigher), FEE_TIER_4_LOW, "Should still return the lowest fee for TICK_SPACING_1");
    }

    function test_GetFee_Static_Revert_UnsupportedFeeTier() public {
        uint24 dummyFee = 42069; // Random unsupported fee
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(1)),
            currency1: Currency.wrap(address(2)),
            fee: dummyFee, // Not supported
            tickSpacing: 0, // Invalid tickSpacing to trigger FeeTierNotSupported
            hooks: IHooks(address(0))
        });

        // Correct: Reference the error from FeeRegistry directly. It reverts with FeeTierNotSupported(dummyFee)
        vm.expectRevert(abi.encodeWithSelector(FeeRegistry.FeeTierNotSupported.selector, dummyFee));
        registry.getFee(key);
    }

    // --- Test getFeeTickSpacing (Static Fees) ---
    function test_GetFeeAndTickSpacing_Success() public view {
        int24 tickSpacing = registry.getTickSpacing(FEE_TIER_1);
        assertEq(tickSpacing, TICK_SPACING_1, "Tick spacing should match");
    }

    function test_GetFeeAndTickSpacing_Revert_UnsupportedFeeTier() public {
        uint24 dummyFee = 42069;
        vm.expectRevert(abi.encodeWithSelector(FeeRegistry.FeeTierNotSupported.selector, dummyFee));
        registry.getTickSpacing(dummyFee); // Use getTickSpacing for the revert test
    }

    // --- Test getTickSpacing (Static Fees) ---
    function test_GetTickSpacing_Success() public view {
        int24 tickSpacing = registry.getTickSpacing(FEE_TIER_1);
        assertEq(tickSpacing, TICK_SPACING_1, "Tick spacing should match");
    }

    function test_GetTickSpacing_Revert_UnsupportedFeeTier() public {
        uint24 dummyFee = 42069;
        vm.expectRevert(abi.encodeWithSelector(FeeRegistry.FeeTierNotSupported.selector, dummyFee));
        registry.getTickSpacing(dummyFee); // Use getTickSpacing for the revert test
    }

    // --- Test Dynamic Fee Handling (Register, Update, Get) ---
    function test_RegisterDynamicFeePool_Success() public {
        bytes32 poolKeyBCHash = _getPoolKeyHash(poolKeyBC);
        address updater = makeAddr("updater");

        // Expect event emission
        vm.expectEmit(true, true, true, true);
        emit FeeRegistry.DynamicFeePoolRegistered(poolKeyBCHash, FEE_TIER_2, updater);
        registry.registerDynamicFeePool(poolKeyBC, FEE_TIER_2, updater);

        // Validate mappings were updated correctly
        assertEq(registry.dynamicFees(poolKeyBCHash), FEE_TIER_2, "Initial dynamic fee not set");
        assertEq(registry.feeUpdaters(poolKeyBCHash), updater, "Fee updater not set");
        assertTrue(registry.feeUpdaters(_getPoolKeyHash(poolKeyBC)) != address(0), "Pool not marked as dynamic");
    }

    function test_RegisterDynamicFeePool_Revert_NonOwner() public {
        vm.startPrank(user);
        // Use the string revert from the local Ownable.sol
        // Update to match OpenZeppelin's Ownable error format
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, user));
        registry.registerDynamicFeePool(poolKeyBC, FEE_TIER_2, dynamicFeeUpdater);
        vm.stopPrank();
    }

    function test_RegisterDynamicFeePool_Revert_UnsupportedFeeTier() public {
        uint24 dummyFee = 42069; // Random unsupported fee
        address updater = makeAddr("updater");

        // Updated: Reference the new error from FeeRegistry directly
        vm.expectRevert(abi.encodeWithSelector(FeeRegistry.InvalidInitialFee.selector, dummyFee));
        registry.registerDynamicFeePool(poolKeyBC, dummyFee, updater);
    }

    function test_RegisterDynamicFeePool_Revert_ZeroUpdater() public {
        bytes32 poolKeyBCHash = _getPoolKeyHash(poolKeyBC);

        // Correct: Reference the error from FeeRegistry directly, error uses hash
        vm.expectRevert(
            abi.encodeWithSelector(
                FeeRegistry.InvalidInitialFeeOrUpdater.selector, poolKeyBCHash, FEE_TIER_2, address(0)
            )
        );
        registry.registerDynamicFeePool(poolKeyBC, FEE_TIER_2, address(0));
    }

    function test_RegisterDynamicFeePool_Revert_AlreadyRegistered() public {
        bytes32 poolKeyABHash = _getPoolKeyHash(poolKeyAB);
        address updater = makeAddr("updater");

        // Correct: Reference the error from FeeRegistry directly, error uses hash
        vm.expectRevert(abi.encodeWithSelector(FeeRegistry.PoolAlreadyRegistered.selector, poolKeyABHash));
        registry.registerDynamicFeePool(poolKeyAB, FEE_TIER_2, updater);
    }

    function test_UpdateFee_Success() public {
        bytes32 poolKeyABHash = _getPoolKeyHash(poolKeyAB);
        uint24 expectedNewFee = 1000; // Max possible fee from 500 current + 500 max adjustment
        // To get feeAdjustment = 500 (max), need volumeMultiplierRaw >= 10
        // Let swapVolume = 17001 ether (gives volumeMultiplierRaw = 18, capped to 10 -> adjustment 500)
        uint256 calculatedSwapVolume = 17001 ether;

        // Expect event emission
        vm.startPrank(dynamicFeeUpdater);
        vm.expectEmit(true, true, true, true);
        emit FeeRegistry.DynamicFeeUpdated(poolKeyABHash, dynamicFeeUpdater, expectedNewFee);
        registry.updateFee(poolKeyAB, calculatedSwapVolume);
        vm.stopPrank();

        // Validate fee was updated
        assertEq(registry.dynamicFees(poolKeyABHash), expectedNewFee, "Dynamic fee not updated");
        // The getFee function should also return the updated dynamic fee for this pool
        assertEq(registry.getFee(poolKeyAB), expectedNewFee);
    }

    function test_UpdateFee_Revert_Unauthorized() public {
        bytes32 poolKeyABHash = _getPoolKeyHash(poolKeyAB);
        address badUpdater = makeAddr("badUpdater");
        uint24 newFee = 1400; // 0.14%

        vm.startPrank(badUpdater);
        // Correct: Reference the error from FeeRegistry directly, error uses hash and addresses
        vm.expectRevert(
            abi.encodeWithSelector(
                FeeRegistry.UnauthorizedUpdater.selector, poolKeyABHash, badUpdater, dynamicFeeUpdater
            )
        );
        registry.updateFee(poolKeyAB, newFee);
        vm.stopPrank();
    }

    function test_UpdateFee_Revert_PoolNotRegistered() public {
        bytes32 poolKeyACHash = _getPoolKeyHash(poolKeyAC);
        uint24 newFee = 1400; // 0.14%

        vm.startPrank(dynamicFeeUpdater);
        // Correct: Reference the error from FeeRegistry directly, error uses hash
        vm.expectRevert(abi.encodeWithSelector(FeeRegistry.PoolNotRegistered.selector, poolKeyACHash));
        registry.updateFee(poolKeyAC, newFee);
        vm.stopPrank();
    }

    function test_UpdateFee_Revert_FeeTooHigh() public {
        // For poolKeyAB, currentFee is FEE_TIER_1 (500) (from defaultFee as dynamicFee starts at 0, then picks up default).
        // However, registerDynamicFeePool sets dynamicFees[keyHash] = initialFee directly.
        // So, currentFee = dynamicFees[poolKeyABHash] which is FEE_TIER_1 (500).

        // To exceed MAX_FEE (100000) with currentFee 500, unCappedFeeAdjustmentForCheck needs to be > 99500
        // unCappedFeeAdjustmentForCheck = volumeMultiplierRaw * 50
        // volumeMultiplierRaw = (swapVolume + 1000 ether - 1) / 1000 ether
        // For swapVolume = 1_990_001 ether:
        // volumeMultiplierRaw = (1_990_001 ether + 1000 ether - 1) / 1000 ether = 1991
        // unCappedFeeAdjustmentForCheck = 1991 * 50 = 99550.
        // potentialFeeForBoundCheck = currentFee (500) + 99550 = 100050.
        // 100050 > MAX_FEE (100000) should be true and cause InvalidDynamicFee revert.
        uint256 feeTooHighSwapVolume = 1_990_001 ether;

        vm.startPrank(dynamicFeeUpdater);
        vm.expectRevert(abi.encodeWithSelector(FeeRegistry.InvalidDynamicFee.selector));
        registry.updateFee(poolKeyAB, feeTooHighSwapVolume);
        vm.stopPrank();
    }

    function test_GetFee_Dynamic_Success() public view {
        // For a registered dynamic fee pool, getFee should return the dynamic fee
        assertEq(registry.getFee(poolKeyAB), FEE_TIER_1, "Should return the dynamic fee");
    }

    function test_GetFee_Dynamic_AfterUpdate() public {
        bytes32 poolKeyABHash = _getPoolKeyHash(poolKeyAB);
        uint24 expectedNewFee = 1000; // Max possible fee from 500 current + 500 max adjustment
        // To get feeAdjustment = 500 (max), need volumeMultiplierRaw >= 10
        // Let swapVolume = 17001 ether (gives volumeMultiplierRaw = 18, capped to 10 -> adjustment 500)
        uint256 calculatedSwapVolume = 17001 ether;

        // Update the fee
        vm.startPrank(dynamicFeeUpdater);
        registry.updateFee(poolKeyAB, calculatedSwapVolume); // Use calculatedSwapVolume
        vm.stopPrank();

        // Validate getFee returns the updated dynamic fee
        assertEq(registry.getFee(poolKeyAB), expectedNewFee, "Should return the updated dynamic fee");
        assertEq(registry.dynamicFees(poolKeyABHash), expectedNewFee, "Dynamic fee mapping incorrect");
    }

    function test_IsDynamicFeePool_Success() public view {
        assertTrue(registry.feeUpdaters(_getPoolKeyHash(poolKeyAB)) != address(0), "PoolKeyAB should be dynamic");
        assertTrue(registry.feeUpdaters(_getPoolKeyHash(poolKeyAC)) == address(0), "PoolKeyAC should not be dynamic");
    }

    function test_DynamicFeeAndUpdater_GettersConsistency() public view {
        bytes32 poolKeyABHash = _getPoolKeyHash(poolKeyAB);
        bytes32 poolKeyACHash = _getPoolKeyHash(poolKeyAC); // Unregistered

        // Check consistency for registered pool
        assertEq(registry.dynamicFees(poolKeyABHash), FEE_TIER_1, "Dynamic fee mismatch");
        assertEq(registry.feeUpdaters(poolKeyABHash), dynamicFeeUpdater, "Fee updater mismatch");

        // Check consistency for unregistered pool - should return zero/null values
        assertEq(registry.dynamicFees(poolKeyACHash), 0, "Should return zero for unregistered pool's fee");
        assertEq(
            registry.feeUpdaters(poolKeyACHash),
            address(0),
            "Should return zero address for unregistered pool's updater"
        );
        // No revert expected here
    }

    // --- Test Fee Updater Management ---
    function test_SetFeeUpdater_Success() public {
        bytes32 poolKeyABHash = _getPoolKeyHash(poolKeyAB);
        address newUpdater = makeAddr("newUpdater");

        // Expect event emission
        vm.startPrank(owner);
        vm.expectEmit(true, true, true, true);
        emit FeeRegistry.FeeUpdaterSet(poolKeyABHash, dynamicFeeUpdater, newUpdater); // Emit hash and old/new updaters
        registry.setFeeUpdater(poolKeyAB, newUpdater);
        vm.stopPrank();

        // Verify directly from mapping
        assertEq(registry.feeUpdaters(poolKeyABHash), newUpdater, "Updater not changed");

        // Old updater should fail now
        vm.startPrank(dynamicFeeUpdater);
        // Correct: Reference the error from FeeRegistry directly, error uses hash
        vm.expectRevert(
            abi.encodeWithSelector(
                FeeRegistry.UnauthorizedUpdater.selector, poolKeyABHash, dynamicFeeUpdater, newUpdater
            )
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
        // Update to match OpenZeppelin's Ownable error format
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, user));
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
        // Update to match OpenZeppelin's Ownable error format - FIX: use address(this) instead of user
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        registry.addFeeConfiguration(100, 1);

        // New owner can call owner functions
        vm.startPrank(newOwner);
        registry.addFeeConfiguration(100, 1);
        vm.stopPrank();
    }
}
