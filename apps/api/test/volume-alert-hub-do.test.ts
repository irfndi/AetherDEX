/**
 * VolumeAlertHubDO — hibernation-safe, pool-filtered alert fan-out.
 *
 * This DO already enumerates `ctx.getWebSockets()` at broadcast time (no
 * in-memory subscriber map); these tests pin that behaviour, including across
 * instance eviction.
 */

import { env, evictDurableObject } from "cloudflare:test"
import { describe, expect, it } from "vitest"

interface VolumeAlert {
  type: "volume_alert"
  chainId: number
  poolId: string
  volumeUsd: string
  thresholdUsd: string
  windowSeconds: number
  timestamp: number
}

const alertFor = (poolId: string): VolumeAlert => ({
  type: "volume_alert",
  chainId: 1,
  poolId,
  volumeUsd: "2000000",
  thresholdUsd: "1000000",
  windowSeconds: 300,
  timestamp: Date.now(),
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
  poolId?: string,
): Promise<{ socket: WebSocket; messages: unknown[] }> {
  const query = poolId ? `?poolId=${encodeURIComponent(poolId)}` : ""
  const response = await stub.fetch(`https://alerts/ws${query}`, { headers: { Upgrade: "websocket" } })
  expect(response.status).toBe(101)
  const socket = response.webSocket
  if (!socket) throw new Error("Expected a WebSocket in the upgrade response")
  const messages: unknown[] = []
  socket.addEventListener("message", (event) => messages.push(parseFrame(String(event.data))))
  socket.accept()
  return { socket, messages }
}

const postAlert = (stub: DurableObjectStub, alert: VolumeAlert) =>
  stub.fetch("https://alerts/alert", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(alert),
  })

describe("VolumeAlertHubDO", () => {
  it("delivers a pool-scoped alert to the matching socket after eviction", async () => {
    const stub = env.VOLUME_ALERT_HUB.get(env.VOLUME_ALERT_HUB.idFromName("alert-pool"))
    const { socket } = await openSocket(stub, "0xPoolA")
    const received = waitForMessage(socket, (m) => (m as { type?: string }).type === "volume_alert")

    await evictDurableObject(stub)

    const response = await postAlert(stub, alertFor("0xPoolA"))
    expect(await response.json()).toEqual({ ok: true, subscribers: 1 })

    expect(await received).toMatchObject({ type: "volume_alert", poolId: "0xPoolA" })

    socket.close(1000, "done")
  })

  it("skips sockets scoped to a different pool and delivers to matching + global listeners", async () => {
    const stub = env.VOLUME_ALERT_HUB.get(env.VOLUME_ALERT_HUB.idFromName("filter-pool"))
    const scoped = await openSocket(stub, "0xPoolB")
    const other = await openSocket(stub, "0xPoolC")
    const global = await openSocket(stub)
    const globalFrame = waitForMessage(global.socket, (m) => (m as { type?: string }).type === "volume_alert")

    await postAlert(stub, alertFor("0xPoolB"))

    expect(await globalFrame).toMatchObject({ type: "volume_alert", poolId: "0xPoolB" })
    expect(scoped.messages.some((m) => (m as { type?: string }).type === "volume_alert")).toBe(true)
    expect(other.messages.some((m) => (m as { type?: string }).type === "volume_alert")).toBe(false)
    expect(global.messages.some((m) => (m as { type?: string }).type === "volume_alert")).toBe(true)

    scoped.socket.close(1000, "done")
    other.socket.close(1000, "done")
    global.socket.close(1000, "done")
  })
})
