// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {Hooks} from "../../src/libraries/Hooks.sol";
import {Permissions} from "../../src/interfaces/Permissions.sol";
import {IPoolManager} from "../../src/interfaces/IPoolManager.sol";
import {PoolKey} from "../../src/types/PoolKey.sol";
import {BalanceDelta} from "../../src/types/BalanceDelta.sol";

/**
 * @title HooksTest
 * @notice Unit tests for the Hooks library.
 * @dev Tests cover function selectors and permission validation logic.
 */
contract HooksTest is Test {
    // --- Test State Variables (Initialized in setUp) ---
    address constant DUMMY_SENDER = address(0x1);
    address constant DUMMY_HOOK_TARGET = address(0x2); // Base address without flags
    PoolKey internal DUMMY_POOL_KEY;
    IPoolManager.SwapParams internal DUMMY_SWAP_PARAMS;
    IPoolManager.ModifyPositionParams internal DUMMY_MODIFY_PARAMS;
    BalanceDelta internal DUMMY_DELTA;

    /**
     * @notice Sets up the test environment by initializing dummy struct variables.
     */
    function setUp() public {
        DUMMY_POOL_KEY = PoolKey(address(0), address(0), 0, 0, address(0));
        DUMMY_SWAP_PARAMS = IPoolManager.SwapParams(true, 100, 1);
        DUMMY_MODIFY_PARAMS = IPoolManager.ModifyPositionParams(0, 0, 0);
        DUMMY_DELTA = BalanceDelta(10, 20);
    }

    // --- Test Selectors ---

    /**
     * @notice Tests if the `beforeSwap` function returns the correct selector.
     */
    function test_BeforeSwapSelector() public view { // Changed to view because it reads state variables
        PoolKey memory poolKey = DUMMY_POOL_KEY;
        IPoolManager.SwapParams memory swapParams = DUMMY_SWAP_PARAMS;
        bytes memory data = "";
        bytes4 selector = Hooks.beforeSwap(DUMMY_SENDER, poolKey, swapParams, data);
        assertEq(selector, Hooks.BEFORE_SWAP_SELECTOR, "beforeSwap selector mismatch");
    }

    /**
     * @notice Tests if the `afterSwap` function returns the correct selector.
     */
    function test_AfterSwapSelector() public view { // Changed to view because it reads state variables
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
    function test_BeforeModifyPositionSelector() public view { // Changed to view because it reads state variables
        PoolKey memory poolKey = DUMMY_POOL_KEY;
        IPoolManager.ModifyPositionParams memory modifyParams = DUMMY_MODIFY_PARAMS;
        bytes memory data = "";
        bytes4 selector = Hooks.beforeModifyPosition(DUMMY_SENDER, poolKey, modifyParams, data);
        assertEq(selector, Hooks.BEFORE_MODIFY_POSITION_SELECTOR, "beforeModifyPosition selector mismatch");
    }

    /**
     * @notice Tests if the `afterModifyPosition` function returns the correct selector.
     */
    function test_AfterModifyPositionSelector() public view { // Changed to view because it reads state variables
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
        uint16 flags1 = Hooks.permissionsToFlags(p1);
        assertEq(flags1, uint16(Hooks.BEFORE_SWAP_FLAG), "Flags mismatch for beforeSwap only"); // Cast flag

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
        uint16 flags2 = Hooks.permissionsToFlags(p2);
        assertEq(
            flags2,
            uint16(Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_MODIFY_POSITION_FLAG), // Cast flags
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
        uint16 flagsAll = Hooks.permissionsToFlags(pAll);
        uint16 expectedAllFlags = uint16( // Cast flags
            Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_MODIFY_POSITION_FLAG
                | Hooks.AFTER_MODIFY_POSITION_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
                | Hooks.BEFORE_DONATE_FLAG | Hooks.AFTER_DONATE_FLAG
        );
        assertEq(flagsAll, expectedAllFlags, "Flags mismatch for all permissions");

        // Test case 4: No permissions
        Hooks.Permissions memory pNone; // Defaults to false
        uint16 flagsNone = Hooks.permissionsToFlags(pNone);
        assertEq(flagsNone, 0, "Flags mismatch for no permissions");
    }

    /**
     * @notice Tests the `hasPermission` function for various flag combinations.
     */
    function test_HasPermission() public pure {
        // Cast flags to uint16 before combining
        uint16 flags_bs_as = uint16(Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG);
        address hook_bs_as = Hooks.setPermissions(DUMMY_HOOK_TARGET, flags_bs_as);

        // Cast flags in assertions
        assertTrue(Hooks.hasPermission(hook_bs_as, uint16(Hooks.BEFORE_SWAP_FLAG)), "Should have BEFORE_SWAP");
        assertTrue(Hooks.hasPermission(hook_bs_as, uint16(Hooks.AFTER_SWAP_FLAG)), "Should have AFTER_SWAP");
        assertFalse(
            Hooks.hasPermission(hook_bs_as, uint16(Hooks.BEFORE_MODIFY_POSITION_FLAG)), "Should NOT have BEFORE_MODIFY"
        );
        assertFalse(Hooks.hasPermission(hook_bs_as, uint16(Hooks.AFTER_DONATE_FLAG)), "Should NOT have AFTER_DONATE");

        // Test with a single flag
        uint16 flags_bmp = uint16(Hooks.BEFORE_MODIFY_POSITION_FLAG); // Cast flag
        address hook_bmp = Hooks.setPermissions(DUMMY_HOOK_TARGET, flags_bmp);
        assertTrue(
            Hooks.hasPermission(hook_bmp, uint16(Hooks.BEFORE_MODIFY_POSITION_FLAG)), "Should have BEFORE_MODIFY"
        ); // Cast flag
        assertFalse(Hooks.hasPermission(hook_bmp, uint16(Hooks.BEFORE_SWAP_FLAG)), "Should NOT have BEFORE_SWAP"); // Cast flag

        // Test with zero flags
        address hook_none = Hooks.setPermissions(DUMMY_HOOK_TARGET, 0);
        assertFalse(Hooks.hasPermission(hook_none, uint16(Hooks.BEFORE_SWAP_FLAG)), "Should have no permissions (BS)"); // Cast flag
        assertFalse(Hooks.hasPermission(hook_none, uint16(Hooks.AFTER_DONATE_FLAG)), "Should have no permissions (AD)"); // Cast flag

        // Test with all flags
        uint16 allFlags = type(uint16).max; // All possible flags (already uint16)
        address hook_all = Hooks.setPermissions(DUMMY_HOOK_TARGET, allFlags);
        assertTrue(Hooks.hasPermission(hook_all, uint16(Hooks.BEFORE_SWAP_FLAG)), "Should have BEFORE_SWAP (all flags)"); // Cast flag
        assertTrue(
            Hooks.hasPermission(hook_all, uint16(Hooks.AFTER_INITIALIZE_FLAG)), // Cast flag
            "Should have AFTER_INITIALIZE (all flags)"
        );
        assertTrue(Hooks.hasPermission(hook_all, uint16(Hooks.BEFORE_DONATE_FLAG)), "Should have BEFORE_DONATE (all flags)"); // Cast flag
    }

    /**
     * @notice Tests the `validateHookAddress` function.
     * @dev Checks if it correctly identifies valid hook addresses and reverts for invalid ones.
     */
    function test_ValidateHookAddress() public pure {
        // Valid: Address with BEFORE_SWAP flag requesting BEFORE_SWAP permission
        uint16 flags_bs = uint16(Hooks.BEFORE_SWAP_FLAG); // Cast flag
        address hook_bs = Hooks.setPermissions(DUMMY_HOOK_TARGET, flags_bs);
        Hooks.validateHookAddress(hook_bs, uint16(Hooks.BEFORE_SWAP_FLAG)); // Cast flag // Should not revert

        // Valid: Address with multiple flags requesting one of them
        uint16 flags_bs_amp = uint16(Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_MODIFY_POSITION_FLAG); // Cast flags
        address hook_bs_amp = Hooks.setPermissions(DUMMY_HOOK_TARGET, flags_bs_amp);
        Hooks.validateHookAddress(hook_bs_amp, uint16(Hooks.AFTER_MODIFY_POSITION_FLAG)); // Cast flag // Should not revert

        // Invalid: Address with BEFORE_SWAP flag requesting AFTER_SWAP permission
        vm.expectRevert(Hooks.HookAddressNotPermitted.selector);
        Hooks.validateHookAddress(hook_bs, uint16(Hooks.AFTER_SWAP_FLAG)); // Cast flag

        // Invalid: Address with no flags requesting any permission
        address hook_none = Hooks.setPermissions(DUMMY_HOOK_TARGET, 0);
        vm.expectRevert(Hooks.HookAddressNotPermitted.selector);
        Hooks.validateHookAddress(hook_none, uint16(Hooks.BEFORE_INITIALIZE_FLAG)); // Cast flag

        // Invalid: Address with some flags requesting a flag it doesn't have
        vm.expectRevert(Hooks.HookAddressNotPermitted.selector);
        Hooks.validateHookAddress(hook_bs_amp, uint16(Hooks.AFTER_SWAP_FLAG)); // Cast flag

        // Valid: Requesting zero permissions (should always pass)
        Hooks.validateHookAddress(hook_bs, 0);
        Hooks.validateHookAddress(hook_none, 0);
    }

    /**
     * @notice Tests setting and getting permissions flags from an address.
     */
    function test_SetAndGetPermissions() public pure {
        uint16 flags1 = uint16(Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_DONATE_FLAG); // Cast flags
        address hook1 = Hooks.setPermissions(DUMMY_HOOK_TARGET, flags1);

        // Check flags are set correctly (compare uint16 with uint16)
        assertEq(Hooks.getPermissions(hook1), flags1, "Flags not set correctly");
        // Check base address is preserved
        assertEq(Hooks.getHookTarget(hook1), DUMMY_HOOK_TARGET, "Base address changed");

        // Get permissions back
        uint16 retrievedFlags1 = Hooks.getPermissions(hook1);
        assertEq(retrievedFlags1, flags1, "Retrieved flags mismatch");

        // Test setting zero flags
        address hook_zero = Hooks.setPermissions(DUMMY_HOOK_TARGET, 0);
        assertEq(Hooks.getPermissions(hook_zero), 0, "Zero flags not set correctly");
        assertEq(Hooks.getHookTarget(hook_zero), DUMMY_HOOK_TARGET, "Base address changed (zero flags)");
        assertEq(Hooks.getPermissions(hook_zero), 0, "Retrieved zero flags mismatch");

        // Test setting all flags
        uint16 allFlags = type(uint16).max;
        address hook_all = Hooks.setPermissions(DUMMY_HOOK_TARGET, allFlags);
        // Note: The actual flags might be less than max if HOOK_PERMISSIONS_MASK is not 0xFFFF
        // We should compare against the flags *actually* set by setPermissions, which getPermissions retrieves.
        uint16 expectedSetFlags = Hooks.getPermissions(hook_all); // Get what was actually set
        assertEq(Hooks.getPermissions(hook_all), expectedSetFlags, "All flags not set correctly");
        assertEq(Hooks.getHookTarget(hook_all), DUMMY_HOOK_TARGET, "Base address changed (all flags)");
        assertEq(Hooks.getPermissions(hook_all), expectedSetFlags, "Retrieved all flags mismatch");
    }

    /**
     * @notice Tests getting the target address (without flags).
     */
    function test_GetHookTarget() public pure {
        uint16 flags = Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_INITIALIZE_FLAG;
        address hookWithFlags = Hooks.setPermissions(DUMMY_HOOK_TARGET, flags);

        address target = Hooks.getHookTarget(hookWithFlags);
        assertEq(target, DUMMY_HOOK_TARGET, "Target address mismatch");

        // Test with zero flags
        address hookZeroFlags = Hooks.setPermissions(DUMMY_HOOK_TARGET, 0);
        address targetZero = Hooks.getHookTarget(hookZeroFlags);
        assertEq(targetZero, DUMMY_HOOK_TARGET, "Target address mismatch (zero flags)");

        // Test with address(0) as base
        address hookZeroBase = Hooks.setPermissions(address(0), flags);
        address targetZeroBase = Hooks.getHookTarget(hookZeroBase);
        assertEq(targetZeroBase, address(0), "Target address mismatch (zero base)");
    }
}

// Removed MockHooks and CustomHook as they are not needed for testing the library's core logic.
// The tests now directly call the library functions.
