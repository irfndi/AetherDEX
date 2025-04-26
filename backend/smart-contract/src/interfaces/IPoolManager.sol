// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.29;

import {PoolKey} from "../types/PoolKey.sol";
import {BalanceDelta} from "../types/BalanceDelta.sol";

interface IPoolManager {
    struct Pool {
        address token0;
        address token1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    struct ModifyPositionParams {
        int24 tickLower;
        int24 tickUpper;
        int256 liquidityDelta;
    }

    struct SwapParams {
        bool zeroForOne;
        int256 amountSpecified;
        uint160 sqrtPriceLimitX96;
    }

    struct Permissions {
        bool beforeInitialize;
        bool afterInitialize;
        bool beforeModifyPosition;
        bool afterModifyPosition;
        bool beforeSwap;
        bool afterSwap;
        bool beforeDonate;
        bool afterDonate;
    }

    struct DonateParams {
        address token0;
        address token1;
        uint256 amount0;
        uint256 amount1;
    }

    function validateHookAddress(bytes32 hookData) external view returns (bool);

    function modifyPosition(PoolKey calldata key, ModifyPositionParams calldata params, bytes calldata hookData)
        external
        returns (BalanceDelta memory);

    function swap(PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        external
        returns (BalanceDelta memory);

    function take(PoolKey calldata key, address recipient, uint256 amount0, uint256 amount1, bytes calldata hookData)
        external;

    function settle(address recipient)
        external
        returns (BalanceDelta memory token0Delta, BalanceDelta memory token1Delta);

    function mint(address recipient, PoolKey calldata key, uint256 amount0, uint256 amount1, bytes calldata hookData)
        external;

    function burn(address recipient, PoolKey calldata key, uint256 amount0, uint256 amount1, bytes calldata hookData)
        external;

    function getPool(PoolKey calldata key) external view returns (Pool memory);

    function initialize(PoolKey calldata key, uint160 sqrtPriceX96, bytes calldata hookData) external;

    function donate(PoolKey calldata key, uint256 amount0, uint256 amount1, bytes calldata data) external;
}
