// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

/// @title Interface for Aether Pool
/// @notice Defines the external functions for interacting with an Aether Pool.
interface IAetherPool {
    // --- Events ---

    /// @notice Emitted when liquidity is minted.
    /// @param sender The address initiating the mint.
    /// @param owner The address receiving the liquidity tokens.
    /// @param amount0 The amount of token0 deposited.
    /// @param amount1 The amount of token1 deposited.
    /// @param liquidity The amount of liquidity tokens minted.
    event Mint(address indexed sender, address indexed owner, uint256 amount0, uint256 amount1, uint256 liquidity);

    /// @notice Emitted when liquidity is burned.
    /// @param owner The address initiating the burn.
    /// @param to The address receiving the tokens.
    /// @param amount0 The amount of token0 returned.
    /// @param amount1 The amount of token1 returned.
    /// @param liquidity The amount of liquidity tokens burned.
    event Burn(address indexed owner, address indexed to, uint256 amount0, uint256 amount1, uint256 liquidity);

    /// @notice Emitted when a swap occurs.
    /// @param sender The address initiating the swap.
    /// @param recipient The address receiving the output tokens.
    /// @param amountIn The amount of tokens sent to the pool.
    /// @param amountOut The amount of tokens received from the pool.
    /// @param tokenIn Address of the input token.
    /// @param tokenOut Address of the output token.
    /// @param fee The fee paid for the swap.
    event Swap(
        address indexed sender,
        address indexed recipient,
        uint256 amountIn,
        uint256 amountOut,
        address tokenIn,
        address tokenOut,
        uint24 fee
    );

    // --- State-Changing Functions ---

    /// @notice Mints liquidity based on a specified liquidity amount.
    /// @dev This function is typically called by the Pool Manager or a router.
    /// @param recipient The address to receive the minted LP tokens.
    /// @param amount The amount of liquidity to add (LP tokens to mint).
    /// @return amount0 The required amount of token0 to deposit for the specified LP amount.
    /// @return amount1 The required amount of token1 to deposit for the specified LP amount.
    function mint(address recipient, uint128 amount) external returns (uint256 amount0, uint256 amount1);

    /// @notice Burns liquidity tokens.
    /// @param to The address to receive the underlying tokens.
    /// @param liquidity The amount of liquidity tokens to burn.
    /// @return amount0 The amount of token0 returned.
    /// @return amount1 The amount of token1 returned.
    function burn(address to, uint256 liquidity) external returns (uint256 amount0, uint256 amount1);

    /// @notice Swaps tokens.
    /// @param amountIn The amount of input tokens.
    /// @param tokenIn The address of the input token.
    /// @param to The address to receive the output tokens.
    /// @return amountOut The amount of output tokens received.
    function swap(uint256 amountIn, address tokenIn, address to) external returns (uint256 amountOut);

    // Initialization function (added for Vyper pools)
    function initialize(address token0, address token1, uint24 fee) external;

    /// @notice Adds initial liquidity to the pool after it has been initialized.
    /// @param amount0Desired The desired amount of token0.
    /// @param amount1Desired The desired amount of token1.
    /// @return liquidity The amount of LP tokens minted.
    function addInitialLiquidity(uint256 amount0Desired, uint256 amount1Desired) external returns (uint256 liquidity);

    // --- View Functions ---

    /// @notice Returns the addresses of the two tokens in the pool.
    /// @return token0 The address of the first token.
    /// @return token1 The address of the second token.
    function tokens() external view returns (address token0, address token1);

    /// @notice Returns the current fee for the pool.
    /// @return fee The current pool fee.
    function fee() external view returns (uint24 fee);
}
