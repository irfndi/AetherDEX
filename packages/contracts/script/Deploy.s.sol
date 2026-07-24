// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import "forge-std/Script.sol";
import {AetherFactory} from "../src/factory/AetherFactory.sol";
import {AetherRouter} from "../src/router/AetherRouter.sol";
import {AetherPositionManager} from "../src/position/AetherPositionManager.sol";
import {AetherHook} from "../src/hook/AetherHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";

/// @title AetherDEX Deploy Script
/// @notice Deploys AetherDEX contracts to a network (testnet or mainnet)
/// @dev Run: forge script script/Deploy.s.sol --rpc-url sepolia --broadcast --verify
contract Deploy is Script {
    // Sepolia Uniswap V4 PoolManager address
    address constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    // Initial protocol fee: 0.30% (30 basis points)
    uint24 constant INITIAL_PROTOCOL_FEE_BPS = 30;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address treasury = vm.envAddress("AETHERDEX_TREASURY");

        vm.startBroadcast(deployerPrivateKey);
        address deployer = vm.addr(deployerPrivateKey);

        // 1. Deploy AetherHook
        AetherHook hook = new AetherHook(
            IPoolManager(POOL_MANAGER),
            treasury,
            INITIAL_PROTOCOL_FEE_BPS,
            deployer
        );
        console.log("AetherHook deployed at:", address(hook));

        // 2. Deploy AetherFactory
        AetherFactory factory = new AetherFactory(
            IPoolManager(POOL_MANAGER),
            IHooks(address(hook)),
            deployer
        );
        console.log("AetherFactory deployed at:", address(factory));

        // 3. Deploy AetherRouter
        AetherRouter router = new AetherRouter(
            IPoolManager(POOL_MANAGER),
            factory,
            deployer
        );
        console.log("AetherRouter deployed at:", address(router));

        // 4. Deploy the canonical transferable receipt-position manager.
        //    The router's legacy ledger remains available for compatibility;
        //    new position UIs should use this ERC721-owned surface.
        AetherPositionManager positionManager = new AetherPositionManager(IPoolManager(POOL_MANAGER));
        console.log("AetherPositionManager deployed at:", address(positionManager));

        vm.stopBroadcast();

        // 5. Log deployment summary
        console.log("\n=== AetherDEX Deployment Summary ===");
        console.log("Network:      Sepolia");
        console.log("PoolManager:", POOL_MANAGER);
        console.log("AetherHook:  ", address(hook));
        console.log("AetherFactory:", address(factory));
        console.log("AetherRouter: ", address(router));
        console.log("PositionManager:", address(positionManager));
        console.log("Treasury:    ", treasury);
        console.log("Protocol Fee:", INITIAL_PROTOCOL_FEE_BPS, "bps");
        console.log("=====================================\n");
    }
}
