// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {AetherVault} from "../src/vaults/AetherVault.sol";
import {AetherVaultFactory} from "../src/vaults/AetherVaultFactory.sol";
import {CrossChainLiquidityHook} from "../src/hooks/CrossChainLiquidityHook.sol";
import {IAetherPool} from "../src/interfaces/IAetherPool.sol";
import {MockPoolManager} from "./mocks/MockPoolManager.sol";
import {MockLayerZeroEndpoint} from "./mocks/MockLayerZeroEndpoint.sol";
import {MockAetherPool} from "./mocks/MockAetherPool.sol";
import {MockChainNetworks} from "./mocks/MockChainNetworks.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {PoolKey, IPoolManager, BalanceDelta} from "../src/interfaces/IPoolManager.sol";
import {TickMath} from "lib/v4-core/src/libraries/TickMath.sol";
import {IHooks} from "lib/v4-core/src/interfaces/IHooks.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract CrossChainIntegrationTest is Test {
    MockChainNetworks internal networks;
    uint16 internal srcChain;
    uint16 internal dstChain;

    address internal constant LP = address(1);

    function setUp() public {
        networks = new MockChainNetworks();
        srcChain = networks.ETHEREUM_CHAIN_ID();
        dstChain = networks.ARBITRUM_CHAIN_ID();
    }

    function test_CrossChainLiquidityRebalancing() public {
        // --- Test-Specific Setup ---
        vm.label(LP, "LP");

        // Deploy contracts for Source Chain (srcChain)
        vm.chainId(srcChain);
        address srcNativeToken = networks.getNativeToken(srcChain);
        MockERC20 srcToken1 = new MockERC20("T1", "T1", 18);
        vm.label(address(srcToken1), "SrcToken1");
        MockPoolManager srcPoolManager = new MockPoolManager(address(0));
        MockLayerZeroEndpoint srcLzEndpoint = new MockLayerZeroEndpoint();
        address srcHookToken0 = srcNativeToken < address(srcToken1) ? srcNativeToken : address(srcToken1);
        address srcHookToken1 = srcNativeToken < address(srcToken1) ? address(srcToken1) : srcNativeToken;
        MockAetherPool srcPool = new MockAetherPool(srcHookToken0, srcHookToken1, 3000);
        address srcPlaceholderPoolAddress = address(srcPool);
        CrossChainLiquidityHook srcHook =
            new CrossChainLiquidityHook(address(srcPoolManager), address(srcLzEndpoint), srcHookToken0, srcHookToken1);
        srcPoolManager.setHookAddress(address(srcHook));
        PoolKey memory srcKey =
            PoolKey({hooks: address(srcHook), token0: srcHookToken0, token1: srcHookToken1, fee: 3000, tickSpacing: 60});
        srcPoolManager.setPool(keccak256(abi.encode(srcKey)), srcPlaceholderPoolAddress);
        srcPoolManager.initialize(srcKey, TickMath.MIN_SQRT_PRICE + 1, "");

        // Deploy contracts for Destination Chain (dstChain)
        vm.chainId(dstChain);
        address dstNativeToken = networks.getNativeToken(dstChain);
        MockERC20 dstToken2 = new MockERC20("T2", "T2", 18);
        vm.label(address(dstToken2), "DstToken2");
        MockPoolManager dstPoolManager = new MockPoolManager(address(0));
        MockLayerZeroEndpoint dstLzEndpoint = new MockLayerZeroEndpoint();
        address dstHookToken0 = dstNativeToken < address(dstToken2) ? dstNativeToken : address(dstToken2);
        address dstHookToken1 = dstNativeToken < address(dstToken2) ? address(dstToken2) : dstNativeToken;
        MockAetherPool dstPool = new MockAetherPool(dstHookToken0, dstHookToken1, 3000);
        address dstPlaceholderPoolAddress = address(dstPool);
        CrossChainLiquidityHook dstHook =
            new CrossChainLiquidityHook(address(dstPoolManager), address(dstLzEndpoint), dstHookToken0, dstHookToken1);
        dstPoolManager.setHookAddress(address(dstHook));
        PoolKey memory dstKey =
            PoolKey({hooks: address(dstHook), token0: dstHookToken0, token1: dstHookToken1, fee: 3000, tickSpacing: 60});
        dstPoolManager.setPool(keccak256(abi.encode(dstKey)), dstPlaceholderPoolAddress);
        dstPoolManager.initialize(dstKey, TickMath.MIN_SQRT_PRICE + 1, "");

        // Set trusted remotes between hooks
        vm.chainId(srcChain);
        vm.prank(address(srcPoolManager));
        srcHook.setRemoteHook(dstChain, address(dstHook));

        vm.chainId(dstChain);
        vm.prank(address(dstPoolManager));
        dstHook.setRemoteHook(srcChain, address(srcHook));

        // Mint initial liquidity provider tokens
        networks.mintNativeToken(srcChain, LP, 1_000_000e18);
        networks.mintNativeToken(dstChain, LP, 1_000_000e18);
        vm.chainId(srcChain);
        srcToken1.mint(LP, 1_000_000e18);
        vm.chainId(dstChain);
        dstToken2.mint(LP, 1_000_000e18);

        // --- Arrange ---
        // Labels already set during deployment

        // Initial deposit on source chain
        vm.chainId(srcChain);
        vm.startPrank(LP);
        // Approve the actual native token contract (which is a MockERC20)
        MockERC20(srcNativeToken).approve(address(srcPoolManager), type(uint256).max);
        srcToken1.approve(address(srcPoolManager), type(uint256).max);

        int256 initialLiquidity = 100e18;
        IPoolManager.ModifyPositionParams memory params = IPoolManager.ModifyPositionParams({
            tickLower: TickMath.MIN_TICK,
            tickUpper: TickMath.MAX_TICK,
            liquidityDelta: initialLiquidity
        });
        BalanceDelta memory delta = srcPoolManager.modifyPosition(srcKey, params, "");
        vm.stopPrank();

        console.log("Initial Src Delta Amount0:", uint256(delta.amount0 * -1));
        console.log("Initial Src Delta Amount1:", uint256(delta.amount1 * -1));

        // --- Act ---
        // Setup for Destination Chain: Mint tokens to Hook and Approve Manager
        // This is necessary because MockPoolManager will try to pull tokens from the hook (msg.sender)
        vm.chainId(dstChain);
        MockERC20(dstHookToken0).mint(address(dstHook), 1_000_000e18);
        MockERC20(dstHookToken1).mint(address(dstHook), 1_000_000e18);
        vm.startPrank(address(dstHook));
        MockERC20(dstHookToken0).approve(address(dstPoolManager), type(uint256).max);
        MockERC20(dstHookToken1).approve(address(dstPoolManager), type(uint256).max);
        vm.stopPrank();

        // Simulate the LZ message reception on the destination chain
        // Construct the payload that would have been sent by the source hook
        // Payload uses token addresses from the *source* key
        bytes memory payload = abi.encode(srcKey.token0, srcKey.token1, initialLiquidity);
        // Construct the source address packed format (using local hook variables)
        bytes memory packedSrcAddress = abi.encodePacked(address(srcHook), address(dstHook));

        // Call lzReceive on the destination hook directly
        vm.chainId(dstChain);
        // Prank as the LayerZero endpoint for the destination chain
        vm.prank(address(dstLzEndpoint));
        dstHook.lzReceive(srcChain, address(srcHook), 1, payload);

        // --- Verification --- //
        // Assert that liquidity was added on the destination chain
        // The MockPoolManager now calls pool.mint() which updates the MockAetherPool state.

        // Check total liquidity in the destination pool
        // MockAetherPool tracks totalLiquidity
        assertEq(dstPool.totalLiquidity(), uint256(initialLiquidity), "Liquidity mismatch on destination chain");

        // Check that the pool received tokens
        // For MockAetherPool mint, amount0 and amount1 are equal to liquidity amount (simplified logic)
        // Verify balances of the pool
        assertEq(MockERC20(dstHookToken0).balanceOf(address(dstPool)), uint256(initialLiquidity), "dstPool Token0 balance mismatch");
        assertEq(MockERC20(dstHookToken1).balanceOf(address(dstPool)), uint256(initialLiquidity), "dstPool Token1 balance mismatch");
    }
}
