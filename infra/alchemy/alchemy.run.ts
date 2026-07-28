import * as Alchemy from "alchemy"
import * as Cloudflare from "alchemy/Cloudflare"
import * as Output from "alchemy/Output"
import * as Effect from "effect/Effect"

const configured = (primary: string, legacy: string): string => process.env[primary] ?? process.env[legacy] ?? ""
const configuredNonEmpty = (name: string, fallback: string): string => process.env[name]?.trim() || fallback

const environmentForStage = (stage: string): string => {
  if (stage === "dev" || stage.startsWith("dev_")) return "development"
  return stage
}

const safeStageSuffix = (stage: string): string => {
  const suffix = stage
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "")
  return suffix.slice(0, 45) || "default"
}

export default Alchemy.Stack(
  "AetherDEXCloudflare",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const stage = yield* Alchemy.Stage
    const suffix = safeStageSuffix(stage)
    const webOrigin = `https://aetherdex-web-${suffix}.pages.dev`
    const apiConfig = {
      CHAIN_ID: process.env.CHAIN_ID ?? "11155111",
      ENVIRONMENT: process.env.ENVIRONMENT ?? environmentForStage(stage),
      RPC_URL: process.env.RPC_URL ?? "",
      SIWE_DOMAIN: configuredNonEmpty("SIWE_DOMAIN", new URL(webOrigin).host),
      SIWE_URI: configuredNonEmpty("SIWE_URI", webOrigin),
      CORS_ORIGINS: configuredNonEmpty(
        "CORS_ORIGINS",
        ["http://localhost:3000", "https://aetherdex.io", webOrigin].join(","),
      ),
      AETHER_HOOK_ADDRESS: configured("AETHERDEX_HOOK", "AETHER_HOOK_ADDRESS"),
      TREASURY_ADDRESS: configured("AETHERDEX_TREASURY", "TREASURY_ADDRESS"),
      ROUTER_ADDRESS: configured("AETHERDEX_ROUTER", "ROUTER_ADDRESS"),
      FACTORY_ADDRESS: configured("AETHERDEX_FACTORY", "FACTORY_ADDRESS"),
      POSITION_MANAGER_ADDRESS: configured("AETHERDEX_POSITION_MANAGER", "POSITION_MANAGER_ADDRESS"),
      POOL_MANAGER_ADDRESS: configured("AETHERDEX_POOL_MANAGER", "POOL_MANAGER_ADDRESS"),
      STATE_VIEW_ADDRESS: process.env.STATE_VIEW_ADDRESS ?? "",
      V3_FACTORY_ADDRESS: process.env.V3_FACTORY_ADDRESS ?? "",
      V3_QUOTER_ADDRESS: process.env.V3_QUOTER_ADDRESS ?? "",
      V3_POSITION_MANAGER_ADDRESS: process.env.V3_POSITION_MANAGER_ADDRESS ?? "",
      V3_POSITION_MANAGER_DEPLOYMENT_BLOCK: process.env.V3_POSITION_MANAGER_DEPLOYMENT_BLOCK ?? "0",
      V4_POOL_MANAGER_ADDRESS: process.env.V4_POOL_MANAGER_ADDRESS ?? "",
      INDEXER_ENABLED: process.env.INDEXER_ENABLED ?? "false",
      INDEXER_BATCH_SIZE: process.env.INDEXER_BATCH_SIZE ?? "2000",
      V3_INDEXED_POOL_ADDRESSES: process.env.V3_INDEXED_POOL_ADDRESSES ?? "",
      QUOTE_ENGINE_MODE: process.env.QUOTE_ENGINE_MODE ?? "auto",
      TOKEN_LIST_URL: process.env.TOKEN_LIST_URL ?? "https://tokens.uniswap.org",
      RATE_LIMIT_MAX: process.env.RATE_LIMIT_MAX ?? "60",
      RATE_LIMIT_WINDOW_SECONDS: process.env.RATE_LIMIT_WINDOW_SECONDS ?? "60",
      CIRCUIT_FAILURE_THRESHOLD: process.env.CIRCUIT_FAILURE_THRESHOLD ?? "5",
      CIRCUIT_COOLDOWN_SECONDS: process.env.CIRCUIT_COOLDOWN_SECONDS ?? "30",
      HIGH_VALUE_USD_THRESHOLD: process.env.HIGH_VALUE_USD_THRESHOLD ?? "10000",
      MEV_PROTECTION_MODE: process.env.MEV_PROTECTION_MODE ?? "client",
      MEV_MAX_SLIPPAGE_BPS: process.env.MEV_MAX_SLIPPAGE_BPS ?? "500",
      PRIVATE_TX_RELAY_URL: process.env.PRIVATE_TX_RELAY_URL ?? "",
      VOLUME_ALERT_WINDOW_SECONDS: process.env.VOLUME_ALERT_WINDOW_SECONDS ?? "300",
      VOLUME_ALERT_THRESHOLD_USD: process.env.VOLUME_ALERT_THRESHOLD_USD ?? "1000000",
      VOLUME_ALERT_COOLDOWN_SECONDS: process.env.VOLUME_ALERT_COOLDOWN_SECONDS ?? "900",
    } as const

    const database = yield* Cloudflare.D1.Database("MainDatabase", {
      name: `aetherdex-main-${suffix}`,
      migrationsDir: "../../apps/api/migrations",
    })
    const cache = yield* Cloudflare.KV.Namespace("Cache", {
      title: `aetherdex-cache-${suffix}`,
    })
    const storage = yield* Cloudflare.R2.Bucket("TradeHistory", {
      name:
        stage.startsWith("dev") && process.env.STORAGE_BUCKET_NAME
          ? process.env.STORAGE_BUCKET_NAME
          : `aetherdex-storage-${suffix}`,
    })

    const priceQueue = yield* Cloudflare.Queues.Queue("PriceQueue", {
      name: `price-refresh-${suffix}`,
    })
    const settlementQueue = yield* Cloudflare.Queues.Queue("SettlementQueue", {
      name: `trade-settlement-${suffix}`,
    })
    const keeperQueue = yield* Cloudflare.Queues.Queue("KeeperQueue", {
      name: `keeper-jobs-${suffix}`,
    })
    const priceDeadLetterQueue = yield* Cloudflare.Queues.Queue("PriceDeadLetterQueue", {
      name: `price-refresh-${suffix}-dlq`,
    })
    const settlementDeadLetterQueue = yield* Cloudflare.Queues.Queue("SettlementDeadLetterQueue", {
      name: `trade-settlement-${suffix}-dlq`,
    })
    const keeperDeadLetterQueue = yield* Cloudflare.Queues.Queue("KeeperDeadLetterQueue", {
      name: `keeper-jobs-${suffix}-dlq`,
    })

    const orderBook = Cloudflare.DurableObject("OrderBook", { className: "OrderBookDO" })
    const websocketHub = Cloudflare.DurableObject("WebSocketHub", { className: "WebSocketHubDO" })
    const siweNonce = Cloudflare.DurableObject("SiweNonce", { className: "SiweNonceDO" })
    const volumeAlertHub = Cloudflare.DurableObject("VolumeAlertHub", { className: "VolumeAlertHubDO" })

    const worker = yield* Cloudflare.Worker("Api", {
      name: `aetherdex-api-${suffix}`,
      main: "../../apps/api/src/index.ts",
      url: true,
      subdomain: { enabled: true, previewsEnabled: true },
      compatibility: {
        date: "2026-06-29",
        flags: ["nodejs_compat", "global_fetch_strictly_public"],
      },
      crons: ["*/5 * * * *"],
      env: {
        DB: database,
        CACHE: cache,
        STORAGE: storage,
        ORDER_BOOK: orderBook,
        WEBSOCKET_HUB: websocketHub,
        SIWE_NONCE: siweNonce,
        VOLUME_ALERT_HUB: volumeAlertHub,
        PRICE_QUEUE: priceQueue,
        SETTLE_QUEUE: settlementQueue,
        KEEPER_QUEUE: keeperQueue,
        ...apiConfig,
      },
    })

    const webProject = yield* Cloudflare.Pages.Project(
      "Web",
      Effect.succeed({
        name: `aetherdex-web-${suffix}`,
        productionBranch: stage.startsWith("dev") ? "dev" : "main",
        buildConfig: {
          buildCommand: "bun run build",
          destinationDir: "dist",
          rootDir: "apps/web",
        },
        deploymentConfigs: {
          preview: {
            envVars: {
              VITE_API_URL: { value: Output.interpolate`${worker.url}/api/v1` },
              VITE_REOWN_PROJECT_ID: { value: process.env.VITE_REOWN_PROJECT_ID ?? "" },
              VITE_WS_URL: { value: Output.interpolate`${worker.url}` },
            },
          },
          production: {
            envVars: {
              VITE_API_URL: { value: Output.interpolate`${worker.url}/api/v1` },
              VITE_REOWN_PROJECT_ID: { value: process.env.VITE_REOWN_PROJECT_ID ?? "" },
              VITE_WS_URL: { value: Output.interpolate`${worker.url}` },
            },
          },
        },
      }),
    )

    yield* Cloudflare.Queues.Consumer("PriceConsumer", {
      queueId: priceQueue.queueId,
      scriptName: worker.workerName,
      deadLetterQueue: priceDeadLetterQueue.queueName,
      settings: { batchSize: 10, maxRetries: 3 },
    })
    yield* Cloudflare.Queues.Consumer("SettlementConsumer", {
      queueId: settlementQueue.queueId,
      scriptName: worker.workerName,
      deadLetterQueue: settlementDeadLetterQueue.queueName,
      settings: { batchSize: 10, maxRetries: 3 },
    })
    yield* Cloudflare.Queues.Consumer("KeeperConsumer", {
      queueId: keeperQueue.queueId,
      scriptName: worker.workerName,
      deadLetterQueue: keeperDeadLetterQueue.queueName,
      settings: { batchSize: 5, maxRetries: 5, maxWaitTimeMs: 5000 },
    })

    return {
      stage,
      workerName: worker.workerName,
      workerUrl: worker.url,
      databaseId: database.databaseId,
      cacheId: cache.namespaceId,
      webProjectName: webProject.name,
      webProjectSubdomain: webProject.subdomain,
      storageBucketName: storage.bucketName,
      queues: {
        price: priceQueue.queueName,
        settlement: settlementQueue.queueName,
        keeper: keeperQueue.queueName,
      },
    }
  }),
)
