// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {console} from "forge-std/console.sol"; // Add import for console.sol
import {AetherRouter} from "src/primary/AetherRouter.sol";
import {IAetherPool} from "src/interfaces/IAetherPool.sol"; // Correct interface import
import {IPoolManager} from "src/interfaces/IPoolManager.sol"; // Keep this standard import
import {MockPoolManager} from "./mocks/MockPoolManager.sol"; // Import MockPoolManager
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol"; // Import Ownable for error
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol"; // Import Pausable for error
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol"; // Import ReentrancyGuard for the error
import {TickMath} from "lib/v4-core/src/libraries/TickMath.sol"; // Import TickMath
import "src/libraries/TransferHelper.sol";

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
    AetherRouter public router;
    address public pool; // Store the pool address
    address public sorted_token0;
    address public sorted_token1;
    uint24 public fee_val;

    event FallbackCalled(); // Event to signal fallback execution

    // MODIFIED Constructor to accept router, POOL, SORTED token addresses, and fee
    constructor(AetherRouter _router, address _pool, address _sorted_token0, address _sorted_token1, uint24 _fee) {
        router = _router;
        pool = _pool; // Store pool
        sorted_token0 = _sorted_token0;
        sorted_token1 = _sorted_token1;
        fee_val = _fee;
    }

    // Function to initiate the first swap (called by the test)
    function startAttack(address _tokenIn, address _tokenOut, uint256 amountIn, uint256 amountOutMin, uint256 deadline)
        external
    {
        // Approval happens in the test context before this call
        // Construct the path for swapExactTokensForTokens: [tokenIn, tokenOut, poolAddress]
        address[] memory path = new address[](3);
        path[0] = _tokenIn;
        path[1] = _tokenOut;
        path[2] = pool; // Use the stored pool address

        // Call the correct swap function, sending output to this contract
        router.swapExactTokensForTokens(amountIn, amountOutMin, path, address(this), deadline);
    }

    // Fallback function attempts the reentrant call
    fallback() external payable {
        emit FallbackCalled(); // Emit event when fallback is triggered
        // Attempt to call back into the router using the stored SORTED tokens
        // Construct the path for the reentrant swap attempt
        address[] memory path = new address[](3);
        path[0] = sorted_token0;
        path[1] = sorted_token1;
        path[2] = pool; // Use the stored pool address

        // Call the swap function again, sending output to this contract
        // Using 100 amountIn and 0 amountOutMin as placeholders from the original executeRoute call
        router.swapExactTokensForTokens(100, 0, path, address(this), block.timestamp);
    }

    receive() external payable {}
}

contract AetherRouterTest is Test, IEvents {
    // Event definition for expectEmit - Updated to match Factory
    // event PoolCreated(bytes32 indexed poolId, address indexed pool, PoolKey key);

    // Ensure all necessary state variables are declared publicly
    AetherRouter public router;
    MockToken public tokenA;
    MockToken public tokenB;
    // FeeRegistry public feeRegistry; // Commented out due to abstract contract issues
    IAetherPool public pool; // Reference to the deployed pool
    address public owner = address(1);
    address public user = address(2); // Make user public for potential inspection
    uint24 public constant DEFAULT_FEE = 500; // Define default fee

    // Store sorted tokens globally for tests
    address public token0Addr;
    address public token1Addr;

    function setUp() public {
        // Assign owner address first
        owner = address(1);

        // Deploy tokens
        tokenA = new MockToken("TokenA", "TKNA", 18);
        tokenB = new MockToken("TokenB", "TKNB", 18);

        // --- Deploy Fee Registry ---
        vm.startPrank(owner); // Prank as owner for deployment
        // feeRegistry = new FeeRegistry(owner); // Assuming constructor takes initial owner
        // Add the default fee tier (e.g., 500 with tick spacing 10)
        // feeRegistry.addFeeTier(DEFAULT_FEE, 10);
        // FeeRegistry usage commented out to allow testing core router/pool interaction
        vm.stopPrank();

        // --- Deploy Router ---
        // Deploy a mock pool manager and role manager for testing
        address mockPoolManager = address(0x1234);
        address mockRoleManager = address(0x5678);
        router = new AetherRouter();

        // --- Get Sorted Tokens ---
        if (address(tokenA) < address(tokenB)) {
            token0Addr = address(tokenA);
            token1Addr = address(tokenB);
        } else {
            token0Addr = address(tokenB);
            token1Addr = address(tokenA);
        }

        // --- Deploy Pool ---
        bytes memory poolBytecode = vm.getCode("../src/security/AetherPool.sol");
        bytes memory constructorArgs = abi.encode(token0Addr, token1Addr, DEFAULT_FEE);
        address deployedPoolAddress; // Declare outside
        assembly {
            deployedPoolAddress := create(0, add(poolBytecode, 0x20), mload(poolBytecode)) // Assign inside
        }
        require(deployedPoolAddress != address(0), "Pool deployment failed");
        pool = IAetherPool(deployedPoolAddress); // Now accessible

        // --- Add Initial Liquidity via Router ---
        uint256 amountADesired = 1000 * 10 ** 18;
        uint256 amountBDesired = 10000 * 10 ** 18;

        // Mint tokens to the test contract (or user)
        tokenA.mint(address(this), amountADesired);
        tokenB.mint(address(this), amountBDesired);

        // Approve the router to spend tokens
        tokenA.approve(address(router), type(uint256).max);
        tokenB.approve(address(router), type(uint256).max);

        // Add liquidity using the router
        uint256 amountAMin = 0; // No slippage for initial seed
        uint256 amountBMin = 0; // No slippage for initial seed
        uint256 deadline = block.timestamp + 1;

        (/*amountAActual*/,/*amountBActual*/, uint256 liquidity) = router.addLiquidity(
            address(pool), amountADesired, amountBDesired, amountAMin, amountBMin, address(this), deadline
        );

        // Optional: Assert initial liquidity added successfully
        assertTrue(liquidity > 0, "Initial liquidity minting failed");
        console.log("Pool Deployed: %s", address(pool));
        console.log("Initial Liquidity Added: %s", liquidity);
    }

    // Helper function to get sorted token addresses
    function _getSortedTokens() internal view returns (address _token0, address _token1) {
        if (address(tokenA) < address(tokenB)) {
            return (address(tokenA), address(tokenB));
        } else {
            return (address(tokenB), address(tokenA));
        }
    }

    /*
    function test_executeRoute() public {
        // ... function body ...
        // This whole function is commented out pending refactoring
    }
    */

    // TODO: Refactor ALL remaining test cases below this point
    //==============================================================================================
    //=====================   BELOW TESTS NEED COMPLETE REFACTORING ===================================
    //==============================================================================================
    // The following tests were written for the old AetherPool.sol and direct pool interactions.
    // They need to be rewritten to:
    // 1. Interact with the `AetherRouter.sol` contract.
    // 2. Target the deployed `AetherPool.vy` instance (`vyperPool`).
    // 3. Use appropriate router functions (addLiquidity, removeLiquidity, swap*).
    // 4. Adjust assertions to check router events, Vyper pool events, and state changes correctly.
    // 5. Use vm.startPrank/stopPrank for sender simulation.
    // 6. Remove references to the old `pool`, `factory`, `mockPoolManager`.
    //==============================================================================================
    //==============================================================================================
    //==============================================================================================

    // ... Rest of the tests ...

    //==============================================================================================
    //=====================   BELOW TESTS NEED COMPLETE REFACTORING ===================================
    //==============================================================================================
    // The following tests were written for the old AetherPool.sol and direct pool interactions.
    // They need to be rewritten to:
    // 1. Interact with the `AetherRouter.sol` contract.
    // 2. Target the deployed `AetherPool.vy` instance (`vyperPool`).
    // 3. Use appropriate router functions (addLiquidity, removeLiquidity, swap*).
    // 4. Adjust assertions to check router events, Vyper pool events, and state changes correctly.
    // 5. Use vm.startPrank/stopPrank for sender simulation.
    // 6. Remove references to the old `pool`, `factory`, `mockPoolManager`.
    //==============================================================================================
    //==============================================================================================
    //==============================================================================================

    // ... Rest of the tests ...
}
