// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.29;

// Import the contracts. The structs defined within them will be accessible via ContractName.StructName
import {LiquidityRouter} from "./LiquidityRouter.sol";
import {SimpleSwapRouter} from "./SimpleSwapRouter.sol";
import {PermitSwapRouter} from "./PermitSwapRouter.sol";

// To use these in other files, import this RouterImports.sol file.
// Then you can directly use the imported contracts and their structs:
// - LiquidityRouter (contract)
// - LiquidityRouter.AddLiquidityParams (struct)
// - SimpleSwapRouter (contract)
// - PermitSwapRouter (contract)
// - PermitSwapRouter.SwapParamsWithPermit (struct)

// Example usage in another file:
// import {LiquidityRouter, SimpleSwapRouter} from "@primary/RouterImports.sol";
// ...
// LiquidityRouter.AddLiquidityParams memory params = LiquidityRouter.AddLiquidityParams(...);
// SimpleSwapRouter mySwapRouter = new SimpleSwapRouter();

// The type alias "type SwapRouter is SimpleSwapRouter;" was removed as it's not valid for contract types.
// Consumers should use SimpleSwapRouter directly if that functionality is needed.

// The structs ExactInputSingleParams, ExactOutputSingleParams, ExactInputParams, ExactOutputParams
// are currently not defined here as their source contracts
// have not been identified or recreated yet.
// If Aether.t.sol or other test files require these, they will need to be defined,
// or the tests adapted.
