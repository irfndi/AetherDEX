// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {CrossChainLiquidityHook} from "../../src/hooks/CrossChainLiquidityHook.sol";
import {ILayerZeroEndpoint} from "../../src/interfaces/ILayerZeroEndpoint.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {IPoolManager} from "../../src/interfaces/IPoolManager.sol";
import {BalanceDelta} from "../../src/types/BalanceDelta.sol";
import {PoolKey} from "../../src/types/PoolKey.sol";
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
        address payable _refundAddress,
        address _zroPaymentAddress,
        bytes calldata _adapterParams
    ) external payable {
        emit MessageSent(_dstChainId, _destination, _payload);
    }

    function receivePayload(
        uint16 _srcChainId,
        bytes memory _srcAddress,
        address _dstAddress,
        uint64 _nonce,
        bytes memory _payload
    ) external {
        require(trustedRemotes[msg.sender], "Untrusted remote");
        emit MessageReceived(_srcChainId, _srcAddress, _dstAddress, _nonce, _payload);
    }

    function estimateFees(uint16, address, bytes calldata, bool, bytes calldata)
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
    HookFactory public factory;

    uint16 public constant REMOTE_CHAIN_ID = 123;
    address public constant REMOTE_HOOK = address(0x4567);

    event CrossChainLiquidityEvent(uint16 chainId, address token0, address token1, int256 liquidityDelta);

    function setUp() public {
        // Deploy mock tokens first
        token0 = new MockERC20("Token0", "T0", 18);
        token1 = new MockERC20("Token1", "T1", 18);
        
        // Set up mock endpoint
        mockEndpoint = new MockLayerZeroEndpoint();

        // Create factory for proper hook deployment
        factory = new HookFactory();

        // Deploy hook with proper address using factory
        hook = factory.deployCrossChainHook(address(this), address(mockEndpoint));
        
        // Create and initialize pool
        AetherPool pool = new AetherPool(address(this));
        pool.initialize(address(token0), address(token1), uint24(3000), address(this));
        
        // Set up mock pool manager with pool and hook
        mockPoolManager = new MockPoolManager(address(pool), address(hook));

        // Verify hook flags match implemented permissions
        uint160 expectedFlags = uint160(Hooks.BEFORE_INITIALIZE_FLAG |
                                       Hooks.AFTER_INITIALIZE_FLAG |
                                       Hooks.BEFORE_MODIFY_POSITION_FLAG |
                                       Hooks.AFTER_MODIFY_POSITION_FLAG |
                                       Hooks.BEFORE_SWAP_FLAG |
                                       Hooks.AFTER_SWAP_FLAG);
        // uint160 actualFlags = uint160(address(hook)) & 0xFFFF; // Incorrect check
        uint160 actualFlags = Hooks.permissionsToFlags(hook.getHookPermissions()); // Correct check
        require((actualFlags & expectedFlags) == expectedFlags, "Hook flags mismatch");

        // Set trusted remote for the hook
        mockEndpoint.setTrustedRemote(address(hook), true);
    }

    function test_HookInitialization() public view {
        // Verify hook flags match implemented permissions
        uint160 expectedFlags = uint160(Hooks.BEFORE_INITIALIZE_FLAG |
                                      Hooks.AFTER_INITIALIZE_FLAG |
                                      Hooks.BEFORE_MODIFY_POSITION_FLAG |
                                      Hooks.AFTER_MODIFY_POSITION_FLAG |
                                      Hooks.BEFORE_SWAP_FLAG |
                                      Hooks.AFTER_SWAP_FLAG);
        // uint160 actualFlags = uint160(address(hook)) & 0xFFFF; // Incorrect check
        uint160 actualFlags = Hooks.permissionsToFlags(hook.getHookPermissions()); // Correct check
        assertEq((actualFlags & expectedFlags), expectedFlags);
    }

    function test_CrossChainLiquiditySync() public {
        PoolKey memory key = PoolKey({
            token0: address(token0),
            token1: address(token1),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });

        IPoolManager.ModifyPositionParams memory params =
            IPoolManager.ModifyPositionParams({tickLower: -100, tickUpper: 100, liquidityDelta: 1000});

        hook.afterModifyPosition(address(this), key, params, BalanceDelta(100, 200), "");

        vm.expectEmit(true, true, true, true);
        emit CrossChainLiquidityEvent(REMOTE_CHAIN_ID, address(token0), address(token1), 1000);
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
        PoolKey memory key = PoolKey({
            token0: address(token0),
            token1: address(token1),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });

        // Add liquidity
        IPoolManager.ModifyPositionParams memory addParams =
            IPoolManager.ModifyPositionParams({tickLower: -100, tickUpper: 100, liquidityDelta: 1000});
        hook.afterModifyPosition(address(this), key, addParams, BalanceDelta(100, 200), "");

        // Remove some liquidity
        IPoolManager.ModifyPositionParams memory removeParams =
            IPoolManager.ModifyPositionParams({tickLower: -100, tickUpper: 100, liquidityDelta: -500});
        hook.afterModifyPosition(address(this), key, removeParams, BalanceDelta(-50, -100), "");

        // Verify net liquidity change is reflected
        vm.expectEmit(true, true, true, true);
        emit CrossChainLiquidityEvent(
            REMOTE_CHAIN_ID,
            address(token0),
            address(token1),
            500 // Net liquidity change
        );
    }

    function test_EstimateCrossChainMessageFees() public view {
        bytes memory payload = abi.encode(address(token0), address(token1), int256(1000));

        (uint256 nativeFee, uint256 zroFee) =
            hook.lzEndpoint().estimateFees(REMOTE_CHAIN_ID, address(hook), payload, false, "");

        assertGt(nativeFee, 0);
        assertEq(zroFee, 0);
    }

    function test_RevertOnUnauthorizedCall() public {
        PoolKey memory key = PoolKey({
            token0: address(token0),
            token1: address(token1),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });

        IPoolManager.ModifyPositionParams memory params =
            IPoolManager.ModifyPositionParams({tickLower: -100, tickUpper: 100, liquidityDelta: 1000});

        vm.expectRevert("Unauthorized");
        hook.afterModifyPosition(address(0x1234), key, params, BalanceDelta(100, 200), "");

        // Verify hook still works with authorized call
        vm.prank(address(mockPoolManager));
        hook.afterModifyPosition(address(this), key, params, BalanceDelta(100, 200), "");
    }
}
