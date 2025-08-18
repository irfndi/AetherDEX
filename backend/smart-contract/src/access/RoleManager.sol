// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.29;

import "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/access/IAccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Errors} from "../libraries/Errors.sol";

/**
 * @title RoleManager
 * @author AetherDEX
 * @notice Centralized role management for the AetherDEX protocol
 * @dev Manages Admin, Operator, and Pauser roles with hierarchical permissions
 */
contract RoleManager is AccessControlEnumerable, ReentrancyGuard {
    // Role definitions
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    // Role hierarchy tracking
    mapping(bytes32 => bytes32) public roleHierarchy;
    
    // Role metadata
    struct RoleInfo {
        string name;
        string description;
        bool active;
        uint256 memberCount;
    }
    
    mapping(bytes32 => RoleInfo) public roleInfo;
    bytes32[] public allRoles;
    
    // Time-based role assignments
    struct TimedRole {
        uint256 expiresAt;
        bool isActive;
    }
    
    mapping(address => mapping(bytes32 => TimedRole)) public timedRoles;
    
    // Multi-signature requirements
    mapping(bytes32 => uint256) public roleRequiredSignatures;
    mapping(bytes32 => mapping(bytes32 => mapping(address => bool))) public pendingRoleChanges; // role => nonce => signer => approved
    mapping(bytes32 => mapping(bytes32 => uint256)) public roleChangeApprovals; // role => nonce => approval count
    mapping(bytes32 => bytes32) public roleChangeNonce; // role => current nonce
    
    // Events
    event RoleHierarchyUpdated(bytes32 indexed parentRole, bytes32 indexed childRole);
    event TimedRoleGranted(address indexed account, bytes32 indexed role, uint256 expiresAt);
    event TimedRoleRevoked(address indexed account, bytes32 indexed role);
    event RoleChangeProposed(bytes32 indexed role, address indexed account, bool isGrant, bytes32 nonce);
    event RoleChangeApproved(bytes32 indexed role, address indexed approver, bytes32 nonce);
    event RoleChangeExecuted(bytes32 indexed role, address indexed account, bool isGrant, bytes32 nonce);
    event MultiSigRequirementUpdated(bytes32 indexed role, uint256 requiredSignatures);
    event EmergencyRoleActivated(address indexed account, address indexed activator);
    
    /**
     * @notice Constructor sets up initial roles and hierarchy
     * @param admin Address to be granted admin role
     */
    constructor(address admin) {
        if (admin == address(0)) revert Errors.ZeroAddress();
        
        // Set up role hierarchy: ADMIN > OPERATOR > PAUSER
        _setRoleAdmin(ADMIN_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(OPERATOR_ROLE, ADMIN_ROLE);
        _setRoleAdmin(PAUSER_ROLE, ADMIN_ROLE);
        _setRoleAdmin(EMERGENCY_ROLE, DEFAULT_ADMIN_ROLE);
        
        // Grant initial roles
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        
        // Initialize role info
        _initializeRoleInfo();
        
        // Set default multi-sig requirements
        roleRequiredSignatures[ADMIN_ROLE] = 2;
        roleRequiredSignatures[EMERGENCY_ROLE] = 1;
    }
    
    /**
     * @notice Initialize role information
     */
    function _initializeRoleInfo() internal {
        roleInfo[DEFAULT_ADMIN_ROLE] = RoleInfo("Super Admin", "Highest level administrative access", true, 0);
        roleInfo[ADMIN_ROLE] = RoleInfo("Admin", "Administrative access for protocol management", true, 0);
        roleInfo[OPERATOR_ROLE] = RoleInfo("Operator", "Operational access for day-to-day functions", true, 0);
        roleInfo[PAUSER_ROLE] = RoleInfo("Pauser", "Emergency pause capabilities", true, 0);
        roleInfo[EMERGENCY_ROLE] = RoleInfo("Emergency", "Emergency response capabilities", true, 0);
        
        allRoles.push(DEFAULT_ADMIN_ROLE);
        allRoles.push(ADMIN_ROLE);
        allRoles.push(OPERATOR_ROLE);
        allRoles.push(PAUSER_ROLE);
        allRoles.push(EMERGENCY_ROLE);
    }
    
    // Modifiers
    modifier onlyAdmin() {
        if (!hasRole(ADMIN_ROLE, msg.sender)) revert Errors.NotOwner();
        _;
    }
    
    modifier onlyOperator() {
        if (!hasRole(OPERATOR_ROLE, msg.sender)) revert Errors.NotOwner();
        _;
    }
    
    modifier onlyPauser() {
        if (!hasRole(PAUSER_ROLE, msg.sender)) revert Errors.NotOwner();
        _;
    }
    
    modifier validRole(bytes32 role) {
        if (!roleInfo[role].active) revert Errors.InvalidPath();
        _;
    }
    
    /**
     * @notice Grant a role with time-based expiration
     * @param role The role to grant
     * @param account The account to grant the role to
     * @param duration Duration in seconds for the role to be active
     */
    function grantTimedRole(
        bytes32 role,
        address account,
        uint256 duration
    ) external validRole(role) nonReentrant {
        if (!hasRole(getRoleAdmin(role), msg.sender)) revert Errors.NotOwner();
        if (account == address(0)) revert Errors.ZeroAddress();
        if (duration == 0) revert Errors.AmountTooLow();
        
        uint256 expiresAt = block.timestamp + duration;
        timedRoles[account][role] = TimedRole(expiresAt, true);
        
        _grantRole(role, account);
        emit TimedRoleGranted(account, role, expiresAt);
    }
    
    /**
     * @notice Revoke a timed role
     * @param role The role to revoke
     * @param account The account to revoke the role from
     */
    function revokeTimedRole(bytes32 role, address account) external validRole(role) {
        if (!hasRole(getRoleAdmin(role), msg.sender)) revert Errors.NotOwner();
        
        timedRoles[account][role].isActive = false;
        _revokeRole(role, account);
        emit TimedRoleRevoked(account, role);
    }
    
    /**
     * @notice Check if a timed role is still valid
     * @param account The account to check
     * @param role The role to check
     * @return bool True if the role is still valid
     */
    function isTimedRoleValid(address account, bytes32 role) public view returns (bool) {
        TimedRole memory timedRole = timedRoles[account][role];
        return timedRole.isActive && block.timestamp <= timedRole.expiresAt;
    }
    
    /**
     * @notice Override hasRole to include timed role validation
     */
    function hasRole(bytes32 role, address account) public view override(AccessControl, IAccessControl) returns (bool) {
        bool hasStandardRole = super.hasRole(role, account);
        if (!hasStandardRole) return false;
        
        // Check if it's a timed role and if it's still valid
        TimedRole memory timedRole = timedRoles[account][role];
        if (timedRole.isActive) {
            return block.timestamp <= timedRole.expiresAt;
        }
        
        return true;
    }
    
    /**
     * @notice Propose a role change that requires multi-signature approval
     * @param role The role to change
     * @param account The account for the role change
     * @param isGrant True for granting, false for revoking
     */
    function proposeRoleChange(
        bytes32 role,
        address account,
        bool isGrant
    ) external validRole(role) returns (bytes32 nonce) {
        if (!hasRole(getRoleAdmin(role), msg.sender)) revert Errors.NotOwner();
        if (account == address(0)) revert Errors.ZeroAddress();
        
        nonce = keccak256(abi.encodePacked(role, account, isGrant, block.timestamp));
        roleChangeNonce[role] = nonce;
        
        // Auto-approve from proposer
        pendingRoleChanges[role][nonce][msg.sender] = true;
        roleChangeApprovals[role][nonce] = 1;
        
        emit RoleChangeProposed(role, account, isGrant, nonce);
        emit RoleChangeApproved(role, msg.sender, nonce);
        
        return nonce;
    }
    
    /**
     * @notice Approve a pending role change
     * @param role The role being changed
     * @param nonce The nonce of the role change proposal
     */
    function approveRoleChange(bytes32 role, bytes32 nonce) external validRole(role) {
        if (!hasRole(getRoleAdmin(role), msg.sender)) revert Errors.NotOwner();
        if (pendingRoleChanges[role][nonce][msg.sender]) revert Errors.InvalidPath(); // Already approved
        
        pendingRoleChanges[role][nonce][msg.sender] = true;
        roleChangeApprovals[role][nonce]++;
        
        emit RoleChangeApproved(role, msg.sender, nonce);
    }
    
    /**
     * @notice Execute a role change after sufficient approvals
     * @param role The role being changed
     * @param account The account for the role change
     * @param isGrant True for granting, false for revoking
     * @param nonce The nonce of the role change proposal
     */
    function executeRoleChange(
        bytes32 role,
        address account,
        bool isGrant,
        bytes32 nonce
    ) external validRole(role) {
        uint256 required = roleRequiredSignatures[role];
        if (roleChangeApprovals[role][nonce] < required) revert Errors.InsufficientLiquidity(); // Reusing for insufficient approvals
        
        if (isGrant) {
            _grantRole(role, account);
        } else {
            _revokeRole(role, account);
        }
        
        // Clean up
        delete roleChangeApprovals[role][nonce];
        
        emit RoleChangeExecuted(role, account, isGrant, nonce);
    }
    
    /**
     * @notice Set multi-signature requirement for a role
     * @param role The role to set requirement for
     * @param requiredSignatures Number of signatures required
     */
    function setMultiSigRequirement(bytes32 role, uint256 requiredSignatures) external onlyAdmin validRole(role) {
        if (requiredSignatures == 0) revert Errors.AmountTooLow();
        roleRequiredSignatures[role] = requiredSignatures;
        emit MultiSigRequirementUpdated(role, requiredSignatures);
    }
    
    /**
     * @notice Grant emergency role in critical situations
     * @param account Account to grant emergency role to
     */
    function grantEmergencyRole(address account) external {
        if (!hasRole(DEFAULT_ADMIN_ROLE, msg.sender) && !hasRole(EMERGENCY_ROLE, msg.sender)) {
            revert Errors.NotOwner();
        }
        if (account == address(0)) revert Errors.ZeroAddress();
        
        _grantRole(EMERGENCY_ROLE, account);
        emit EmergencyRoleActivated(account, msg.sender);
    }
    
    /**
     * @notice Get all accounts with a specific role
     * @param role The role to query
     * @return accounts Array of accounts with the role
     */
    function getRoleMembers(bytes32 role) public view override returns (address[] memory accounts) {
        uint256 memberCount = getRoleMemberCount(role);
        accounts = new address[](memberCount);
        
        for (uint256 i = 0; i < memberCount; i++) {
            accounts[i] = getRoleMember(role, i);
        }
    }
    
    /**
     * @notice Get information about a role
     * @param role The role to query
     * @return info RoleInfo struct with role details
     */
    function getRoleInfo(bytes32 role) external view returns (RoleInfo memory info) {
        return roleInfo[role];
    }
    
    /**
     * @notice Get all available roles
     * @return roles Array of all role identifiers
     */
    function getAllRoles() external view returns (bytes32[] memory roles) {
        return allRoles;
    }
    
    /**
     * @notice Check if an account has any administrative role
     * @param account The account to check
     * @return bool True if account has admin privileges
     */
    function isAdmin(address account) external view returns (bool) {
        return hasRole(DEFAULT_ADMIN_ROLE, account) || hasRole(ADMIN_ROLE, account);
    }
    
    /**
     * @notice Check if an account can perform operations
     * @param account The account to check
     * @return bool True if account has operator privileges
     */
    function isOperator(address account) external view returns (bool) {
        return hasRole(OPERATOR_ROLE, account) || hasRole(ADMIN_ROLE, account) || hasRole(DEFAULT_ADMIN_ROLE, account);
    }
    
    /**
     * @notice Check if an account can pause operations
     * @param account The account to check
     * @return bool True if account has pauser privileges
     */
    function isPauser(address account) external view returns (bool) {
        return hasRole(PAUSER_ROLE, account) || hasRole(ADMIN_ROLE, account) || hasRole(DEFAULT_ADMIN_ROLE, account);
    }
    
    /**
     * @notice Override _grantRole to update member count
     */
    function _grantRole(bytes32 role, address account) internal override returns (bool) {
        if (!hasRole(role, account)) {
            roleInfo[role].memberCount++;
        }
        return super._grantRole(role, account);
    }
    
    /**
     * @notice Override _revokeRole to update member count
     */
    function _revokeRole(bytes32 role, address account) internal override returns (bool) {
        if (hasRole(role, account)) {
            roleInfo[role].memberCount--;
        }
        return super._revokeRole(role, account);
    }
}