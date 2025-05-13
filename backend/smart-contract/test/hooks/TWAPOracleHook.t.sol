// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {TWAPOracleHook} from "../../src/hooks/TWAPOracleHook.sol";
import {PoolKey} from "../../src/types/PoolKey.sol";
import {IPoolManager} from "../../src/interfaces/IPoolManager.sol";
import {BalanceDelta} from "../../src/types/BalanceDelta.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockPoolManager} from "../mocks/MockPoolManager.sol";
import {HookFactory} from "../utils/HookFactory.sol";
import {Hooks} from "../../src/libraries/Hooks.sol";
import {IAetherPool} from "../../src/interfaces/IAetherPool.sol";

contract TWAPOracleHookTest is Test {
    TWAPOracleHook public twapHook;
    MockPoolManager public poolManager;
    MockERC20 public token0;
    MockERC20 public token1;
    PoolKey public poolKey;
    HookFactory public factory;
    IAetherPool public pool;

    // Constants aligned with TWAPOracleHook
    uint256 constant INITIAL_PRICE = 1000; // Base price
    uint256 constant SCALE = 1000; // Price scaling factor
    uint256 constant AMOUNT_SCALE = 1e15; // Amount scaling factor
    uint256 constant TEST_AMOUNT = 1e15; // Base amount for tests

    function setUp() public {
        // Deploy tokens
        token0 = new MockERC20("Token0", "TK0", 18);
        token1 = new MockERC20("Token1", "TK1", 18);

        // Ensure token0 < token1
        if (address(token0) > address(token1)) {
            (token0, token1) = (token1, token0);
        }

        // Deploy factory and hook
        factory = new HookFactory();
        twapHook = factory.deployTWAPHook(address(this), uint32(3600));

        // Deploy Pool (using Vyper version via vm.deployCode)
        bytes memory poolBytecode = vm.getCode("src/security/AetherPool.vy");
        bytes memory constructorArgs = abi.encode(address(token0), address(token1), 500); // Example fee
        bytes memory bytecode = abi.encodePacked(poolBytecode, constructorArgs);
        address deployedPoolAddress;
        assembly {
            deployedPoolAddress := create(0, add(bytecode, 0x20), mload(bytecode))
        }
        require(deployedPoolAddress != address(0), "Pool deployment failed");
        pool = IAetherPool(deployedPoolAddress); // Assign to interface variable

        // Deploy pool manager with pool and hook
        poolManager = new MockPoolManager(address(twapHook)); // Pass only hook address

        // Create pool key
        poolKey = PoolKey({
            token0: address(token0),
            token1: address(token1),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(twapHook)
        });

        // Initialize oracle
        twapHook.initializeOracle(poolKey, INITIAL_PRICE);

        // Skip flag verification - permissions are verified through method implementations
    }

    function testHookInitialization() public view {
        assertEq(twapHook.windowSize(), 3600);
        assertEq(twapHook.observationLength(address(token0), address(token1)), 1);
    }

    function testTWAPCalculation() public {
        // Initial price observation already set in setUp()

        // Simulate series of swaps
        simulateSwap(true, TEST_AMOUNT, TEST_AMOUNT); // 1:1 ratio
        vm.warp(block.timestamp + 60);

        simulateSwap(true, TEST_AMOUNT, TEST_AMOUNT * 11 / 10); // 1:1.1 ratio
        vm.warp(block.timestamp + 60);

        simulateSwap(true, TEST_AMOUNT, TEST_AMOUNT * 9 / 10); // 1:0.9 ratio
        vm.warp(block.timestamp + 60);

        uint256 twap = twapHook.consult(address(token0), address(token1), 120);
        assertApproxEqRel(twap, INITIAL_PRICE, 0.1e18); // Allow 10% deviation
    }

    function testTWAPPeriodBounds() public {
        simulateSwap(true, TEST_AMOUNT, TEST_AMOUNT);
        vm.warp(block.timestamp + 60);

        vm.expectRevert(TWAPOracleHook.PeriodTooShort.selector);
        twapHook.consult(address(token0), address(token1), 30);

        vm.expectRevert(TWAPOracleHook.PeriodTooLong.selector);
        twapHook.consult(address(token0), address(token1), 7200);
    }

    function testMultipleTokenPairs() public {
        // Deploy and set up second pair
        MockERC20 token2 = new MockERC20("Token2", "TK2", 18);
        MockERC20 token3 = new MockERC20("Token3", "TK3", 18);

        if (address(token2) > address(token3)) {
            (token2, token3) = (token3, token2);
        }

        PoolKey memory poolKey2 = PoolKey({
            token0: address(token2),
            token1: address(token3),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(twapHook)
        });

        twapHook.initializeOracle(poolKey2, INITIAL_PRICE);

        // Simulate trades on both pairs
        simulateSwap(true, TEST_AMOUNT, TEST_AMOUNT);
        vm.warp(block.timestamp + 60);

        simulateSwapWithAmounts(poolKey2, true, TEST_AMOUNT, TEST_AMOUNT * 2);
        vm.warp(block.timestamp + 60);

        uint256 price1 = twapHook.consult(address(token0), address(token1), 60);
        uint256 price2 = twapHook.consult(address(token2), address(token3), 60);

        assertApproxEqRel(price1, INITIAL_PRICE, 0.1e18);
        assertApproxEqRel(price2, INITIAL_PRICE * 2, 0.1e18);
    }

    function testPriceAccumulation() public {
        simulateSwap(true, TEST_AMOUNT, TEST_AMOUNT);
        vm.warp(block.timestamp + 60);

        simulateSwap(true, TEST_AMOUNT, TEST_AMOUNT * 11 / 10);
        vm.warp(block.timestamp + 60);

        uint256 twap = twapHook.consult(address(token0), address(token1), 60);
        uint256 expectedPrice = (INITIAL_PRICE * 110) / 100; // 10% increase
        assertApproxEqRel(twap, expectedPrice, 0.1e18);
    }

    // Helper functions
    function simulateSwap(bool zeroForOne, uint256 amount0, uint256 amount1) internal {
        simulateSwapWithAmounts(poolKey, zeroForOne, amount0, amount1);
    }

    function simulateSwapWithAmounts(PoolKey memory key, bool zeroForOne, uint256 amount0, uint256 amount1) internal {
        require(amount0 > 0 && amount1 > 0, "Invalid amounts");

        BalanceDelta memory delta = BalanceDelta({
            amount0: zeroForOne ? -int256(amount0) : int256(amount1),
            amount1: zeroForOne ? int256(amount1) : -int256(amount0)
        });

        IPoolManager.SwapParams memory params =
            IPoolManager.SwapParams({zeroForOne: zeroForOne, amountSpecified: int256(amount0), sqrtPriceLimitX96: 0});

        twapHook.afterSwap(address(0), key, params, delta, "");
    }
}
