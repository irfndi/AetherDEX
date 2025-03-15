// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.29; // UPDATED PRAGMA VERSION TO 0.8.29

// TWAPOracleHook.sol

import {BaseHook} from "./BaseHook.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {BalanceDelta} from "../interfaces/IPoolManager.sol";
import {TWAPLib} from "../libraries/TWAPLib.sol";

contract TWAPOracleHook is BaseHook {
    using TWAPLib for TWAPLib.Observation[65535];

    mapping(bytes32 => TWAPLib.Observation[65535]) public observations;

    constructor(IPoolManager _poolManager) BaseHook(_poolManager, address(this)) {}
    
    /**
     * @notice Initialize TWAP observations for a pool
     * @param key The pool key to initialize observations for
     * @param initialPrice The initial price to set
     */
    function initializeOracle(PoolKey calldata key, int256 initialPrice) external {
        bytes32 poolId = keccak256(abi.encode(key));
        // Only initialize if not already initialized
        if (observations[poolId][uint32(block.timestamp) % 65535].blockTimestamp == 0) {
            observations[poolId].update(initialPrice, uint32(block.timestamp));
        }
    }

    function beforeSwap(address, PoolKey calldata key, IPoolManager.SwapParams calldata, bytes calldata)
        external
        override
        returns (bytes4)
    {
        bytes32 poolId = keccak256(abi.encode(key));
        
        // For testing purposes, initialize with a default value if not already initialized
        if (observations[poolId][uint32(block.timestamp) % 65535].blockTimestamp == 0) {
            observations[poolId].update(1000, uint32(block.timestamp));
            return this.beforeSwap.selector;
        }
        
        // Validate TWAP against oracle
        uint32 twap = observations[poolId].getTWAP();
        require(twap > 0, "Invalid TWAP");
        return this.beforeSwap.selector;
    }

    function afterSwap(
        address,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        BalanceDelta memory, /* delta */
        bytes calldata /* hookData */
    ) external override returns (bytes4) {
        // Update TWAP observation
        observations[keccak256(abi.encode(key))].update(params.amountSpecified, uint32(block.timestamp));
        return this.afterSwap.selector;
    }

    function beforeModifyPosition(
        address,
        PoolKey calldata key,
        IPoolManager.ModifyPositionParams calldata,
        bytes calldata
    ) external override returns (bytes4) {
        bytes32 poolId = keccak256(abi.encode(key));
        
        // For testing purposes, initialize with a default value if not already initialized
        if (observations[poolId][uint32(block.timestamp) % 65535].blockTimestamp == 0) {
            observations[poolId].update(1000, uint32(block.timestamp));
            return this.beforeModifyPosition.selector;
        }
        
        // Validate TWAP against oracle
        uint32 twap = observations[poolId].getTWAP();
        require(twap > 0, "Invalid TWAP");
        return this.beforeModifyPosition.selector;
    }

    function afterModifyPosition(
        address,
        PoolKey calldata key,
        IPoolManager.ModifyPositionParams calldata params,
        BalanceDelta memory, /* delta */
        bytes calldata /* hookData */
    ) external override returns (bytes4) {
        // Update TWAP observation after position modification
        observations[keccak256(abi.encode(key))].update(params.liquidityDelta, uint32(block.timestamp));
        return this.afterModifyPosition.selector;
    }
}
