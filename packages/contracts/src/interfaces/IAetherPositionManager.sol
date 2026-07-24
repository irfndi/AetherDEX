// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

interface IAetherPositionManager {
    error InvalidCallbackCaller(address caller);
    error InvalidCallbackContext();
    error AmountMaximumExceeded();
    error DeadlineExpired();
    error InvalidLiquidity();
    error SlippageExceeded();
    error ZeroRecipient();
    error NativeTransferFailed();
    error UnexpectedNativeValue();

    struct MintPositionParams {
        PoolKey poolKey;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint256 amount0Max;
        uint256 amount1Max;
        address recipient;
        uint256 deadline;
        bytes hookData;
    }

    struct RemoveLiquidityParams {
        uint256 tokenId;
        uint128 liquidity;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
        bytes hookData;
    }

    struct Position {
        PoolKey poolKey;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        bytes32 salt;
    }

    function mintPosition(MintPositionParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint256 amount0, uint256 amount1);

    function removeLiquidity(RemoveLiquidityParams calldata params) external returns (uint256 amount0, uint256 amount1);

    function getPosition(uint256 tokenId) external view returns (Position memory);
    function unlockCallback(bytes calldata data) external returns (bytes memory);
}
