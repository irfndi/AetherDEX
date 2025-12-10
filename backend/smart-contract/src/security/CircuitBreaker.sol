// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.29;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Errors} from "../libraries/Errors.sol";

/**
 * @title CircuitBreaker
 * @author AetherDEX
 * @notice Implements circuit breaker patterns for emergency controls and security measures
 * @dev Provides pause functionality, token blacklisting, gas price guards, and value limits
 */
contract CircuitBreaker is AccessControl, Pausable, ReentrancyGuard {
    // Role definitions
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // Gas price limits
    uint256 public maxGasPrice;
    bool public gasLimitEnabled;

    // Value limits
    uint256 public maxTransactionValue;
    uint256 public maxDailyVolume;
    mapping(uint256 => uint256) public dailyVolume; // day => volume
    bool public valueLimitsEnabled;

    // Token blacklisting
    mapping(address => bool) public blacklistedTokens;
    mapping(address => bool) public blacklistedAddresses;
    bool public blacklistEnabled;

    // Emergency controls
    bool public emergencyMode;
    uint256 public emergencyActivatedAt;
    uint256 public constant EMERGENCY_DURATION = 24 hours;

    // Events
    event EmergencyModeActivated(address indexed activator, uint256 timestamp);
    event EmergencyModeDeactivated(address indexed deactivator, uint256 timestamp);
    event TokenBlacklisted(address indexed token, bool blacklisted);
    event AddressBlacklisted(address indexed addr, bool blacklisted);
    event GasLimitUpdated(uint256 oldLimit, uint256 newLimit);
    event ValueLimitUpdated(uint256 oldLimit, uint256 newLimit);
    event BlacklistStatusChanged(bool enabled);
    event GasLimitStatusChanged(bool enabled);
    event ValueLimitStatusChanged(bool enabled);

    /**
     * @notice Constructor sets up roles and initial parameters
     * @param admin Address to be granted admin role
     * @param initialGasLimit Initial maximum gas price
     * @param initialValueLimit Initial maximum transaction value
     */
    constructor(address admin, uint256 initialGasLimit, uint256 initialValueLimit) {
        if (admin == address(0)) revert Errors.ZeroAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);

        maxGasPrice = initialGasLimit;
        maxTransactionValue = initialValueLimit;
        gasLimitEnabled = true;
        valueLimitsEnabled = true;
        blacklistEnabled = true;
    }

    // Modifiers
    modifier onlyAdmin() {
        if (!hasRole(ADMIN_ROLE, msg.sender)) revert Errors.NotOwner();
        _;
    }

    modifier onlyOperator() virtual {
        if (!hasRole(OPERATOR_ROLE, msg.sender)) revert Errors.NotOwner();
        _;
    }

    modifier onlyPauser() {
        if (!hasRole(PAUSER_ROLE, msg.sender)) revert Errors.NotOwner();
        _;
    }

    modifier gasLimitCheck() {
        if (gasLimitEnabled && tx.gasprice > maxGasPrice) {
            revert Errors.ExcessiveSlippage(); // Reusing for gas price
        }
        _;
    }

    modifier valueLimitCheck(uint256 value) {
        if (valueLimitsEnabled) {
            if (value > maxTransactionValue) {
                revert Errors.AmountTooLow(); // Reusing for value limit
            }

            uint256 today = block.timestamp / 1 days;
            if (dailyVolume[today] + value > maxDailyVolume) {
                revert Errors.AmountTooLow(); // Reusing for daily limit
            }
            dailyVolume[today] += value;
        }
        _;
    }

    modifier blacklistCheck(address token, address user) {
        if (blacklistEnabled) {
            if (blacklistedTokens[token] || blacklistedAddresses[user]) {
                revert Errors.InvalidPath(); // Reusing for blacklist
            }
        }
        _;
    }

    modifier notInEmergency() {
        if (emergencyMode) {
            if (block.timestamp < emergencyActivatedAt + EMERGENCY_DURATION) {
                revert Errors.Paused();
            } else {
                // Auto-deactivate emergency mode after duration
                emergencyMode = false;
                emit EmergencyModeDeactivated(address(this), block.timestamp);
            }
        }
        _;
    }

    // Emergency controls
    function activateEmergencyMode() external onlyPauser {
        emergencyMode = true;
        emergencyActivatedAt = block.timestamp;
        _pause();
        emit EmergencyModeActivated(msg.sender, block.timestamp);
    }

    function deactivateEmergencyMode() external onlyAdmin {
        emergencyMode = false;
        _unpause();
        emit EmergencyModeDeactivated(msg.sender, block.timestamp);
    }

    // Pause controls
    function pause() external onlyPauser {
        _pause();
    }

    function unpause() external onlyAdmin {
        _unpause();
    }

    // Token blacklisting
    function setTokenBlacklist(address token, bool blacklisted) external onlyOperator {
        if (token == address(0)) revert Errors.ZeroAddress();
        blacklistedTokens[token] = blacklisted;
        emit TokenBlacklisted(token, blacklisted);
    }

    function setAddressBlacklist(address addr, bool blacklisted) external onlyOperator {
        if (addr == address(0)) revert Errors.ZeroAddress();
        blacklistedAddresses[addr] = blacklisted;
        emit AddressBlacklisted(addr, blacklisted);
    }

    function setBlacklistEnabled(bool enabled) external onlyAdmin {
        blacklistEnabled = enabled;
        emit BlacklistStatusChanged(enabled);
    }

    // Gas price controls
    function setMaxGasPrice(uint256 newMaxGasPrice) external onlyAdmin {
        uint256 oldLimit = maxGasPrice;
        maxGasPrice = newMaxGasPrice;
        emit GasLimitUpdated(oldLimit, newMaxGasPrice);
    }

    function setGasLimitEnabled(bool enabled) external onlyAdmin {
        gasLimitEnabled = enabled;
        emit GasLimitStatusChanged(enabled);
    }

    // Value limit controls
    function setMaxTransactionValue(uint256 newMaxValue) external onlyAdmin {
        uint256 oldLimit = maxTransactionValue;
        maxTransactionValue = newMaxValue;
        emit ValueLimitUpdated(oldLimit, newMaxValue);
    }

    function setMaxDailyVolume(uint256 newMaxDailyVolume) external onlyAdmin {
        maxDailyVolume = newMaxDailyVolume;
    }

    function setValueLimitsEnabled(bool enabled) external onlyAdmin {
        valueLimitsEnabled = enabled;
        emit ValueLimitStatusChanged(enabled);
    }

    // View functions
    function isTokenBlacklisted(address token) external view virtual returns (bool) {
        return blacklistEnabled && blacklistedTokens[token];
    }

    function isAddressBlacklisted(address addr) external view returns (bool) {
        return blacklistEnabled && blacklistedAddresses[addr];
    }

    function getCurrentDayVolume() external view returns (uint256) {
        uint256 today = block.timestamp / 1 days;
        return dailyVolume[today];
    }

    function getRemainingDailyVolume() external view returns (uint256) {
        uint256 today = block.timestamp / 1 days;
        uint256 used = dailyVolume[today];
        return used >= maxDailyVolume ? 0 : maxDailyVolume - used;
    }

    function isEmergencyActive() external view returns (bool) {
        if (!emergencyMode) return false;
        return block.timestamp < emergencyActivatedAt + EMERGENCY_DURATION;
    }

    // Security check function for external contracts
    function performSecurityChecks(address token, address user, uint256 value)
        external
        view
        whenNotPaused
        returns (bool)
    {
        // Check emergency mode
        if (emergencyMode && block.timestamp < emergencyActivatedAt + EMERGENCY_DURATION) {
            return false;
        }

        // Check blacklists
        if (blacklistEnabled && (blacklistedTokens[token] || blacklistedAddresses[user])) {
            return false;
        }

        // Check gas price
        if (gasLimitEnabled && tx.gasprice > maxGasPrice) {
            return false;
        }

        // Check value limits
        if (valueLimitsEnabled) {
            if (value > maxTransactionValue) {
                return false;
            }

            uint256 today = block.timestamp / 1 days;
            if (dailyVolume[today] + value > maxDailyVolume) {
                return false;
            }
        }

        return true;
    }
}
