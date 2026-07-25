// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

/// @title IAetherHook
/// @notice Minimal interface for AetherHook TWAP oracle reads (used by AetherTPSL)
interface IAetherHook {
    /// @notice Time-weighted average price over the last `secondsAgo` seconds
    function getCurrentTwap(bytes32 poolId, uint32 secondsAgo) external view returns (uint256 priceX18);

    /// @notice Time-weighted average price in the reverse direction
    function getCurrentTwapInverted(bytes32 poolId, uint32 secondsAgo) external view returns (uint256 priceX18);

    /// @notice Get the latest observation for a pool
    function getLatestObservation(bytes32 poolId)
        external
        view
        returns (uint32 timestamp, int56 tickCumulative, int24 tick);
}
