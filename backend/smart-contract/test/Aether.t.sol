// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {console} from "forge-std/console.sol"; // Add import for console.sol
// import {AetherRouter} from "../src/primary/AetherRouter.sol"; // Old Router
import {LiquidityRouter, SimpleSwapRouter} from "@primary/RouterImports.sol";
// Note: Using SimpleSwapRouter directly below for clarity. AliasedSwapRouter was removed from RouterImports.
import {IAetherPool} from "@interfaces/IAetherPool.sol";
import {IPoolManager} from "@interfaces/IPoolManager.sol";
import {MockPoolManager} from "@mocks/MockPoolManager.sol"; // Using remapping
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol"; // Using remapping
import {TransferHelper} from "@libraries/TransferHelper.sol"; // Using remapping

error InvalidAmount(uint256 amount);
error InvalidTokenAddress(address token);
error InvalidRecipient(address recipient);
error UnauthorizedAccess(address caller);
error InvalidRouteData();
error InsufficientOutputAmount(uint256 amountOut, uint256 amountOutMin);
error EOAOnly();
error InvalidChainId(uint16 chainId);

interface IEvents {
    event RouteExecuted( // Changed from uint256 to uint16 to match router event
        address indexed user,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint16 chainId,
        bytes32 routeHash
    );
}

contract MockToken {
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply; // Add totalSupply

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance; // Add allowance mapping

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }

    function mint(address to, uint256 amount) public {
        balanceOf[to] += amount;
        totalSupply += amount; // Add missing totalSupply update
    }

    function approve(address spender, uint256 amount) public returns (bool) {
        allowance[msg.sender][spender] = amount; // Actually set the allowance
        // emit Approval(msg.sender, spender, amount); // Optional: Add event if needed
        return true;
    }

    function transfer(address to, uint256 amount) public returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    // Refined transferFrom function
    function transferFrom(address from, address to, uint256 amount) public returns (bool) {
        console.log("MockToken.transferFrom called:");
        console.log("  from: %s", from);
        console.log("  to: %s", to);
        console.log("  spender (msg.sender): %s", msg.sender);
        console.log("  amount: %s", amount);

        // Check balance first
        uint256 currentBalance = balanceOf[from];
        console.log("  Current Balance of 'from': %s", currentBalance);
        require(currentBalance >= amount, "TRANSFER_FROM_FAILED: Insufficient balance");

        // Allowance check: msg.sender is the spender (the router in this case)
        uint256 currentAllowance = allowance[from][msg.sender];
        console.log("  Current Allowance for 'spender' from 'from': %s", currentAllowance);
        if (currentAllowance != type(uint256).max) {
            require(currentAllowance >= amount, "TRANSFER_FROM_FAILED: Insufficient allowance");
            allowance[from][msg.sender] = currentAllowance - amount; // Decrease allowance
        }

        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockCCIPRouter {
    function estimateFees(uint16, address, bytes memory) external pure returns (uint256) {
        return 0.1 ether;
    }

    // Modified to return a non-zero messageId
    function sendMessage(uint16, address, bytes memory) external payable returns (bytes32) {
        return bytes32(uint256(1)); // Return a mock message ID
    }
}

contract MockHyperlane {
    function quoteDispatch(uint16, bytes memory) external pure returns (uint256) {
        return 0.1 ether;
    }

    // Modified to return a non-zero messageId (assuming this is the intended function)
    function sendMessage(uint16, address, bytes memory) external payable returns (bytes32) {
        return bytes32(uint256(2)); // Return a different mock message ID
    }

    // Added dispatch function to match AetherRouter call, returning non-zero ID
    function dispatch(uint16, bytes32, bytes memory) external payable returns (bytes32) {
        return bytes32(uint256(3)); // Return a mock message ID
    }
}

contract MaliciousContract {
    SimpleSwapRouter public swapRouterInstance; // Changed to SimpleSwapRouter
    address public pool;
    address public sorted_token0;
    address public sorted_token1;
    uint24 public fee_val;

    event FallbackCalled();

    constructor(SimpleSwapRouter _swapRouter, address _pool, address _sorted_token0, address _sorted_token1, uint24 _fee) { // Changed to SimpleSwapRouter
        swapRouterInstance = _swapRouter;
        pool = _pool;
        sorted_token0 = _sorted_token0;
        sorted_token1 = _sorted_token1;
        fee_val = _fee;
    }

    function startAttack(address _tokenIn, address _tokenOut, uint256 amountIn, uint256 amountOutMin, uint256 deadline)
        external
    {
        address[] memory path = new address[](3);
        path[0] = _tokenIn;
        path[1] = _tokenOut;
        path[2] = pool;
        swapRouterInstance.swapExactTokensForTokens(amountIn, amountOutMin, path, address(this), deadline);
    }

    fallback() external payable {
        emit FallbackCalled();
        address[] memory path = new address[](3);
        path[0] = sorted_token0;
        path[1] = sorted_token1;
        path[2] = pool;
        swapRouterInstance.swapExactTokensForTokens(100, 0, path, address(this), block.timestamp);
    }

    receive() external payable {}
}

contract AetherRouterTest is Test, IEvents {
    LiquidityRouter public liquidityRouter;
    SimpleSwapRouter public swapRouter; // Changed to SimpleSwapRouter
    MockToken public tokenA;
    MockToken public tokenB;
    IAetherPool public pool;
    address public owner = address(1);
    address public user = address(2);
    uint24 public constant DEFAULT_FEE = 500;

    address public token0Addr;
    address public token1Addr;

    function setUp() public {
        owner = address(1);
        tokenA = new MockToken("TokenA", "TKNA", 18);
        tokenB = new MockToken("TokenB", "TKNB", 18);
        vm.startPrank(owner);
        vm.stopPrank();
        liquidityRouter = new LiquidityRouter();
        swapRouter = new SimpleSwapRouter(); // Changed to SimpleSwapRouter

        if (address(tokenA) < address(tokenB)) {
            token0Addr = address(tokenA);
            token1Addr = address(tokenB);
        } else {
            token0Addr = address(tokenB);
            token1Addr = address(tokenA);
        }

        bytes memory poolBytecode = vm.getCode("../src/security/AetherPool.vy"); // Corrected to .vy and path is already relative
        bytes memory constructorArgs = abi.encode(token0Addr, token1Addr, DEFAULT_FEE);
        address deployedPoolAddress;
        assembly {
            deployedPoolAddress := create(0, add(poolBytecode, 0x20), mload(poolBytecode))
        }
        require(deployedPoolAddress != address(0), "Pool deployment failed");
        pool = IAetherPool(deployedPoolAddress);

        uint256 amountADesired = 1000 * 10 ** 18;
        uint256 amountBDesired = 10000 * 10 ** 18;
        tokenA.mint(address(this), amountADesired);
        tokenB.mint(address(this), amountBDesired);
        tokenA.approve(address(liquidityRouter), type(uint256).max);
        tokenB.approve(address(liquidityRouter), type(uint256).max);
        tokenA.approve(address(swapRouter), type(uint256).max);
        tokenB.approve(address(swapRouter), type(uint256).max);

        uint256 amountAMin = 0;
        uint256 amountBMin = 0;
        uint256 deadline = block.timestamp + 1;

        LiquidityRouter.AddLiquidityParams memory params = LiquidityRouter.AddLiquidityParams({
            tokenA: address(tokenA),
            tokenB: address(tokenB),
            pool: address(pool),
            amountADesired: amountADesired,
            amountBDesired: amountBDesired,
            amountAMin: amountAMin,
            amountBMin: amountBMin,
            to: address(this),
            deadline: deadline
        });
        ( /*uint256 amountAActual*/ , /*uint256 amountBActual*/, uint256 liquidity) = liquidityRouter.addLiquidity(params);
        assertTrue(liquidity > 0, "Initial liquidity minting failed");
        console.log("Pool Deployed: %s", address(pool));
        console.log("Initial Liquidity Added: %s", liquidity);
    }

    function _getSortedTokens() internal view returns (address _token0, address _token1) {
        if (address(tokenA) < address(tokenB)) {
            return (address(tokenA), address(tokenB));
        } else {
            return (address(tokenB), address(tokenA));
        }
    }
}
