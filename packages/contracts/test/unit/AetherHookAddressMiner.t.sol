// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import "forge-std/Test.sol";
import {AetherHookAddressMiner} from "src/hook/AetherHookAddressMiner.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";

contract AetherHookAddressMinerTest is Test {
    function test_hasValidFlags_acceptsRequiredFlags() public pure {
        address candidate = address(uint160(AetherHookAddressMiner.REQUIRED_FLAGS));
        assertTrue(AetherHookAddressMiner.hasValidFlags(candidate));
    }

    function test_hasValidFlags_rejectsMissingFlags() public pure {
        assertFalse(AetherHookAddressMiner.hasValidFlags(address(uint160(Hooks.BEFORE_SWAP_FLAG))));
        assertFalse(AetherHookAddressMiner.hasValidFlags(address(1)));
    }

    function test_findSalt_findsValidAddress() public pure {
        (bool found, bytes32 salt, address hookAddress) =
            AetherHookAddressMiner.findSalt(address(0xBEEF), keccak256("init"), 1_000_000);

        assertTrue(found);
        bytes32 hash = keccak256(abi.encodePacked(bytes1(0xff), address(0xBEEF), salt, keccak256("init")));
        assertEq(hookAddress, address(uint160(uint256(hash))));
        assertTrue(AetherHookAddressMiner.hasValidFlags(hookAddress));
    }

    function test_findSalt_returnsFalseWhenNotFound() public pure {
        (bool found, , address hookAddress) = AetherHookAddressMiner.findSalt(address(0xBEEF), keccak256("init"), 0);
        assertFalse(found);
        assertEq(hookAddress, address(0));
    }
}
