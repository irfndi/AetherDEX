// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.29; // UPDATED PRAGMA VERSION TO 0.8.28

// DynamicFeeHook.sol
import {BaseHook} from "./BaseHook.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {BalanceDelta} from "../interfaces/IPoolManager.sol";
import {IFeeRegistry} from "../interfaces/IFeeRegistry.sol";

contract DynamicFeeHook is BaseHook {
    address public immutable feeRegistry;

    constructor(IPoolManager _poolManager, address _feeRegistry) BaseHook(_poolManager, address(this)) {
        feeRegistry = _feeRegistry;
    }

    function beforeSwap(address, PoolKey calldata key, IPoolManager.SwapParams calldata, /* params */ bytes calldata)
        external
        view
        override
        returns (bytes4)
    {
        // Apply dynamic fee logic from registry
        uint24 fee = IFeeRegistry(feeRegistry).getFee(key.currency0, key.currency1);
        require(key.fee == fee, "Invalid fee tier");
        return this.beforeSwap.selector;
    }

    function afterSwap(
        address,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        BalanceDelta memory, /* delta */
        bytes calldata /* hookData */
    ) external override returns (bytes4) {
        // Update fee based on swap activity
        IFeeRegistry(feeRegistry).updateFee(
            key.currency0,
            key.currency1,
            uint256(params.amountSpecified > 0 ? params.amountSpecified : -params.amountSpecified)
        );
        return this.afterSwap.selector;
    }
}
