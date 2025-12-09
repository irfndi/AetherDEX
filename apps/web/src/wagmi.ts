import { http, createConfig } from 'wagmi'
import { mainnet, sepolia, hardhat, localhost } from 'wagmi/chains'
import { injected, walletConnect } from 'wagmi/connectors'

// Replace with your actual WalletConnect project ID
const projectId = 'YOUR_PROJECT_ID'

export const config = createConfig({
  chains: [mainnet, sepolia, hardhat, localhost],
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
    [hardhat.id]: http(),
    [localhost.id]: http(),
  },
  connectors: [
    injected(),
    // walletConnect({ projectId }), // Uncomment if you have a project ID
  ],
})
