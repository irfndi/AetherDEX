// SPDX-License-Identifier: GPL-3.0
// TWAPLib.sol
pragma solidity ^0.8.29; // UPDATED PRAGMA VERSION TO 0.8.28
/**
 * @title TWAPLib
 * @author AetherDEX
 * @notice Library for Time-Weighted Average Price (TWAP) calculations.
 * @dev Provides functionality for storing and calculating time-weighted average prices
 *      which are essential for creating reliable price oracles in DeFi applications.
 */
/**
 * @dev SafeCast library - Minimalist implementation of the functionality needed from OpenZeppelin
 */

library SafeCast {
    /**
     * @dev Returns the downcasted uint16 from uint256, reverting on
     * overflow (when the input is greater than largest uint16).
     */
    function toUint16(uint256 value) internal pure returns (uint16) {
        require(value <= type(uint16).max, "SafeCast: value doesn't fit in 16 bits");
        return uint16(value);
    }

    /**
     * @dev Returns the downcasted uint32 from uint256, reverting on
     * overflow (when the input is greater than largest uint32).
     */
    function toUint32(uint256 value) internal pure returns (uint32) {
        require(value <= type(uint32).max, "SafeCast: value doesn't fit in 32 bits");
        return uint32(value);
    }

    /**
     * @dev Returns the downcasted uint128 from uint256, reverting on
     * overflow (when the input is greater than largest uint128).
     */
    function toUint128(uint256 value) internal pure returns (uint128) {
        require(value <= type(uint128).max, "SafeCast: value doesn't fit in 128 bits");
        return uint128(value);
    }
}

library TWAPLib {
    using SafeCast for uint256;

    /**
     * @dev Struct for storing price observations at specific timestamps.
     * @param blockTimestamp The timestamp when the observation was recorded
     * @param cumulativePrice The cumulative price at the time of observation
     */
    struct Observation {
        uint32 blockTimestamp;
        int56 cumulativePrice;
    }

    /**
     * @notice Updates the TWAP observation array with a new price point
     * @dev Uses a circular buffer approach with 65535 slots indexed by timestamp
     * @param self The storage array of observations to update
     * @param price The current price to record
     * @param blockTimestamp The current block timestamp
     */
    function update(Observation[65535] storage self, int256 price, uint32 blockTimestamp) internal {
        uint256 index = uint256(blockTimestamp % 65535);
        self[index] =
            Observation({blockTimestamp: blockTimestamp, cumulativePrice: int56(price) + self[index].cumulativePrice});
    }

    /**
     * @notice Calculates the Time-Weighted Average Price (TWAP) over a 1-hour period
     * @dev Computes the difference between current cumulative price and the price from 1 hour ago,
     *      then divides by the time period (3600 seconds) to get the average price
     * @param self The storage array of observations to analyze
     * @return The calculated TWAP value as a uint32
     */
    function getTWAP(Observation[65535] storage self) internal view returns (uint32) {
        uint32 currentTimestamp = uint32(block.timestamp);
        uint32 oldestIndex = (currentTimestamp - 3600) % 65535; // 1-hour window

        int56 cumulativeDifference = self[currentTimestamp % 65535].cumulativePrice - self[oldestIndex].cumulativePrice;

        return uint32(uint56(cumulativeDifference) / 3600);
    }
}
