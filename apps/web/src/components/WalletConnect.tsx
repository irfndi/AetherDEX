import { useAppKit } from "@reown/appkit/react"
import { useAccount, useChainId, useChains, useDisconnect, useEnsName, useSwitchChain } from "wagmi"
import { Address } from "./Address"

export function WalletConnect() {
  const { open } = useAppKit()
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()
  const { data: ensName } = useEnsName({ address })
  const chainId = useChainId()
  const chains = useChains()
  const { mutate: switchChain } = useSwitchChain()

  if (!isConnected) {
    return (
      <button type="button" onClick={() => open()} className="btn btn-primary btn-sm">
        Connect Wallet
      </button>
    )
  }

  return (
    <div className="dropdown dropdown-end">
      <button type="button" tabIndex={0} className="btn btn-ghost btn-sm gap-2">
        {ensName ?? <Address address={address ?? ""} />}
        <span className="badge badge-primary badge-sm">{chainId}</span>
      </button>
      <ul className="dropdown-content menu bg-base-200 rounded-box z-10 w-52 p-2 shadow">
        <li className="menu-title">Switch Network</li>
        {chains.map((chain) => (
          <li key={chain.id}>
            <button
              type="button"
              onClick={() => switchChain({ chainId: chain.id })}
              className={chainId === chain.id ? "active" : ""}
            >
              {chain.name}
            </button>
          </li>
        ))}
        <div className="divider my-1" />
        <li>
          <button type="button" onClick={() => disconnect()} className="text-error">
            Disconnect
          </button>
        </li>
      </ul>
    </div>
  )
}
