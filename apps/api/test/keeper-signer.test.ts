/**
 * Keeper relayer (src/lib/keeper-signer.ts) — offline unit tests:
 * config parsing with safe defaults, authorization policy helpers, MEV Tier-B
 * private-relay submission via mocked fetch, explicit public opt-in, and the
 * balance / gas / chain preflight guards. No network access.
 */

import { parseEther, parseGwei, toFunctionSelector } from "viem"
import { describe, expect, it, vi } from "vitest"
import {
  canExecuteRecenter,
  canExecuteTpSlOrder,
  createKeeperSigner,
  encodeExecuteOrder,
  GasPriceExceededError,
  InsufficientKeeperBalanceError,
  isTransientKeeperError,
  KeeperChainMismatchError,
  KeeperRelayError,
  KeeperRpcError,
  type KeeperSignerEnv,
  parseRelayUrl,
  readKeeperSignerConfig,
  resolveTpslAddress,
} from "../src/lib/keeper-signer"

const TEST_PRIVATE_KEY = `0x${"11".repeat(32)}`
const TEST_ADDRESS = "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A"
const RELAY_URL = "https://relay.example/submit"
const TX_HASH = `0x${"ab".repeat(32)}`

const baseEnv: KeeperSignerEnv = {
  CHAIN_ID: "11155111",
  KEEPER_PRIVATE_KEY: TEST_PRIVATE_KEY,
  KEEPER_RPC_URL: "https://rpc.example/v1",
}

const makeChainStub = (overrides: Record<string, unknown> = {}) => ({
  getBalance: async () => parseEther("1"),
  getTransactionCount: async () => 7,
  estimateGas: async () => 120_000n,
  getGasPrice: async () => parseGwei("2"),
  ...overrides,
})

const makeRelaySigner = (envOverrides: KeeperSignerEnv = {}, chainOverrides: Record<string, unknown> = {}) => {
  const fetchMock = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: TX_HASH })),
  )
  const signer = createKeeperSigner(
    readKeeperSignerConfig({ ...baseEnv, PRIVATE_TX_RELAY_URL: RELAY_URL, ...envOverrides }),
    { publicClient: makeChainStub(chainOverrides), fetchFn: fetchMock },
  )
  return { signer, fetchMock }
}

describe("readKeeperSignerConfig", () => {
  it("degrades to safe defaults when nothing is configured", () => {
    const config = readKeeperSignerConfig({})
    expect(config.chainId).toBeNull()
    expect(config.privateKey).toBeNull()
    expect(config.rpcUrl).toBeNull()
    expect(config.maxGasPriceGwei).toBeNull()
    expect(config.minBalanceWei).toBe(parseEther("0.05"))
    expect(config.privateRelayUrl).toBeNull()
    expect(config.allowPublicSubmission).toBe(false)
    expect(config.tpslAddress).toBeNull()
  })

  it("normalizes private keys (accepts missing 0x prefix, lowercases)", () => {
    const config = readKeeperSignerConfig({
      KEEPER_PRIVATE_KEY: "11".repeat(32),
    })
    expect(config.privateKey).toBe(TEST_PRIVATE_KEY)
  })

  it("rejects malformed private keys", () => {
    expect(readKeeperSignerConfig({ KEEPER_PRIVATE_KEY: "0x1234" }).privateKey).toBeNull()
    expect(readKeeperSignerConfig({ KEEPER_PRIVATE_KEY: "not-a-key" }).privateKey).toBeNull()
  })

  it("accepts only https relay URLs", () => {
    expect(parseRelayUrl("https://relay.example/submit")).toBe("https://relay.example/submit")
    expect(parseRelayUrl("http://relay.example/submit")).toBeNull()
    expect(parseRelayUrl("ws://relay.example")).toBeNull()
    expect(parseRelayUrl("not a url")).toBeNull()
    expect(parseRelayUrl("   ")).toBeNull()
    expect(readKeeperSignerConfig({ PRIVATE_TX_RELAY_URL: "http://insecure.example" }).privateRelayUrl).toBeNull()
  })

  it("only enables public submission on an explicit 'true'", () => {
    expect(readKeeperSignerConfig({ KEEPER_ALLOW_PUBLIC_SUBMISSION: "true" }).allowPublicSubmission).toBe(true)
    expect(readKeeperSignerConfig({ KEEPER_ALLOW_PUBLIC_SUBMISSION: " TRUE " }).allowPublicSubmission).toBe(true)
    expect(readKeeperSignerConfig({ KEEPER_ALLOW_PUBLIC_SUBMISSION: "false" }).allowPublicSubmission).toBe(false)
    expect(readKeeperSignerConfig({ KEEPER_ALLOW_PUBLIC_SUBMISSION: "1" }).allowPublicSubmission).toBe(false)
    expect(readKeeperSignerConfig({}).allowPublicSubmission).toBe(false)
  })

  it("parses the gas funding floor and falls back to 0.05 ETH on garbage", () => {
    expect(readKeeperSignerConfig({ KEEPER_MIN_BALANCE_ETH: "0.2" }).minBalanceWei).toBe(parseEther("0.2"))
    expect(readKeeperSignerConfig({ KEEPER_MIN_BALANCE_ETH: "abc" }).minBalanceWei).toBe(parseEther("0.05"))
    expect(readKeeperSignerConfig({ KEEPER_MIN_BALANCE_ETH: "-1" }).minBalanceWei).toBe(parseEther("0.05"))
  })

  it("parses the gas price ceiling", () => {
    expect(readKeeperSignerConfig({ KEEPER_MAX_GAS_PRICE_GWEI: "25" }).maxGasPriceGwei).toBe(25)
    expect(readKeeperSignerConfig({ KEEPER_MAX_GAS_PRICE_GWEI: "-5" }).maxGasPriceGwei).toBeNull()
    expect(readKeeperSignerConfig({}).maxGasPriceGwei).toBeNull()
  })

  it("resolves the TPSL address (TPSL_ADDRESS wins, invalid rejected)", () => {
    const good = "0x1111111111111111111111111111111111111111"
    const other = "0x2222222222222222222222222222222222222222"
    expect(resolveTpslAddress({ TPSL_ADDRESS: good, AETHER_TPSL_ADDRESS: other })).toBe(good)
    expect(resolveTpslAddress({ AETHER_TPSL_ADDRESS: other })).toBe(other)
    expect(resolveTpslAddress({ TPSL_ADDRESS: "0xnope", AETHER_TPSL_ADDRESS: "also-nope" })).toBeNull()
    expect(resolveTpslAddress({})).toBeNull()
  })

  it("parses the chain id defensively", () => {
    expect(readKeeperSignerConfig({ CHAIN_ID: "11155111" }).chainId).toBe(11155111)
    expect(readKeeperSignerConfig({ CHAIN_ID: "0" }).chainId).toBeNull()
    expect(readKeeperSignerConfig({ CHAIN_ID: "abc" }).chainId).toBeNull()
  })
})

describe("authorization policy helpers", () => {
  const now = 1_700_000_000_000
  const base = {
    status: "pending",
    deadline: now + 60_000,
    chainId: 11155111,
    amountIn: "1000",
  }
  const policy = { expectedChainId: 11155111 }

  it("authorizes a pending, unexpired, chain-matched order", () => {
    expect(canExecuteTpSlOrder(base, policy, now)).toBe(true)
  })

  it("rejects anything not pending", () => {
    expect(canExecuteTpSlOrder({ ...base, status: "triggered" }, policy, now)).toBe(false)
    expect(canExecuteTpSlOrder({ ...base, status: "executed" }, policy, now)).toBe(false)
    expect(canExecuteTpSlOrder({ ...base, status: "cancelled" }, policy, now)).toBe(false)
  })

  it("rejects expired deadlines", () => {
    expect(canExecuteTpSlOrder({ ...base, deadline: now }, policy, now)).toBe(false)
    expect(canExecuteTpSlOrder({ ...base, deadline: now - 1 }, policy, now)).toBe(false)
    expect(canExecuteTpSlOrder({ ...base, deadline: Number.NaN }, policy, now)).toBe(false)
  })

  it("rejects chain mismatches", () => {
    expect(canExecuteTpSlOrder(base, { expectedChainId: 1 }, now)).toBe(false)
    expect(canExecuteTpSlOrder({ ...base, chainId: 1.5 }, policy, now)).toBe(false)
  })

  it("enforces the amount cap when the policy carries one", () => {
    expect(canExecuteTpSlOrder(base, { ...policy, maxAmountIn: 500n }, now)).toBe(false)
    expect(canExecuteTpSlOrder(base, { ...policy, maxAmountIn: 1000n }, now)).toBe(true)
    expect(canExecuteTpSlOrder(base, { ...policy, maxAmountIn: 5000n }, now)).toBe(true)
    expect(canExecuteTpSlOrder({ ...base, amountIn: "xyz" }, { ...policy, maxAmountIn: 5000n }, now)).toBe(false)
  })

  it("authorizes recenter only for active policies", () => {
    expect(canExecuteRecenter({ isActive: true })).toBe(true)
    expect(canExecuteRecenter({ isActive: 1 })).toBe(true)
    expect(canExecuteRecenter({ isActive: false })).toBe(false)
    expect(canExecuteRecenter({ isActive: 0 })).toBe(false)
  })
})

describe("createKeeperSigner channel selection", () => {
  it("stays evaluation-only without a private key", async () => {
    const signer = createKeeperSigner(readKeeperSignerConfig({ ...baseEnv, KEEPER_PRIVATE_KEY: undefined }))
    expect(signer.channel).toBe("evaluation-only")
    expect(signer.address).toBeNull()
    expect(await signer.sendTransaction({ to: "0x1111111111111111111111111111111111111111", data: "0x" })).toEqual({
      kind: "submission-disabled",
      reason: expect.stringContaining("KEEPER_PRIVATE_KEY"),
    })
  })

  it("stays evaluation-only without an RPC URL", async () => {
    const signer = createKeeperSigner(readKeeperSignerConfig({ ...baseEnv, KEEPER_RPC_URL: undefined }))
    expect(signer.channel).toBe("evaluation-only")
    expect(await signer.sendTransaction({ to: "0x1111111111111111111111111111111111111111", data: "0x" })).toEqual({
      kind: "submission-disabled",
      reason: expect.stringContaining("KEEPER_RPC_URL"),
    })
  })

  it("stays evaluation-only without a chain id (no chain-scoped signing)", async () => {
    const signer = createKeeperSigner(readKeeperSignerConfig({ ...baseEnv, CHAIN_ID: undefined }))
    expect(signer.channel).toBe("evaluation-only")
  })

  it("defaults to evaluation-only when neither relay nor public opt-in is present", async () => {
    const signer = createKeeperSigner(readKeeperSignerConfig(baseEnv))
    expect(signer.channel).toBe("evaluation-only")
    expect(signer.address).toBe(TEST_ADDRESS)
    expect(
      await signer.sendTransaction({ to: "0x1111111111111111111111111111111111111111", data: "0x" }),
    ).toMatchObject({
      kind: "submission-disabled",
    })
  })

  it("selects the private relay channel when PRIVATE_TX_RELAY_URL is https", () => {
    const signer = createKeeperSigner(readKeeperSignerConfig({ ...baseEnv, PRIVATE_TX_RELAY_URL: RELAY_URL }))
    expect(signer.channel).toBe("private-relay")
    expect(signer.address).toBe(TEST_ADDRESS)
  })

  it("selects the public channel only on explicit opt-in", () => {
    const signer = createKeeperSigner(readKeeperSignerConfig({ ...baseEnv, KEEPER_ALLOW_PUBLIC_SUBMISSION: "true" }))
    expect(signer.channel).toBe("public")
  })
})

describe("private relay submission (mocked fetch)", () => {
  it("signs locally and POSTs eth_sendRawTransaction to the https relay", async () => {
    const { signer, fetchMock } = makeRelaySigner()

    const result = await signer.sendTransaction({
      to: "0x1111111111111111111111111111111111111111",
      data: "0xabcdef",
      chainId: 11155111,
    })

    expect(result).toEqual({ kind: "submitted", channel: "private-relay", txHash: TX_HASH })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(RELAY_URL)
    expect(new URL(String(url)).protocol).toBe("https:")
    expect(init?.method).toBe("POST")
    expect(init?.headers).toMatchObject({ "content-type": "application/json" })

    const body = JSON.parse(String(init?.body)) as { jsonrpc: string; method: string; params: string[] }
    expect(body.jsonrpc).toBe("2.0")
    expect(body.method).toBe("eth_sendRawTransaction")
    expect(body.params).toHaveLength(1)
    expect(body.params[0]).toMatch(/^0x[0-9a-fA-F]{2,}$/)
  })

  it("never sends to a non-https relay (config rejects it)", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ result: TX_HASH })))
    const signer = createKeeperSigner(
      readKeeperSignerConfig({ ...baseEnv, PRIVATE_TX_RELAY_URL: "http://insecure.example" }),
      { fetchFn: fetchMock },
    )
    expect(signer.channel).toBe("evaluation-only")
    const result = await signer.sendTransaction({ to: "0x1111111111111111111111111111111111111111", data: "0x" })
    expect(result.kind).toBe("submission-disabled")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("surfaces relay JSON-RPC rejections as non-retryable", async () => {
    const relayError = { jsonrpc: "2.0", id: 1, error: { code: -32000, message: "underpriced" } }
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(relayError)))
    const signer = createKeeperSigner(readKeeperSignerConfig({ ...baseEnv, PRIVATE_TX_RELAY_URL: RELAY_URL }), {
      publicClient: makeChainStub(),
      fetchFn: fetchMock,
    })
    await expect(
      signer.sendTransaction({ to: "0x1111111111111111111111111111111111111111", data: "0x", chainId: 11155111 }),
    ).rejects.toThrow(/underpriced/)
  })

  it("marks relay 5xx as retryable and 4xx as deterministic", async () => {
    for (const [status, retryable] of [
      [503, true],
      [429, false],
    ] as const) {
      const fetchMock = vi.fn<typeof fetch>(async () => new Response("busy", { status }))
      const signer = createKeeperSigner(readKeeperSignerConfig({ ...baseEnv, PRIVATE_TX_RELAY_URL: RELAY_URL }), {
        publicClient: makeChainStub(),
        fetchFn: fetchMock,
      })
      await expect(
        signer.sendTransaction({ to: "0x1111111111111111111111111111111111111111", data: "0x", chainId: 11155111 }),
      ).rejects.toSatisfy((error: unknown) => error instanceof KeeperRelayError && error.retryable === retryable)
    }
  })

  it("rejects a relay response without a valid tx hash", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0xzz" })),
    )
    const signer = createKeeperSigner(readKeeperSignerConfig({ ...baseEnv, PRIVATE_TX_RELAY_URL: RELAY_URL }), {
      publicClient: makeChainStub(),
      fetchFn: fetchMock,
    })
    await expect(
      signer.sendTransaction({ to: "0x1111111111111111111111111111111111111111", data: "0x", chainId: 11155111 }),
    ).rejects.toThrow(/transaction hash/)
  })
})

describe("preflight guards", () => {
  const input = { to: "0x1111111111111111111111111111111111111111" as const, data: "0x" as const, chainId: 11155111 }

  it("blocks submission when the keeper balance is below the funding floor", async () => {
    const { signer, fetchMock } = makeRelaySigner({}, { getBalance: async () => 0n })
    await expect(signer.sendTransaction(input)).rejects.toSatisfy(
      (error: unknown) => error instanceof InsufficientKeeperBalanceError && error.minimumWei === parseEther("0.05"),
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(isTransientKeeperError(new InsufficientKeeperBalanceError("0x", 0n, 1n))).toBe(false)
  })

  it("blocks submission when gas price exceeds the ceiling", async () => {
    const { signer, fetchMock } = makeRelaySigner(
      { KEEPER_MAX_GAS_PRICE_GWEI: "1" },
      { getGasPrice: async () => parseGwei("5") },
    )
    await expect(signer.sendTransaction(input)).rejects.toBeInstanceOf(GasPriceExceededError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("passes when gas price is at the ceiling", async () => {
    const { signer } = makeRelaySigner({ KEEPER_MAX_GAS_PRICE_GWEI: "5" }, { getGasPrice: async () => parseGwei("5") })
    await expect(signer.sendTransaction(input)).resolves.toMatchObject({ kind: "submitted" })
  })

  it("rejects a chain mismatch before any RPC write", async () => {
    const { signer, fetchMock } = makeRelaySigner()
    await expect(signer.sendTransaction({ ...input, chainId: 1 })).rejects.toBeInstanceOf(KeeperChainMismatchError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("wraps RPC failures as transient KeeperRpcError", async () => {
    const { signer } = makeRelaySigner({}, { getTransactionCount: async () => Promise.reject(new Error("boom")) })
    await expect(signer.sendTransaction(input)).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(KeeperRpcError)
      return isTransientKeeperError(error)
    })
  })
})

describe("explicit public submission", () => {
  it("sends through the wallet client with nonce/gas from preflight", async () => {
    const sendTransaction = vi.fn(async () => TX_HASH)
    const signer = createKeeperSigner(readKeeperSignerConfig({ ...baseEnv, KEEPER_ALLOW_PUBLIC_SUBMISSION: "true" }), {
      publicClient: {
        getBalance: async () => parseEther("1"),
        getTransactionCount: async () => 7,
        estimateGas: async () => 120_000n,
        getGasPrice: async () => parseGwei("2"),
      },
      walletClient: { sendTransaction },
    })

    const result = await signer.sendTransaction({
      to: "0x1111111111111111111111111111111111111111",
      data: "0xdeadbeef",
      chainId: 11155111,
    })

    expect(result).toEqual({ kind: "submitted", channel: "public", txHash: TX_HASH })
    expect(sendTransaction).toHaveBeenCalledTimes(1)
    expect(sendTransaction.mock.calls[0][0]).toMatchObject({
      chain: null,
      to: "0x1111111111111111111111111111111111111111",
      data: "0xdeadbeef",
      nonce: 7,
      gas: 120_000n,
      gasPrice: parseGwei("2"),
    })
  })

  it("never touches the wallet client while evaluation-only", async () => {
    const sendTransaction = vi.fn(async () => TX_HASH)
    const signer = createKeeperSigner(readKeeperSignerConfig(baseEnv), { walletClient: { sendTransaction } })
    await signer.sendTransaction({ to: "0x1111111111111111111111111111111111111111", data: "0x" })
    expect(sendTransaction).not.toHaveBeenCalled()
  })
})

describe("encodeExecuteOrder", () => {
  it("encodes AetherTPSL.executeOrder calldata with the right selector", () => {
    const selector = toFunctionSelector("function executeOrder(uint256,bytes)")
    const data = encodeExecuteOrder(42)
    expect(data.startsWith(selector)).toBe(true)
    expect(encodeExecuteOrder(42n)).toBe(data)
    expect(encodeExecuteOrder(43)).not.toBe(data)
    expect(encodeExecuteOrder(42, "0x1234")).not.toBe(data)
  })

  it("rejects negative order ids", () => {
    expect(() => encodeExecuteOrder(-1)).toThrow(RangeError)
  })
})
