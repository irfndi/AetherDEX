/**
 * WebSocketHubDO — known-token registry persistence across hibernation,
 * filtered price fan-out, and sanitized message errors.
 *
 * `knownTokens` is pure in-memory state in the class; these tests evict the
 * instance (with a hibernatable socket open — the condition under which
 * graceful eviction completes) and prove `/stats` and `list_pools` still
 * return tokens broadcast before the eviction, because the registry is
 * persisted to DO storage.
 */

import { abortAllDurableObjects, env } from "cloudflare:test"
import { describe, expect, it } from "vitest"

interface PriceUpdate {
  tokenAddress: string
  price: number
  updatedAt: number
}

const priceFor = (tokenAddress: string, price: number): PriceUpdate => ({ tokenAddress, price, updatedAt: Date.now() })

const parseFrame = (raw: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

/** Await the next frame matching `predicate` — event-driven, no polling. */
function waitForMessage(socket: WebSocket, predicate: (message: unknown) => boolean): Promise<unknown> {
  const { promise, resolve } = Promise.withResolvers<unknown>()
  const onMessage = (event: MessageEvent) => {
    const message = parseFrame(String(event.data))
    if (predicate(message)) {
      socket.removeEventListener("message", onMessage)
      resolve(message)
    }
  }
  socket.addEventListener("message", onMessage)
  return promise
}

async function openSocket(stub: DurableObjectStub): Promise<{ socket: WebSocket; messages: unknown[] }> {
  const response = await stub.fetch("https://hub/ws", { headers: { Upgrade: "websocket" } })
  expect(response.status).toBe(101)
  const socket = response.webSocket
  if (!socket) throw new Error("Expected a WebSocket in the upgrade response")
  const messages: unknown[] = []
  socket.addEventListener("message", (event) => messages.push(parseFrame(String(event.data))))
  socket.accept()
  return { socket, messages }
}

const postPrice = (stub: DurableObjectStub, update: PriceUpdate) =>
  stub.fetch("https://hub/price", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(update),
  })

const getStats = async (stub: DurableObjectStub): Promise<{ knownTokens: number; tokenAddresses: string[] }> =>
  (await (await stub.fetch("https://hub/stats")).json()) as { knownTokens: number; tokenAddresses: string[] }

describe("WebSocketHubDO", () => {
  it("keeps knownTokens across instance eviction (hibernation)", async () => {
    const stub = env.WEBSOCKET_HUB.get(env.WEBSOCKET_HUB.idFromName("known-tokens-pool"))
    await postPrice(stub, priceFor("0xTokenA", 1.5))

    // Forcible eviction: in-memory state discarded, durable storage intact —
    // the same condition a fresh instance observes after hibernation.
    await abortAllDurableObjects()

    const stats = await getStats(env.WEBSOCKET_HUB.get(env.WEBSOCKET_HUB.idFromName("known-tokens-pool")))
    expect(stats.knownTokens).toBe(1)
    expect(stats.tokenAddresses).toContain("0xTokenA")
  })

  it("returns list_pools from the persisted registry after eviction", async () => {
    const stub = env.WEBSOCKET_HUB.get(env.WEBSOCKET_HUB.idFromName("list-pools-pool"))
    await postPrice(stub, priceFor("0xTokenB", 2))

    await abortAllDurableObjects()

    // Fresh instance after wake: subscribers rehydrate from attachments,
    // knownTokens from durable storage.
    const { socket } = await openSocket(env.WEBSOCKET_HUB.get(env.WEBSOCKET_HUB.idFromName("list-pools-pool")))
    const poolList = waitForMessage(socket, (m) => (m as { type?: string }).type === "pool_list")

    socket.send(JSON.stringify({ type: "list_pools" }))

    expect(await poolList).toEqual({ type: "pool_list", pools: ["0xTokenB"] })

    socket.close(1000, "done")
  })

  it("fans a price update out only to sockets watching that token", async () => {
    const stub = env.WEBSOCKET_HUB.get(env.WEBSOCKET_HUB.idFromName("filtered-fanout-pool"))
    const watcher = await openSocket(stub)
    const other = await openSocket(stub)
    const watcherSubscribed = waitForMessage(watcher.socket, (m) => (m as { type?: string }).type === "subscribed")
    const otherSubscribed = waitForMessage(other.socket, (m) => (m as { type?: string }).type === "subscribed")

    watcher.socket.send(JSON.stringify({ type: "subscribe", poolId: "0xTokenC" }))
    other.socket.send(JSON.stringify({ type: "subscribe", poolId: "0xTokenD" }))
    // Wait for both DO-side subscribes to land before broadcasting, so the
    // filter has real watched keys (an unprocessed subscribe = global listener).
    await watcherSubscribed
    await otherSubscribed

    const updateFrame = waitForMessage(watcher.socket, (m) => (m as { type?: string }).type === "price_update")
    await postPrice(stub, priceFor("0xTokenC", 3.25))

    expect(await updateFrame).toMatchObject({ type: "price_update", data: { tokenAddress: "0xTokenC", price: 3.25 } })
    expect(other.messages.some((m) => (m as { type?: string }).type === "price_update")).toBe(false)

    watcher.socket.close(1000, "done")
    other.socket.close(1000, "done")
  })

  it("sends a sanitized error for malformed frames without leaking exception details", async () => {
    const stub = env.WEBSOCKET_HUB.get(env.WEBSOCKET_HUB.idFromName("bad-frame-pool"))
    const { socket } = await openSocket(stub)
    const received = waitForMessage(socket, (m) => (m as { type?: string }).type === "error")

    socket.send("not json at all")

    expect(await received).toEqual({ type: "error", message: "Invalid message" })

    socket.close(1000, "done")
  })
})
