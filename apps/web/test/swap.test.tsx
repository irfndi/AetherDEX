import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { Route as SwapRoute } from '../src/routes/trade/swap'
import { useAccount, useConnect, useWriteContract } from 'wagmi'

// Helper to get component from Route
const SwapPage = SwapRoute as any

describe('SwapPage', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('renders connect wallet button when not connected', () => {
        (useAccount as Mock).mockReturnValue({ isConnected: false, address: undefined })
        render(<SwapPage />)

        expect(screen.getByText('Connect Wallet')).toBeInTheDocument()
        expect(screen.getByText('Connect Wallet to Swap')).toBeInTheDocument()
    })

    it('renders swap interface when connected', () => {
        (useAccount as Mock).mockReturnValue({ isConnected: true, address: '0x123...456' })
        render(<SwapPage />)

        // Check for the Swap button specifically
        expect(screen.getByRole('button', { name: 'Swap' })).toBeInTheDocument()
        // Should not show the connect message button
        expect(screen.queryByText('Connect Wallet to Swap')).not.toBeInTheDocument()
    })

    it('calls connect when connect button clicked', () => {
        const connectMock = vi.fn();
        (useAccount as Mock).mockReturnValue({ isConnected: false });
        (useConnect as Mock).mockReturnValue({
            connectors: [{ name: 'Injected' }],
            connect: connectMock
        })

        render(<SwapPage />)

        const connectButton = screen.getAllByText('Connect Wallet')[0]
        fireEvent.click(connectButton)

        expect(connectMock).toHaveBeenCalled()
    })

    it('updates input values', () => {
        (useAccount as Mock).mockReturnValue({ isConnected: true })
        render(<SwapPage />)

        const inputs = screen.getAllByPlaceholderText('0')
        fireEvent.change(inputs[0], { target: { value: '1.5' } })
        fireEvent.change(inputs[1], { target: { value: '3000' } })

        expect(inputs[0]).toHaveValue('1.5')
        expect(inputs[1]).toHaveValue('3000')
    })

    it('executes swap transaction', () => {
        const writeContractMock = vi.fn();
        (useAccount as Mock).mockReturnValue({ isConnected: true, address: '0x123' });

        (useWriteContract as Mock).mockReturnValue({ writeContract: writeContractMock, isPending: false });

        render(<SwapPage />)

        const inputs = screen.getAllByPlaceholderText('0')
        fireEvent.change(inputs[0], { target: { value: '1' } })
        fireEvent.change(inputs[1], { target: { value: '2000' } })

        const swapButton = screen.getByRole('button', { name: 'Swap' })
        fireEvent.click(swapButton)

        expect(writeContractMock).toHaveBeenCalled()
    })
})
