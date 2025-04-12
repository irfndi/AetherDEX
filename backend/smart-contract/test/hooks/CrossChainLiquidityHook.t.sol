// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {stdError} from "forge-std/StdError.sol";
import "forge-std/console.sol"; // Import console for logging

import {CrossChainLiquidityHook} from "../../src/hooks/CrossChainLiquidityHook.sol";
import {ILayerZeroEndpoint} from "../../src/interfaces/ILayerZeroEndpoint.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {IPoolManager} from "../../src/interfaces/IPoolManager.sol";
import {PoolKey} from "../../src/types/PoolKey.sol";
import {BalanceDelta} from "../../src/types/BalanceDelta.sol";
import {Hooks} from "../../src/libraries/Hooks.sol";
import {MockPoolManager} from "../mocks/MockPoolManager.sol";
import {HookFactory} from "../utils/HookFactory.sol";
import {AetherPool} from "../../src/AetherPool.sol";

// Mock LayerZero Endpoint for testing
contract MockLayerZeroEndpoint is ILayerZeroEndpoint {
    mapping(uint16 => address) public remoteEndpoints;
    mapping(address => bool) public trustedRemotes;

    event MessageSent(uint16 dstChainId, bytes destination, bytes payload);
    event MessageReceived(uint16 srcChainId, bytes srcAddress, address dstAddress, uint64 nonce, bytes payload);

    function send(
        uint16 _dstChainId,
        bytes calldata _destination,
        bytes calldata _payload,
        address payable /*_refundAddress*/,
        address /*_zroPaymentAddress*/,
        bytes calldata /*_adapterParams*/
    ) external payable {
        emit MessageSent(_dstChainId, _destination, _payload);
    }

    function receivePayload(
        uint16 _srcChainId,
        bytes memory _srcAddress,
        address _dstAddress,
        uint64 /*_nonce*/,
        bytes memory _payload
    ) external {
        require(trustedRemotes[msg.sender], "Untrusted remote");
        emit MessageReceived(_srcChainId, _srcAddress, _dstAddress, 0, _payload);
    }

    function estimateFees(uint16 /*_dstChainId*/, address /*_userApplication*/, bytes calldata /*_payload*/, bool /*useZro*/, bytes calldata /*_adapterParam*/)
        external
        pure
        returns (uint256 nativeFee, uint256 zroFee)
    {
        return (0.01 ether, 0);
    }

    function setTrustedRemote(address _remote, bool _trusted) external {
        trustedRemotes[_remote] = _trusted;
    }

    function setRemoteEndpoint(uint16 _chainId, address _endpoint) external {
        remoteEndpoints[_chainId] = _endpoint;
    }
}

contract CrossChainLiquidityHookTest is Test {
    CrossChainLiquidityHook public hook;
    MockPoolManager public mockPoolManager;
    MockLayerZeroEndpoint public mockEndpoint;
    MockERC20 public token0;
    MockERC20 public token1;
    HookFactory public hookFactory;
    AetherPool public mockPool;
    PoolKey public key;

    uint16 public constant REMOTE_CHAIN_ID = 123;
    address public constant REMOTE_HOOK = address(0x4567);

    event CrossChainLiquidityEvent(uint16 chainId, address token0, address token1, int256 liquidityDelta);

    function setUp() public {
        // Deploy Mock contracts
        token0 = new MockERC20("Token0", "T0", 18); // Add decimals back
        token1 = new MockERC20("Token1", "T1", 18); // Add decimals back
        mockEndpoint = new MockLayerZeroEndpoint();
        hookFactory = new HookFactory();

        // Deploy AetherPool (needed for PoolKey context)
        mockPool = new AetherPool(address(this)); // Pool manager is 'this' for initialization purposes
        mockPool.initialize(address(token0), address(token1), 3000);

        // Deploy the actual Pool Manager mock AFTER other mocks
        mockPoolManager = new MockPoolManager(address(0)); // Pass address(0) as initial hook address

        // --- Deploy the Hook with the CORRECT Pool Manager --- 
        // The hook needs to know the address of the *actual* manager it should trust
        hook = hookFactory.deployCrossChainHook(address(mockPoolManager), address(mockEndpoint));

        // Define PoolKey
        key = PoolKey({token0: address(token0), token1: address(token1), fee: 3000, tickSpacing: 60, hooks: address(hook)});

        // Verify hook flags match implemented permissions
        uint160 expectedFlags = uint160(Hooks.AFTER_MODIFY_POSITION_FLAG);

        uint160 actualFlags = Hooks.permissionsToFlags(hook.getHookPermissions()); // Correct check
        require((actualFlags & expectedFlags) == expectedFlags, "Hook flags mismatch");

        // Set trusted remote on the LayerZero endpoint mock
        mockEndpoint.setTrustedRemote(address(hook), true);

        // Configure the remote hook for the test chain ID on the hook itself
        // This allows the hook to know which addresses are valid sources for messages
        vm.prank(address(mockPoolManager)); // Prank as the correct manager
        hook.setRemoteHook(REMOTE_CHAIN_ID, REMOTE_HOOK); // This call requires the prank

        // No stopPrank needed here as the setUp function ends
    }

    function test_HookInitialization() public view {
        // Verify hook flags match implemented permissions
        uint160 expectedFlags = uint160(Hooks.AFTER_MODIFY_POSITION_FLAG);

        uint160 actualFlags = Hooks.permissionsToFlags(hook.getHookPermissions()); // Correct check
        assertEq((actualFlags & expectedFlags), expectedFlags);
    }

    function test_CrossChainLiquiditySync() public {
        IPoolManager.ModifyPositionParams memory params =
            IPoolManager.ModifyPositionParams({tickLower: -100, tickUpper: 100, liquidityDelta: 1000});

        vm.expectEmit(true, true, true, true);
        emit CrossChainLiquidityEvent(REMOTE_CHAIN_ID, address(token0), address(token1), 1000);

        vm.prank(address(mockPoolManager));
        hook.afterModifyPosition(address(this), key, params, BalanceDelta(100, 200), "");
    }

    function test_CrossChainMessageReceive() public {
        bytes memory srcAddress = abi.encodePacked(REMOTE_HOOK);
        bytes memory payload = abi.encode(address(token0), address(token1), int256(1000));

        vm.prank(address(mockEndpoint));
        hook.lzReceive(REMOTE_CHAIN_ID, srcAddress, 0, payload);
    }

    function test_RevertOnUnauthorizedMessageSender() public {
        bytes memory srcAddress = abi.encodePacked(REMOTE_HOOK);
        bytes memory payload = abi.encode(address(token0), address(token1), int256(1000));

        vm.expectRevert("Unauthorized");
        hook.lzReceive(REMOTE_CHAIN_ID, srcAddress, 0, payload);
    }

    function test_CrossChainLiquidityRebalance() public {
        // Add liquidity
        IPoolManager.ModifyPositionParams memory addParams =
            IPoolManager.ModifyPositionParams({tickLower: -100, tickUpper: 100, liquidityDelta: 1000});
        vm.prank(address(mockPoolManager));
        hook.afterModifyPosition(address(this), key, addParams, BalanceDelta(100, 200), "");

        // Remove some liquidity
        IPoolManager.ModifyPositionParams memory removeParams =
            IPoolManager.ModifyPositionParams({tickLower: -100, tickUpper: 100, liquidityDelta: -500});

        vm.expectEmit(true, true, true, true);
        emit CrossChainLiquidityEvent(
            REMOTE_CHAIN_ID,
            address(token0),
            address(token1),
            -500 // Expect the delta from the second call
        );

        vm.prank(address(mockPoolManager));
        hook.afterModifyPosition(address(this), key, removeParams, BalanceDelta(-50, -100), "");
    }

    function test_EstimateCrossChainMessageFees() public view {
        bytes memory payload = abi.encode(address(token0), address(token1), int256(1000));

        (uint256 nativeFee, uint256 zroFee) =
            hook.lzEndpoint().estimateFees(REMOTE_CHAIN_ID, address(hook), payload, false, "");

        assertGt(nativeFee, 0);
        assertEq(zroFee, 0);
    }

    function test_RevertOnUnauthorizedCall() public {
        IPoolManager.ModifyPositionParams memory params =
            IPoolManager.ModifyPositionParams({tickLower: -100, tickUpper: 100, liquidityDelta: 1000});

        vm.expectRevert("Only pool manager"); // Expect correct revert message
        hook.afterModifyPosition(address(0x1234), key, params, BalanceDelta(100, 200), "");

        // Verify hook still works with authorized call
        vm.prank(address(mockPoolManager));
        hook.afterModifyPosition(address(this), key, params, BalanceDelta(100, 200), "");
    }
}
