// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {Hooks} from "../../src/libraries/Hooks.sol";
import {IPoolManager} from "../../src/interfaces/IPoolManager.sol";
import {PoolKey} from "../../src/types/PoolKey.sol";
import {BalanceDelta} from "../../src/interfaces/IPoolManager.sol";

/**
 * @title HooksTest
 * @dev Unit tests for the Hooks library, testing function selectors and inheritance
 */
contract HooksTest is Test {
    // Mock contract that inherits from Hooks to test the virtual functions
    MockHooks mockHooks;

    function setUp() public {
        mockHooks = new MockHooks();
    }

    function test_BeforeSwapSelector() public {
        bytes4 selector = mockHooks.beforeSwap(
            address(0x1),
            PoolKey(address(0), address(0), 0, 0, address(0)),
            IPoolManager.SwapParams(100, 0, false),
            bytes("")
        );

        assertEq(selector, mockHooks.beforeSwap.selector, "beforeSwap selector mismatch");
    }

    function test_AfterSwapSelector() public {
        bytes4 selector = mockHooks.afterSwap(
            address(0x1),
            PoolKey(address(0), address(0), 0, 0, address(0)),
            IPoolManager.SwapParams(100, 0, false),
            BalanceDelta(10, 20),
            bytes("")
        );

        assertEq(selector, mockHooks.afterSwap.selector, "afterSwap selector mismatch");
    }

    function test_BeforeModifyPositionSelector() public {
        bytes4 selector = mockHooks.beforeModifyPosition(
            address(0x1),
            PoolKey(address(0), address(0), 0, 0, address(0)),
            IPoolManager.ModifyPositionParams(0, 0, 0),
            bytes("")
        );

        assertEq(selector, mockHooks.beforeModifyPosition.selector, "beforeModifyPosition selector mismatch");
    }

    function test_AfterModifyPositionSelector() public {
        bytes4 selector = mockHooks.afterModifyPosition(
            address(0x1),
            PoolKey(address(0), address(0), 0, 0, address(0)),
            IPoolManager.ModifyPositionParams(0, 0, 0),
            BalanceDelta(10, 20),
            bytes("")
        );

        assertEq(selector, mockHooks.afterModifyPosition.selector, "afterModifyPosition selector mismatch");
    }

    function test_HookOverrides() public {
        // Create a custom hook that overrides the default behavior
        CustomHook customHook = new CustomHook();

        // Test that the custom implementation returns a different selector
        bytes4 selector = customHook.beforeSwap(
            address(0x1),
            PoolKey(address(0), address(0), 0, 0, address(0)),
            IPoolManager.SwapParams(100, 0, false),
            bytes("")
        );

        assertEq(selector, bytes4(keccak256("customBeforeSwap()")), "Custom hook selector mismatch");
    }
}

// Mock contract that inherits from Hooks for testing
contract MockHooks is Hooks {
// No need to override the functions as we're testing the default implementations
}

// Custom hook that overrides the default behavior
contract CustomHook is Hooks {
    function beforeSwap(address, PoolKey calldata, IPoolManager.SwapParams calldata, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        return bytes4(keccak256("customBeforeSwap()"));
    }
}
