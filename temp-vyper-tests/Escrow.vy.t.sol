// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.29;

import "forge-std/Test.sol";
import "forge-std/console.sol";
import "@openzeppelin/contracts/mocks/token/ERC20Mock.sol";

interface IVyperEscrow {
    function buyer() external view returns (address);
    function seller() external view returns (address);
    function arbiter() external view returns (address);
    function token() external view returns (address);
    function amount() external view returns (uint256);
    function isFunded() external view returns (bool);
    function isReleased() external view returns (bool);
    function fund() external;
    function release() external;
    function refund() external;
}

contract EscrowVyperTest is Test {
    ERC20Mock token;
    IVyperEscrow escrow;
    address buyer = address(0xBEEF);
    address seller = address(0xCAFE);
    address arbiter = address(0xF00D);
    uint256 amount = 1000;

    function setUp() public {
        token = new ERC20Mock();
        token.mint(buyer, amount);

        // Deploy the Vyper contract using vm.deployCode with the artifact path
        bytes memory args = abi.encode(
            buyer, // _buyer
            seller, // _seller
            arbiter, // _arbiter
            address(token), // _token
            amount // _amount
        );
        address payable escrowAddress = payable(vm.deployCode("Escrow.vy", args));
        require(escrowAddress != address(0), "Vyper Escrow deployment failed via deployCode");
        escrow = IVyperEscrow(escrowAddress);
    }

    function testFundingAndRelease() public {
        vm.startPrank(buyer);
        token.approve(address(escrow), amount);
        escrow.fund();
        assertTrue(escrow.isFunded());
        vm.stopPrank();

        vm.startPrank(arbiter);
        escrow.release();
        assertTrue(escrow.isReleased());
        assertEq(token.balanceOf(seller), amount);
        vm.stopPrank();
    }

    function testFundingAndRefund() public {
        vm.startPrank(buyer);
        token.approve(address(escrow), amount);
        escrow.fund();
        assertTrue(escrow.isFunded());
        vm.stopPrank();

        vm.startPrank(arbiter);
        escrow.refund();
        assertTrue(escrow.isReleased());
        assertEq(token.balanceOf(buyer), amount);
        vm.stopPrank();
    }
}
