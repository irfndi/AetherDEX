import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Route as BuyRoute } from '../src/routes/trade/buy'

const BuyPage = BuyRoute.component as any

describe('BuyPage', () => {
    it('renders buy crypto header', () => {
        render(<BuyPage />)
        expect(screen.getByText('Buy Crypto')).toBeInTheDocument()
    })

    it('updates amount input', () => {
        render(<BuyPage />)
        const input = screen.getByPlaceholderText('0')
        fireEvent.change(input, { target: { value: '100' } })
        expect(input).toHaveValue('100')
    })

    it('renders continue button', () => {
        render(<BuyPage />)
        expect(screen.getByText('Continue to Payment')).toBeInTheDocument()
    })
})
