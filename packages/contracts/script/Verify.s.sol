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
///   2. AetherRouter.treasury() != address(0)  (fee destination wired)
///   3. AetherHook runtime bytecode contains NO `setProtocolFee(uint24)` selector - the hook
///      is oracle-only after #315, so the fee-admin setter must be absent from its code.
///
/// @dev Why these are robust across contract surfaces:
///   - The router value probes (1)(2) use plain `staticcall` on no-arg view getters, which
///     succeed and decode when the function exists. This script compiles regardless of the
///     typed interface because the calls are built from raw selectors + `abi.encodeWithSelector`.
///   - Selector ABSENCE (3) cannot be detected via staticcall (a present-but-reverting setter
///     and a missing selector both revert), so it is detected by scanning the deployed runtime
///     bytecode for the 4-byte selector - the same approach `cast`/explorers use. A 4-byte
///     keccak selector colliding with unrelated code/data is negligible for an oracle-only hook.
///   - `owner()` presence is scanned and REPORTED (informational "no-admin" signal), not
///     hard-asserted, because owner() is not itself a fee-admin selector.
///
/// @dev Environment variables:
///   AETHERDEX_ROUTER  (required) deployed AetherRouter to verify
///   AETHERDEX_HOOK    (required) deployed AetherHook to verify
///
///   Read-only, no broadcast:
///     AETHERDEX_ROUTER=0x.. AETHERDEX_HOOK=0x.. \
///       forge script script/Verify.s.sol --rpc-url <target>
///
///   Post-#315 (Phase 4 is now merged on origin/main) the deployed surface matches every check:
///   the router exposes PROTOCOL_FEE_BPS()==10 + non-zero treasury(), and the oracle-only hook's
///   bytecode carries no setProtocolFee(uint24) selector, so this gate PASSES against a Phase-4
///   deployment. The loud reverts below only fire against a stale, pre-#315 deployment.
///   TODO(#314): run this against the freshly deployed immutable contracts and wire the verified
///   addresses into apps/api wrangler.jsonc before enabling keeper TP/SL reads.
contract Verify is Script {
    // Function selectors probed via raw staticcall / bytecode scan (no typed-interface dependency).
    bytes4 constant SEL_PROTOCOL_FEE_BPS = bytes4(keccak256("PROTOCOL_FEE_BPS()"));
    bytes4 constant SEL_TREASURY = bytes4(keccak256("treasury()"));
    bytes4 constant SEL_SET_PROTOCOL_FEE = bytes4(keccak256("setProtocolFee(uint24)"));
    bytes4 constant SEL_OWNER = bytes4(keccak256("owner()"));

    /// @notice The locked Phase-4 flat protocol entry fee.
    uint256 constant EXPECTED_PROTOCOL_FEE_BPS = 10; // 0.1%

    /// @dev Read the runtime bytecode of `target` and return true iff the 4-byte `selector`
    ///      appears anywhere in it. Standard "does this contract implement selector" probe.
    function _hasSelector(address target, bytes4 selector) internal view returns (bool) {
        uint256 size;
        assembly {
            size := extcodesize(target)
        }
        if (size == 0) return false;

        bytes memory code = new bytes(size);
        assembly {
            extcodecopy(target, add(code, 0x20), 0, size)
        }

        // Slide a 4-byte window over the bytecode; mload returns a 32-byte word whose high
        // 4 bytes are code[i..i+4), so a bytes4 equality test is a substring match at offset i.
        for (uint256 i = 0; i + 4 <= size; i++) {
            bytes4 window;
            assembly {
                window := mload(add(add(code, 0x20), i))
            }
            if (window == selector) return true;
        }
        return false;
    }

    function run() external view {
        address router = vm.envAddress("AETHERDEX_ROUTER");
        address hook = vm.envAddress("AETHERDEX_HOOK");
        require(router != address(0), "Verify: AETHERDEX_ROUTER must be set");
        require(hook != address(0), "Verify: AETHER_HOOK (AETHERDEX_HOOK) must be set");

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
        require(routerTreasury != address(0), "Verify: router treasury() is the zero address");
        console.log("Router treasury OK:        ", routerTreasury);

        // --- Hook: no fee-admin selector in bytecode ------------------------------
        require(
            !_hasSelector(hook, SEL_SET_PROTOCOL_FEE),
            "Verify: hook bytecode still contains setProtocolFee(uint24) - redeploy oracle-only hook (#315)"
        );
        console.log("Hook fee-admin absent:      OK (no setProtocolFee selector)");

        // --- Hook: informational no-owner signal (reported, not hard-asserted) ----
        if (_hasSelector(hook, SEL_OWNER)) {
            console.log("NOTE: hook exposes owner() - acceptable only pre-#315; the oracle-only hook has no owner.");
        } else {
            console.log("Hook owner absent:          OK (oracle-only, no admin)");
        }

        console.log("=== Verification PASSED ===\n");
        console.log("TODO(#314): wire the verified addresses into apps/api wrangler.jsonc:");
        console.log("  ROUTER_ADDRESS, FACTORY_ADDRESS, AETHER_HOOK_ADDRESS, POOL_MANAGER_ADDRESS, TREASURY_ADDRESS");
    }
}
