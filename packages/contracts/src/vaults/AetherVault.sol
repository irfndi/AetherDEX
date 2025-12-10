// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.31;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PoolKey} from "../../lib/v4-core/src/types/PoolKey.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import "forge-std/console.sol";

/**
 * @title AetherVault
 * @dev ERC4626-compliant vault for AetherDEX liquidity pools
 * Implements yield-bearing strategy with cross-chain capabilities
 */
contract AetherVault is ERC4626 {
    using SafeERC20 for IERC20;

    IPoolManager public immutable poolManager;
    address public strategy;
    uint256 public totalYieldGenerated;
    uint256 public lastYieldTimestamp;
    uint256 public yieldRate; // Yield per second, scaled by 1e18

    event YieldGenerated(uint256 amount, uint256 timestamp);
    event StrategyUpdated(address oldStrategy, address newStrategy);
    event CrossChainYieldSynced(uint16 srcChain, uint256 yieldAmount);
    event YieldRateUpdated(uint256 oldRate, uint256 newRate); // Added event

    modifier onlyStrategy() {
        // The 'strategy' state variable now stores the true, unflagged address of the strategy.
        require(msg.sender == strategy, "AV: F S"); // "AetherVault: Forbidden Sender"
        _;
    }

    /**
     * @dev Constructor
     * @param initialAsset The underlying asset token
     * @param initialName Vault token name
     * @param initialSymbol Vault token symbol
     * @param initialPoolManager Pool manager interface
     */
    constructor(
        IERC20 initialAsset,
        string memory initialName,
        string memory initialSymbol,
        IPoolManager initialPoolManager
    ) ERC4626(initialAsset) ERC20(initialName, initialSymbol) {
        poolManager = initialPoolManager;
        lastYieldTimestamp = block.timestamp;
    }

    /**
     * @dev Set the yield strategy address
     * @param newStrategy New strategy address
     */
    function setStrategy(address newStrategy) external {
        require(strategy == address(0), "Strategy already set"); // Ensure strategy can only be set once
        require(newStrategy != address(0), "ZERO_STRATEGY_ADDRESS"); // Add zero-address check
        address oldStrategy = strategy; // Store old strategy (which is address(0) here)
        strategy = newStrategy;
        emit StrategyUpdated(oldStrategy, newStrategy); // Emit with old and new
    }

    /**
     * @dev Internal function to calculate the total assets
     * Includes generated yield
     */
    function totalAssets() public view virtual override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this)) + totalYieldGenerated;
    }

    /**
     * @dev Deposit assets and get vault tokens
     * Overridden to handle yield accrual
     */
    function deposit(uint256 assets, address receiver) public virtual override returns (uint256) {
        require(assets <= maxDeposit(receiver), "ERC4626: deposit more than max");

        uint256 shares = previewDeposit(assets);
        _deposit(_msgSender(), receiver, assets, shares);

        return shares;
    }

    /**
     * @dev Withdraw assets by burning vault tokens
     * Overridden to handle yield distribution
     */
    function withdraw(uint256 assets, address receiver, address owner) public virtual override returns (uint256) {
        // Slither: Timestamp - The `maxWithdraw` function (part of ERC4626 standard) might implicitly
        // use block.timestamp if yield accrual depends on it. This is standard for yield-bearing vaults.
        require(assets <= maxWithdraw(owner), "ERC4626: withdraw more than max");

        uint256 shares = previewWithdraw(assets);
        _withdraw(_msgSender(), receiver, owner, assets, shares);

        return shares;
    }

    /**
     * @dev Update yield rate
     * Only callable by strategy
     */
    function updateYieldRate(uint256 newRate) external onlyStrategy {
        console.log("AetherVault: Entered updateYieldRate");
        // Accrue any pending yield before updating rate
        _accruePendingYield();
        uint256 oldRate = yieldRate; // Read old value
        yieldRate = newRate; // Update state
        emit YieldRateUpdated(oldRate, newRate); // Emit event
        console.log("AetherVault: Exiting updateYieldRate");
    }

    /**
     * @dev Sync yield from another chain
     * @param srcChain Source chain ID
     * @param yieldAmount Yield amount to sync
     */
    function syncCrossChainYield(uint16 srcChain, uint256 yieldAmount) external onlyStrategy {
        console.log("AetherVault: Entered syncCrossChainYield. srcChain:", srcChain, " yieldAmount:", yieldAmount);
        totalYieldGenerated += yieldAmount;
        emit CrossChainYieldSynced(srcChain, yieldAmount);
        console.log("AetherVault: Exiting syncCrossChainYield. totalYieldGenerated:", totalYieldGenerated);
    }

    /**
     * @dev Internal function to accrue pending yield
     */
    function _accruePendingYield() internal {
        console.log("AetherVault: Entered _accruePendingYield");
        // Slither: Timestamp - Using block.timestamp is essential for calculating time-elapsed
        // yield accrual based on the configured yieldRate. This is a fundamental aspect of
        // yield-bearing vaults.
        uint256 timeElapsed = block.timestamp - lastYieldTimestamp;
        if (timeElapsed > 0 && yieldRate > 0) {
            uint256 yieldAmount = (timeElapsed * yieldRate) / 1e18;
            totalYieldGenerated += yieldAmount;
            lastYieldTimestamp = block.timestamp;
            emit YieldGenerated(yieldAmount, block.timestamp);
            console.log("AetherVault: Yield accrued in _accruePendingYield: ", yieldAmount);
        } else {
            console.log("AetherVault: No yield accrued in _accruePendingYield (timeElapsed or yieldRate is 0)");
        }
        console.log("AetherVault: Exiting _accruePendingYield");
    }

    /**
     * @dev Update hook called on token transfers
     * Ensures yield is accrued before any token movements
     */
    function _update(address from, address to, uint256 amount) internal virtual override {
        _accruePendingYield();
        super._update(from, to, amount);
    }
}
