// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {AetherFactory} from "../src/primary/AetherFactory.sol";
import {AetherRouter} from "../src/primary/AetherRouter.sol";
import {IAetherPool} from "../src/interfaces/IAetherPool.sol";
import {FeeRegistry} from "../src/primary/FeeRegistry.sol";
import {MockPoolManager} from "./mocks/MockPoolManager.sol";
import {MockCCIPRouter} from "./mocks/MockCCIPRouter.sol";
import {MockHyperlane} from "./mocks/MockHyperlane.sol";
import {console} from "forge-std/console.sol";
import {PoolKey} from "../src/types/PoolKey.sol";
import {MockAetherPool} from "./mocks/MockAetherPool.sol";

contract AetherRouterTest is Test {
    AetherRouter public router;
    AetherFactory public factory;
    FeeRegistry public feeRegistry;
    IAetherPool public pool;
    MockPoolManager public mockPoolManager;
    MockERC20 public weth;
    MockERC20 public usdc;
    MockERC20 public dai;
    address public ccipRouter;
    address public hyperlane;
    address public linkToken;

    address public alice = address(0x1);
    address public bob = address(0x2);

    function setUp() public {
        // Deploy tokens
        weth = new MockERC20("Wrapped ETH", "WETH", 18);
        usdc = new MockERC20("USD Coin", "USDC", 6);
        dai = new MockERC20("DAI", "DAI", 18);

        // Deploy router
        router = new AetherRouter();

        // Mint tokens to this contract
        weth.mint(address(this), 10000 ether);
        usdc.mint(address(this), 10000000 * 1e6);
        dai.mint(address(this), 10000000 ether);

        // Deploy Mock Pool
        // Ensure token order
        address token0 = address(weth) < address(usdc) ? address(weth) : address(usdc);
        address token1 = address(weth) < address(usdc) ? address(usdc) : address(weth);
        pool = new MockAetherPool(token0, token1, 3000);

        // Approve router
        weth.approve(address(router), type(uint256).max);
        usdc.approve(address(router), type(uint256).max);
        dai.approve(address(router), type(uint256).max);
    }

    function test_addLiquidity_Initial() public {
        (address token0, address token1) = pool.tokens();

        uint256 amount0Desired;
        uint256 amount1Desired;

        if (token0 == address(weth)) {
            amount0Desired = 100 ether;
            amount1Desired = 200_000 * 1e6;
        } else {
            amount0Desired = 200_000 * 1e6;
            amount1Desired = 100 ether;
        }

        uint256 amount0Min = amount0Desired * 90 / 100;
        uint256 amount1Min = amount1Desired * 90 / 100;
        uint256 deadline = block.timestamp + 100;

        (uint256 amountA, uint256 amountB, uint256 liquidity) = router.addLiquidity(
            address(pool),
            amount0Desired,
            amount1Desired,
            amount0Min,
            amount1Min,
            address(this),
            deadline
        );

        // Check liquidity
        assertGt(liquidity, 0, "Liquidity should be minted");
        assertEq(amountA, amount0Desired, "Should use all desired amountA for initial");
        assertEq(amountB, amount1Desired, "Should use all desired amountB for initial");

        // Check pool reserves (MockAetherPool specific)
        assertGt(pool.reserve0(), 0, "Reserve0 should be > 0");
        assertGt(pool.reserve1(), 0, "Reserve1 should be > 0");
    }

    function test_addLiquidity_Subsequent() public {
        // First add initial liquidity
        test_addLiquidity_Initial();

        uint256 initialLiquidity = MockAetherPool(address(pool)).liquidityOf(address(this));
        uint256 initialReserve0 = pool.reserve0();
        uint256 initialReserve1 = pool.reserve1();

        (address token0, ) = pool.tokens();

        uint256 amount0Desired;
        uint256 amount1Desired;

        // Add same ratio
        if (token0 == address(weth)) {
            amount0Desired = 100 ether;
            amount1Desired = 200_000 * 1e6;
        } else {
            amount0Desired = 200_000 * 1e6;
            amount1Desired = 100 ether;
        }

        uint256 amount0Min = amount0Desired * 90 / 100;
        uint256 amount1Min = amount1Desired * 90 / 100;
        uint256 deadline = block.timestamp + 100;

        (uint256 amountA, uint256 amountB, uint256 liquidity) = router.addLiquidity(
            address(pool),
            amount0Desired,
            amount1Desired,
            amount0Min,
            amount1Min,
            address(this),
            deadline
        );

        // Check liquidity
        assertGt(liquidity, 0, "Liquidity should be minted");
        assertEq(amountA, amount0Desired, "Should use all desired amountA for subsequent");
        assertEq(amountB, amount1Desired, "Should use all desired amountB for subsequent");

        // Verify total liquidity increased
        assertGt(MockAetherPool(address(pool)).liquidityOf(address(this)), initialLiquidity, "Total liquidity should increase");
    }
}
