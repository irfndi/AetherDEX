// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.29;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "forge-std/console.sol"; // Added for logging

// Uniswap V4 Interfaces



import {IAetherFactory} from "src/interfaces/IAetherFactory.sol"; // Path made explicit from src


contract AetherVault is ERC4626 {
    using SafeERC20 for IERC20;

    IAetherFactory public immutable factory;
    address public immutable depositToken;
    address public immutable strategy;
    uint256 public previousTotalAssets;
    uint256 public yieldRate; 
    uint256 public lastYieldTimestamp;
    uint256 public totalYieldGenerated;

    error ZeroShares();
    error OnlyStrategy();

    modifier onlyStrategy() {
        require(msg.sender == strategy, "AetherVault: CALLER_NOT_STRATEGY");
        _;
    }

    constructor(
        IERC20 _asset,
        string memory _name,
        string memory _symbol,
        IAetherFactory _factory,
        address _depositToken,
        address _strategy
    ) ERC4626(_asset) ERC20(_name, _symbol) {
        require(_strategy != address(0), "AetherVault: INVALID_STRATEGY_ADDR");
        factory = _factory;
        depositToken = _depositToken;
        strategy = _strategy;
        previousTotalAssets = 0;
        lastYieldTimestamp = block.timestamp; 
        yieldRate = 0; 
        totalYieldGenerated = 0;
    }

    // --- Overridden ERC4626 Functions ---

    function deposit(uint256 _assets, address _receiver)
        public
        virtual
        override
        returns (uint256 shares)
    {
        // Accrue yield before deposit modifies totalAssets
        _accruePendingYield();
        // Calculate shares before calling internal deposit logic
        shares = previewDeposit(_assets);
        require(shares > 0, "AetherVault: ZERO_SHARES_FOR_DEPOSIT");

        _deposit(_assets, _receiver);
    }

    function mint(uint256 _shares, address _receiver) public virtual override returns (uint256 assets) {
        require(_shares > 0, "AetherVault: ZERO_SHARES");
        // Accrue yield before mint modifies totalAssets
        _accruePendingYield();
        assets = previewMint(_shares);

        require(assets != 0, "AetherVault: ZERO_ASSETS_FOR_MINT");

        _deposit(assets, _receiver); 
    }

    function _deposit(uint256 _assets, address _receiver) internal {
        uint256 shares = previewDeposit(_assets);

        if (shares == 0) {
            revert ZeroShares();
        }
        _mint(_receiver, shares);
        SafeERC20.safeTransferFrom(IERC20(asset()), msg.sender, address(this), _assets);
        emit Deposit(msg.sender, _receiver, _assets, shares);
    }

    function withdraw(
        uint256 _assets,
        address _receiver,
        address _owner
    ) public virtual override returns (uint256 shares) {
        // Accrue yield before withdraw calculation
        _accruePendingYield();
        shares = previewWithdraw(_assets);

        require(shares != 0, "AetherVault: ZERO_SHARES_FOR_WITHDRAW");

        if (msg.sender != _owner) {
            _spendAllowance(_owner, msg.sender, shares);
        }

        _burn(_owner, shares);
        SafeERC20.safeTransfer(IERC20(asset()), _receiver, _assets);
        emit Withdraw(msg.sender, _receiver, _owner, _assets, shares);
    }

    function redeem(
        uint256 _shares,
        address _receiver,
        address _owner
    ) public virtual override returns (uint256 assets) {
        // Accrue yield before redeem calculation
        _accruePendingYield();
        assets = previewRedeem(_shares);

        require(assets != 0, "AetherVault: ZERO_ASSETS_FOR_REDEEM");

        if (msg.sender != _owner) {
            _spendAllowance(_owner, msg.sender, _shares);
        }

        _burn(_owner, _shares);
        SafeERC20.safeTransfer(IERC20(asset()), _receiver, assets);
        emit Withdraw(msg.sender, _receiver, _owner, assets, _shares);
    }

    // --- Yield Logic ---
    event YieldRateUpdated(uint256 oldRate, uint256 newRate);
    event CrossChainYieldSynced(uint16 srcChain, uint256 yieldAmount);
    event YieldGenerated(uint256 amount, uint256 timestamp);

    /**
     * @notice Updates the yield rate for the vault.
     * Only callable by strategy
     * @param newRate The new yield rate (scaled percentage points)
     */
    function updateYieldRate(uint256 newRate) external onlyStrategy {
        // Accrue any pending yield before updating rate
        _accruePendingYield();
        uint256 oldRate = yieldRate; 
        yieldRate = newRate;
        emit YieldRateUpdated(oldRate, newRate); 
    }

    /**
     * @notice Syncs yield generated on another chain.
     * Only callable by strategy
     * @param srcChain Source chain ID
     * @param yieldAmount Yield amount to sync
     */
    function syncCrossChainYield(uint16 srcChain, uint256 yieldAmount) external onlyStrategy {
        console.log("AetherVault.syncCrossChainYield called");
        console.log("srcChain:", srcChain);
        console.log("yieldAmount:", yieldAmount);
        console.log("Current totalYieldGenerated before add:", totalYieldGenerated);

        totalYieldGenerated += yieldAmount;
        emit CrossChainYieldSynced(srcChain, yieldAmount);

        console.log("New totalYieldGenerated after add:", totalYieldGenerated);
    }

    /**
     * @dev Accrues pending yield based on time elapsed and yield rate.
     * Updates totalYieldGenerated and lastYieldTimestamp.
     */
    function _accruePendingYield() internal {
        // Slither: Timestamp - Using block.timestamp is essential for calculating time-elapsed
        // yield accrual based on the configured yieldRate. This is a fundamental aspect of
        // yield-bearing vaults.
        uint256 timeElapsed = block.timestamp - lastYieldTimestamp;
        if (timeElapsed > 0 && yieldRate > 0) {
            // Simplified yield calculation: rate * assets * time / scale
            // Needs proper scaling factor depending on how yieldRate is defined
            // Example: If yieldRate is annual % * 1e18, need to adjust timeElapsed
            // Placeholder: Assuming simple linear accrual for now
            uint256 yieldAmount = (yieldRate * totalAssets() * timeElapsed) / (365 days * 1e18); 
            totalYieldGenerated += yieldAmount;
            lastYieldTimestamp = block.timestamp;
            emit YieldGenerated(yieldAmount, block.timestamp);
        }
    }

    // --- Overridden ERC4626 View Functions ---

    function totalAssets() public view virtual override returns (uint256) {
        return super.totalAssets() + totalYieldGenerated; 
    }

    // --- Fee Logic Placeholder ---
    event FeesClaimed(uint256 amount);

    function claimFees() external {
        // Ensure only authorized address (e.g., owner, specific contract) can claim fees
        // This part needs implementation based on your fee mechanism
        // Example: require(msg.sender == owner(), "Only owner can claim fees");

        uint256 feesCollected = totalAssets() - previousTotalAssets;
        // Transfer fees logic here
        // Update previousTotalAssets
        previousTotalAssets = totalAssets();

        emit FeesClaimed(feesCollected);
    }
}
