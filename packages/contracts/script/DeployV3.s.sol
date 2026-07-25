// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import "forge-std/Script.sol";
import {AetherV3ZapExecutor, IV3PositionManager, IV3SwapRouter} from "../src/router/AetherV3ZapExecutor.sol";

contract DeployV3 is Script {
    function run() external returns (AetherV3ZapExecutor executor) {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address swapRouter = vm.envAddress("AETHERDEX_V3_SWAP_ROUTER");
        address positionManager = vm.envAddress("AETHERDEX_V3_POSITION_MANAGER");

        vm.startBroadcast(deployerPrivateKey);
        executor = new AetherV3ZapExecutor(IV3SwapRouter(swapRouter), IV3PositionManager(positionManager));
        vm.stopBroadcast();

        console.log("AetherV3ZapExecutor deployed at:", address(executor));
        console.log("V3 SwapRouter:", swapRouter);
        console.log("V3 PositionManager:", positionManager);
    }
}
