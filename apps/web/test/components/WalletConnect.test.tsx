import { useAppKit } from "@reown/appkit/react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useAccount, useChainId, useChains, useDisconnect, useEnsName, useSwitchChain } from "wagmi"
import { WalletConnect } from "../../src/components/WalletConnect"

vi.mock("@reown/appkit/react", () => ({ useAppKit: vi.fn() }))
vi.mock("wagmi", () => ({
  useAccount: vi.fn(),
  useChainId: vi.fn(),
  useChains: vi.fn(),
  useDisconnect: vi.fn(),
  useEnsName: vi.fn(),
  useSwitchChain: vi.fn(),
}))

const open = vi.fn()
const switchChain = vi.fn()
const disconnect = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useAppKit).mockReturnValue({ open } as never)
  vi.mocked(useAccount).mockReturnValue({ address: undefined, isConnected: false } as never)
  vi.mocked(useChainId).mockReturnValue(1)
  vi.mocked(useChains).mockReturnValue([
    { id: 1, name: "Ethereum" },
    { id: 137, name: "Polygon" },
  ] as never)
  vi.mocked(useDisconnect).mockReturnValue({ disconnect, error: null, isPending: false } as never)
  vi.mocked(useEnsName).mockReturnValue({ data: null } as never)
  vi.mocked(useSwitchChain).mockReturnValue({ mutate: switchChain, error: null, isPending: false } as never)
})

function renderConnected() {
  vi.mocked(useAccount).mockReturnValue({ address: "0xabc", isConnected: true } as never)
  render(<WalletConnect />)
}

describe("WalletConnect", () => {
  it("shows Connect Wallet and opens the app kit modal when disconnected", async () => {
    const user = userEvent.setup()
    render(<WalletConnect />)

    await user.click(screen.getByText("Connect Wallet"))

    expect(open).toHaveBeenCalledTimes(1)
  })

  it("renders the address and network list when connected", () => {
    renderConnected()

    expect(screen.getByText("0xabc")).toBeDefined()
    expect(screen.getByText("Ethereum")).toBeDefined()
    expect(screen.getByText("Polygon")).toBeDefined()
  })

  it("switches only to non-active chains", async () => {
    const user = userEvent.setup()
    renderConnected()

    const active = screen.getByText("Ethereum")
    expect(active.closest("button")?.disabled).toBe(true)
    await user.click(active)
    expect(switchChain).not.toHaveBeenCalled()

    await user.click(screen.getByText("Polygon"))
    expect(switchChain).toHaveBeenCalledTimes(1)
    expect(switchChain).toHaveBeenCalledWith({ chainId: 137 })
  })

  it("shows an inline error when switching chains fails", () => {
    vi.mocked(useSwitchChain).mockReturnValue({
      mutate: switchChain,
      error: new Error("User rejected request"),
      isPending: false,
    } as never)
    renderConnected()

    expect(screen.getByRole("alert")).toHaveTextContent("User rejected request")
  })

  it("shows a pending state while switching", () => {
    vi.mocked(useSwitchChain).mockReturnValue({ mutate: switchChain, error: null, isPending: true } as never)
    renderConnected()

    expect(screen.getByText("Switching...")).toBeDefined()
  })

  it("disconnects the wallet", async () => {
    const user = userEvent.setup()
    renderConnected()

    await user.click(screen.getByText("Disconnect"))

    expect(disconnect).toHaveBeenCalledTimes(1)
  })
})
