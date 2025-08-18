// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import "forge-std/Test.sol";
import "../../src/primary/AetherPool.sol";
import "../../src/primary/AetherRouter.sol";
import "../../src/libraries/Errors.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SmartContractEdgeCases
 * @notice Comprehensive edge case testing for AetherDEX smart contracts
 * @dev Tests extreme scenarios, boundary values, and potential attack vectors
 */
contract SmartContractEdgeCasesTest is Test {
    AetherPool public pool;
    AetherRouter public router;
    MockERC20 public token0;
    MockERC20 public token1;
    MockPoolManager public poolManager;
    MockRoleManager public roleManager;
    
    address public constant ADMIN = address(0x1);
    address public constant USER = address(0x2);
    address public constant ATTACKER = address(0x3);
    address public constant PROTOCOL_FEE_RECIPIENT = address(0x4);
    
    uint24 public constant POOL_FEE = 3000; // 0.3%
    uint256 public constant INITIAL_SUPPLY = 1000000 * 10**18;
    uint256 public constant MAX_UINT256 = type(uint256).max;
    uint112 public constant MAX_UINT112 = type(uint112).max;
    
    event log_named_uint256(string key, uint256 val);
    
    function setUp() public {
        // Deploy mock tokens
        token0 = new MockERC20("Token0", "TK0", 18);
        token1 = new MockERC20("Token1", "TK1", 18);
        
        // Ensure token0 < token1 for consistent ordering
        if (address(token0) > address(token1)) {
            (token0, token1) = (token1, token0);
        }
        
        // Deploy mock managers
        poolManager = new MockPoolManager();
        roleManager = new MockRoleManager();
        
        // Deploy pool with extreme initial limits
        pool = new AetherPool(
            address(token0),
            address(token1),
            POOL_FEE,
            address(poolManager),
            PROTOCOL_FEE_RECIPIENT,
            ADMIN,
            1000000000, // Very high gas limit
            MAX_UINT256  // Maximum value limit
        );
        
        // Deploy router
        router = new AetherRouter(
            address(poolManager),
            address(roleManager),
            ADMIN,
            1000000000,
            MAX_UINT256
        );
        
        // Setup initial balances
        token0.mint(USER, INITIAL_SUPPLY);
        token1.mint(USER, INITIAL_SUPPLY);
        token0.mint(ATTACKER, INITIAL_SUPPLY);
        token1.mint(ATTACKER, INITIAL_SUPPLY);
        
        // Initialize pool
        vm.prank(address(poolManager));
        pool.initialize(address(token0), address(token1), POOL_FEE);
    }
    
    // ============ BOUNDARY VALUE TESTS ============
    
    function testMaximumLiquidityProvision() public {
        vm.startPrank(USER);
        
        // Test with maximum possible amounts
        uint256 maxAmount0 = MAX_UINT112;
        uint256 maxAmount1 = MAX_UINT112;
        
        token0.approve(address(pool), maxAmount0);
        token1.approve(address(pool), maxAmount1);
        
        // This should revert due to overflow protection
        vm.expectRevert(Errors.Overflow.selector);
        pool.addInitialLiquidity(maxAmount0, maxAmount1);
        
        vm.stopPrank();
    }
    
    function testMinimumLiquidityEdgeCase() public {
        vm.startPrank(USER);
        
        // Test with amounts that would result in liquidity <= MINIMUM_LIQUIDITY
        uint256 amount0 = 1000; // Very small amount
        uint256 amount1 = 1;
        
        token0.approve(address(pool), amount0);
        token1.approve(address(pool), amount1);
        
        // Should revert due to insufficient liquidity
        vm.expectRevert(Errors.InsufficientLiquidityMinted.selector);
        pool.addInitialLiquidity(amount0, amount1);
        
        vm.stopPrank();
    }
    
    function testZeroLiquiditySwap() public {
        vm.startPrank(USER);
        
        // Try to swap without any liquidity in pool
        uint256 swapAmount = 1000 * 10**18;
        token0.approve(address(pool), swapAmount);
        
        vm.expectRevert(Errors.InsufficientLiquidity.selector);
        pool.swap(swapAmount, address(token0), USER);
        
        vm.stopPrank();
    }
    
    function testMaximumSlippageScenario() public {
        // Setup pool with initial liquidity
        _setupPoolWithLiquidity(1000000 * 10**18, 1000000 * 10**18);
        
        vm.startPrank(ATTACKER);
        
        // Attempt massive swap that would cause extreme slippage
        uint256 massiveSwapAmount = 999999 * 10**18; // Nearly all liquidity
        token0.approve(address(pool), massiveSwapAmount);
        
        // This should work but with extreme slippage
        uint256 amountOut = pool.swap(massiveSwapAmount, address(token0), ATTACKER);
        
        // Verify extreme slippage occurred
        assertTrue(amountOut < massiveSwapAmount / 1000, "Slippage should be extreme");
        
        vm.stopPrank();
    }
    
    // ============ ATTACK VECTOR TESTS ============
    
    function testReentrancyAttack() public {
        _setupPoolWithLiquidity(1000000 * 10**18, 1000000 * 10**18);
        
        // Deploy malicious token that attempts reentrancy
        MaliciousToken maliciousToken = new MaliciousToken(address(pool));
        
        vm.startPrank(ATTACKER);
        
        // This should be prevented by ReentrancyGuard
        vm.expectRevert();
        maliciousToken.triggerReentrancy();
        
        vm.stopPrank();
    }
    
    function testFlashLoanAttack() public {
        _setupPoolWithLiquidity(1000000 * 10**18, 1000000 * 10**18);
        
        vm.startPrank(ATTACKER);
        
        // Simulate flash loan attack by borrowing large amount and trying to manipulate price
        uint256 flashAmount = 500000 * 10**18;
        token0.approve(address(pool), flashAmount);
        
        // First swap to manipulate price
        uint256 amountOut1 = pool.swap(flashAmount, address(token0), ATTACKER);
        
        // Try to exploit the price change
        token1.approve(address(pool), amountOut1);
        uint256 amountOut2 = pool.swap(amountOut1, address(token1), ATTACKER);
        
        // Verify that the attack is not profitable due to fees and slippage
        assertTrue(amountOut2 < flashAmount, "Flash loan attack should not be profitable");
        
        vm.stopPrank();
    }
    
    function testSandwichAttack() public {
        _setupPoolWithLiquidity(1000000 * 10**18, 1000000 * 10**18);
        
        vm.startPrank(ATTACKER);
        
        // Simulate sandwich attack
        uint256 frontrunAmount = 100000 * 10**18;
        uint256 victimAmount = 50000 * 10**18;
        
        token0.approve(address(pool), frontrunAmount + victimAmount);
        token1.approve(address(pool), 1000000 * 10**18);
        
        // Front-run: Buy before victim
        uint256 frontrunOut = pool.swap(frontrunAmount, address(token0), ATTACKER);
        
        // Victim transaction (simulated)
        uint256 victimOut = pool.swap(victimAmount, address(token0), ATTACKER);
        
        // Back-run: Sell after victim
        uint256 backrunOut = pool.swap(frontrunOut, address(token1), ATTACKER);
        
        // Verify sandwich attack profitability is limited by fees
        uint256 totalCost = frontrunAmount + victimAmount;
        assertTrue(backrunOut <= totalCost, "Sandwich attack should not be highly profitable");
        
        vm.stopPrank();
    }
    
    // ============ PRECISION AND ROUNDING TESTS ============
    
    function testPrecisionLossInSmallSwaps() public {
        _setupPoolWithLiquidity(1000000 * 10**18, 1000000 * 10**18);
        
        vm.startPrank(USER);
        
        // Test very small swap amounts
        uint256 tinyAmount = 1; // 1 wei
        token0.approve(address(pool), tinyAmount);
        
        // This might revert due to insufficient output or precision loss
        try pool.swap(tinyAmount, address(token0), USER) returns (uint256 amountOut) {
            assertTrue(amountOut == 0, "Tiny swap should result in zero output due to precision");
        } catch {
            // Expected to revert with InsufficientOutputAmount
        }
        
        vm.stopPrank();
    }
    
    function testRoundingInLiquidityCalculations() public {
        vm.startPrank(USER);
        
        // Setup with odd amounts that might cause rounding issues
        uint256 amount0 = 1000000000000000001; // Odd number
        uint256 amount1 = 3333333333333333333; // Another odd number
        
        token0.approve(address(pool), amount0);
        token1.approve(address(pool), amount1);
        
        uint256 liquidity = pool.addInitialLiquidity(amount0, amount1);
        assertTrue(liquidity > 0, "Should mint some liquidity despite odd amounts");
        
        vm.stopPrank();
    }
    
    // ============ EXTREME VALUE TESTS ============
    
    function testSwapWithZeroAmount() public {
        _setupPoolWithLiquidity(1000000 * 10**18, 1000000 * 10**18);
        
        vm.startPrank(USER);
        
        vm.expectRevert(Errors.InvalidAmountIn.selector);
        pool.swap(0, address(token0), USER);
        
        vm.stopPrank();
    }
    
    function testSwapToZeroAddress() public {
        _setupPoolWithLiquidity(1000000 * 10**18, 1000000 * 10**18);
        
        vm.startPrank(USER);
        
        uint256 swapAmount = 1000 * 10**18;
        token0.approve(address(pool), swapAmount);
        
        vm.expectRevert(Errors.ZeroAddress.selector);
        pool.swap(swapAmount, address(token0), address(0));
        
        vm.stopPrank();
    }
    
    function testSwapInvalidToken() public {
        _setupPoolWithLiquidity(1000000 * 10**18, 1000000 * 10**18);
        
        vm.startPrank(USER);
        
        uint256 swapAmount = 1000 * 10**18;
        MockERC20 invalidToken = new MockERC20("Invalid", "INV", 18);
        
        vm.expectRevert(Errors.InvalidToken.selector);
        pool.swap(swapAmount, address(invalidToken), USER);
        
        vm.stopPrank();
    }
    
    // ============ LIQUIDITY EDGE CASES ============
    
    function testBurnAllLiquidity() public {
        uint256 liquidity = _setupPoolWithLiquidity(1000000 * 10**18, 1000000 * 10**18);
        
        vm.startPrank(USER);
        
        // Try to burn all liquidity (should leave minimum liquidity)
        pool.transfer(address(pool), liquidity);
        
        (uint256 amount0, uint256 amount1) = pool.burn(USER, liquidity);
        
        assertTrue(amount0 > 0 && amount1 > 0, "Should return some tokens");
        assertTrue(pool.totalSupply() >= pool.MINIMUM_LIQUIDITY(), "Minimum liquidity should remain");
        
        vm.stopPrank();
    }
    
    function testBurnZeroLiquidity() public {
        _setupPoolWithLiquidity(1000000 * 10**18, 1000000 * 10**18);
        
        vm.startPrank(USER);
        
        vm.expectRevert(Errors.InsufficientLiquidityBurned.selector);
        pool.burn(USER, 0);
        
        vm.stopPrank();
    }
    
    // ============ HELPER FUNCTIONS ============
    
    function _setupPoolWithLiquidity(uint256 amount0, uint256 amount1) internal returns (uint256 liquidity) {
        vm.startPrank(USER);
        
        token0.approve(address(pool), amount0);
        token1.approve(address(pool), amount1);
        
        liquidity = pool.addInitialLiquidity(amount0, amount1);
        
        vm.stopPrank();
    }
}

// ============ MOCK CONTRACTS ============

contract MockERC20 is ERC20 {
    uint8 private _decimals;
    
    constructor(string memory name, string memory symbol, uint8 decimals_) ERC20(name, symbol) {
        _decimals = decimals_;
    }
    
    function decimals() public view override returns (uint8) {
        return _decimals;
    }
    
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockPoolManager {
    mapping(bytes32 => address) public pools;
    mapping(bytes32 => bool) public pausedPools;
    
    function getPool(PoolKey memory key) external view returns (address) {
        return pools[keccak256(abi.encode(key))];
    }
    
    function isPoolPaused(PoolKey memory key) external view returns (bool) {
        return pausedPools[keccak256(abi.encode(key))];
    }
    
    function setPool(PoolKey memory key, address pool) external {
        pools[keccak256(abi.encode(key))] = pool;
    }
}

contract MockRoleManager {
    mapping(bytes32 => mapping(address => bool)) public roles;
    
    function hasRole(bytes32 role, address account) external view returns (bool) {
        return roles[role][account];
    }
    
    function grantRole(bytes32 role, address account) external {
        roles[role][account] = true;
    }
}

contract MaliciousToken is ERC20 {
    AetherPool public pool;
    bool public attacking;
    
    constructor(address _pool) ERC20("Malicious", "MAL") {
        pool = AetherPool(_pool);
        _mint(msg.sender, 1000000 * 10**18);
    }
    
    function triggerReentrancy() external {
        attacking = true;
        // This would attempt to call pool functions during transfer
        pool.swap(1000, address(this), msg.sender);
    }
    
    function transfer(address to, uint256 amount) public override returns (bool) {
        if (attacking) {
            // Attempt reentrancy attack
            pool.swap(1, address(this), to);
        }
        return super.transfer(to, amount);
    }
}

// Import required types (these would normally be imported from actual contracts)
struct PoolKey {
    address token0;
    address token1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

bytes32 constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");