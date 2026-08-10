/**
 * OrderBookDO — hibernation-safe broadcast, per-socket pool filtering, and
 * sanitized message errors.
 *
 * The DO uses the WebSocket Hibernation API: `evictDurableObject()` simulates
 * instance eviction (in-memory state lost, hibernatable sockets kept), and the
 * assertions below prove broadcasts still reach connected sockets afterwards —
 * the regression the in-memory subscriber map used to cause.
 */

import { env, evictDurableObject } from "cloudflare:test"
import { describe, expect, it } from "vitest"

interface Snapshot {
  poolId: string
  sqrtPriceX96: string
  tick: number
  liquidity: string
  updatedAt: string
}

const snapshot = (poolId: string, tick = 0): Snapshot => ({
  poolId,
  sqrtPriceX96: "79228162514264337593543950336",
  tick,
  liquidity: "1000000",
  updatedAt: new Date().toISOString(),
})

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

async function openSocket(
  stub: DurableObjectStub,
  poolId: string,
): Promise<{ socket: WebSocket; messages: unknown[] }> {
  const response = await stub.fetch(`https://order-book/ws?poolId=${encodeURIComponent(poolId)}`, {
    headers: { Upgrade: "websocket" },
  })
  expect(response.status).toBe(101)
  const socket = response.webSocket
  if (!socket) throw new Error("Expected a WebSocket in the upgrade response")
  const messages: unknown[] = []
  socket.addEventListener("message", (event) => messages.push(parseFrame(String(event.data))))
  socket.accept()
  return { socket, messages }
}

const postUpdate = (stub: DurableObjectStub, data: Snapshot) =>
  stub.fetch("https://order-book/update", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  })

describe("OrderBookDO", () => {
  it("broadcasts an update to a connected socket after instance eviction (hibernation)", async () => {
    const stub = env.ORDER_BOOK.get(env.ORDER_BOOK.idFromName("hibernate-pool"))
    const { socket, messages } = await openSocket(stub, "hibernate-pool")
    // Match the update itself (tick 42), not the initial snapshot sent at connect.
    const received = waitForMessage(
      socket,
      (m) =>
        (m as { type?: string }).type === "orderbook_update" && (m as { data?: { tick?: number } }).data?.tick === 42,
    )

    // Wipe in-memory state (fresh instance on next wake), sockets stay connected.
    await evictDurableObject(stub)

    const response = await postUpdate(stub, snapshot("hibernate-pool", 42))
    expect(await response.json()).toEqual({ ok: true, subscribers: 1 })

    expect(await received).toMatchObject({ type: "orderbook_update", data: { poolId: "hibernate-pool", tick: 42 } })
    expect(messages.some((m) => (m as { type?: string }).type === "orderbook_update")).toBe(true)

    socket.close(1000, "done")
  })

  it("fans out to every socket on the pool after eviction", async () => {
    const stub = env.ORDER_BOOK.get(env.ORDER_BOOK.idFromName("multi-socket-pool"))
    const first = await openSocket(stub, "multi-socket-pool")
    const second = await openSocket(stub, "multi-socket-pool")
    const firstFrame = waitForMessage(
      first.socket,
      (m) =>
        (m as { type?: string }).type === "orderbook_update" && (m as { data?: { tick?: number } }).data?.tick === 7,
    )
    const secondFrame = waitForMessage(
      second.socket,
      (m) =>
        (m as { type?: string }).type === "orderbook_update" && (m as { data?: { tick?: number } }).data?.tick === 7,
    )

    await evictDurableObject(stub)

    await postUpdate(stub, snapshot("multi-socket-pool", 7))

    await firstFrame
    await secondFrame

    first.socket.close(1000, "done")
    second.socket.close(1000, "done")
  })

  it("reports subscriber counts from the surviving sockets after eviction", async () => {
    const stub = env.ORDER_BOOK.get(env.ORDER_BOOK.idFromName("stats-pool"))
    const { socket } = await openSocket(stub, "stats-pool")

    await evictDurableObject(stub)

    const stats = (await (await stub.fetch("https://order-book/stats?poolId=stats-pool")).json()) as {
      subscribers: number
    }
    expect(stats.subscribers).toBe(1)

    socket.close(1000, "done")
  })

  it("sends a sanitized error for malformed frames without leaking exception details", async () => {
    const stub = env.ORDER_BOOK.get(env.ORDER_BOOK.idFromName("bad-frame-pool"))
    const { socket } = await openSocket(stub, "bad-frame-pool")
    const received = waitForMessage(socket, (m) => (m as { type?: string }).type === "error")

    socket.send("not json at all")

    expect(await received).toEqual({ type: "error", message: "Invalid message" })

    socket.close(1000, "done")
  })
})
