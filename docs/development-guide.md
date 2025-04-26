# Workflow for Solidity Smart Contract Development with Foundry & slither

> 
> **Last Reviewed:** 2025-04-26

## Quick Summary
- **Iterative development:** Write/modify contracts (Solidity/Vyper) and tests, run `./test-all` (checks Vyper syntax, runs `forge test --via-ir --root ./backend/smart-contract/`), fix issues, repeat.
- **Architecture:** Primary Solidity `AetherRouter.sol` handles local swaps and liquidity via Vyper pools; `AetherRouterCrossChain.sol` handles cross-chain routing (CCIP/Hyperlane); `FeeRegistry.sol` manages fee configs; `AetherPool.sol` is deprecated.
- **Static analysis:** Run `./slither-all` (alias for `slither . --root ./backend/smart-contract/`), log and fix findings, document in `security-analysis-log.md`. Note: Slither primarily targets Solidity.
- **Coverage:** Use `./coverage-all` (alias for `forge coverage --via-ir --root ./backend/smart-contract/`), focus on >95% and 100% for critical logic, document in `test-coverage-report.md`.
- **All scripts:** Use `./test-all`, `./coverage-all`, and `./slither-all` for consistent local dev and CI.
- **Refactor & optimize:** Gas, security, clarity, modern Solidity. Add NatSpec, custom errors, events.
- **Final validation:** Clean, build, test, coverage, docs up-to-date, all issues resolved.
- **Docs:** Keep `./docs` aligned with code and process, update TODOs.

---

## Goal:
To develop a robust, secure, optimized, and thoroughly tested suite of Solidity smart contracts using the Foundry framework. The process emphasizes ensuring correctness in both the smart contract implementation and the accompanying tests.

## Assumptions:

*   Foundry is correctly installed and configured on your development machine.
*   Your smart contract project is located in the directory: `./backend/smart-contract/`.
*   Project documentation resides in the `./docs` directory and must be consistently updated to reflect the current state of the codebase.

## Core Project Architecture
AetherDEX employs a hybrid language approach for enhanced security and ecosystem compatibility:

*   **Security-Critical Core (Vyper):**
    *   `AetherPool.vy`: Handles the core AMM logic, including liquidity management and swaps. Chosen for Vyper's security focus and auditability.
    *   `Escrow.vy`: Manages conditional fund transfers securely.
*   **Interaction & Configuration Layer (Solidity):**
    *   `AetherRouter.sol`: The primary entry point for users and integrations. It routes calls (add/remove liquidity, swap) to the appropriate `AetherPool.vy` instance. Chosen for Solidity's rich tooling and integration capabilities.
    *   `AetherRouterCrossChain.sol`: Handles cross-chain routing, integrating CCIP and Hyperlane protocols, fee distribution, and pausable functionality.
    *   `AetherFactory.sol`: Deploys and manages `AetherPool.vy` instances via CREATE2 for deterministic addresses.
    *   `FeeRegistry.sol`: Manages pool fee configurations.
*   **Interfaces:**
    *   Located in `src/interfaces/`, providing clear definitions for interaction between Solidity and Vyper contracts (e.g., `IAetherPoolVyper.sol`).
*   **Deprecated Contracts:**
    *   `AetherPool.sol`: The original Solidity pool implementation, now superseded by `AetherPool.vy` and `AetherRouter.sol`.

Development and testing must account for this interaction between Solidity and Vyper components.

## Core Development Cycle (Iterative Process):
Understand that developing smart contracts is an iterative process. You will likely cycle through the following steps multiple times as you build, test, and refine your contracts. It is crucial to use version control, such as Git, to manage changes, track progress, and facilitate collaboration.

### Step 1: Write or Modify Code and Initial Tests

*   **Implement Contract Features:** Write new Solidity (`.sol`) or Vyper (`.vy`) code or modify existing code to add desired functionality or fix identified issues. Ensure your code adheres to the requirements and specifications detailed in the `./docs` directory.
*   **Develop Comprehensive Tests:** For every feature or change, create corresponding tests in `.t.sol` files (for Solidity) or using appropriate Vyper testing methods (see Step 4). These tests should cover:
    *   Expected behavior and core use cases.
    *   Edge cases, including boundary conditions and less common scenarios.
    *   Potential failure scenarios, such as invalid inputs or unauthorized access attempts.
    *   Known security vulnerabilities like reentrancy, arithmetic overflows/underflows, etc.
*   **Apply Test-Driven Development (TDD):** Whenever practical, adopt TDD by writing tests before writing the corresponding contract code. This helps ensure test coverage from the outset and guides implementation towards correctness.
*   **Use TODO and FIXME Markers:**
    *   Mark incomplete sections or features needing future work with a `TODO` comment (e.g., `// TODO: Implement the full withdrawal pattern`).
    *   Flag known bugs or areas needing correction with a `FIXME:` comment (e.g., `// FIXME:: Potential reentrancy vulnerability in the transfer function`).

### Step 2: Test, Debug, and Fix (The Central Loop)

*   **Run Tests:** Execute your test suite using the provided script: `./test-all` (which runs `forge test --via-ir --root ./backend/smart-contract/`).
*   **Analyze Test Failures:** If any tests fail, investigate systematically:
    *   Check if the test logic itself is flawed (`.t.sol` file).
    *   Verify if the contract code (`.sol` or `.vy` file) deviates from the requirements or test expectations. Pay close attention to interaction points between Solidity (`AetherRouter.sol`) and Vyper (`AetherPool.vy`).
    *   Utilize Foundry's debugging tools (`forge test -vvvv`, `vm.breakpoint`, `console.log`) to step through execution and inspect state.
*   **Address Compiler Warnings:** Carefully review the compiler output for warnings (like unused variables, missing SPDX identifiers, etc.) and resolve them. If a warning is intentional or acceptable for specific reasons, document the justification in the `./docs` directory (e.g., add a note to `./docs` explaining why a variable is currently unused).
*   **Iterate:** Continue modifying code and tests, re-running tests, and debugging until all tests pass successfully. Ensure the code not only passes tests but also logically meets the requirements outlined in `./docs`.

### Step 3: Perform Static Analysis Early and Often

*   **Run Static Analysis Tools:** Regularly execute static analysis tools. Use the provided script: `./slither-all` (which runs `slither . --root ./backend/smart-contract/`). Optionally, integrate other tools like Mythril or Securify.
*   **Act on Findings:** Review the analysis reports for issues like reentrancy risks, access control problems, or other security concerns. Fix the identified problems in your `.sol` or `.vy` files.
*   **Run Vyper Static Analysis:** Run `vyper --check <path/to/contract.vy>` for basic syntax and type checking of Vyper contracts. (Note: `./slither-all` does not currently analyze Vyper).
*   **Re-Verify:** After applying fixes based on static analysis, always re-run your test suite (`./test-all`) to ensure no regressions were introduced.
*   **Document Issues:** Log significant findings from both Slither and manual review (especially for Vyper), and their resolutions or justifications for not fixing them, in the `./docs/security-analysis-log.md` file.

### Step 4: Assess and Improve Test Coverage

*   **Generate Coverage Report:** Measure test coverage using the script: `./coverage-all` (which runs `forge coverage --via-ir --root ./backend/smart-contract/`).
*   **Analyze Coverage:** Review the generated report (the HTML version is often easiest to navigate) to identify functions, code branches, or lines that are not currently tested.
*   **Increase Coverage:** Write additional tests in your `.t.sol` files specifically targeting:
    *   Untested critical logic, especially related to fund transfers, state changes, or access control.
    *   Edge cases that might have been missed previously.
*   **Utilize Advanced Testing:** Explore techniques like:
    *   **Fuzz Testing:** Supply random inputs to functions to uncover unexpected behavior.
    *   **Property-Based Testing:** Define and verify invariants (rules that should always hold true, e.g., "total supply never decreases").
*   **Test Vyper Contracts:** Test Vyper contracts within Foundry Solidity tests (`.t.sol`) by:
    *   Configuring `foundry.toml` for the correct Vyper version.
    *   Deploying using `vm.deployCode("src/AetherPool.vy", abi.encode(constructorArgs))` (e.g., `address pool = vm.deployCode("src/AetherPool.vy", abi.encode(address(factory)));`).
    *   Importing the Vyper interface (e.g., `IAetherPoolVyper`) and interacting via its methods.
    *   Simulating sender addresses using `vm.startPrank(address)` / `vm.stopPrank()` instead of `vm.prank(address)`. Refer to `test/EscrowVyper.t.sol` for an example.
*   **Testing Solidity-Vyper Interactions:**
    *   Focus tests on the `AetherRouter.sol` contract, as it's the primary entry point.
    *   Use `vm.startPrank(sender)` before calling router functions and `vm.stopPrank()` after to simulate calls *from* `sender` to the router.
    *   **Important Note for `addLiquidity`:** When testing or using `AetherRouter.sol::addLiquidity`, the `sender` must approve the target *Vyper pool* contract (`AetherPool.vy` instance) to spend their `tokenA` and `tokenB` *before* calling the router function. The pool's `mint` function pulls these tokens directly via `transferFrom`. The router itself does not require approval for these tokens during `addLiquidity`.
    *   **Slippage Limitation for `addLiquidity`:** Be aware that the current `AetherPool.vy::mint` function only returns the amount of LP tokens minted. It does not return the actual amounts of `tokenA` and `tokenB` consumed. Therefore, `AetherRouter.sol` cannot perform accurate post-mint slippage checks for `addLiquidity` based on the actual consumed amounts. This check relies on the pool's internal logic.
    *   Verify events emitted by both the router (Solidity) and the pool (Vyper).
*   **Confirm Tests:** Re-run `./test-all` to ensure all existing and new tests pass.
*   **Iterate and Document:** Aim for a high coverage percentage (e.g., >95%) and pay special attention to security-critical parts. Document coverage goals and status in `./docs/test-coverage-report.md`. Keep this report updated.

### Step 5: Optimization, Documentation, and Cleanup
*   **Optimize Implementation:** Analyze contract code for gas efficiency. Use `forge test --gas-report` to identify costly operations. Refactor loops, prefer mappings over arrays, and consolidate storage reads.
*   **Enhance Documentation:** Add or update NatSpec (`@notice`, `@param`, `@return`, `@dev`) comments in your Solidity and Vyper files. Ensure `docs/security-analysis-log.md` and `docs/test-coverage-report.md` reflect current test outcomes and analysis findings.
*   **Resolve TODOs/FIXMEs:** Search code and documentation for `TODO` or `FIXME:` markers. Address each item or document the rationale for deferring.
*   **Code Formatting:** Run `forge fmt` and ensure code style consistency. Commit or stash formatting changes as needed.
*   **Review Dependencies:** Confirm external libraries and Vyper version in `foundry.toml` are up-to-date and compatible.
*   **Prepare for Release:** Tag the current commit in Git and update the release notes in `CHANGELOG.md` to reflect features and fixes in this cycle.

### Step 6: Final Validation Sequence

Before considering a development cycle complete or preparing for deployment, run the following sequence of commands:

```bash
forge clean --root ./backend/smart-contract/
forge build --via-ir --root ./backend/smart-contract/
./test-all
./coverage-all
./slither-all # Run static analysis as part of final check
```

Confirm the following:

*   The build completes cleanly without errors or unexpected warnings.
*   All tests pass (100% pass rate).
*   Test coverage meets the project's target (e.g., >95%) and covers all critical paths.
*   All findings from manual code reviews and static analysis (Step 3) have been addressed or explicitly documented in `./docs/security-analysis-log.md`.
*   The code adheres to best practices regarding security, gas optimization, clarity, and uses modern Solidity/Vyper features appropriately.
*   The final implementation and tests align with the requirements documented in `./docs`.

### Step 7: Module Split & Migration

*   **Physical organization:**
    *   Move security-critical Vyper contracts to `src/security/`:
        *   `AetherPool.vy`
        *   `Escrow.vy`
    *   Move primary Solidity modules to `src/primary/`:
        *   `BaseRouter.sol`, `AetherRouter.sol`, `AetherRouterCrossChain.sol`, `AetherFactory.sol`, `FeeRegistry.sol`

*   **Import path updates:**
    *   Update Solidity imports to reference `src/primary/` location.
    *   Update tests to import contracts from `src/primary/`.
    *   Update `vm.getCode` invocations for Vyper pools to use `src/security/AetherPool.vy`.

*   **CI & scripts:**
    *   Update `test-all` script to run tests in both `src/primary/` and `src/security/` via separate `forge test --via-ir` invocations.
    *   Ensure coverage and slither commands include both directories.

*   **Verification:**
    *   Re-run the full suite: `./test-all`, `./coverage-all`, `./slither-all` to confirm all changes are correct.

---

## Automation: CI/CD & Pre-commit Hooks

- **CI/CD:**
  - GitHub Actions workflow at `.github/workflows/ci.yml` will automatically run `./test-all`, `./coverage-all`, and `./slither-all` on every push and PR.
  - Static analysis failures will be reported but not block merges (edit as needed).
- **Pre-commit hook:**
  - A sample pre-commit hook is provided at `.githooks/pre-commit`.
  - To enable locally, run:
    ```sh
    ln -s ../../.githooks/pre-commit .git/hooks/pre-commit
    chmod +x .githooks/pre-commit
    ```
  - This will warn you if there are unresolved `TODO`s in `./docs` before every commit.

## Additional Recommendations:

*   **Version Control:** Use Git consistently for tracking changes, managing branches, and collaborating. Commit messages should be clear, and `TODO` / `FIXME:` markers should be tracked or resolved.
*   **Continuous Integration/Continuous Deployment (CI/CD):** Implement automated pipelines (e.g., using GitHub Actions, GitLab CI) to run tests, static analysis, and coverage checks automatically on code changes.
*   **Professional Auditing:** For high-value or critical contracts, plan for and obtain a professional security audit from reputable third-party auditors before mainnet deployment.
*   **Dependency Management:** Manage external libraries (like OpenZeppelin contracts) using Foundry's built-in dependency management features. Ensure these dependencies are understood and tested within your project context.
*   **Environment Configuration:** Double-check that settings in `foundry.toml` (like the Solidity compiler version and EVM target) are correctly configured for your project's requirements and deployment target.

## Note on Documentation (`./docs`) Alignment:

Maintaining accurate and up-to-date documentation in the `./docs` directory is crucial. It should always reflect the current state of the contract logic, testing strategy, security posture, and architectural decisions. Key documents include:

*   `./docs/security-analysis-log.md`: Log static analysis findings and resolutions.
*   `./docs/test-coverage-report.md`: Document coverage goals, status, and analysis.
*   `./docs/development-guide.md`: This guide, detailing the workflow.
*   `./docs/architecture/`: Contains architectural decisions like `language-selection.md` (which details the Solidity/Vyper choices).
*   Contract-specific documentation (NatSpec in `.sol`/`.vy` files).
*   Ensure all `TODO` and `FIXME:` markers in code comments are addressed or tracked appropriately.

By rigorously following this iterative process, you can systematically build high-quality smart contracts using Foundry, effectively managing correctness, security, performance, and documentation alignment.
