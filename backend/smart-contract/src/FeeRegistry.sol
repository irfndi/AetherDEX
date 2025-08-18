// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {PoolKey} from "./types/PoolKey.sol";

/**
 * @title FeeRegistry
 * @notice Manages fee tiers, governance controls, and protocol revenue distribution for AetherDEX
 * @dev Implements tiered fee structure with governance voting and revenue sharing
 */
contract FeeRegistry is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // Constants
    uint256 public constant BASIS_POINTS = 10000; // 100%
    uint256 public constant MAX_FEE = 1000; // 10% maximum fee
    uint256 public constant MIN_VOTING_PERIOD = 1 days;
    uint256 public constant MAX_VOTING_PERIOD = 30 days;
    uint256 public constant MIN_QUORUM = 1000; // 10% minimum quorum
    uint256 public constant PROPOSAL_THRESHOLD = 100; // 1% to create proposal

    // Fee Tiers
    struct FeeTier {
        uint24 fee; // Fee in basis points (e.g., 30 = 0.3%)
        int24 tickSpacing; // Tick spacing for the fee tier
        bool active; // Whether this fee tier is active
        uint256 createdAt; // When this tier was created
        string description; // Description of the fee tier
    }

    // Revenue Distribution
    struct RevenueShare {
        address recipient; // Address to receive revenue
        uint256 percentage; // Percentage in basis points
        bool active; // Whether this share is active
        uint256 totalClaimed; // Total amount claimed by this recipient
    }

    // Governance Proposal
    struct Proposal {
        uint256 id; // Proposal ID
        address proposer; // Address that created the proposal
        string description; // Proposal description
        ProposalType proposalType; // Type of proposal
        bytes data; // Encoded proposal data
        uint256 startTime; // When voting starts
        uint256 endTime; // When voting ends
        uint256 forVotes; // Votes in favor
        uint256 againstVotes; // Votes against
        uint256 abstainVotes; // Abstain votes
        bool executed; // Whether proposal has been executed
        bool canceled; // Whether proposal has been canceled
        mapping(address => bool) hasVoted; // Track who has voted
        mapping(address => VoteType) votes; // Track vote types
    }

    enum ProposalType {
        ADD_FEE_TIER,
        REMOVE_FEE_TIER,
        UPDATE_REVENUE_SHARE,
        UPDATE_GOVERNANCE_PARAMS,
        EMERGENCY_ACTION
    }

    enum VoteType {
        FOR,
        AGAINST,
        ABSTAIN
    }

    enum ProposalState {
        PENDING,
        ACTIVE,
        CANCELED,
        DEFEATED,
        SUCCEEDED,
        QUEUED,
        EXPIRED,
        EXECUTED
    }

    // State Variables
    mapping(uint24 => FeeTier) public feeTiers;
    mapping(address => RevenueShare) public revenueShares;
    mapping(uint256 => Proposal) public proposals;
    mapping(address => uint256) public votingPower; // Voting power per address
    mapping(address => uint256) public delegatedVotes; // Delegated voting power
    mapping(address => address) public delegates; // Vote delegation

    uint24[] public activeFeeList; // List of active fee tiers
    address[] public revenueRecipients; // List of revenue recipients
    uint256 public proposalCount; // Total number of proposals
    uint256 public totalVotingPower; // Total voting power in system
    uint256 public votingPeriod = 7 days; // Default voting period
    uint256 public quorumPercentage = 2000; // 20% quorum requirement
    uint256 public proposalThreshold = 100; // 1% to create proposal
    uint256 public executionDelay = 2 days; // Delay before execution

    // Protocol revenue tracking
    mapping(address => uint256) public protocolRevenue; // Revenue per token
    mapping(address => uint256) public totalDistributed; // Total distributed per token
    uint256 public protocolFeePercentage = 500; // 5% protocol fee

    // Events
    event FeeTierAdded(uint24 indexed fee, int24 tickSpacing, string description);
    event FeeTierRemoved(uint24 indexed fee);
    event FeeTierUpdated(uint24 indexed fee, bool active);
    event RevenueShareAdded(address indexed recipient, uint256 percentage);
    event RevenueShareUpdated(address indexed recipient, uint256 percentage, bool active);
    event RevenueDistributed(address indexed token, uint256 amount, address indexed recipient);
    event ProposalCreated(uint256 indexed proposalId, address indexed proposer, string description);
    event VoteCast(uint256 indexed proposalId, address indexed voter, VoteType voteType, uint256 weight);
    event ProposalExecuted(uint256 indexed proposalId);
    event ProposalCanceled(uint256 indexed proposalId);
    event VotingPowerUpdated(address indexed account, uint256 newPower);
    event VotesDelegated(address indexed delegator, address indexed delegatee);
    event ProtocolFeeUpdated(uint256 newFeePercentage);
    event GovernanceParamsUpdated(uint256 votingPeriod, uint256 quorumPercentage, uint256 proposalThreshold);

    // Errors
    error InvalidFee();
    error FeeTierExists();
    error FeeTierNotFound();
    error InvalidTickSpacing();
    error InvalidPercentage();
    error RecipientExists();
    error RecipientNotFound();
    error InsufficientVotingPower();
    error ProposalNotFound();
    error ProposalNotActive();
    error ProposalAlreadyVoted();
    error ProposalNotSucceeded();
    error ProposalAlreadyExecuted();
    error InvalidProposalData();
    error InsufficientQuorum();
    error ExecutionDelayNotMet();
    error InvalidGovernanceParams();
    error ZeroAddress();
    error ZeroAmount();

    constructor(address initialOwner) Ownable(initialOwner) {
        // Initialize default fee tiers
        _addFeeTier(100, 1, "Ultra Low Fee (0.01%)"); // 0.01%
        _addFeeTier(500, 10, "Low Fee (0.05%)"); // 0.05%
        _addFeeTier(3000, 60, "Standard Fee (0.3%)"); // 0.3%
        _addFeeTier(10000, 200, "High Fee (1%)"); // 1%

        // Initialize default revenue share (100% to protocol initially)
        _addRevenueShare(initialOwner, BASIS_POINTS);
    }

    // ============ Fee Tier Management ============

    /**
     * @notice Add a new fee tier
     * @param fee Fee in basis points
     * @param tickSpacing Tick spacing for the fee tier
     * @param description Description of the fee tier
     */
    function addFeeTier(
        uint24 fee,
        int24 tickSpacing,
        string calldata description
    ) external onlyOwner {
        _addFeeTier(fee, tickSpacing, description);
    }

    /**
     * @notice Remove a fee tier
     * @param fee Fee tier to remove
     */
    function removeFeeTier(uint24 fee) public onlyOwner {
        if (!feeTiers[fee].active) revert FeeTierNotFound();
        
        feeTiers[fee].active = false;
        
        // Remove from active list
        for (uint256 i = 0; i < activeFeeList.length; i++) {
            if (activeFeeList[i] == fee) {
                activeFeeList[i] = activeFeeList[activeFeeList.length - 1];
                activeFeeList.pop();
                break;
            }
        }
        
        emit FeeTierRemoved(fee);
    }

    /**
     * @notice Update fee tier status
     * @param fee Fee tier to update
     * @param active New active status
     */
    function updateFeeTierStatus(uint24 fee, bool active) external onlyOwner {
        if (feeTiers[fee].createdAt == 0) revert FeeTierNotFound();
        
        feeTiers[fee].active = active;
        
        if (active) {
            // Add to active list if not already present
            bool found = false;
            for (uint256 i = 0; i < activeFeeList.length; i++) {
                if (activeFeeList[i] == fee) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                activeFeeList.push(fee);
            }
        } else {
            // Remove from active list
            for (uint256 i = 0; i < activeFeeList.length; i++) {
                if (activeFeeList[i] == fee) {
                    activeFeeList[i] = activeFeeList[activeFeeList.length - 1];
                    activeFeeList.pop();
                    break;
                }
            }
        }
        
        emit FeeTierUpdated(fee, active);
    }

    // ============ Revenue Distribution ============

    /**
     * @notice Add revenue share recipient
     * @param recipient Address to receive revenue
     * @param percentage Percentage in basis points
     */
    function addRevenueShare(address recipient, uint256 percentage) external onlyOwner {
        _addRevenueShare(recipient, percentage);
    }

    /**
     * @notice Update revenue share
     * @param recipient Recipient to update
     * @param percentage New percentage
     * @param active New active status
     */
    function updateRevenueShare(
        address recipient,
        uint256 percentage,
        bool active
    ) public onlyOwner {
        if (revenueShares[recipient].recipient == address(0)) revert RecipientNotFound();
        if (percentage > BASIS_POINTS) revert InvalidPercentage();
        
        revenueShares[recipient].percentage = percentage;
        revenueShares[recipient].active = active;
        
        emit RevenueShareUpdated(recipient, percentage, active);
    }

    /**
     * @notice Distribute protocol revenue
     * @param token Token to distribute
     * @param amount Amount to distribute
     */
    function distributeRevenue(address token, uint256 amount) external nonReentrant whenNotPaused {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        protocolRevenue[token] += amount;
        
        // Distribute to active recipients
        for (uint256 i = 0; i < revenueRecipients.length; i++) {
            address recipient = revenueRecipients[i];
            RevenueShare storage share = revenueShares[recipient];
            
            if (share.active && share.percentage > 0) {
                uint256 shareAmount = (amount * share.percentage) / BASIS_POINTS;
                if (shareAmount > 0) {
                    IERC20(token).safeTransfer(recipient, shareAmount);
                    share.totalClaimed += shareAmount;
                    totalDistributed[token] += shareAmount;
                    
                    emit RevenueDistributed(token, shareAmount, recipient);
                }
            }
        }
    }

    // ============ Governance ============

    /**
     * @notice Create a governance proposal
     * @param description Proposal description
     * @param proposalType Type of proposal
     * @param data Encoded proposal data
     * @return proposalId The ID of the created proposal
     */
    function createProposal(
        string calldata description,
        ProposalType proposalType,
        bytes calldata data
    ) external returns (uint256 proposalId) {
        if (votingPower[msg.sender] < (totalVotingPower * proposalThreshold) / BASIS_POINTS) {
            revert InsufficientVotingPower();
        }
        
        proposalId = ++proposalCount;
        Proposal storage proposal = proposals[proposalId];
        
        proposal.id = proposalId;
        proposal.proposer = msg.sender;
        proposal.description = description;
        proposal.proposalType = proposalType;
        proposal.data = data;
        proposal.startTime = block.timestamp;
        proposal.endTime = block.timestamp + votingPeriod;
        
        emit ProposalCreated(proposalId, msg.sender, description);
    }

    /**
     * @notice Cast a vote on a proposal
     * @param proposalId Proposal to vote on
     * @param voteType Type of vote (FOR, AGAINST, ABSTAIN)
     */
    function castVote(uint256 proposalId, VoteType voteType) external {
        Proposal storage proposal = proposals[proposalId];
        
        if (proposal.id == 0) revert ProposalNotFound();
        if (block.timestamp < proposal.startTime || block.timestamp > proposal.endTime) {
            revert ProposalNotActive();
        }
        if (proposal.hasVoted[msg.sender]) revert ProposalAlreadyVoted();
        
        uint256 weight = getVotingPower(msg.sender);
        proposal.hasVoted[msg.sender] = true;
        proposal.votes[msg.sender] = voteType;
        
        if (voteType == VoteType.FOR) {
            proposal.forVotes += weight;
        } else if (voteType == VoteType.AGAINST) {
            proposal.againstVotes += weight;
        } else {
            proposal.abstainVotes += weight;
        }
        
        emit VoteCast(proposalId, msg.sender, voteType, weight);
    }

    /**
     * @notice Execute a successful proposal
     * @param proposalId Proposal to execute
     */
    function executeProposal(uint256 proposalId) external {
        Proposal storage proposal = proposals[proposalId];
        
        if (proposal.id == 0) revert ProposalNotFound();
        if (proposal.executed) revert ProposalAlreadyExecuted();
        if (block.timestamp < proposal.endTime + executionDelay) revert ExecutionDelayNotMet();
        
        ProposalState state = getProposalState(proposalId);
        if (state != ProposalState.SUCCEEDED) revert ProposalNotSucceeded();
        
        proposal.executed = true;
        
        // Execute based on proposal type
        if (proposal.proposalType == ProposalType.ADD_FEE_TIER) {
            (uint24 fee, int24 tickSpacing, string memory description) = 
                abi.decode(proposal.data, (uint24, int24, string));
            _addFeeTier(fee, tickSpacing, description);
        } else if (proposal.proposalType == ProposalType.REMOVE_FEE_TIER) {
            uint24 fee = abi.decode(proposal.data, (uint24));
            removeFeeTier(fee);
        } else if (proposal.proposalType == ProposalType.UPDATE_REVENUE_SHARE) {
            (address recipient, uint256 percentage, bool active) = 
                abi.decode(proposal.data, (address, uint256, bool));
            updateRevenueShare(recipient, percentage, active);
        } else if (proposal.proposalType == ProposalType.UPDATE_GOVERNANCE_PARAMS) {
            (uint256 newVotingPeriod, uint256 newQuorum, uint256 newThreshold) = 
                abi.decode(proposal.data, (uint256, uint256, uint256));
            _updateGovernanceParams(newVotingPeriod, newQuorum, newThreshold);
        }
        
        emit ProposalExecuted(proposalId);
    }

    // ============ Voting Power Management ============

    /**
     * @notice Update voting power for an account
     * @param account Account to update
     * @param newPower New voting power
     */
    function updateVotingPower(address account, uint256 newPower) external onlyOwner {
        uint256 oldPower = votingPower[account];
        votingPower[account] = newPower;
        
        totalVotingPower = totalVotingPower - oldPower + newPower;
        
        emit VotingPowerUpdated(account, newPower);
    }

    /**
     * @notice Delegate votes to another address
     * @param delegatee Address to delegate to
     */
    function delegate(address delegatee) external {
        address currentDelegate = delegates[msg.sender];
        
        // Remove from current delegate
        if (currentDelegate != address(0)) {
            delegatedVotes[currentDelegate] -= votingPower[msg.sender];
        }
        
        // Add to new delegate
        delegates[msg.sender] = delegatee;
        if (delegatee != address(0)) {
            delegatedVotes[delegatee] += votingPower[msg.sender];
        }
        
        emit VotesDelegated(msg.sender, delegatee);
    }

    // ============ View Functions ============

    /**
     * @notice Get effective voting power (own + delegated)
     * @param account Account to check
     * @return Total voting power
     */
    function getVotingPower(address account) public view returns (uint256) {
        return votingPower[account] + delegatedVotes[account];
    }

    /**
     * @notice Get proposal state
     * @param proposalId Proposal to check
     * @return Current state of the proposal
     */
    function getProposalState(uint256 proposalId) public view returns (ProposalState) {
        Proposal storage proposal = proposals[proposalId];
        
        if (proposal.id == 0) return ProposalState.PENDING;
        if (proposal.canceled) return ProposalState.CANCELED;
        if (proposal.executed) return ProposalState.EXECUTED;
        
        if (block.timestamp < proposal.startTime) {
            return ProposalState.PENDING;
        } else if (block.timestamp <= proposal.endTime) {
            return ProposalState.ACTIVE;
        } else {
            uint256 totalVotes = proposal.forVotes + proposal.againstVotes + proposal.abstainVotes;
            uint256 quorum = (totalVotingPower * quorumPercentage) / BASIS_POINTS;
            
            if (totalVotes < quorum) {
                return ProposalState.DEFEATED;
            } else if (proposal.forVotes > proposal.againstVotes) {
                if (block.timestamp > proposal.endTime + executionDelay + 14 days) {
                    return ProposalState.EXPIRED;
                }
                return ProposalState.SUCCEEDED;
            } else {
                return ProposalState.DEFEATED;
            }
        }
    }

    /**
     * @notice Get all active fee tiers
     * @return Array of active fee tiers
     */
    function getActiveFees() external view returns (uint24[] memory) {
        return activeFeeList;
    }

    /**
     * @notice Get fee tier information
     * @param fee Fee tier to query
     * @return FeeTier struct
     */
    function getFeeTier(uint24 fee) external view returns (FeeTier memory) {
        return feeTiers[fee];
    }

    /**
     * @notice Get revenue share information
     * @param recipient Recipient to query
     * @return RevenueShare struct
     */
    function getRevenueShare(address recipient) external view returns (RevenueShare memory) {
        return revenueShares[recipient];
    }

    /**
     * @notice Get all revenue recipients
     * @return Array of recipient addresses
     */
    function getRevenueRecipients() external view returns (address[] memory) {
        return revenueRecipients;
    }

    /**
     * @notice Check if fee tier is valid
     * @param fee Fee to check
     * @return Whether fee tier exists and is active
     */
    function isValidFeeTier(uint24 fee) external view returns (bool) {
        return feeTiers[fee].active;
    }

    /**
     * @notice Get protocol revenue for a token
     * @param token Token to query
     * @return Total revenue and distributed amount
     */
    function getProtocolRevenue(address token) external view returns (uint256, uint256) {
        return (protocolRevenue[token], totalDistributed[token]);
    }

    /**
     * @notice Get current fee for a pool key
     * @param key Pool key containing token addresses
     * @return fee Current fee for the pool
     */
    function getFee(PoolKey calldata key) external view returns (uint24 fee) {
        // For now, return a default fee based on the pool's fee tier
        // This can be enhanced to support dynamic fees based on pool conditions
        return 3000; // 0.3% default fee
    }

    /**
     * @notice Get current fee for token pair
     * @param tokenA First token address
     * @param tokenB Second token address
     * @return fee Current fee for the pair
     */
    function getCurrentFee(address tokenA, address tokenB) external view returns (uint24 fee) {
        // For now, return a default fee
        // This can be enhanced to support dynamic fees based on pair conditions
        return 3000; // 0.3% default fee
    }

    /**
     * @notice Update fee based on swap volume (for dynamic fee adjustment)
     * @param key Pool key
     * @param swapVolume Recent swap volume
     */
    function updateFee(PoolKey calldata key, uint256 swapVolume) external {
        // For now, this is a placeholder implementation
        // In a real implementation, this would adjust fees based on volume
        // Only allow authorized updaters or owner to call this
        // Implementation can be enhanced to actually update fees based on volume
    }

    // ============ Admin Functions ============

    /**
     * @notice Update protocol fee percentage
     * @param newFeePercentage New fee percentage in basis points
     */
    function updateProtocolFee(uint256 newFeePercentage) external onlyOwner {
        if (newFeePercentage > MAX_FEE) revert InvalidPercentage();
        protocolFeePercentage = newFeePercentage;
        emit ProtocolFeeUpdated(newFeePercentage);
    }

    /**
     * @notice Emergency pause
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Cancel a proposal (emergency)
     * @param proposalId Proposal to cancel
     */
    function cancelProposal(uint256 proposalId) external onlyOwner {
        Proposal storage proposal = proposals[proposalId];
        if (proposal.id == 0) revert ProposalNotFound();
        
        proposal.canceled = true;
        emit ProposalCanceled(proposalId);
    }

    // ============ Internal Functions ============

    /**
     * @notice Internal function to add fee tier
     */
    function _addFeeTier(uint24 fee, int24 tickSpacing, string memory description) internal {
        if (fee > MAX_FEE) revert InvalidFee();
        if (feeTiers[fee].createdAt != 0) revert FeeTierExists();
        if (tickSpacing <= 0) revert InvalidTickSpacing();
        
        feeTiers[fee] = FeeTier({
            fee: fee,
            tickSpacing: tickSpacing,
            active: true,
            createdAt: block.timestamp,
            description: description
        });
        
        activeFeeList.push(fee);
        
        emit FeeTierAdded(fee, tickSpacing, description);
    }

    /**
     * @notice Internal function to add revenue share
     */
    function _addRevenueShare(address recipient, uint256 percentage) internal {
        if (recipient == address(0)) revert ZeroAddress();
        if (percentage > BASIS_POINTS) revert InvalidPercentage();
        if (revenueShares[recipient].recipient != address(0)) revert RecipientExists();
        
        revenueShares[recipient] = RevenueShare({
            recipient: recipient,
            percentage: percentage,
            active: true,
            totalClaimed: 0
        });
        
        revenueRecipients.push(recipient);
        
        emit RevenueShareAdded(recipient, percentage);
    }

    /**
     * @notice Internal function to update governance parameters
     */
    function _updateGovernanceParams(
        uint256 newVotingPeriod,
        uint256 newQuorum,
        uint256 newThreshold
    ) internal {
        if (newVotingPeriod < MIN_VOTING_PERIOD || newVotingPeriod > MAX_VOTING_PERIOD) {
            revert InvalidGovernanceParams();
        }
        if (newQuorum < MIN_QUORUM || newQuorum > BASIS_POINTS) {
            revert InvalidGovernanceParams();
        }
        if (newThreshold > BASIS_POINTS) {
            revert InvalidGovernanceParams();
        }
        
        votingPeriod = newVotingPeriod;
        quorumPercentage = newQuorum;
        proposalThreshold = newThreshold;
        
        emit GovernanceParamsUpdated(newVotingPeriod, newQuorum, newThreshold);
    }
}