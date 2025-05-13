// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.29;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IAetherPool} from "interfaces/IAetherPool.sol";
import {IAetherFactory} from "interfaces/IAetherFactory.sol";
import {IAetherVault} from "interfaces/IAetherVault.sol";
import {AetherVault} from "../vaults/AetherVault.sol"; // Adjust path if necessary
import {MockAetherPool} from "../mocks/MockAetherPool.sol"; // Import the mock

contract AetherFactory is IAetherFactory, Ownable, ReentrancyGuard {
    using Create2 for bytes;
    using SafeERC20 for IERC20;

    struct PoolInfo {
        address poolAddress; // Address of the AetherPool contract
        address vaultAddress; // Address of the associated AetherVault contract
        bool exists;
    }

    bytes32 public constant VAULT_INIT_CODE_HASH = keccak256(type(AetherVault).creationCode); // Assuming AetherVault exists

    mapping(address => mapping(address => PoolInfo)) public pools;
    address[] public allPools;
    address[] public allVaults;

    uint256 public creationFee = 0.01 ether; // Example fee

    // Events are defined in IAetherFactory
    // event PoolCreated(address indexed tokenA, address indexed tokenB, address pool, address vault, uint256 poolCount);
    // event FeeUpdated(uint256 oldFee, uint256 newFee);
    // event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);

    address public feeRecipient;

    error IdenticalAddresses();
    error PoolExists();
    error PoolNotFound();
    error InvalidFee();
    error ZeroAddress();
    error InsufficientFee();
    error TransferFailed();
    error BytecodeNotSet(); // Added error for missing bytecode

    constructor(
        address _initialOwner,
        address _feeRecipient
    ) Ownable(_initialOwner) {
        if (_feeRecipient == address(0)) revert ZeroAddress();
        feeRecipient = _feeRecipient;
    }

    // --- Pool Creation ---

    function createPool(
        address tokenA,
        address tokenB,
        string memory vaultName, // Name for the vault
        string memory vaultSymbol // Symbol for the vault
    ) external payable nonReentrant returns (address poolAddress, address vaultAddress) {
        if (tokenA == tokenB) revert IdenticalAddresses();
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);

        if (pools[token0][token1].exists) revert PoolExists();
        if (msg.value < creationFee) revert InsufficientFee();

        // Transfer fee FIRST
        if (creationFee > 0) {
            (bool success, ) = feeRecipient.call{value: creationFee}("");
            require(success, "AetherFactory: ETH_TRANSFER_FAILED");
        }

        // 1. Deploy Vault
        bytes32 vaultSalt = keccak256(abi.encodePacked(token0, token1, "vault"));
        bytes memory vaultBytecode = type(AetherVault).creationCode;
        bytes memory vaultArgs = abi.encode(
            IERC20(address(0)), // Placeholder for pool token (asset)
            vaultName,
            vaultSymbol,
            IAetherFactory(address(this)),
            token0, // Placeholder deposit token
            owner() // Placeholder strategy
        );
        bytes memory fullVaultBytecode = abi.encodePacked(vaultBytecode, vaultArgs);
        vaultAddress = Create2.deploy(0, vaultSalt, fullVaultBytecode);
        require(vaultAddress != address(0), "Vault deployment failed");
        allVaults.push(vaultAddress);

        // 2. Deploy Pool
        poolAddress = address(new MockAetherPool(token0, token1, vaultAddress));

        // Store pool information
        pools[token0][token1] = PoolInfo({poolAddress: poolAddress, vaultAddress: vaultAddress, exists: true});
        allPools.push(poolAddress);

        emit PoolCreated(token0, token1, poolAddress, vaultAddress, allPools.length);
    }

    // --- Getters ---

    function getPool(address tokenA, address tokenB) external view returns (address poolAddress, address vaultAddress) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        PoolInfo storage poolInfo = pools[token0][token1];
        if (!poolInfo.exists) revert PoolNotFound();
        return (poolInfo.poolAddress, poolInfo.vaultAddress);
    }

    function allPoolsLength() external view returns (uint256) {
        return allPools.length;
    }

     function allVaultsLength() external view returns (uint256) {
        return allVaults.length;
    }

    // --- Admin Functions ---

    function setCreationFee(uint256 _newFee) external onlyOwner {
        uint256 oldFee = creationFee;
        creationFee = _newFee;
        emit FeeUpdated(oldFee, _newFee);
    }

    function setFeeRecipient(address _newRecipient) external onlyOwner {
        if (_newRecipient == address(0)) revert ZeroAddress();
        address oldRecipient = feeRecipient;
        feeRecipient = _newRecipient;
        emit FeeRecipientUpdated(oldRecipient, _newRecipient);
    }

    // Function to withdraw accumulated fees (if factory holds them temporarily, though current logic sends direct)
    function withdrawFees() external onlyOwner {
        uint256 balance = address(this).balance;
        if (balance > 0) {
            (bool success, ) = owner().call{value: balance}("");
            require(success, "AetherFactory: ETH_TRANSFER_FAILED");
        }
    }

    // Allow owner to withdraw any accidentally sent ERC20 tokens
    function withdrawTokens(address tokenAddress) external onlyOwner {
        IERC20 token = IERC20(tokenAddress);
        uint256 balance = token.balanceOf(address(this));
        if (balance > 0) {
            token.safeTransfer(owner(), balance);
        }
    }

    // Replaced payable(owner()).send(address(this).balance) with a safe call check
    function safeWithdrawFees() external onlyOwner {
        uint256 balance = address(this).balance;
        if (balance > 0) {
            (bool success, ) = payable(owner()).call{value: balance}("");
            require(success, "AetherFactory: ETH_TRANSFER_FAILED");
        }
    }

}
