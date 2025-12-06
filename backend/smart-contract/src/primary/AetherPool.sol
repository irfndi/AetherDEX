// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.29;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IAetherPool} from "../interfaces/IAetherPool.sol";
import {Errors} from "../libraries/Errors.sol";
import {CircuitBreaker} from "../security/CircuitBreaker.sol";

/**
 * @title AetherPool
 * @notice Automated Market Maker pool for token swaps and liquidity provision
 * @dev Implements constant product formula (x * y = k) with dynamic fees and security controls
 */
contract AetherPool is IAetherPool, ERC20, ReentrancyGuard, CircuitBreaker {
    using SafeERC20 for IERC20;
    using Math for uint256;

    /// @notice First token in the pair
    address public immutable token0;

    /// @notice Second token in the pair
    address public immutable token1;

    /// @notice Pool fee in basis points (e.g., 3000 = 0.3%)
    uint24 public fee;

    /// @notice Minimum liquidity locked forever
    uint256 public constant MINIMUM_LIQUIDITY = 1000;

    /// @notice Maximum fee that can be set (10%)
    uint24 public constant MAX_FEE = 100000;

    /// @notice Reserve of token0
    uint112 private reserve0;

    /// @notice Reserve of token1
    uint112 private reserve1;

    /// @notice Timestamp of last update
    uint32 private blockTimestampLast;

    /// @notice Cumulative price of token0
    uint256 public price0CumulativeLast;

    /// @notice Cumulative price of token1
    uint256 public price1CumulativeLast;

    /// @notice Protocol fee recipient
    address public protocolFeeRecipient;

    /// @notice Protocol fee percentage (in basis points)
    uint24 public protocolFee = 500; // 0.05%

    /// @notice Pool manager address
    address public poolManager;

    /// @notice Whether the pool has been initialized
    bool private initialized;

    /// @notice Modifier to ensure only pool manager can call
    modifier onlyPoolManager() {
        if (msg.sender != poolManager) {
            revert Errors.NotOwner();
        }
        _;
    }

    /// @notice Modifier to ensure pool is initialized
    modifier onlyInitialized() {
        if (!initialized) {
            revert Errors.NotInitialized();
        }
        _;
    }

    /**
     * @notice Constructor
     * @param _token0 Address of first token
     * @param _token1 Address of second token
     * @param _fee Initial fee for the pool
     * @param _poolManager Address of pool manager
     * @param _protocolFeeRecipient Address to receive protocol fees
     * @param admin Address to be granted admin role for CircuitBreaker
     * @param initialGasLimit Initial maximum gas price
     * @param initialValueLimit Initial maximum transaction value
     */
    constructor(
        address _token0,
        address _token1,
        uint24 _fee,
        address _poolManager,
        address _protocolFeeRecipient,
        address admin,
        uint256 initialGasLimit,
        uint256 initialValueLimit
    )
        ERC20(
            string(
                abi.encodePacked(
                    "AetherDEX LP ", IERC20Metadata(_token0).symbol(), "-", IERC20Metadata(_token1).symbol()
                )
            ),
            string(abi.encodePacked("ALP-", IERC20Metadata(_token0).symbol(), "-", IERC20Metadata(_token1).symbol()))
        )
        CircuitBreaker(admin, initialGasLimit, initialValueLimit)
    {
        if (_token0 == address(0) || _token1 == address(0)) {
            revert Errors.ZeroAddress();
        }
        if (_token0 == _token1) {
            revert Errors.IdenticalAddresses();
        }
        if (_fee > MAX_FEE) {
            revert Errors.InvalidFee();
        }
        if (_poolManager == address(0)) {
            revert Errors.ZeroAddress();
        }

        // Ensure token0 < token1 for consistent ordering
        if (_token0 > _token1) {
            (_token0, _token1) = (_token1, _token0);
        }

        token0 = _token0;
        token1 = _token1;
        fee = _fee;
        poolManager = _poolManager;
        protocolFeeRecipient = _protocolFeeRecipient;
    }

    /**
     * @notice Initialize the pool with initial parameters
     * @param _token0 Address of first token (must match constructor)
     * @param _token1 Address of second token (must match constructor)
     * @param _fee Fee for the pool (must match constructor)
     */
    function initialize(address _token0, address _token1, uint24 _fee) external override onlyPoolManager {
        if (initialized) {
            revert Errors.AlreadyInitialized();
        }
        if (_token0 != token0 || _token1 != token1 || _fee != fee) {
            revert Errors.InvalidInitialization();
        }

        initialized = true;
        blockTimestampLast = uint32(block.timestamp % 2 ** 32);
    }

    /**
     * @notice Add initial liquidity to the pool
     * @param amount0Desired Desired amount of token0
     * @param amount1Desired Desired amount of token1
     * @return liquidity Amount of LP tokens minted
     */
    function addInitialLiquidity(uint256 amount0Desired, uint256 amount1Desired)
        external
        override
        nonReentrant
        onlyInitialized
        whenNotPaused
        returns (uint256 liquidity)
    {
        if (totalSupply() > 0) {
            revert Errors.PoolAlreadyInitialized();
        }
        if (amount0Desired == 0 || amount1Desired == 0) {
            revert Errors.InsufficientLiquidityMinted();
        }

        // Transfer tokens to pool
        IERC20(token0).safeTransferFrom(msg.sender, address(this), amount0Desired);
        IERC20(token1).safeTransferFrom(msg.sender, address(this), amount1Desired);

        // Calculate initial liquidity using geometric mean
        liquidity = Math.sqrt(amount0Desired * amount1Desired);

        if (liquidity <= MINIMUM_LIQUIDITY) {
            revert Errors.InsufficientLiquidityMinted();
        }

        // Lock minimum liquidity forever
        _mint(address(0xdEaD), MINIMUM_LIQUIDITY);
        _mint(msg.sender, liquidity - MINIMUM_LIQUIDITY);

        // Update reserves
        _update(amount0Desired, amount1Desired, 0, 0);

        emit Mint(msg.sender, msg.sender, amount0Desired, amount1Desired, liquidity);
    }

    /**
     * @notice Mint liquidity tokens
     * @param recipient Address to receive LP tokens
     * @param amount Amount of liquidity to mint (not used in this implementation)
     * @return amount0 Amount of token0 required
     * @return amount1 Amount of token1 required
     */
    function mint(address recipient, uint128 amount)
        external
        override
        nonReentrant
        onlyInitialized
        whenNotPaused
        returns (uint256 amount0, uint256 amount1)
    {
        if (recipient == address(0)) {
            revert Errors.ZeroAddress();
        }

        (uint112 _reserve0, uint112 _reserve1,) = getReserves();
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        amount0 = balance0 - _reserve0;
        amount1 = balance1 - _reserve1;

        uint256 _totalSupply = totalSupply();
        uint256 liquidity;

        if (_totalSupply == 0) {
            // First liquidity provision
            liquidity = Math.sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
            _mint(address(0xdEaD), MINIMUM_LIQUIDITY);
        } else {
            // Subsequent liquidity provisions
            liquidity = Math.min((amount0 * _totalSupply) / _reserve0, (amount1 * _totalSupply) / _reserve1);
        }

        if (liquidity == 0) {
            revert Errors.InsufficientLiquidityMinted();
        }

        _mint(recipient, liquidity);
        _update(balance0, balance1, _reserve0, _reserve1);

        emit Mint(msg.sender, recipient, amount0, amount1, liquidity);
    }

    /**
     * @notice Burn liquidity tokens and withdraw underlying assets
     * @param to Address to receive underlying tokens
     * @param liquidity Amount of LP tokens to burn
     * @return amount0 Amount of token0 returned
     * @return amount1 Amount of token1 returned
     */
    function burn(address to, uint256 liquidity)
        external
        override
        nonReentrant
        onlyInitialized
        whenNotPaused
        returns (uint256 amount0, uint256 amount1)
    {
        if (to == address(0)) {
            revert Errors.ZeroAddress();
        }
        if (liquidity == 0) {
            revert Errors.InsufficientLiquidityBurned();
        }

        (uint112 _reserve0, uint112 _reserve1,) = getReserves();
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        uint256 _totalSupply = totalSupply();

        // Calculate proportional amounts
        amount0 = (liquidity * balance0) / _totalSupply;
        amount1 = (liquidity * balance1) / _totalSupply;

        if (amount0 == 0 || amount1 == 0) {
            revert Errors.InsufficientLiquidityBurned();
        }

        // Burn LP tokens
        _burn(address(this), liquidity);

        // Transfer tokens to recipient
        IERC20(token0).safeTransfer(to, amount0);
        IERC20(token1).safeTransfer(to, amount1);

        // Update reserves
        balance0 = IERC20(token0).balanceOf(address(this));
        balance1 = IERC20(token1).balanceOf(address(this));
        _update(balance0, balance1, _reserve0, _reserve1);

        emit Burn(msg.sender, to, amount0, amount1, liquidity);
    }

    /**
     * @notice Swap tokens using constant product formula
     * @param amountIn Amount of input tokens
     * @param tokenIn Address of input token
     * @param to Address to receive output tokens
     * @return amountOut Amount of output tokens
     */
    function swap(uint256 amountIn, address tokenIn, address to)
        external
        override
        nonReentrant
        onlyInitialized
        whenNotPaused
        returns (uint256 amountOut)
    {
        if (amountIn == 0) {
            revert Errors.InvalidAmountIn();
        }
        if (to == address(0)) {
            revert Errors.ZeroAddress();
        }
        if (tokenIn != token0 && tokenIn != token1) {
            revert Errors.InvalidToken();
        }

        (uint112 _reserve0, uint112 _reserve1,) = getReserves();

        bool zeroForOne = tokenIn == token0;
        (uint112 reserveIn, uint112 reserveOut) = zeroForOne ? (_reserve0, _reserve1) : (_reserve1, _reserve0);

        if (reserveIn == 0 || reserveOut == 0) {
            revert Errors.InsufficientLiquidity();
        }

        // Calculate output amount with fee
        uint256 amountInWithFee = amountIn * (1000000 - fee);
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * 1000000) + amountInWithFee;
        amountOut = numerator / denominator;

        if (amountOut == 0) {
            revert Errors.InsufficientOutputAmount();
        }
        if (amountOut >= reserveOut) {
            revert Errors.InsufficientLiquidity();
        }

        // Transfer output tokens
        address tokenOut = zeroForOne ? token1 : token0;
        IERC20(tokenOut).safeTransfer(to, amountOut);

        // Update reserves
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        _update(balance0, balance1, _reserve0, _reserve1);

        // Verify constant product formula
        uint256 balance0Adjusted = balance0 * 1000000 - (zeroForOne ? amountIn * fee : 0);
        uint256 balance1Adjusted = balance1 * 1000000 - (zeroForOne ? 0 : amountIn * fee);

        if (balance0Adjusted * balance1Adjusted < uint256(_reserve0) * _reserve1 * (1000000 ** 2)) {
            revert Errors.KInvariantFailed();
        }

        emit Swap(msg.sender, to, amountIn, amountOut, tokenIn, tokenOut, fee);
    }

    /**
     * @notice Get current reserves and last update timestamp
     * @return _reserve0 Reserve of token0
     * @return _reserve1 Reserve of token1
     * @return _blockTimestampLast Timestamp of last update
     */
    function getReserves() public view returns (uint112 _reserve0, uint112 _reserve1, uint32 _blockTimestampLast) {
        _reserve0 = reserve0;
        _reserve1 = reserve1;
        _blockTimestampLast = blockTimestampLast;
    }

    /**
     * @notice Get token addresses
     * @return token0 Address of first token
     * @return token1 Address of second token
     */
    function tokens() external view override returns (address, address) {
        return (token0, token1);
    }

    /**
     * @notice Adds liquidity to an existing pool (non-initial).
     * @dev Must be called after initial liquidity has been provided. The router (caller) is expected to have transferred tokens to this pool contract before calling this.
     * @param recipient The address to receive the LP tokens.
     * @param amount0Desired The desired amount of token0 that has been sent to the pool.
     * @param amount1Desired The desired amount of token1 that has been sent to the pool.
     * @param data Optional data to pass to a hook (if any).
     * @return amount0Actual The actual amount of token0 used from the desired amounts.
     * @return amount1Actual The actual amount of token1 used from the desired amounts.
     * @return liquidityMinted The amount of LP tokens minted.
     */
    function addLiquidityNonInitial(
        address recipient,
        uint256 amount0Desired,
        uint256 amount1Desired,
        bytes calldata data
    )
        external
        override
        nonReentrant
        onlyInitialized
        whenNotPaused
        returns (uint256 amount0Actual, uint256 amount1Actual, uint256 liquidityMinted)
    {
        if (recipient == address(0)) {
            revert Errors.ZeroAddress();
        }
        if (totalSupply() == 0) {
            revert Errors.NotInitialized(); // Pool must have initial liquidity
        }

        (uint112 _reserve0, uint112 _reserve1,) = getReserves();

        // Check reserves are non-zero to prevent division by zero
        if (_reserve0 == 0 || _reserve1 == 0) {
            revert Errors.InsufficientLiquidity();
        }

        uint256 balance0Before = IERC20(token0).balanceOf(address(this));
        uint256 balance1Before = IERC20(token1).balanceOf(address(this));

        // Calculate actual amounts from tokens already transferred
        amount0Actual = balance0Before - _reserve0;
        amount1Actual = balance1Before - _reserve1;

        // Validate that tokens have been transferred
        if (amount0Actual == 0 || amount1Actual == 0) {
            revert Errors.InvalidAmountIn();
        }

        // Validate amounts match expectations
        if (amount0Actual < amount0Desired || amount1Actual < amount1Desired) {
            revert Errors.InvalidAmountIn();
        }

        uint256 _totalSupply = totalSupply();

        // Calculate liquidity using the same formula as mint
        liquidityMinted =
            Math.min((amount0Actual * _totalSupply) / _reserve0, (amount1Actual * _totalSupply) / _reserve1);

        if (liquidityMinted == 0) {
            revert Errors.InsufficientLiquidityMinted();
        }

        _mint(recipient, liquidityMinted);
        _update(balance0Before, balance1Before, _reserve0, _reserve1);

        emit Mint(msg.sender, recipient, amount0Actual, amount1Actual, liquidityMinted);
    }

    /**
     * @notice Update reserves and cumulative prices
     * @param balance0 Current balance of token0
     * @param balance1 Current balance of token1
     * @param _reserve0 Previous reserve of token0
     * @param _reserve1 Previous reserve of token1
     */
    function _update(uint256 balance0, uint256 balance1, uint112 _reserve0, uint112 _reserve1) private {
        if (balance0 > type(uint112).max || balance1 > type(uint112).max) {
            revert Errors.Overflow();
        }

        uint32 blockTimestamp = uint32(block.timestamp % 2 ** 32);
        uint32 timeElapsed = blockTimestamp - blockTimestampLast;

        if (timeElapsed > 0 && _reserve0 != 0 && _reserve1 != 0) {
            // Update cumulative prices
            price0CumulativeLast += uint256(_reserve1) * timeElapsed / _reserve0;
            price1CumulativeLast += uint256(_reserve0) * timeElapsed / _reserve1;
        }

        reserve0 = uint112(balance0);
        reserve1 = uint112(balance1);
        blockTimestampLast = blockTimestamp;
    }

    /**
     * @notice Set new fee (only pool manager)
     * @param newFee New fee in basis points
     */
    function setFee(uint24 newFee) external onlyPoolManager {
        if (newFee > MAX_FEE) {
            revert Errors.InvalidFee();
        }
        fee = newFee;
    }

    /**
     * @notice Set protocol fee recipient (only pool manager)
     * @param newRecipient New protocol fee recipient
     */
    function setProtocolFeeRecipient(address newRecipient) external onlyPoolManager {
        if (newRecipient == address(0)) {
            revert Errors.ZeroAddress();
        }
        protocolFeeRecipient = newRecipient;
    }

    /**
     * @notice Emergency pause (only pool manager)
     */
    function emergencyPause() external onlyPoolManager {
        _pause();
    }

    /**
     * @notice Emergency unpause (only pool manager)
     */
    function emergencyUnpause() external onlyPoolManager {
        _unpause();
    }

    /**
     * @notice Sync reserves with actual balances
     */
    function sync() external {
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        _update(balance0, balance1, reserve0, reserve1);
    }
}
