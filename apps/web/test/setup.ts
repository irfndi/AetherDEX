import { afterEach, vi, expect } from 'vitest'
import { cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'
import type { Token } from '../components/features/trade/TokenSelector'

// Extend vitest expect with jest-dom matchers
expect.extend(matchers)

// runs a cleanup after each test case (e.g. clearing jsdom)
afterEach(() => {
    cleanup()
})

// Mock use-api hook
vi.mock('../src/hooks/use-api', () => ({
    useTokens: vi.fn(() => ({ data: [], isLoading: false })),
    usePools: vi.fn(() => ({ data: [], isLoading: false })),
    useSwapQuote: vi.fn(() => ({ data: null, isLoading: false, error: null })),
}))

// Mock helper function used by existing tests
export const createMockTokenList = () => [
    { symbol: 'ETH', name: 'Ethereum', balance: '1.5' },
    { symbol: 'USDC', name: 'USD Coin', balance: '500.0' },
    { symbol: 'DAI', name: 'Dai', balance: '100.0' },
];

// Create a mock token for testing
interface MockTokenInput {
  symbol: string;
  name: string;
  price?: number;
}

export function createMockToken({ symbol, name, price }: MockTokenInput): Token {
  return {
    symbol,
    name,
    icon: null,
    balance: "1000.0",
    price: price || 0
  };
}

// Mocking wagmi hooks
vi.mock('wagmi', async (importOriginal) => {
    const mod = await importOriginal<typeof import('wagmi')>()
    return {
        ...mod,
        useAccount: vi.fn(() => ({ address: undefined, isConnected: false })),
        useConnect: vi.fn(() => ({ connectors: [], connect: vi.fn() })),
        useDisconnect: vi.fn(() => ({ disconnect: vi.fn() })),
        useWriteContract: vi.fn(() => ({ writeContract: vi.fn(), isPending: false })),
        useSendTransaction: vi.fn(() => ({ sendTransaction: vi.fn(), isPending: false })),
        createConfig: vi.fn(),
        http: vi.fn(),
    }
})

vi.mock('wagmi/chains', () => {
    return {
        mainnet: {},
        sepolia: {},
        hardhat: {},
        localhost: {},
    }
})

vi.mock('wagmi/connectors', () => {
    return {
        injected: vi.fn(),
        walletConnect: vi.fn(),
    }
})

// Mocking tanstack router
vi.mock('@tanstack/react-router', async () => {
    const actual = await vi.importActual('@tanstack/react-router')
    return {
        ...actual,
        createFileRoute: () => (config: any) => ({
            component: config.component,
            ...config
        }),
        Link: (props: any) => null,
        useRouter: vi.fn(),
    }
})

