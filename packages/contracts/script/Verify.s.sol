// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import "forge-std/Script.sol";

/// @title AetherDEX Deploy Verification Helper (Phase 4 - issue #314)
/// @notice Post-deployment gate for the Phase-4 IMMUTABLE contract shape. Run it against a
///         live/staging deployment to assert the treasury + fee invariants hold before the
///         addresses are wired into apps/api (wrangler.jsonc) for keeper TP/SL reads.
///
/// @dev Checks performed:
///   1. AetherRouter.PROTOCOL_FEE_BPS() == 10  (flat 0.1% entry fee, immutable post-#315)
///   2. AetherRouter.treasury() == AETHERDEX_TREASURY (the intended multisig)
///   3. AetherHook has deployed code and matches the operator-provided runtime code hash. The hash is the
///      security gate proving the deployed hook is the audited oracle-only bytecode from #315.
///   4. Router, factory, hook, and PoolManager immutable wiring is internally consistent.
///
/// @dev Why these are robust across contract surfaces:
///   - The router value probes (1)(2) use plain `staticcall` on no-arg view getters, which
///     succeed and decode when the function exists. This script compiles regardless of the
///     typed interface because the calls are built from raw selectors + `abi.encodeWithSelector`.
///   - A raw selector scan is not a security proof because selectors can occur in embedded data and
///     proxies/fallbacks can dispatch dynamically. The exact runtime code hash is required instead.
///
/// @dev Environment variables:
///   AETHERDEX_ROUTER  (required) deployed AetherRouter to verify
///   AETHERDEX_HOOK    (required) deployed AetherHook to verify
///   AETHERDEX_TREASURY (required) expected fee treasury multisig
///   AETHERDEX_HOOK_CODE_HASH (required) expected keccak256(runtime bytecode) of the audited oracle-only hook
///
///   Read-only, no broadcast:
///     AETHERDEX_ROUTER=0x.. AETHERDEX_HOOK=0x.. AETHERDEX_TREASURY=0x.. \
///       AETHERDEX_HOOK_CODE_HASH=0x.. \
///       forge script script/Verify.s.sol --rpc-url <target>
///
///   Post-#315 (Phase 4 is now merged on origin/main) the deployed surface matches every check:
///   the router exposes PROTOCOL_FEE_BPS()==10 + non-zero treasury(), and the oracle-only hook's
///   runtime code hash matches the audited Phase-4 artifact. The loud reverts below only fire against
///   a stale or mismatched deployment.
contract Verify is Script {
    // Function selectors probed via raw staticcall (no typed-interface dependency).
    bytes4 constant SEL_PROTOCOL_FEE_BPS = bytes4(keccak256("PROTOCOL_FEE_BPS()"));
    bytes4 constant SEL_TREASURY = bytes4(keccak256("treasury()"));
    bytes4 constant SEL_FACTORY = bytes4(keccak256("factory()"));
    bytes4 constant SEL_POOL_MANAGER = bytes4(keccak256("poolManager()"));
    bytes4 constant SEL_HOOK = bytes4(keccak256("hook()"));

    /// @notice The locked Phase-4 flat protocol entry fee.
    uint256 constant EXPECTED_PROTOCOL_FEE_BPS = 10; // 0.1%

    function run() external view {
        address router = vm.envAddress("AETHERDEX_ROUTER");
        address hook = vm.envAddress("AETHERDEX_HOOK");
        address expectedTreasury = vm.envAddress("AETHERDEX_TREASURY");
        require(router != address(0), "Verify: AETHERDEX_ROUTER must be set");
        require(hook != address(0), "Verify: AETHER_HOOK (AETHERDEX_HOOK) must be set");
        require(expectedTreasury != address(0), "Verify: AETHERDEX_TREASURY must be set");
        require(router.code.length != 0, "Verify: router address must contain deployed code");
        require(hook.code.length != 0, "Verify: hook address must contain deployed code");
        require(expectedTreasury.code.length != 0, "Verify: treasury address must contain deployed multisig code");

        console.log("\n=== AetherDEX Phase-4 Verification (#314) ===");
        console.log("Router:", router);
        console.log("Hook:  ", hook);

        // --- Router: immutable entry fee ------------------------------------------
        (bool feeOk, bytes memory feeRet) = router.staticcall(abi.encodeWithSelector(SEL_PROTOCOL_FEE_BPS));
        if (!feeOk) {
            // Pre-#315 router does not expose PROTOCOL_FEE_BPS() - the immutable fee is not
            // deployed yet. Loud, actionable revert rather than a silent pass.
            revert("Verify: router does not expose PROTOCOL_FEE_BPS() - deploy the Phase-4 router (PR #315)");
        }
        uint256 feeBps = abi.decode(feeRet, (uint256));
        require(feeBps == EXPECTED_PROTOCOL_FEE_BPS, "Verify: PROTOCOL_FEE_BPS != 10 (expected flat 0.1%)");
        console.log("Router PROTOCOL_FEE_BPS OK:", feeBps);

        // --- Router: treasury wired -----------------------------------------------
        (bool treasuryOk, bytes memory treasuryRet) = router.staticcall(abi.encodeWithSelector(SEL_TREASURY));
        require(treasuryOk, "Verify: router does not expose treasury() - deploy the Phase-4 router (PR #315)");
        address routerTreasury = abi.decode(treasuryRet, (address));
        require(routerTreasury == expectedTreasury, "Verify: router treasury does not match AETHERDEX_TREASURY");
        console.log("Router treasury OK:        ", routerTreasury);

        // --- Immutable deployment wiring ----------------------------------------
        address routerFactory = _readAddress(router, SEL_FACTORY, "router factory()");
        address routerPoolManager = _readAddress(router, SEL_POOL_MANAGER, "router poolManager()");
        require(routerFactory.code.length != 0, "Verify: router factory must contain deployed code");
        require(routerPoolManager.code.length != 0, "Verify: router PoolManager must contain deployed code");
        address factoryHook = _readAddress(routerFactory, SEL_HOOK, "factory hook()");
        address factoryPoolManager = _readAddress(routerFactory, SEL_POOL_MANAGER, "factory poolManager()");
        address hookPoolManager = _readAddress(hook, SEL_POOL_MANAGER, "hook poolManager()");
        require(factoryHook == hook, "Verify: factory hook does not match AETHERDEX_HOOK");
        require(routerPoolManager == factoryPoolManager, "Verify: router and factory PoolManager mismatch");
        require(routerPoolManager == hookPoolManager, "Verify: hook PoolManager does not match suite");
        console.log("Immutable wiring OK:        router/factory/hook/PoolManager");

        // --- Hook: audited runtime code hash ---------------------------------------
        bytes32 expectedHookCodeHash = vm.envBytes32("AETHERDEX_HOOK_CODE_HASH");
        require(expectedHookCodeHash != bytes32(0), "Verify: AETHERDEX_HOOK_CODE_HASH must be set");
        require(hook.codehash == expectedHookCodeHash, "Verify: hook runtime code hash is not the audited #315 hook");
        console.log("Hook runtime code hash:     OK (audited oracle-only bytecode)");

        console.log("=== Verification PASSED ===\n");
        console.log("Verified contract addresses are ready for the Worker bindings.");
    }

    function _readAddress(address target, bytes4 selector, string memory label) internal view returns (address value) {
        (bool ok, bytes memory result) = target.staticcall(abi.encodeWithSelector(selector));
        require(ok && result.length >= 32, label);
        value = abi.decode(result, (address));
    }
}
