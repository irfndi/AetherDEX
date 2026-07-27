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

/// @title AetherDEX Deploy Script (Phase 4 — env-driven, issue #314)
/// @notice Deploys the AetherDEX contract suite to a target network with all
///         network-specific parameters supplied by environment variables, so the
///         SAME script works for Sepolia (default) and Robinhood Chain (and any
///         future Uniswap-v4 network) without editing source.
///
/// @dev Environment variables (read at run time):
///   DEPLOYER_PRIVATE_KEY        (required) broadcast EOA key — also the CREATE2 deployer
///   AETHERDEX_TREASURY          (required) fee treasury multisig. Phase 4 (#314): this is
///                                         config, NOT a secret — set it in the deploy env.
///   POOL_MANAGER                (optional) Uniswap V4 PoolManager for the target network.
///                                         Defaults to the canonical Sepolia PoolManager.
///                                         TODO(#314): for Robinhood Chain set this to the
///                                         Robinhood-Chain V4 PoolManager before broadcasting.
///   NETWORK_NAME                (optional) label echoed in the deployment summary (default "Sepolia").
///   AETHERDEX_PROTOCOL_FEE_BPS  (optional) protocol entry fee in bps (default 10 = 0.1%,
///                                         the locked Phase-4 rate; the hook caps at 1000).
///
///   Optional existing-address overrides — when set, the contract is ATTACHED (not redeployed),
///   which lets a partial re-deploy reuse an already-deployed, address-locked hook/factory:
///   AETHERDEX_HOOK              (optional) reuse an existing AetherHook
///   AETHERDEX_FACTORY           (optional) reuse an existing AetherFactory
///   AETHERDEX_ROUTER            (optional) reuse an existing AetherRouter
///   AETHERDEX_POSITION_MANAGER  (optional) reuse an existing AetherPositionManager
///
/// @dev Run (Sepolia):
///   DEPLOYER_PRIVATE_KEY=0x.. AETHERDEX_TREASURY=0x.. \
///     forge script script/Deploy.s.sol --rpc-url sepolia --broadcast --verify
///
///   Run (Robinhood Chain — TODO(#314): fill the network's POOL_MANAGER + RPC alias):
///   DEPLOYER_PRIVATE_KEY=0x.. AETHERDEX_TREASURY=0x.. POOL_MANAGER=0x.. NETWORK_NAME=RobinhoodChain \
///     forge script script/Deploy.s.sol --rpc-url <robinhood-rpc> --broadcast --verify
///
/// @dev The treasury/fee are wired at construction time here. On the pre-#315 contract
///      surface (this branch, cut from `origin/main`) the protocol fee lives in AetherHook
///      and is owner-adjustable; PR #315 moves it to an IMMUTABLE 0.1% entry fee on
///      AetherRouter and strips the hook's fee admin. This script targets the CURRENT
///      constructor signatures — re-sync the constructor calls if/when #315 lands.
contract Deploy is Script {
    /// @notice Canonical Sepolia Uniswap V4 PoolManager — the Phase-0/Phase-4 default target.
    address constant DEFAULT_POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;

    /// @notice Locked Phase-4 flat protocol entry fee (0.1% = 10 bps).
    uint24 constant DEFAULT_PROTOCOL_FEE_BPS = 10;

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

        // treasury multisig — config, not a secret (Phase 4 #314). On the current contract
        // surface it is stored on AetherHook; #315 also bakes it into AetherRouter.
        // TODO(#314): set AETHERDEX_TREASURY to the production multisig for the target network.
        address treasury = vm.envAddress("AETHERDEX_TREASURY");
        require(treasury != address(0), "Deploy: AETHERDEX_TREASURY must be a non-zero multisig");

        // Network-specific, defaulted to Sepolia so a bare run targets Phase-0/Phase-4 Sepolia.
        address poolManager = vm.envOr("POOL_MANAGER", DEFAULT_POOL_MANAGER);
        uint24 protocolFeeBps = uint24(vm.envOr("AETHERDEX_PROTOCOL_FEE_BPS", uint256(DEFAULT_PROTOCOL_FEE_BPS)));
        string memory networkName = vm.envOr("NETWORK_NAME", string("Sepolia"));

        // Optional reuse of already-deployed, address-locked contracts.
        address existingHook = vm.envOr("AETHERDEX_HOOK", address(0));
        address existingFactory = vm.envOr("AETHERDEX_FACTORY", address(0));
        address existingRouter = vm.envOr("AETHERDEX_ROUTER", address(0));
        address existingPositionManager = vm.envOr("AETHERDEX_POSITION_MANAGER", address(0));

        vm.startBroadcast(deployerPrivateKey);
        address deployer = vm.addr(deployerPrivateKey);

        // 1. AetherHook — deployed via CREATE2 with a mined salt (V4 reads hook permissions
        //    from the hook ADDRESS itself). Reused as-is when AETHERDEX_HOOK is provided.
        address hookAddr = existingHook;
        if (hookAddr == address(0)) {
            bytes memory hookCtorArgs = abi.encode(IPoolManager(poolManager), treasury, protocolFeeBps, deployer);
            bytes32 hookInitCodeHash = keccak256(abi.encodePacked(type(AetherHook).creationCode, hookCtorArgs));
            (bool saltFound, bytes32 hookSalt,) =
                AetherHookAddressMiner.findSalt(deployer, hookInitCodeHash, HOOK_SALT_MAX_ITERATIONS);
            require(saltFound, "Deploy: no CREATE2 salt satisfies BEFORE_SWAP|AFTER_SWAP flags");
            hookAddr =
                address(new AetherHook{salt: hookSalt}(IPoolManager(poolManager), treasury, protocolFeeBps, deployer));
            // Fail loudly if the deployed address does not encode exactly the implemented permissions.
            Hooks.validateHookPermissions(IHooks(hookAddr), _hookPermissions());
        }
        AetherHook hook = AetherHook(hookAddr);
        console.log("AetherHook deployed at:", hookAddr);

        // 2. AetherFactory (reused when AETHERDEX_FACTORY is set)
        address factoryAddr = existingFactory;
        if (factoryAddr == address(0)) {
            factoryAddr = address(new AetherFactory(IPoolManager(poolManager), IHooks(hookAddr), deployer));
        }
        AetherFactory factory = AetherFactory(factoryAddr);
        console.log("AetherFactory deployed at:", factoryAddr);

        // 3. AetherRouter (reused when AETHERDEX_ROUTER is set)
        // Router has a payable fallback (it forwards ETH for zaps), so it is tracked as a
        // plain address here; the deploy summary logs the address directly.
        address routerAddr = existingRouter;
        if (routerAddr == address(0)) {
            routerAddr = address(new AetherRouter(IPoolManager(poolManager), factory, deployer));
        }
        console.log("AetherRouter deployed at:", routerAddr);

        // 4. AetherPositionManager — canonical transferable receipt-position manager
        //    (reused when AETHERDEX_POSITION_MANAGER is set). The router's legacy ledger
        //    remains available for compatibility; new position UIs use this ERC721 surface.
        address positionManagerAddr = existingPositionManager;
        if (positionManagerAddr == address(0)) {
            positionManagerAddr = address(new AetherPositionManager(IPoolManager(poolManager)));
        }
        console.log("AetherPositionManager deployed at:", positionManagerAddr);

        vm.stopBroadcast();

        // 5. Deploy-time invariant checks (read-only; safe after stopBroadcast).
        //    TODO(#314): immutability of the fee/treasury is enforced on-chain ONLY by PR #315
        //    (router entry fee + removal of the hook's setProtocolFee). Until then we assert the
        //    values are WIRED correctly; Verify.s.sol gates the final immutable shape post-#315.
        require(hook.treasury() == treasury, "Deploy: hook treasury mismatch");
        require(hook.protocolFeeBps() == protocolFeeBps, "Deploy: hook protocol fee mismatch");

        // 6. Deployment summary — these addresses feed apps/api wrangler.jsonc vars (Phase 4 #314):
        //    ROUTER_ADDRESS, FACTORY_ADDRESS, AETHER_HOOK_ADDRESS, POSITION_MANAGER_ADDRESS,
        //    POOL_MANAGER_ADDRESS, TREASURY_ADDRESS.
        console.log("\n=== AetherDEX Deployment Summary ===");
        console.log("Network:      ", networkName);
        console.log("PoolManager:  ", poolManager);
        console.log("AetherHook:   ", hookAddr);
        console.log("AetherFactory:", factoryAddr);
        console.log("AetherRouter: ", routerAddr);
        console.log("PositionManager:", positionManagerAddr);
        console.log("Treasury:     ", treasury);
        console.log("Protocol Fee: ", uint256(protocolFeeBps), "bps");
        console.log("=====================================\n");
    }
}
