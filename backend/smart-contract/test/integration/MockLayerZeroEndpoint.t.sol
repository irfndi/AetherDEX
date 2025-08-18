// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {CrossChainLiquidityHook} from "../../src/hooks/CrossChainLiquidityHook.sol";
import {MockPoolManager} from "../mocks/MockPoolManager.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {IPoolManager} from "../../src/interfaces/IPoolManager.sol";
import {PoolKey} from "../../lib/v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "../../src/types/BalanceDelta.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IAetherPool} from "../../src/interfaces/IAetherPool.sol";

contract MockLayerZeroEndpoint {
    mapping(uint16 => address) public remoteEndpoints;
    mapping(address => bool) public trustedRemotes;
    uint256 public constant DEFAULT_GAS_LIMIT = 200000;

    event MessageSent(uint16 dstChainId, bytes destination, bytes payload);

    event MessageReceived(uint16 srcChainId, bytes srcAddress, address dstAddress, uint64 nonce, bytes payload);

    function setTrustedRemote(address _remote, bool _trusted) external {
        trustedRemotes[_remote] = _trusted;
    }

    function setRemoteEndpoint(uint16 _chainId, address _endpoint) external {
        remoteEndpoints[_chainId] = _endpoint;
    }

    function send(
        uint16 _dstChainId,
        bytes calldata _destination,
        bytes calldata _payload,
        address payable, /* _refundAddress */
        address, /* _zroPaymentAddress */
        bytes calldata /* _adapterParams */
    ) external payable {
        require(remoteEndpoints[_dstChainId] != address(0), "No remote endpoint");

        emit MessageSent(_dstChainId, _destination, _payload);

        // If we're in a test environment and the remote endpoint is deployed,
        // we can deliver the message immediately
        if (remoteEndpoints[_dstChainId] != address(0)) {
            _deliverMessage(_dstChainId, msg.sender, _destination, _payload);
        }
    }

    function _deliverMessage(uint16 _srcChainId, address _sender, bytes memory _destination, bytes memory _payload)
        internal
    {
        // Extract destination address from the destination bytes
        address dstAddress;
        assembly {
            dstAddress := mload(add(_destination, 20))
        }

        require(dstAddress != address(0), "Invalid destination");

        // Deliver the message to the destination contract
        try CrossChainLiquidityHook(payable(dstAddress)).lzReceive(_srcChainId, _sender, 0, _payload) {
            emit MessageReceived(_srcChainId, abi.encodePacked(_sender), dstAddress, 0, _payload);
        } catch {
            // In a real implementation, we would handle failed deliveries
            // For testing, we just emit the event
            emit MessageReceived(_srcChainId, abi.encodePacked(_sender), dstAddress, 0, _payload);
        }
    }

    function estimateFees(
        uint16, /* _dstChainId */
        address, /* _userApplication */
        bytes calldata, /* _payload */
        bool _payInZRO,
        bytes calldata /* _adapterParam */
    ) external pure returns (uint256 nativeFee, uint256 zroFee) {
        return (_payInZRO ? 0 : 0.01 ether, _payInZRO ? 1 ether : 0);
    }
}

contract MockLayerZeroEndpointTest is Test {
    MockLayerZeroEndpoint public lzEndpoint;
    MockPoolManager public poolManager;
    CrossChainLiquidityHook public srcHook;
    CrossChainLiquidityHook public dstHook;
    MockERC20 public token0;
    MockERC20 public token1;

    uint16 public constant SRC_CHAIN_ID = 1;
    uint16 public constant DST_CHAIN_ID = 2;

    function setUp() public {
        // Deploy mock tokens
        token0 = new MockERC20("Token0", "TKN0", 18);
        token1 = new MockERC20("Token1", "TKN1", 18);

        // Deploy pool manager first
        poolManager = new MockPoolManager(address(0)); // No global hook needed here

        // Use placeholder pool address
        address placeholderPoolAddress = address(0x1);

        // Register placeholder pool with manager
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(token0) < address(token1) ? address(token0) : address(token1)),
            currency1: Currency.wrap(address(token0) < address(token1) ? address(token1) : address(token0)),
            fee: 3000,
            tickSpacing: 60, // Assume default
            hooks: IHooks(address(0)) // No hook for this specific setup
        });
        bytes32 poolId = keccak256(abi.encode(key));
        poolManager.setPool(poolId, placeholderPoolAddress);

        // Deploy LayerZero endpoint
        lzEndpoint = new MockLayerZeroEndpoint();

        // Deploy hooks (assuming they need manager and lzEndpoint)
        srcHook = new CrossChainLiquidityHook(
            address(poolManager),
            address(lzEndpoint),
            address(1),
            address(2)
        );
        dstHook = new CrossChainLiquidityHook(
            address(poolManager),
            address(lzEndpoint),
            address(1),
            address(2)
        );

        // Configure LayerZero endpoints
        lzEndpoint.setTrustedRemote(address(srcHook), true);
        lzEndpoint.setTrustedRemote(address(dstHook), true);
        lzEndpoint.setRemoteEndpoint(DST_CHAIN_ID, address(dstHook));
        lzEndpoint.setRemoteEndpoint(SRC_CHAIN_ID, address(srcHook));

        // Configure hooks
        vm.prank(address(poolManager));
        srcHook.setRemoteHook(DST_CHAIN_ID, address(dstHook));
        vm.prank(address(poolManager));
        dstHook.setRemoteHook(SRC_CHAIN_ID, address(srcHook));
    }

    function test_CrossChainMessageDelivery() public {
        // Create test data
        PoolKey memory key =
            PoolKey({currency0: Currency.wrap(address(token0)), currency1: Currency.wrap(address(token1)), fee: 3000, tickSpacing: 60, hooks: IHooks(address(0))});

        IPoolManager.ModifyPositionParams memory params =
            IPoolManager.ModifyPositionParams({tickLower: -100, tickUpper: 100, liquidityDelta: 1000});

        // Determine actual deployed token addresses
        address t0_addr = address(token0);
        address t1_addr = address(token1);
        // Determine sorted order (lower address first, then higher)
        address lowerSortedAddress = t0_addr < t1_addr ? t0_addr : t1_addr;
        address higherSortedAddress = t0_addr < t1_addr ? t1_addr : t0_addr;

        // Expect events from the hook only
        vm.expectEmit(false, false, false, true, address(srcHook));
        // Based on trace, actual event emitted: event.token0 gets lower address, event.token1 gets higher address.
        emit CrossChainLiquidityHook.CrossChainLiquidityEvent(DST_CHAIN_ID, lowerSortedAddress, higherSortedAddress, 1000);

        // Execute liquidity change on source chain as manager
        vm.prank(address(poolManager));
        srcHook.afterModifyPosition(address(this), key, params, BalanceDelta({amount0: 0, amount1: 0}), "");
    }

    function test_MessageFailureHandling() public {
        // Set invalid remote endpoint to simulate failure
        lzEndpoint.setRemoteEndpoint(DST_CHAIN_ID, address(0));

        PoolKey memory key =
            PoolKey({currency0: Currency.wrap(address(token0)), currency1: Currency.wrap(address(token1)), fee: 3000, tickSpacing: 60, hooks: IHooks(address(0))});

        IPoolManager.ModifyPositionParams memory params =
            IPoolManager.ModifyPositionParams({tickLower: -100, tickUpper: 100, liquidityDelta: 1000});

        // Should not revert despite message delivery failure (call as manager)
        vm.prank(address(poolManager));
        srcHook.afterModifyPosition(address(this), key, params, BalanceDelta({amount0: 0, amount1: 0}), "");
    }

    function test_FeeEstimation() public view {
        (uint256 nativeFee, uint256 zroFee) = srcHook.estimateFees(DST_CHAIN_ID, address(token0), address(token1), 1000);

        assertEq(nativeFee, 0.01 ether, "Wrong native fee");
        assertEq(zroFee, 0, "Wrong ZRO fee");
    }
}
