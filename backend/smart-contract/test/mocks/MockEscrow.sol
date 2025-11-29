// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.29;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Mock Escrow contract for testing (replaces disabled Vyper Escrow)
contract MockEscrow {
    using SafeERC20 for IERC20;

    address public buyer;
    address public seller;
    address public arbiter;
    address public token;
    uint256 public amount;
    bool public isFunded;
    bool public isReleased;

    constructor(
        address _buyer,
        address _seller,
        address _arbiter,
        address _token,
        uint256 _amount
    ) {
        require(_buyer != address(0), "Invalid buyer");
        require(_seller != address(0), "Invalid seller");
        require(_arbiter != address(0), "Invalid arbiter");
        require(_token != address(0), "Invalid token");
        require(_amount > 0, "Amount must be > 0");

        buyer = _buyer;
        seller = _seller;
        arbiter = _arbiter;
        token = _token;
        amount = _amount;
    }

    function fund() external {
        require(msg.sender == buyer, "Only buyer can fund");
        require(!isFunded, "Already funded");

        IERC20(token).safeTransferFrom(buyer, address(this), amount);
        isFunded = true;
    }

    function release() external {
        require(msg.sender == arbiter, "Only arbiter can release");
        require(isFunded, "Not funded");
        require(!isReleased, "Already released");

        IERC20(token).safeTransfer(seller, amount);
        isReleased = true;
    }

    function refund() external {
        require(msg.sender == arbiter, "Only arbiter can refund");
        require(isFunded, "Not funded");
        require(!isReleased, "Already released");

        IERC20(token).safeTransfer(buyer, amount);
        isReleased = true;
    }
}
