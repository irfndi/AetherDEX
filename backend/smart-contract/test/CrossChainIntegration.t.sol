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
import {MockChainNetworks} from "./mocks/MockChainNetworks.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {PoolKey} from "../lib/v4-core/src/types/PoolKey.sol";
import {IPoolManager} from "../src/interfaces/IPoolManager.sol";
import {BalanceDelta} from "../src/types/BalanceDelta.sol";
import {Currency} from "../lib/v4-core/src/types/Currency.sol";
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

    struct TestContracts {
        MockPoolManager srcPoolManager;
        MockPoolManager dstPoolManager;
        CrossChainLiquidityHook srcHook;
        CrossChainLiquidityHook dstHook;
        MockLayerZeroEndpoint srcLzEndpoint;
        MockLayerZeroEndpoint dstLzEndpoint;
        MockERC20 srcToken1;
        MockERC20 dstToken2;
        PoolKey srcKey;
        PoolKey dstKey;
    }

    function test_CrossChainLiquidityRebalancing() public {
        vm.label(LP, "LP");
        
        TestContracts memory contracts = _setupTestContracts();
        _setupTrustedRemotes(contracts);
        _mintInitialTokens(contracts);
        
        int256 initialLiquidity = _performInitialDeposit(contracts);
        _simulateCrossChainMessage(contracts, initialLiquidity);
    }

    function _setupTestContracts() private returns (TestContracts memory contracts) {
        // Setup source chain
        vm.chainId(srcChain);
        address srcNativeToken = networks.getNativeToken(srcChain);
        contracts.srcToken1 = new MockERC20("T1", "T1", 18);
        vm.label(address(contracts.srcToken1), "SrcToken1");
        contracts.srcPoolManager = new MockPoolManager(address(0));
        contracts.srcLzEndpoint = new MockLayerZeroEndpoint();
        
        address srcHookToken0 = srcNativeToken < address(contracts.srcToken1) ? srcNativeToken : address(contracts.srcToken1);
        address srcHookToken1 = srcNativeToken < address(contracts.srcToken1) ? address(contracts.srcToken1) : srcNativeToken;
        contracts.srcHook = new CrossChainLiquidityHook(address(contracts.srcPoolManager), address(contracts.srcLzEndpoint), srcHookToken0, srcHookToken1);
        contracts.srcPoolManager.setHookAddress(address(contracts.srcHook));
        contracts.srcKey = PoolKey({hooks: IHooks(address(contracts.srcHook)), currency0: Currency.wrap(srcHookToken0), currency1: Currency.wrap(srcHookToken1), fee: 3000, tickSpacing: 60});
        contracts.srcPoolManager.setPool(keccak256(abi.encode(contracts.srcKey)), address(0x1));
        contracts.srcPoolManager.initialize(contracts.srcKey, TickMath.MIN_SQRT_PRICE + 1, "");

        // Setup destination chain
        vm.chainId(dstChain);
        address dstNativeToken = networks.getNativeToken(dstChain);
        contracts.dstToken2 = new MockERC20("T2", "T2", 18);
        vm.label(address(contracts.dstToken2), "DstToken2");
        contracts.dstPoolManager = new MockPoolManager(address(0));
        contracts.dstLzEndpoint = new MockLayerZeroEndpoint();
        
        address dstHookToken0 = dstNativeToken < address(contracts.dstToken2) ? dstNativeToken : address(contracts.dstToken2);
        address dstHookToken1 = dstNativeToken < address(contracts.dstToken2) ? address(contracts.dstToken2) : dstNativeToken;
        contracts.dstHook = new CrossChainLiquidityHook(address(contracts.dstPoolManager), address(contracts.dstLzEndpoint), dstHookToken0, dstHookToken1);
        contracts.dstPoolManager.setHookAddress(address(contracts.dstHook));
        contracts.dstKey = PoolKey({hooks: IHooks(address(contracts.dstHook)), currency0: Currency.wrap(dstHookToken0), currency1: Currency.wrap(dstHookToken1), fee: 3000, tickSpacing: 60});
        contracts.dstPoolManager.setPool(keccak256(abi.encode(contracts.dstKey)), address(0x2));
        contracts.dstPoolManager.initialize(contracts.dstKey, TickMath.MIN_SQRT_PRICE + 1, "");
    }

    function _setupTrustedRemotes(TestContracts memory contracts) private {
        vm.chainId(srcChain);
        vm.prank(address(contracts.srcPoolManager));
        contracts.srcHook.setRemoteHook(dstChain, address(contracts.dstHook));

        vm.chainId(dstChain);
        vm.prank(address(contracts.dstPoolManager));
        contracts.dstHook.setRemoteHook(srcChain, address(contracts.srcHook));
    }

    function _mintInitialTokens(TestContracts memory contracts) private {
        networks.mintNativeToken(srcChain, LP, 1_000_000e18);
        networks.mintNativeToken(dstChain, LP, 1_000_000e18);
        vm.chainId(srcChain);
        contracts.srcToken1.mint(LP, 1_000_000e18);
        vm.chainId(dstChain);
        contracts.dstToken2.mint(LP, 1_000_000e18);
    }

    function _performInitialDeposit(TestContracts memory contracts) private returns (int256 initialLiquidity) {
        vm.chainId(srcChain);
        vm.startPrank(LP);
        MockERC20(Currency.unwrap(contracts.srcKey.currency0)).approve(address(contracts.srcPoolManager), type(uint256).max);
        MockERC20(Currency.unwrap(contracts.srcKey.currency1)).approve(address(contracts.srcPoolManager), type(uint256).max);

        initialLiquidity = 100e18;
        IPoolManager.ModifyPositionParams memory params = IPoolManager.ModifyPositionParams({
            tickLower: TickMath.MIN_TICK,
            tickUpper: TickMath.MAX_TICK,
            liquidityDelta: initialLiquidity
        });
        BalanceDelta memory delta = contracts.srcPoolManager.modifyPosition(contracts.srcKey, params, "");
        vm.stopPrank();

        console.log("Initial Src Delta Amount0:", uint256(delta.amount0 * -1));
        console.log("Initial Src Delta Amount1:", uint256(delta.amount1 * -1));
    }

    function _simulateCrossChainMessage(TestContracts memory contracts, int256 initialLiquidity) private {
        bytes memory payload = abi.encode(Currency.unwrap(contracts.srcKey.currency0), Currency.unwrap(contracts.srcKey.currency1), initialLiquidity);
        
        vm.chainId(dstChain);
        vm.prank(address(contracts.dstLzEndpoint));
        contracts.dstHook.lzReceive(srcChain, address(contracts.srcHook), 1, payload);
    }
}
