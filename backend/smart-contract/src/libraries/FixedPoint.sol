// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.29;

/**
 * @title FixedPoint
 * @author AetherDEX
 * @notice Library for fixed-point square root calculations.
 */
library FixedPoint {
    /**
     * @notice Calculates the integer square root of a uint256.
     * @param x The uint256 value to calculate the square root of.
     * @return y The integer square root of x.
     * @dev Implements Babylonian method for efficient square root calculation.
     */
    function sqrt(uint256 x) internal pure returns (uint256 y) {
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    /**
     * @notice Multiplies two uint256 values.
     * @param a The first uint256 value.
     * @param b The second uint256 value.
     * @return The product of a and b.
     */
    function mul(uint256 a, uint256 b) internal pure returns (uint256) {
        return a * b;
    }
}
