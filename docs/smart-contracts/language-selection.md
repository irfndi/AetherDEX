# Smart Contract Language Selection

This document outlines guidelines for selecting the appropriate smart contract language within the AetherDEX project, balancing ecosystem support and security auditability.

## Overview

Selecting the right language is critical for:

- **Ecosystem Support**: Access to libraries, tooling, and community knowledge.
- **Auditability**: Ease of manual review and reduced attack surface.
- **Security**: Language features that help prevent common vulnerabilities.

## Solidity

- **Maturity**: Widely adopted in the Ethereum ecosystem.
- **Ecosystem**: Rich libraries (e.g., OpenZeppelin), SDKs (Alchemy, 0x), and toolchains (Hardhat, Remix).
- **Flexibility**: Supports complex DeFi patterns (proxy upgrades, Diamond standard).
- **Recommendation**: Use Solidity as the primary language for most EVM-based components.

## Vyper

- **Simplicity**: Minimalistic syntax focused on security and auditability.
- **Safety-Oriented**: Restrictions (e.g., no inheritance, bounded loops) reduce attack surface.
- **Use Cases**: Ideal for isolated, high-risk modules (token vaults, escrow logic, core AMM pools).
- **Recommendation**: Use Vyper only for security-critical contracts that benefit from its audit-friendly design.

## Guidelines

1. **Default to Solidity** for new contracts unless there is a strong security justification.
2. **Reserve Vyper** for modules handling sensitive funds or requiring the highest level of audit scrutiny.
3. **Maintain Consistency**: Document language choices in the `docs/architecture/language-selection.md` file and code comments.
4. **Tooling Setup**: Ensure both Solidity (Foundry/Hardhat) and Vyper (vyper compiler) are installed and configured.
   For testing Vyper contracts within Foundry's Solidity tests, configure `foundry.toml` for Vyper compilation and use `vm.deployCode("Contract.vy", constructorArgs)` for deployment. Avoid direct FFI calls (`vm.ffi`) within tests for compiling Vyper, as this proved unreliable.
   Be aware that cheatcode interactions might differ; use `vm.startPrank`/`vm.stopPrank` instead of `vm.prank` when simulating calls to deployed Vyper contracts.

## Example: AetherDEX Core Components

Following the guidelines, AetherDEX implements its core components as follows:

- **Security-Critical Core (Vyper):**
  - `src/security/AetherPool.vy`: Handles the core AMM logic, including liquidity management and swaps. Chosen for Vyper's security focus and auditability.
  - `src/security/Escrow.vy`: Manages conditional fund transfers securely.
  - *Rationale*: These contracts directly handle user funds and core protocol mechanics, benefiting from Vyper's safety features and auditability.

- **Interaction & Configuration Layer (Solidity):**
  - `src/primary/AetherRouter.sol`: The primary entry point for users and integrations. It routes calls (add/remove liquidity, swap) to the appropriate `AetherPool.vy` instance. Chosen for Solidity's rich tooling and integration capabilities.
  - `src/primary/AetherRouterCrossChain.sol`: Handles cross-chain routing, integrating CCIP and Hyperlane protocols, fee distribution, and pausable functionality.
  - `src/primary/AetherFactory.sol`: Deploys and manages `AetherPool.vy` instances via CREATE2 for deterministic addresses.
  - `src/primary/FeeRegistry.sol`: Manages pool fee configurations.
  - *Rationale*: These contracts leverage Solidity's ecosystem support for easier integration and feature development while interfacing with the secure Vyper core.

- **Deprecated Modules:**
  - `AetherPool.sol`: An earlier Solidity implementation of the pool logic, now deprecated in favor of the Vyper implementation (`AetherPool.vy`) accessed via `AetherRouter.sol`.

## Summary

- **Primary Language**: Solidity (`src/primary/AetherRouter.sol`, `src/primary/FeeRegistry.sol`, `src/primary/AetherFactory.sol`)
- **Security-Critical Modules**: Vyper (`src/security/AetherPool.vy`, `src/security/Escrow.vy`)

Refer to this document when planning or auditing smart contract development within AetherDEX.
