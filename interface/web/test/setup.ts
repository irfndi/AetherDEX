import '@testing-library/jest-dom'
import { vi, beforeAll, afterEach } from 'vitest'

// Setup jsdom environment
beforeAll(() => {
  // Vitest with jsdom should handle this automatically, but ensure globals are available
  if (typeof globalThis.document === 'undefined') {
    // This should not happen with jsdom environment, but as a fallback
    Object.assign(globalThis, {
      document: {},
      window: {},
      navigator: {},
    })
  }
})

// Clean up after each test
afterEach(() => {
  vi.clearAllMocks()
})

// Global test utilities
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}))

global.matchMedia = vi.fn().mockImplementation((query) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}))

// Mock localStorage
Object.defineProperty(global, 'localStorage', {
  value: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  },
  writable: true,
})

// Test data factories
export const createMockToken = (overrides = {}) => ({
  symbol: 'ETH',
  name: 'Ethereum',
  icon: '/eth-icon.svg',
  balance: '1.0',
  price: 2000,
  ...overrides,
})

export const createMockTokenList = () => [
  createMockToken({ symbol: 'ETH', name: 'Ethereum' }),
  createMockToken({ symbol: 'USDC', name: 'USD Coin', icon: '/usdc-icon.svg' }),
  createMockToken({ symbol: 'WBTC', name: 'Wrapped Bitcoin', icon: '/wbtc-icon.svg' }),
]