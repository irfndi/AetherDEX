# AetherDEX GitHub Workflows

This directory contains GitHub Actions workflows and configuration files for the AetherDEX project.

## CI/CD Workflows

### 1. autofix.ci (`autofix.yml`)

This workflow automatically fixes code formatting and linting issues in pull requests.

- **Triggers**: On push/PR to main and master branches
- **Features**:
  - Automatically formats TypeScript/JavaScript code using Biome
  - Formats Go code using `go fmt`
  - Formats Solidity contracts using `forge fmt`
  - Commits fixes directly to pull requests
- **Technologies**:
  - Biome for JavaScript/TypeScript linting and formatting
  - Go standard formatter for backend code
  - Foundry formatter for smart contracts

**Setup**: The autofix.ci GitHub App must be installed on the repository. Visit [autofix.ci](https://autofix.ci/setup) for installation instructions.

### 2. Foundry Tests (`foundry-tests.yml`)

This workflow runs Solidity smart contract tests using Foundry.

- **Triggers**: On push/PR to main, master, develop branches when changes are made to smart contract code
- **Features**:
  - Runs Forge tests with parallel execution and IR optimization
  - Generates code coverage reports
  - Uploads coverage to Codecov
  - Runs Slither static analysis for security checks

**Required Secrets**:

- `CODECOV_TOKEN`: Token for uploading coverage reports to Codecov

### 3. Frontend Build & Lint (`frontend-build.yml`)

This workflow builds and tests the frontend web application.

- **Triggers**: On push/PR to main, develop branches when changes are made to interface/web
- **Features**:
  - Installs dependencies using Bun
  - Runs linting and type checking
  - Builds the frontend application
  - Archives build artifacts

### 4. CodeQL Analysis (`codeql.yml`)

This workflow performs static code analysis using GitHub's CodeQL.

- **Triggers**: On push/PR to main branch and on a weekly schedule
- **Features**:
  - Analyzes JavaScript/TypeScript code for security vulnerabilities
  - Analyzes GitHub Actions workflows for security issues

## Configuration Files

### 1. Dependabot Configuration (`dependabot.yml`)

Configures automated dependency updates.

## Setting Up Required Secrets

For enhanced functionality, you can optionally add these secrets in your GitHub repository:

1. Go to your repository on GitHub
2. Navigate to Settings > Secrets and variables > Actions
3. Add the following secrets if needed:
   - `CODECOV_TOKEN`: Get this from [Codecov](https://codecov.io) if you want to upload coverage reports

**Note**: All workflows will run without these secrets, but some features like code coverage reporting to Codecov will be limited.

## Best Practices

1. **Always run tests locally before pushing**:

   ```bash
   cd backend/smart-contract && forge test --via-ir
   ```

2. **Check for security issues with Slither**:

   ```bash
   cd backend/smart-contract && slither .
   ```

3. **Ensure frontend builds correctly**:
   ```bash
   cd apps/web && bun run build
   ```
