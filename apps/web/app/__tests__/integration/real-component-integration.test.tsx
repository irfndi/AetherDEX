import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SwapPage from '../../trade/swap/page'

// Mock UI components
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, className, ...props }: any) => (
    <button onClick={onClick} className={className} {...props}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: ({ value, onChange, placeholder, className, ...props }: any) => (
    <input
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={className}
      {...props}
    />
  ),
}))

vi.mock('lucide-react', () => ({
  ArrowDown: () => <div data-testid="arrow-down">↓</div>,
  ChevronDown: () => <div data-testid="chevron-down">⌄</div>,
}))

// Mock layout components
vi.mock('@/components/Header', () => ({
  Header: ({ onWalletConnect }: any) => (
    <header data-testid="header">
      <button onClick={() => onWalletConnect('0x123')}>Connect Wallet</button>
    </header>
  ),
}))

vi.mock('@/components/BackgroundTokens', () => ({
  BackgroundTokens: () => <div data-testid="background-tokens">Background</div>,
}))

// Mock TokenSelector component
vi.mock('@/components/TokenSelector', () => ({
  TokenSelector: ({ token, onSelect }: any) => (
    <button 
      data-testid="token-selector"
      onClick={() => onSelect?.({ symbol: 'USDC', name: 'USD Coin', icon: '/usdc.png', balance: '100', price: 1 })}
    >
      {token ? token.symbol : 'Select Token'}
    </button>
  ),
}))

describe('SwapPage Component', () => {
  it('renders without crashing', () => {
    render(<SwapPage />)
    expect(screen.getByTestId('header')).toBeInTheDocument()
  })

  it('displays swap interface elements', () => {
    render(<SwapPage />)
    
    expect(screen.getByTestId('header')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /get started/i })).toBeInTheDocument()
    expect(screen.getByText('Swap tokens instantly')).toBeInTheDocument()
    expect(screen.getByText('Trade any combination of tokens with the best rates and lowest fees.')).toBeInTheDocument()
  })

  it('handles amount input changes', () => {
    render(<SwapPage />)
    
    const inputs = screen.getAllByRole('textbox')
    expect(inputs).toHaveLength(2) // Should have sell and buy inputs
    
    const sellInput = inputs[0]
    fireEvent.change(sellInput, { target: { value: '1.5' } })
    expect(sellInput).toHaveValue('1.5')
  })

  it('displays wallet connection prompt when not connected', () => {
    render(<SwapPage />)
    
    const connectButton = screen.getByText('Connect Wallet')
    expect(connectButton).toBeInTheDocument()
  })

  it('shows token selectors', () => {
    render(<SwapPage />)
    
    const tokenSelectors = screen.getAllByTestId('token-selector')
    expect(tokenSelectors).toHaveLength(2) // Sell and buy token selectors
    expect(tokenSelectors[0]).toHaveTextContent('ETH')
  })

  it('displays balance information', () => {
    render(<SwapPage />)
    
    const balanceElements = screen.getAllByText(/Balance:/)
    expect(balanceElements.length).toBeGreaterThan(0)
    expect(screen.getByText('ETH')).toBeInTheDocument()
  })

  it('handles swap button interaction', () => {
    render(<SwapPage />)
    
    const swapButton = screen.getByRole('button', { name: /get started/i })
    expect(swapButton).toBeInTheDocument()
    
    fireEvent.click(swapButton)
    // Button should remain clickable
    expect(swapButton).toBeInTheDocument()
  })
})