// SPDX-License-Identifier: GPL-3.0
// FeeRegistry.sol
pragma solidity ^0.8.29; // UPDATED PRAGMA VERSION TO 0.8.28

import {Ownable} from "./access/Ownable.sol";
/**
 * @title FeeRegistry
 * @notice Registry for dynamic fees based on swap activity.
 * @dev The FeeRegistry stores the fee configuration for each token pair and calculates the current fee based on the swap volume.
 * The fee is calculated as minFee + (swapVolume * adjustmentRate) and capped at maxFee.
 * The fee is updated whenever a swap occurs and the new fee is calculated based on the updated swap volume.
 */

contract FeeRegistry is Ownable {
    struct FeeConfig {
        uint24 maxFee;
        uint24 minFee;
        uint24 adjustmentRate;
        uint256 lastUpdated;
        uint256 swapVolume;
    }

    mapping(bytes32 => FeeConfig) public feeConfigs;

    constructor() Ownable(msg.sender) {}

    function setFeeConfig(address token0, address token1, uint24 _maxFee, uint24 _minFee, uint24 _adjustmentRate)
        external
        onlyOwner
    {
        bytes32 key = keccak256(abi.encodePacked(token0, token1));
        feeConfigs[key] = FeeConfig({
            maxFee: _maxFee,
            minFee: _minFee,
            adjustmentRate: _adjustmentRate,
            lastUpdated: block.timestamp,
            swapVolume: 0
        });
    }

    function getFee(address token0, address token1) external view returns (uint24) {
        bytes32 key = keccak256(abi.encodePacked(token0, token1));
        FeeConfig storage config = feeConfigs[key];
        uint24 calculatedFee = config.minFee + uint24((config.swapVolume * config.adjustmentRate) / 1e18);
        return calculatedFee > config.maxFee ? config.maxFee : calculatedFee;
    }

    function updateFee(address token0, address token1, int256 swapAmount) external {
        bytes32 key = keccak256(abi.encodePacked(token0, token1));
        feeConfigs[key].swapVolume += uint256(swapAmount > 0 ? swapAmount : -swapAmount);
    }
}
