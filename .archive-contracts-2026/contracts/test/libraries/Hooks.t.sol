// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.31;

import {Test} from "forge-std/Test.sol";
import {Hooks} from "../../src/libraries/Hooks.sol";
import {Permissions} from "../../src/interfaces/Permissions.sol";
import {IPoolManager} from "../../src/interfaces/IPoolManager.sol";
import {PoolKey} from "../../lib/v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "../../src/types/BalanceDelta.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";

/**
 * @title HooksValidator
 * @notice Helper contract to expose the Hooks.validateHookAddress function as external
 * for proper testing of reverts in the Hooks library.
 */
contract HooksValidator {
    function validateHookAddress(address hookAddress, uint160 requiredFlags) external pure {
        Hooks.validateHookAddress(hookAddress, requiredFlags);
    }
}

/**
 * @title HooksTest
 * @notice Unit tests for the Hooks library.
 * @dev Tests cover function selectors and permission validation logic.
 */
contract HooksTest is Test {
    // --- Test State Variables (Initialized in setUp) ---
    address constant DUMMY_SENDER = address(0x1);
    address constant DUMMY_HOOK_TARGET = address(0x100); // Base address without flags
    PoolKey internal DUMMY_POOL_KEY;
    IPoolManager.SwapParams internal DUMMY_SWAP_PARAMS;
    IPoolManager.ModifyPositionParams internal DUMMY_MODIFY_PARAMS;
    BalanceDelta internal DUMMY_DELTA;

    /**
     * @notice Sets up the test environment by initializing dummy struct variables.
     */
    function setUp() public {
        DUMMY_POOL_KEY = PoolKey(Currency.wrap(address(0)), Currency.wrap(address(0)), 0, 0, IHooks(address(0)));
        DUMMY_SWAP_PARAMS = IPoolManager.SwapParams(true, 100, 1);
        DUMMY_MODIFY_PARAMS = IPoolManager.ModifyPositionParams(0, 0, 0);
        DUMMY_DELTA = BalanceDelta(10, 20);
    }

    // --- Test Selectors ---

    /**
     * @notice Tests if the `beforeSwap` function returns the correct selector.
     */
    function test_BeforeSwapSelector() public view {
        // Changed to view because it reads state variables
        PoolKey memory poolKey = DUMMY_POOL_KEY;
        IPoolManager.SwapParams memory swapParams = DUMMY_SWAP_PARAMS;
        bytes memory data = "";
        bytes4 selector = Hooks.beforeSwap(DUMMY_SENDER, poolKey, swapParams, data);
        assertEq(selector, Hooks.BEFORE_SWAP_SELECTOR, "beforeSwap selector mismatch");
    }

    /**
     * @notice Tests if the `afterSwap` function returns the correct selector.
     */
    function test_AfterSwapSelector() public view {
        // Changed to view because it reads state variables
        PoolKey memory poolKey = DUMMY_POOL_KEY;
        IPoolManager.SwapParams memory swapParams = DUMMY_SWAP_PARAMS;
        BalanceDelta memory delta = DUMMY_DELTA;
        bytes memory data = "";
        bytes4 selector = Hooks.afterSwap(DUMMY_SENDER, poolKey, swapParams, delta, data);
        assertEq(selector, Hooks.AFTER_SWAP_SELECTOR, "afterSwap selector mismatch");
    }

    /**
     * @notice Tests if the `beforeModifyPosition` function returns the correct selector.
     */
    function test_BeforeModifyPositionSelector() public view {
        // Changed to view because it reads state variables
        PoolKey memory poolKey = DUMMY_POOL_KEY;
        IPoolManager.ModifyPositionParams memory modifyParams = DUMMY_MODIFY_PARAMS;
        bytes memory data = "";
        bytes4 selector = Hooks.beforeModifyPosition(DUMMY_SENDER, poolKey, modifyParams, data);
        assertEq(selector, Hooks.BEFORE_MODIFY_POSITION_SELECTOR, "beforeModifyPosition selector mismatch");
    }

    /**
     * @notice Tests if the `afterModifyPosition` function returns the correct selector.
     */
    function test_AfterModifyPositionSelector() public view {
        // Changed to view because it reads state variables
        PoolKey memory poolKey = DUMMY_POOL_KEY;
        IPoolManager.ModifyPositionParams memory modifyParams = DUMMY_MODIFY_PARAMS;
        BalanceDelta memory delta = DUMMY_DELTA;
        bytes memory data = "";
        bytes4 selector = Hooks.afterModifyPosition(DUMMY_SENDER, poolKey, modifyParams, delta, data);
        assertEq(selector, Hooks.AFTER_MODIFY_POSITION_SELECTOR, "afterModifyPosition selector mismatch");
    }

    // --- Test Permission Logic ---

    /**
     * @notice Tests converting a Hooks.Permissions struct to its flag representation.
     */
    function test_PermissionsToFlags() public pure {
        // Test case 1: Only beforeSwap
        Hooks.Permissions memory p1 = Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeModifyPosition: false,
            afterModifyPosition: false,
            beforeSwap: true,
            afterSwap: false,
            beforeDonate: false,
            afterDonate: false
        });
        uint160 flags1 = Hooks.permissionsToFlags(p1);
        assertEq(flags1, Hooks.BEFORE_SWAP_FLAG, "Flags mismatch for beforeSwap only");

        // Test case 2: afterSwap and beforeModifyPosition
        Hooks.Permissions memory p2 = Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeModifyPosition: true,
            afterModifyPosition: false,
            beforeSwap: false,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false
        });
        uint160 flags2 = Hooks.permissionsToFlags(p2);
        assertEq(
            flags2,
            Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_MODIFY_POSITION_FLAG,
            "Flags mismatch for afterSwap & beforeModifyPosition"
        );

        // Test case 3: All permissions
        Hooks.Permissions memory pAll = Hooks.Permissions({
            beforeInitialize: true,
            afterInitialize: true,
            beforeModifyPosition: true,
            afterModifyPosition: true,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: true,
            afterDonate: true
        });
        uint160 flagsAll = Hooks.permissionsToFlags(pAll);
        uint160 expectedAllFlags =
            (Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_MODIFY_POSITION_FLAG
                | Hooks.AFTER_MODIFY_POSITION_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
                | Hooks.BEFORE_DONATE_FLAG | Hooks.AFTER_DONATE_FLAG);
        assertEq(flagsAll, expectedAllFlags, "Flags mismatch for all permissions");

        // Test case 4: No permissions
        Hooks.Permissions memory pNone; // Defaults to false
        uint160 flagsNone = Hooks.permissionsToFlags(pNone);
        assertEq(flagsNone, 0, "Flags mismatch for no permissions");
    }

    /**
     * @notice Tests the `hasPermission` function for various flag combinations.
     */
    function test_HasPermission() public pure {
        // Manually construct addresses with flags
        uint160 flags_bs_as = Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG;
        address hook_bs_as = address(uint160(DUMMY_HOOK_TARGET) | flags_bs_as);

        // Use uint160 flags in assertions
        assertTrue(Hooks.hasPermission(hook_bs_as, Hooks.BEFORE_SWAP_FLAG), "Should have BEFORE_SWAP");
        assertTrue(Hooks.hasPermission(hook_bs_as, Hooks.AFTER_SWAP_FLAG), "Should have AFTER_SWAP");
        assertFalse(Hooks.hasPermission(hook_bs_as, Hooks.BEFORE_MODIFY_POSITION_FLAG), "Should NOT have BEFORE_MODIFY");
        assertFalse(Hooks.hasPermission(hook_bs_as, Hooks.AFTER_DONATE_FLAG), "Should NOT have AFTER_DONATE");

        // Test with a single flag
        uint160 flags_bmp = Hooks.BEFORE_MODIFY_POSITION_FLAG;
        address hook_bmp = address(uint160(DUMMY_HOOK_TARGET) | flags_bmp);
        assertTrue(Hooks.hasPermission(hook_bmp, Hooks.BEFORE_MODIFY_POSITION_FLAG), "Should have BEFORE_MODIFY");
        assertFalse(Hooks.hasPermission(hook_bmp, Hooks.BEFORE_SWAP_FLAG), "Should NOT have BEFORE_SWAP");

        // Test with zero flags
        address hook_none = DUMMY_HOOK_TARGET; // No flags added
        assertFalse(Hooks.hasPermission(hook_none, Hooks.BEFORE_SWAP_FLAG), "Should have no permissions (BS)");
        assertFalse(Hooks.hasPermission(hook_none, Hooks.AFTER_DONATE_FLAG), "Should have no permissions (AD)");

        // Test with all flags (using the mask from validateHookAddress)
        uint160 allFlags = (1 << 8) - 1;
        address hook_all = address(uint160(DUMMY_HOOK_TARGET) | allFlags);
        assertTrue(Hooks.hasPermission(hook_all, Hooks.BEFORE_SWAP_FLAG), "Should have BEFORE_SWAP (all flags)");
        assertTrue(
            Hooks.hasPermission(hook_all, Hooks.AFTER_INITIALIZE_FLAG), "Should have AFTER_INITIALIZE (all flags)"
        );
        assertTrue(Hooks.hasPermission(hook_all, Hooks.BEFORE_DONATE_FLAG), "Should have BEFORE_DONATE (all flags)");
    }

    /**
     * @notice Tests the `validateHookAddress` function.
     * @dev Checks if it correctly identifies valid hook addresses and reverts for invalid ones.
     */
    function test_ValidateHookAddress() public {
        // Deploy the wrapper contract
        HooksValidator validator = new HooksValidator();

        // Manually construct addresses with flags
        uint160 flags_bs = Hooks.BEFORE_SWAP_FLAG;
        address hook_bs = address(uint160(DUMMY_HOOK_TARGET) | flags_bs);

        uint160 flags_bs_amp = Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_MODIFY_POSITION_FLAG;
        address hook_bs_amp = address(uint160(DUMMY_HOOK_TARGET) | flags_bs_amp);
        address hook_none = DUMMY_HOOK_TARGET; // No flags

        // -- Test valid cases (these should not revert) --

        // Valid: Hook with BEFORE_SWAP_FLAG requesting BEFORE_SWAP_FLAG
        validator.validateHookAddress(hook_bs, Hooks.BEFORE_SWAP_FLAG);

        // Valid: Hook with multiple flags requesting one of its flags
        validator.validateHookAddress(hook_bs_amp, Hooks.BEFORE_SWAP_FLAG);
        validator.validateHookAddress(hook_bs_amp, Hooks.AFTER_MODIFY_POSITION_FLAG);

        // Valid: Requesting zero permissions (should always pass)
        validator.validateHookAddress(hook_bs, 0);
        validator.validateHookAddress(hook_none, 0);

        // -- Test invalid cases (these should revert) --

        // Invalid: Address zero with any permission requested (should revert)
        vm.expectRevert(); // Changed: Expect generic revert due to revert_strings = 'strip'
        validator.validateHookAddress(address(0), Hooks.BEFORE_SWAP_FLAG);

        // Invalid: Address with no flags requesting any permission
        vm.expectRevert(); // Changed: Expect generic revert due to revert_strings = 'strip'
        validator.validateHookAddress(hook_none, Hooks.BEFORE_INITIALIZE_FLAG);

        // Invalid: Address with some flags requesting a flag it doesn't have
        vm.expectRevert(); // Changed: Expect generic revert due to revert_strings = 'strip'
        validator.validateHookAddress(hook_bs_amp, Hooks.AFTER_SWAP_FLAG);
    }

    /**
     * @notice Tests manually encoding and decoding permissions flags and target address.
     */
    function test_ManualPermissionEncodingDecoding() public pure {
        uint160 flags1 = Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_DONATE_FLAG;
        address hook1 = address(uint160(DUMMY_HOOK_TARGET) | flags1);
        uint160 permissionMask = (1 << 8) - 1; // Mask for the lower 8 bits used for flags

        // Extract flags manually
        uint160 retrievedFlags1 = uint160(uint160(hook1) & permissionMask);
        assertEq(retrievedFlags1, flags1, "Retrieved flags mismatch");

        // Extract target manually
        address retrievedTarget1 = address(uint160(hook1) & (~permissionMask));
        assertEq(retrievedTarget1, DUMMY_HOOK_TARGET, "Retrieved target mismatch");

        // Test with zero flags
        address hook_zero = DUMMY_HOOK_TARGET; // No flags added
        uint160 retrievedFlagsZero = uint160(uint160(hook_zero) & permissionMask);
        assertEq(retrievedFlagsZero, 0, "Zero flags not retrieved correctly");
        address retrievedTargetZero = address(uint160(hook_zero) & (~permissionMask));
        assertEq(retrievedTargetZero, DUMMY_HOOK_TARGET, "Base address changed (zero flags)");

        // Test with all flags
        uint160 allFlags = (1 << 8) - 1;
        address hook_all = address(uint160(DUMMY_HOOK_TARGET) | allFlags);
        uint160 retrievedFlagsAll = uint160(uint160(hook_all) & permissionMask);
        assertEq(retrievedFlagsAll, allFlags, "All flags not retrieved correctly");
        address retrievedTargetAll = address(uint160(hook_all) & (~permissionMask));
        assertEq(retrievedTargetAll, DUMMY_HOOK_TARGET, "Base address changed (all flags)");
    }

    /**
     * @notice Tests manually extracting the target address (without flags).
     */
    function test_ManualTargetExtraction() public pure {
        uint160 flags = Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_INITIALIZE_FLAG;
        address hookWithFlags = address(uint160(DUMMY_HOOK_TARGET) | flags);
        uint160 permissionMask = (1 << 8) - 1; // Mask for the lower 8 bits used for flags

        // Extract target manually
        address target = address(uint160(hookWithFlags) & (~permissionMask));
        assertEq(target, DUMMY_HOOK_TARGET, "Target address mismatch");

        // Test with zero flags
        address hookZeroFlags = DUMMY_HOOK_TARGET; // No flags added
        address targetZero = address(uint160(hookZeroFlags) & (~permissionMask));
        assertEq(targetZero, DUMMY_HOOK_TARGET, "Target address mismatch (zero flags)");

        // Test with address(0) as base
        address hookZeroBase = address(uint160(address(0)) | flags);
        address targetZeroBase = address(uint160(hookZeroBase) & (~permissionMask));
        assertEq(targetZeroBase, address(0), "Target address mismatch (zero base)");
    }
}
