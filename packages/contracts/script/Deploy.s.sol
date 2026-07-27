// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import "forge-std/Script.sol";
import {AetherFactory} from "../src/factory/AetherFactory.sol";
import {AetherRouter} from "../src/router/AetherRouter.sol";
import {AetherPositionManager} from "../src/position/AetherPositionManager.sol";
import {AetherHook} from "../src/hook/AetherHook.sol";
import {AetherHookAddressMiner} from "../src/hook/AetherHookAddressMiner.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";

/// @title AetherDEX Deploy Script
/// @notice Deploys AetherDEX contracts to a network (testnet or mainnet)
/// @dev Run: forge script script/Deploy.s.sol --rpc-url sepolia --broadcast --verify
contract Deploy is Script {
    // Sepolia Uniswap V4 PoolManager address
    address constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;

    /// @dev Upper bound for the CREATE2 salt search. The hook needs a 2-bit address suffix
    ///      (BEFORE_SWAP | AFTER_SWAP), so a valid salt is found in ~2^14 iterations on average.
    uint256 constant HOOK_SALT_MAX_ITERATIONS = 100_000;

    /// @notice The exact permission set AetherHook implements (beforeSwap + afterSwap).
    /// @dev V4 encodes hook permissions in the low 14 bits of the hook's address:
    ///      beforeSwap = bit 6 (Hooks.BEFORE_SWAP_FLAG = 0x0040),
    ///      afterSwap  = bit 7 (Hooks.AFTER_SWAP_FLAG  = 0x0080),
    ///      so the deployment address must carry exactly BEFORE_SWAP | AFTER_SWAP = 0x00c0
    ///      and no other flag bits (AetherHookAddressMiner.REQUIRED_FLAGS).
    function _hookPermissions() internal pure returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        // treasury multisig — receives the AetherRouter's IMMUTABLE 0.1% entry fee on
        // liquidity deposits (Phase 4). TODO(#314): set AETHERDEX_TREASURY to the
        // production multisig address for the target network before broadcasting.
        address treasury = vm.envAddress("AETHERDEX_TREASURY");

        vm.startBroadcast(deployerPrivateKey);
        address deployer = vm.addr(deployerPrivateKey);

        // 1. Deploy AetherHook via CREATE2 with a mined salt.
        //    V4 reads hook permissions from the hook ADDRESS itself, so the hook can only
        //    be placed at an address whose flag bits match `_hookPermissions()`; the salt is
        //    mined off-chain (AetherHookAddressMiner.findSalt) against the broadcast EOA as
        //    the CREATE2 deployer. The constructor also self-validates and would revert on a
        //    mismatched address. Phase 4: the hook is oracle-only — no treasury/fee args.
        bytes memory hookCtorArgs = abi.encode(IPoolManager(POOL_MANAGER));
        bytes32 hookInitCodeHash = keccak256(abi.encodePacked(type(AetherHook).creationCode, hookCtorArgs));
        (bool saltFound, bytes32 hookSalt,) =
            AetherHookAddressMiner.findSalt(deployer, hookInitCodeHash, HOOK_SALT_MAX_ITERATIONS);
        require(saltFound, "Deploy: no CREATE2 salt satisfies BEFORE_SWAP|AFTER_SWAP flags");
        AetherHook hook = new AetherHook{salt: hookSalt}(IPoolManager(POOL_MANAGER));
        // Fail loudly if the deployed address does not encode exactly the implemented
        // permissions — a guard against a future hook variant lacking constructor validation.
        Hooks.validateHookPermissions(IHooks(address(hook)), _hookPermissions());
        console.log("AetherHook deployed at:", address(hook));

        // 2. Deploy AetherFactory
        AetherFactory factory = new AetherFactory(IPoolManager(POOL_MANAGER), IHooks(address(hook)), deployer);
        console.log("AetherFactory deployed at:", address(factory));

        // 3. Deploy AetherRouter (immutable treasury for the flat 0.1% entry fee)
        AetherRouter router = new AetherRouter(IPoolManager(POOL_MANAGER), factory, treasury, deployer);
        console.log("AetherRouter deployed at:", address(router));

        // 4. Deploy the canonical transferable receipt-position manager.
        //    The router's legacy ledger remains available for compatibility;
        //    new position UIs should use this ERC721-owned surface.
        AetherPositionManager positionManager = new AetherPositionManager(IPoolManager(POOL_MANAGER));
        console.log("AetherPositionManager deployed at:", address(positionManager));

        vm.stopBroadcast();

        // 5. Log deployment summary
        console.log("\n=== AetherDEX Deployment Summary ===");
        console.log("Network:      Sepolia");
        console.log("PoolManager:", POOL_MANAGER);
        console.log("AetherHook:  ", address(hook));
        console.log("AetherFactory:", address(factory));
        console.log("AetherRouter: ", address(router));
        console.log("PositionManager:", address(positionManager));
        console.log("Treasury:    ", treasury);
        console.log("Protocol Entry Fee:", router.PROTOCOL_FEE_BPS(), "bps (immutable)");
        console.log("=====================================\n");
    }
}
