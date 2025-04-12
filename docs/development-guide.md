# Solidity Smart Contract Development Workflow (Foundry)

This document outlines the development process for the AetherDEX smart contract suite using Foundry.

#### Goal
Develop a robust, secure, optimized, and well-tested Solidity smart contract suite using Foundry, ensuring correctness in both implementation and tests.

#### Assumptions
- Foundry is installed and configured correctly.
- Your project is set up at `./backend/smart-contract/`.
- Project documentation exists in `./docs` and should be kept aligned with the codebase.

#### Core Development Cycle (Iterative)
This process is iterative. Expect to cycle through these steps multiple times as you develop, test, and refine your contracts. Use version control (e.g., Git) to track changes and maintain progress.

---

### 1. Write/Modify Code & Initial Tests
- **Implement Contract Features:**
  - Write or modify Solidity code in `.sol` files to add features or address issues.
  - Follow requirements outlined in root folder`./docs` (e.g., specifications, intended logic).
- **Write Comprehensive Tests:**
  - Create corresponding tests in `.t.sol` files, covering:
    - Expected functionality (core use cases).
    - Edge cases (boundary conditions, rare scenarios).
    - Failure scenarios (invalid inputs, unauthorized access).
    - Security vulnerabilities (e.g., reentrancy, overflow/underflow).
  - Adopt **Test-Driven Development (TDD)** where possible: Write tests before contract code to ensure coverage and correctness from the start.
- **Use [TODO] and [FIXME]:**
  - Mark incomplete features with `[TODO]` (e.g., `[TODO]: Implement withdrawal pattern`).
  - Highlight known issues with `[FIXME]` (e.g., `[FIXME]: Reentrancy risk in transfer function`).

---

### 2. Test, Debug, and Fix (The Core Loop)
- **Run Tests:**
  - Command: `forge test --via-ir --root ./backend/smart-contract/`
    *(Optional: Define a shorter alias in a script for efficiency, e.g., `test-all`).*
- **Analyze Failures:**
  - If tests fail, debug systematically:
    - **Test Logic Flawed:** Fix `.t.sol` if assumptions are incorrect or logic is buggy.
    - **Contract Incorrect:** Fix `.sol` if it deviates from requirements or test expectations.
    - **Environment Issues:** Check setup (e.g., `foundry.toml`, dependencies) if tests fail unexpectedly.
- **Address Compiler Warnings:**
  - Review output for warnings (e.g., unused variables, missing SPDX) and resolve them.
  - Ensure warnings are documented in `./docs` if intentional (e.g., `[TODO]: Update /docs with justification for unused variable`).
- **Iterate:**
  - Repeat testing and fixing until all tests pass.
  - Focus on sound logic, not just passing tests—verify against requirements in `./docs`.

---

### 3. Static Analysis (Early and Often)
- **Run Static Analysis:**
  - Command: `slither . --root ./backend/smart-contract/`
    *(Optional: Integrate additional tools like Mythril or Securify for broader coverage).*
- **Actions:**
  - Perform analysis periodically (not just at the end) to catch issues early.
  - Review vulnerabilities (e.g., reentrancy, access control) and bad practices.
  - Fix `.sol` files based on findings.
  - Re-run tests (Step 2) to ensure no regressions.
- **Documentation:**
  - Log high/medium severity issues in `./docs/security-analysis.md` with resolutions or justifications (e.g., `[TODO]: Document Slither findings in /docs`).

---

### 4. Assess and Improve Test Coverage
- **Run Coverage Report:**
  - Command: `forge coverage --via-ir --root ./backend/smart-contract/`
- **Actions:**
  - Review the report (HTML version recommended) to identify untested functions, branches, and lines.
  - Write additional tests in `.t.sol` targeting:
    - Critical logic (e.g., funds transfers, state changes).
    - Edge cases missed earlier.
  - Use advanced techniques:
    - **Fuzz Testing:** Test with random inputs to uncover unexpected behaviors.
    - **Property-Based Testing:** Verify invariants (e.g., "balance never goes negative").
  - Re-run `forge test` to confirm all tests pass.
- **Iterate:**
  - Aim for >95% coverage as a guideline, prioritizing security-sensitive areas.
  - Update `./docs/test-coverage.md` with coverage goals and results (e.g., `[TODO]: Add coverage report summary to /docs`).

---

### 5. Review and Refactor for Quality
- **Security:**
  - Apply patterns like Checks-Effects-Interactions and secure access control (e.g., OpenZeppelin’s `Ownable`).
  - Revisit static analysis findings (Step 3).
  - Check for economic exploits (e.g., front-running, flash loan attacks).
- **Gas Optimization:**
  - Use `calldata` instead of `memory` where applicable.
  - Minimize state variable reads/writes (SLOAD/SSTORE).
  - Use `immutable` and `constant` for fixed values.
  - Optimize loops and data structures (e.g., arrays vs. mappings).
  - Profile with `forge test --gas-report` and balance with readability.
- **Clarity & Maintainability:**
  - Add **NatSpec** documentation (`@dev`, `@param`, `@return`) to all public/external functions.
  - Use descriptive names (e.g., `transferFunds` vs. `tf`).
  - Emit events for key actions (e.g., `event FundsTransferred(address, uint256)`).
  - Use custom errors (e.g., `error Unauthorized()`) instead of `require` strings.
  - Keep functions short and focused.
- **Modernization:**
  - Use Solidity ^0.8.x for built-in overflow checks and modern features.
  - Leverage custom errors and `unchecked` blocks (where safe) for gas savings.
  - Verify EVM compatibility in `foundry.toml`.
- **Re-verify:**
  - After refactoring, repeat Step 2 (testing) and Step 4 (coverage) to catch regressions.
  - Update `./docs` with new features or changes (e.g., `[TODO]: Document custom errors in ./docs`).

---

### 6. Final Validation Sequence
- **Run Commands:**
  ```bash
  forge clean --root ./backend/smart-contract/ && \
  forge build --via-ir --root ./backend/smart-contract/ && \
  forge test --via-ir --root ./backend/smart-contract/ && \
  forge coverage --via-ir --root ./backend/smart-contract/
  ```
- **Checks:**
  - **Clean Build:** No errors or warnings.
  - **All Tests Pass:** 100% pass rate.
  - **High Coverage:** >95% (or project-specific target), with critical paths covered.
  - **Review Complete:** Address manual and static analysis feedback.
- **Final Status Confirmation:**
  - Tests pass consistently.
  - Coverage is high and prioritizes key areas.
  - Build is clean.
  - Static analysis shows no unresolved high/medium issues (or documented in `/docs`).
  - Code follows best practices (security, optimization, clarity, modern Solidity).
  - Implementation and tests align with requirements in `/docs`.

---

### Additional Recommendations
- **Version Control:** Use Git to track changes, commit `[TODO]`/`[FIXME]` updates, and collaborate.
- **CI/CD:** Set up pipelines (e.g., GitHub Actions) to automate testing and validation.
- **Auditing:** Plan a professional audit for critical contracts before deployment.
- **Dependencies:** Manage external libraries (e.g., OpenZeppelin) via Foundry’s dependency system and test thoroughly.
- **Environment:** Confirm `foundry.toml` settings (e.g., Solidity version, EVM target) match project needs.

---

### Notes on `./docs` Alignment
- Ensure `./docs` reflects the latest contract logic, tests, and security considerations.
- Suggested `./docs` improvements:
  - `[TODO]: Create ./docs/security-analysis-log.md for static analysis logs.`
  - `[TODO]: Update ./docs/test-coverage-report.md with coverage targets and results.`
  - `[TODO]: Add ./docs/development-guide.md with this prompt for team reference.` (This file)
