# AetherDEX Smart Contracts

This directory contains the smart contracts for AetherDEX, a decentralized exchange built with Solidity and the Foundry development framework. AetherDEX implements an automated market maker (AMM) model with concentrated liquidity and advanced features like time-weighted average price (TWAP) oracles and customizable hooks.

## Project Structure

```
├── src/                 # Source code for smart contracts
│   ├── AetherFactory.sol    # Factory contract for creating liquidity pools
│   ├── AetherPool.sol       # Core AMM implementation with constant product formula
│   ├── interfaces/          # Contract interfaces
│   └── libraries/           # Utility libraries (TWAPLib, Math, etc.)
├── test/                # Test suite
│   ├── AetherPool.t.sol     # Tests for the core pool functionality
│   ├── libraries/           # Tests for library functions
│   └── integration/         # Integration tests
└── script/              # Deployment scripts
```

## Key Features

- **Constant Product AMM**: Implements x*y=k formula for stable token swaps
- **Liquidity Management**: Add, remove, and track liquidity positions
- **TWAP Oracle**: Time-weighted average price calculations for price feeds
- **Customizable Hooks**: Extensible architecture with pre and post-swap hooks
- **Minimal Gas Usage**: Optimized for Ethereum and L2 networks

## Prerequisites

* [Foundry](https://book.getfoundry.sh/) - Smart contract development toolkit
* [Solidity](https://docs.soliditylang.org/) - Version 0.8.29
* An Ethereum wallet with a private key (e.g., MetaMask)
* Sufficient MATIC to pay for gas fees on Polygon

## Installation

```bash
# Clone the repository (if you haven't already)
git clone https://github.com/your-username/AetherDEX.git
cd AetherDEX/backend/smart-contract

# Install dependencies
forge install
```

## Testing

Run the comprehensive test suite to verify contract functionality:

```bash
# Run all tests
forge test

# Run tests with verbosity for detailed output
forge test -vvv

# Run specific test file
forge test --match-path test/AetherPool.t.sol

# Run tests with gas reporting
forge test --gas-report
```

All smart contracts must pass all tests with 100% coverage before deployment to mainnet.

## Deployment

1. **Set Environment Variables:**

   Create a `.env` file in the `backend/smart-contract` directory with:
   ```
   PRIVATE_KEY=your_private_key
   POLYGON_RPC_URL=your_polygon_rpc_url
   ETHERSCAN_API_KEY=your_etherscan_api_key  # For verification
   ```

2. **Compile the Contracts:**
   ```bash
   forge build
   ```

3. **Deploy the Factory Contract:**
   ```bash
   forge create --rpc-url $POLYGON_RPC_URL --private-key $PRIVATE_KEY src/AetherFactory.sol:AetherFactory
   ```

4. **Verify the Contract (Optional):**
   ```bash
   forge verify-contract --chain polygon --api-key $ETHERSCAN_API_KEY <DEPLOYED_ADDRESS> src/AetherFactory.sol:AetherFactory
   ```

5. **Note the Contract Address:**
   After deployment, save the factory address for frontend integration.

## Security Considerations

- All contracts use SafeMath operations via Solidity 0.8.x built-in overflow/underflow protection
- Critical functions include proper access control
- Liquidity operations have safeguards against common attack vectors
- Comprehensive test coverage ensures expected behavior in edge cases

## License

This project is licensed under the MIT License - see the LICENSE file for details.
