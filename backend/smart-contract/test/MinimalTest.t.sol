// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";

contract MinimalTest is Test {
    function setUp() public pure {
        console2.log("Setting up test");
    }

    function testBasic() public pure {
        console2.log("Running basic test");
        assertTrue(true, "This test should always pass");
    }
}
