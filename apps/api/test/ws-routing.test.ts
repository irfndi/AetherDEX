/**
 * Phase-0 G1 — WebSocket upgrade routing.
 * Verifies the Hono /ws/* routes hand upgrades to the correct Durable Object
 * and the DO WebSocket handshake works end-to-end (via SELF, in-process).
 */

import { SELF } from "cloudflare:test"
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

    ws.send(JSON.stringify({ type: "subscribe", poolId: POOL_ID }))
    const subscribed = (await nextMessage(ws)) as { type: string; data: { poolId: string } }
    expect(subscribed.type).toBe("subscribed")
    expect(subscribed.data.poolId).toBe(POOL_ID)

    ws.send(JSON.stringify({ type: "ping" }))
    const pong = (await nextMessage(ws)) as { type: string }
    expect(pong.type).toBe("pong")

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
