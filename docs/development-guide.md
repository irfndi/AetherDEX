# Workflow for Solidity Smart Contract Development with Foundry & slither

> [TODO]: Review and update this guide after every major contract or process change. Keep this doc in sync with actual dev practices and requirements.
> 
> **Last Reviewed:** 2025-04-17

## Quick Summary
- **Iterative development:** Write/modify contracts and tests, run `./test-all` (alias for `forge test --via-ir --root ./backend/smart-contract/`), fix issues, repeat.
- **Static analysis:** Run `./slither-all` (alias for `slither . --root ./backend/smart-contract/`), log and fix findings, document in `security-analysis-log.md`.
- **Coverage:** Use `./coverage-all` (alias for `forge coverage --via-ir --root ./backend/smart-contract/`), focus on >95% and 100% for critical logic, document in `test-coverage-report.md`.
- **All scripts:** Use `./test-all`, `./coverage-all`, and `./slither-all` for consistent local dev and CI.
- **Refactor & optimize:** Gas, security, clarity, modern Solidity. Add NatSpec, custom errors, events.
- **Final validation:** Clean, build, test, coverage, docs up-to-date, all issues resolved.
- **Docs:** Keep `./docs` aligned with code and process, update [TODO]s.

---

## Goal:
To develop a robust, secure, optimized, and thoroughly tested suite of Solidity smart contracts using the Foundry framework. The process emphasizes ensuring correctness in both the smart contract implementation and the accompanying tests.

## Assumptions:

*   Foundry is correctly installed and configured on your development machine.
*   Your smart contract project is located in the directory: `./backend/smart-contract/`.
*   Project documentation resides in the `./docs` directory and must be consistently updated to reflect the current state of the codebase.

## Core Development Cycle (Iterative Process):
Understand that developing smart contracts is an iterative process. You will likely cycle through the following steps multiple times as you build, test, and refine your contracts. It is crucial to use version control, such as Git, to manage changes, track progress, and facilitate collaboration.

### Step 1: Write or Modify Code and Initial Tests

*   **Implement Contract Features:** Write new Solidity code or modify existing code within `.sol` files to add desired functionality or fix identified issues. Ensure your code adheres to the requirements and specifications detailed in the `./docs` directory.
*   **Develop Comprehensive Tests:** For every feature or change, create corresponding tests in `.t.sol` files. These tests should cover:
    *   Expected behavior and core use cases.
    *   Edge cases, including boundary conditions and less common scenarios.
    *   Potential failure scenarios, such as invalid inputs or unauthorized access attempts.
    *   Known security vulnerabilities like reentrancy, arithmetic overflows/underflows, etc.
*   **Apply Test-Driven Development (TDD):** Whenever practical, adopt TDD by writing tests before writing the corresponding contract code. This helps ensure test coverage from the outset and guides implementation towards correctness.
*   **Use TODO and FIXME Markers:**
    *   Mark incomplete sections or features needing future work with a `[TODO]` comment (e.g., `// [TODO]: Implement the full withdrawal pattern`).
    *   Flag known bugs or areas needing correction with a `[FIXME]` comment (e.g., `// [FIXME]: Potential reentrancy vulnerability in the transfer function`).

### Step 2: Test, Debug, and Fix (The Central Loop)

*   **Run Tests:** Execute your test suite using the command: `forge test --via-ir --root ./backend/smart-contract/` Consider creating a shorter alias or script for this command for efficiency (e.g., a script named `test-all`).
*   **Analyze Test Failures:** If any tests fail, investigate systematically:
    *   Check if the test logic itself is flawed (`.t.sol` file).
    *   Verify if the contract code (`.sol` file) deviates from the requirements or test expectations.
    *   Rule out environment issues by checking your Foundry configuration (`foundry.toml`), dependencies, or setup.
*   **Address Compiler Warnings:** Carefully review the compiler output for warnings (like unused variables, missing SPDX identifiers, etc.) and resolve them. If a warning is intentional or acceptable for specific reasons, document the justification in the `./docs` directory (e.g., add a note to `./docs` explaining why a variable is currently unused).
*   **Iterate:** Continue modifying code and tests, re-running tests, and debugging until all tests pass successfully. Ensure the code not only passes tests but also logically meets the requirements outlined in `./docs`.

### Step 3: Perform Static Analysis Early and Often

*   **Run Static Analysis Tools:** Regularly execute static analysis tools to catch potential vulnerabilities and bad practices early. Use Slither with the command: `slither . --root ./backend/smart-contract/` Optionally, integrate other tools like Mythril or Securify for more extensive analysis.
*   **Act on Findings:** Review the analysis reports for issues like reentrancy risks, access control problems, or other security concerns. Fix the identified problems in your `.sol` files.
*   **Re-Verify:** After applying fixes based on static analysis, always re-run your test suite (Step 2) to ensure no regressions were introduced.
*   **Document Issues:** Log any significant findings (especially high or medium severity issues) in a dedicated document, perhaps `./docs/security-analysis.md`. Record how each issue was resolved or provide justification if an issue is deemed acceptable (e.g., create a `[TODO]: Document Slither findings and resolutions in /docs`).

### Step 4: Assess and Improve Test Coverage

*   **Generate Coverage Report:** Measure how much of your codebase is executed by your tests using the command: `forge coverage --via-ir --root ./backend/smart-contract/`
*   **Analyze Coverage:** Review the generated report (the HTML version is often easiest to navigate) to identify functions, code branches, or lines that are not currently tested.
*   **Increase Coverage:** Write additional tests in your `.t.sol` files specifically targeting:
    *   Untested critical logic, especially related to fund transfers, state changes, or access control.
    *   Edge cases that might have been missed previously.
*   **Utilize Advanced Testing:** Explore techniques like:
    *   **Fuzz Testing:** Supply random inputs to functions to uncover unexpected behavior.
    *   **Property-Based Testing:** Define and verify invariants (rules that should always hold true, e.g., "total supply never decreases").
*   **Confirm Tests:** Re-run `forge test` to ensure all existing and new tests pass.
*   **Iterate and Document:** Aim for a high coverage percentage (e.g., >95% is a common guideline), paying special attention to security-critical parts of the code. Update documentation, perhaps in `./docs/test-coverage.md`, with your coverage goals and current status (e.g., add a `[TODO]: Update /docs with coverage report summary and target`).

### Step 5: Review and Refactor for Quality

*   **Enhance Security:**
    *   Apply established security patterns like Checks-Effects-Interactions.
    *   Use robust access control mechanisms (e.g., OpenZeppelin’s `Ownable` or role-based access).
    *   Revisit static analysis findings (Step 3).
    *   Consider potential economic exploits (like front-running or flash loan manipulation).
*   **Optimize for Gas Efficiency:**
    *   Use `calldata` for function arguments instead of `memory` where possible.
    *   Minimize reads and writes to storage variables (SLOAD/SSTORE operations).
    *   Declare variables as `immutable` or `constant` if their values don't change.
    *   Optimize loops and choose efficient data structures (e.g., mappings over arrays where appropriate).
    *   Use `forge test --gas-report` to profile gas costs, but balance optimization with code readability.
*   **Improve Clarity and Maintainability:**
    *   Add comprehensive NatSpec documentation (`@dev`, `@param`, `@return`, `@notice`) to all public and external functions and state variables.
    *   Use clear, descriptive names for variables, functions, and events.
    *   Emit events for significant actions to facilitate off-chain monitoring.
    *   Prefer custom errors (e.g., `error UnauthorizedAccess();`) over `require` statements with string messages for better efficiency and clarity.
    *   Keep functions concise and focused on a single responsibility.
*   **Modernize Code:**
    *   Use a recent Solidity version (e.g., `^0.8.x`) to benefit from built-in overflow checks and newer features.
    *   Leverage custom errors and use `unchecked` blocks cautiously where arithmetic safety is guaranteed externally.
    *   Ensure the EVM version specified in `foundry.toml` is appropriate.
*   **Re-Verify Changes:** After any refactoring, diligently repeat Step 2 (testing) and Step 4 (coverage analysis) to ensure functionality remains correct and no new issues have been introduced. Update `./docs` to reflect any significant changes or new patterns adopted (e.g., add a `[TODO]: Document the use of custom errors in ./docs`).

### Step 6: Final Validation Sequence

Before considering a development cycle complete or preparing for deployment, run the following sequence of commands:

```bash
forge clean --root ./backend/smart-contract/
forge build --via-ir --root ./backend/smart-contract/
forge test --via-ir --root ./backend/smart-contract/
forge coverage --via-ir --root ./backend/smart-contract/
```

Confirm the following:

*   The build completes cleanly without errors or unexpected warnings.
*   All tests pass (100% pass rate).
*   Test coverage meets the project's target (e.g., >95%) and covers all critical paths.
*   All findings from manual code reviews and static analysis (Step 3) have been addressed or explicitly documented in `./docs`.
*   The code adheres to best practices regarding security, gas optimization, clarity, and uses modern Solidity features appropriately.
*   The final implementation and tests align with the requirements documented in `./docs`.

## Continuous Improvement: Testing & Static Debug

- **Always add tests for new features and bugfixes.**
- **Increase coverage regularly:** Target >95%, especially for critical logic.
- **Run static analysis (`./slither-all`) after major changes.**
- **Review and refactor tests and analysis scripts periodically.**
- **Keep [TODO]s and documentation up to date.**
- **Set up CI/CD:** Automate running `./test-all`, `./coverage-all`, and `./slither-all` on every push/PR (see below).
- **(Optional) Pre-commit hook:** Warn/block if docs are stale or [TODO]s unresolved.

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
  - This will warn you if there are unresolved `[TODO]`s in `./docs` before every commit.

## Additional Recommendations:

*   **Version Control:** Use Git consistently for tracking changes, managing branches, and collaborating. Commit messages should be clear, and `[TODO]` / `[FIXME]` markers should be tracked or resolved.
*   **Continuous Integration/Continuous Deployment (CI/CD):** Implement automated pipelines (e.g., using GitHub Actions, GitLab CI) to run tests, static analysis, and coverage checks automatically on code changes.
*   **Professional Auditing:** For high-value or critical contracts, plan for and obtain a professional security audit from reputable third-party auditors before mainnet deployment.
*   **Dependency Management:** Manage external libraries (like OpenZeppelin contracts) using Foundry's built-in dependency management features. Ensure these dependencies are understood and tested within your project context.
*   **Environment Configuration:** Double-check that settings in `foundry.toml` (like the Solidity compiler version and EVM target) are correctly configured for your project's requirements and deployment target.

## Note on Documentation (`./docs`) Alignment:

Maintaining accurate and up-to-date documentation in the `./docs` directory is crucial. It should always reflect the current state of the contract logic, testing strategy, security posture, and architectural decisions. Consider adding these tasks:

*   `[TODO]: Create a ./docs/security-analysis.md file to log static analysis findings and resolutions.`
*   `[TODO]: Establish and track coverage targets in ./docs/test-coverage.md.`
*   `[TODO]: Consider saving this development workflow guide as ./docs/development-guide.md for team reference.` (This file)

By rigorously following this iterative process, you can systematically build high-quality smart contracts using Foundry, effectively managing correctness, security, performance, and documentation alignment.
