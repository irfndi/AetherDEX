/**
 * Phase-0 G1 — WebSocket upgrade routing.
 * Verifies the Hono /ws/* routes hand upgrades to the correct Durable Object
 * and the DO WebSocket handshake works end-to-end (via SELF, in-process).
 */

import { env, SELF } from "cloudflare:test"
import { describe, expect, it } from "vitest"

const POOL_ID = "0x2222222222222222222222222222222222222222222222222222222222222222"

function nextMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    ws.addEventListener("message", (event) => {
      try {
        resolve(JSON.parse(String(event.data)))
      } catch (err) {
        reject(err)
      }
    })
    ws.addEventListener("error", () => reject(new Error("socket error")))
  })
}

describe("GET /ws/prices/:tokenAddress → WebSocketHubDO", () => {
  it("upgrades to a WebSocket (101)", async () => {
    const res = await SELF.fetch("http://fake-host/ws/prices/0x00000000000000000000000000000000000000AA?chainId=1", {
      headers: { Upgrade: "websocket" },
    })
    expect(res.status).toBe(101)
    const ws = res.webSocket
    expect(ws).not.toBeNull()
    ws?.accept()
    ws?.close(1000, "done")
  })

  it("hub answers a subscribe + ping round-trip", async () => {
    const res = await SELF.fetch("http://fake-host/ws/prices/0x00000000000000000000000000000000000000AA", {
      headers: { Upgrade: "websocket" },
    })
    const ws = res.webSocket
    expect(ws).not.toBeNull()
    if (!ws) return
    ws.accept()

    // Attach each listener BEFORE sending, so a fast response cannot race the handler.
    const subscribedMessage = nextMessage(ws)
    ws.send(JSON.stringify({ type: "subscribe", poolId: POOL_ID }))
    const subscribed = (await subscribedMessage) as { type: string; data: { poolId: string } }
    expect(subscribed.type).toBe("subscribed")
    expect(subscribed.data.poolId).toBe(POOL_ID)

    const pongMessage = nextMessage(ws)
    ws.send(JSON.stringify({ type: "ping" }))
    const pong = (await pongMessage) as { type: string }
    expect(pong.type).toBe("pong")

    ws.close(1000, "done")
  })

  it("fans producer price refreshes out with the per-token payload shape", async () => {
    const res = await SELF.fetch("http://fake-host/ws/prices/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", {
      headers: { Upgrade: "websocket" },
    })
    const ws = res.webSocket
    expect(ws).not.toBeNull()
    if (!ws) return
    ws.accept()

    const hubNs = env.WEBSOCKET_HUB
    if (!hubNs) throw new Error("WEBSOCKET_HUB binding is not configured in the test environment")
    const hub = hubNs.get(hubNs.idFromName("price-hub"))
    const tokenAddress = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"

    // The exact envelope the web PriceTicker unwraps. Attach the listener BEFORE
    // triggering the producer POST, so the broadcast cannot race the handler.
    const updateMessage = nextMessage(ws)
    const post = await hub.fetch(
      new Request("http://price-hub/price", {
        method: "POST",
        body: JSON.stringify({ tokenAddress, price: 1.0001, updatedAt: 12345 }),
      }),
    )
    expect(post.status).toBe(200)

    const update = (await updateMessage) as {
      type: string
      data: { tokenAddress: string; price: number; updatedAt: number }
    }
    expect(update.type).toBe("price_update")
    expect(update.data.tokenAddress).toBe(tokenAddress)
    expect(update.data.price).toBe(1.0001)
    expect(update.data.updatedAt).toBe(12345)

    ws.close(1000, "done")
  })
})

describe("GET /ws/orderbook/:poolId → OrderBookDO", () => {
  it("upgrades to a WebSocket (101) routed by pool id", async () => {
    const res = await SELF.fetch(`http://fake-host/ws/orderbook/${POOL_ID}`, {
      headers: { Upgrade: "websocket" },
    })
    expect(res.status).toBe(101)
    const ws = res.webSocket
    expect(ws).not.toBeNull()
    ws?.accept()
    ws?.close(1000, "done")
  })

  it("canonicalizes mixed-case pool ids to ONE order book + snapshot key", async () => {
    // Alphabetic hex spelled two ways: upper- and lower-case refer to the SAME pool.
    const mixedCase = "0xAbCdEf1234567890aBcDeF1234567890ABCDEF1234567890aBcDeF1234567890"
    const lowerCase = mixedCase.toLowerCase()

    const connect = async (poolId: string) => {
      const res = await SELF.fetch(`http://fake-host/ws/orderbook/${poolId}`, {
        headers: { Upgrade: "websocket" },
      })
      expect(res.status).toBe(101)
      const ws = res.webSocket
      expect(ws).not.toBeNull()
      if (!ws) return null
      ws.accept()
      const snapshotMessage = nextMessage(ws)
      const snapshot = (await snapshotMessage) as { type: string; data: { poolId: string } }
      ws.close(1000, "done")
      return snapshot
    }

    const [fromMixed, fromLower] = [await connect(mixedCase), await connect(lowerCase)]
    // Both casings forward AND persist under the canonical (lower-cased) key.
    expect(fromMixed?.data.poolId).toBe(lowerCase)
    expect(fromLower?.data.poolId).toBe(lowerCase)
  })

  it("sends an initial orderbook snapshot on connect", async () => {
    const res = await SELF.fetch(`http://fake-host/ws/orderbook/${POOL_ID}`, {
      headers: { Upgrade: "websocket" },
    })
    const ws = res.webSocket
    expect(ws).not.toBeNull()
    if (!ws) return
    ws.accept()

    const snapshot = (await nextMessage(ws)) as { type: string; data: { poolId: string; sqrtPriceX96: string } }
    expect(snapshot.type).toBe("orderbook_update")
    expect(snapshot.data.poolId).toBe(POOL_ID)
    expect(snapshot.data.sqrtPriceX96).toBe("0")

    ws.close(1000, "done")
  })

  it("rejects an invalid poolId with 400 (no upgrade)", async () => {
    const res = await SELF.fetch("http://fake-host/ws/orderbook/not-a-pool-id", {
      headers: { Upgrade: "websocket" },
    })
    expect(res.status).toBe(400)
    expect(res.webSocket).toBeNull()
    await res.text()
  })
})
