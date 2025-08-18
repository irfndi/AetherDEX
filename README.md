[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/irfndi/AetherDEX)
![CodeRabbit Pull Request Reviews](https://img.shields.io/coderabbit/prs/github/irfndi/AetherDEX?utm_source=oss&utm_medium=github&utm_campaign=irfndi%2FAetherDEX&labelColor=171717&color=FF570A&link=https%3A%2F%2Fcoderabbit.ai&label=CodeRabbit+Reviews)

# AetherDEX

<p align="center">
  <img src="https://via.placeholder.com/200x200?text=AetherDEX" alt="AetherDEX Logo" width="200" height="200">
</p>

<p align="center">
  A next-generation decentralized exchange with concentrated liquidity and advanced features
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#getting-started">Getting Started</a> •
  <a href="#development">Development</a> •
  <a href="#deployment">Deployment</a> •
  <a href="#contributing">Contributing</a> •
  <a href="#license">License</a>
</p>

## Features

AetherDEX is a comprehensive decentralized exchange platform built on Ethereum and compatible L2 networks, offering:

- **Advanced Routing**: Multi-hop swaps with optimal path finding and slippage protection
- **Concentrated Liquidity**: Capital-efficient liquidity provision using Uniswap V4 integration
- **TWAP Oracle**: Time-weighted average price calculations for reliable price feeds
- **Extensible Hooks**: Customizable hook architecture for advanced trading strategies
- **Gas Optimized**: Sophisticated algorithms for minimal gas consumption
- **Modern Stack**: Next.js 15 + React 19 frontend with Go backend infrastructure
- **Real-time Data**: WebSocket integration for live price feeds and market data

## Architecture

AetherDEX is structured as a monorepo with the following components:

```
AetherDEX/
├── backend/                # Go backend services and smart contracts
│   ├── smart-contract/     # Solidity smart contracts (Foundry)
│   ├── api/                # REST API endpoints
│   ├── internal/           # Internal Go packages
│   └── pkg/                # Shared Go packages
├── interface/              # Frontend applications
│   └── web/                # Next.js web interface
├── docs/                   # Project documentation
├── infrastructure/         # Docker and deployment configs
└── scripts/                # Utility and deployment scripts
```

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v24+)
- [Foundry](https://book.getfoundry.sh/) for smart contract development
- [Bun](https://bun.sh/) (v1.2+) for package management
- [Go](https://golang.org/) (v1.25+) for backend development
- An Ethereum wallet (e.g., MetaMask)
- PostgreSQL and Redis for backend services
- Basic understanding of DeFi and AMM concepts

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/your-username/AetherDEX.git
   cd AetherDEX
   ```

2. Install dependencies for each component:

   ```bash
   # Smart contracts
   cd backend/smart-contract
   forge install

   # Frontend
   cd ../../interface/web
   bun install

   # Backend API
   cd ../../backend
   go mod download
   ```

## Development

### Smart Contracts

Navigate to the smart contract directory and run tests:

```bash
cd backend/smart-contract
forge test
```

For more details, see the [Smart Contract README](backend/smart-contract/README.md).

### Frontend

Start the development server:

```bash
cd interface/web
bun dev
```

The application will be available at `http://localhost:3000`.

## Deployment

### Smart Contracts

Deploy the contracts to a testnet or mainnet:

```bash
cd backend/smart-contract
forge create --rpc-url $RPC_URL --private-key $PRIVATE_KEY src/AetherFactory.sol:AetherFactory
```

### Frontend

Build and deploy the frontend:

```bash
cd interface/web
bun build
```

Deploy the built files from the `dist` directory to your preferred hosting service.

## Testing

Run comprehensive tests for all components:

```bash
# Smart contract tests
cd backend/smart-contract
forge test -vvv

# Frontend tests
cd interface/web
bun test
```

## Security

AetherDEX prioritizes security through:

- Comprehensive test coverage for all smart contracts
- Solidity 0.8.29 with built-in overflow/underflow protection
- Proper access control and input validation
- Safeguards against common DeFi attack vectors

## Contributing

We welcome contributions to AetherDEX! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgements

- [Uniswap V3](https://uniswap.org/) for pioneering concentrated liquidity
- [Foundry](https://book.getfoundry.sh/) for the smart contract development framework
- The entire Ethereum community for continuous innovation
