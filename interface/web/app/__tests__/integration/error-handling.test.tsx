import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMockToken, createMockTokenList } from '../../../test/setup'

// Mock network errors
const mockNetworkError = new Error('Network request failed')
mockNetworkError.name = 'NetworkError'

const mockTimeoutError = new Error('Request timeout')
mockTimeoutError.name = 'TimeoutError'

const mockInsufficientBalanceError = new Error('Insufficient balance')
mockInsufficientBalanceError.name = 'InsufficientBalanceError'

const mockSlippageError = new Error('Price impact too high')
mockSlippageError.name = 'SlippageError'

const mockGasError = new Error('Gas estimation failed')
mockGasError.name = 'GasError'

// Mock wallet context with error states
const mockWalletContext = {
  isConnected: false,
  address: null as string | null,
  balance: '0',
  connect: vi.fn(),
  disconnect: vi.fn(),
  error: null as string | null,
  isLoading: false,
}

// Mock API service with error simulation
const mockApiService = {
  getTokenPrice: vi.fn(),
  getSwapQuote: vi.fn(),
  executeSwap: vi.fn(),
  getTokenBalance: vi.fn(),
  estimateGas: vi.fn(),
}

// Error-prone SwapInterface Component
const ErrorProneSwapInterface = ({ 
  simulateError = null,
  walletBalance = '1000'
}: {
  simulateError?: string | null
  walletBalance?: string
}) => {
  const [fromToken, setFromToken] = React.useState<any>(null)
  const [toToken, setToToken] = React.useState<any>(null)
  const [fromAmount, setFromAmount] = React.useState('')
  const [toAmount, setToAmount] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [networkStatus, setNetworkStatus] = React.useState<'online' | 'offline'>('online')
  const [gasEstimate, setGasEstimate] = React.useState<string | null>(null)
  const [priceImpact, setPriceImpact] = React.useState<number>(0)
  
  const tokens = createMockTokenList()
  
  // Simulate network status changes
  React.useEffect(() => {
    if (simulateError === 'network') {
      setNetworkStatus('offline')
      setError('Network connection lost. Please check your internet connection.')
    } else {
      setNetworkStatus('online')
    }
  }, [simulateError])
  
  // Calculate output amount with error simulation
  React.useEffect(() => {
    if (fromToken && toToken && fromAmount && parseFloat(fromAmount) > 0) {
      if (simulateError === 'price_fetch') {
        setError('Failed to fetch current token prices. Please try again.')
        setToAmount('')
        return
      }
      
      const outputAmount = (parseFloat(fromAmount) * fromToken.price / toToken.price)
      const impact = (parseFloat(fromAmount) / 1000) * 100 // Simulate price impact
      
      setPriceImpact(impact)
      setToAmount(outputAmount.toFixed(6))
      
      if (impact > 5) {
        setError(`High price impact: ${impact.toFixed(2)}%. Consider reducing trade size.`)
      } else {
        setError(null)
      }
    } else {
      setToAmount('')
      setPriceImpact(0)
    }
  }, [fromToken, toToken, fromAmount, simulateError])
  
  // Gas estimation with error handling
  const estimateGas = async () => {
    if (!fromToken || !toToken || !fromAmount) return
    
    try {
      if (simulateError === 'gas_estimation') {
        throw mockGasError
      }
      
      setGasEstimate('0.005 ETH')
    } catch (err) {
      setError('Failed to estimate gas fees. Transaction may fail.')
      setGasEstimate(null)
    }
  }
  
  React.useEffect(() => {
    estimateGas()
  }, [fromToken, toToken, fromAmount])
  
  const validateSwap = () => {
    const errors: string[] = []
    
    if (!fromToken || !toToken) {
      errors.push('Please select both tokens')
    }
    
    if (!fromAmount || parseFloat(fromAmount) <= 0) {
      errors.push('Please enter a valid amount')
    }
    
    if (parseFloat(fromAmount) > parseFloat(walletBalance)) {
      errors.push('Insufficient balance')
    }
    
    if (priceImpact > 10) {
      errors.push('Price impact too high (>10%)')
    }
    
    if (networkStatus === 'offline') {
      errors.push('No network connection')
    }
    
    return errors
  }
  
  const handleSwap = async () => {
    const validationErrors = validateSwap()
    
    if (validationErrors.length > 0) {
      setError(validationErrors.join('. '))
      return
    }
    
    setError(null)
    setIsLoading(true)
    
    try {
      // Simulate different error scenarios
      switch (simulateError) {
        case 'insufficient_balance':
          throw mockInsufficientBalanceError
        
        case 'network_timeout':
          await new Promise((_, reject) => 
            setTimeout(() => reject(mockTimeoutError), 1000)
          )
          break
        
        case 'slippage':
          throw mockSlippageError
        
        case 'transaction_failed':
          await new Promise(resolve => setTimeout(resolve, 2000))
          throw new Error('Transaction failed: reverted by EVM')
        
        case 'user_rejected':
          throw new Error('User rejected transaction')
        
        case 'gas_limit':
          throw new Error('Transaction would exceed gas limit')
        
        default:
          // Successful swap
          await new Promise(resolve => setTimeout(resolve, 2000))
          setFromAmount('')
          setToAmount('')
          setFromToken(null)
          setToToken(null)
          setGasEstimate(null)
          setPriceImpact(0)
      }
      
    } catch (err: any) {
      let errorMessage = 'Swap failed. Please try again.'
      
      switch (err.name) {
        case 'InsufficientBalanceError':
          errorMessage = 'Insufficient balance to complete this swap'
          break
        case 'NetworkError':
          errorMessage = 'Network error. Please check your connection and try again.'
          break
        case 'TimeoutError':
          errorMessage = 'Request timed out. Please try again.'
          break
        case 'SlippageError':
          errorMessage = 'Price moved unfavorably. Increase slippage tolerance or try again.'
          break
        case 'GasError':
          errorMessage = 'Gas estimation failed. Transaction may be reverted.'
          break
        default:
          if (err.message.includes('User rejected')) {
            errorMessage = 'Transaction was cancelled by user'
          } else if (err.message.includes('gas limit')) {
            errorMessage = 'Transaction would exceed gas limit. Try reducing amount.'
          } else if (err.message.includes('reverted')) {
            errorMessage = 'Transaction failed: smart contract execution reverted'
          }
      }
      
      setError(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }
  
  const handleRetry = () => {
    setError(null)
    setIsLoading(false)
    estimateGas()
  }
  
  return (
    <div data-testid="error-prone-swap-interface">
      <h2>Swap Tokens</h2>
      
      {/* Network Status Indicator */}
      <div data-testid="network-status" className={`status-${networkStatus}`}>
        {networkStatus === 'offline' ? '🔴 Offline' : '🟢 Online'}
      </div>
      
      {/* Error Display */}
      {error && (
        <div data-testid="error-message" className="error">
          <span>{error}</span>
          <button 
            data-testid="retry-button"
            onClick={handleRetry}
            className="retry-btn"
          >
            Retry
          </button>
        </div>
      )}
      
      {/* Balance Display */}
      <div data-testid="wallet-balance">
        Balance: {walletBalance} ETH
      </div>
      
      <div data-testid="swap-form">
        {/* From Section */}
        <div data-testid="from-section">
          <select 
            data-testid="from-token-select"
            value={fromToken?.symbol || ''}
            onChange={(e) => {
              const token = tokens.find(t => t.symbol === e.target.value)
              setFromToken(token || null)
            }}
          >
            <option value="">Select Token</option>
            {tokens.map(token => (
              <option key={token.symbol} value={token.symbol}>
                {token.symbol} - {token.name}
              </option>
            ))}
          </select>
          
          <input
            data-testid="from-amount-input"
            type="number"
            placeholder="0.0"
            value={fromAmount}
            onChange={(e) => setFromAmount(e.target.value)}
          />
        </div>
        
        {/* To Section */}
        <div data-testid="to-section">
          <select 
            data-testid="to-token-select"
            value={toToken?.symbol || ''}
            onChange={(e) => {
              const token = tokens.find(t => t.symbol === e.target.value)
              setToToken(token || null)
            }}
          >
            <option value="">Select Token</option>
            {tokens.map(token => (
              <option key={token.symbol} value={token.symbol}>
                {token.symbol} - {token.name}
              </option>
            ))}
          </select>
          
          <input
            data-testid="to-amount-input"
            type="number"
            placeholder="0.0"
            value={toAmount}
            disabled
            readOnly
          />
        </div>
        
        {/* Price Impact Warning */}
        {priceImpact > 0 && (
          <div 
            data-testid="price-impact-warning"
            className={priceImpact > 5 ? 'warning high' : 'warning low'}
          >
            Price Impact: {priceImpact.toFixed(2)}%
          </div>
        )}
        
        {/* Gas Estimate */}
        {gasEstimate && (
          <div data-testid="gas-estimate">
            Estimated Gas: {gasEstimate}
          </div>
        )}
        
        {/* Swap Button */}
        <button 
          data-testid="execute-swap-button"
          onClick={handleSwap}
          disabled={isLoading || networkStatus === 'offline'}
          className={isLoading ? 'loading' : ''}
        >
          {isLoading ? 'Swapping...' : 'Swap'}
        </button>
      </div>
    </div>
  )
}

describe('Error Handling Flow Tests', () => {
  let user: any

  beforeEach(() => {
    user = userEvent.setup()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Insufficient Balance Errors', () => {
    it('prevents swap when amount exceeds wallet balance', async () => {
      render(<ErrorProneSwapInterface walletBalance="0.5" />)
      
      // Select tokens
      await user.selectOptions(screen.getByTestId('from-token-select'), 'ETH')
      await user.selectOptions(screen.getByTestId('to-token-select'), 'USDC')
      
      // Enter amount greater than balance
      await user.type(screen.getByTestId('from-amount-input'), '1.0')
      
      // Try to swap
      await user.click(screen.getByTestId('execute-swap-button'))
      
      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toHaveTextContent('Insufficient balance')
      })
    })

    it('handles insufficient balance error from blockchain', async () => {
      render(<ErrorProneSwapInterface simulateError="insufficient_balance" walletBalance="10" />)
      
      // Setup valid swap
      await user.selectOptions(screen.getByTestId('from-token-select'), 'ETH')
      await user.selectOptions(screen.getByTestId('to-token-select'), 'USDC')
      await user.type(screen.getByTestId('from-amount-input'), '1.0')
      
      // Execute swap
      await user.click(screen.getByTestId('execute-swap-button'))
      
      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toHaveTextContent('Insufficient balance to complete this swap')
      }, { timeout: 3000 })
    })

    it('provides retry functionality for balance errors', async () => {
      render(<ErrorProneSwapInterface simulateError="insufficient_balance" />)
      
      // Setup and trigger error
      await user.selectOptions(screen.getByTestId('from-token-select'), 'ETH')
      await user.selectOptions(screen.getByTestId('to-token-select'), 'USDC')
      await user.type(screen.getByTestId('from-amount-input'), '1.0')
      await user.click(screen.getByTestId('execute-swap-button'))
      
      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toBeInTheDocument()
      }, { timeout: 3000 })
      
      // Test retry button
      const retryButton = screen.getByTestId('retry-button')
      expect(retryButton).toBeInTheDocument()
      
      await user.click(retryButton)
      
      await waitFor(() => {
        expect(screen.queryByTestId('error-message')).not.toBeInTheDocument()
      })
    })
  })

  describe('Network and Connectivity Errors', () => {
    it('handles network disconnection', async () => {
      render(<ErrorProneSwapInterface simulateError="network" />)
      
      await waitFor(() => {
        expect(screen.getByTestId('network-status')).toHaveTextContent('🔴 Offline')
        expect(screen.getByTestId('error-message')).toHaveTextContent('Network connection lost')
        expect(screen.getByTestId('execute-swap-button')).toBeDisabled()
      })
    })

    it('handles request timeout errors', async () => {
      render(<ErrorProneSwapInterface simulateError="network_timeout" />)
      
      // Setup swap
      await user.selectOptions(screen.getByTestId('from-token-select'), 'ETH')
      await user.selectOptions(screen.getByTestId('to-token-select'), 'USDC')
      await user.type(screen.getByTestId('from-amount-input'), '1.0')
      
      // Execute swap
      await user.click(screen.getByTestId('execute-swap-button'))
      
      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toHaveTextContent('Request timed out')
      }, { timeout: 3000 })
    })

    it('handles price fetch failures', async () => {
      render(<ErrorProneSwapInterface simulateError="price_fetch" />)
      
      // Select tokens to trigger price fetch
      await user.selectOptions(screen.getByTestId('from-token-select'), 'ETH')
      await user.selectOptions(screen.getByTestId('to-token-select'), 'USDC')
      await user.type(screen.getByTestId('from-amount-input'), '1.0')
      
      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toHaveTextContent('Failed to fetch current token prices')
        expect(screen.getByTestId('to-amount-input')).toHaveValue('')
      })
    })
  })

  describe('Transaction and Slippage Errors', () => {
    it('warns about high price impact', async () => {
      render(<ErrorProneSwapInterface />)
      
      // Setup swap with large amount to trigger high price impact
      await user.selectOptions(screen.getByTestId('from-token-select'), 'ETH')
      await user.selectOptions(screen.getByTestId('to-token-select'), 'USDC')
      await user.type(screen.getByTestId('from-amount-input'), '100')
      
      await waitFor(() => {
        expect(screen.getByTestId('price-impact-warning')).toHaveTextContent('Price Impact: 10.00%')
        expect(screen.getByTestId('error-message')).toHaveTextContent('High price impact')
      })
    })

    it('handles slippage tolerance exceeded', async () => {
      render(<ErrorProneSwapInterface simulateError="slippage" />)
      
      // Setup and execute swap
      await user.selectOptions(screen.getByTestId('from-token-select'), 'ETH')
      await user.selectOptions(screen.getByTestId('to-token-select'), 'USDC')
      await user.type(screen.getByTestId('from-amount-input'), '1.0')
      await user.click(screen.getByTestId('execute-swap-button'))
      
      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toHaveTextContent('Price moved unfavorably')
      }, { timeout: 3000 })
    })

    it('handles transaction failure', async () => {
      render(<ErrorProneSwapInterface simulateError="transaction_failed" />)
      
      // Setup and execute swap
      await user.selectOptions(screen.getByTestId('from-token-select'), 'ETH')
      await user.selectOptions(screen.getByTestId('to-token-select'), 'USDC')
      await user.type(screen.getByTestId('from-amount-input'), '1.0')
      await user.click(screen.getByTestId('execute-swap-button'))
      
      // Verify loading state
      expect(screen.getByTestId('execute-swap-button')).toHaveTextContent('Swapping...')
      
      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toHaveTextContent('smart contract execution reverted')
      }, { timeout: 3000 })
    })

    it('handles user rejection', async () => {
      render(<ErrorProneSwapInterface simulateError="user_rejected" />)
      
      // Setup and execute swap
      await user.selectOptions(screen.getByTestId('from-token-select'), 'ETH')
      await user.selectOptions(screen.getByTestId('to-token-select'), 'USDC')
      await user.type(screen.getByTestId('from-amount-input'), '1.0')
      await user.click(screen.getByTestId('execute-swap-button'))
      
      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toHaveTextContent('Transaction was cancelled by user')
      }, { timeout: 3000 })
    })
  })

  describe('Gas and Fee Errors', () => {
    it('handles gas estimation failures', async () => {
      render(<ErrorProneSwapInterface simulateError="gas_estimation" />)
      
      // Setup swap to trigger gas estimation
      await user.selectOptions(screen.getByTestId('from-token-select'), 'ETH')
      await user.selectOptions(screen.getByTestId('to-token-select'), 'USDC')
      await user.type(screen.getByTestId('from-amount-input'), '1.0')
      
      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toHaveTextContent('Failed to estimate gas fees')
        expect(screen.queryByTestId('gas-estimate')).not.toBeInTheDocument()
      })
    })

    it('handles gas limit exceeded', async () => {
      render(<ErrorProneSwapInterface simulateError="gas_limit" />)
      
      // Setup and execute swap
      await user.selectOptions(screen.getByTestId('from-token-select'), 'ETH')
      await user.selectOptions(screen.getByTestId('to-token-select'), 'USDC')
      await user.type(screen.getByTestId('from-amount-input'), '1.0')
      await user.click(screen.getByTestId('execute-swap-button'))
      
      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toHaveTextContent('Transaction would exceed gas limit')
      }, { timeout: 3000 })
    })

    it('displays gas estimates when available', async () => {
      render(<ErrorProneSwapInterface />)
      
      // Setup swap
      await user.selectOptions(screen.getByTestId('from-token-select'), 'ETH')
      await user.selectOptions(screen.getByTestId('to-token-select'), 'USDC')
      await user.type(screen.getByTestId('from-amount-input'), '1.0')
      
      await waitFor(() => {
        expect(screen.getByTestId('gas-estimate')).toHaveTextContent('Estimated Gas: 0.005 ETH')
      })
    })
  })

  describe('Input Validation Errors', () => {
    it('validates token selection', async () => {
      render(<ErrorProneSwapInterface />)
      
      // Try to swap without selecting tokens
      await user.type(screen.getByTestId('from-amount-input'), '1.0')
      await user.click(screen.getByTestId('execute-swap-button'))
      
      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toHaveTextContent('Please select both tokens')
      })
    })

    it('validates amount input', async () => {
      render(<ErrorProneSwapInterface />)
      
      // Select tokens but no amount
      await user.selectOptions(screen.getByTestId('from-token-select'), 'ETH')
      await user.selectOptions(screen.getByTestId('to-token-select'), 'USDC')
      await user.click(screen.getByTestId('execute-swap-button'))
      
      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toHaveTextContent('Please enter a valid amount')
      })
    })

    it('validates negative amounts', async () => {
      render(<ErrorProneSwapInterface />)
      
      // Enter negative amount
      await user.selectOptions(screen.getByTestId('from-token-select'), 'ETH')
      await user.selectOptions(screen.getByTestId('to-token-select'), 'USDC')
      await user.type(screen.getByTestId('from-amount-input'), '-1')
      await user.click(screen.getByTestId('execute-swap-button'))
      
      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toHaveTextContent('Please enter a valid amount')
      })
    })
  })

  describe('Error Recovery and UX', () => {
    it('clears errors when user fixes input', async () => {
      render(<ErrorProneSwapInterface />)
      
      // Trigger validation error
      await user.click(screen.getByTestId('execute-swap-button'))
      
      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toBeInTheDocument()
      })
      
      // Fix the error by selecting tokens
      await user.selectOptions(screen.getByTestId('from-token-select'), 'ETH')
      await user.selectOptions(screen.getByTestId('to-token-select'), 'USDC')
      await user.type(screen.getByTestId('from-amount-input'), '1.0')
      
      // Error should clear when retry is clicked
      await user.click(screen.getByTestId('retry-button'))
      
      await waitFor(() => {
        expect(screen.queryByTestId('error-message')).not.toBeInTheDocument()
      })
    })

    it('maintains form state during error recovery', async () => {
      render(<ErrorProneSwapInterface simulateError="network_timeout" />)
      
      // Setup form
      await user.selectOptions(screen.getByTestId('from-token-select'), 'ETH')
      await user.selectOptions(screen.getByTestId('to-token-select'), 'USDC')
      await user.type(screen.getByTestId('from-amount-input'), '1.0')
      
      // Trigger error
      await user.click(screen.getByTestId('execute-swap-button'))
      
      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toBeInTheDocument()
      }, { timeout: 3000 })
      
      // Verify form state is maintained
      expect(screen.getByTestId('from-token-select')).toHaveValue('ETH')
      expect(screen.getByTestId('to-token-select')).toHaveValue('USDC')
      expect(screen.getByTestId('from-amount-input')).toHaveValue('1')
    })

    it('provides appropriate loading states during operations', async () => {
      render(<ErrorProneSwapInterface simulateError="transaction_failed" />)
      
      // Setup and execute swap
      await user.selectOptions(screen.getByTestId('from-token-select'), 'ETH')
      await user.selectOptions(screen.getByTestId('to-token-select'), 'USDC')
      await user.type(screen.getByTestId('from-amount-input'), '1.0')
      
      await user.click(screen.getByTestId('execute-swap-button'))
      
      // Verify loading state
      expect(screen.getByTestId('execute-swap-button')).toHaveTextContent('Swapping...')
      expect(screen.getByTestId('execute-swap-button')).toBeDisabled()
      
      // Wait for error and verify button is re-enabled
      await waitFor(() => {
        expect(screen.getByTestId('execute-swap-button')).toHaveTextContent('Swap')
        expect(screen.getByTestId('execute-swap-button')).not.toBeDisabled()
      }, { timeout: 3000 })
    })
  })

  describe('Multiple Error Scenarios', () => {
    it('handles multiple validation errors simultaneously', async () => {
      render(<ErrorProneSwapInterface walletBalance="0.1" />)
      
      // Setup scenario with multiple errors
      await user.type(screen.getByTestId('from-amount-input'), '100') // Exceeds balance
      await user.click(screen.getByTestId('execute-swap-button'))
      
      await waitFor(() => {
        const errorMessage = screen.getByTestId('error-message').textContent
        expect(errorMessage).toContain('Please select both tokens')
        expect(errorMessage).toContain('Insufficient balance')
      })
    })

    it('prioritizes critical errors over warnings', async () => {
      render(<ErrorProneSwapInterface simulateError="network" />)
      
      // Setup swap that would normally show price impact warning
      await user.selectOptions(screen.getByTestId('from-token-select'), 'ETH')
      await user.selectOptions(screen.getByTestId('to-token-select'), 'USDC')
      await user.type(screen.getByTestId('from-amount-input'), '100')
      
      // Network error should take precedence
      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toHaveTextContent('Network connection lost')
      })
    })
  })
})