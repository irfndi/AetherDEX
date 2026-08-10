export type ProtectedRpcHash = `0x${string}`

export async function submitProtectedRawTransaction(input: {
  readonly rpcUrl: string
  readonly signedTransaction: `0x${string}`
  readonly timeoutMs?: number
}): Promise<ProtectedRpcHash> {
  if (!/^https:\/\//.test(input.rpcUrl)) throw new Error("Protected submission requires an HTTPS private RPC URL")

  let response: Response
  try {
    response = await fetch(input.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_sendRawTransaction",
        params: [input.signedTransaction],
      }),
      signal: AbortSignal.timeout(input.timeoutMs ?? 15_000),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error("Protected submission timed out; the private RPC did not respond")
    }
    throw error
  }
  if (!response.ok) throw new Error(`Protected submission failed with HTTP ${response.status}`)
  let result: { readonly error?: { readonly message?: string }; readonly result?: string }
  try {
    result = (await response.json()) as { readonly error?: { readonly message?: string }; readonly result?: string }
  } catch {
    throw new Error("Protected submission returned an invalid RPC response")
  }
  if (result.error) throw new Error(result.error.message ?? "Protected submission was rejected")
  if (!result.result || !/^0x[0-9a-fA-F]{64}$/.test(result.result)) {
    throw new Error("Protected submission returned an invalid transaction hash")
  }
  return result.result as ProtectedRpcHash
}
