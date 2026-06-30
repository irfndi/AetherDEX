// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.31;

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
