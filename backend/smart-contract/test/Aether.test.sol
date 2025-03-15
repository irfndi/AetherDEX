// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.29; // UPDATED PRAGMA VERSION TO 0.8.28

import "forge-std/Test.sol";
import "../src/AetherPool.sol";
import "../src/AetherFactory.sol";
import "../src/libraries/TransferHelper.sol"; // Import TransferHelper for safeTransfer

interface IERC20 { // Define IERC20 interface here - KEPT ONLY ONCE, NOW AT TOP LEVEL
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Transfer(address indexed from, address indexed to, uint256 value);

    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

// Simple MockToken implementation for testing
contract MockToken is IERC20 {
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 private _totalSupply;
    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
        _mint(msg.sender, 1000000 * 10 ** uint256(_decimals));
    }

    function totalSupply() external view override returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view override returns (uint256) {
        return _balances[account];
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function allowance(address owner, address spender) external view override returns (uint256) {
        return _allowances[owner][spender];
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        _approve(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        _spendAllowance(from, msg.sender, amount);
        _transfer(from, to, amount);
        return true;
    }

    function _mint(address account, uint256 amount) internal {
        require(account != address(0), "ERC20: mint to the zero address");
        _totalSupply += amount;
        _balances[account] += amount;
        emit Transfer(address(0), account, amount);
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(from != address(0), "ERC20: transfer from the zero address");
        require(to != address(0), "ERC20: transfer to the zero address");
        uint256 fromBalance = _balances[from];
        require(fromBalance >= amount, "ERC20: transfer amount exceeds balance");
        _balances[from] = fromBalance - amount;
        _balances[to] += amount;
        emit Transfer(from, to, amount);
    }

    function _approve(address owner, address spender, uint256 amount) internal {
        require(owner != address(0), "ERC20: approve from the zero address");
        require(spender != address(0), "ERC20: approve to the zero address");
        _allowances[owner][spender] = amount;
        emit Approval(owner, spender, amount);
    }

    function _spendAllowance(address owner, address spender, uint256 amount) internal {
        uint256 currentAllowance = _allowances[owner][spender];
        if (currentAllowance != type(uint256).max) {
            require(currentAllowance >= amount, "ERC20: insufficient allowance");
            _approve(owner, spender, currentAllowance - amount);
        }
    }

    // Public mint function for testing
    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }
}

contract AetherTest is Test {
    AetherPool public pool;
    AetherFactory public factory;
    MockToken public tokenA; // Use MockToken implementation
    MockToken public tokenB; // Use MockToken implementation
    uint256 public reserve0; // Declare reserve0 as state variable
    uint256 public reserve1; // Declare reserve1 as state variable

    function setUp() public {
        // Deploy tokens first
        tokenA = new MockToken("TokenA", "TKNA", 18); // Deploy MockToken tokens
        tokenB = new MockToken("TokenB", "TKNB", 18); // Deploy MockToken tokens

        // Deploy factory
        factory = new AetherFactory();

        // Deploy pool directly, like in SwapTest.t.sol
        pool = new AetherPool(address(factory));

        // Initialize pool
        pool.initialize(address(tokenA), address(tokenB));

        // Add initial liquidity
        uint256 amount0 = 1000 * 10 ** 18;
        uint256 amount1 = 10000 * 10 ** 18; // Increase tokenB liquidity to 10000 ether

        tokenA.mint(address(this), amount0);
        tokenB.mint(address(this), amount1);

        tokenA.approve(address(pool), amount0);
        tokenB.approve(address(pool), amount1);

        pool.mint(address(this), amount0, amount1);
    }

    function test_poolInitialization() public view {
        assertEq(address(pool.token0()), address(tokenA));
        assertEq(address(pool.token1()), address(tokenB));
        assertTrue(pool.initialized());
    }

    function test_addLiquidity() public {
        uint256 amount0 = 1000 * 10 ** 18;
        uint256 amount1 = 1000 * 10 ** 18;

        tokenA.mint(address(this), amount0);
        tokenB.mint(address(this), amount1);

        tokenA.approve(address(pool), amount0);
        tokenB.approve(address(pool), amount1);

        uint256 liquidity = pool.mint(address(this), amount0, amount1);
        assertTrue(liquidity > 0);
    }

    function test_swap() public {
        // Now try to swap
        address user = address(this); // Define user address
        uint256 swapAmount = 10 * 10 ** 18;
        tokenA.mint(user, swapAmount); // Mint tokens to user, not test contract
        tokenA.approve(address(pool), swapAmount);

        uint256 balanceBefore = tokenB.balanceOf(user);
        vm.startPrank(user); // Prank as user when swapping
        pool.swap(swapAmount, address(tokenA), user, user); // Pass user address as sender and to
        vm.stopPrank();
        uint256 balanceAfter = tokenB.balanceOf(user);

        assertTrue(balanceAfter > balanceBefore);

        // Assert swap event was emitted
        // assertEmitted(pool, abi.encodePacked("Swap(",address(0),",address,",address,",uint256,uint256)"), 1);
    }

    function test_burn() public {
        uint256 initialLiquidity = pool.totalSupply(); // Get initial liquidity
        uint256 burnAmount = initialLiquidity / 2;

        (uint256 amount0, uint256 amount1) = pool.burn(address(this), burnAmount);
        assertTrue(amount0 > 0 || amount1 > 0);
        assertEq(pool.totalSupply(), initialLiquidity - burnAmount);

        // Assert liquidity removed event was emitted
        // assertEmitted(pool, abi.encodePacked("LiquidityRemoved(",address(0),",uint256,uint256,uint256)"), 1);
    }
}
