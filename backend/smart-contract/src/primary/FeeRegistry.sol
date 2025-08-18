// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.29;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PoolKey} from "../../lib/v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IFeeRegistry} from "../interfaces/IFeeRegistry.sol";

/// @title Fee Registry
/// @notice Manages both static fee configurations (fee tier and tick spacing) and dynamic fees for specific Aether Pools.
/// Allows the owner to add static configurations and register pools for dynamic fee updates by authorized addresses (e.g., hooks).
contract FeeRegistry is Ownable, ReentrancyGuard, IFeeRegistry {
    using SafeERC20 for IERC20;
    // --- Constants for Dynamic Fee Adjustments ---
    uint24 private constant MIN_FEE = 100; // 0.01%
    uint24 private constant MAX_FEE = 100000; // 10.00% to match DynamicFeeHook.sol
    uint24 private constant FEE_STEP = 50; // 0.005%

    // --- State Variables ---

    /// @notice Mapping from a static fee tier to its required tick spacing.
    /// @dev Used for pools that do not use dynamic fees. A non-zero value indicates the fee tier is supported.
    mapping(uint24 => int24) public tickSpacings;

    /// @notice Mapping from the hash of a PoolKey to its dynamically set fee.
    /// @dev If a fee exists here, it overrides any static configuration for that specific pool.
    /// A non-zero value indicates the pool is registered for dynamic fees.
    mapping(bytes32 => uint24) public dynamicFees;

    /// @notice Mapping from the hash of a PoolKey to the address authorized to update its dynamic fee.
    /// @dev Only this address can call `updateFee` for the given pool.
    mapping(bytes32 => address) public feeUpdaters;

    /// @notice Mapping from token pair hash to fee configuration
    mapping(bytes32 => IFeeRegistry.FeeConfiguration) public feeConfigurations;

    /// @notice Mapping to track authorized dynamic fee updaters
    mapping(address => bool) public authorizedUpdaters;
    
    // Protocol revenue distribution
    mapping(address => uint256) public protocolRevenue;
    mapping(address => uint256) public totalFeesCollected;
    address public protocolTreasury;
    uint256 public protocolFeePercentage; // Basis points (e.g., 500 = 5%)
    
    // Governance controls
    uint256 public constant GOVERNANCE_DELAY = 24 hours;
    mapping(bytes32 => uint256) public pendingGovernanceActions;
    
    // Fee tier governance
    struct PendingFeeChange {
        uint24 newFee;
        uint256 executeAfter;
        bool executed;
    }
    mapping(bytes32 => PendingFeeChange) public pendingFeeChanges;

    // --- Events ---

    /// @notice Emitted when a new static fee configuration is added.
    /// @param fee The fee tier added.
    /// @param tickSpacing The tick spacing associated with the fee.
    event FeeConfigurationAdded(uint24 indexed fee, int24 indexed tickSpacing);

    /// @notice Emitted when a pool is registered for dynamic fee updates.
    /// @param poolKeyHash The hash of the PoolKey identifying the pool.
    /// @param initialFee The initial dynamic fee set for the pool.
    /// @param updater The address authorized to update the fee.
    event DynamicFeePoolRegistered(bytes32 indexed poolKeyHash, uint24 initialFee, address indexed updater);

    /// @notice Emitted when the authorized fee updater for a dynamic pool is changed.
    /// @param poolKeyHash The hash of the PoolKey identifying the pool.
    /// @param oldUpdater The previously authorized updater address.
    /// @param newUpdater The newly authorized updater address.
    event FeeUpdaterSet(bytes32 indexed poolKeyHash, address indexed oldUpdater, address indexed newUpdater);

    /// @notice Emitted when the dynamic fee for a pool is updated.
    /// @param poolKeyHash The hash of the PoolKey identifying the pool.
    /// @param updater The address that performed the update.
    /// @param newFee The new dynamic fee value.
    event DynamicFeeUpdated(bytes32 indexed poolKeyHash, address indexed updater, uint24 newFee);
    
    // Protocol revenue events
    event ProtocolRevenueCollected(address indexed token, uint256 amount);
    event ProtocolRevenueDistributed(address indexed token, uint256 amount, address indexed recipient);
    event ProtocolTreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event ProtocolFeePercentageUpdated(uint256 oldPercentage, uint256 newPercentage);
    
    // Governance events
    event GovernanceActionProposed(bytes32 indexed actionHash, uint256 executeAfter);
    event GovernanceActionExecuted(bytes32 indexed actionHash);
    event FeeChangeProposed(bytes32 indexed poolHash, uint24 newFee, uint256 executeAfter);
    event FeeChangeExecuted(bytes32 indexed poolHash, uint24 oldFee, uint24 newFee);

    // --- Errors ---

    /// @notice Error thrown when trying to add a static fee configuration that already exists.
    /// @param fee The fee tier that already exists.
    error FeeAlreadyExists(uint24 fee);

    /// @notice Error thrown when trying to add a fee configuration with invalid parameters (e.g., fee is 0).
    error InvalidFeeConfiguration();

    /// @notice Error thrown when querying a fee tier that is not supported or registered.
    /// @param fee The fee tier queried.
    error FeeTierNotSupported(uint24 fee);

    /// @notice Error thrown when querying a tick spacing that is not supported by any fee tier.
    /// @param tickSpacing The tick spacing queried.
    error TickSpacingNotSupported(int24 tickSpacing);

    /// @notice Error thrown when trying to update a pool not registered for dynamic fees.
    /// @param poolKeyHash The hash of the PoolKey.
    error PoolNotRegistered(bytes32 poolKeyHash);

    /// @notice Error thrown when an unauthorized address tries to update a dynamic fee.
    /// @param poolKeyHash The hash of the PoolKey.
    /// @param caller The address attempting the update.
    /// @param expectedUpdater The authorized updater address.
    error UnauthorizedUpdater(bytes32 poolKeyHash, address caller, address expectedUpdater);

    /// @notice Error thrown when trying to update a dynamic fee with an invalid value.
    error InvalidDynamicFee();

    /// @notice Error thrown when trying to register a pool with an invalid initial fee.
    error InvalidInitialFee(uint24 fee);

    /// @notice Error thrown during registration if the initial fee or updater address is invalid.
    /// @param poolKeyHash The hash of the PoolKey.
    /// @param initialFee The initial fee provided.
    /// @param updater The updater address provided.
    error InvalidInitialFeeOrUpdater(bytes32 poolKeyHash, uint24 initialFee, address updater);

    /// @notice Error thrown when trying to register a pool that is already registered for dynamic fees.
    /// @param poolKeyHash The hash of the PoolKey.
    error PoolAlreadyRegistered(bytes32 poolKeyHash);

    /// @notice Error thrown when trying to set an invalid new updater address (e.g., zero address).
    /// @param poolKeyHash The hash of the PoolKey.
    /// @param invalidUpdater The invalid updater address provided.
    error InvalidNewUpdater(bytes32 poolKeyHash, address invalidUpdater);

    /// @notice Error thrown when trying to set the new updater to the same address as the current one.
    /// @param poolKeyHash The hash of the PoolKey.
    /// @param updater The address provided which is the same as the current updater.
    error NewUpdaterSameAsOld(bytes32 poolKeyHash, address updater);
    
    // Protocol revenue errors
    error InvalidProtocolTreasury();
    error InvalidProtocolFeePercentage();
    error InsufficientProtocolRevenue();
    error RevenueDistributionFailed();
    
    // Governance errors
    error GovernanceDelayNotMet();
    error GovernanceActionAlreadyExecuted();
    error InvalidGovernanceAction();
    error FeeChangeAlreadyPending();
    error FeeChangeNotReady();

    /// @notice Constructs the FeeRegistry with an initial owner and protocol settings.
    /// @param initialOwner The address that will own this contract.
    /// @param _protocolTreasury The address that will receive protocol fees.
    /// @param _protocolFeePercentage The percentage of fees that go to protocol (in basis points).
    constructor(address initialOwner, address _protocolTreasury, uint256 _protocolFeePercentage) Ownable(initialOwner) {
        if (_protocolTreasury == address(0)) revert InvalidProtocolTreasury();
        if (_protocolFeePercentage > 10000) revert InvalidProtocolFeePercentage(); // Max 100%
        
        protocolTreasury = _protocolTreasury;
        protocolFeePercentage = _protocolFeePercentage;
    }

    /// @notice Adds a new static fee configuration (fee tier and tick spacing).
    /// @dev Only callable by the owner. Reverts if the fee tier already exists or parameters are invalid.
    /// @param fee The fee tier to add (e.g., 3000 for 0.3%). Must be non-zero.
    /// @param tickSpacing The corresponding tick spacing. Must be positive.
    function addFeeConfiguration(uint24 fee, int24 tickSpacing) external onlyOwner {
        // Add check for MAX_FEE
        if (fee == 0 || fee > MAX_FEE || tickSpacing <= 0) {
            revert InvalidFeeConfiguration();
        }
        // Check if tickSpacing is non-zero, indicating the fee tier already exists
        if (tickSpacings[fee] != 0) {
            revert FeeAlreadyExists(fee);
        }

        tickSpacings[fee] = tickSpacing;
        emit FeeConfigurationAdded(fee, tickSpacing);
    }

    // [REMOVED] getFeeConfiguration function is no longer needed.

    /// @notice Checks if a static fee tier is supported (i.e., has a tick spacing configured).
    /// @param fee The fee tier to check.
    /// @return bool True if the fee tier is supported, false otherwise.
    function isSupportedFeeTier(uint24 fee) external view returns (bool) {
        // A fee tier is supported if its tick spacing is non-zero (meaning it was added)
        return tickSpacings[fee] != 0;
    }

    /// @notice Helper function to get the lowest fee for a given tick spacing
    /// @param tickSpacing The tick spacing to query
    /// @return The lowest fee configured for the tick spacing
    function getLowestFeeForTickSpacing(int24 tickSpacing) internal view returns (uint24) {
        uint24 lowestFee = type(uint24).max;
        for (uint24 fee = MIN_FEE; fee <= MAX_FEE; fee += FEE_STEP) {
            if (tickSpacings[fee] == tickSpacing && fee < lowestFee) {
                lowestFee = fee;
            }
        }
        // Revert with specific error if no fee found for the tick spacing
        // Revert with specific error if no fee found for the tick spacing
        if (lowestFee == type(uint24).max) {
            revert TickSpacingNotSupported(tickSpacing); // Keep this specific error
        }
        return lowestFee;
    }

    /// @notice Returns the fee for a given pool.
    /// @param key The PoolKey identifying the pool.
    /// @return fee The fee for the pool.
    function getFee(PoolKey calldata key) external view returns (uint24 fee) {
        bytes32 poolKeyHash = keccak256(abi.encode(key));
        uint24 dynamicFee = dynamicFees[poolKeyHash];

        // 1. If a dynamic fee exists, return it
        if (dynamicFee != 0) {
            return dynamicFee;
        }

        // 2. Static fee logic:
        // The PoolKey must provide a positive tickSpacing for static fee resolution.
        if (key.tickSpacing <= 0) {
            // If tickSpacing in PoolKey is invalid, we can't determine a static fee configuration.
            // Reverting with FeeTierNotSupported using key.fee might be confusing if key.fee is also 0 or junk.
            // A more direct error could be InvalidTickSpacingInPoolKey, but for now, FeeTierNotSupported
            // implies that the combination or the fee aspect of the key is problematic.
            revert FeeTierNotSupported(key.fee);
        }

        // For static pools, the fee is determined by the lowest configured fee tier
        // associated with the PoolKey's tickSpacing.
        // getLowestFeeForTickSpacing will revert with TickSpacingNotSupported if key.tickSpacing is not configured.
        return getLowestFeeForTickSpacing(key.tickSpacing);
    }

    /// @notice Updates the dynamic fee for a registered pool based on recent swap volume.
    /// @dev Only callable by the authorized fee updater for the pool.
    /// Implements dynamic fee calculation based on swap volume and current market conditions.
    /// @param key The PoolKey identifying the pool.
    /// @param swapVolume The recent swap volume used to potentially adjust the fee.
    function updateFee(PoolKey calldata key, uint256 swapVolume) external {
        bytes32 poolKeyHash = keccak256(abi.encode(key));
        address expectedUpdater = feeUpdaters[poolKeyHash];

        // Check if the pool is registered for dynamic fees
        if (expectedUpdater == address(0)) {
            revert PoolNotRegistered(poolKeyHash);
        }
        // Check if the caller is the authorized updater
        if (msg.sender != expectedUpdater) {
            revert UnauthorizedUpdater(poolKeyHash, msg.sender, expectedUpdater);
        }

        // Get current fee
        uint24 currentFee = dynamicFees[poolKeyHash];

        // Calculate volume-based fee adjustment
        // For larger volumes, increase the fee to account for potential price impact
        // Use a logarithmic scale to prevent excessive fees for very large volumes
        uint256 volumeThreshold = 1000 ether; // 1000 tokens (assuming 18 decimals)
        uint24 feeAdjustment = 0;

        if (swapVolume > 0) {
            uint256 volumeMultiplierRaw = (swapVolume + volumeThreshold - 1) / volumeThreshold;
            uint256 unCappedFeeAdjustment = volumeMultiplierRaw * 50;
            
            // Check bounds using wider types to prevent overflow
            uint256 potentialFeeForBoundCheck = uint256(currentFee) + unCappedFeeAdjustment;
            if (
                potentialFeeForBoundCheck > MAX_FEE ||
                potentialFeeForBoundCheck < MIN_FEE ||
                potentialFeeForBoundCheck > type(uint24).max   // extra safety check
            ) {
                revert InvalidDynamicFee();
            }
            
            // Now that we've verified the bounds, we can safely cast to uint24
            // No need to keep the uncapped adjustment since we've already done the bounds check with wider types

            uint256 volumeMultiplierCapped = volumeMultiplierRaw;
            if (volumeMultiplierCapped > 10) volumeMultiplierCapped = 10; // Cap at 10x
            feeAdjustment = uint24(volumeMultiplierCapped * 50); // This is the capped adjustment for actual use
        }

        // Calculate new fee, ensuring it stays within bounds using the *capped* feeAdjustment
        uint24 calculatedNewFee = currentFee;

        // Only adjust if there's meaningful volume
        if (swapVolume >= volumeThreshold / 10) {
            // Note: The bound check with unCappedFeeAdjustmentForCheck has already been done if swapVolume > 0
            // If swapVolume was 0, feeAdjustment is 0, so currentFee + 0 is checked by subsequent logic.
            // Here, we use the (potentially capped) feeAdjustment for the actual fee setting.
            uint24 potentialNewFee = currentFee + feeAdjustment;

            // Ensure fee is a multiple of FEE_STEP (rounds down)
            // This step itself should not push it out of MIN/MAX if potentialFeeForBoundCheck was okay
            // and potentialNewFee uses a capped (smaller or equal) adjustment.
            // However, rounding down might still take it below MIN_FEE if it was very close.
            calculatedNewFee = (potentialNewFee / FEE_STEP) * FEE_STEP;

            // Check bounds AGAIN AFTER rounding
            if (calculatedNewFee < MIN_FEE || calculatedNewFee > MAX_FEE) {
                revert InvalidDynamicFee();
            }
            // Even though theoretically calculatedNewFee should never exceed MAX_FEE if potentialFeeForBoundCheck was fine,
            // we check it explicitly for extra safety and to guard against future code changes.
        }

        // Only update if the fee has changed
        if (calculatedNewFee != currentFee) {
            dynamicFees[poolKeyHash] = calculatedNewFee;
            emit DynamicFeeUpdated(poolKeyHash, msg.sender, calculatedNewFee);
        }
    }

    /// @notice Registers a specific pool to use dynamic fees instead of a static configuration.
    /// @dev Only callable by the owner. Sets an initial dynamic fee and an authorized updater address.
    /// Reverts if the pool is already registered or if initial parameters are invalid.
    /// @param key The PoolKey identifying the pool to register.
    /// @param initialFee The initial dynamic fee for the pool. Must be non-zero.
    /// @param updater The address authorized to call `updateFee` for this pool. Must be non-zero.
    function registerDynamicFeePool(PoolKey calldata key, uint24 initialFee, address updater) external onlyOwner {
        bytes32 poolKeyHash = keccak256(abi.encode(key));

        if (initialFee == 0 || updater == address(0)) {
            revert InvalidInitialFeeOrUpdater(poolKeyHash, initialFee, updater);
        }

        // Validate initialFee for dynamic pool registration
        if (initialFee < MIN_FEE || initialFee > MAX_FEE || initialFee % FEE_STEP != 0) {
            revert InvalidInitialFee(initialFee);
        }

        if (feeUpdaters[poolKeyHash] != address(0)) {
            revert PoolAlreadyRegistered(poolKeyHash);
        }

        dynamicFees[poolKeyHash] = initialFee;
        feeUpdaters[poolKeyHash] = updater;
        emit DynamicFeePoolRegistered(poolKeyHash, initialFee, updater);
    }

    /// @notice Changes the authorized address that can update the dynamic fee for a specific pool.
    /// @dev Only callable by the owner. Reverts if the pool is not registered, the new updater is invalid,
    /// or the new updater is the same as the old one.
    /// @param key The PoolKey identifying the pool.
    /// @param newUpdater The new address authorized to update the fee. Must be non-zero and different from the current updater.
    function setFeeUpdater(PoolKey calldata key, address newUpdater) external onlyOwner {
        bytes32 poolKeyHash = keccak256(abi.encode(key));
        address oldUpdater = feeUpdaters[poolKeyHash];

        if (oldUpdater == address(0)) {
            revert PoolNotRegistered(poolKeyHash);
        }
        if (newUpdater == address(0)) {
            revert InvalidNewUpdater(poolKeyHash, newUpdater);
        }
        if (newUpdater == oldUpdater) {
            revert NewUpdaterSameAsOld(poolKeyHash, newUpdater);
        }

        feeUpdaters[poolKeyHash] = newUpdater;
        emit FeeUpdaterSet(poolKeyHash, oldUpdater, newUpdater);
    }

    /// @notice Returns the tick spacing for a given fee tier.
    /// @param fee The fee tier to query.
    /// @return The tick spacing for the given fee tier.
    function getTickSpacing(uint24 fee) external view returns (int24) {
        if (tickSpacings[fee] == 0) {
            revert FeeTierNotSupported(fee);
        }
        // The public mapping automatically creates a getter, but we implement
        // the function explicitly for clarity and adherence to the interface.
        return tickSpacings[fee];
    }

    // --- Interface Implementation ---

    /// @notice Helper function to generate token pair hash
    /// @param tokenA Address of the first token
    /// @param tokenB Address of the second token
    /// @return The hash of the ordered token pair
    function _getTokenPairHash(address tokenA, address tokenB) internal pure returns (bytes32) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encodePacked(token0, token1));
    }

    /// @notice Adds a new fee configuration for a token pair
    /// @param tokenA Address of the first token
    /// @param tokenB Address of the second token
    /// @param fee The fee tier (e.g., 3000 for 0.3%)
    /// @param tickSpacing The tick spacing for this fee tier
    /// @param isStatic_ Whether the fee is static or dynamic
    function addFeeConfiguration(address tokenA, address tokenB, uint24 fee, int24 tickSpacing, bool isStatic_) external onlyOwner {
        if (fee == 0 || fee > MAX_FEE || tickSpacing <= 0) {
            revert InvalidFeeConfiguration();
        }
        
        bytes32 pairHash = _getTokenPairHash(tokenA, tokenB);
        
        // Check if configuration already exists
        if (feeConfigurations[pairHash].fee != 0) {
            revert FeeAlreadyExists(fee);
        }
        
        feeConfigurations[pairHash] = IFeeRegistry.FeeConfiguration({
            isStatic: isStatic_,
            fee: fee,
            tickSpacing: uint24(tickSpacing)
        });
        
        // Also add to static fee configurations if static
        if (isStatic_) {
            tickSpacings[fee] = tickSpacing;
        }
        
        emit FeeConfigurationAdded(tokenA, tokenB, fee, tickSpacing);
    }

    /// @notice Sets or updates the static fee for a specific token pair
    /// @param tokenA Address of the first token
    /// @param tokenB Address of the second token
    /// @param fee The static fee tier
    function setStaticFee(address tokenA, address tokenB, uint24 fee) external onlyOwner {
        if (fee == 0 || fee > MAX_FEE) {
            revert InvalidFeeConfiguration();
        }
        
        bytes32 pairHash = _getTokenPairHash(tokenA, tokenB);
        
        // Update existing configuration or create new one
        IFeeRegistry.FeeConfiguration storage config = feeConfigurations[pairHash];
        config.isStatic = true;
        config.fee = fee;
        
        emit StaticFeeSet(tokenA, tokenB, fee);
    }

    /// @notice Updates the dynamic fee for a specific token pair
    /// @param tokenA Address of the first token
    /// @param tokenB Address of the second token
    /// @param newFee The new dynamic fee tier
    function updateDynamicFee(address tokenA, address tokenB, uint24 newFee) external {
        if (!authorizedUpdaters[msg.sender] && msg.sender != owner()) {
            revert UnauthorizedUpdater(bytes32(0), msg.sender, owner());
        }
        
        if (newFee < MIN_FEE || newFee > MAX_FEE) {
            revert InvalidDynamicFee();
        }
        
        bytes32 pairHash = _getTokenPairHash(tokenA, tokenB);
        IFeeRegistry.FeeConfiguration storage config = feeConfigurations[pairHash];
        
        if (config.isStatic) {
            revert InvalidFeeConfiguration(); // Cannot update static fee dynamically
        }
        
        uint24 oldFee = config.fee;
        config.fee = newFee;
        
        emit DynamicFeeUpdated(tokenA, tokenB, oldFee, newFee);
    }

    /// @notice Gets the fee configuration for a token pair
    /// @param tokenA Address of the first token
    /// @param tokenB Address of the second token
    /// @return config The FeeConfiguration struct for the pair
    function getFeeConfiguration(address tokenA, address tokenB) external view returns (IFeeRegistry.FeeConfiguration memory config) {
        bytes32 pairHash = _getTokenPairHash(tokenA, tokenB);
        return feeConfigurations[pairHash];
    }

    /// @notice Gets the current applicable fee for a token pair
    /// @param tokenA Address of the first token
    /// @param tokenB Address of the second token
    /// @return fee The current fee (static or dynamic)
    function getCurrentFee(address tokenA, address tokenB) external view returns (uint24 fee) {
        bytes32 pairHash = _getTokenPairHash(tokenA, tokenB);
        IFeeRegistry.FeeConfiguration memory config = feeConfigurations[pairHash];
        
        if (config.fee == 0) {
            revert FeeTierNotSupported(0);
        }
        
        return config.fee;
    }



    /// @notice Authorizes or deauthorizes an address to update dynamic fees
    /// @param updater The address of the updater
    /// @param allowed True to allow, false to disallow
    function setDynamicFeeUpdater(address updater, bool allowed) external onlyOwner {
        authorizedUpdaters[updater] = allowed;
        emit DynamicFeeUpdaterSet(updater, allowed);
    }

    /// @notice Checks if an address is an authorized dynamic fee updater
    /// @param updater The address to check
    /// @return isAllowed True if the address is allowed, false otherwise
    function isDynamicFeeUpdater(address updater) external view returns (bool isAllowed) {
        return authorizedUpdaters[updater];
    }
    
    // --- Protocol Revenue Management ---
    
    /// @notice Collects protocol fees from a token
    /// @param token The token address to collect fees from
    /// @param amount The amount of fees to collect
    function collectProtocolFees(address token, uint256 amount) external nonReentrant {
        if (!authorizedUpdaters[msg.sender] && msg.sender != owner()) {
            revert UnauthorizedUpdater(bytes32(0), msg.sender, owner());
        }
        
        if (amount == 0) return;
        
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        
        uint256 protocolShare = (amount * protocolFeePercentage) / 10000;
        protocolRevenue[token] += protocolShare;
        totalFeesCollected[token] += amount;
        
        emit ProtocolRevenueCollected(token, protocolShare);
    }
    
    /// @notice Distributes protocol revenue to the treasury
    /// @param token The token to distribute
    /// @param amount The amount to distribute (0 = all available)
    function distributeProtocolRevenue(address token, uint256 amount) external onlyOwner nonReentrant {
        uint256 availableRevenue = protocolRevenue[token];
        if (availableRevenue == 0) revert InsufficientProtocolRevenue();
        
        uint256 distributeAmount = amount == 0 ? availableRevenue : amount;
        if (distributeAmount > availableRevenue) revert InsufficientProtocolRevenue();
        
        protocolRevenue[token] -= distributeAmount;
        
        IERC20(token).safeTransfer(protocolTreasury, distributeAmount);
        
        emit ProtocolRevenueDistributed(token, distributeAmount, protocolTreasury);
    }
    
    /// @notice Updates the protocol treasury address with governance delay
    /// @param newTreasury The new treasury address
    function proposeProtocolTreasuryUpdate(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert InvalidProtocolTreasury();
        
        bytes32 actionHash = keccak256(abi.encodePacked("updateTreasury", newTreasury));
        uint256 executeAfter = block.timestamp + GOVERNANCE_DELAY;
        
        pendingGovernanceActions[actionHash] = executeAfter;
        emit GovernanceActionProposed(actionHash, executeAfter);
    }
    
    /// @notice Executes the protocol treasury update after delay
    /// @param newTreasury The new treasury address
    function executeProtocolTreasuryUpdate(address newTreasury) external onlyOwner {
        bytes32 actionHash = keccak256(abi.encodePacked("updateTreasury", newTreasury));
        uint256 executeAfter = pendingGovernanceActions[actionHash];
        
        if (executeAfter == 0) revert InvalidGovernanceAction();
        if (block.timestamp < executeAfter) revert GovernanceDelayNotMet();
        
        address oldTreasury = protocolTreasury;
        protocolTreasury = newTreasury;
        
        delete pendingGovernanceActions[actionHash];
        
        emit ProtocolTreasuryUpdated(oldTreasury, newTreasury);
        emit GovernanceActionExecuted(actionHash);
    }
    
    /// @notice Updates the protocol fee percentage with governance delay
    /// @param newPercentage The new fee percentage in basis points
    function proposeProtocolFeeUpdate(uint256 newPercentage) external onlyOwner {
        if (newPercentage > 10000) revert InvalidProtocolFeePercentage();
        
        bytes32 actionHash = keccak256(abi.encodePacked("updateFeePercentage", newPercentage));
        uint256 executeAfter = block.timestamp + GOVERNANCE_DELAY;
        
        pendingGovernanceActions[actionHash] = executeAfter;
        emit GovernanceActionProposed(actionHash, executeAfter);
    }
    
    /// @notice Executes the protocol fee percentage update after delay
    /// @param newPercentage The new fee percentage in basis points
    function executeProtocolFeeUpdate(uint256 newPercentage) external onlyOwner {
        bytes32 actionHash = keccak256(abi.encodePacked("updateFeePercentage", newPercentage));
        uint256 executeAfter = pendingGovernanceActions[actionHash];
        
        if (executeAfter == 0) revert InvalidGovernanceAction();
        if (block.timestamp < executeAfter) revert GovernanceDelayNotMet();
        
        uint256 oldPercentage = protocolFeePercentage;
        protocolFeePercentage = newPercentage;
        
        delete pendingGovernanceActions[actionHash];
        
        emit ProtocolFeePercentageUpdated(oldPercentage, newPercentage);
        emit GovernanceActionExecuted(actionHash);
    }
    
    // --- Governance-Controlled Fee Management ---
    
    /// @notice Proposes a fee change for a pool with governance delay
    /// @param key The pool key
    /// @param newFee The new fee to set
    function proposeFeeChange(PoolKey calldata key, uint24 newFee) external onlyOwner {
        if (newFee < MIN_FEE || newFee > MAX_FEE || newFee % FEE_STEP != 0) {
            revert InvalidDynamicFee();
        }
        
        bytes32 poolKeyHash = keccak256(abi.encode(key));
        
        if (pendingFeeChanges[poolKeyHash].executeAfter != 0 && !pendingFeeChanges[poolKeyHash].executed) {
            revert FeeChangeAlreadyPending();
        }
        
        uint256 executeAfter = block.timestamp + GOVERNANCE_DELAY;
        
        pendingFeeChanges[poolKeyHash] = PendingFeeChange({
            newFee: newFee,
            executeAfter: executeAfter,
            executed: false
        });
        
        emit FeeChangeProposed(poolKeyHash, newFee, executeAfter);
    }
    
    /// @notice Executes a pending fee change after the governance delay
    /// @param key The pool key
    function executeFeeChange(PoolKey calldata key) external onlyOwner {
        bytes32 poolKeyHash = keccak256(abi.encode(key));
        PendingFeeChange storage pendingChange = pendingFeeChanges[poolKeyHash];
        
        if (pendingChange.executeAfter == 0) revert InvalidGovernanceAction();
        if (block.timestamp < pendingChange.executeAfter) revert FeeChangeNotReady();
        if (pendingChange.executed) revert GovernanceActionAlreadyExecuted();
        
        uint24 oldFee = dynamicFees[poolKeyHash];
        dynamicFees[poolKeyHash] = pendingChange.newFee;
        pendingChange.executed = true;
        
        emit FeeChangeExecuted(poolKeyHash, oldFee, pendingChange.newFee);
    }
    
    // --- View Functions ---
    
    /// @notice Gets the available protocol revenue for a token
    /// @param token The token address
    /// @return amount The available revenue amount
    function getProtocolRevenue(address token) external view returns (uint256 amount) {
        return protocolRevenue[token];
    }
    
    /// @notice Gets the total fees collected for a token
    /// @param token The token address
    /// @return amount The total collected amount
    function getTotalFeesCollected(address token) external view returns (uint256 amount) {
        return totalFeesCollected[token];
    }
    
    /// @notice Gets pending fee change details
    /// @param key The pool key
    /// @return pendingChange The pending fee change struct
    function getPendingFeeChange(PoolKey calldata key) external view returns (PendingFeeChange memory pendingChange) {
        bytes32 poolKeyHash = keccak256(abi.encode(key));
        return pendingFeeChanges[poolKeyHash];
    }
}
