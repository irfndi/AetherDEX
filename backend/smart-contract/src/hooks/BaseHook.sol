// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.29; // UPDATED PRAGMA VERSION TO 0.8.28

// BaseHook.sol
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {Hooks} from "../libraries/Hooks.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {BalanceDelta} from "../interfaces/IPoolManager.sol";
/**
 * @title BaseHook
 * @dev Abstract contract that implements the Hooks interface and provides a
 *      constructor that takes an IPoolManager and a hook address as arguments.
 *      The hook address is validated to ensure that it contains the required
 *      function selectors for the hooks. The modifier onlyValidHookAddress
 *      is used to validate the hook address before executing the hook.
 * @dev The contract is abstract and must be inherited by other contracts
 *      to be used.
 */

abstract contract BaseHook is Hooks {
    IPoolManager public immutable poolManager;

    constructor(IPoolManager _poolManager, address _hookAddress) {
        poolManager = _poolManager;
        _validateHookAddress(_hookAddress);
    }

    modifier onlyValidHookAddress(address _hookAddress) {
        _validateHookAddress(_hookAddress);
        _;
    }

    function _validateHookAddress(address _hookAddress) internal pure {
        Hooks.validateHookAddress(
            _hookAddress,
            Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_MODIFY_POSITION_FLAG
                | Hooks.AFTER_MODIFY_POSITION_FLAG
        );
    }
}
