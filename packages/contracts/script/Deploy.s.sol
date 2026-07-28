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
///                                         Baked into AetherRouter as an IMMUTABLE recipient.
///   POOL_MANAGER                (optional) Uniswap V4 PoolManager for the target network.
///                                         Defaults to the canonical Sepolia PoolManager.
///                                         TODO(#314): for Robinhood Chain set this to the
///                                         Robinhood-Chain V4 PoolManager before broadcasting.
///   NETWORK_NAME                (optional) label echoed in the deployment summary (default "Sepolia").
///   AETHERDEX_PROTOCOL_FEE_BPS  (optional) expected protocol entry fee in bps (default 10 = 0.1%).
///                                         Since #315 the fee is an IMMUTABLE router constant
///                                         (AetherRouter.PROTOCOL_FEE_BPS == 10); this var is NOT
///                                         wired into any constructor — it is a consistency guard
///                                         that asserts the deployed router matches the locked rate.
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
/// @dev Phase 4 contract surface (post-#315, now on `origin/main`): the protocol fee is an
///      IMMUTABLE 0.1% ENTRY fee on AetherRouter (PROTOCOL_FEE_BPS == 10, immutable treasury);
///      AetherHook is oracle-only and carries NO fee/treasury args or admin. This script targets
///      those constructor signatures directly. Verify.s.sol gates the immutable shape post-deploy.
contract Deploy is Script {
    /// @notice Canonical Sepolia Uniswap V4 PoolManager — the Phase-0/Phase-4 default target.
    address constant DEFAULT_POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;

    /// @notice Locked Phase-4 flat protocol entry fee (0.1% = 10 bps) — mirrors the immutable
    ///         AetherRouter.PROTOCOL_FEE_BPS constant; used only as a deploy-time consistency guard.
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

        // treasury multisig — config, not a secret (Phase 4 #314). Post-#315 it is baked into
        // AetherRouter as the IMMUTABLE recipient of the flat 0.1% entry fee; the oracle-only
        // hook holds no funds.
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

        // PoolManager is immutable in every deployed contract. A missing or EOA address
        // would produce a deployment that can never initialize or operate a pool.
        require(poolManager.code.length != 0, "Deploy: POOL_MANAGER must contain deployed code");

        vm.startBroadcast(deployerPrivateKey);
        address deployer = vm.addr(deployerPrivateKey);

        // 1. AetherHook — deployed via CREATE2 with a mined salt (V4 reads hook permissions
        //    from the hook ADDRESS itself). Reused as-is when AETHERDEX_HOOK is provided.
        //    Phase 4: the hook is oracle-only — constructor takes ONLY the PoolManager (no
        //    treasury/fee args). The salt is mined for `deployer` because `new {salt}` below
        //    deploys from the broadcast EOA (not a create2 factory); mining for any other
        //    deployer would place the hook at an address missing BEFORE_SWAP|AFTER_SWAP.
        address hookAddr = existingHook;
        if (hookAddr == address(0)) {
            bytes memory hookCtorArgs = abi.encode(IPoolManager(poolManager));
            bytes32 hookInitCodeHash = keccak256(abi.encodePacked(type(AetherHook).creationCode, hookCtorArgs));
            (bool saltFound, bytes32 hookSalt,) =
                AetherHookAddressMiner.findSalt(deployer, hookInitCodeHash, HOOK_SALT_MAX_ITERATIONS);
            require(saltFound, "Deploy: no CREATE2 salt satisfies BEFORE_SWAP|AFTER_SWAP flags");
            hookAddr = address(new AetherHook{salt: hookSalt}(IPoolManager(poolManager)));
            // Fail loudly if the deployed address does not encode exactly the implemented permissions.
            Hooks.validateHookPermissions(IHooks(hookAddr), _hookPermissions());
        }
        AetherHook hook = AetherHook(hookAddr);
        require(hookAddr.code.length != 0, "Deploy: hook address must contain deployed code");
        require(address(hook.poolManager()) == poolManager, "Deploy: hook PoolManager mismatch");
        console.log("AetherHook deployed at:", hookAddr);

        // 2. AetherFactory (reused when AETHERDEX_FACTORY is set)
        address factoryAddr = existingFactory;
        if (factoryAddr == address(0)) {
            factoryAddr = address(new AetherFactory(IPoolManager(poolManager), IHooks(hookAddr), deployer));
        }
        AetherFactory factory = AetherFactory(factoryAddr);
        require(factoryAddr.code.length != 0, "Deploy: factory address must contain deployed code");
        require(address(factory.poolManager()) == poolManager, "Deploy: factory PoolManager mismatch");
        require(address(factory.hook()) == hookAddr, "Deploy: factory hook mismatch");
        console.log("AetherFactory deployed at:", factoryAddr);

        // 3. AetherRouter (reused when AETHERDEX_ROUTER is set). Phase 4: the router takes the
        //    IMMUTABLE treasury for the flat 0.1% entry fee — `new AetherRouter(pm, factory,
        //    treasury, deployer)`. It has a payable fallback (forwards ETH for zaps), so the
        //    reused-address variant casts through `payable`.
        address routerAddr = existingRouter;
        if (routerAddr == address(0)) {
            routerAddr = address(new AetherRouter(IPoolManager(poolManager), factory, treasury, deployer));
        }
        AetherRouter router = AetherRouter(payable(routerAddr));
        require(routerAddr.code.length != 0, "Deploy: router address must contain deployed code");
        require(address(router.poolManager()) == poolManager, "Deploy: router PoolManager mismatch");
        require(address(router.factory()) == factoryAddr, "Deploy: router factory mismatch");
        console.log("AetherRouter deployed at:", routerAddr);

        // 4. AetherPositionManager — canonical transferable receipt-position manager
        //    (reused when AETHERDEX_POSITION_MANAGER is set). The router's legacy ledger
        //    remains available for compatibility; new position UIs use this ERC721 surface.
        address positionManagerAddr = existingPositionManager;
        if (positionManagerAddr == address(0)) {
            positionManagerAddr = address(new AetherPositionManager(IPoolManager(poolManager)));
        }
        require(positionManagerAddr.code.length != 0, "Deploy: position manager address must contain deployed code");
        require(
            AetherPositionManager(payable(positionManagerAddr)).poolManager() == IPoolManager(poolManager),
            "Deploy: position manager PoolManager mismatch"
        );
        console.log("AetherPositionManager deployed at:", positionManagerAddr);

        vm.stopBroadcast();

        // 5. Deploy-time invariant checks (read-only; safe after stopBroadcast).
        //    Phase 4 (post-#315): the fee + treasury are IMMUTABLE on the router, so we assert
        //    the deployed router exposes the locked shape via its typed getters. Verify.s.sol
        //    re-checks these (plus the hook's fee-admin absence) against a live deployment.
        //    TODO(#314): the treasury is baked in at construction; a reused router (AETHERDEX_ROUTER)
        //    must already carry the same treasury for these assertions to hold.
        require(router.treasury() == treasury, "Deploy: router treasury mismatch");
        require(router.PROTOCOL_FEE_BPS() == 10, "Deploy: router PROTOCOL_FEE_BPS must be the immutable 10 (0.1%)");
        require(
            router.PROTOCOL_FEE_BPS() == protocolFeeBps,
            "Deploy: AETHERDEX_PROTOCOL_FEE_BPS must match the immutable router fee (10)"
        );

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
        console.log("Protocol Entry Fee:", uint256(router.PROTOCOL_FEE_BPS()), "bps (immutable)");
        console.log("=====================================\n");
    }
}
