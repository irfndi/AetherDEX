// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.29;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";

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
        require(msg.sender == strategy, "AetherVault: caller is not the strategy");
        _;
    }

    /**
     * @dev Constructor
     * @param _asset The underlying asset token
     * @param _name Vault token name
     * @param _symbol Vault token symbol
     * @param _poolManager Pool manager interface
     */
    constructor(
        IERC20 _asset,
        string memory _name,
        string memory _symbol,
        IPoolManager _poolManager
    ) ERC4626(_asset) ERC20(_name, _symbol) {
        poolManager = _poolManager;
        lastYieldTimestamp = block.timestamp;
    }

    /**
     * @dev Set the yield strategy address
     * @param _strategy New strategy address
     */
    function setStrategy(address _strategy) external {
        require(strategy == address(0), "Strategy already set"); // Ensure strategy can only be set once
        require(_strategy != address(0), "ZERO_STRATEGY_ADDRESS"); // Add zero-address check
        address oldStrategy = strategy; // Store old strategy (which is address(0) here)
        strategy = _strategy;
        emit StrategyUpdated(oldStrategy, _strategy); // Emit with old and new
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
    function withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) public virtual override returns (uint256) {
        require(assets <= maxWithdraw(owner), "ERC4626: withdraw more than max");

        uint256 shares = previewWithdraw(assets);
        _withdraw(_msgSender(), receiver, owner, assets, shares);

        return shares;
    }

    /**
     * @dev Update yield rate
     * Only callable by strategy
     */
    function updateYieldRate(uint256 _newRate) external onlyStrategy {
        // Accrue any pending yield before updating rate
        _accruePendingYield();
        uint256 oldRate = yieldRate; // Read old value
        yieldRate = _newRate; // Update state
        emit YieldRateUpdated(oldRate, _newRate); // Emit event
    }

    /**
     * @dev Sync yield from another chain
     * @param srcChain Source chain ID
     * @param yieldAmount Yield amount to sync
     */
    function syncCrossChainYield(uint16 srcChain, uint256 yieldAmount) external onlyStrategy {
        totalYieldGenerated += yieldAmount;
        emit CrossChainYieldSynced(srcChain, yieldAmount);
    }

    /**
     * @dev Internal function to accrue pending yield
     */
    function _accruePendingYield() internal {
        uint256 timeElapsed = block.timestamp - lastYieldTimestamp;
        if (timeElapsed > 0 && yieldRate > 0) {
            uint256 yieldAmount = (timeElapsed * yieldRate) / 1e18;
            totalYieldGenerated += yieldAmount;
            lastYieldTimestamp = block.timestamp;
            emit YieldGenerated(yieldAmount, block.timestamp);
        }
    }

    /**
     * @dev Update hook called on token transfers
     * Ensures yield is accrued before any token movements
     */
    function _update(
        address from,
        address to,
        uint256 amount
    ) internal virtual override {
        _accruePendingYield();
        super._update(from, to, amount);
    }
}
