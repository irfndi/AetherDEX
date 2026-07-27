/**
 * Phase 3 — Volume-spike alert service.
 *
 * Detects pools whose USD volume over a rolling window exceeds a threshold and
 * fans the alert out to WebSocket subscribers (via `VolumeAlertHubDO`) and,
 * when configured, a read-only Telegram bot. Designed as plain, dependency-free
 * functions so the threshold/cooldown/delivery logic is individually testable
 * against seeded D1 and a stubbed hub.
 *
 * Delivery is idempotent per pool via a KV cooldown key so a sustained spike is
 * not re-announced on every cron tick. Alerting is enabled by default with a
 * conservative threshold; Telegram stays silent unless its bot token + chat id
 * are explicitly configured.
 */

import { parseChainId } from "../lib/chain-id"

/** Safe, enabled-by-default tuning. Telegram is off unless explicitly configured. */
export const VOLUME_ALERT_DEFAULTS = {
  windowSeconds: 300,
  thresholdUsd: 1_000_000,
  cooldownSeconds: 900,
} as const

/** Single instance name every subscription + broadcast shares. */
export const VOLUME_ALERT_HUB_NAME = "volume-alerts"

/** KV requires a minimum TTL of 60s; clamp smaller cooldowns so put() never throws. */
const KV_MIN_TTL_SECONDS = 60

export interface VolumeAlertConfig {
  chainId: number
  windowSeconds: number
  thresholdUsd: number
  cooldownSeconds: number
}

export interface VolumeSpike {
  poolId: string
  volumeUsd: number
  windowSeconds: number
  thresholdUsd: number
}

/** The exact envelope the DO broadcasts and web consumers unwrap. */
export interface VolumeAlert {
  type: "volume_alert"
  chainId: number
  poolId: string
  volumeUsd: string
  thresholdUsd: string
  windowSeconds: number
  timestamp: number
}

export interface VolumeAlertEnv {
  CHAIN_ID: string
  VOLUME_ALERT_WINDOW_SECONDS?: string
  VOLUME_ALERT_THRESHOLD_USD?: string
  VOLUME_ALERT_COOLDOWN_SECONDS?: string
}

export interface TelegramEnv {
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
}

/** Delivery targets; both optional so callers can run detection without either. */
export interface VolumeAlertSink {
  hub?: DurableObjectNamespace
  telegram?: TelegramEnv
  fetchImpl?: typeof fetch
}

/** Parse a positive integer env var, falling back on missing/invalid values. */
function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const trimmed = value.trim()
  if (!/^[1-9]\d*$/.test(trimmed)) return fallback
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isSafeInteger(parsed) ? parsed : fallback
}

/**
 * Resolve the alert config from env. Returns `null` when the chain id is
 * invalid only — window/threshold/cooldown fall back to safe defaults so the
 * tick stays enabled out of the box.
 */
export function readVolumeAlertConfig(env: VolumeAlertEnv): VolumeAlertConfig | null {
  const chainId = parseChainId(env.CHAIN_ID)
  if (chainId === null) return null
  return {
    chainId,
    windowSeconds: parsePositiveInteger(env.VOLUME_ALERT_WINDOW_SECONDS, VOLUME_ALERT_DEFAULTS.windowSeconds),
    thresholdUsd: parsePositiveInteger(env.VOLUME_ALERT_THRESHOLD_USD, VOLUME_ALERT_DEFAULTS.thresholdUsd),
    cooldownSeconds: parsePositiveInteger(env.VOLUME_ALERT_COOLDOWN_SECONDS, VOLUME_ALERT_DEFAULTS.cooldownSeconds),
  }
}

export interface ReadVolumeSpikesOptions {
  chainId: number
  windowSeconds: number
  thresholdUsd: number
  /** Reference "now" in epoch milliseconds (`created_at` is stored in ms). */
  now: number
}

interface VolumeRow {
  pool_id: string
  volume_usd: number
}

/**
 * Per-pool USD volume over the rolling `[now - windowSeconds, now]` window,
 * filtered to pools exceeding `thresholdUsd`. Only positive, non-null amounts
 * attached to a pool count. D1/SQLite-compatible (SUM + GROUP BY + HAVING).
 */
export async function readVolumeSpikes(db: D1Database, options: ReadVolumeSpikesOptions): Promise<VolumeSpike[]> {
  const { chainId, windowSeconds, thresholdUsd, now } = options
  const windowStartMs = now - windowSeconds * 1000

  const result = await db
    .prepare(
      `SELECT pool_id, SUM(amount_usd) AS volume_usd
       FROM transactions
       WHERE chain_id = ?
         AND created_at >= ?
         AND pool_id IS NOT NULL
         AND amount_usd IS NOT NULL
         AND amount_usd > 0
       GROUP BY pool_id
       HAVING SUM(amount_usd) > ?
       ORDER BY volume_usd DESC`,
    )
    .bind(chainId, windowStartMs, thresholdUsd)
    .all<VolumeRow>()

  if (!result.results) return []
  return result.results.map((row) => ({
    poolId: row.pool_id,
    volumeUsd: row.volume_usd,
    windowSeconds,
    thresholdUsd,
  }))
}

/** Namespaced cooldown key — chain-qualified so multi-chain ingest never collides. */
export function cooldownKey(chainId: number, poolId: string): string {
  return `va:cooldown:${chainId}:${poolId}`
}

/** True when the pool is still within its alert cooldown (key present in KV). */
export async function isInCooldown(kv: KVNamespace, chainId: number, poolId: string): Promise<boolean> {
  const existing = await kv.get(cooldownKey(chainId, poolId))
  return existing !== null
}

/** Record an alert so the same pool is not re-announced before the cooldown lapses. */
export async function markCooldown(
  kv: KVNamespace,
  chainId: number,
  poolId: string,
  cooldownSeconds: number,
): Promise<void> {
  const ttl = Math.max(KV_MIN_TTL_SECONDS, Math.ceil(cooldownSeconds))
  await kv.put(cooldownKey(chainId, poolId), String(Date.now()), { expirationTtl: ttl })
}

/** Serialise a spike into the broadcast envelope. */
export function formatVolumeAlert(chainId: number, spike: VolumeSpike, timestamp: number): VolumeAlert {
  return {
    type: "volume_alert",
    chainId,
    poolId: spike.poolId,
    volumeUsd: String(spike.volumeUsd),
    thresholdUsd: String(spike.thresholdUsd),
    windowSeconds: spike.windowSeconds,
    timestamp,
  }
}

/** True only when both the bot token and chat id are present. */
export function telegramConfigured(env: TelegramEnv): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID)
}

/**
 * Best-effort, read-only Telegram notification. Never throws — a delivery
 * failure logs and returns so the alert path (and cron tick) keeps going.
 * `fetchImpl` is a test seam; production uses the global fetch.
 */
export async function sendTelegramAlert(
  env: TelegramEnv,
  alert: VolumeAlert,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!telegramConfigured(env)) return
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`
  const text =
    `AetherDEX volume spike (chain ${alert.chainId}): pool ${alert.poolId} traded ` +
    `$${alert.volumeUsd} in ${alert.windowSeconds}s (threshold $${alert.thresholdUsd})`
  try {
    await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
    })
  } catch (error) {
    console.error(`[VolumeAlerts] Telegram send failed: ${String(error)}`)
  }
}

/**
 * Push an alert to the VolumeAlertHubDO for WebSocket fan-out. Best-effort: a
 * broadcast failure logs and returns rather than failing the alert path.
 */
export async function broadcastVolumeAlert(hub: DurableObjectNamespace, alert: VolumeAlert): Promise<void> {
  const stub = hub.get(hub.idFromName(VOLUME_ALERT_HUB_NAME))
  try {
    await stub.fetch(
      new Request("http://volume-alert-hub/alert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(alert),
      }),
    )
  } catch (error) {
    console.error(`[VolumeAlerts] broadcast failed for pool ${alert.poolId}: ${String(error)}`)
  }
}

/**
 * One alert tick: detect spikes, drop pools still in cooldown, deliver each
 * remaining spike (WebSocket + optional Telegram), then arm the cooldown so a
 * sustained spike is announced once per cooldown window. Returns the alerts
 * actually emitted this tick.
 */
export async function runVolumeAlertsTick(
  db: D1Database,
  kv: KVNamespace,
  config: VolumeAlertConfig,
  sink: VolumeAlertSink,
  now: number = Date.now(),
): Promise<VolumeAlert[]> {
  const spikes = await readVolumeSpikes(db, {
    chainId: config.chainId,
    windowSeconds: config.windowSeconds,
    thresholdUsd: config.thresholdUsd,
    now,
  })

  const fetchImpl = sink.fetchImpl ?? fetch
  const emitted: VolumeAlert[] = []
  for (const spike of spikes) {
    if (await isInCooldown(kv, config.chainId, spike.poolId)) continue

    const alert = formatVolumeAlert(config.chainId, spike, now)
    if (sink.hub) await broadcastVolumeAlert(sink.hub, alert)
    await sendTelegramAlert(sink.telegram ?? {}, alert, fetchImpl)
    await markCooldown(kv, config.chainId, spike.poolId, config.cooldownSeconds)
    emitted.push(alert)
  }
  return emitted
}
