// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {CrossChainLiquidityHook} from "../../src/hooks/CrossChainLiquidityHook.sol";
import {MockPoolManager} from "./MockPoolManager.sol";
import {MockERC20} from "./MockERC20.sol";
import {IPoolManager} from "../../src/interfaces/IPoolManager.sol";
import {PoolKey} from "../../src/types/PoolKey.sol";
import {BalanceDelta} from "../../src/types/BalanceDelta.sol";
import {AetherPool} from "../../src/AetherPool.sol";

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
        try CrossChainLiquidityHook(payable(dstAddress)).lzReceive(_srcChainId, abi.encodePacked(_sender), 0, _payload)
        {
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
    ) external view returns (uint256 nativeFee, uint256 zroFee) {
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

        // Deploy and initialize pool
        AetherPool pool = new AetherPool(address(this)); // Assuming factory address is 'this'
        pool.initialize(address(token0), address(token1), uint24(3000)); // Removed last argument

        // Deploy LayerZero endpoint
        lzEndpoint = new MockLayerZeroEndpoint();

        // Deploy pool manager first (needed for hook deployment)
        // Note: We pass a placeholder for the hook initially, or deploy the hook later if needed by manager constructor
        // Assuming MockPoolManager constructor doesn't strictly need the final hook address immediately
        poolManager = new MockPoolManager(address(0)); // Pass only hook address

        // Deploy hooks, passing the actual poolManager address
        srcHook = new CrossChainLiquidityHook(address(poolManager), address(lzEndpoint));
        dstHook = new CrossChainLiquidityHook(address(poolManager), address(lzEndpoint));

        // If MockPoolManager needs the real hook address set after deployment, do it here
        // Example: poolManager.setHook(address(srcHook)); // Uncomment if needed

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
            PoolKey({token0: address(token0), token1: address(token1), fee: 3000, tickSpacing: 60, hooks: address(0)});

        IPoolManager.ModifyPositionParams memory params =
            IPoolManager.ModifyPositionParams({tickLower: -100, tickUpper: 100, liquidityDelta: 1000});

        // Expect events from both source and destination
        vm.expectEmit(true, true, true, true);
        emit CrossChainLiquidityHook.CrossChainLiquidityEvent(DST_CHAIN_ID, address(token0), address(token1), 1000);

        // Execute liquidity change on source chain
        srcHook.afterModifyPosition(address(this), key, params, BalanceDelta({amount0: 0, amount1: 0}), "");
    }

    function test_MessageFailureHandling() public {
        // Set invalid remote endpoint to simulate failure
        lzEndpoint.setRemoteEndpoint(DST_CHAIN_ID, address(0));

        PoolKey memory key =
            PoolKey({token0: address(token0), token1: address(token1), fee: 3000, tickSpacing: 60, hooks: address(0)});

        IPoolManager.ModifyPositionParams memory params =
            IPoolManager.ModifyPositionParams({tickLower: -100, tickUpper: 100, liquidityDelta: 1000});

        // Should not revert despite message delivery failure
        srcHook.afterModifyPosition(address(this), key, params, BalanceDelta({amount0: 0, amount1: 0}), "");
    }

    function test_FeeEstimation() public {
        (uint256 nativeFee, uint256 zroFee) = srcHook.estimateFees(DST_CHAIN_ID, address(token0), address(token1), 1000);

        assertEq(nativeFee, 0.01 ether, "Wrong native fee");
        assertEq(zroFee, 0, "Wrong ZRO fee");
    }
}
