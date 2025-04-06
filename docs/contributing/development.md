# Development Setup

This guide outlines the steps required to set up your local development environment for contributing to AetherDEX.

## Prerequisites

Before you begin, ensure you have the following installed on your system:

- **Git**: For version control. [Download Git](https://git-scm.com/downloads)
- **Node.js**: Required for running certain tools and scripts. We recommend using the latest LTS version. [Download Node.js](https://nodejs.org/) (Note: Most development will use Bun, but Node.js is still required for some tooling)
- **Bun**: A fast all-in-one JavaScript runtime and package manager. [Install Bun](https://bun.sh/docs/installation)
- **Foundry**: For smart contract development and testing. Follow the installation guide: [Foundry Book Installation](https://book.getfoundry.sh/getting-started/installation)
- **Docker**: (Optional, but recommended) For running isolated services or databases if needed. [Download Docker](https://www.docker.com/products/docker-desktop/)

## Getting the Code

1.  **Fork the Repository**: Go to the main AetherDEX repository on GitHub ([https://github.com/aetherdex/aetherdex](https://github.com/aetherdex/aetherdex)) and click the "Fork" button in the top-right corner. This creates a copy of the repository under your GitHub account.

2.  **Clone Your Fork**: Clone the repository from your account to your local machine:
    ```bash
    git clone https://github.com/YOUR_GITHUB_USERNAME/aetherdex.git
    cd aetherdex
    ```

3.  **Add Upstream Remote**: Add the original repository as the `upstream` remote. This allows you to pull changes from the main repository to keep your fork updated.
    ```bash
    git remote add upstream https://github.com/aetherdex/aetherdex.git
    ```

## Installing Dependencies

AetherDEX uses a monorepo structure, likely managed with Bun workspaces or similar. Dependencies need to be installed for different parts of the project (frontend, backend, smart contracts).

1.  **Install Root Dependencies**: Navigate to the root directory of the cloned project (`aetherdex/`) and run:
    ```bash
    Bun install
    ```
    This command should install dependencies for all workspaces defined in the root `package.json`.

2.  **Install Smart Contract Dependencies**: Navigate to the smart contract directory and install specific dependencies like Git submodules (for libraries like OpenZeppelin, forge-std):
    ```bash
    cd backend/smart-contract
    forge install # Or potentially `git submodule update --init --recursive` if submodules are used heavily
    cd ../.. # Return to root
    ```

## Building the Project

Build steps might be required for different parts of the application.

1.  **Build Smart Contracts**: Compile the Solidity contracts:
    ```bash
    cd backend/smart-contract
    forge build
    cd ../..
    ```

2.  **Build Frontend/Backend**: (If applicable, depending on the stack)
    ```bash
    # Example for a Next.js frontend in interface/web
    cd interface/web
    bun build
    cd ../..

    # Example for a Node.js backend
    # cd backend/service (adjust path as needed)
    # bun build
    # cd ../..
    ```

## Running Locally

1.  **Run Smart Contract Tests**: Ensure the core logic is working:
    ```bash
    cd backend/smart-contract
    forge test
    cd ../..
    ```

2.  **Start Local Blockchain (Optional)**: For testing contract deployments and interactions, you can run a local node:
    ```bash
    # Using Anvil (part of Foundry)
    anvil
    ```
    Keep this terminal running. You'll need to deploy contracts to this local network.

3.  **Deploy Contracts (Locally)**: Use Foundry scripts to deploy contracts to your Anvil instance.
    ```bash
    cd backend/smart-contract
    # Example deploy command (adjust script name as needed)
    forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast --private-key YOUR_ANVIL_PRIVATE_KEY
    cd ../..
    ```
    *Note: Obtain a private key from the Anvil startup logs.*

4.  **Start Backend Services**: (If applicable)
    ```bash
    # cd backend/service
    # bun dev
    # cd ../..
    ```

5.  **Start Frontend**:
    ```bash
    cd interface/web
    bun dev
    ```
    This will typically start the development server, often accessible at `http://localhost:3000`.

## Keeping Your Fork Updated

Before starting new work, ensure your local `main` branch is up-to-date with the `upstream` repository:

```bash
git checkout main
git fetch upstream
git merge upstream/main
git push origin main # Update your fork on GitHub
```

## Creating a New Branch

Always create a new branch for your changes:

```bash
git checkout -b feature/your-feature-name # Or fix/your-bug-fix
```

Now you are ready to start developing! Refer to the [Contribution Guidelines](./guidelines.md) and [Pull Request Process](./pull-requests.md) for the next steps.
