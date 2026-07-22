// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

/// @title MockPoolManager
/// @notice Minimal stand-in for the Uniswap V4 PoolManager used by AetherHook unit/fuzz tests.
/// @dev Implements only `extsload(bytes32)` returning a packed slot0 word, so the hook's
///      `StateLibrary.getSlot0(poolManager, poolId)` read path works without a real PoolManager.
contract MockPoolManager {
    bytes32 internal _slot0Word;

    /// @notice Set the packed slot0 word: sqrtPriceX96 | tick | protocolFee | lpFee
    /// @dev Bit layout mirrors PoolManager's `Pool.State.slot0` storage packing:
    ///      [160 bits sqrtPriceX96][24 bits tick][24 bits protocolFee][24 bits lpFee].
    function setSlot0(uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee) external {
        _slot0Word = bytes32(
            uint256(sqrtPriceX96) | (uint256(uint24(tick)) << 160) | (uint256(protocolFee) << 184)
                | (uint256(lpFee) << 208)
        );
    }

    /// @notice Convenience overload: zero protocolFee/lpFee
    function setSlot0(uint160 sqrtPriceX96, int24 tick) external {
        _slot0Word = bytes32(uint256(sqrtPriceX96) | (uint256(uint24(tick)) << 160));
    }

    function extsload(bytes32) external view returns (bytes32) {
        return _slot0Word;
    }
}
