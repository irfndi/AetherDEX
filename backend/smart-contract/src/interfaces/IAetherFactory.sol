// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.29;

interface IAetherFactory {
    event PoolCreated(address indexed tokenA, address indexed tokenB, address pool, address vault, uint256 poolCount);
    event FeeUpdated(uint256 oldFee, uint256 newFee);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);

    function createPool(
        address tokenA,
        address tokenB,
        string memory vaultName,
        string memory vaultSymbol
    ) external payable returns (address poolAddress, address vaultAddress);

    function getPool(address tokenA, address tokenB) external view returns (address poolAddress, address vaultAddress);

    function allPoolsLength() external view returns (uint256);

    function allVaultsLength() external view returns (uint256);

    function creationFee() external view returns (uint256);

    function feeRecipient() external view returns (address);

    // Optional: Include admin functions if other contracts need to know about them, 
    // otherwise they can be omitted from the interface.
    // function setCreationFee(uint256 _newFee) external;
    // function setFeeRecipient(address _newRecipient) external;
}
