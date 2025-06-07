// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.29;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol"; // Changed from BaseRouter
import {IAetherPool} from "../interfaces/IAetherPool.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Errors} from "../libraries/Errors.sol";
// Note: IERC20Permit might not be needed if only add/remove liquidity functions are here.

contract LiquidityRouter is ReentrancyGuard { // Changed from BaseRouter
    using SafeERC20 for IERC20;

    struct AddLiquidityParams {
        address tokenA;
        address tokenB;
        address pool;
        uint256 amountADesired;
        uint256 amountBDesired;
        uint256 amountAMin;
        uint256 amountBMin;
        address to;
        uint256 deadline;
    }

    event LiquidityAdded(
        address indexed sender,
        address indexed tokenA,
        address indexed tokenB,
        address pool,
        uint256 amountA,
        uint256 amountB,
        uint256 liquidity
    );

    // constructor() { // BaseRouter does not have a constructor, so LiquidityRouter also doesn't need one explicitly.
    // }

    function _prepareLiquidityAddition(AddLiquidityParams calldata params)
        private
        view
        returns (
            address actualPoolToken0, // Renamed for clarity from poolToken0 in outer scope
            address actualPoolToken1, // Renamed for clarity from poolToken1 in outer scope
            uint256 actualAmount0Desired,
            uint256 actualAmount1Desired,
            uint256 actualAmount0Min,
            uint256 actualAmount1Min
        )
    {
        (actualPoolToken0, actualPoolToken1) = IAetherPool(params.pool).tokens();

        if (params.tokenA == actualPoolToken0 && params.tokenB == actualPoolToken1) {
            actualAmount0Desired = params.amountADesired;
            actualAmount1Desired = params.amountBDesired;
            actualAmount0Min = params.amountAMin;
            actualAmount1Min = params.amountBMin;
        } else if (params.tokenA == actualPoolToken1 && params.tokenB == actualPoolToken0) {
            actualAmount0Desired = params.amountBDesired;
            actualAmount1Desired = params.amountADesired;
            actualAmount0Min = params.amountBMin;
            actualAmount1Min = params.amountAMin;
        } else {
            revert Errors.InvalidPath();
        }
        // No direct return of actualPoolToken0, actualPoolToken1 needed if addLiquidity uses params.tokenA/B for final assignment
    }

    function _executeAddLiquidityAndCheck(
        AddLiquidityParams calldata params, // To access params.pool, params.to
        address token0, // This is actualPoolToken0 from _prepareLiquidityAddition
        address token1, // This is actualPoolToken1 from _prepareLiquidityAddition
        uint256 actualAmount0Desired,
        uint256 actualAmount1Desired,
        uint256 actualAmount0Min,
        uint256 actualAmount1Min
    ) private returns (uint256 returnedAmount0, uint256 returnedAmount1, uint256 mintedLiquidity) {
        IERC20(token0).safeTransferFrom(msg.sender, params.pool, actualAmount0Desired);
        IERC20(token1).safeTransferFrom(msg.sender, params.pool, actualAmount1Desired);

        (returnedAmount0, returnedAmount1, mintedLiquidity) =
            IAetherPool(params.pool).addLiquidityNonInitial(params.to, actualAmount0Desired, actualAmount1Desired, "");

        if (returnedAmount0 < actualAmount0Min) {
            revert Errors.InsufficientAAmount();
        }
        if (returnedAmount1 < actualAmount1Min) {
            revert Errors.InsufficientBAmount();
        }
    }

    function addLiquidity(
        AddLiquidityParams calldata params
    ) external nonReentrant checkDeadline(params.deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        require(params.pool != address(0), Errors.ZeroAddress());
        require(params.tokenA != address(0) && params.tokenB != address(0), Errors.ZeroAddress());
        require(params.tokenA != params.tokenB, Errors.IdenticalAddresses());
        require(params.to != address(0), Errors.ZeroAddress());

        (
            address poolToken0FromPrep, // actualPoolToken0 from helper
            address poolToken1FromPrep, // actualPoolToken1 from helper (not strictly needed if using params.tokenA for final sort)
            uint256 inputAmount0Desired,
            uint256 inputAmount1Desired,
            uint256 inputAmount0Min,
            uint256 inputAmount1Min
        ) = _prepareLiquidityAddition(params);

        (uint256 returnedAmount0FromExec, uint256 returnedAmount1FromExec, uint256 mintedLiquidityFromExec) =
            _executeAddLiquidityAndCheck(
                params,
                poolToken0FromPrep, // pass actual pool token0
                poolToken1FromPrep, // pass actual pool token1
                inputAmount0Desired,
                inputAmount1Desired,
                inputAmount0Min,
                inputAmount1Min
            );

        // Determine amountA and amountB based on the order of tokens in params, matching the actual amounts received from the pool
        // poolToken0FromPrep is the true token0 of the pool.
        if (params.tokenA == poolToken0FromPrep) {
            amountA = returnedAmount0FromExec;
            amountB = returnedAmount1FromExec;
        } else {
            amountA = returnedAmount1FromExec;
            amountB = returnedAmount0FromExec;
        }
        liquidity = mintedLiquidityFromExec;

        emit LiquidityAdded(msg.sender, params.tokenA, params.tokenB, params.pool, amountA, amountB, liquidity);
    }

    function _executeLiquidityRemoval(
        address poolAddress, // Renamed from 'pool' to avoid conflict with contract member if any
        uint256 liquidityToRemove, // Renamed from 'liquidity_param'
        address recipient // Renamed from 'to'
    ) private returns (uint256 actualAmount0, uint256 actualAmount1) {
        // LP tokens are assumed to be the pool contract itself (IAetherPool is an IERC20)
        IERC20(poolAddress).safeTransferFrom(msg.sender, poolAddress, liquidityToRemove);
        (actualAmount0, actualAmount1) = IAetherPool(poolAddress).burn(recipient, liquidityToRemove);
    }

    function removeLiquidity(
        address pool,
        uint256 liquidity_param,
        uint256 amountAMin, // Assumed to be min for pool's token0 by current logic
        uint256 amountBMin, // Assumed to be min for pool's token1 by current logic
        address to,
        uint256 deadline
    ) external nonReentrant checkDeadline(deadline) returns (uint256 amountA, uint256 amountB) {
        require(pool != address(0), Errors.ZeroAddress()); // Added basic validation
        require(to != address(0), Errors.ZeroAddress());   // Added basic validation

        (amountA, amountB) = _executeLiquidityRemoval(pool, liquidity_param, to);

        // The existing slippage logic assumes amountA from burn is for 'amountAMin'
        // and amountB from burn is for 'amountBMin'.
        // This implies amountAMin/amountBMin are for the pool's canonical token0 and token1.
        if (amountA < amountAMin) {
            revert Errors.InsufficientAAmount();
        }
        if (amountB < amountBMin) {
            revert Errors.InsufficientBAmount();
        }
        // Note: The returned amountA, amountB are directly from the pool's burn (token0, token1 amounts).
        // If the user needs them in the order of their input tokenA/tokenB (if different from pool's order),
        // this function signature would need to accept user's tokenA/tokenB to return them in that order.
        // For now, it returns amounts of pool.token0 and pool.token1.
    }

    // Copied from AetherRouter.sol, as it's used by the migrated functions.
    // BaseRouter.checkDeadline is virtual, so this override is appropriate.
    modifier checkDeadline(uint256 deadline) { // Removed override
        if (deadline < block.timestamp) {
            revert Errors.DeadlineExpired();
        }
        _;
    }

    // _transferToPool is NOT migrated as it was only used by removeLiquidity's problematic line,
    // and the correct way to handle LP tokens for removeLiquidity is direct transfer/burn of LP tokens.
    // If other internal helpers were ONLY for add/remove liquidity, they'd move too.
    // _swap is clearly for swaps, so it stays in a swap router.
}
