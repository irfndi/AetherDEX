// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.31;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {DynamicFeeHook} from "../../src/hooks/DynamicFeeHook.sol";
import {IPoolManager} from "../../src/interfaces/IPoolManager.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {FeeRegistry} from "../../src/primary/FeeRegistry.sol";
import {PoolKey} from "../../lib/v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "../../src/types/BalanceDelta.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Hooks} from "../../src/libraries/Hooks.sol";
import {MockPoolManager} from "../mocks/MockPoolManager.sol";
import {HookFactory} from "../utils/HookFactory.sol";

/**
 * @title DynamicFeeHookImprovedTest
 * @notice Comprehensive test suite for the DynamicFeeHook contract
 * @dev Tests all aspects of the hook including fee calculation, validation, and integration with FeeRegistry
 */
contract DynamicFeeHookImprovedTest is Test {
    // Test contracts
    DynamicFeeHook public hook;
    MockPoolManager public poolManager;
    FeeRegistry public feeRegistry;
    MockERC20 public token0;
    MockERC20 public token1;
    HookFactory public factory;

    // Constants for testing
    uint24 public constant MIN_FEE = 100; // 0.01%
    uint24 public constant MAX_FEE = 50000; // 5%
    uint24 public constant FEE_STEP = 10; // 0.001%
    uint24 public constant INITIAL_FEE = 3000; // 0.3%
    uint24 public constant EXPECTED_DYNAMIC_FEE = 3663; // Dynamically calculated fee based on high volatility + medium liquidity
    uint256 public constant VOLUME_THRESHOLD = 1000e18; // 1000 tokens
    uint256 public constant MAX_VOLUME_MULTIPLIER = 5; // Maximum volume multiplier

    // Events to test
    event FeeUpdated(address token0, address token1, uint24 newFee, uint256 volatilityScore, uint256 liquidityScore);
    event MarketConditionUpdated(
        bytes32 poolId, uint256 volatilityScore, uint256 liquidityScore, uint256 activityScore
    );

    // Removed incomplete comment block that was causing compilation errors
    /*notice Set up the test environment
     */
    function setUp() public {
        // Create tokens and ensure token0 < token1 for canonical ordering
        token0 = new MockERC20("Token0", "TK0", 18);
        token1 = new MockERC20("Token1", "TK1", 18);
        if (address(token0) > address(token1)) {
            (token0, token1) = (token1, token0);
        }

        // Deploy FeeRegistry with test contract as owner
        feeRegistry = new FeeRegistry(address(this), address(this), 500);

        // Deploy factory for hook deployment
        factory = new HookFactory();

        // Deploy MockPoolManager
        poolManager = new MockPoolManager(address(0)); // Pass only one argument (_hookAddress)

        // Deploy hook through factory
        hook = factory.deployDynamicFeeHook(address(poolManager), address(feeRegistry));

        // Set up the FeeRegistry with initial configuration
        PoolKey memory key = _createPoolKey(INITIAL_FEE);

        // Add fee configuration
        feeRegistry.addFeeConfiguration(INITIAL_FEE, 60);

        // Register the pool for dynamic fees with the hook as the updater
        feeRegistry.registerDynamicFeePool(key, INITIAL_FEE, address(hook));
    }

    // Removed incomplete comment block that was causing compilation errors
    /*notice Helper function to create a pool key
     * @param fee The fee tier for the pool
     * @return key The created pool key
     */
    function _createPoolKey(uint24 fee) internal view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: fee,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
    }

    // Removed incomplete comment block that was causing compilation errors
    /*notice Test hook initialization
     */
    function test_HookInitialization() public {
        // Verify contract references
        assertEq(address(hook.poolManager()), address(poolManager));
        assertEq(address(hook.feeRegistry()), address(feeRegistry));

        // Verify hook permissions
        Hooks.Permissions memory permissions = hook.getHookPermissions();
        assertTrue(permissions.beforeSwap);
        assertTrue(permissions.afterSwap);
        assertFalse(permissions.beforeInitialize);
        assertFalse(permissions.afterInitialize);
        assertFalse(permissions.beforeModifyPosition);
        assertFalse(permissions.afterModifyPosition);
        assertFalse(permissions.beforeDonate);
        assertFalse(permissions.afterDonate);
    }

    // Removed incomplete comment block that was causing compilation errors
    /*notice Test beforeSwap hook with valid inputs
     */
    function test_BeforeSwap_Success() public {
        PoolKey memory key = _createPoolKey(INITIAL_FEE);

        // Should succeed with valid token addresses
        bytes4 selector = hook.beforeSwap(
            address(this),
            key,
            IPoolManager.SwapParams({zeroForOne: true, amountSpecified: 1000, sqrtPriceLimitX96: 0}),
            ""
        );

        assertEq(selector, hook.beforeSwap.selector);
    }

    // Removed incomplete comment block that was causing compilation errors
    /*notice Test beforeSwap hook with invalid token0
     */
    function test_BeforeSwap_InvalidToken0() public {
        PoolKey memory key = _createPoolKey(INITIAL_FEE);
        key.currency0 = Currency.wrap(address(0));

        vm.expectRevert(DynamicFeeHook.InvalidTokenAddress.selector);
        hook.beforeSwap(
            address(this),
            key,
            IPoolManager.SwapParams({zeroForOne: true, amountSpecified: 1000, sqrtPriceLimitX96: 0}),
            ""
        );
    }

    // Removed incomplete comment block that was causing compilation errors
    /*notice Test beforeSwap hook with invalid token1
     */
    function test_BeforeSwap_InvalidToken1() public {
        PoolKey memory key = _createPoolKey(INITIAL_FEE);
        key.currency1 = Currency.wrap(address(0));

        vm.expectRevert(DynamicFeeHook.InvalidTokenAddress.selector);
        hook.beforeSwap(
            address(this),
            key,
            IPoolManager.SwapParams({zeroForOne: true, amountSpecified: 1000, sqrtPriceLimitX96: 0}),
            ""
        );
    }

    // Removed incomplete comment block that was causing compilation errors
    /*notice Test afterSwap hook with positive volume
     */
    function test_AfterSwap_PositiveVolume() public {
        PoolKey memory key = _createPoolKey(INITIAL_FEE);
        uint256 swapAmount = 1000e18; // 1000 tokens

        // Mock FeeRegistry behavior
        // This is needed because our mock doesn't actually update fees
        vm.mockCall(
            address(feeRegistry), abi.encodeWithSelector(FeeRegistry.getFee.selector, key), abi.encode(INITIAL_FEE)
        );

        vm.recordLogs();

        // Call afterSwap
        bytes4 selector = hook.afterSwap(
            address(this),
            key,
            IPoolManager.SwapParams({zeroForOne: true, amountSpecified: int256(swapAmount), sqrtPriceLimitX96: 0}),
            BalanceDelta(int256(swapAmount), -int256(swapAmount / 2)),
            ""
        );

        assertEq(selector, hook.afterSwap.selector);
        _assertFeeUpdatedLog();
    }

    // Removed incomplete comment block that was causing compilation errors
    /*notice Test afterSwap hook with negative volume
     */
    function test_AfterSwap_NegativeVolume() public {
        PoolKey memory key = _createPoolKey(INITIAL_FEE);
        int256 swapAmount = -1000e18; // -1000 tokens

        // Mock FeeRegistry behavior
        vm.mockCall(
            address(feeRegistry), abi.encodeWithSelector(FeeRegistry.getFee.selector, key), abi.encode(INITIAL_FEE)
        );

        // The DynamicFeeHook calculates a new fee based on market conditions:
        // - High volatility (volatilityScore: 10000)
        // - Medium liquidity (liquidityScore: 5000)
        // - High activity (activityScore: 10000)
        // Expected calculated fee: EXPECTED_DYNAMIC_FEE (not the initial fee of 3000)
        // Expect the FeeUpdated event with the dynamically calculated fee
        vm.recordLogs();

        // Call afterSwap
        bytes4 selector = hook.afterSwap(
            address(this),
            key,
            IPoolManager.SwapParams({zeroForOne: true, amountSpecified: swapAmount, sqrtPriceLimitX96: 0}),
            BalanceDelta(swapAmount, -swapAmount / 2),
            ""
        );

        assertEq(selector, hook.afterSwap.selector);
        _assertFeeUpdatedLog();
    }

    // Removed incomplete comment block that was causing compilation errors
    /*notice Test afterSwap hook with zero volume
     */
    function test_AfterSwap_ZeroVolume() public {
        PoolKey memory key = _createPoolKey(INITIAL_FEE);

        // No event should be emitted for zero volume
        bytes4 selector = hook.afterSwap(
            address(this),
            key,
            IPoolManager.SwapParams({zeroForOne: true, amountSpecified: 0, sqrtPriceLimitX96: 0}),
            BalanceDelta(0, 0),
            ""
        );

        assertEq(selector, hook.afterSwap.selector);
    }

    // Removed incomplete comment block that was causing compilation errors
    /*notice Test fee calculation with small volume
     */
    function test_CalculateFee_SmallVolume() public {
        PoolKey memory key = _createPoolKey(INITIAL_FEE);
        uint256 amount = 100e18; // 100 tokens, below threshold

        // Mock FeeRegistry behavior
        vm.mockCall(
            address(feeRegistry), abi.encodeWithSelector(FeeRegistry.getFee.selector, key), abi.encode(INITIAL_FEE)
        );

        // Calculate fee
        uint256 feeAmount = hook.calculateFee(key, amount);

        // For small volume, fee should be base fee
        // amount * fee / 1e6 = 100e18 * 3000 / 1e6 = 300e15
        assertEq(feeAmount, 300e15);
    }

    // Removed incomplete comment block that was causing compilation errors
    /*notice Test fee calculation with large volume
     */
    function test_CalculateFee_LargeVolume() public {
        PoolKey memory key = _createPoolKey(INITIAL_FEE);
        uint256 amount = 5000e18; // 5000 tokens, above threshold

        // Mock FeeRegistry behavior
        vm.mockCall(
            address(feeRegistry), abi.encodeWithSelector(FeeRegistry.getFee.selector, key), abi.encode(INITIAL_FEE)
        );

        // Calculate fee
        uint256 feeAmount = hook.calculateFee(key, amount);

        // For volume = 5000e18, volumeMultiplier = 5
        // scaledFee = 3000 * 5 = 15000
        // feeAmount = 5000e18 * 15000 / 1e6 = 75e18
        assertEq(feeAmount, 75e18);
    }

    // Removed incomplete comment block that was causing compilation errors
    /*notice Test fee calculation with very large volume (exceeding MAX_VOLUME_MULTIPLIER)
     */
    function test_CalculateFee_VeryLargeVolume() public {
        PoolKey memory key = _createPoolKey(INITIAL_FEE);
        uint256 amount = 20000e18; // 20000 tokens, would give multiplier of 20 but should be capped at 10

        // Mock FeeRegistry behavior
        vm.mockCall(
            address(feeRegistry), abi.encodeWithSelector(FeeRegistry.getFee.selector, key), abi.encode(INITIAL_FEE)
        );

        // Calculate fee
        uint256 feeAmount = hook.calculateFee(key, amount);

        // For very large volume, multiplier should be capped at MAX_VOLUME_MULTIPLIER (5)
        // scaledFee = 3000 * 5 = 15000
        // feeAmount = 20000e18 * 15000 / 1e6 = 300e18
        assertEq(feeAmount, 300e18);
    }

    // Removed incomplete comment block that was causing compilation errors
    /*notice Test fee calculation with invalid fee
     */
    function test_CalculateFee_InvalidFee() public {
        PoolKey memory key = _createPoolKey(INITIAL_FEE);
        uint256 amount = 1000e18;

        // Mock FeeRegistry to return an invalid fee
        uint24 invalidFee = 75; // Below MIN_FEE
        vm.mockCall(
            address(feeRegistry), abi.encodeWithSelector(FeeRegistry.getFee.selector, key), abi.encode(invalidFee)
        );

        // Should revert with InvalidFee
        vm.expectRevert(abi.encodeWithSelector(DynamicFeeHook.InvalidFee.selector, invalidFee));
        hook.calculateFee(key, amount);
    }

    // Removed incomplete comment block that was causing compilation errors
    /*notice Test fee validation with valid fees
     */
    function test_ValidateFee_Valid() public {
        // Test minimum fee
        assertTrue(hook.validateFee(MIN_FEE));

        // Test maximum fee
        assertTrue(hook.validateFee(MAX_FEE));

        // Test fee in the middle
        assertTrue(hook.validateFee(3000));

        // Test fee that's a multiple of FEE_STEP
        assertTrue(hook.validateFee(MIN_FEE + FEE_STEP));
    }

    function _assertFeeUpdatedLog() private {
        Vm.Log[] memory entries = vm.getRecordedLogs();
        bytes32 expectedTopic = keccak256("FeeUpdated(address,address,uint24,uint256,uint256)");
        bool found;

        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].emitter != address(hook) || entries[i].topics[0] != expectedTopic) continue;

            (uint24 newFee, uint256 volatilityScore, uint256 liquidityScore) =
                abi.decode(entries[i].data, (uint24, uint256, uint256));

            assertEq(entries[i].topics[1], bytes32(uint256(uint160(address(token0)))));
            assertEq(entries[i].topics[2], bytes32(uint256(uint160(address(token1)))));
            assertEq(newFee, EXPECTED_DYNAMIC_FEE);
            assertEq(volatilityScore, 10000);
            assertEq(liquidityScore, 5000);
            found = true;
            break;
        }

        assertTrue(found, "FeeUpdated event not emitted");
    }

    // Removed incomplete comment block that was causing compilation errors
    /*notice Test fee validation with invalid fees
     */
    function test_ValidateFee_Invalid() public {
        // Test fee below minimum
        assertFalse(hook.validateFee(MIN_FEE - 1));

        // Test fee above maximum
        assertFalse(hook.validateFee(MAX_FEE + 1));

        // Test fee that's not a multiple of FEE_STEP
        assertFalse(hook.validateFee(MIN_FEE + 1));
    }

    // Removed incomplete comment block that was causing compilation errors
    /*notice Test constructor with invalid fee registry address
     */
    function test_Constructor_InvalidFeeRegistry() public {
        vm.expectRevert(DynamicFeeHook.InvalidTokenAddress.selector);
        new DynamicFeeHook(address(poolManager), address(0));
    }

    // Removed incomplete comment block that was causing compilation errors
} // Added missing closing brace for the contract
