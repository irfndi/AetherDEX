// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.31;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title Interface for Escrow (Vyper Implementation)
 * @notice Defines the external functions exposed by the Escrow.vy contract.
 */
interface IEscrowVyper {
    // --- Events (Mirroring Vyper Events) ---
    event Funded(address indexed sender, uint256 amount);
    event Released(uint256 amount);
    event Refunded(uint256 amount);

    // --- State-Changing Functions ---

    /**
     * @notice Buyer funds the escrow.
     * @dev Caller must be the designated buyer and must have approved the escrow contract
     *      for the specified token amount.
     */
    function fund() external;

    /**
     * @notice Arbiter releases funds to the seller.
     * @dev Caller must be the designated arbiter. Escrow must be funded and not already released/refunded.
     */
    function release() external;

    /**
     * @notice Arbiter refunds funds back to the buyer.
     * @dev Caller must be the designated arbiter. Escrow must be funded and not already released/refunded.
     */
    function refund() external;

    // --- Public State Variables (Read-only access via getters) ---
    function buyer() external view returns (address);
    function seller() external view returns (address);
    function arbiter() external view returns (address);
    function token() external view returns (IERC20); // Using OpenZeppelin IERC20 for Solidity interface
    function amount() external view returns (uint256);
    function isFunded() external view returns (bool);
    function isReleased() external view returns (bool);
}
