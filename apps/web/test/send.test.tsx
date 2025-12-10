import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { Route as SendRoute } from '../src/routes/trade/send'
import { useAccount, useSendTransaction } from 'wagmi'

const SendPage = SendRoute as any

describe('SendPage', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('renders connect wallet button when not connected', () => {
        (useAccount as Mock).mockReturnValue({ isConnected: false })
        render(<SendPage />)

        expect(screen.getAllByText('Connect Wallet')).toHaveLength(2)
    })

    it('renders send button when connected', () => {
        (useAccount as Mock).mockReturnValue({ isConnected: true, address: '0x123...' })
        render(<SendPage />)

        expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
    })

    it('updates recipient and amount', () => {
        (useAccount as Mock).mockReturnValue({ isConnected: true })
        render(<SendPage />)

        const recipientInput = screen.getByPlaceholderText('0x... or ENS name')
        const amountInput = screen.getByPlaceholderText('0')

        fireEvent.change(recipientInput, { target: { value: '0xABC' } })
        fireEvent.change(amountInput, { target: { value: '1.5' } })

        expect(recipientInput).toHaveValue('0xABC')
        expect(amountInput).toHaveValue('1.5')
    })

    it('calls sendTransaction when send button clicked', () => {
        const sendTransactionMock = vi.fn();
        (useSendTransaction as Mock).mockReturnValue({ sendTransaction: sendTransactionMock, isPending: false });

        (useAccount as Mock).mockReturnValue({ isConnected: true })
        render(<SendPage />)

        const recipientInput = screen.getByPlaceholderText('0x... or ENS name')
        const amountInput = screen.getByPlaceholderText('0')

        fireEvent.change(recipientInput, { target: { value: '0xABC' } })
        fireEvent.change(amountInput, { target: { value: '1.5' } })

        const sendButton = screen.getByRole('button', { name: 'Send' })
        fireEvent.click(sendButton)

        expect(sendTransactionMock).toHaveBeenCalled()
    })
})
