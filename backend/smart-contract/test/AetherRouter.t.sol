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
// import {console} from "forge-std/console.sol";
import {PoolKey} from "../src/types/PoolKey.sol";

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

    // Helper function to create PoolKey and calculate poolId
    function _createPoolKeyAndId(address token0, address token1, uint24 fee, int24 tickSpacing, address hooks)
        internal
        pure
        returns (PoolKey memory key, bytes32 poolId)
    {
        require(token0 < token1, "UNSORTED_TOKENS");
        key = PoolKey({token0: token0, token1: token1, fee: fee, tickSpacing: tickSpacing, hooks: hooks});
        poolId = keccak256(abi.encode(key));
    }

    function setUp() public {
        // console.log("Starting setUp...");
        // console.log("Test Contract Address (this):", address(this));
        // Deploy FeeRegistry
        // console.log("Deploying FeeRegistry with owner:", address(this));
        feeRegistry = new FeeRegistry();
        // console.log("FeeRegistry deployed at:", address(feeRegistry));

        // Add the default fee tier configuration used in tests (using 0.3% fee)
        // console.log("Adding fee tier 3000 with tick spacing 60 to FeeRegistry...");
        feeRegistry.addFeeConfiguration(3000, 60); // Assuming 3000 is the intended fee (0.3%)
        // console.log("Fee tier added.");

        // Deploy tokens
        // console.log("Deploying tokens...");
        weth = new MockERC20("Wrapped ETH", "WETH", 18);
        usdc = new MockERC20("USD Coin", "USDC", 6);
        dai = new MockERC20("DAI", "DAI", 18);
        // console.log("Tokens deployed.");

        // Pass owner, feeRegistry, and placeholder creationCodeHash
        factory = new AetherFactory(address(this), address(feeRegistry)); // Removed pool bytecode arg

        // Deploy MockPoolManager
        // console.log("Deploying MockPoolManager...");
        // Pass hook address (using address(0) as placeholder)
        mockPoolManager = new MockPoolManager(address(0));
        // console.log("MockPoolManager deployed at:", address(mockPoolManager));
        // Deploy router with mock cross-chain contracts
        // console.log("Deploying mock cross-chain contracts...");
        ccipRouter = address(new MockCCIPRouter());
        hyperlane = address(new MockHyperlane());
        linkToken = address(new MockERC20("LINK", "LINK", 18));
        // console.log("Mock contracts deployed.");
        // console.log("Deploying router with owner:", address(this));
        // Deploy router with required constructor args
        router = new AetherRouter(); // Default constructor takes no arguments
        // console.log("Router deployed at:", address(router));

        // Create pools with proper token ordering
        // console.log("Deploying and registering WETH/USDC pool (placeholder)...");
        (address wethUsdcPoolAddress, /* address wethUsdcVaultAddress */) = factory.createPool{value: factory.creationFee()}(
            address(weth),
            address(usdc),
            "WETH/USDC Vault",
            "WV"
        );
        // console.log("WETH/USDC Pool created:", wethUsdcPoolAddress, "Vault:", /* wethUsdcVaultAddress */);

        // console.log("Deploying and registering WETH/DAI pool (placeholder)...");
        (address wethDaiPoolAddress, /* address wethDaiVaultAddress */) = factory.createPool{value: factory.creationFee()}(
            address(weth),
            address(dai),
            "WETH/DAI Vault",
            "WD"
        );
        // console.log("WETH/DAI Pool created:", wethDaiPoolAddress, "Vault:", /* wethDaiVaultAddress */);

        // Mint tokens to test contract first before approvals
        // console.log("Minting initial tokens to test contract...");
        weth.mint(address(this), 10_000 ether); // Keep 10k WETH
        usdc.mint(address(this), 20_000_000 * 1e6); // Mint 20M USDC (10M for each pool)
        dai.mint(address(this), 10_000_000 ether); // Keep 10M DAI
        // console.log("Initial tokens minted.");
        // console.log("WETH balance:", weth.balanceOf(address(this)));
        // console.log("USDC balance:", usdc.balanceOf(address(this)));
        // console.log("DAI balance:", dai.balanceOf(address(this)));

        // Approve sufficient allowance for router with explicit amounts
        // console.log("Approving router...");
        uint256 maxAmount = type(uint256).max;
        weth.approve(address(router), maxAmount);
        usdc.approve(address(router), maxAmount);
        dai.approve(address(router), maxAmount);
        // console.log("Router approved.");

        // Add initial liquidity to pools with explicit approvals, balancing for decimals
        // console.log("Adding liquidity to WETH/USDC pool...");
        // Assuming 1 WETH = $2000, 1 USDC = $1. Provide $10M liquidity.
        // 5000 WETH = $10M
        // 10,000,000 USDC = $10M
        _addLiquidityToPoolWithApprovals(
            wethUsdcPoolAddress,
            address(weth),
            5_000 ether, // 5000 * 1e18 WETH
            address(usdc),
            10_000_000 * 1e6, // 10M * 1e6 USDC
            maxAmount
        );
        // console.log("Liquidity added to WETH/USDC pool.");
        // console.log("WETH balance after liq1:", weth.balanceOf(address(this)));
        // console.log("USDC balance after liq1:", usdc.balanceOf(address(this)));

        // console.log("Adding liquidity to USDC/DAI pool...");
        // Provide $10M liquidity (assuming 1 USDC = 1 DAI = $1)
        _addLiquidityToPoolWithApprovals(
            wethDaiPoolAddress,
            address(weth),
            5_000 ether, // Use remaining 5k WETH
            address(dai),
            10_000_000 ether, // 10M * 1e18 DAI
            maxAmount
        );
        // console.log("Liquidity added to USDC/DAI pool.");
        // console.log("USDC balance after liq2:", usdc.balanceOf(address(this)));
        // console.log("DAI balance after liq2:", dai.balanceOf(address(this)));

        // Verify balances after setup (USDC should be 0 after providing liquidity)
        // console.log("Verifying final balances...");
        // Check remaining balances after providing liquidity
        require(weth.balanceOf(address(this)) == 0, "Incorrect WETH balance after setup"); // 10k - 5k - 5k = 0
        require(usdc.balanceOf(address(this)) == 0, "Incorrect USDC balance after setup"); // 20M - 10M - 10M = 0
        require(dai.balanceOf(address(this)) == 0, "Incorrect DAI balance after setup"); // 10M - 10M = 0
        // console.log("Final balances verified.");

        // Fund test accounts
        // console.log("Funding test accounts...");
        vm.deal(alice, 100 ether);
        weth.mint(alice, 100 ether);
        usdc.mint(alice, 100_000 * 1e6);
        dai.mint(alice, 100_000 ether);
        // console.log("Alice funded.");

        // Approve router for test accounts
        // console.log("Approving router for Alice...");
        vm.startPrank(alice);
        weth.approve(address(router), type(uint256).max);
        usdc.approve(address(router), type(uint256).max);
        dai.approve(address(router), type(uint256).max);
        vm.stopPrank();
        // console.log("Router approved for Alice.");

        // console.log("Funding Bob...");
        vm.deal(bob, 100 ether);
        weth.mint(bob, 100 ether);
        usdc.mint(bob, 100_000 * 1e6);
        dai.mint(bob, 100_000 ether);
        // console.log("Bob funded.");
        // console.log("setUp finished.");
    }

    // Updated helper to handle token ordering correctly
    function _addLiquidityToPoolWithApprovals(
        address poolAddress,
        address tokenA,
        uint256 amountA, // Pass actual tokens and amounts
        address tokenB,
        uint256 amountB,
        uint256 approvalAmount // Use a single approval amount for simplicity (max uint)
    ) internal {
        require(poolAddress != address(0), "Pool not found");
        // IAetherPool pool = IAetherPool(poolAddress); // Commented out shadowed variable

        // address poolToken0 = IAetherPool(poolAddress).token0(); // Incorrect: IAetherPool has tokens()
        // address poolToken1 = IAetherPool(poolAddress).token1(); // Incorrect: IAetherPool has tokens()
        (address poolToken0, address poolToken1) = IAetherPool(poolAddress).tokens();

        // Determine the correct amounts based on the pool's token order
        uint256 amount0ForPool;
        uint256 amount1ForPool;

        if (tokenA == poolToken0 && tokenB == poolToken1) {
            amount0ForPool = amountA;
            amount1ForPool = amountB;
        } else if (tokenA == poolToken1 && tokenB == poolToken0) {
            amount0ForPool = amountB;
            amount1ForPool = amountA;
        } else {
            revert("Helper token mismatch"); // Should not happen if poolId is correct
        }

        // Tokens should already be minted in setUp to address(this)

        // Approve the pool to take the tokens from this contract (address(this))
        // Use the pool's actual token0 and token1 for approval targets
        // console.log("Approving pool %s for token0 %s amount %s", poolAddress, poolToken0, approvalAmount);
        MockERC20(poolToken0).approve(poolAddress, approvalAmount);
        // console.log("Approving pool %s for token1 %s amount %s", poolAddress, poolToken1, approvalAmount);
        MockERC20(poolToken1).approve(poolAddress, approvalAmount);
        // console.log("Pool approved for both tokens.");

        // Call mint with the correctly ordered amounts
        // console.log(
        //     "Calling pool.mint for pool %s with amount0 %s, amount1 %s", poolAddress, amount0ForPool, amount1ForPool
        // );
        // TODO: Add liquidity via PoolManager or update test logic
        // IAetherPool(poolAddress).mint(address(this), amount0ForPool, amount1ForPool); // Old incompatible call
        // console.log("pool.mint called successfully.");
    }

    // function test_SwapWithMultipleHops() public {
    //     // Test swapping WETH -> DAI -> USDC
    // }
}
