// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockToken
 * @dev Basic ERC20 mock token with a public mint function for testing.
 */
contract MockToken is ERC20, Ownable {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) Ownable(msg.sender) {}

    /**
     * @dev Mints `amount` tokens to `to` address.
     * Can only be called by the owner (deployer in tests usually).
     */
    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }

    /**
     * @dev Allows anyone to burn tokens they own.
     */
    function burn(uint256 amount) public {
        _burn(msg.sender, amount);
    }
}
