// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.29;

import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IAetherFactory} from "./IAetherFactory.sol"; // Assuming it's in the same directory

interface IAetherVault is IERC4626 {
    event YieldRateUpdated(uint256 oldRate, uint256 newRate);
    event CrossChainYieldSynced(uint16 srcChain, uint256 yieldAmount);
    event YieldGenerated(uint256 amount, uint256 timestamp);
    event FeesClaimed(uint256 amount);

    function factory() external view returns (IAetherFactory);

    function depositToken() external view returns (address);

    function strategy() external view returns (address);

    function yieldRate() external view returns (uint256);

    function lastYieldTimestamp() external view returns (uint256);

    function totalYieldGenerated() external view returns (uint256);

    function updateYieldRate(uint256 newRate) external;

    function syncCrossChainYield(uint16 srcChain, uint256 yieldAmount) external;

    function claimFees() external;
}
