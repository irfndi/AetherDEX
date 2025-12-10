import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { Route as SwapRoute } from '../src/routes/trade/swap'
import { useAccount, useConnect, useWriteContract, useDisconnect } from 'wagmi'
import { useTokens, useSwapQuote } from '../src/hooks/use-api'
import React from 'react'

// Removed local mocks to rely on setup.ts

// Helper to get component from Route
const SwapPage = SwapRoute.component as React.ComponentType

describe('SwapPage', () => {
    const mockConnect = vi.fn()
    const mockDisconnect = vi.fn()
    const mockWriteContract = vi.fn()

    beforeEach(() => {
        vi.clearAllMocks();

        // Default mock implementations
        (useAccount as Mock).mockReturnValue({ isConnected: false, address: undefined });
        (useConnect as Mock).mockReturnValue({
            connectors: [{ name: 'Injected' }], // Default to having a connector available
            connect: mockConnect
        });
        (useDisconnect as Mock).mockReturnValue({ disconnect: mockDisconnect });
        (useWriteContract as Mock).mockReturnValue({ writeContract: mockWriteContract, isPending: false });

        (useTokens as Mock).mockReturnValue({
            data: [
                { symbol: 'ETH', name: 'Ethereum', address: '0x1' },
                { symbol: 'USDC', name: 'USD Coin', address: '0x2' }
            ],
            isLoading: false
        });

        (useSwapQuote as Mock).mockReturnValue({
            data: null,
            isLoading: false,
            error: null
        });
    })

    it('renders connect wallet button when not connected', () => {
        render(<SwapPage />)

        expect(screen.getByText('Connect Wallet to Swap')).toBeInTheDocument()
    })

    it('renders swap interface when connected', () => {
        (useAccount as Mock).mockReturnValue({ isConnected: true, address: '0x123...456' })
        render(<SwapPage />)

        expect(screen.getByRole('button', { name: 'Swap' })).toBeInTheDocument()
        expect(screen.queryByText('Connect Wallet to Swap')).not.toBeInTheDocument()
    })

    it('calls connect when connect button clicked', () => {
        render(<SwapPage />)

        const connectButton = screen.getByText('Connect Wallet to Swap')
        fireEvent.click(connectButton)

        expect(mockConnect).toHaveBeenCalled()
    })

    it('updates input values and fetches quote', async () => {
        (useAccount as Mock).mockReturnValue({ isConnected: true, address: '0x123' })

        // Mock quote response
        const mockQuote = {
            amount_out: '3000',
            min_amount_out: '2990',
            price_impact: '0.1',
            fee: '0.003',
            fee_rate: '0.003'
        };

        (useSwapQuote as Mock).mockReturnValue({
            data: mockQuote,
            isLoading: false
        });

        render(<SwapPage />)

        const inputs = screen.getAllByPlaceholderText('0')
        fireEvent.change(inputs[0], { target: { value: '1.5' } }) // Sell input

        expect(inputs[0]).toHaveValue('1.5')

        // Since we mocked useSwapQuote to return data, it should display the output
        expect(screen.getByText('3000')).toBeInTheDocument()
        expect(screen.getByText(/Price Impact: 0.1%/)).toBeInTheDocument()
    })

    it('executes swap transaction', () => {
        (useAccount as Mock).mockReturnValue({ isConnected: true, address: '0x123' });

        // Mock valid quote so swap is enabled
        (useSwapQuote as Mock).mockReturnValue({
            data: { min_amount_out: '2990', amount_out: '3000', fee_rate: '0.003', fee: '0.009' },
            isLoading: false
        });

        render(<SwapPage />)

        const inputs = screen.getAllByPlaceholderText('0')
        fireEvent.change(inputs[0], { target: { value: '1' } })

        const swapButton = screen.getByRole('button', { name: 'Swap' })
        fireEvent.click(swapButton)

        expect(mockWriteContract).toHaveBeenCalled()
    })

    it('opens token selector and selects a token', () => {
        (useAccount as Mock).mockReturnValue({ isConnected: true })

        render(<SwapPage />)

        // Find the sell token selector (default is ETH in implementation, but let's check what we mock)
        // In implementation: selectedSellToken defaults to "ETH" if not passed? 
        // Actually we refactored it to use Token objects.

        // The UI shows "Select" if no token, or the symbol.
        // Let's assume default state from logic.

        const selectors = screen.getAllByRole('button').filter(b => b.querySelector('.bg-gradient-to-br'))
        // Click the first one (Sell side)
        fireEvent.click(selectors[0])

        // Check if modal opened
        expect(screen.getByText('Select sell token')).toBeInTheDocument()

        // Select USDC from the list (it might appear in the buttons too)
        // The list items are buttons.
        const usdcOptions = screen.getAllByText('USDC')
        // The modal should be on top, so the last one probably? 
        // Or finding the specific button in the list.
        fireEvent.click(usdcOptions[usdcOptions.length - 1])

        // Check if modal closed
        expect(screen.queryByText('Select sell token')).not.toBeInTheDocument()
    })
})

