import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { Route as LimitRoute } from '../src/routes/trade/limit'
import { useAccount } from 'wagmi'

const LimitPage = LimitRoute.component as any

describe('LimitPage', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('renders connect wallet button when not connected', () => {
        (useAccount as Mock).mockReturnValue({ isConnected: false })
        render(<LimitPage />)

        expect(screen.getAllByText('Connect Wallet')).toHaveLength(2) // Header + Body
    })

    it('renders place limit order button when connected', () => {
        (useAccount as Mock).mockReturnValue({ isConnected: true, address: '0x123...' })
        render(<LimitPage />)

        expect(screen.getByText('Place Limit Order')).toBeInTheDocument()
    })

    it('updates limit order inputs', () => {
        (useAccount as Mock).mockReturnValue({ isConnected: true })
        render(<LimitPage />)

        const amountInput = screen.getAllByPlaceholderText('0')[0]
        const priceInput = screen.getByPlaceholderText('0.00')

        fireEvent.change(amountInput, { target: { value: '2' } })
        fireEvent.change(priceInput, { target: { value: '1500' } })

        expect(amountInput).toHaveValue('2')
        expect(priceInput).toHaveValue('1500')
    })
})
