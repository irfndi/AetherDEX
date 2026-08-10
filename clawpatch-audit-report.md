# clawpatch report

findings: 248
clusters: 6

## action clusters

### cluster 1: apps/api duplication (4 findings)

- low/high fnd_sig-feat-library-e99f39f7ec-226d_b0753463af: loadTimestamps issues one sequential getBlock RPC call per unique block, making batch latency scale with block count
- low/high fnd_sig-feat-library-8f5d5fd534-48c4_5e92def3a4: Phase-2 keeper/auto-recenter paths are stubs that emit plausible-but-wrong results: constant-zero counters, unreachable failure branches, and current-range values labeled as rebalance targets
- low/medium fnd_sig-feat-library-8f5d5fd534-85df_8d5d21820f: ChainStateReader tick scan issues up to 1025 parallel RPC readContract calls per getPoolState
- low/medium fnd_sig-feat-route-552aaeecba-7afb4f_2b367388f6: Public quote endpoint fans out to an external RPC with no rate limiting or caching

### cluster 2: apps/web test coupling (3 findings)

- low/high fnd_sig-feat-library-da89b4a88e-cb04_3e0d0c43ad: Input generates a new Math.random-based id on every render
- low/medium fnd_sig-feat-release-2c926a7be1-6ba6_20c6a62c21: lint script coverage misses e2e test files and root configs
- low/medium fnd_sig-feat-test-suite-fba3efc44a-f_4ce361b038: Redundant coverage providers installed without an explicit provider in test:coverage

### cluster 3: apps/web wrapper bloat (3 findings)

- low/high fnd_sig-feat-library-d06274bfb5-abcb_dcd4016ad3: Button propagates className via rest spread after attribute composition, allowing callers to silently clobber styling
- low/high fnd_sig-feat-ui-flow-96f77c54e9-b72c_3fad29106f: fetch not aborted via react-query's signal; in-flight requests continue after unmount
- low/low fnd_sig-feat-release-854b75ccaa-ebf8_03010774fd: format script uses deprecated `biome format` command, inconsistent with `biome check`-based lint

### cluster 4: apps/api band-aid (2 findings)

- low/medium fnd_sig-feat-library-75f5288ce0-b8bc_1a42e19d02: AlertSeverity type is hand-maintained and can drift from severities actually used in ALERT_RULES
- low/medium fnd_sig-feat-library-c77821ce5c-72c1_22df6a7253: Price-refresh consumer performs unbounded sequential HTTP fetches with no timeout

### cluster 5: packages/shared test coupling (2 findings)

- low/medium fnd_sig-feat-release-3c1de179c9-7eda_118c473bf3: lint script only checks src/, leaving package-level files outside verification
- low/medium fnd_sig-feat-library-b3899aac05-8083_3003b67d26: Shared contract built on exact-pinned beta and unstable API surface

### cluster 6: apps/web code bloat (2 findings)

- low/low fnd_sig-feat-release-854b75ccaa-3fc3_7785cd89ae: format and lint scripts only cover src/ and test/, omitting package-root config files
- low/low fnd_sig-feat-release-fa18bd5381-de5f_45493c7bd8: Version skew across @tanstack/router runtime, CLI, plugin, and devtools packages

## high: OrderBookDO broadcasts to an empty in-memory subscriber map after hibernation, silently dropping live order book updates

id: fnd_sig-feat-library-a50e9b911f-66ce_e329f9e396
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node package @aetherdex/api (feat_library_a50e9b911f)

evidence:
- apps/api/src/durable-objects/order-book-do.ts:144-154
- apps/api/src/durable-objects/order-book-do.ts:82-89
- apps/api/src/durable-objects/order-book-do.ts:65-69
- apps/api/src/durable-objects/websocket-hub-do.ts:160-177

OrderBookDO uses the WebSocket Hibernation API (acceptWebSocket, auto-response) and keeps subscribers only in an in-memory Map populated in the upgrade branch of fetch(). The Hibernation API explicitly permits evicting the DO from memory while sockets stay connected, which destroys the in-memory map. When the DO is later woken by a POST /update (the queue-consumer update path), broadcast() iterates the now-empty subscribers Map and delivers to nobody, while persistSnapshot() still succeeds, so the update is silently lost and every connected client keeps a stale order book until it reconnects. The sibling WebSocketHubDO explicitly implements hydrateSubscribers() from ctx.getWebSockets() for exactly this scenario (its comment documents that a woken instance 'would otherwise broadcast to nobody'), and VolumeAlertHubDO enumerates ctx.getWebSockets() directly in broadcast(); OrderBookDO has neither mechanism, and the tags passed to acceptWebSocket (poolId) are never read. Given the 5-minute refresh cadence (README line 14), hibernation between updates is the normal operating mode, so this is a routine, user-visible staleness bug for a DEX order book.

recommendation:
Mirror the WebSocketHubDO pattern: enumerate ctx.getWebSockets() in broadcast() (and hydrate the subscribers map on wake), or drop the in-memory map entirely and serialize the subscription state in the socket attachment, filtering per-socket by the poolId tag/attachment.

test analysis:
The included/excerpted tests were omitted from the review context, and unit tests in the vitest workers pool exercise fetch()/webSocketMessage() within a single instance lifetime; they cannot reproduce workerd's eviction-and-wake cycle that destroys the in-memory map.

suggested regression test:
A pool-workers test that (1) upgrades a socket on the DO, (2) simulates eviction by clearing instance memory (or asserts broadcast delivery derives from ctx.getWebSockets() rather than the in-memory Map), and (3) POSTs /update and asserts the socket receives orderbook_update with delivered == 1.

minimum fix scope:
apps/api/src/durable-objects/order-book-do.ts only — make broadcast() enumerate ctx.getWebSockets() (and hydrate the map like WebSocketHubDO.hydrateSubscribers).

repro:
1) Connect a WebSocket to /ws/orderbook/:poolId; receive the initial snapshot. 2) Let the DO idle long enough to be evicted (hibernation). 3) POST an /update to the DO (queue consumer path). 4) The client receives no orderbook_update even though the handler returns { ok: true, subscribers: 0 }.

## high: OrderBookDO loses its subscriber map on hibernation; orderbook updates are silently dropped after wake

id: fnd_sig-feat-library-53a6b417c0-9ee5_edac9b1a19
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source apps/api/src/durable-objects (feat_library_53a6b417c0)

evidence:
- apps/api/src/durable-objects/order-book-do.ts:6
- apps/api/src/durable-objects/order-book-do.ts:46
- apps/api/src/durable-objects/order-book-do.ts:65-69
- apps/api/src/durable-objects/order-book-do.ts:144-154

The class comment (line 6) explicitly opts into the WebSocket Hibernation API, which evicts the DO instance (and all in-memory state) while sockets stay connected. The subscriber registry is an in-memory Map (line 46) populated only in the upgrade handler (lines 65-69). After the instance hibernates, POST /update (line 82) wakes a fresh instance whose subscribers map is empty, so broadcast() (lines 144-154) iterates zero entries and the 'subscribers' count in the /update and /stats responses is wrong — connected clients receive no orderbook updates until they reconnect. Unlike WebSocketHubDO (which implements hydrateSubscribers() at lines 167-177 to rebuild its map from getWebSockets() + attachments), OrderBookDO has no hydration path: webSocketMessage (lines 102-114) and fetch() never call getWebSockets(), and the auto-pong configured at line 52 handles pings without waking the DO, so no event re-populates the map. The sibling DO in the same feature demonstrates this exact failure mode is real and was fixed there, confirming the gap.

recommendation:
Drop the in-memory map and enumerate ctx.getWebSockets() at broadcast time (as VolumeAlertHubDO does), carrying the pool filter in the socket attachment via serializeAttachment, and/or add a hydrateSubscribers() step (mirroring websocket-hub-do.ts lines 167-177) invoked at the start of fetch() and webSocketMessage(). Compute subscriber counts from getWebSockets().length for accurate stats.

test analysis:
No test exists for OrderBookDO; the only DO tests (apps/api/test/siwe-nonce-do.test.ts) cover the nonce DO, and apps/api/test/index.test.ts is a placeholder asserting string concat and 2+2.

suggested regression test:
A vitest-pool-workers test that accepts a WebSocket, hibernates/evicts the instance (or simulates wake on a fresh instance), POSTs /update, and asserts the still-connected socket receives the orderbook_update frame.

minimum fix scope:
apps/api/src/durable-objects/order-book-do.ts

## high: Collect event ABI marks recipient as indexed, so real NonfungiblePositionManager Collect logs fail to decode and are silently dropped

id: fnd_sig-feat-library-ad98bca978-72d5_fa8ee31c30
category: bug
confidence: medium
triage: risk
status: open
feature: Node source apps/api/src/services#2 (feat_library_ad98bca978)

evidence:
- apps/api/src/services/v3-liquidity-events.ts:24-33
- apps/api/src/services/v3-liquidity-events.ts:148-156

The canonical Uniswap V3 NonfungiblePositionManager emits `event Collect(uint256 indexed tokenId, address recipient, uint128 amount0, uint128 amount1)` — only tokenId is indexed and recipient/amount0/amount1 are in the data. The ABI here declares recipient as `indexed: true` (line 29), so viem's decodeEventLog expects a recipient topic that real logs do not carry (2 topics instead of 3) and throws; the catch at lines 163-165 then returns null. Every Collect event is therefore silently dropped from the index, so fee-collection data is lost and the reducer's fees0/fees1 accounting (v3-position-reducer.ts lines 47-52) never accumulates. The included tests cover only IncreaseLiquidity and Mint, so the failure is invisible.

recommendation:
Change the Collect entry in POSITION_MANAGER_ABI so recipient is `indexed: false` (matching the deployed contract), and add a fixture decoding a real Collect log (topics = signature + tokenId, recipient/amount0/amount1 in data).

test analysis:
v3-liquidity-events.test.ts only tests IncreaseLiquidity and pool Mint events; there is no Collect fixture, and any test built from this same (wrong) ABI would encode the bug into the fixture and pass.

suggested regression test:
Encode a Collect log with the canonical ABI (only tokenId indexed) and assert parseV3LiquidityLog returns eventType 'collect' with the correct recipient, amount0, and amount1.

minimum fix scope:
apps/api/src/services/v3-liquidity-events.ts (Collect ABI entry, lines 28-32)

## high: typecheck script depends on tsc from an unsatisfiable peer dependency (typescript ^6)

id: fnd_sig-feat-release-a33c784326-2a6b_5948291298
category: build-release
confidence: medium
triage: risk
status: open
feature: Package script typecheck (@aetherdex/alchemy-infra) (feat_release_a33c784326)

evidence:
- infra/alchemy/package.json:7 (typecheck)
- infra/alchemy/package.json:21-23 (typescript)

The feature's script runs `tsc --noEmit`, but typescript is declared only as a peerDependency with range `^6` (lines 21-23), not a devDependency. As of the TypeScript release train, 6.0 was skipped in favor of the native port shipping as 7.x, so `^6` has no published version satisfying it. bun auto-installs peer dependencies by default, so `bun install` (and any workspace install) fails with an unresolved peer error, and even if install is forced, `tsc` may not resolve from this package, making `bun run typecheck` and every other script in this package.json fail. Even if a TS 6.0 line does exist, a tool required by the package's own scripts belongs in devDependencies, not peerDependencies, so a consumer's typescript version can silently change the typecheck behavior of this package.

recommendation:
Declare typescript as a devDependency with a satisfiable, pinned range (e.g., `^5.9` or whatever stable line exists) and keep any peerDependency range only if the package genuinely exposes typescript types to consumers; then verify `bun install --frozen-lockfile && bun run typecheck` succeeds in a clean checkout.

test analysis:
This feature has no associated tests (tests: []), and the vitest suite does not exercise package.json script resolution or bun's peer-dependency auto-install, so the failure surfaces only during a real install.

suggested regression test:
A CI step that runs `bun install --frozen-lockfile` followed by `bun run typecheck` in infra/alchemy in a clean workspace, failing on any peer-resolution error or missing tsc binary.

minimum fix scope:
infra/alchemy/package.json: move typescript into devDependencies with a satisfiable range (and correct the peer range if retained).

repro:
Run `bun install` in infra/alchemy (or the workspace root) in an environment where no typescript@^6 version is published; install fails on peer resolution, after which `bun run typecheck` cannot resolve tsc.

## medium: 500 responses disclose internal error details via String(err)

id: fnd_sig-feat-route-8a6337af57-f5d18d_d0252d31f1
category: security
confidence: high
triage: confirmed-bug
status: open
feature: Hono route GET /:poolId (feat_route_8a6337af57)

evidence:
- apps/api/src/routes/pools.ts:55-57
- apps/api/src/routes/pools.ts:83-85

Both handlers catch-all errors and return c.json({ error: String(err) }, 500). Effect defects, D1 query failures, and thrown exceptions are serialized verbatim to the API client. D1 errors typically include the failing SQL text, and Effect error causes can include stack traces and internal module paths; this leaks service internals to unauthenticated callers of a public endpoint. The same root-cause pattern appears in both the list and detail handlers, so it is reported once with two evidence refs.

recommendation:
Log the full error server-side (console.error / Worker logging) and return a generic body such as { error: "Internal error" } with status 500; only expose sanitized messages for known, client-relevant failure types.

test analysis:
No test files exist for these routes (feature tests list is empty) and src/routes/pools.ts is omitted from the coverage include list in vitest.config.ts, so the 500-path response body is never asserted.

suggested regression test:
Integration test via @cloudflare/vitest-pool-workers SELF.fetch that forces the pool service to fail (e.g., by injecting a failing DB layer) and asserts the 500 body does not contain the thrown message, SQL text, or stack trace.

minimum fix scope:
Replace String(err) with a generic error body plus server-side logging in both catch blocks in pools.ts.

## medium: Catch-all 503 handler interpolates raw internal error text into the public response body and conflates data failures with outages

id: fnd_sig-feat-route-bd11a92fe4-1bb6a8_6d4717721e
category: security
confidence: high
triage: confirmed-bug
status: open
feature: Hono route GET /price-guard (feat_route_bd11a92fe4)

evidence:
- apps/api/src/routes/price-guard.ts:106-108
- apps/api/src/routes/price-guard.ts:36-45

The route is a public, unauthenticated GET endpoint, yet its catch block returns `Price guard unavailable: ${String(error)}` to the caller. Any error escaping runEffect (Effect defect/error context, stack frames, service names, KV/DB identifiers, or the 'Price guard requires positive finite prices' message thrown by evaluatePriceGuard at line 44) is disclosed verbatim to arbitrary clients, aiding probing of internal structure. Additionally, all downstream failures collapse into one 503: when refreshPrice yields a non-positive/non-finite price (e.g., unsupported token), evaluatePriceGuard throws and the client receives a misleading 'service unavailable' instead of a 4xx/422 indicating the token/price data is unusable, so clients cannot distinguish an unpriced token from a real outage. The error is never logged server-side either, making failures invisible to operators.

recommendation:
Return a generic body (e.g., { error: 'price guard unavailable' }) for 503s, log the real error server-side (console.error), and classify data-level failures separately (e.g., 422 or 400 for tokens without a valid price) so clients can distinguish 'cannot verify' from 'service down'.

test analysis:
apps/api/test/price-guard.test.ts imports only the pure evaluatePriceGuard function and never exercises the route handler or the catch path, so the error-interpolation and status-mapping behavior is entirely untested.

suggested regression test:
Route-level test that forces refreshPrice to fail (and to return a non-positive price) asserting the 503 body contains no internal error text and that the unpriced-token case maps to a distinct status (400/422) rather than 503.

minimum fix scope:
apps/api/src/routes/price-guard.ts lines 86-108 (error classification and sanitized response body).

repro:
GET /price-guard?token0=<valid address>&token1=<valid address>&price=1 where refreshPrice returns 0 or non-finite priceUsd for either token; observe the internal Error message echoed in the 503 body.

## medium: Core indexer service logic (cursor advancement, batch windowing, swapSides, orphan-pool path) has no tests

id: fnd_sig-feat-library-e99f39f7ec-db78_f07b76e783
category: test-gap
confidence: high
triage: test-gap
status: open
feature: Node source apps/api/src/services/:indexer (feat_library_e99f39f7ec)

evidence:
- apps/api/test/services/indexer-events.test.ts:33-160
- apps/api/package.json:15

The only test file included covers parseV4PoolManagerLog and toRawLog, which are pure functions. indexer.service.ts (429 lines) contains the invariants most likely to regress: cursor advanced only after successful persist (persist-before-cursor ordering at lines 384-387), toBlock clamping to head and the fromBlock > head early return, signed amount side mapping in swapSides (amount0 > 0 vs < 0 vs == 0), the pool-missing swap branch, and sequential per-source indexChain behavior. None of these have any test coverage, which is how the data-loss scenario above and sign-handling mistakes would slip through.

recommendation:
Add a service-level test suite using the documented clientFactory injection point (line 38) with a deterministic fake PublicClient and an in-memory/seed D1 binding, covering: cursor resolution from DB vs genesisBlock vs head-10k fallback, cursor advancement order relative to persist failures, swapSides mapping for both signs and the zero case, and the pool-missing swap path.

test analysis:
The existing suite deliberately targets only pure side-effect-free decoders (see file header doc), so none of the service behaviors are exercised.

suggested regression test:
Effect/vitest test driving indexBatch with a fake client: assert that a persist failure leaves the cursor unchanged, that a successful batch advances it to toBlock + 1n, and that swapSides maps (amount0>0, amount1<0) and (amount0<0, amount1>0) to the correct tokenIn/tokenOut/amountIn/amountOut.

minimum fix scope:
apps/api/src/services/indexer.service.ts plus a new test file

## medium: Documented `verified` query parameter is silently ignored by GET / handler

id: fnd_sig-feat-route-98dcbb586b-5d5037_162b6d68e6
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Hono route GET / (feat_route_98dcbb586b)

evidence:
- apps/api/src/routes/tokens.ts:50-58

The handler's own JSDoc advertises the contract `GET /api/v1/tokens?verified=true&search=eth&limit=100`, but the implementation only reads `limit` (lines 56-57) and `search` (line 58); `verified` is never parsed or forwarded to `listTokens`. A client that filters with `verified=true` receives the full unfiltered list with a 200, so the failure is silent: results appear valid but violate the advertised contract. Because this is a public network-facing endpoint (trustBoundaries: user-input, network), silently ignoring a documented filter is a behavioral contract mismatch rather than a documentation nit.

recommendation:
Either implement the `verified` filter (parse `c.req.query("verified")` and pass it through to `listTokens`/the token-list service, or filter the returned list), or remove it from the JSDoc contract so the documented API matches behavior. If filtering is deferred, reject the parameter with 400 when it is present and unsupported, so callers cannot silently receive unfiltered data.

test analysis:
No tests are included for this feature (`tests: []`), and the coverage include list in apps/api/vitest.config.ts (lines 67-83) enumerates other route/service files but omits src/routes/tokens.ts entirely, so the advertised-parameter-vs-implementation mismatch is not exercised.

suggested regression test:
A Vitest request test that calls GET / with `?verified=true` and asserts the response honors the filter (or, until implemented, asserts a 400), plus a test asserting the documented default/limit behavior.

minimum fix scope:
apps/api/src/routes/tokens.ts — parse/forward `verified` in the GET / handler or remove it from the JSDoc and reject unknown documented params.

## medium: Exported money-moving validation logic (pool creation, rebalance position selection) has no unit tests

id: fnd_sig-feat-library-410ea57829-ecc1_d62c829a5f
category: test-gap
confidence: high
triage: test-gap
status: open
feature: Node source apps/web/src/routes (feat_library_410ea57829)

evidence:
- apps/web/src/routes/pools.new.tsx:39-118 (validatePoolCreationForm)
- apps/web/src/routes/positions.tsx:69-74 (selectIndexedPosition)
- apps/web/test/routes/pools.test.tsx:49-81
- apps/web/test/e2e/swap.spec.ts:8-34

validatePoolCreationForm and buildPoolCreationTransactionIntent are exported pure functions encoding financial-critical rules (token ordering, fee/tick-spacing bounds, uint160 sqrt-price range, deadline must be in the future, price-to-sqrtPriceX96 conversion), and selectIndexedPosition is exported from positions.tsx — yet none of the included tests touch them. The existing suite covers list/render components and playground helpers only; the swap page has only rendering smoke tests. Bugs in this validation (e.g., deadline arithmetic, sqrt bounds) would ship to a transaction-preparation flow with no regression protection.

recommendation:
Add unit tests for validatePoolCreationForm (distinct/ordered tokens, fee/tickSpacing caps, sqrtPriceX96 range, price too small to encode, past/equal deadline), buildPoolCreationTransactionIntent encoding, and selectIndexedPosition fallback semantics.

test analysis:
Coverage exists only for PoolsResults, PortfolioResults, playground lib/table, and swap rendering; the exported validators were evidently written for testability but never tested.

suggested regression test:
Table-driven vitest suite over validatePoolCreationForm covering each error branch and a valid case producing a request.

minimum fix scope:
apps/web/src/routes/pools.new.tsx

repro:
Run bun --cwd apps/web run test; no test imports pools.new.tsx or positions.tsx helpers.

## medium: Feature test suite is placeholder-only; the API entry point has no test coverage

id: fnd_sig-feat-library-e12da032c1-e911_b0d24e9714
category: test-gap
confidence: high
triage: test-gap
status: open
feature: Node source apps/api/src (feat_library_e12da032c1)

evidence:
- apps/api/test/index.test.ts:1-11

The test file linked to this feature (and listed as the feature's test with command `bun --cwd apps/api run test`) contains only two trivial assertions: string concatenation and 2+2=4. None of the owned entry point's behavior is exercised: health probes and 503 semantics, CORS origin allow/deny, WebSocket upgrade forwarding, poolId validation and case canonicalization for /ws/orderbook and /ws/alerts, the notFound handler, the onError handler, or the queue/scheduled wiring. Regressions in any of these (e.g. the health status mismatch above, or dropping the canonicalization step that keeps one DO instance per pool) would pass CI undetected.

recommendation:
Replace the placeholder tests with real coverage using the already-declared @cloudflare/vitest-pool-workers devDependency: test /health (healthy and degraded), CORS allow/deny for configured origins, invalid poolId → 400, canonicalized poolId forwarding (uppercase hex input maps to lower-case idFromName), 404 JSON shape, and onError returning a generic 500.

test analysis:
The existing tests assert unrelated trivial behavior and were evidently written as scaffolding; they cannot catch regressions in any code path of apps/api/src/index.ts.

suggested regression test:
Describe suite: (1) `app.request('/health')` with healthy bindings → 200 + status "ok"; (2) with a failing D1 stub → 503 + degraded status; (3) `app.request('/ws/orderbook/0xABC...')` with 64-hex uppercase poolId → request forwarded with lower-cased poolId; (4) invalid poolId → 400.

minimum fix scope:
apps/api/test/index.test.ts

## medium: Feature's only test never imports or exercises any owned component

id: fnd_sig-feat-library-d06274bfb5-8fd2_8aaaa526ea
category: test-gap
confidence: high
triage: test-gap
status: open
feature: Node source apps/web/src/components/ui (feat_library_d06274bfb5)

evidence:
- apps/web/test/index.test.ts:1-14

The test file listed as the feature's associated test is a pure smoke test: it only asserts that vitest globals (describe/it/expect) exist and that window/document exist. None of the five owned components (Button, Card, Input, Stat, or the index barrel) are imported or rendered, so every behavior in this library — loading/disabled handling, variant handling, id generation, className composition — is completely uncovered. Any regression in these components would pass CI. Additionally, the window/document assertion requires a DOM test environment (happy-dom/jsdom), but no vitest environment configuration appears in the included apps/web/package.json, so the suite may fail outright or depend on a repo-level config not visible here.

recommendation:
Add component tests under apps/web/test that import from the ui barrel and render Button, Card, Input, and Stat (e.g., with @testing-library/react, which is already in devDependencies), covering loading disables the button, variant/className composition, and label/input id association. Ensure a vitest environment (happy-dom) is configured for DOM assertions.

test analysis:
The included test deliberately avoids the components — it is a smoke test of the test harness itself, not of the feature.

suggested regression test:
A test file that renders each component via @testing-library/react and asserts: Button with loading disables the button and shows the spinner; Card variant="compact" emits card-compact; Input without id matches label htmlFor to input id; Stat trend="down" emits text-error.

minimum fix scope:
apps/web/test (new test file) plus confirming vitest environment config

## medium: GET /:address has no tests and src/routes/tokens.ts is omitted from vitest coverage include

id: fnd_sig-feat-route-b4cf758698-355fce_1c6539219c
category: test-gap
confidence: high
triage: test-gap
status: open
feature: Hono route GET /:address (feat_route_b4cf758698)

evidence:
- apps/api/vitest.config.ts:67-83
- apps/api/src/routes/tokens.ts:75-96

The feature's tests array is empty. The coverage include list in apps/api/vitest.config.ts (lines 67-83) covers other route files (src/routes/liquidity.ts, src/routes/price-guard.ts, src/routes/v3-quote.ts) and the token-list service (src/services/token-list.service.ts) but omits src/routes/tokens.ts, so the user-input validation (400), 404, 200, and 500 paths of this route are all unguarded. The address param is the riskiest input path in the file (trust boundary user-input), and the untested state is exactly what allowed the checksum/error-handling gaps above to ship.

recommendation:
Add a route-level test suite using @cloudflare/vitest-pool-workers (already configured in vitest.config.ts) exercising the /:address handler: valid checksummed address → 200, unknown address → 404, malformed address → 400, service failure → 500; also add "src/routes/tokens.ts" to the coverage include array.

test analysis:
No tests exist for this feature and the coverage configuration explicitly excludes the file from the include list.

suggested regression test:
Parametrized route test asserting status codes and body shape for: valid EIP-55 address of a listed token (200), unknown checksummed address (404), non-hex and wrong-length addresses (400), and a failing TokenListService (500).

minimum fix scope:
Add apps/api/src/routes/tokens.test.ts and add "src/routes/tokens.ts" to the coverage include in vitest.config.ts.

## medium: GET /:poolId has no tests and pools.ts is missing from vitest coverage include

id: fnd_sig-feat-route-8a6337af57-f1ea6c_9dc9ff296c
category: test-gap
confidence: high
triage: test-gap
status: open
feature: Hono route GET /:poolId (feat_route_8a6337af57)

evidence:
- apps/api/src/routes/pools.ts:63-86
- apps/api/vitest.config.ts:64-83

The feature declares no tests, and the coverage include list enumerates src/routes/liquidity.ts, src/routes/price-guard.ts, and src/routes/v3-quote.ts but omits src/routes/pools.ts entirely. The critical branches of GET /:poolId — regex validation (400), invalid chain config (500), not-found (404), success (200), and the catch-all error path — are therefore unverified; a regression such as dropping the !pool check or weakening the regex would pass CI.

recommendation:
Add a vitest-pool-workers integration test hitting GET /api/v1/pools/:poolId covering malformed id (400), unknown id (404), known id (200), and add src/routes/pools.ts to the coverage include array.

test analysis:
No pools route test file exists in the repository, and the coverage configuration explicitly omits pools.ts while including sibling route files, indicating the route was never added to the test surface.

suggested regression test:
Test using SELF.fetch: malformed poolId (e.g., "0x123") returns 400 with the validation error body; a syntactically valid but nonexistent poolId returns 404; a seeded pool returns 200 with { pool }.

minimum fix scope:
Create apps/api/src/routes/pools.test.ts and add "src/routes/pools.ts" to coverage.include in vitest.config.ts.

## medium: GET /price-guard handler has no route-level tests; all validation and status-code branches are uncovered

id: fnd_sig-feat-route-bd11a92fe4-6bb77d_abea68f1af
category: test-gap
confidence: high
triage: test-gap
status: open
feature: Hono route GET /price-guard (feat_route_bd11a92fe4)

evidence:
- apps/api/test/price-guard.test.ts:1-20
- apps/api/src/routes/price-guard.ts:62-109
- apps/api/vitest.config.ts:75

The only test file imports evaluatePriceGuard and covers just two happy/sad cases of the pure function. The entire HTTP surface — missing-param 400, address-format/sorted-token 400, decimal-regex 400, maxDeviationBps bounds 400, invalid CHAIN_ID 500, 200 vs 422 result mapping, the 503 catch path, DEFAULT_MAX_DEVIATION_BPS defaulting, and the two-token concurrent refresh — is untested. vitest.config.ts line 75 lists src/routes/price-guard.ts in the coverage include set, showing intended coverage that is not actually achieved; the thrown-input branch of evaluatePriceGuard (line 36-45) and the default checkedAt are also untested.

recommendation:
Add integration tests using @cloudflare/vitest-pool-workers (already configured) that exercise the handler through Hono's app.request with mocked PriceService/runEffect, covering each 400 branch, the 200/422 split, the 503 path, and the maxDeviationBps default.

test analysis:
The existing tests only call the exported pure function directly and never construct the Hono app or issue requests, so none of the handler logic (validation, env handling, layer wiring, status mapping) executes.

suggested regression test:
Parameterized route test: app.request('/price-guard?token0=...&token1=...&price=...&maxDeviationBps=...') asserting 400 for each invalid input, 200 for valid guard, 422 for deviation over threshold, and 503 when the service layer throws.

minimum fix scope:
apps/api/test/price-guard.test.ts (add route-level suite).

## medium: Half-open trial admission is not exclusive: concurrent requests all pass as probes, and a failed trial can be masked by a concurrent successful trial

id: fnd_sig-feat-library-7f7e3c5382-592f_e80f87afce
category: concurrency
confidence: high
triage: confirmed-bug
status: open
feature: Node source apps/api/src/middleware (feat_library_7f7e3c5382)

evidence:
- apps/api/src/middleware/circuit-breaker.ts:9-10
- apps/api/src/middleware/circuit-breaker.ts:167-180
- apps/api/src/middleware/circuit-breaker.ts:203-213

The docstring promises 'ONE trial request is admitted' after cooldown, but nothing atomically claims the trial slot. Any request that reads an open/half_open state with elapsed >= cooldown sets trial=true (lines 177-179) and is admitted; the half_open write at line 179 preserves the original openedAt, so every subsequent request during an in-flight (even slow) trial also satisfies the elapsed check and is admitted as another trial. A burst of concurrent requests at cooldown expiry therefore all hit the failing dependency, defeating the recovery probe. Worse, success/failure interleaving can mask a failure: trial A fails and recordFailure(trial=true) writes {status:'open', openedAt:now} (line 102/204), while concurrent trial B succeeds and closeCircuit deletes the state key (lines 211-213); if B's delete lands after A's re-open write, the circuit ends closed despite a fresh 5xx and full traffic resumes against a failing dependency. All included tests drive requests sequentially with awaited posts, so no interleaving is exercised.

recommendation:
Make trial admission single-flight and atomic: claim the probe with a short-TTL marker via a conditional/atomic KV write (or a Durable Object) and return 503 to any request observing an in-flight trial; serialize close/re-open decisions (e.g., re-read state before closeCircuit and only close if still half_open with the same openedAt) so a failed trial cannot be undone by a concurrent success.

test analysis:
circuit-breaker.test.ts awaits each post sequentially (lines 55-97, 100-112, 149-157), so requests never interleave inside the middleware; the half-open tests exercise a single trial at a time and never a concurrent success+failure pair.

suggested regression test:
After opening the circuit and sleeping past cooldown, Promise.all N posts against a failing handler and assert exactly 1 reaches the handler; plus a test running a failing trial and a succeeding trial concurrently and asserting the state key is still present (circuit open) afterward.

minimum fix scope:
apps/api/src/middleware/circuit-breaker.ts — half-open admission path (lines 167-180) and close path (lines 211-213)

repro:
Open the circuit with 3 failing posts, sleep past cooldownSeconds, then fire N concurrent posts against a still-failing handler: all N reach the handler (expected exactly 1). Interleave one failing and one succeeding trial concurrently and observe the final state key absent (circuit closed) even though a trial failed.

## medium: Hand-written calldata ABIs are only regex-tested; ABI drift against deployed contracts would pass CI and revert on-chain

id: fnd_sig-feat-library-9f563d7b60-37eb_84a8638a73
category: test-gap
confidence: high
triage: test-gap
status: open
feature: Node source apps/web/src/lib (feat_library_9f563d7b60)

evidence:
- apps/web/src/lib/v4-liquidity.ts:9-56 (AETHER_ROUTER_ABI)
- apps/web/src/lib/v3-liquidity.ts:255-309 (buildV3SingleSidedZapCall)
- apps/web/test/lib/v3-liquidity.test.ts:44-47
- apps/web/test/lib/v4-liquidity.test.ts:33-35

buildV3SingleSidedZapCall and buildV4SingleSidedCall hand-author tuple ABIs for custom contracts (the zap executor's zap() and AetherRouter.addLiquiditySingleSided) with struct component order, types, and selectors that exist only in this file. The tests assert only that calldata matches /^0x[0-9a-f]+$/ (plus the NFPM multicall selector in one rebalance case) — they never decode the calldata or compare against golden fixtures generated from the actual deployed contract ABIs. A reordered or retyped struct field, a wrong function name, or a drifted selector still encodes successfully and surfaces only as an on-chain revert in production, which is the most expensive possible point of discovery for a calldata builder.

recommendation:
Decode the produced calldata with viem decodeFunctionData against the same ABI and assert every argument value (ticks, amounts, fee, deadline, hookData/salt); add golden calldata fixtures generated from the deployed contracts' ABIs and selector-level assertions (like the existing 0xac9650d8 check) for zap and addLiquiditySingleSided.

test analysis:
The existing tests verify only that encodeFunctionData produced hex; they cannot detect any semantic mismatch between the locally hand-written ABI and the on-chain contract.

suggested regression test:
Assert decodeFunctionData(buildV4SingleSidedCall(...).calldata, AETHER_ROUTER_ABI) returns the exact args object (poolKey fields, liquidityDelta, minAmount0/minAmount1, deadline) for the fixture inputs.

minimum fix scope:
apps/web/test/lib/v3-liquidity.test.ts and apps/web/test/lib/v4-liquidity.test.ts (plus golden fixtures from the contract ABIs).

## medium: MEV private relay accepts cleartext http URLs in safety-config, contradicting the https-only policy enforced in keeper-signer

id: fnd_sig-feat-library-b8af523b91-16d8_75879b5e24
category: security
confidence: high
triage: confirmed-bug
status: open
feature: Node source apps/api/src/lib (feat_library_b8af523b91)

evidence:
- apps/api/src/lib/safety-config.ts:87-96 (readMevProtectionConfig)
- apps/api/src/lib/keeper-signer.ts:81-93 (parseRelayUrl)
- apps/api/src/lib/keeper-signer.ts:468-477

readMevProtectionConfig validates PRIVATE_TX_RELAY_URL with the regex /^https?:\/\//, which accepts cleartext http:// URLs (and even a bare "http://" with no host). The sibling keeper-signer.ts deliberately enforces https-only for the same env var — parseRelayUrl rejects non-https (line 92) and the submission path re-checks the protocol as defense in depth (lines 475-477, 'PRIVATE_TX_RELAY_URL must use https (MEV Tier-B)'). The stated project policy is that 'private submission over cleartext is never allowed' (line 81). A MEV 'private' mode wired to an http relay would send order/signed-tx data over cleartext, exposing it to interception and front-running — exactly the attack the mode exists to prevent — and the two modules would disagree about the same configuration value. The regex also never verifies the URL is actually parseable, so malformed values like 'http://' pass through as a configured relay.

recommendation:
Reuse the same https-only parsing as keeper-signer (new URL + protocol === "https:" check) in readMevProtectionConfig, requiring a valid host, and add unit tests for safety-config.ts covering http, ws, bare 'http://', and malformed values.

test analysis:
keeper-signer.test.ts (lines 82-89) tests parseRelayUrl's https enforcement, but there is no test file for safety-config.ts at all, so the lenient http-accepting regex in readMevProtectionConfig is untested.

suggested regression test:
expect(readMevProtectionConfig({ PRIVATE_TX_RELAY_URL: "http://relay.example" }).privateRelayUrl).toBeNull(); expect(readMevProtectionConfig({ PRIVATE_TX_RELAY_URL: "http://" }).privateRelayUrl).toBeNull(); expect(readMevProtectionConfig({ PRIVATE_TX_RELAY_URL: "https://relay.example" }).privateRelayUrl).toBe("https://relay.example")

minimum fix scope:
apps/api/src/lib/safety-config.ts (readMevProtectionConfig) + new unit tests

repro:
readMevProtectionConfig({ PRIVATE_TX_RELAY_URL: "http://relay.example" }) returns privateRelayUrl = "http://relay.example", whereas readKeeperSignerConfig with the same env value yields privateRelayUrl = null.

## medium: Missing VITE_REOWN_PROJECT_ID fails at runtime with a blank page instead of failing the build

id: fnd_sig-feat-library-782a776077-b4dc_35d544cb18
category: build-release
confidence: high
triage: risk
status: open
feature: Node source apps/web/src (feat_library_782a776077)

evidence:
- apps/web/src/wagmi.tsx:8-11
- apps/web/package.json:8

wagmi.tsx reads import.meta.env.VITE_REOWN_PROJECT_ID and throws at module evaluation time when it is absent. Vite statically replaces import.meta.env.VITE_* during the build, so a missing variable does not fail `tsr generate && vite build`; it becomes undefined and the throw fires at runtime on every page load. Because main.tsx imports ./wagmi at the top of the module graph, the entire app renders as a blank page with only a console error, and CI/deploy pipelines (wrangler pages deploy) will happily ship a broken bundle. The throw is well-intentioned error handling, but its placement (module scope, runtime) turns a configuration mistake into a silent production outage rather than a build-time failure or a rendered error screen.

recommendation:
Validate the variable at build time (e.g., in vite.config.ts or a prebuild script that fails CI) and/or replace the module-scope throw with a rendered fallback screen (error boundary or a small component) so the failure is visible and diagnosable instead of a blank page.

test analysis:
The feature links no tests (tests: []), so the module-load throw path is never exercised; a unit test importing wagmi.tsx without the env var would crash the test runner, which is why the behavior has gone unnoticed.

suggested regression test:
A test that imports a non-throwing variant (or a build-time config check) asserting that a missing VITE_REOWN_PROJECT_ID produces a clear, controlled failure message rather than an uncaught module-scope exception.

minimum fix scope:
apps/web/src/wagmi.tsx (move the guard into an initializer with a graceful failure path) plus optional build-time validation in the Vite config.

repro:
Run `vite build` without VITE_REOWN_PROJECT_ID set: the build succeeds. Serve the output: the page is blank and the console shows 'VITE_REOWN_PROJECT_ID is required...'.

## medium: Missing/invalid CHAIN_ID silently defaults to Sepolia in TP/SL routes and yields NaN chainId in POST /positions

id: fnd_sig-feat-library-09141f3ef9-a51d_034afea42d
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source apps/api/src/routes (feat_library_09141f3ef9)

evidence:
- apps/api/src/routes/tp-sl.ts:35
- apps/api/src/routes/positions.ts:97
- apps/api/src/routes/pools.ts:33-34

TP/SL routes use chainIdFor(c) = Number.parseInt(c.env.CHAIN_ID, 10) || 11155111, so a missing, empty, or non-numeric CHAIN_ID silently falls back to Sepolia (11155111) on every TP/SL endpoint — orders are created, listed, and cancelled against the wrong chain in production without any error, masking the misconfiguration. POST /positions instead passes Number(c.env.CHAIN_ID) directly, which becomes NaN and is written into the record. Sibling routes (pools.ts, price-guard.ts, swap.ts /record) parse with parseChainId and return 500 'Invalid chain configuration', which is the correct behavior; the write paths here should do the same.

recommendation:
Use parseChainId in both files and return 500 'Invalid chain configuration' on null (or a non-safe-integer value), matching pools.ts/price-guard.ts; never fall back to a hardcoded chain.

test analysis:
No TP/SL or positions tests exist; the misconfiguration path is untested.

suggested regression test:
Test that TP/SL and positions handlers return 500 when CHAIN_ID is missing or non-numeric, and never write a fallback chainId.

minimum fix scope:
apps/api/src/routes/tp-sl.ts chainIdFor and apps/api/src/routes/positions.ts POST /positions chainId computation.

repro:
Deploy with CHAIN_ID unset: POST /api/v1/tp-sl/orders succeeds and persists the order with chainId 11155111.

## medium: No automated tests exist for GET /v3/quote despite the route being listed in the coverage config

id: fnd_sig-feat-route-552aaeecba-8fd82a_e652205a02
category: test-gap
confidence: high
triage: test-gap
status: open
feature: Hono route GET /v3/quote (feat_route_552aaeecba)

evidence:
- apps/api/src/routes/v3-quote.ts:18-74
- apps/api/vitest.config.ts:76

The feature metadata lists an empty tests array and no test files were included, yet vitest.config.ts line 76 explicitly includes src/routes/v3-quote.ts in the coverage set, indicating the project intends this route to be tested. The handler contains non-trivial logic that is currently completely unverified: five distinct 400 validation paths (missing params, bad address/amount/fee format, non-positive amount or out-of-range fee, out-of-range slippage), the 503 configuration check, the 404-vs-503 error mapping, the minAmountOut slippage math (BigInt multiplication/division, bps rounding), and the BigInt serialization of amountOut/gasEstimate. A regression in any of these (e.g., a change from 10_000n basis points to 100n) would ship silently.

recommendation:
Add a vitest test suite for this route covering: each 400 path, the 503 env-misconfiguration path, a mocked quote success asserting amountOut/minAmountOut/gasEstimate/protocolFee shape and exact minAmountOut arithmetic (e.g., amountOut=1_000_000n with slippage=0.5 gives 995_000n), the no_pool→404 mapping, and the rpc_error→503 mapping.

test analysis:
No test files are included in the feature (tests: []), so there is nothing covering the route's validation, error mapping, or minAmountOut arithmetic despite the coverage include.

suggested regression test:
apps/api/test/v3-quote.test.ts using the Cloudflare test pool: mount v3Quote with stubbed env (RPC_URL, V3_FACTORY_ADDRESS, V3_QUOTER_ADDRESS), assert 400 for missing/format-invalid params and out-of-range fee/slippage, assert 503 when env unset, inject a V3QuoteService returning a fixed amountOut and assert minAmountOut = (amountOut * (10_000 - round(slippage*100))) / 10_000, and assert 404 for no_pool reason vs 503 otherwise.

minimum fix scope:
Add a test file under apps/api/test covering the route with the Cloudflare vitest pool; no production code change required.

## medium: No test coverage for cron and queue handlers; index.test.ts is a placeholder

id: fnd_sig-feat-library-c77821ce5c-3ad6_c67e8c2737
category: test-gap
confidence: high
triage: test-gap
status: open
feature: Node source apps/api/src/workers (feat_library_c77821ce5c)

evidence:
- apps/api/test/index.test.ts:1-11
- apps/api/src/workers/queue-handler.ts:360-388 (handleTpSlEvaluate)
- apps/api/src/workers/cron-handler.ts:176-295 (runKeeperTick)

The only tests for this feature are cursor-helper tests (v3-indexer-cursor.test.ts) and a placeholder (index.test.ts asserts string concatenation and 2+2). The financially critical logic — dual trigger evaluation (spot/TWAP vs trigger), the authorization gate, keeper tick enqueue/expiry, poolSpot derivation, and the auto-recenter decision — has zero coverage. The visible evidence shows several of these paths are dead or fragile (no tick field, top-50 poolSpot dependency), which tests would have caught.

recommendation:
Add unit tests for the trigger-condition matrix (take_profit/stop_loss × zeroForOne × spot/TWAP), toScaledBigInt, keeper tick enqueue/expire behavior, and handler skip paths; replace the placeholder index.test.ts.

test analysis:
The listed tests only cover v3-indexer-cursor helpers; no test imports cron-handler or queue-handler.

suggested regression test:
Parameterized tests over the four trigger branches asserting isTriggered, plus a keeper-tick test with mocked D1 asserting enqueue and expiry side effects.

minimum fix scope:
apps/api/test/

## medium: No tests cover the new POST /deposit-estimate route despite it being in the coverage include list

id: fnd_sig-feat-route-c733a805a5-0143d2_4fec1c6fad
category: test-gap
confidence: high
triage: test-gap
status: open
feature: Hono route POST /deposit-estimate (feat_route_c733a805a5)

evidence:
- apps/api/vitest.config.ts:64-84
- apps/api/src/routes/liquidity.ts:75-94

The feature declares zero tests (tests: [] and omittedFiles: [] in the review context), but vitest.config.ts explicitly lists src/routes/liquidity.ts in the coverage include set (line 74), signaling tests are expected for this file. The route encodes contract-critical semantics: the file header (lines 9-15) states estimates and slippage min-amount bounds must be derived from the NET values this endpoint returns and that gross/net semantics must match AetherRouter. A regression in fee math or in the single-sided/MAX_INPUTS validation would silently mislead clients that build router calldata and slippage bounds from this endpoint's response, with financial impact. None of the validation paths (malformed JSON, missing amounts, bad mode, >8 entries, single-sided with != 1 entry, non-digit grossAmount, BigInt overflow, non-address token) or the fee-breakdown contract are exercised by any included test.

recommendation:
Add a test file for this route (e.g. apps/api/test/routes/liquidity.test.ts) using the Cloudflare vitest pool: assert 200 responses with correct net-after-fee amounts for add_liquidity (multiple inputs) and add_liquidity_single_sided (exactly one input), and 400 responses for each rejection path, including grossAmount that overflows BigInt and token address format errors.

test analysis:
No test files exist for this route; the feature's tests list is empty and no test files were included in the review. The coverage config lists the file, but coverage configuration is not a test.

suggested regression test:
POST /deposit-estimate with { mode: 'add_liquidity', amounts: [{ grossAmount: '1000000' }] } asserting protocolFee.netAmount = 999000 (0.1% entry fee), plus 400 cases for { amounts: [] }, { amounts: 8+ entries }, single-sided with 2 entries, grossAmount 'abc', grossAmount exceeding uint256/BigInt range, and token '0x123'.

minimum fix scope:
Add route-level tests under apps/api/test covering the handler's success and 400 paths.

## medium: No tests exist for the authentication flow (session validation, SIWE verify, nonce consumption)

id: fnd_sig-feat-library-bd573b816b-9e6e_0bb5ee551c
category: test-gap
confidence: high
triage: test-gap
status: open
feature: Node source apps/api/src/auth (feat_library_bd573b816b)

evidence:
- apps/api/src/auth/siwe.ts:63-144
- apps/api/src/auth/middleware.ts:24-73
- apps/api/src/auth/routes.ts:17-72

The feature metadata lists tests: [] and no test files were included for this source group. This is security-critical code: session lifecycle (issue → verify → store → validate → delete), nonce one-time consumption via Durable Objects, signature verification, and time/chain/domain binding. There is no regression coverage for replay rejection, expired/invalid session handling, chainId mismatch, or malformed session JSON. A regression in any of these paths (e.g., weakening the middleware validation or the nonce-consumption check) would ship silently since no tests exercise them. package.json does define a vitest test script, so the harness exists but this module is uncovered.

recommendation:
Add vitest/cloudflare-pool-workers tests covering: happy-path verify → session readable via /me; reusing the same nonce twice fails; expired session JSON is rejected and deleted from KV; wrong chainId/domain/uri in message fails; malformed session JSON falls through to 401 on requireAuth; logout deletes the session so /me then returns 401.

test analysis:
No test files exist for this source group (tests: [] in feature metadata); the vitest infrastructure is configured in apps/api/package.json but nothing covers apps/api/src/auth.

suggested regression test:
verifyAndCreateSession: issue nonce, verify with valid signature, assert second verify with the same (message, signature) fails with invalid/expired nonce; authMiddleware: write a session with expiresAt in the past into KV and assert requireAuth returns 401 and the KV key is removed.

minimum fix scope:
apps/api/src/auth (new test files)

## medium: No tests for PoolStats despite non-trivial branching logic (chain filtering, pair selection, formatting)

id: fnd_sig-feat-ui-flow-96f77c54e9-ecf0_2f85b21218
category: test-gap
confidence: high
triage: test-gap
status: open
feature: React component PoolStats (feat_ui-flow_96f77c54e9)

evidence:
- apps/web/src/components/PoolStats.tsx:38-62 (PoolStats)
- apps/web/package.json:11

PoolStats contains meaningful, untested logic: chainId-based pair filtering with a fixed chain map (lines 47-56), highest-liquidity pair selection (line 59), null/undefined field fallbacks, three distinct render states (loading 64-75, empty/error 77-85, data 87-123), and two formatters. Feature metadata reports tests: [] and the review bundle included no test files. The project is fully set up for component testing (vitest, @testing-library/react, happy-dom in apps/web/package.json), so the gap is coverage, not infrastructure.

recommendation:
Add apps/web/src/components/PoolStats.test.tsx stubbing global fetch, covering: loading state, `pairs: null`, `pairs: []`, chain filtering selecting the right chain, pair selection picking max liquidity, and formatUsd/formatChange edge values (0, <1000, 1000+, 1M+).

test analysis:
No test files exist for this feature; the component ships untested logic.

suggested regression test:
Render PoolStats with a stubbed fetch returning two pairs on different chains plus one pair with liquidity null, assert the displayed pair is the highest-liquidity one for the given chainId.

minimum fix scope:
New test file only; no production code change required.

## medium: No tests for PriceTicker or its formatting helpers

id: fnd_sig-feat-ui-flow-48e197d8fd-9863_1e020db096
category: test-gap
confidence: high
triage: test-gap
status: open
feature: React component PriceTicker (feat_ui-flow_48e197d8fd)

evidence:
- apps/web/package.json:11-13
- apps/web/src/components/PriceTicker.tsx:28-44
- apps/web/src/components/PriceTicker.tsx:46-123

Feature metadata reports tests: [] and no test file was included, even though vitest, @testing-library/react, and happy-dom are configured (package.json scripts and devDependencies). The pure formatting functions (lines 28-44) and the envelope-filtering/error/staleness logic (lines 46-123) are entirely uncovered; the bugs in the other findings (stale data on prop change, crashes on malformed payloads, sub-1e-8 price display) would all have been caught by basic unit/RTL tests.

recommendation:
Add unit tests for formatPrice/formatPercent/formatVolume and RTL tests covering: envelope filtering by tokenAddress, error branch, volume toggle, placeholder rendering, and data reset on token change.

test analysis:
This finding is the gap itself: feature metadata lists tests: [] and no test file exists in the included files.

minimum fix scope:
apps/web/src (new test file next to PriceTicker.tsx)

## medium: No tests or test script for the shared API-contract package

id: fnd_sig-feat-library-b3899aac05-7d0f_48dcad4a96
category: test-gap
confidence: high
triage: test-gap
status: open
feature: Node package @aetherdex/shared (feat_library_b3899aac05)

evidence:
- packages/shared/package.json:11-15
- packages/shared/src/schema.ts:3-35 (PoolSchema)

The scripts block defines only typecheck, lint, and lint:fix — there is no test script, no vitest (the project's detected test framework) devDependency, and the feature metadata lists zero tests. This package is the single source of truth for the cross-service wire contract (Pool/Token schemas, ListPools RPC payload/response), so any schema drift or malformed-decode regression propagates silently to every consumer (API, indexer, UI) with no guard.

recommendation:
Add a `test` script (e.g. `vitest run`) plus a vitest devDependency, and add unit tests that encode/decode each schema against representative fixtures and assert decode failures for malformed payloads.

test analysis:
No tests exist anywhere in the package (no test script, no test files, no test devDependency), so there is nothing covering the schema contracts.

suggested regression test:
A vitest test that decodes a full Pool fixture through PoolSchema and asserts the result matches the input, plus negative cases asserting failure for a missing field and a non-string sqrtPriceX96.

minimum fix scope:
packages/shared/package.json (scripts + devDependencies) and a new test file under packages/shared/src/__tests__/

## medium: Non-atomic KV read-modify-write in rate limiter and circuit breaker lets concurrent requests bypass limits and lose failure counts

id: fnd_sig-feat-library-a50e9b911f-4b29_eda4a97f2c
category: concurrency
confidence: high
triage: confirmed-bug
status: open
feature: Node package @aetherdex/api (feat_library_a50e9b911f)

evidence:
- apps/api/src/middleware/rate-limit.ts:86-97
- apps/api/src/middleware/circuit-breaker.ts:107-129

Both middlewares implement counters as KV getWithMetadata → compute → put with no atomicity (Workers KV has no CAS or increment). Concurrent requests in the same window all read the same stale count and overwrite each other, losing increments: consumeRateLimit() admits a burst of concurrent requests all seeing count 0/59, so the effective limit becomes max + concurrency; recordFailure() likewise under-counts a burst of 5xx, so the breaker opens later than failureThreshold failures (or not at all during the burst). A second race exists in the breaker's half-open admission: several requests can read state 'open' past cooldown before any writes 'half_open', admitting multiple probe requests instead of one. Impact is protection bypass under load — precisely the conditions these middlewares exist for.

recommendation:
Move counters to a Durable Object (per-caller or per-breaker) with blockConcurrencyWhile for atomic increments, or accept and document the approximate enforcement; for the breaker, at minimum re-read the state/count immediately before opening and treat half-open admission under a single-flight guard.

test analysis:
Tests (circuit-breaker.test.ts, mev-protection.test.ts, etc.) exercise sequential requests; reproducing the lost-update race requires concurrent interleaving, which the KV-backed design makes non-deterministic.

suggested regression test:
Promise.all of N concurrent consumeRateLimit(kv, key, {max:1}) calls asserting exactly one is allowed (currently fails); for the breaker, N concurrent recordFailure calls with threshold 5 asserting the circuit opens exactly once.

minimum fix scope:
apps/api/src/middleware/rate-limit.ts and apps/api/src/middleware/circuit-breaker.ts — replace KV counter increments with an atomic primitive (DO) or document the race and cap burst exposure.

repro:
Fire N concurrent POSTs to a rate-limited route with max=1 and a fresh KV counter: all N pass because each reads count 0 and writes 1. Similarly, trigger 10 concurrent 5xx responses with failureThreshold=5: the stored count ends up well below 5 and the circuit does not open.

## medium: Non-atomic KV read-modify-write on counters lets concurrent requests exceed the configured rate limit and delays circuit-breaker trips

id: fnd_sig-feat-library-7f7e3c5382-02a3_dee30d1d51
category: concurrency
confidence: high
triage: confirmed-bug
status: open
feature: Node source apps/api/src/middleware (feat_library_7f7e3c5382)

evidence:
- apps/api/src/middleware/rate-limit.ts:86-97
- apps/api/src/middleware/circuit-breaker.ts:107-123

consumeRateLimit (rate-limit.ts) and recordFailure (circuit-breaker.ts) both perform getWithMetadata followed by put with no atomicity; Cloudflare KV offers no CAS or increment, and workerd interleaves requests at await points. Two concurrent requests can read the same count and both write count+1 (lost update). For the rate limiter this is a control bypass: with RATE_LIMIT_MAX=2, three concurrent requests can each read 0 and each write 1, so all three are allowed against a limit of 2 — exactly the burst the limiter protects high-value mutation endpoints from. For the breaker, two concurrent failures can both read count=1 (threshold 3) and both write 2, so the circuit trips one failure late (and can miss the threshold entirely if the failures TTL expires in between). The documented fail-open behavior covers KV errors only, not lost updates.

recommendation:
Serialize per-key counter updates, e.g., a Durable Object per caller/breaker used as an atomic counter, or a single DO sharded by key; alternatively detect and merge concurrent writes via the metadata timestamp. At minimum document that limits are approximate under concurrency.

test analysis:
rate-limit.test.ts posts sequentially and awaits each response (lines 38-55, 58-66), so the get/put interleaving never occurs; the KV-error test (lines 113-122) covers fail-open on errors only, not the lost-update path.

suggested regression test:
With RATE_LIMIT_MAX=2, Promise.all 3 posts against the same IP bucket and assert no more than 2 succeed.

minimum fix scope:
apps/api/src/middleware/rate-limit.ts consumeRateLimit (and optionally circuit-breaker.ts recordFailure)

repro:
Set RATE_LIMIT_MAX=2 and fire 3 concurrent POSTs from the same caller bucket; observe 3x 200 (expected at most 2x 200).

## medium: Out-of-order search responses can overwrite newer results (no abort or stale-response guard)

id: fnd_sig-feat-ui-flow-cfc2470a11-f672_21a1a6a5aa
category: concurrency
confidence: high
triage: confirmed-bug
status: open
feature: React component TokenSearch (feat_ui-flow_cfc2470a11)

evidence:
- apps/web/src/components/TokenSearch.tsx:122-143 (searchTokens)
- apps/web/src/components/TokenSearch.tsx:145-151
- apps/web/src/components/TokenSearch.tsx:212-229
- apps/web/src/lib/api.ts:49-53 (FetchTokensOptions)
- apps/web/src/lib/api.ts:66

searchTokens issues Effect.runPromise requests with no AbortSignal and no request sequencing, and the debounce effect only clears the timer — it never cancels an already in-flight request. If the response for an older query resolves after the response for a newer query, its setResults call overwrites the newer results (stale data shown for the current query). Similarly, clearing the input while a request is in flight leaves the stale results populated; since results.map (lines 212-219) renders unconditionally when the dropdown is open, stale rows appear alongside the default list (and duplicate <li key=address> keys when the same tokens are in both lists). The API layer already supports AbortSignal (FetchTokensOptions.signal passed to fetch at line 66), so the component could abort on query change/unmount, but never does.

recommendation:
Create an AbortController per search and abort the previous request when the query changes or the component unmounts (pass signal into fetchTokens/fetchTokenByAddress), and/or track a monotonically increasing request id and ignore responses that are not from the latest query. Also clear results when the query is cleared.

test analysis:
The test mock (lines 43-60) resolves fetch promises immediately and deterministically, so responses can never interleave; no test uses deferred promises or rejects a stale response.

suggested regression test:
Mock fetch with deferred promises per request URL; type query A, then query B; resolve B first, then A; assert results reflect B. Also: type a query, clear input before resolving, assert no rows are shown and no duplicate-key list entries appear.

minimum fix scope:
apps/web/src/components/TokenSearch.tsx

repro:
Type a slow query (e.g. 'W' against a throttled network), then quickly type a second query; if the first response resolves after the second, the list reverts to the first query's results. Equivalently: type 'WETH', and before the response arrives, clear the input — the stale WETH rows remain visible with an empty query.

## medium: packageManager pinned to floating 'bun@canary' tag makes builds non-reproducible and may violate the declared engines range

id: fnd_sig-feat-release-4862937c51-39f0_d261f7e125
category: build-release
confidence: high
triage: risk
status: open
feature: Package script lint (feat_release_4862937c51)

evidence:
- package.json:40 (packageManager)
- package.json:37 (engines)

The packageManager field pins the toolchain to `bun@canary`, a moving, unstable channel rather than a concrete version. Every install/CI run can resolve to a different canary build, so all scripts (including the lint script under review) are not reproducible across machines or over time, and a breaking canary can fail CI with no repo change. Additionally, canary version numbers are typically below current stable releases, so the pin may not satisfy the declared `engines.bun >=1.4.0` requirement, an internal contract conflict. This affects every script in the monorepo since they all run through bun, making it a release/build hazard for the release-kind feature under review.

recommendation:
Pin a concrete stable version, e.g. `"packageManager": "bun@1.4.x"` (or the current stable release), and keep `engines.bun` consistent with the pinned version; a floating `@canary` tag is not acceptable for a release pipeline.

test analysis:
The feature declares no tests, and a version-pinning/reproducibility problem would not be observable from functional tests of the lint command itself; it only manifests across installs and CI runs.

suggested regression test:
A CI check that runs the pinned package manager (e.g., `bun --version` after install) and asserts the resolved version is an exact, stable version matching the packageManager field rather than a canary build.

minimum fix scope:
Single-line change to package.json line 40 pinning a stable bun version (and aligning line 37 if needed).

## medium: packageManager pinned to floating bun@canary tag — non-reproducible toolchain

id: fnd_sig-feat-library-b4cb74367c-bdcc_1ddffa40cd
category: build-release
confidence: high
triage: risk
status: open
feature: Node package aetherdex (feat_library_b4cb74367c)

evidence:
- package.json:40
- AGENTS.md:58

`"packageManager": "bun@canary"` references a moving canary tag, not a pinned version. AGENTS.md line 58 claims the canary is "pinned via packageManager: bun@canary" and defers recording the exact build to tooling/scripts/VERSIONS.md — but a floating tag means different machines and different CI runs resolve different Bun builds, so installs, lockfile handling, and script behavior can drift across environments; this is the opposite of a pin. The engines field (package.json line 37, `bun >=1.4.0`) adds further slack, and the canary range is not covered by a lockfile.

recommendation:
Pin an exact build (e.g., bun@1.4.x-canary.<build> or a released version) in packageManager, and record the resolved `bun --version` output in tooling/scripts/VERSIONS.md as AGENTS.md already intends, ideally with a CI check that the installed Bun matches the recorded version.

test analysis:
Toolchain reproducibility is not exercised by unit tests; nothing in the test suite verifies the resolved Bun version.

minimum fix scope:
package.json

## medium: packageManager pins floating bun@canary dist-tag, making installs non-reproducible

id: fnd_sig-feat-config-7528cb5b98-8dde9_c52dfe5fa1
category: build-release
confidence: high
triage: risk
status: open
feature: Project config package.json (feat_config_7528cb5b98)

evidence:
- package.json:40

`"packageManager": "bun@canary"` resolves to the floating `canary` dist-tag on npm, not a concrete version. Every fresh install (CI, new contributor machine) can fetch a different canary build, and canary releases are pre-release snapshots that can break tooling behavior at any time. The lockfile pins dependencies but not the package manager itself, so CI and local builds are not reproducible, and a broken canary can wedge installs for the whole monorepo. `engines.bun` (>=1.4.0) only sets a floor and does not constrain the canary tag.

recommendation:
Pin a concrete package manager version, e.g. `"packageManager": "bun@1.4.0"` (or a specific canary build hash if a pre-release is truly required), and enforce it in CI by verifying `bun --version` matches before `bun install`.

test analysis:
No tests are included for this feature; package.json toolchain pinning is not exercised by the vitest suite.

suggested regression test:
A config-validation test or CI step that reads package.json and asserts the packageManager value is an exact version (no 'canary', 'latest', or range tag).

minimum fix scope:
package.json line 40

## medium: POST /api/v1/positions records positions with no format validation (poolId, tokenId, ticks, liquidity, protocol)

id: fnd_sig-feat-library-09141f3ef9-44fa_110f162385
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source apps/api/src/routes (feat_library_09141f3ef9)

evidence:
- apps/api/src/routes/positions.ts:75-106

The POST /positions handler only checks field presence: poolId is not matched against any address/poolKey pattern (sibling routes require /^0x[a-fA-F0-9]{64}$/ or {40}), tickLower/tickUpper are not checked to be integers or in range, liquidity is not checked to be a non-negative uint string, tokenId is unchecked, and protocol is not validated to be 'v3'|'v4' despite the type annotation. Garbage or fabricated values (e.g. tickLower=1.5, liquidity='not-a-number', protocol='v5') are persisted to D1 and served back by the public GET positions endpoint, polluting the index with rows that the on-chain reconcile endpoints will later contradict.

recommendation:
Add runtime validation matching sibling routes: poolId against the 64-hex poolKey pattern (or address pattern), integer ticks, liquidity as a non-negative integer string, tokenId as digits when provided, protocol within {v3,v4}; return 400 on failure.

test analysis:
No positions route tests exist in the included scope; the sole test covers only the price-guard helper.

suggested regression test:
Route test asserting malformed poolId/tick/liquidity/protocol bodies return 400 and are never passed to PositionService.

minimum fix scope:
apps/api/src/routes/positions.ts POST /positions handler.

repro:
POST /api/v1/positions with body {poolId:'garbage', tickLower:1.5, tickUpper:2.5, liquidity:'abc', protocol:'v5'} returns 200 and persists the row.

## medium: Root vitest config only runs apps/web tests; documented 'all workspaces' test command silently skips the backend

id: fnd_sig-feat-library-b4cb74367c-d02e_c0a6bb8709
category: test-gap
confidence: high
triage: test-gap
status: open
feature: Node package aetherdex (feat_library_b4cb74367c)

evidence:
- vitest.config.ts:3-7
- package.json:10-11
- AGENTS.md:141

vitest.config.ts scopes all test runs to projects: ["./apps/web"]. The root `test` and `test:coverage` scripts therefore execute only the web workspace's tests, while AGENTS.md line 141 documents `bun run test` as "vitest run (all workspaces)" and AGENTS.md line 343 requires >70% backend coverage. Tests in apps/api (and any other workspace) never run via the documented command, and `passWithNoTests: true` makes a zero-test run exit 0, so the omission is completely silent — CI can be green with the backend suite never executed.

recommendation:
List every test-bearing workspace in vitest.config.ts projects (e.g., projects: ["./apps/web", "./apps/api"] or a glob), and drop passWithNoTests (or set it per-project) so empty/missing suites fail loudly. Add a root project or CI step that asserts the expected projects are configured.

test analysis:
The misconfiguration causes the test command to skip suites while still succeeding, so no failing test can surface it — the gap is in the runner configuration itself, not in any test body.

suggested regression test:
A small root vitest project that imports the vitest config and asserts every workspace directory containing a vitest config (or test files) — at minimum apps/api — appears in the projects list.

minimum fix scope:
vitest.config.ts

## medium: Shared contract package has no tests and no test script

id: fnd_sig-feat-library-dab264ab2a-bb1d_4c462f7710
category: test-gap
confidence: high
triage: test-gap
status: open
feature: Node source packages/shared/src (feat_library_dab264ab2a)

evidence:
- packages/shared/src/schema.ts:3-69 (PoolSchema)
- packages/shared/src/rpc.ts:5-10 (ListPools)
- packages/shared/package.json:11-15

This package is the typed wire contract between RPC client and server, and the Effect schemas perform runtime encode/decode at the boundary. The feature owns no tests (tests: []), and the package.json scripts define only typecheck/lint/lint:fix — no test script — so nothing verifies that each schema round-trips (encode → decode) or that the RpcGroup definition is valid against the pinned Effect API. Any schema drift between the server implementation and these definitions fails only at runtime on real traffic, not in CI.

recommendation:
Add a test script (e.g. bun test) and schema round-trip tests using Schema.encodeSync/decodeUnknownSync for PoolSchema, TokenSchema, ListPoolsPayloadSchema, and the response schemas, plus a smoke test that Rpc.make/RpcGroup.make construct successfully.

test analysis:
No tests are included in this feature and no test script exists in packages/shared/package.json, so schema/RPC correctness is entirely unverified.

suggested regression test:
Round-trip test: encode a Pool object with Schema.encodeSync(PoolSchema) then decode with Schema.decodeUnknownSync(PoolSchema) and assert equality; likewise for a ListPools payload and the ListPools RPC success schema.

minimum fix scope:
Add tests and a test script under packages/shared; no production code change required.

## medium: Stale in-flight search responses can overwrite newer TokenSearch results

id: fnd_sig-feat-library-d9ae9adbfb-6432_a3456fca40
category: concurrency
confidence: high
triage: confirmed-bug
status: open
feature: Node source apps/web/src/components (feat_library_d9ae9adbfb)

evidence:
- apps/web/src/components/TokenSearch.tsx:122-151 (searchTokens)
- apps/web/src/components/TokenSearch.tsx:105-120

The debounced search effect (lines 145-151) clears its timer on query change but does not cancel or sequence the in-flight fetch started by the previous timer. searchTokens (lines 122-143) unconditionally calls setResults and setIsSearching(false) when its promise settles, regardless of whether a newer query has already been issued. If the response for an older query ('US') resolves after the response for a newer query ('USD'), the stale results overwrite the newer ones, and the finally block can clear the searching flag while the newer request is still pending, so the dropdown can display results that do not match the current input. The default-list effect (lines 105-120) uses a 'cancelled' flag for exactly this problem, but the search path does not, so the pattern is internally inconsistent.

recommendation:
Guard searchTokens with a request sequence number or AbortController: capture a monotonically increasing request id (or abort the previous fetch) before each call, and ignore setResults/setIsSearching from any response whose id is not the latest. The cleanup in the debounce effect should also invalidate the in-flight request.

test analysis:
TokenSearch.test.tsx mocks fetch as an instant resolver and types queries sequentially; no test simulates overlapping in-flight requests with out-of-order resolution, so the race is never exercised.

suggested regression test:
A test that returns manually-controlled deferred promises from the fetch mock, types 'US' then 'USD', resolves the 'US' request after 'USD', and asserts the rendered list matches 'USD' and the spinner state reflects the newest request.

minimum fix scope:
apps/web/src/components/TokenSearch.tsx (searchTokens and the debounce effect only)

repro:
Mock fetch with manually resolved deferred promises: type 'US' (slow request), then type 'USD' (fast request), then resolve the 'US' promise after the 'USD' promise; the list shows tokens matching 'US' while the input says 'USD'.

## medium: Stale price from the previous token remains displayed after tokenAddress/chainId change

id: fnd_sig-feat-ui-flow-48e197d8fd-dd44_90db1c1d39
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component PriceTicker (feat_ui-flow_48e197d8fd)

evidence:
- apps/web/src/components/PriceTicker.tsx:66-76
- apps/web/src/components/PriceTicker.tsx:93-100
- apps/web/src/components/PriceTicker.tsx:102-109

The `data` state is only ever assigned, never cleared or keyed to the current subscription. When `tokenAddress` (or `chainId`) changes, the WS URL changes (line 59) and useWebSocket reconnects, but `data` retains the previous token's payload. Until an envelope for the new token arrives, lines 107-119 render the old token's price/change/volume as if current — mislabeled financial data. Additionally, the error branch at line 93 requires `!data`, so a failed connection for the new token is hidden while the stale price keeps being displayed (only the connection dot turns warning).

recommendation:
Reset the payload state whenever the subscription identity changes, e.g. add `useEffect(() => setData(null), [tokenAddress, chainId, wsUrl])` (or key the state to the token), so the ticker shows the placeholder while reconnecting and never labels an old token's price as the new one.

test analysis:
Feature metadata reports tests: [] and no test file was included; no component test exercises prop-change behavior.

suggested regression test:
RTL test: render with token A, deliver A's envelope, assert price shown; rerender with token B without delivering B's envelope; assert the placeholder "—" (not A's price) is displayed.

minimum fix scope:
apps/web/src/components/PriceTicker.tsx

repro:
Render PriceTicker with token A, deliver an envelope for A so a price shows, then re-render with token B without delivering any B envelope: the UI keeps showing A's price and change24h.

## medium: Stale swap quote expiry (expiresAt) is never enforced before building/signing the transaction

id: fnd_sig-feat-library-410ea57829-7e83_dcfc48dbbc
category: security
confidence: high
triage: confirmed-bug
status: open
feature: Node source apps/web/src/routes (feat_library_410ea57829)

evidence:
- apps/web/src/routes/swap.tsx:16-27 (SwapQuote)
- apps/web/src/routes/swap.tsx:110-148 (handleSwap)

The SwapQuote interface declares expiresAt and the quote endpoint returns it, but handleSwap never checks it against Date.now() before POSTing the quote to /build and signing the resulting transaction. A user can leave the page open past the quote expiry and execute a swap at a price that no longer matches the displayed rate; the on-chain minAmountOut derived from the stale quote bounds the damage to the user's chosen slippage, but a quote that is minutes old can silently execute at a materially worse rate than shown, or revert (wasting gas) if price moved beyond the bound. This is a standard DEX frontend correctness/funds-safety gap: the expiry field exists precisely to prevent it and is dead code today.

recommendation:
Before calling /build (and ideally again before sendTransaction), verify quote.expiresAt * 1000 > Date.now() and abort with a 'Quote expired — refresh' error; alternatively re-fetch the quote when it is within a short window of expiry.

test analysis:
The only swap tests are e2e rendering smoke tests (apps/web/test/e2e/swap.spec.ts lines 8-34) that never exercise the signing flow or quote lifecycle.

suggested regression test:
Unit test handleSwap (or an extracted helper) with an expired quote and assert it rejects without calling /build or sendTransaction.

minimum fix scope:
apps/web/src/routes/swap.tsx

repro:
Fetch a quote, wait longer than expiresAt, click Swap; the flow proceeds to wallet signing without any expiry warning or re-quote.

## medium: Stale WebSocket close event can trigger reconnect with the old URL and orphan the live socket after effect re-run

id: fnd_sig-feat-library-67e36e39d1-d752_4d281bf4a2
category: concurrency
confidence: high
triage: confirmed-bug
status: open
feature: Node source apps/web/src/hooks (feat_library_67e36e39d1)

evidence:
- apps/web/src/hooks/useWebSocket.ts:95-109
- apps/web/src/hooks/useWebSocket.ts:62-70
- apps/web/src/hooks/useWebSocket.ts:131-134

When the effect re-runs (url/reconnectAttempts/reconnectInterval change, or React StrictMode double-mount in dev), the cleanup sets mountedRef.current=false and calls ws.close(), then the new effect body synchronously sets mountedRef.current=true and creates a new socket assigned to wsRef.current. The old socket's onclose event fires asynchronously after this, and its guard only checks mountedRef (now true), so the stale handler proceeds: it fires onCloseRef spuriously, increments reconnectCountRef, and schedules setTimeout(connect, delay) using the closure captured from the previous effect run, i.e. the OLD url. When that timer fires, connect() creates another socket and overwrites wsRef.current, orphaning the currently-live socket — which is then never closed by cleanup (connection leak) while still delivering messages that overwrite state.data. The handler never verifies that the closing socket is still wsRef.current, and the reconnect timer is not guarded by a generation counter. In dev with StrictMode this reproduces on every mount (2–3 sockets per mount); in prod it triggers on url changes.

recommendation:
Capture the socket instance in the onclose/onopen/onmessage handlers and bail out when wsRef.current !== ws; additionally use a monotonically increasing connection generation/epoch (or the effect run itself) to ignore events and reconnect timers from superseded connections, and clear reconnectTimerRef when the timer fires.

test analysis:
MockWebSocket.close is a vi.fn() that never dispatches an onclose event (test lines 12-19), and no test re-renders the hook with a different url while a socket is open, so the stale-close/reconnect path is never exercised; the unmount test only asserts close() was called.

suggested regression test:
Render the hook, wait for open, re-render with a new url, then simulate the old instance's onclose firing afterwards; assert no additional WebSocket instance is created, wsRef still targets the new url socket, and reconnectCount is not incremented.

minimum fix scope:
apps/web/src/hooks/useWebSocket.ts

repro:
Mount a component using useWebSocket with StrictMode (or change the url prop while connected); the first socket's close event fires after the remount, scheduling a reconnect to the old URL and creating a second connection that replaces wsRef.current, leaving the first new socket open and unreferenced.

## medium: Three of four Durable Objects (order book, websocket hub, volume alert hub) have zero test coverage; the only generic test is a placeholder

id: fnd_sig-feat-library-53a6b417c0-09c5_1e48cdeda6
category: test-gap
confidence: high
triage: test-gap
status: open
feature: Node source apps/api/src/durable-objects (feat_library_53a6b417c0)

evidence:
- apps/api/test/index.test.ts:1-11
- apps/api/test/siwe-nonce-do.test.ts:4-23
- apps/api/package.json:15

The feature's WebSocket fan-out logic — hibernation-safe broadcast, per-socket filters, subscription bookkeeping — is entirely untested. apps/api/test/index.test.ts contains only placeholder assertions ('string concat works', 'basic math works') and does not exercise any DO. Only SiweNonceDO has real tests. The hibernation-state bugs found in order-book-do.ts and websocket-hub-do.ts exist precisely because the wake-after-idle path is never exercised. VolumeAlertHubDO's pool-filtered fan-out (lines 126-140) and WebSocketHubDO's watched-key filtering (lines 196-212) are also unverified.

recommendation:
Add vitest-pool-workers tests covering: WebSocket upgrade + receive of update frames, per-pool/per-token filtering, subscribe/unsubscribe persistence via attachments, and wake-after-hibernation broadcast for all three DOs (the harness already exists, per @cloudflare/vitest-pool-workers in package.json and siwe-nonce-do.test.ts). Replace the placeholder index.test.ts with meaningful assertions or remove it.

test analysis:
This is the finding itself: no such tests exist.

suggested regression test:
Per-DO test suites: connect N sockets with mixed filters, POST updates, assert only matching sockets receive frames; then simulate hibernation and repeat.

minimum fix scope:
apps/api/test/

## medium: TokenChip has no tests despite vitest + @testing-library/react being configured

id: fnd_sig-feat-ui-flow-902c997d16-55cd_bb1c4e408e
category: test-gap
confidence: high
triage: test-gap
status: open
feature: React component TokenChip (feat_ui-flow_902c997d16)

evidence:
- apps/web/src/components/TokenChip.tsx:17-45 (TokenChip)
- apps/web/package.json:49-51

The component has real conditional logic — logo rendering (line 20), shortened address display (line 22), and conditional remove button wiring (lines 23-42) — that is easy to regress (e.g., onRemove not firing, wrong aria-label, logo render condition). The feature's tests list is empty, and no test file is included, while the project already ships vitest, @testing-library/react, @testing-library/jest-dom, and @testing-library/user-event (package.json devDependencies, and the test/test:watch scripts). A presentational component that participates in token removal UX (a DEX-critical action) should have render/behavior coverage.

recommendation:
Add apps/web/src/components/TokenChip.test.tsx covering: renders symbol, shortens address via shortenAddress, renders logo only when logoURI present, calls onRemove on button click, omits the button when onRemove is undefined, and applies className.

test analysis:
No test file exists for this component (tests array is empty; none included in review scope).

suggested regression test:
vitest + @testing-library/react test asserting render output for both logoURI present/absent and onRemove present/absent, plus userEvent click invoking onRemove exactly once.

minimum fix scope:
apps/web/src/components/TokenChip.test.tsx (new file)

## medium: TokenSearch debounced search applies stale responses over newer queries (no abort/sequencing)

id: fnd_sig-feat-library-da89b4a88e-c200_85178948d6
category: concurrency
confidence: high
triage: confirmed-bug
status: open
feature: Node package @aetherdex/web (feat_library_da89b4a88e)

evidence:
- apps/web/src/components/TokenSearch.tsx:122-143
- apps/web/src/components/TokenSearch.tsx:145-151

The debounce effect cancels the pending timer on query change but never cancels or ignores an in-flight fetch: searchTokens never passes the AbortSignal that fetchTokens/fetchTokenByAddress already accept, and there is no sequence counter. If the response for query A resolves after the request for query B starts, A's setResults overwrites B's results, and A's finally() clears isSearching while B is still running (spinner disappears early). Out-of-order responses therefore show tokens for a query the user has already replaced.

recommendation:
Create an AbortController per debounce run and abort it in the effect cleanup, or track a request sequence number and discard resolutions from stale runs (the cancelled-flag pattern already used for defaultTokens load).

test analysis:
test/components/TokenSearch.test.tsx was omitted from the included excerpts; happy-path tests with instantly-resolving mocks cannot expose interleaved slow responses.

suggested regression test:
Mock fetch with manually-resolved promises: trigger query A, change to query B before A resolves, resolve A after B; assert displayed results and isSearching reflect B.

minimum fix scope:
apps/web/src/components/TokenSearch.tsx

repro:
Type "uni" and let the 300ms debounce fire, then type "usdc" before the first response arrives; if the first request resolves last, the dropdown shows "uni" results for the "usdc" query.

## medium: Unknown chainId silently falls back to an Ethereum-scoped embed, showing potentially wrong chart data

id: fnd_sig-feat-ui-flow-5e1863c145-7cdd_125b2f7ed6
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component DexScreenerChart (feat_ui-flow_5e1863c145)

evidence:
- apps/web/src/components/DexScreenerChart.tsx:20-28 (DexScreenerChart)

chainMap only covers ethereum (1), base (8453), sepolia (11155111), and base-sepolia (84532), and line 27 falls back to "ethereum" for any other chainId. The component is generic over chainId (an optional prop callers can pass), so a token on any unsupported EVM chain (e.g., Polygon 137, Arbitrum 42161, BSC 56, Optimism 10) silently renders an embed URL scoped to ethereum. If an address with the same value exists on Ethereum, DexScreener will display that Ethereum token's chart — misleading financial data with no error or warning to the user. This is a silent correctness failure, not an explicit unsupported-state, and the feature metadata lists user-input as a trust boundary, so caller-supplied chainIds are expected.

recommendation:
Do not silently coerce unknown chains to ethereum. Either render an explicit unsupported-chain fallback UI (e.g., a placeholder message), omit chain scoping and rely on DexScreener's own token resolution, or require the caller to only pass supported chain ids and surface a clear error/warning otherwise.

test analysis:
The feature has no tests: the tests array is empty and no test file for this component exists, so the chainMap fallback behavior is unverified.

suggested regression test:
Render the component with chainId={137} and assert the resulting iframe src does not contain "ethereum" (or that an unsupported-chain message is shown), plus a case asserting known chain ids map to the correct chain slugs.

minimum fix scope:
apps/web/src/components/DexScreenerChart.tsx

repro:
Render <DexScreenerChart tokenAddress="0x..." chainId={137} /> and observe the iframe src becomes https://dexscreener.com/ethereum/0x... instead of rejecting or indicating the chain is unsupported.

## medium: upsertToken silently swallows every write failure and reports success

id: fnd_sig-feat-library-4a1871bbb1-c4c5_1c9cfcd854
category: data-loss
confidence: high
triage: confirmed-bug
status: open
feature: Node source apps/api/src/services/:token (feat_library_4a1871bbb1)

evidence:
- apps/api/src/services/token.service.ts:153-167 (upsertToken)

The entire upsert body is piped through Effect.catch(() => Effect.succeed(undefined)) and the effect's error channel is typed never, so callers cannot observe a failed write. Any D1 error (constraint violation, outage, type mismatch) becomes a silent success: token metadata/verification writes are lost with no log, retry, or error signal. The sibling file's error classes explicitly note that read failures must surface as 500s to HTTP callers, but the write path has no equivalent. Additionally the ON CONFLICT clause omits is_native, so a corrected native flag can never be updated on conflict.

recommendation:
Do not swallow the error: expose an error channel (e.g., Effect<void, TokenWriteError>) or at minimum log the failure via Effect.logError and propagate, so HTTP callers can return 500/503. Also add is_native = excluded.is_native to the conflict update for consistency with the other columns.

test analysis:
The feature has no tests (tests: []), and the never error channel leaves tests nothing to assert on without injecting a failing SqlClient.

suggested regression test:
Inject a SqlClient stub whose query rejects and assert upsertToken fails (or logs) instead of resolving undefined.

minimum fix scope:
token.service.ts upsertToken body (lines 153-167)

## medium: upsertUser returns a nonce that is never persisted for existing users

id: fnd_sig-feat-service-1e40670be0-6997_56cac37bd0
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source apps/api/src/db (feat_service_1e40670be0)

evidence:
- apps/api/src/db/queries.ts:114-124

upsertUser generates a fresh nonce via crypto.randomUUID(), inserts it, and returns it, but the ON CONFLICT(address) DO UPDATE clause only refreshes last_active_at. For an existing user the stored nonce is never updated, so the returned nonce was never persisted anywhere; the module exposes no other way to persist it. Any SIWE-style sign-in flow (siwe is a declared dependency in apps/api/package.json) that verifies the returned nonce against users.nonce will fail for every returning user, since the returned value never matches the stored value. The first call works (insert path), which makes the bug easy to miss in manual testing of new users.

recommendation:
Persist the returned nonce on conflict, e.g. ON CONFLICT(address) DO UPDATE SET nonce = excluded.nonce, last_active_at = excluded.last_active_at, or read back the stored nonce after the upsert and return that instead of the pre-generated value.

test analysis:
The feature reports tests: [] and no test files are included for this module, so the insert-vs-return mismatch is never exercised; the upsert path looks correct at a glance.

suggested regression test:
Unit test with a mocked/embedded SqlClient: call upsertUser twice for the same address and assert the nonce returned by the second call equals the nonce read back from the users table.

minimum fix scope:
apps/api/src/db/queries.ts (upsertUser)

repro:
Call upsertUser('0x...') twice for the same address; the second call returns a nonce different from the value stored in the users row, and the returned value exists nowhere in the database.

## medium: useWebSocket URL-change race defeats the unmount guard: stale onclose reconnects to the old URL and leaks the active socket

id: fnd_sig-feat-library-da89b4a88e-9e6b_1fd23eb34c
category: concurrency
confidence: high
triage: confirmed-bug
status: open
feature: Node package @aetherdex/web (feat_library_da89b4a88e)

evidence:
- apps/web/src/hooks/useWebSocket.ts:62-66
- apps/web/src/hooks/useWebSocket.ts:95-110
- apps/web/src/hooks/useWebSocket.ts:129-135

On a URL change (e.g. PriceTicker's tokenAddress changes) the effect cleanup runs synchronously: mountedRef.current = false, then ws.close(). The old socket's onclose event fires asynchronously in a later task — after the new effect has already set mountedRef.current = true and connected the new socket. The stale onclose then passes the mountedRef guard, sets isConnected=false on the NEW connection's state, and since reconnectCountRef is 0 schedules a reconnect using the OLD effect closure's URL. When that timer fires, connect() creates a socket to the old URL and overwrites wsRef.current, orphaning the live socket to the new URL — which is never closed by cleanup (wsRef no longer points at it), leaving a duplicate live connection whose onmessage still updates state. React StrictMode double-effects in dev trigger the same race.

recommendation:
Guard every handler by socket identity (e.g. `if (wsRef.current !== ws) return` inside onopen/onmessage/onclose/onerror) and clear any pending reconnect timer when a new connection is opened, or track a per-connection generation counter captured in connect().

test analysis:
The useWebSocket test file (test/hooks/useWebSocket.test.ts) was omitted from the included excerpts, so there is no evidence it exercises URL changes while connected; typical tests cover open/close/reconnect on a fixed URL only.

suggested regression test:
Unit test: connect with url A, change url to B while connected, assert exactly one live socket (track close() calls), no reconnect timer scheduled for A, and isConnected stays true for B.

minimum fix scope:
apps/web/src/hooks/useWebSocket.ts

repro:
Mount useWebSocket with url A, wait for onopen, then re-render with url B. Observe isConnected flicker, a reconnect timer to A, and two live sockets (A's reconnect socket plus B's orphaned one).

## medium: verifyTrigger hardcodes TWAP to null and returns isTriggered as dualTriggerMet, so it always returns false

id: fnd_sig-feat-library-ad98bca978-d42d_5eea25ee12
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source apps/api/src/services#2 (feat_library_ad98bca978)

evidence:
- apps/api/src/services/verification.service.ts:189-192
- apps/api/src/services/verification.service.ts:226-235

twapPriceX18 is unconditionally set to null (line 191, with a TODO), every dualTriggerMet computation requires twapPriceX18 !== null (lines 202-217), and the returned isTriggered is dualTriggerMet (line 227). As a result verifyTrigger always returns isTriggered: false regardless of spot price — the spot-only evaluation computed at lines 198-219 is discarded. Worse, the 'TWAP unavailable' diagnostic is only pushed into errors[] while the effect still succeeds, so a caller that checks only isTriggered silently concludes the trigger never fired. The entire TP/SL trigger pipeline is dead until a TWAP source is wired in.

recommendation:
Either implement the AetherHook TWAP read, or fail the effect with a VerificationError when TWAP is unavailable instead of returning a successful always-false verdict; surface errors[] to callers and stop computing an isTriggered result that is unconditionally overridden.

test analysis:
No test file for verification.service.ts is included in this feature, and the placeholder is self-documented as a TODO, so no test asserts actual trigger behavior.

suggested regression test:
Unit test verifyTrigger with a stubbed ChainStateReader asserting that when TWAP is unavailable the effect fails (or errors[] is non-empty) rather than returning isTriggered: false.

minimum fix scope:
apps/api/src/services/verification.service.ts (verifyTrigger)

## medium: VITE_WS_URL omitted from production secret validation loop

id: fnd_sig-feat-config-3a72a27053-5e440_346aec4caa
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Shell/workflow config release.yml (feat_config_3a72a27053)

evidence:
- .github/workflows/release.yml:88
- .github/workflows/release.yml:111-113

The deploy job injects VITE_WS_URL from a secret into the build environment (line 88), but the 'Validate production inputs' step (lines 108-113) — the only guard that aborts the release when a required variable is empty — omits VITE_WS_URL from its name list while including every other secret-driven variable, including the sibling VITE_REOWN_PROJECT_ID and VITE_API_URL. If the secret is unset or empty, the web app is built and deployed with an empty websocket URL; the deploy steps succeed and the smoke tests (lines 123-126) only exercise the API, so the broken websocket configuration ships to production silently. The validation loop exists precisely to fail before deploy, and it misses this variable.

recommendation:
Add VITE_WS_URL to the name list in the validation loop at line 111 so a missing/empty secret fails the deploy job before any infrastructure or Pages changes are made.

test analysis:
No tests are included for this workflow file; the inline validation loop is the only runtime guard, and it currently excludes the variable, so nothing detects the omission.

suggested regression test:
A shell test that extracts the deploy job's env block variable names (lines 70-88) and asserts every secret-sourced name appears in the validation loop's list (line 111).

minimum fix scope:
Add `VITE_WS_URL` to the name list in .github/workflows/release.yml line 111.

## medium: WebSocketHubDO knownTokens set does not survive hibernation, breaking list_pools and /stats after idle

id: fnd_sig-feat-library-53a6b417c0-3c93_e057823ccc
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source apps/api/src/durable-objects (feat_library_53a6b417c0)

evidence:
- apps/api/src/durable-objects/websocket-hub-do.ts:50
- apps/api/src/durable-objects/websocket-hub-do.ts:132-134
- apps/api/src/durable-objects/websocket-hub-do.ts:91-99
- apps/api/src/durable-objects/websocket-hub-do.ts:167-177

The code comments (lines 160-166) acknowledge that in-memory state does not survive hibernation, and hydrateSubscribers() (lines 167-177) correctly rebuilds the subscribers map from socket attachments. However, knownTokens (line 50) is pure in-memory state with no persistence or reconstruction: after the DO hibernates and wakes, list_pools (lines 132-134) returns an empty pool list and /stats (lines 91-99) reports knownTokens: 0, even though tokens were previously broadcast. Tokens with no currently-connected subscriber cannot be rebuilt from attachments at all, so the gap is not fixable by the existing hydration approach.

recommendation:
Persist knownTokens in ctx.storage (e.g. a storage set updated in the /price handler) and load it in hydrateSubscribers()/fetch, or reconstruct the token set by unioning watchedKeys from all socket attachments plus a persisted set for tokens without active subscribers.

test analysis:
No tests exist for WebSocketHubDO; the included test files cover only nonce semantics (siwe-nonce-do.test.ts) and placeholder assertions (index.test.ts).

suggested regression test:
Test that after issuing /price broadcasts, simulating instance eviction/wake, a list_pools request still returns the previously known token addresses.

minimum fix scope:
apps/api/src/durable-objects/websocket-hub-do.ts

## medium: `format` script rewrites files in place, so any CI/release gate invoking it never fails on unformatted code and mutates the tree

id: fnd_sig-feat-release-734b842583-a707_68c7d12c76
category: build-release
confidence: medium
triage: risk
status: open
feature: Package script format (feat_release_734b842583)

evidence:
- package.json:14 (format)

The script runs `biome format --write .`, which rewrites files and exits 0 regardless of whether the tree was formatted. If a CI job or release pipeline runs `bun run format` as a formatting verification (the conventional meaning of a bare `format` script), violations are silently repaired instead of failing the build, and the working tree is dirtied mid-pipeline — a hazard for a feature tagged as part of a release flow. The convention is demonstrated in this same file: `lint` (line 12, no write) is paired with `lint:fix` (line 13, `--write`), but `format` has no non-mutating counterpart, so there is no safe check variant to call in CI.

recommendation:
Split into `format` = `biome format .` (check-only, exits non-zero on diffs) and `format:fix` = `biome format --write .` (mutating), mirroring the existing `lint`/`lint:fix` pair; or keep `format` mutating but add a separate `format:check` script and use it (or `biome ci`) in CI/release gates.

test analysis:
No tests are included for this feature, and package scripts are not exercised by the vitest suite; the mutating-vs-checking behavior is only observable when the script is invoked by CI/release tooling, which is not part of the included files.

suggested regression test:
A workflow-level check that runs `biome format .` (no `--write`) against a fixture containing an unformatted file and asserts a non-zero exit code and no file modifications.

minimum fix scope:
package.json (scripts `format`/`format:fix`) plus whatever CI config consumes the script.

## medium: Aggregate `build` script fails (or silently skips) any workspace lacking a `build` script

id: fnd_sig-feat-release-51170e0f9c-2f63_4b4f5c00ea
category: build-release
confidence: medium
triage: risk
status: open
feature: Package script build (feat_release_51170e0f9c)

evidence:
- package.json:9 (build)
- package.json:26-30 (workspaces)
- package.json:16 (contracts:build)

`bun run --filter '*' build` executes the `build` script in every workspace member matched by the broad globs `apps/*`, `packages/*`, `infra/*`. In bun, a filtered package with no matching script aborts the run with a non-zero exit (or, depending on version/flags, is skipped silently). Either outcome is a release hazard: a hard failure means adding any workspace without a `build` script (plausible for `infra/*` packages or the forge-based `packages/contracts`, which is built through the separate `contracts:build` entrypoint at line 16) breaks the entire release build; a silent skip means packages ship unbuilt/stale artifacts with no signal. The feature metadata itself marks this as the release entrypoint, so a broken or partial `build` propagates directly to release. The presence of parallel entrypoints (`contracts:build`, `web:build`) also makes it ambiguous what the aggregate `build` is guaranteed to include.

recommendation:
Verify every workspace package defines a `build` script (or use `--if-present` where the installed bun supports it), scope the filter to packages that actually produce artifacts, and document how `contracts:build`/`web:build` relate to the aggregate `build`. Add a CI check that runs `bun run build` and asserts all expected artifacts exist afterward.

test analysis:
No tests are included for this feature and script presence across workspace packages is not exercised by the vitest suite declared in package.json.

suggested regression test:
A CI step (or a small script invoked from `test`) that asserts every workspace package under apps/*, packages/*, infra/* either defines a `build` script or is explicitly excluded, and that `bun run build` exits 0 and produces expected artifacts.

minimum fix scope:
package.json scripts plus `build` script definitions in workspace packages.

## medium: API_URL silently falls back to http://localhost:8080 and is baked into production builds

id: fnd_sig-feat-library-67e36e39d1-eaa1_7424b44669
category: build-release
confidence: medium
triage: risk
status: open
feature: Node source apps/web/src/hooks (feat_library_67e36e39d1)

evidence:
- apps/web/src/hooks/useSiweAuth.ts:4
- apps/web/package.json:10

VITE_API_URL is resolved at build time; when unset, the hook silently uses http://localhost:8080/api/v1. The web app is deployed via `wrangler pages deploy dist` (package.json line 10), and if the CI/deploy step does not export VITE_API_URL, the shipped bundle will send nonce/verify/logout requests to each user's own localhost:8080 — auth is broken in production (or worse, requests hit whatever the user runs locally). The fallback should fail fast at build time or default to a relative API path served from the same origin.

recommendation:
Make the API base URL a required build-time variable (fail the build when missing in production mode) or default to a same-origin relative path, and add a CI check that the deployed bundle does not contain localhost.

test analysis:
No build-time or e2e test asserts the API endpoint used in production bundles.

suggested regression test:
A build script test that runs `vite build` without VITE_API_URL and asserts the output contains no localhost URL.

minimum fix scope:
apps/web/src/hooks/useSiweAuth.ts and build/deploy config

repro:
Run `VITE_API_URL= bun run build` (or no env var) and deploy; the built JS contains http://localhost:8080 and all SIWE requests fail in production.

## medium: Auto-recenter never triggers: poolSpot cache payload never contains the `tick` field the handler requires, and the handler queues no rebalance action

id: fnd_sig-feat-library-c77821ce5c-b288_732e445c72
category: bug
confidence: medium
triage: risk
status: open
feature: Node source apps/api/src/workers (feat_library_c77821ce5c)

evidence:
- apps/api/src/workers/cron-handler.ts:344-348 (refreshTopPools)
- apps/api/src/workers/queue-handler.ts:536-549 (handleAutoRecenterCheck)
- apps/api/src/workers/queue-handler.ts:572-593 (handleAutoRecenterCheck)

The only writer of `poolSpot:<poolId>` in this feature writes `{ price, updatedAt }` (cron-handler.ts:344-348), but `handleAutoRecenterCheck` reads `spotParsed.tick` and skips with 'No tick/price data for pool' when it is undefined (queue-handler.ts:544-550). Since `refreshTopPools` never writes a tick field, every auto-recenter check deterministically skips before the drift logic runs, so `last_rebalance_at`/`rebalance_count` are never updated and the policy never rebalances. Additionally, the handler's 'queue rebalance' comment (line 572) is not backed by any queue send — `QueueEnv` has no KEEPER_QUEUE binding and the only side effects are a console log and a DB counter bump. Confidence is medium because a writer outside these files could theoretically populate the tick field, but within the feature evidence the pipeline is dead.

recommendation:
Either write `tick` into the poolSpot payload in `refreshTopPools` (or a dedicated pool-state writer), or derive the tick from the stored 1e18 price in `handleAutoRecenterCheck` as its own comment suggests; and actually dispatch the rebalance work (queue message or direct call) instead of only logging/updating counters.

test analysis:
No tests exist for `refreshTopPools` or `handleAutoRecenterCheck`; the only worker test (v3-indexer-cursor.test.ts) covers cursor helpers, and index.test.ts is a placeholder.

suggested regression test:
Integration test: run `handleAutoRecenterCheck` against a poolSpot KV entry produced by `refreshTopPools` with an out-of-range tick and assert a rebalance is enqueued; also assert the poolSpot payload contains the tick field.

minimum fix scope:
apps/api/src/workers/cron-handler.ts and apps/api/src/workers/queue-handler.ts

## medium: Bleeding-edge compiler options (es2025, stableTypeOrdering) can break typecheck on pinned TypeScript versions

id: fnd_sig-feat-config-0c1c23856a-d7a0e_b014d96812
category: build-release
confidence: medium
triage: risk
status: open
feature: Project config tsconfig.json (feat_config_0c1c23856a)

evidence:
- tsconfig.json:5
- tsconfig.json:8
- tsconfig.json:17

The config targets/lib es2025 (lines 5, 8) and enables stableTypeOrdering (line 17), options introduced only in very recent TypeScript releases (es2025 requires 5.9+; stableTypeOrdering is a 6.x-era option). If the repository's pinned typescript dependency predates these, `bun run typecheck` (tsc) aborts with TS5023 'Unknown compiler option stableTypeOrdering' or an unsupported lib/target diagnostic, failing CI. Nothing in this file or the detected commands guards or validates the compiler version, and there is no fallback path, so a version bump or fresh install (e.g., bun install resolving a different range) silently changes whether the project typechecks. The feature summary classes this file as build/release/quality configuration, making version-sensitivity of its options an in-scope hazard.

recommendation:
Verify the typescript version resolved by the lockfile supports all options used (>= the release introducing stableTypeOrdering, and es2025 target/lib); pin the dependency with a minimum version and add a CI step that runs `bun run typecheck` with the pinned version. If older TypeScript must be supported, drop stableTypeOrdering and downgrade target/lib.

test analysis:
The feature ships with no tests (tests: []), and the vitest suite does not exercise tsc option compatibility or compiler-version constraints; option-support failures surface only when typecheck runs.

suggested regression test:
A CI step (or a small script/test) that runs `bun run typecheck` with the lockfile-pinned TypeScript and asserts exit code 0; alternatively a test that invokes the typescript API against this tsconfig and asserts no TS5023/unsupported-target diagnostics.

minimum fix scope:
package.json (pin typescript >= required minimum) and/or tsconfig.json (remove or gate unsupported options).

## medium: Button defaults to type="submit", risking unintended form submission

id: fnd_sig-feat-ui-flow-be6bf02bc2-8d23_5c99920d43
category: bug
confidence: medium
triage: risk
status: open
feature: React component Button (feat_ui-flow_be6bf02bc2)

evidence:
- apps/web/src/components/ui/Button.tsx:14-33 (Button)

The component destructures children, className, variant, size, fullWidth, loading, and disabled, then spreads the remaining ButtonHTMLAttributes via {...rest} onto <button> without ever setting a type attribute. HTML buttons default to type="submit", so any usage of this component inside a <form> (and @tanstack/react-form is a direct dependency in apps/web/package.json, indicating forms are used in this app) will submit the form on click unless every call site remembers to pass type="button". This is the classic reusable-Button footgun and can trigger unintended submissions, navigation, or state resets. The spread cannot rescue this because type is not destructured or defaulted before the spread. Note that disabled is destructured (line 21), so the {...rest} spread after disabled={disabled || loading} (lines 32-33) cannot override it; that ordering is safe.

recommendation:
Default the type explicitly, e.g. destructure type = "button" and render <button type={type} disabled={disabled || loading} {...rest}>, or set type="button" directly on the element while still allowing an explicit type prop to win.

test analysis:
The feature's tests array is empty and no test file for Button exists in the included files, so no test exercises the component inside a form context.

suggested regression test:
Render <Button> inside a <form> with a submit spy, click the button, and assert the form's submit handler is not called unless type="submit" is passed explicitly.

minimum fix scope:
apps/web/src/components/ui/Button.tsx

## medium: Dev-stage name derivation diverges between the alchemy scripts and the Pages upload script

id: fnd_sig-feat-library-e6a0e61d33-2351_73f976f9f7
category: api-contract
confidence: medium
triage: contract-mismatch
status: open
feature: Node package @aetherdex/alchemy-infra (feat_library_e6a0e61d33)

evidence:
- infra/alchemy/package.json:8-10
- infra/alchemy/package.json:13
- infra/alchemy/package.json:16

`plan:dev`, `deploy:dev`, and `destroy:dev` pass `--stage dev_$USER` verbatim, while `web:deploy:dev` derives the Pages project name from the same `dev_$USER` value through lowercasing, character sanitization (`s/[^a-z0-9-]/-/g`, which also turns the underscore in `dev_` into `-`), and `cut -c1-44` truncation. The two derivations diverge for any username containing uppercase letters or characters outside `[a-z0-9-]` (e.g. USER=Irfandi yields Alchemy stage `dev_Irfandi` but wrangler project `aetherdex-web-dev-irfandi`), and even for a plain lowercase username the stage keeps the underscore while the Pages name uses a dash. If Alchemy provisions the Pages project from the stage name, the wrangler upload then targets a project Alchemy did not create (or vice versa), silently breaking the dev smoke checks described in the README. Also, only `web:deploy:dev` guards against an unset `$USER`; with `$USER` unset the alchemy scripts silently target stage `dev_` while the web script aborts, so the two commands fail in inconsistent ways.

recommendation:
Derive the dev stage name once (e.g., a shared helper script or a single environment variable set before all commands) using the same sanitization, and use that value in `plan:dev`, `deploy:dev`, `destroy:dev`, and `web:deploy:dev`; add `test -n "$USER"` guards to the alchemy dev scripts as well.

test analysis:
The package has no test script and no test files, so the shell pipelines in package.json scripts are never exercised.

suggested regression test:
A shell test that runs the STAGE_SUFFIX derivation against representative usernames (all-lowercase, mixed case, longer than 44 chars, characters outside [a-z0-9-]) and asserts the resulting Pages project name matches the stage name used by `deploy:dev`.

minimum fix scope:
infra/alchemy/package.json (scripts: stage derivation and USER guard)

## medium: executeOrder and recordKeeperExecution are separate non-transactional writes; keeper audit records can be lost or orphaned

id: fnd_sig-feat-library-ad98bca978-cf71_c12c40e00a
category: data-loss
confidence: medium
triage: risk
status: open
feature: Node source apps/api/src/services#2 (feat_library_ad98bca978)

evidence:
- apps/api/src/services/tp-sl.service.ts:282-306
- apps/api/src/services/tp-sl.service.ts:345-373

The keeper flow writes the order status (executeOrder) and the keeper_executions row (recordKeeperExecution) as two independent statements with no enclosing transaction, and neither call validates the other's success. If the process crashes or the second insert fails after executeOrder commits, the order is executed with no audit record — and a retry of executeOrder fails with OrderNotFoundError because the status is no longer 'pending', so the record can never be backfilled. Inserting the record first and then failing executeOrder leaves an orphan execution row. The interface shape (both methods on the same service, recordKeeperExecution taking orderId/txHash/amountOut) makes this two-step flow the intended usage.

recommendation:
Wrap both writes in a single transaction (e.g., a CTE or transaction block that updates the order and inserts the keeper execution), and/or make executeOrder idempotent so a retry with the same txHash can backfill the record.

test analysis:
No tests exist for tp-sl.service.ts, and the interplay between executeOrder and recordKeeperExecution is not exercised anywhere in the included tests.

suggested regression test:
With a stubbed SqlClient that fails the second statement, assert the order status and keeper record stay consistent (both committed or both rolled back), and assert retry behavior with the same txHash.

minimum fix scope:
apps/api/src/services/tp-sl.service.ts (executeOrder + recordKeeperExecution)

## medium: GET /:address accepts non-EIP-55 addresses: false 404s for valid tokens (checksum not validated)

id: fnd_sig-feat-route-b4cf758698-a857e7_9516ac6513
category: api-contract
confidence: medium
triage: contract-mismatch
status: open
feature: Hono route GET /:address (feat_route_b4cf758698)

evidence:
- apps/api/src/routes/tokens.ts:76-79
- apps/api/src/routes/tokens.ts:4-7

The file header documents that tokens come from the canonical Uniswap default list validated with "schema + EIP-55 checksums + chainId filter" (lines 4-7), and such lists key entries by EIP-55 checksummed addresses. The route's only validation is /^0x[a-fA-F0-9]{40}$/, which accepts any casing, including all-lowercase and arbitrary mixed-case strings that are not checksum-valid. A client querying an existing token by its lowercase hex form (common in wallets and scripts) passes the regex but is then looked up verbatim against checksummed entries, producing a false 404; non-checksummed mixed-case input is likewise accepted instead of rejected with 400. The endpoint contract (EIP-55 validation, per the file's own documentation) mismatches the implementation (hex-shape check only). viem (a direct dependency, package.json line 49) provides isAddress strict checksum validation but is unused here.

recommendation:
Enforce EIP-55 in the :address handler: validate with viem's isAddress(address, { strict: true }) and reject non-checksummed input with 400, or normalize the input to checksum form (getAddress) before calling getToken so lowercase queries resolve to the canonical entry.

test analysis:
No tests exist for this route (feature tests list is empty), and the vitest coverage include in apps/api/vitest.config.ts (lines 67-83) omits src/routes/tokens.ts, so the address-validation path is completely unguarded.

suggested regression test:
Route test with a mocked/fake TokenListService asserting: (1) the lowercase form of a listed token returns 200 (via normalization) or 400 (if strict checksum is enforced), (2) a non-checksummed mixed-case address returns 400, (3) an unknown but checksum-valid address returns 404.

minimum fix scope:
apps/api/src/routes/tokens.ts — enforce EIP-55 in the :address handler or normalize input before getToken.

repro:
GET /api/v1/tokens/<all-lowercase hex form of a token that exists in the checksummed list> → passes the shape regex at line 77, then returns 404 "Token not found" instead of 200 because the lookup key does not match the checksummed canonical entry (assuming getToken matches exactly, which is the documented storage form).

## medium: GET /api/v1/quote accepts unvalidated slippage (NaN/negative/unbounded) that can null out minAmountOut

id: fnd_sig-feat-library-09141f3ef9-51bf_83c7409553
category: api-contract
confidence: medium
triage: contract-mismatch
status: open
feature: Node source apps/api/src/routes (feat_library_09141f3ef9)

evidence:
- apps/api/src/routes/swap.ts:139-171
- apps/api/src/routes/v3-quote.ts:23-37

The /quote handler computes slippageTolerance = Number.parseFloat(query) / 100 with no validation: slippage=abc yields NaN, slippage=-1 yields -0.01, slippage=999 yields 9.99. NaN/negative/unbounded values flow straight into SwapService.getQuote, so minAmountOut becomes NaN (serialized as null by JSON.stringify) — silently disabling client-side slippage protection — or the service throws and the handler returns 500. The sibling v3-quote route validates slippage (finite, 0–5) and returns 400, demonstrating the intended contract; the /quote route is missing the same guard.

recommendation:
Validate slippage with Number.isFinite and a bounded range (e.g. 0 to 100 percent) before building the quote, returning 400 on invalid input, mirroring the v3-quote.ts validation.

test analysis:
The only included test covers the price-guard helper; there are no swap route tests exercising query-parameter validation.

suggested regression test:
Route-level test asserting GET /quote with slippage=abc, slippage=-1, and slippage=999 each return 400 and never reach the quote service.

minimum fix scope:
apps/api/src/routes/swap.ts GET /quote handler — add slippage validation before getQuote.

repro:
GET /api/v1/quote?tokenIn=0x1111111111111111111111111111111111111111&tokenOut=0x2222222222222222222222222222222222222222&amountIn=1000000000000000000&slippage=abc

## medium: GET /pools route has no test coverage while sibling routes are covered

id: fnd_sig-feat-route-615aa60302-bc7211_5cf17f083d
category: test-gap
confidence: medium
triage: test-gap
status: open
feature: Hono route GET / (feat_route_615aa60302)

evidence:
- apps/api/vitest.config.ts:64-84

The feature metadata lists no tests, and vitest.config.ts's coverage include list enumerates sibling route/service files (src/routes/liquidity.ts, src/routes/price-guard.ts, src/routes/v3-quote.ts, plus many services) but omits src/routes/pools.ts. The route contains non-trivial, easily-testable logic: limit/offset parsing and bounds (lines 35-41), enum defaults (42-43), the chain-config 500 path (33-34), and the 404 path for the detail handler (78-80). Without tests, regressions in pagination validation and error contract go undetected; the test infrastructure (vitest with @cloudflare/vitest-pool-workers, shims configured in vitest.config.ts) already exists.

recommendation:
Add route tests under apps/api/test/ covering: default and boundary limit (1, 200, 0, 201, non-numeric), offset (0, negative, non-numeric), invalid sortBy/sortDirection, valid request shape { pools, count }, and the 404 poolId path (bad hex, missing pool). Add src/routes/pools.ts to the coverage include list.

test analysis:
No test files were included for this feature and the coverage configuration explicitly excludes this route from reporting, so the behavior is entirely unverified by tests.

suggested regression test:
Vitest route test (cloudflareTest pool) exercising GET /api/v1/pools with query matrices for limit/offset/sortBy/sortDirection and asserting 200/400 status codes and response shape.

minimum fix scope:
Add a new test file in apps/api/test/ plus src/routes/pools.ts to the coverage include list in apps/api/vitest.config.ts.

## medium: getToken matches addresses case-sensitively; inconsistent with token-list service

id: fnd_sig-feat-library-4a1871bbb1-f13c_24232a424e
category: api-contract
confidence: medium
triage: contract-mismatch
status: open
feature: Node source apps/api/src/services/:token (feat_library_4a1871bbb1)

evidence:
- apps/api/src/services/token.service.ts:75-84 (getToken)
- apps/api/src/services/token-list.service.ts:232-237 (getToken)

SQLite's = comparison uses case-sensitive BINARY collation, and token.service.getToken compares address = ${address} exactly, while the token-list service's getToken lowercases both sides before comparing (lines 235-236). Both services read the same tokens table: writeThroughD1 stores addresses in the validated list's original (EIP-55 checksummed) casing and upsertToken stores caller-provided casing, so the same logical token can be stored in mixed case. A client querying with different casing (e.g., an all-lowercase address from a wallet) gets rows.length === 0 and returns null, i.e., a 404 for a token that exists, while the same request through the token-list service succeeds.

recommendation:
Normalize addresses on write (store lowercase) or compare case-insensitively: WHERE LOWER(address) = LOWER(${address}) AND chain_id = ${deps.chainId}; if normalizing, add a unique index on LOWER(address) to keep (chain_id, address) deduplication meaningful.

test analysis:
No tests are included; this requires a seeded row with checksummed casing plus a lowercase query to expose.

suggested regression test:
Insert a token with a checksummed address, call getToken with the lowercased address, and assert the token is returned.

minimum fix scope:
token.service.ts getToken query (lines 77-81)

## medium: Keeper advances the local nonce before receipt confirmation; a transient confirmation failure can double-execute or permanently stall an order on retry

id: fnd_sig-feat-library-a50e9b911f-3fd4_7c208811ff
category: concurrency
confidence: medium
triage: risk
status: open
feature: Node package @aetherdex/api (feat_library_a50e9b911f)

evidence:
- apps/api/src/lib/keeper-signer.ts:525-530
- apps/api/src/lib/keeper-signer.ts:564-568
- apps/api/src/lib/keeper-signer.ts:389-405
- apps/api/src/lib/keeper-signer.ts:407-442

In both the private-relay and public paths, nextNonce = nonce + 1 is assigned immediately after a successful submission and BEFORE awaitConfirmation(). awaitConfirmation() throws KeeperRpcError (classified transient by isTransientKeeperError) when waitForTransactionReceipt fails, so the caller sees 'failed' even though the transaction is already in flight. On a queue retry: (a) if the same signer instance survives, the retry submits at nonce N+1 while tx N is still pending — both may confirm, executing the same TP/SL order twice (the second executeOrder's revert is only detected after paying gas); (b) if a fresh signer is constructed (worker re-invocation), nextNonce is lost and preflight falls back to the public RPC's pending nonce, which typically cannot see a private-relay mempool transaction — the retry reuses nonce N, the relay rejects with nonce-too-low/already-known (KeeperRelayError, non-retryable), and the order is permanently stuck even though the first submission succeeded. Either way the DB record diverges from on-chain reality.

recommendation:
Persist submission state (nonce, txHash) before awaiting confirmation and make retries idempotent: on retry, first check on-chain order state / pending tx for the account before resubmitting; treat receipt-wait failures as 'submitted, unconfirmed' and reconcile rather than blindly retrying the submission.

test analysis:
keeper-signer.test.ts exercises single submissions and error mapping; the cross-retry interaction (private relay invisible to the public RPC's pending count, nonce advanced before confirmation) requires simulating a lost response between relay and receipt wait, which the existing test surface does not appear to cover.

suggested regression test:
A test where the relay accepts a tx, waitForTransactionReceipt throws, and a subsequent sendTransaction with a fresh signer instance must not reuse the in-flight nonce (assert the second submission either skips to N+1 or is refused as duplicate before signing).

minimum fix scope:
apps/api/src/lib/keeper-signer.ts — move nextNonce advancement and confirmation handling behind a persisted in-flight marker, and add an on-chain/order-state idempotency check on the retry path.

repro:
1) Relay accepts eth_sendRawTransaction (tx N). 2) waitForTransactionReceipt throws (RPC timeout). 3) Queue retries sendTransaction. 4) Fresh signer: pendingNonce from public RPC = N → nonce N reused → relay rejects → order marked failed while tx N confirms. Same-instance retry: tx N+1 submitted while N pending → possible duplicate execution.

## medium: Keeper nonce tracking is per-signer-instance: a transient failure after private-relay acceptance can reuse a nonce and permanently fail the order

id: fnd_sig-feat-library-b8af523b91-1d34_5fbb73749f
category: bug
confidence: medium
triage: risk
status: open
feature: Node source apps/api/src/lib (feat_library_b8af523b91)

evidence:
- apps/api/src/lib/keeper-signer.ts:372
- apps/api/src/lib/keeper-signer.ts:389-405 (awaitConfirmation)
- apps/api/src/lib/keeper-signer.ts:496-501
- apps/api/src/lib/keeper-signer.ts:525-527
- apps/api/src/lib/keeper-signer.ts:189-194 (isTransientKeeperError)

nextNonce is closure state created fresh by every createKeeperSigner call (line 372) and is only bumped after the relay returns a valid hash (line 526). Two failure windows exist after the relay has actually accepted a transaction but before the code records success: (a) awaitConfirmation throws KeeperRpcError (line 395) when waitForTransactionReceipt fails/times out — deliberately classified as transient/retryable (lines 190-191), and (b) a 5xx or network error on the relay response (lines 493, 496-500) — also retryable. On retry with a fresh signer instance (the normal shape of a queue retry in serverless Workers), nextNonce is undefined and the private-relay transaction is invisible to the public RPC's pending-nonce read (getTransactionCount, line 418), so preflight re-derives the same nonce N. The relay then rejects the duplicate nonce as nonce-too-low — surfaced as a non-retryable KeeperRelayError (line 518) — and the order fails permanently even though the first transaction may still mine, or worse, two competing transactions for the same order state are created. The in-instance serialization test only proves same-instance nonce allocation, not cross-instance retry behavior.

recommendation:
Make nonce state durable (persist nextNonce in KV/D1 keyed by keeper address, or have the relay/submission path acknowledge the accepted nonce) and treat post-acceptance failures as ambiguous: before retrying with a fresh signer, query the relay/RPC for the transaction by hash or advance the nonce from durable state instead of re-deriving it from the public pending count.

test analysis:
keeper-signer.test.ts line 422-443 ('serializes concurrent submissions and allocates distinct pending nonces') exercises only concurrent calls on one signer instance where nextNonce is shared; no test simulates a retry with a new signer instance after a transient failure post-acceptance.

suggested regression test:
Create signer A, submit with mocked waitForTransactionReceipt rejecting; then create signer B with the same config and a chain stub whose getTransactionCount still returns 7; assert the second submission does not reuse nonce 7 (either via a nonce store or an explicit duplicate-nonce guard).

minimum fix scope:
apps/api/src/lib/keeper-signer.ts (durable nonce state or ambiguity-aware retry) + regression test

repro:
1) Signer A submits via private relay; relay accepts and returns a valid hash. 2) waitForTransactionReceipt throws (RPC timeout) → KeeperRpcError. 3) Queue retries with a freshly constructed signer B. 4) preflight reads pending nonce from the public RPC (does not include the private tx) → same nonce N. 5) Relay rejects with nonce-too-low (non-retryable) → submission fails permanently.

## medium: listTokens accepts negative or NaN limits: unbounded result set or 500

id: fnd_sig-feat-library-4a1871bbb1-2ac2_f94fd65d28
category: api-contract
confidence: medium
triage: contract-mismatch
status: open
feature: Node source apps/api/src/services/:token (feat_library_4a1871bbb1)

evidence:
- apps/api/src/services/token.service.ts:86-100 (listTokens)
- apps/api/src/services/token-list.service.ts:199-206 (applyOptions)

Math.min(options?.limit ?? 100, 500) only caps the upper bound. A negative limit is interpolated directly into SQL LIMIT; SQLite treats a negative LIMIT as 'no limit', so listTokens({limit: -1}) returns the entire tokens table, bypassing the intended 500-row cap (a performance and contract hazard). A NaN limit (e.g., from a malformed query parameter) yields LIMIT NaN, which errors and is caught into TokenListError, producing a 500 instead of falling back to the default. The sibling token-list service explicitly defends against exactly these two cases with a comment explaining the failure modes (lines 199-206), so the two services that share the tokens table behave inconsistently.

recommendation:
Clamp exactly like applyOptions in token-list.service.ts: const rawLimit = options?.limit; const limit = Math.min(rawLimit === undefined || !Number.isFinite(rawLimit) || rawLimit < 0 ? 100 : rawLimit, 500).

test analysis:
No tests are included in this feature, and observing the SQL LIMIT behavior requires a D1/SQLite-backed test that asserts row counts.

suggested regression test:
listTokens({limit: -1}) and listTokens({limit: NaN}) must each return at most 500 rows (or the default limit), not the full table / an error.

minimum fix scope:
token.service.ts listTokens limit computation (lines 86-100)

## medium: No tests cover the tokens route (GET / and GET /:address)

id: fnd_sig-feat-route-98dcbb586b-5b0b22_072379aecf
category: test-gap
confidence: medium
triage: test-gap
status: open
feature: Hono route GET / (feat_route_98dcbb586b)

evidence:
- apps/api/vitest.config.ts:64-84
- apps/api/src/routes/tokens.ts:52-96

The feature declares `tests: []`, and the coverage configuration in apps/api/vitest.config.ts explicitly enumerates route and service files to instrument (auth/routes.ts, routes/liquidity.ts, routes/price-guard.ts, routes/v3-quote.ts, services/token-list.service.ts, etc.) but omits src/routes/tokens.ts. The route contains non-trivial input validation (limit parsing with NaN/negative fallback and 500 cap at lines 56-57, address regex at line 77, 400/404/500 branching) that is currently unprotected against regression, and it is the network-facing entry point for the token-list feature.

recommendation:
Add Vitest (cloudflare vitest-pool-workers) request tests for the route: default limit, non-numeric/negative/oversized limit fallback and 500 cap, search passthrough, invalid-address 400, not-found 404, success shape `{ tokens, count }`, and add src/routes/tokens.ts to the coverage include list.

test analysis:
Coverage config includes the underlying service (token-list.service.ts) but deliberately lists which files are instrumented, and src/routes/tokens.ts is not among them; the feature metadata also reports no tests, so the route's validation logic is unexercised.

suggested regression test:
Parameterized Vitest request tests hitting GET /api/v1/tokens (mounted route) with `limit=abc`, `limit=-5`, `limit=100000`, `limit=0`, `?search=...`, and GET /api/v1/tokens/:address with bad/unknown/valid addresses.

minimum fix scope:
New test file under apps/api/test or src (e.g., src/routes/tokens.test.ts) plus adding `src/routes/tokens.ts` to the coverage include array in apps/api/vitest.config.ts.

## medium: No tests cover the WalletConnect component (wallet auth and network switching flow)

id: fnd_sig-feat-ui-flow-ffdbfd5b3b-df0b_6b631a24be
category: test-gap
confidence: medium
triage: test-gap
status: open
feature: React component WalletConnect (feat_ui-flow_ffdbfd5b3b)

evidence:
- apps/web/src/components/WalletConnect.tsx:5-50 (WalletConnect)
- apps/web/package.json:11-13
- apps/web/package.json:49-51

WalletConnect is the app's only wallet connection and network-switching entry point, yet the feature metadata reports tests: [] and no test file was included for review. The testing harness is fully available — vitest, happy-dom, @testing-library/react, and @testing-library/user-event are declared in package.json devDependencies (lines 49-51) and test scripts exist (lines 11-13) — so the gap is coverage, not infrastructure. The connect/disconnect/switch-chain flows and the disconnected vs. connected rendering branches (lines 14-20 vs. 22-48) are the app's authentication surface and are unverified.

recommendation:
Add a vitest + @testing-library/react test file for WalletConnect that mocks @reown/appkit and wagmi hooks and covers: disconnected state renders Connect Wallet and calls open(), connected state renders address/ENS and the network list, switch buttons call switchChain with the right chainId, and Disconnect calls disconnect().

test analysis:
No test file for this component was included and the feature metadata lists no tests; the component has no test coverage to build on.

suggested regression test:
A vitest test mocking useAppKit/useAccount/useChains/useSwitchChain/useDisconnect that asserts the Connect Wallet button appears when isConnected is false and that clicking a network item invokes switchChain({ chainId }) when connected.

minimum fix scope:
New test file, e.g., apps/web/src/components/WalletConnect.test.tsx

## medium: POST /api/v1/swap/record accepts unverified tx hashes and amounts from any authenticated user

id: fnd_sig-feat-library-09141f3ef9-b2d5_76ec5386f3
category: security
confidence: medium
triage: risk
status: open
feature: Node source apps/api/src/routes (feat_library_09141f3ef9)

evidence:
- apps/api/src/routes/swap.ts:227-278

The handler docstring states 'Requires auth (only the user's own transactions)', but nothing enforces that: the client supplies txHash, poolId, tokenIn/Out, amounts, blockNumber and blockTimestamp, and the handler inserts them verbatim with session.userAddress after only a truthiness check on txHash/blockNumber/blockTimestamp (txHash format is not even validated). Any authenticated user can insert fabricated swap rows with arbitrary txHash, poolId, and amounts, skewing pool volume/aggregation data and claiming transactions they never made. The TP/SL creation route in the same feature demonstrates the correct pattern: verify the receipt on-chain and match event args against the session user before persisting.

recommendation:
Before inserting, fetch the transaction receipt on-chain and verify status success and that the sender matches session.userAddress (mirroring tp-sl.ts creation verification); at minimum validate txHash format and add a unique constraint on (chainId, txHash).

test analysis:
No swap route tests exist; the included test only exercises the price-guard helper.

suggested regression test:
Route test with mocked RPC: recording a txHash with no receipt (or a receipt whose sender is not the session user) must be rejected with 4xx and no row inserted.

minimum fix scope:
apps/api/src/routes/swap.ts POST /swap/record handler.

repro:
Authenticated user POSTs /api/v1/swap/record with a random hex txHash, blockNumber 1, and amountUsd 1e9; the row is persisted without any on-chain check.

## medium: PriceTicker crashes when a WebSocket frame carries a numeric price without tokenAddress

id: fnd_sig-feat-library-da89b4a88e-c380_a8b9ca04b2
category: bug
confidence: medium
triage: risk
status: open
feature: Node package @aetherdex/web (feat_library_da89b4a88e)

evidence:
- apps/web/src/components/PriceTicker.tsx:66-76

Frames are JSON.parse'd in the hook without runtime validation, and the effect guard only checks `payload && typeof payload.price === "number"` before calling `payload.tokenAddress.toLowerCase()` unguarded. Any hub frame that includes data.price but omits tokenAddress (other message shapes, protocol frames, or a schema change) throws a TypeError inside useEffect; with no error boundary among the included files this propagates and unmounts the ticker subtree (or the app in React 19). Additionally, `typeof NaN === "number"` lets NaN prices through to render "$NaN" via formatPrice.

recommendation:
Guard with `typeof payload.tokenAddress === "string"` before toLowerCase() (or validate envelopes with a runtime schema such as Effect Schema, consistent with api.ts), and require Number.isFinite(payload.price).

test analysis:
No PriceTicker test is among the included files, and the omitted useWebSocket test cannot cover PriceTicker's payload-shape assumptions; tests likely only feed well-formed PricePayload frames.

suggested regression test:
Render PriceTicker with a mocked WebSocket that delivers {data:{price:1}} without tokenAddress; assert no throw and the placeholder dash is shown.

minimum fix scope:
apps/web/src/components/PriceTicker.tsx

repro:
Point PriceTicker at a hub that emits {type:"ping", data:{price:0}} or any envelope whose data has price but no tokenAddress; the component throws.

## medium: R2 appendToArchive is a read-modify-write with no locking: concurrent appends silently drop trade records

id: fnd_sig-feat-library-8f5d5fd534-9a86_14af5d81c1
category: concurrency
confidence: medium
triage: risk
status: open
feature: Node source apps/api/src/services#1 (feat_library_8f5d5fd534)

evidence:
- apps/api/src/services/r2.ts:100-133

appendToArchive downloads the existing monthly archive, appends newTrades in memory, then overwrites the object with bucket.put. Two concurrent invocations for the same ArchiveKey (e.g., overlapping queue consumers or a cron tick racing an API-driven append) each read the same base file, append disjoint batches, and the last put wins — the other batch is permanently lost from the trade-history archive. There is no conditional/atomic write (no If-Match style guard) and no serialization. In addition, if the same batch is retried after a crash between get and put, duplicates are inserted; both failure modes corrupt the archive invariant that the JSONL file contains each trade exactly once.

recommendation:
Serialize appends per key (e.g., a per-period queue consumer with a single in-flight writer, or D1-backed append journaling), or use R2 conditional writes/ETag checks to detect concurrent modification and retry, so a lost update fails loudly instead of overwriting silently.

test analysis:
No tests for r2.ts are included, and the race only manifests with concurrent callers, which no single-threaded unit test exercises.

suggested regression test:
Test that two sequential appendToArchive calls on the same period preserve both batches; additionally, a test asserting the service rejects/retries when the object changed between get and put (stubbed conditional write).

minimum fix scope:
apps/api/src/services/r2.ts (appendToArchive: locking/conditional-write strategy)

## medium: Root `test` script silently omits the Solidity/forge contract test suite

id: fnd_sig-feat-test-suite-84ae84a25a-3_cfc6d2b105
category: test-gap
confidence: medium
triage: test-gap
status: open
feature: Package script test (feat_test-suite_84ae84a25a)

evidence:
- package.json:10 (test)
- package.json:17 (contracts:test)

The workspace root defines `test` as `vitest run` (line 10), which executes only Vitest/JS test files. The repository also contains `packages/contracts` (a workspace member per lines 26-30) with its own `contracts:test` script (`cd packages/contracts && forge test`, line 17). Any contributor or CI pipeline running the conventional `bun run test` will get a green result without ever executing the Solidity test suite, creating false confidence that the whole repo is tested. The two suites are not chained or coordinated by any script in this file.

recommendation:
Chain both suites in the canonical script, e.g. `"test": "vitest run && bun run contracts:test"`, or if contract tests must stay separate, add a CI job that explicitly runs `contracts:test` and document the split so `test` is not treated as the complete repo-wide suite.

test analysis:
No test files are included in this feature, and the issue is in package.json script wiring, which test code cannot detect; the existence of the separate `contracts:test` script is itself evidence that the vitest `test` script does not cover the contracts package.

minimum fix scope:
package.json scripts section (line 10, and optionally line 17)

## medium: setIndexerCursor can regress next_block with concurrent or out-of-order indexer workers

id: fnd_sig-feat-service-1e40670be0-6efd_90a8a682a3
category: concurrency
confidence: medium
triage: risk
status: open
feature: Node source apps/api/src/db (feat_service_1e40670be0)

evidence:
- apps/api/src/db/queries.ts:185-195

The upsert unconditionally writes next_block = excluded.next_block. If two workers share an indexer cursor (or a single worker commits a slow batch after a fast one), a stale cursor value overwrites a more advanced one. The cursor then moves backward and blocks are re-scanned. Re-processing is only partially idempotent: recordSwap and insertLiquidityEvent dedupe via ON CONFLICT DO NOTHING, but upsertToken/upsertPool re-run and insertTransaction has no conflict clause, so a replay can raise unique-constraint errors. Cursor regression can also cause an indexer to never make forward progress if events fail on replay.

recommendation:
Make the update monotonic: ON CONFLICT(chain_id, indexer) DO UPDATE SET next_block = MAX(next_block, excluded.next_block), updated_at = excluded.updated_at (or add WHERE next_block < excluded.next_block to the DO UPDATE clause).

test analysis:
No tests are included for this module (feature tests: []), and the bug only manifests with a second write after a first, which a naive single-call test would not catch.

suggested regression test:
Test that setIndexerCursor with a smaller nextBlock after a larger one leaves the larger value in place.

minimum fix scope:
apps/api/src/db/queries.ts (setIndexerCursor)

repro:
setIndexerCursor(1, 'v3', 105n) followed by setIndexerCursor(1, 'v3', 103n) leaves next_block = 103.

## medium: sortBy/sortDirection/filterToken are forwarded to PoolService without enum/format validation

id: fnd_sig-feat-route-615aa60302-824a56_8a6598ae56
category: security
confidence: medium
triage: risk
status: open
feature: Hono route GET / (feat_route_615aa60302)

evidence:
- apps/api/src/routes/pools.ts:42-46 (pools.get("/"))

User-controlled query params are cast directly to the union types SortField/SortDirection with `as` (lines 42-43) and filterToken is passed through unvalidated (line 44), then placed into PoolQueryOptions and sent to PoolService.listPools, which resolves through a D1-backed Effect layer (line 53; README line 9 confirms D1 as the data path). Because these values are composed into a SQL-backed query downstream, an arbitrary value such as sortBy=name or a crafted string may either (a) be interpolated into an ORDER BY/filter clause by the service, creating an injection vector, or (b) at minimum throw inside the service and surface as a 500 instead of a 400. The route is the user-input trust boundary, so enum membership and token format should be validated here. Note the service implementation was not included in this review, so the injection impact could not be confirmed directly; the missing validation at the boundary is confirmed by the shown code.

recommendation:
Validate sortBy against the allowed set (tvl|volume|fees|created) and sortDirection against (asc|desc) before building options, returning 400 with a descriptive message on mismatch; validate filterToken against the 0x + 64-hex pattern (consistent with the poolId check at line 65) or reject/ignore it. Never rely on the type cast as validation.

test analysis:
No tests are included for this feature (tests: []), and the coverage configuration omits src/routes/pools.ts entirely, so no test exercises the validation boundary of these params.

suggested regression test:
Route-level test asserting that GET / with sortBy=name, sortDirection=sideways, and filterToken=not-an-address each return 400, and that valid enum values reach the service with the parsed options intact.

minimum fix scope:
apps/api/src/routes/pools.ts (validate params at lines 42-44 and return 400 on invalid values).

## medium: Swap quote expiry is never enforced: expiresAt/deadline are dead fields and the 'expired' error reason is unreachable

id: fnd_sig-feat-library-8f5d5fd534-0ee2_789b8a31a3
category: api-contract
confidence: medium
triage: contract-mismatch
status: open
feature: Node source apps/api/src/services#1 (feat_library_8f5d5fd534)

evidence:
- apps/api/src/services/swap.service.ts:154-156
- apps/api/src/services/swap.service.ts:296-317
- apps/api/src/services/swap.service.ts:348-352

finishQuote stamps SwapQuote.expiresAt = now + 60s, advertising a 1-minute validity window, but nothing in the service ever validates it. getQuote never checks params.deadline (the optional deadline field in SwapQuoteParams is declared but never read) and never rejects stale quotes, so the SwapQuoteError reason 'expired' (declared at line 52) can never be produced. Worse, buildCalldata ignores the quote's expiresAt and stamps a brand-new deadline of now + 1200s into the router calldata. A user who obtains a quote, waits several minutes while the price moves against them, and then builds calldata from the stale quote gets a fresh 20-minute deadline with a minAmountOut computed against the old price: the slippage guarantee the quote advertised is silently extended ~20x. The swap will either revert at the router (wasted gas) or execute at a price the 60-second quote window was supposed to invalidate.

recommendation:
Enforce expiry in getQuote/buildCalldata: reject quotes older than quote.expiresAt (or honor params.deadline when provided) with a SwapQuoteError('expired', ...) before building calldata, and stop minting a fresh deadline in buildCalldata — either pass the quote's expiresAt through or re-quote when the quote is stale.

test analysis:
The included tests (quote-engine, chain-state-reader, position.service) never exercise swap.service; there is no test asserting that a stale quote is rejected or that buildCalldata respects expiresAt.

suggested regression test:
Test that buildCalldata on a quote whose expiresAt is in the past (or whose age exceeds the advertised window) fails with reason 'expired' and produces no calldata.

minimum fix scope:
apps/api/src/services/swap.service.ts (getQuote/buildCalldata expiry check + deadline propagation)

## medium: Swaps for pools initialized before the initial index window are persisted without pool linkage and the pool row is never created

id: fnd_sig-feat-library-e99f39f7ec-2ee8_b7e0127ca9
category: data-loss
confidence: medium
triage: risk
status: open
feature: Node source apps/api/src/services/:indexer (feat_library_e99f39f7ec)

evidence:
- apps/api/src/services/indexer.service.ts:126-133 (resolveStartBlock)
- apps/api/src/services/indexer.service.ts:239-272 (persistV4)
- apps/api/src/services/indexer.service.ts:303-307

A fresh chain with no cursor and no genesisBlock starts indexing at head - 10_000n (line 132). Pools are only ever created from Initialize events (persistV4 'initialize' branch), so any v4 pool whose Initialize log predates that first window never gets a Pool row. Every subsequent Swap on such a pool hits the pool === null branch (lines 240-241, 259-271): the swap is recorded with poolId: null and null tokenIn/tokenOut/amounts linkage, and the post-swap price/liquidity update is skipped entirely. Because persists are conflict-guarded idempotent writes (comment at lines 303-307), re-indexing the same range later (e.g. an indexRange backfill that finally reaches the Initialize) does not repair the already-recorded orphaned swap rows, so the linkage loss is permanent unless a bespoke repair query is written. The code comment only acknowledges the in-window 'swap indexed before its Initialize' ordering, not the default-config scenario where the Initialize is never indexed at all.

recommendation:
Ensure the pool exists before recording a swap: either upsert a minimal pool row from the Swap event (using the poolId with null/placeholder token fields) or require/validate that genesisBlock covers contract deployment and fail loudly when swaps reference unknown pools. Additionally, add a repair/backfill query that re-associates orphaned swap rows once the pool row exists.

test analysis:
The included test file only exercises the pure decoders (parseV4PoolManagerLog, toRawLog); there are no tests for persistV4, resolveStartBlock, or the pool-missing swap path, so the orphaned-swap behavior is unverified.

suggested regression test:
Service-level test with a fake PublicClient returning a Swap log for a pool whose Initialize is outside the indexed range: assert recordSwap receives poolId and token linkage once the pool later becomes known, and that a backfill over the same range repairs previously orphaned rows.

minimum fix scope:
apps/api/src/services/indexer.service.ts

repro:
Configure a chain with no genesisBlock and no cursor, deploy the indexer more than 10,000 blocks after the v4 PoolManager contract, and run indexBatch for v4_pool_manager: the Initialize event is outside the first window, the pool is never upserted, and every swap on it is persisted with poolId=null and null token linkage.

## medium: test:coverage depends on an undeclared @vitest/coverage-v8 provider

id: fnd_sig-feat-library-b4cb74367c-9ddc_bb71820cb2
category: build-release
confidence: medium
triage: risk
status: open
feature: Node package aetherdex (feat_library_b4cb74367c)

evidence:
- package.json:11
- package.json:31-35

`bun run test:coverage` runs `vitest run --coverage`. Vitest requires a coverage provider package (@vitest/coverage-v8 or @vitest/coverage-istanbul) to be installed; devDependencies declare only @biomejs/biome, typescript, and vitest, and vitest does not bundle the provider. Without it, `vitest run --coverage` fails with a missing-provider error, so the documented quality command (README.md line 50) is broken out of the box. Additionally, no coverage.thresholds are configured, so even a working run would not enforce the 70/70/90 targets AGENTS.md (lines 195, 343-344) cites — though AGENTS.md notes threshold enforcement is a Workstream C target.

recommendation:
Add @vitest/coverage-v8 (matching the vitest major version) to devDependencies and, when threshold enforcement is intended, configure coverage.thresholds per project in vitest.config.ts.

test analysis:
No test exercises the npm scripts; the failure manifests only when a developer or CI runs `bun run test:coverage`.

minimum fix scope:
package.json

## medium: TP/SL and auto-recenter evaluation depends on `poolSpot` cache entries that are only written for the top 50 pools by TVL

id: fnd_sig-feat-library-c77821ce5c-8725_5eb61273b1
category: bug
confidence: medium
triage: risk
status: open
feature: Node source apps/api/src/workers (feat_library_c77821ce5c)

evidence:
- apps/api/src/workers/cron-handler.ts:300-303 (refreshTopPools)
- apps/api/src/workers/cron-handler.ts:333-348 (refreshTopPools)
- apps/api/src/workers/queue-handler.ts:326-331 (handleTpSlEvaluate)

`refreshTopPools` only computes `poolSpot:<id>` for the 50 highest-TVL active pools, and TP/SL evaluation hard-requires that cache entry ('No spot price available for pool ..., skipping'). Any tp-sl-evaluate or auto-recenter-check message for a pool outside the top 50 by TVL is skipped every tick until the order expires — the trigger is never evaluated even when breached. Confidence is medium because a writer outside this feature could populate poolSpot for other pools, but no such path exists in the included files.

recommendation:
Compute/store pool spot prices for all pools referenced by active orders/policies (e.g., backfill poolSpot for pools with pending tp_sl_orders or active position_policies), or fall back to an on-chain spot read in the evaluation handlers.

test analysis:
No tests exercise the poolSpot lifecycle or the skip paths in handleTpSlEvaluate.

suggested regression test:
Seed a pending order for a pool ranked outside the top 50 by TVL, run the refresh + evaluate flow, and assert the order is evaluated rather than skipped.

minimum fix scope:
apps/api/src/workers/cron-handler.ts

## medium: typecheck runs bare tsc without regenerating TanStack Router route files, so fresh-checkout CI can fail or check stale generated code

id: fnd_sig-feat-release-a568f2a731-db29_7f1de353f1
category: build-release
confidence: medium
triage: risk
status: open
feature: Package script typecheck (@aetherdex/web) (feat_release_a568f2a731)

evidence:
- apps/web/package.json:8
- apps/web/package.json:16

The build script (line 8) runs `tsr generate && vite build`, which shows the project uses TanStack Router's code generation (`routeTree.gen.ts` and related files are produced by `tsr generate` and are typically gitignored). The release feature's typecheck script (line 16) is a bare `tsc --noEmit` with no preceding `tsr generate`. On a fresh checkout (CI) where generated route files are absent, typecheck fails spuriously; when stale generated files are present (committed or leftover locally), typecheck passes against code that no longer matches the route definitions, giving false confidence right before the build regenerates them. The typecheck gate therefore does not validate the code as it will be built, and its pass/fail outcome depends on untracked generation state rather than source truth.

recommendation:
Make typecheck generation-aware, e.g. `"typecheck": "tsr generate && tsc --noEmit"`, or commit generated route files and keep them in sync (for example via a pre-typecheck hook or CI step). At minimum, run the same generation step before typecheck as before build so both gates validate identical inputs.

test analysis:
No tests are included for this feature, and the behavior is an artifact of script ordering plus repository generation state; vitest unit tests never execute the package scripts, so nothing exercises `tsc --noEmit` on a clean checkout.

suggested regression test:
A CI job (or a script-level test) that runs `bun run typecheck` on a pristine clone with generated route files removed and asserts it exits 0; this fails today and passes once `tsr generate` precedes `tsc`.

minimum fix scope:
apps/web/package.json: update the typecheck script to run `tsr generate` before `tsc --noEmit`.

repro:
Fresh `bun install` + `bun run typecheck` in apps/web on a checkout where routeTree.gen.ts is not committed; tsc errors on missing generated module imports.

## medium: typecheck script only typechecks the root project and may skip workspace packages

id: fnd_sig-feat-release-a235aa99b1-caed_9da31050b3
category: build-release
confidence: medium
triage: risk
status: open
feature: Package script typecheck (feat_release_a235aa99b1)

evidence:
- package.json:15 (scripts.typecheck)
- package.json:26-30 (workspaces)

The typecheck script runs `tsc --noEmit -p tsconfig.json` against a single root project, while the sibling `dev` and `build` scripts fan out across all workspaces via `bun run --filter '*'` and the workspaces field covers apps/*, packages/*, and infra/*. Unless the root tsconfig.json happens to include every workspace source file (it is not part of the reviewed file set, so coverage cannot be verified), code in workspace packages can build and pass tests while never being typechecked, letting type errors reach the deploy scripts (api:deploy, web:deploy, contracts:deploy:sepolia) undetected. The inconsistency with dev/build, which deliberately iterate all workspaces, makes it likely the root project does not cover all packages.

recommendation:
Typecheck per workspace instead of (or in addition to) the root: add a `typecheck` script to each workspace package and change the root script to `bun run --filter '*' typecheck`, consistent with dev/build; alternatively use `tsc -b` with project references rooted in a tsconfig that includes every workspace. Wire the aggregate into CI as a required check.

test analysis:
The feature lists no tests and no CI workflow is included in the reviewed file set, so nothing asserts that every workspace package is covered by the typecheck command.

suggested regression test:
A vitest test (or CI step) that introduces a deliberate type error in a source file of a workspace package (e.g., packages/*) and asserts `bun run typecheck` exits non-zero; a companion check that the clean tree exits 0.

minimum fix scope:
package.json

## medium: Unauthenticated /nonce endpoint creates one Durable Object per request with no rate limiting

id: fnd_sig-feat-library-bd573b816b-753b_cb2c8357ab
category: security
confidence: medium
triage: risk
status: open
feature: Node source apps/api/src/auth (feat_library_bd573b816b)

evidence:
- apps/api/src/auth/routes.ts:17-27
- apps/api/src/auth/siwe.ts:39-61

Every /nonce call generates a fresh random 32-hex nonce and calls nonceNamespace.get(nonceNamespace.idFromName(nonce)).fetch(...), instantiating a distinct Durable Object named after that nonce. The endpoint requires no authentication and has no rate limiting, so an attacker can spam it to create an unbounded number of DO instances (billed per-instance on Cloudflare) and force instance wake-ups, enabling a cost-exhaustion/availability attack. The DO presumably self-cleans on expiry, but instances persist for the 5-minute nonce TTL and each call still incurs instance creation/billing. Confidence is medium because the DO cleanup behavior is not visible in the included files, but the per-request unique-instance creation pattern is clear from the code.

recommendation:
Add per-client/IP rate limiting (e.g., a KV- or DO-based token bucket) on POST /nonce and /verify, and/or cap outstanding nonces per client; alternatively use a single DO that stores nonces keyed by name instead of one DO per nonce.

test analysis:
No tests exist for this source group, and rate-limit behavior would require the DO implementation, which is not included in this feature's files.

suggested regression test:
A test that issues N nonce requests from the same client and asserts the client is throttled after a configured limit (or that a bounded number of DO instances are created).

minimum fix scope:
apps/api/src/auth/routes.ts and/or the siwe-nonce Durable Object

## medium: Uncaught localStorage exceptions can crash the component and break theme toggle

id: fnd_sig-feat-ui-flow-62776b9e70-2379_1bb0e0e9e7
category: bug
confidence: medium
triage: risk
status: open
feature: React component ThemeToggle (feat_ui-flow_62776b9e70)

evidence:
- apps/web/src/components/ThemeToggle.tsx:10-18 (ThemeToggle)
- apps/web/src/components/ThemeToggle.tsx:20-25 (ThemeToggle)

Both localStorage.getItem (line 11) and localStorage.setItem (line 24) are called without try/catch. Browsers throw SecurityError when storage is blocked (sandboxed iframes, third-party contexts, privacy modes) or QuotaExceededError on setItem. An exception thrown inside the mount useEffect propagates and, without an error boundary, unmounts the whole React tree; an exception in the onClick handler breaks the toggle. The feature metadata itself lists user-input/network/serialization trust boundaries, and storage is untrusted environment state that commonly throws in the wild. The tests stub localStorage with a benign in-memory Map, so this path is never exercised.

recommendation:
Wrap all localStorage access in a small safe helper (e.g., safeGetTheme()/safePersistTheme() with try/catch returning null/no-op on failure) so the UI degrades gracefully to the default theme and the toggle still updates data-theme even when persistence fails.

test analysis:
The test harness (apps/web/test/components/ThemeToggle.test.tsx lines 8-23) replaces localStorage with a Map-backed stub that never throws, so no test exercises storage-failure behavior.

suggested regression test:
Stub localStorage.getItem to throw, render ThemeToggle, and assert rendering completes and data-theme defaults to 'aetherdex'; then stub setItem to throw and assert clicking still flips the data-theme attribute.

minimum fix scope:
apps/web/src/components/ThemeToggle.tsx only: add try/catch around getItem/setItem (or a shared safe-storage helper).

repro:
In a sandboxed iframe or browser context where storage access throws, render the component and observe the mount effect throwing; alternatively call setItem with a throwing stub and click the button.

## medium: Unvalidated envelope payload fields can throw: missing tokenAddress crashes the filter effect; null change24h/volume24h crash rendering

id: fnd_sig-feat-ui-flow-48e197d8fd-985f_930b1712cd
category: bug
confidence: medium
triage: risk
status: open
feature: React component PriceTicker (feat_ui-flow_48e197d8fd)

evidence:
- apps/web/src/components/PriceTicker.tsx:68-74
- apps/web/src/components/PriceTicker.tsx:111-116
- apps/web/src/components/PriceTicker.tsx:118-120

Envelope data comes from an untrusted network source (trust boundary: network/serialization), but only payload.price is type-checked. If data.tokenAddress is missing or non-string, `payload.tokenAddress.toLowerCase()` throws inside the effect; with no error boundary evident, React unmounts the tree. Likewise, JSON `null` values pass `data?.change24h !== undefined` (null !== undefined) and the volume24h equivalent, so formatPercent(null) → null.toFixed(2) and formatVolume(null) → null.toFixed(0) throw during render. Absent JSON fields arrive as undefined (safe), but an explicit null — common for "no data" — crashes.

recommendation:
Validate every field before use: `typeof payload.tokenAddress === "string"`, `typeof payload.change24h === "number"`, `typeof payload.volume24h === "number"`, treating null/undefined as absent; consider an error boundary as defense in depth.

test analysis:
No tests exist for the component (tests: []); malformed-frame paths are untested.

suggested regression test:
RTL test feeding envelopes with missing tokenAddress and with null change24h/volume24h, asserting the component renders the fallback UI instead of throwing.

minimum fix scope:
apps/web/src/components/PriceTicker.tsx

repro:
Server sends {"type":"price","data":{"tokenAddress":null,"price":1}} → TypeError in the filter effect; or sends change24h:null → render-time TypeError in formatPercent.

## medium: useWebSocket stale-reconnect race on url change: old socket's onclose schedules a reconnect to the previous URL and clobbers wsRef, leaking the live socket

id: fnd_sig-feat-ui-flow-48e197d8fd-9a44_1a347aa35f
category: concurrency
confidence: medium
triage: risk
status: open
feature: React component PriceTicker (feat_ui-flow_48e197d8fd)

evidence:
- apps/web/src/hooks/useWebSocket.ts:95-110
- apps/web/src/hooks/useWebSocket.ts:131-135
- apps/web/src/components/PriceTicker.tsx:59-62

PriceTicker changes the URL whenever tokenAddress/chainId changes, which re-runs the hook's effect. Teardown of the old effect sets mountedRef=false and closes wsRef.current; the new effect synchronously sets mountedRef=true and opens the new socket. The old socket's onclose fires asynchronously after both runs, sees mountedRef=true, and — since reconnectCountRef is below reconnectAttempts — schedules setTimeout(connect, ...) from the OLD closure (capturing the old url) and stores the timer in the shared reconnectTimerRef. When it fires it creates a WebSocket to the OLD url and overwrites wsRef.current, orphaning the real socket for the current URL; a later cleanup/unmount then closes the stale socket while the live one is never closed (leaked connection). The stale socket's events also flip isConnected for the wrong socket.

recommendation:
Prevent stale closures from reconnecting: capture a per-effect-run `active`/generation flag that cleanup flips, check it in onclose/connect, clear reconnectTimerRef at the start of each effect run, and only let onclose schedule a reconnect if the closing socket is still wsRef.current.

test analysis:
No tests exist for the hook or component; this race requires a mocked WebSocket plus controlled close-event ordering and fake timers, which no included test covers.

suggested regression test:
Vitest with fake timers and a mocked WebSocket: mount the hook with url A, change url to B, then fire the old socket's close event and advance timers; assert no new WebSocket is constructed for url A and that wsRef/state reflect only url B's socket.

minimum fix scope:
apps/web/src/hooks/useWebSocket.ts

repro:
Mount with url A and wait for open; change the URL to B; ~3-6s later the hook opens a second socket to url A while wsRef points at it; unmounting closes the A socket and leaves the B socket open until GC.

## medium: WorkerEnv tag uses Context.Service, an API removed in Effect 3/4; pinned effect 4.0.0-beta.100 expects Context.Tag

id: fnd_sig-feat-library-36b3e24e1a-d4cf_54e9345a21
category: api-contract
confidence: medium
triage: contract-mismatch
status: open
feature: Node source apps/api/src/layers (feat_library_36b3e24e1a)

evidence:
- apps/api/src/layers/WorkerEnv.ts:13 (WorkerEnv)
- apps/api/package.json:45

package.json pins "effect": "4.0.0-beta.100". The class-style Context.Service API was removed in Effect 3.x and replaced by Context.Tag, which accepts an optional string id — exactly the "@aetherdex/WorkerEnv" argument passed here. Line 15's Layer.succeed(WorkerEnv, env) also requires a Tag-shaped value. If Context.Service is absent from the 4.0.0-beta.100 type declarations, `bun run typecheck` (tsc --noEmit, package.json line 18) fails for the whole apps/api package; and because the call runs at module top level, any import of this module (esbuild/vitest or the deployed worker) throws a TypeError at load time. The correct API is Context.Tag<WorkerEnv>("@aetherdex/WorkerEnv").

recommendation:
Replace line 13 with `export const WorkerEnv = Context.Tag<WorkerEnv>("@aetherdex/WorkerEnv")` and keep the exported WorkerEnv interface; Layer.succeed on line 15 is then correct as-is.

test analysis:
No tests exist for this file (feature tests array is empty), and vitest's esbuild transform strips types without typechecking, so even a passing runtime test would not flag a missing/renamed Effect export; the typecheck script is the only gate and it is currently at risk.

suggested regression test:
A vitest case that imports WorkerEnv.ts (import fails if Context.Service is undefined at runtime) and asserts WorkerEnv.serviceId (or the tag's id) equals '@aetherdex/WorkerEnv' and that Effect.provide(makeWorkerEnvLayer(env), Effect.service(WorkerEnv)) yields the same env instance.

minimum fix scope:
apps/api/src/layers/WorkerEnv.ts line 13 only.

repro:
Run `bun run typecheck` in apps/api against the pinned effect version; expect TS2339 (Property 'Service' does not exist) on line 13, and a TypeError at import time under vitest or wrangler dev if the export is also missing at runtime.

## medium: sortBy/sortDirection query params cast to enums without runtime validation

id: fnd_sig-feat-route-8a6337af57-845442_ac5e5058ee
category: api-contract
confidence: low
triage: contract-mismatch
status: open
feature: Hono route GET /:poolId (feat_route_8a6337af57)

evidence:
- apps/api/src/routes/pools.ts:42-44
- apps/api/src/routes/pools.ts:46

sortBy and sortDirection are taken from query params and cast with `as SortField` / `as SortDirection` — pure compile-time assertions with no runtime whitelist. Arbitrary strings then flow into PoolQueryOptions and into PoolService.listPools. If the service interpolates sortBy into an ORDER BY clause (common for dynamic sorting), this is a SQL injection vector via a public unauthenticated endpoint; at minimum, invalid values produce 500s instead of documented 400s. Confidence is low because the service implementation is not included, but the boundary-level validation gap is directly visible.

recommendation:
Validate sortBy against {tvl, volume, fees, created} and sortDirection against {asc, desc} at the handler boundary, returning 400 for anything else, and ensure the service builds ORDER BY only from a parameterized whitelist.

test analysis:
No tests exist for the pools routes and the validation is absent from the handler, so the invalid-input path is entirely unexercised.

suggested regression test:
Request GET /api/v1/pools?sortBy=invalid and GET /api/v1/pools?sortDirection=up; assert 400 responses rather than 500 or injected queries.

minimum fix scope:
Add an explicit whitelist check for both params in the GET / handler before constructing PoolQueryOptions.

## low: /verify collapses all failures, including server-side errors, into a 401 Authentication failed response

id: fnd_sig-feat-library-bd573b816b-aafe_30ec797fd8
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source apps/api/src/auth (feat_library_bd573b816b)

evidence:
- apps/api/src/auth/routes.ts:37-52

Effect.runPromise(...).catch(...) wraps both expected Effect.failures (bad signature, consumed nonce, domain mismatch) and unexpected thrown errors (KV write failure, DO fetch failure, network errors) into the same { error: String(err) } object, and the handler maps every case to 401 "Authentication failed". As a result a KV/Durable Object outage is indistinguishable from invalid credentials: legitimate users see a 401 and retry with fresh nonces while the real cause is infrastructure, and operators get no signal that verification is failing for non-auth reasons. This is a bad-error-handling/API-contract issue, not an auth bypass (the 401 is fail-closed).

recommendation:
Distinguish failure classes: map Effect.fail from verification logic to 401, but map thrown/unexpected errors (KV, DO, JSON parsing) to 500 with a generic server-error message and log the underlying error; do not expose String(err) internals to clients.

test analysis:
No tests exist for this source group; the error-classification behavior is untested.

suggested regression test:
Mock KVCacheService.putSession to throw and assert POST /verify returns 500 (not 401); assert an invalid signature returns 401.

minimum fix scope:
apps/api/src/auth/routes.ts

## low: `packageManager` pins mutable `bun@canary` tag, making installs non-reproducible

id: fnd_sig-feat-test-suite-84ae84a25a-c_123df634fd
category: build-release
confidence: high
triage: risk
status: open
feature: Package script test (feat_test-suite_84ae84a25a)

evidence:
- package.json:40 (packageManager)

`"packageManager": "bun@canary"` points at a rolling, mutable distribution tag rather than a fixed version. Canary builds are overwritten in place, so local and CI installs at different times can resolve different toolchain versions, and a broken canary build can break `bun install` and thereby every script including `test` (line 10). This contradicts the reproducibility intent of pinning `engines.bun >=1.4.0` (lines 36-39).

recommendation:
Pin an exact stable version (e.g. `bun@1.4.x` satisfying `engines.bun`) or the exact version recorded in the lockfile, and install that pinned version in CI.

test analysis:
Toolchain version pinning is install-time metadata; no test executes against a pinned package manager, and no test files are included in this feature.

minimum fix scope:
package.json line 40

## low: 500 responses leak raw internal error text via String(err)

id: fnd_sig-feat-route-b4cf758698-3e73a0_65f11df4c9
category: security
confidence: high
triage: confirmed-bug
status: open
feature: Hono route GET /:address (feat_route_b4cf758698)

evidence:
- apps/api/src/routes/tokens.ts:93-95
- apps/api/src/routes/tokens.ts:67-69

Both handlers (the /:address route at lines 93-95 and the sibling / route at lines 67-69) return c.json({ error: String(err) }, 500). Effect error values can embed binding names (DB/CACHE/STORAGE), KV/D1 internals, URLs, and stack traces; echoing them verbatim into the response body discloses internal service topology to any caller of this public endpoint and makes the error contract unstable. This is a captured-response pattern (user-visible output), not a logging fallback.

recommendation:
Log the full error server-side (console.error or an Effect logger) and return a generic message such as { error: "Internal server error" } with 500; keep detailed diagnostics out of the response body.

test analysis:
No tests exist for this route, so the error path (lines 93-95) is untested and the leak would not be caught.

suggested regression test:
Force getToken to throw and assert the 500 response body contains only a generic message and none of the internal error text.

minimum fix scope:
apps/api/src/routes/tokens.ts — replace String(err) with a logged, generic 500 response in both handlers.

repro:
Cause TokenListService.getToken to fail (e.g., KV read error or invalid layer wiring) and observe the raw Effect error string, including internal identifiers, in the HTTP 500 body.

## low: Address component has no unit tests for its truncation logic

id: fnd_sig-feat-ui-flow-458f3992b6-9d5f_e62d67ba7a
category: test-gap
confidence: high
triage: test-gap
status: open
feature: React component Address (feat_ui-flow_458f3992b6)

evidence:
- apps/web/package.json:11-13
- apps/web/package.json:49-51
- apps/web/src/components/Address.tsx:7-16 (Address)

The component contains boundary logic (the exact threshold at which truncation starts, empty-string passthrough, custom `length`, ellipsis construction) but the feature declares an empty tests array and no test file was included. The project is fully equipped for component tests: `vitest run` is wired in package.json lines 11-13 and @testing-library/react, jest-dom, and happy-dom are present in devDependencies (lines 49-51, 60). Given the two findings above (branch attribute divergence and unvalidated length) are only detectable through rendering, the absence of tests leaves the component's contract unenforced.

recommendation:
Add a component test (e.g. apps/web/src/components/Address.test.tsx) covering: empty string, short string below threshold, 42-char address with default length producing "0x…5678" style output, custom `length`, and preservation of the full address in the `title` attribute.

test analysis:
There are no existing tests for this feature; this finding is precisely about that absence.

suggested regression test:
`describe('Address')` block asserting exact rendered text for empty/short/42-char inputs, custom length, and `title` attribute presence on both branches.

minimum fix scope:
Add apps/web/src/components/Address.test.tsx

## low: Build script ships without type-checking (vite/esbuild transpiles without tsc)

id: fnd_sig-feat-release-fa18bd5381-4f75_88c4db90f9
category: build-release
confidence: high
triage: risk
status: open
feature: Package script build (@aetherdex/web) (feat_release_fa18bd5381)

evidence:
- apps/web/package.json:8 (build)

The build script is `tsr generate && vite build`. Vite's esbuild-based transform strips TypeScript types without running the type checker, so `bun run build` exits 0 even when the codebase has type errors. The repository has a separate `typecheck` script (`tsc --noEmit`, line 16), which means the type-checking tool exists but is not wired into the build path; any release pipeline that invokes only `bun run build` (the standard contract for this feature) will publish code that fails `tsc`. This is a classic release hazard: the build artifact is not a proof of type correctness.

recommendation:
Compose the check into the build path, e.g. `"build": "tsr generate && tsc --noEmit && vite build"`, or add an explicit CI step that runs `bun run typecheck` before `bun run build` and gate releases on it.

test analysis:
The feature has no tests (`tests: []`), and no CI workflow file is included in the review scope; the typecheck script (line 16) is separate from the build script and nothing in the owned file enforces its execution during builds.

suggested regression test:
A CI job that runs `bun run typecheck` followed by `bun run build` and fails the pipeline if either step fails; optionally a vitest test spawning the build and asserting `dist/` contains index.html.

minimum fix scope:
apps/web/package.json (build script composition)

## low: bun run typecheck excludes test/ and vitest.config.ts, so type errors in tests and the test harness go undetected

id: fnd_sig-feat-library-a50e9b911f-a8e8_afed632442
category: test-gap
confidence: high
triage: test-gap
status: open
feature: Node package @aetherdex/api (feat_library_a50e9b911f)

evidence:
- apps/api/tsconfig.json:14-15
- apps/api/package.json:18

tsconfig.json's include is ["src/**/*", "worker-configuration.d.ts"], which excludes test/** and vitest.config.ts. The typecheck script (tsc --noEmit) therefore type-checks only src, while vitest transpiles tests via esbuild without type checking. Type errors in the 12 test files (e.g., assertions against changed service signatures) and in vitest.config.ts are caught neither by CI typecheck nor by the test runner, so they surface only as runtime failures or never (dead assertions).

recommendation:
Add "test/**/*" and "vitest.config.ts" to tsconfig include (with a separate tsconfig.test.json if DOM/worker types conflict), so `bun run typecheck` covers the whole package.

test analysis:
This is a gap in the verification tooling itself; no test can detect that tests are not type-checked.

minimum fix scope:
apps/api/tsconfig.json — extend include to test/**/* and vitest.config.ts (and package.json typecheck script if a dedicated tsconfig is needed).

repro:
Introduce a type error in any apps/api/test/*.ts file; `bun run typecheck` exits 0 and `bun run test` still runs (esbuild strips types).

## low: Button propagates className via rest spread after attribute composition, allowing callers to silently clobber styling

id: fnd_sig-feat-library-d06274bfb5-abcb_dcd4016ad3
category: maintainability
confidence: high
triage: risk
status: open
feature: Node source apps/web/src/components/ui (feat_library_d06274bfb5)

evidence:
- apps/web/src/components/ui/Button.tsx:14-33 (Button)

className is appended last in the template literal (line 31), so caller classes can override library classes in CSS specificity ties — this is intentional and standard. However, the `{...rest}` spread on line 33 also forwards arbitrary attributes; combined with the explicit `disabled` destructure, a caller passing a non-standard attribute (e.g., `onClick` is fine, but `type`, `name`, `form`) is handled. This is standard React component practice and not a defect.

recommendation:
No change required; pattern is idiomatic.

test analysis:
N/A

## low: cancelOrder/executeOrder/expireOrder report OrderNotFoundError when the row exists but is not pending

id: fnd_sig-feat-library-ad98bca978-05ff_a8e79d427d
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source apps/api/src/services#2 (feat_library_ad98bca978)

evidence:
- apps/api/src/services/tp-sl.service.ts:264-270
- apps/api/src/services/tp-sl.service.ts:290-296
- apps/api/src/services/tp-sl.service.ts:313-319

All three status transitions run UPDATE ... WHERE status = 'pending' and map changes === 0 to OrderNotFoundError. Zero affected rows also occurs when the order exists but is already executed, cancelled, or expired — including the common case of a delivery webhook retrying an executeOrder that already succeeded. Callers cannot distinguish 'order does not exist' from 'already in a terminal state', so retries after a timeout surface as not-found failures and duplicate callbacks cannot be detected as such.

recommendation:
Distinguish the two cases: check existence first (or use RETURNING) and return a distinct state-conflict error when the order exists but is not pending; at minimum document that OrderNotFoundError covers non-pending states.

test analysis:
No test file for tp-sl.service.ts is included in this feature, so the error semantics of the status transitions are unverified.

suggested regression test:
Seed an executed order, call executeOrder again, and assert a state-conflict error is returned rather than OrderNotFoundError.

minimum fix scope:
apps/api/src/services/tp-sl.service.ts (cancelOrder/executeOrder/expireOrder)

## low: Card accepts variant="bordered" but never implements it

id: fnd_sig-feat-library-d06274bfb5-6a80_a47b854483
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source apps/web/src/components/ui (feat_library_d06274bfb5)

evidence:
- apps/web/src/components/ui/Card.tsx:5-12 (Card)

The variant prop is typed as "default" | "compact" | "bordered", but the implementation only checks variant === "compact". The "bordered" value produces output identical to "default", and since the separate `bordered` prop defaults to true, even "default" already renders a border. Worse, a caller passing variant="bordered" together with bordered={false} gets NO border, directly contradicting the variant name. This is a silent API contract mismatch: the type advertises behavior the component does not deliver.

recommendation:
Either remove "bordered" from the variant union, or implement it (e.g., treat it as forcing the border regardless of the `bordered` prop). Also consider whether `bordered` defaulting to true while "default" is the default variant is intentional.

test analysis:
The only test file for this feature (apps/web/test/index.test.ts) never imports or renders any component from this source group, so the dead variant is never exercised.

suggested regression test:
A component test asserting that <Card variant="bordered" bordered={false}> still renders the border classes (if the variant is kept), or a type-level test asserting the variant union no longer contains "bordered" (if removed).

minimum fix scope:
apps/web/src/components/ui/Card.tsx

repro:
Render <Card variant="bordered" bordered={false}> — no border class is emitted despite the variant name; render <Card variant="bordered"> — identical markup to <Card variant="default">.

## low: Catch handler returns raw internal error strings to unauthenticated clients

id: fnd_sig-feat-route-552aaeecba-7354a4_05b7f5d818
category: security
confidence: high
triage: confirmed-bug
status: open
feature: Hono route GET /v3/quote (feat_route_552aaeecba)

evidence:
- apps/api/src/routes/v3-quote.ts:69-72

For any error that is not an instance of V3QuoteError, the handler serializes the thrown value with String(error) directly into the JSON response body. This endpoint is public and unauthenticated. Unexpected failures here include viem/JSON-RPC errors from the RPC layer (whose messages commonly embed the RPC provider URL, request payloads, or raw provider error text) and any programming error thrown through the Effect pipeline. Leaking these strings gives external callers internal infrastructure detail (endpoints, provider identities, internal state) that aids targeting, and it degrades the API contract since error payloads are unstable across internal failures. V3QuoteError messages are likewise returned verbatim, so any sensitive detail embedded in service error messages is also exposed.

recommendation:
Return a fixed generic message (e.g., { error: "Quote failed", reason }) for non-V3QuoteError failures and log the detailed error server-side (console.error / observability), and ensure V3QuoteError messages are sanitized client-safe strings rather than wrapped underlying provider errors.

test analysis:
No tests exist for this route, so the error-serialization behavior is unexercised.

suggested regression test:
Stub the quote service to throw a non-V3QuoteError Error with a message containing an RPC URL, assert the response body's error field does not contain that string while the status is 503.

minimum fix scope:
Replace String(error) in the catch handler with a constant generic message and log the original error.

## low: Declared variant "bordered" has no effect — misleading API contract

id: fnd_sig-feat-ui-flow-f49a6c4ae7-8229_6810a4823e
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: React component Card (feat_ui-flow_f49a6c4ae7)

evidence:
- apps/web/src/components/ui/Card.tsx:5 (Card)
- apps/web/src/components/ui/Card.tsx:9-12 (Card)

CardProps declares variant as "default" | "compact" | "bordered" (line 5), but the implementation only branches on variant === "compact" (line 12). The "bordered" variant value produces identical output to "default" because border styling is controlled exclusively by the separate `bordered` boolean, which defaults to true (line 9). A consumer passing variant="bordered" gets exactly the same markup as the default variant, so the type system advertises an option that silently does nothing — a contract mismatch between the declared API and actual behavior. This also makes the variant prop and the boolean `bordered` prop redundant overlapping controls for the same visual state.

recommendation:
Remove "bordered" from the variant union and keep only the `bordered` boolean (or, if distinct variants are intended, wire "bordered" into the border class computation and drop the redundant boolean). At minimum, document that variant only controls compact vs. default so consumers don't rely on a non-existent behavior.

test analysis:
Feature metadata lists tests: [] and no test files were included; nothing exercises the variant prop, so the dead variant value is not detected.

suggested regression test:
A vitest + @testing-library/react test rendering <Card variant="bordered" /> and <Card variant="default" /> and asserting their rendered className strings are identical, plus a test asserting each declared variant maps to the intended classes — this forces the variant union and implementation to stay in sync.

minimum fix scope:
apps/web/src/components/ui/Card.tsx

## low: Deploy checks out mutable `main` and verifies it against a CI-run SHA, creating a TOCTOU race that aborts deploys when main advances

id: fnd_sig-feat-config-991500c02e-f6b44_847944ac78
category: concurrency
confidence: high
triage: confirmed-bug
status: open
feature: Shell/workflow config staging-deploy.yml (feat_config_991500c02e)

evidence:
- .github/workflows/staging-deploy.yml:41-50

The workflow triggers on CI completion for main (lines 3-7) but then checks out the live `ref: main` branch (line 44) and only afterwards asserts `git rev-parse HEAD` equals `TESTED_SHA` (line 50). If any commit lands on main between the CI run completing (which fires `workflow_run`) and this job's checkout, HEAD differs from `head_sha` and the step fails, aborting the deploy for a fully tested commit. The check is fail-closed and self-healing (the next CI run triggers a fresh deploy), so impact is limited to skipped deploys under concurrent pushes, but the moving-target checkout is unnecessary: the tested commit is already known via `github.event.workflow_run.head_sha`.

recommendation:
Check out the tested commit directly: set `ref: ${{ github.event.workflow_run.head_sha }}` on actions/checkout (keeping the Verify tested commit step as a guard, or replacing it since checkout is then exact). This removes the race window entirely while preserving the 'deploy exactly what CI tested' guarantee.

test analysis:
The feature has no tests (tests: []), and GitHub workflow_run timing races cannot be exercised by the repo's existing unit/integration suites; the behavior is only observable in production scheduling.

suggested regression test:
A workflow-level test (e.g., actionlint plus a small script) that parses the YAML and asserts the checkout `ref` is the pinned `head_sha` expression rather than a branch name, so a future change cannot silently reintroduce the moving-target checkout.

minimum fix scope:
.github/workflows/staging-deploy.yml — change the checkout step's `ref` to `${{ github.event.workflow_run.head_sha }}`.

repro:
Push commit A (CI completes, deploy job starts); push commit B before the deploy job's checkout step runs; `git rev-parse HEAD` returns B's SHA while TESTED_SHA is A's, so the Verify tested commit step exits non-zero and the deploy is skipped.

## low: DexScreenerChart has no unit tests despite testing-library and vitest being configured

id: fnd_sig-feat-ui-flow-5e1863c145-66fc_ce1552e897
category: test-gap
confidence: high
triage: test-gap
status: open
feature: React component DexScreenerChart (feat_ui-flow_5e1863c145)

evidence:
- apps/web/src/components/DexScreenerChart.tsx:13-42 (DexScreenerChart)
- apps/web/package.json:49-51

The component's src URL construction, chain mapping, theme handling, and iframe attribute passthrough are all behavior that can silently regress, yet the feature's tests array is empty and no test file is linked. The workspace already has vitest, @testing-library/react, @testing-library/jest-dom, and happy-dom configured (package.json devDependencies and test scripts), so the test infrastructure exists but the component is uncovered.

recommendation:
Add a unit test (e.g., apps/web/src/components/DexScreenerChart.test.tsx) covering default chainId/theme, each supported chain slug, className merging onto the wrapper, rest prop passthrough to the iframe, and the title attribute.

test analysis:
The feature declares no tests and none are included in the review scope.

suggested regression test:
Render the component and assert the iframe src equals the expected dexscreener.com URL for a known chainId/theme pair, and that the wrapper div receives the className while the iframe receives passthrough props.

minimum fix scope:
apps/web/src/components/DexScreenerChart.tsx (add test file)

## low: fetch not aborted via react-query's signal; in-flight requests continue after unmount

id: fnd_sig-feat-ui-flow-96f77c54e9-b72c_3fad29106f
category: performance
confidence: high
triage: risk
status: open
feature: React component PoolStats (feat_ui-flow_96f77c54e9)

evidence:
- apps/web/src/components/PoolStats.tsx:41-42 (PoolStats)

React Query passes an AbortSignal as the second argument of the queryFn context, and the recommended pattern is to forward it to fetch so requests are cancelled on unmount, query key change, or garbage collection. Here the queryFn ignores the signal, so every navigation away from a token or rapid prop change (tokenAddress/chainId are part of the query key) leaves the previous fetch running to completion; against a rate-limited public API (DexScreener) each wasted request competes for the rate budget. This is a minor resource concern for a single GET, but the fix is a one-line change and the pattern is the documented react-query contract.

recommendation:
Accept the queryFn context and pass it through: `queryFn: async ({ signal }) => { ... fetch(url, { signal }) ... }`.

test analysis:
No tests cover the component's query lifecycle.

suggested regression test:
Test that fetch is called with an AbortSignal and that aborting the signal rejects the fetch (assert signal is passed in a stubbed fetch call).

minimum fix scope:
Single-line change in the queryFn signature and fetch options.

repro:
Mount PoolStats, unmount it immediately; the fetch still completes in the background instead of being aborted.

## low: formatPrice renders nonzero prices below 1e-8 as $0.00000000

id: fnd_sig-feat-ui-flow-48e197d8fd-8d18_d05dbb12b9
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component PriceTicker (feat_ui-flow_48e197d8fd)

evidence:
- apps/web/src/components/PriceTicker.tsx:28-33

The final branch applies toFixed(8) to any price < 0.01, so prices such as 0.000000001 or 1e-12 round to "0.00000000". In a DEX ticker, low-priced tokens are common, and displaying a live nonzero price as exactly zero is misleading.

recommendation:
Use significant-digit formatting (e.g., toPrecision with a sensible digit count, or adaptive decimals) so small nonzero values never display as zero.

test analysis:
formatPrice is module-private and untested (feature metadata tests: []).

suggested regression test:
Unit test: formatPrice(1e-9) must not return "$0.00000000" (assert it contains a nonzero digit).

minimum fix scope:
apps/web/src/components/PriceTicker.tsx

repro:
formatPrice(1e-9) returns "$0.00000000".

## low: Health endpoint body always reports status "ok" even when dependency probes fail (503)

id: fnd_sig-feat-library-e12da032c1-415e_3519ad0ace
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source apps/api/src (feat_library_e12da032c1)

evidence:
- apps/api/src/index.ts:128-143 (/health handler)

The /health handler builds the response with `status: "ok" as const` unconditionally (line 130) and only computes `allHealthy` afterwards to pick the HTTP status code (lines 141-142). When D1/KV/R2 probes fail the endpoint correctly returns HTTP 503, but the JSON body still says `"status":"ok"`. Any health monitor or aggregator that reads the JSON `status` field (a common pattern for JSON health endpoints) will report the service as healthy at the exact moment it is degraded, contradicting the HTTP status. The field is misleading precisely in the failure case it exists for.

recommendation:
Derive the body status from the probe results, e.g. `status: allHealthy ? "ok" : "degraded"` (compute allHealthy before building the payload, or set the field after), so the payload and the HTTP status code can never disagree.

test analysis:
The only linked test file (apps/api/test/index.test.ts) contains placeholder assertions for string concatenation and arithmetic; no test exercises the /health handler or its degraded path.

suggested regression test:
With stubbed bindings where checkD1/checkKV/checkR2 fail, call app.request('/health') and assert the HTTP status is 503 and the body's status field is not "ok".

minimum fix scope:
apps/api/src/index.ts lines 128-143

## low: Indexer fetches block timestamps with one sequential RPC call per unique block

id: fnd_sig-feat-library-ad98bca978-0fb8_8bb7bab187
category: performance
confidence: high
triage: risk
status: open
feature: Node source apps/api/src/services#2 (feat_library_ad98bca978)

evidence:
- apps/api/src/services/v3-liquidity-indexer.service.ts:99-111

For every unique block number among parsed events, client.getBlock is awaited sequentially inside the Effect generator loop (lines 100-111). Indexing a busy range with hundreds or thousands of distinct blocks issues that many serial RPC round-trips, making indexRange latency O(unique blocks) with zero concurrency and increasing the likelihood of RPC rate-limit errors that abort the whole range.

recommendation:
Fetch timestamps for all unique blocks concurrently (e.g., Promise.all over the unique block numbers) or batch the lookups, preserving a bounded concurrency limit.

test analysis:
The included tests cover only log parsing and the reducer; the indexer's RPC fetching path is not under test.

minimum fix scope:
apps/api/src/services/v3-liquidity-indexer.service.ts (timestamp loop)

## low: Input generates a new Math.random-based id on every render

id: fnd_sig-feat-library-da89b4a88e-cb04_3e0d0c43ad
category: maintainability
confidence: high
triage: risk
status: open
feature: Node package @aetherdex/web (feat_library_da89b4a88e)

evidence:
- apps/web/src/components/ui/Input.tsx:9

`id ?? \`input-${Math.random()...}\`` recomputes a fresh id on each render. Whenever a parent re-renders, the DOM id attribute changes, which breaks any code that references the id (getElementById, form autofill heuristics, undo behavior), produces non-deterministic DOM that destabilizes snapshot tests, and is a known a11y anti-pattern. The label htmlFor updates in lockstep so the visible association works, masking the issue.

recommendation:
Use React's useId() for a stable id.

test analysis:
Tests (ui.test.tsx omitted from included files) typically query by label/role text, which does not assert id stability across re-renders.

suggested regression test:
Render Input inside a stateful parent, re-render the parent, and assert the input id is unchanged.

minimum fix scope:
apps/web/src/components/ui/Input.tsx

repro:
Render Input, force a parent re-render, and observe the input's id attribute change.

## low: Input generates a new random id via Math.random() on every render when no id prop is provided

id: fnd_sig-feat-ui-flow-8f3d4647c6-3bb6_c61f4132f1
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component Input (feat_ui-flow_8f3d4647c6)

evidence:
- apps/web/src/components/ui/Input.tsx:9 (Input)
- apps/web/src/components/ui/Input.tsx:19 (Input)

When the caller omits `id`, `inputId` is recomputed with Math.random() on every render. A controlled input re-renders on each keystroke (parent state change), so the id attribute churns on every render even though the DOM node identity is preserved. The internal label/error `htmlFor` references stay in sync within a render, so basic behavior works, but the unstable id breaks anything that references the id across renders (browser autofill heuristics, CSS selectors, test selectors, external labels), and two instances rendered without ids have a nonzero (if small) collision chance that would associate one input's label/error with the wrong input. React's useId() exists specifically to provide stable, collision-free ids; Math.random() is also impure in render. This is not an SSR hydration issue here since this is a client-only Vite SPA, and Math.random is not used for anything security-sensitive.

recommendation:
Use useId() from react (const generatedId = useId(); const inputId = id ?? generatedId) so ids are stable across renders and unique within the tree, and keep the explicit id prop override.

test analysis:
The feature declares tests: [] and no test files were included; there is no coverage of id generation behavior.

suggested regression test:
Render Input without an id, re-render via a state update, and assert the input's id attribute is unchanged; render two id-less Inputs and assert their ids differ.

minimum fix scope:
Replace the Math.random() fallback in apps/web/src/components/ui/Input.tsx with useId().

repro:
Render <Input label="A" /> and <Input label="B" /> without ids, then re-render the parent (e.g., update controlled state); both inputs' id attributes change on each render.

## low: Internal error details exposed to clients via String(err) in 500 responses

id: fnd_sig-feat-route-615aa60302-3a3a85_cd0b93512f
category: security
confidence: high
triage: confirmed-bug
status: open
feature: Hono route GET / (feat_route_615aa60302)

evidence:
- apps/api/src/routes/pools.ts:55-57 (pools.get("/"))
- apps/api/src/routes/pools.ts:83-85 (pools.get("/:poolId"))

Both handlers serialize the caught error with String(err) directly into the JSON body. For a D1-backed Effect program, the error can include SQL text, binding values, internal Effect Cause/fiber details, or environment-specific information, which is then disclosed to any caller. This is an information-disclosure hazard and also bad error handling: the client receives no actionable or stable error shape, and any downstream validation failure is indistinguishable from a real outage.

recommendation:
Log the full error server-side (e.g., c.env.ENVIRONMENT-gated console/logger) and return a generic message such as { error: "Internal server error" } with 500; keep structured error codes for expected failures.

test analysis:
No tests are included for this route, and the coverage configuration does not include src/routes/pools.ts, so the error-response shape is unverified.

suggested regression test:
Test that a forced service failure (mocked listPools rejection) returns a body that does not contain the underlying error message/stack.

minimum fix scope:
apps/api/src/routes/pools.ts (catch blocks at lines 55-57 and 83-85).

## low: Internal error details leaked to clients via String(err) in 500 responses

id: fnd_sig-feat-route-98dcbb586b-1574df_9abaf2c2a5
category: security
confidence: high
triage: confirmed-bug
status: open
feature: Hono route GET / (feat_route_98dcbb586b)

evidence:
- apps/api/src/routes/tokens.ts:67-68
- apps/api/src/routes/tokens.ts:93-94

Both handlers serialize the raw caught error with `String(err)` into the response body. Effect errors and underlying fetch/D1/KV exceptions routinely embed internal information (upstream URLs, file paths, binding names, stack frames). On a public endpoint this is unnecessary information disclosure and also couples the API's error surface to internal exception wording, making responses unstable across dependency upgrades. This is distinct from the contract mismatch finding: it concerns the 500 error path, not the success path.

recommendation:
Return a stable generic body such as `{ "error": "Internal server error" }` with 500, and log the real error server-side (e.g., `console.error`/Observability) where it cannot reach clients.

test analysis:
No tests exist for this route (feature `tests: []`; the route file is absent from the coverage include list in apps/api/vitest.config.ts lines 67-83), so the error-path response shape is unverified.

suggested regression test:
A test that forces the service to fail (e.g., unbound KV/D1 or stubbed service throwing) and asserts the response body does not contain the thrown message or stack content, only the generic error shape.

minimum fix scope:
apps/api/src/routes/tokens.ts — replace `String(err)` in both catch blocks with a generic message and server-side logging.

## low: KVCacheService reads parse JSON outside Effect.tryPromise: a single corrupt KV entry becomes an unhandled defect

id: fnd_sig-feat-library-8f5d5fd534-6b46_f1bcb81992
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source apps/api/src/services#1 (feat_library_8f5d5fd534)

evidence:
- apps/api/src/services/kv.ts:63-64
- apps/api/src/services/kv.ts:144-145

In getPrice, getPrices, getSiweNonce and getSession, the Effect.tryPromise wraps only kv.get; the subsequent JSON.parse(raw) (lines 64, 79, 109, 145) executes inside Effect.gen without a try. A synchronous throw from JSON.parse on a corrupt/partial KV value is converted by the Effect runtime into a defect (die), not a typed failure and not Option.none. One truncated or hand-edited cache entry — or a value written by an older schema — turns a cache read that should degrade gracefully into an unhandled error that can fail the whole request. Notably price.service's own KV helpers wrap the parse in tryPromise (price.service.ts lines 176-187), showing the intended pattern; kv.ts does not follow it.

recommendation:
Wrap each JSON.parse in Effect.tryPromise (or Effect.try) alongside the kv.get and return Option.none on parse failure, matching the pattern in price.service.ts.

test analysis:
No kv.ts tests are included; the included tests never feed corrupt KV payloads to the service.

suggested regression test:
Test getPrice/getSession with a KV mock returning 'not-json{' and assert the Effect succeeds with Option.none rather than dying.

minimum fix scope:
apps/api/src/services/kv.ts (four read helpers)

## low: listPools and fetchTokens ignore HTTP error status (res.ok never checked)

id: fnd_sig-feat-library-9f563d7b60-7d0f_85ac38d943
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source apps/web/src/lib (feat_library_9f563d7b60)

evidence:
- apps/web/src/lib/api.ts:35-43 (listPools)
- apps/web/src/lib/api.ts:65-73 (fetchTokens)
- apps/web/src/lib/api.ts:83-88 (fetchTokenByAddress)

Both listPools and fetchTokens call res.json() and schema-decode without ever checking res.ok. A 4xx/5xx response (frequently an HTML or non-JSON body from a proxy/load balancer) therefore surfaces as a misleading 'Pools parse failed: SyntaxError...' or a schema ParseError, and the HTTP status (500, 429, 503) is lost entirely. The sibling function fetchTokenByAddress implements the intended contract: 404 -> null, other non-ok -> explicit error including the HTTP status. Concrete impact: the pools/tokens UI cannot distinguish a server outage or rate limit from a malformed payload, and the reported error text points at the client (parse failure) rather than the server.

recommendation:
After fetch, check res.ok in listPools and fetchTokens and fail with an error that includes the HTTP status (mirroring fetchTokenByAddress), before calling res.json(). Optionally read the error body to surface the server message.

test analysis:
The suite contains no test/lib/api.test.ts at all; the only API-adjacent tests are protocol-fee tests for fetchDepositEstimate, which does check res.ok, so the inconsistent behavior in api.ts is never exercised.

suggested regression test:
Mock fetch to return a 500 with a non-JSON body; assert Effect.runPromise(listPools(...)) rejects with an error matching /HTTP 500/ (repeat for fetchTokens).

minimum fix scope:
apps/web/src/lib/api.ts only.

repro:
Stub global fetch to resolve with new Response('<html>upstream error</html>', { status: 500 }) and run Effect.runPromise(listPools()): the rejection is a JSON parse error with no HTTP status anywhere in the message.

## low: listPools/fetchTokens parse error responses as JSON and hide the HTTP status

id: fnd_sig-feat-library-da89b4a88e-74f0_50e288d7f2
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node package @aetherdex/web (feat_library_da89b4a88e)

evidence:
- apps/web/src/lib/api.ts:35-43
- apps/web/src/lib/api.ts:65-73

Neither listPools nor fetchTokens checks res.ok before res.json(); a 500 with an HTML or empty body surfaces as a misleading "Pools/Tokens parse failed" error, and a 4xx with a JSON error body is fed to Schema.decodeUnknownEffect producing a confusing schema error instead of the status. fetchTokenByAddress (lines 83-88) handles status correctly, so the two paths are inconsistent and callers cannot distinguish server failures from contract violations.

recommendation:
Mirror fetchTokenByAddress: check res.ok and Effect.fail with the HTTP status before parsing.

test analysis:
Tests among the included files are not visible (test/lib/* omitted); unit tests typically mock 2xx JSON responses only.

suggested regression test:
Mock a 500 response with an HTML body; assert the resulting error mentions the HTTP status.

minimum fix scope:
apps/web/src/lib/api.ts

repro:
Point the app at a backend returning 500 with a non-JSON body and call listPools; the error message says "Pools parse failed" rather than reporting HTTP 500.

## low: loadTimestamps issues one sequential getBlock RPC call per unique block, making batch latency scale with block count

id: fnd_sig-feat-library-e99f39f7ec-226d_b0753463af
category: performance
confidence: high
triage: risk
status: open
feature: Node source apps/api/src/services/:indexer (feat_library_e99f39f7ec)

evidence:
- apps/api/src/services/indexer.service.ts:164-176 (loadTimestamps)
- apps/api/src/services/indexer.service.ts:322-324

loadTimestamps awaits client.getBlock in a loop with no batching, once per unique block in the batch. With the default batchSize of 2000 blocks (line 377), a batch can require up to 2000 sequential RPC round-trips (each ~50-150ms) before a single row is persisted, and indexRange backfills over large ranges multiply this cost linearly. This delays cursor advancement and makes backfills of thousands of blocks extremely slow, though it is not a correctness issue.

recommendation:
Fetch timestamps in parallel or batched (viem batchRequests / multicall, or parallel Promise.all over getBlock calls with bounded concurrency), and/or persist block timestamps in a small cache table so repeated windows and backfills reuse previously fetched values instead of re-querying the RPC.

test analysis:
No service tests exist, and the decoder tests do not exercise RPC call patterns.

suggested regression test:
Service test with a counting fake client asserting the number of getBlock calls for a batch of N unique blocks is N (or fewer after a timestamp cache is added).

minimum fix scope:
apps/api/src/services/indexer.service.ts

## low: Logo image has no onError fallback, showing a broken-image icon when logoURI fails to load

id: fnd_sig-feat-ui-flow-902c997d16-749b_c323cded53
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component TokenChip (feat_ui-flow_902c997d16)

evidence:
- apps/web/src/components/TokenChip.tsx:20 (TokenChip)

The logo <img> has no onError handler and no loading/decoding hints. Token logo URIs (IPFS gateways, CDNs, token-list mirrors) routinely rot or become unreachable; when the fetch fails the component renders the browser's broken-image glyph inside the chip, which in a token-selection UI looks like a defect rather than an unavailable logo. The conditional rendering at line 20 also means an empty logoURI string renders nothing while a failing URL renders a broken icon, which is inconsistent.

recommendation:
Add an onError handler that hides the image or swaps to a text-based monogram fallback (e.g., first letter of symbol in a styled span), and add loading="lazy" decoding="async" when chips are rendered in lists.

test analysis:
No tests exist for this component, so the error path is not exercised.

suggested regression test:
Mock an img load failure (fire the onError event) and assert the broken image is removed/fallback rendered; also assert a valid logoURI renders an img.

minimum fix scope:
apps/web/src/components/TokenChip.tsx (add onError fallback state/handler)

## low: Malformed or missing JSON body on POST /api/v1/auth/verify returns 500 instead of 400

id: fnd_sig-feat-library-a50e9b911f-2fec_4b250dfdf8
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node package @aetherdex/api (feat_library_a50e9b911f)

evidence:
- apps/api/src/auth/routes.ts:29-33

c.req.json<{ message?: string; signature?: string }>() throws when the body is not valid JSON (or is empty), and the exception propagates to the app-level onError handler (index.ts lines 244-247), which returns a generic 500 'Internal server error'. A client-side contract violation (invalid body) therefore registers as a server failure: it pollutes the 5xx alerting (alerts.ts errorRate rule) and the structured error log, and hides the actual 400-class problem. The subsequent 400 for missing message/signature fields shows the intended contract; the parse failure should map to the same 400.

recommendation:
Wrap the body parse in try/catch (or use a Hono validation middleware) and return 400 for JSON parse failures; optionally use Hono's app.onError to distinguish HTTPException (client) from thrown errors.

test analysis:
auth tests in the excerpted set exercise valid messages/signatures; the malformed-body path falls through to the global error handler and is not asserted as a 400.

suggested regression test:
POST /api/v1/auth/verify with an invalid JSON body and assert status 400 (and no 5xx alert increment).

minimum fix scope:
apps/api/src/auth/routes.ts — catch the JSON parse error in the /verify handler and return 400.

repro:
POST /api/v1/auth/verify with body '{invalid' (or no body); the response is 500 Internal server error rather than a 400 validation error.

## low: Most owned components have no tests; formatting and range-clamping edge cases are uncovered

id: fnd_sig-feat-library-d9ae9adbfb-b790_49214070d0
category: test-gap
confidence: high
triage: test-gap
status: open
feature: Node source apps/web/src/components (feat_library_d9ae9adbfb)

evidence:
- apps/web/package.json:11-19
- apps/web/test/components/ThemeToggle.test.tsx:1-4
- apps/web/test/components/TokenSearch.test.tsx:1-4

Only ThemeToggle and TokenSearch have tests among the ten owned files; Address, DexScreenerChart, PoolStats, PriceTicker, RangeSelector, TokenChip, WalletConnect, and index.ts have none, and index.test.ts is only an environment smoke test. The untested code includes behavior with real edge cases: formatPrice for sub-cent and sub-0.01 prices (toFixed(8)) and negative values, formatUsd/formatChange sign handling, RangeSelector clamping/snapping including NaN inputs and lower/upper crossover constraints, Address truncation thresholds, and the DexScreener API response handling in PoolStats (missing/absent pairs array). These are exactly the pure functions where regressions are cheap to catch with unit tests.

recommendation:
Add unit tests for the pure formatting helpers (formatPrice, formatUsd, formatChange, formatVolume), Address truncation boundaries, and RangeSelector snap/clamp invariants (lower < upper, step alignment, NaN inputs); add a PoolStats test with a mocked fetch covering empty/malformed pairs responses and the chainId filter.

test analysis:
The existing test files only import ThemeToggle and TokenSearch; the other components are not referenced by any included test.

suggested regression test:
A new test file (e.g., apps/web/test/components/format.test.tsx) covering formatPrice(0), formatPrice(0.001), formatPrice(-5), formatUsd(2_000_000), and a RangeSelector render asserting the two range inputs never cross (lower <= upper).

minimum fix scope:
Add tests only; no production code changes required.

## low: No test coverage for the deploy script pipelines

id: fnd_sig-feat-library-e6a0e61d33-5c0d_706020c622
category: test-gap
confidence: high
triage: test-gap
status: open
feature: Node package @aetherdex/alchemy-infra (feat_library_e6a0e61d33)

evidence:
- infra/alchemy/package.json:6-17

All executable logic in this package lives in the npm scripts (environment guards, stage-name sanitization, wrangler upload), yet the scripts block contains no `test` entry and the feature's tests list is empty. The `web:deploy:*` pipelines contain the highest-risk logic (shell quoting, character sanitization, truncation) with zero automated verification, so regressions such as the dev-stage divergence go unnoticed until a deploy fails or a smoke check breaks.

recommendation:
Add a `test` script (e.g., a small Bun/shell test that executes the script pipelines with sample environment values and asserts expected stage/project names and failure modes).

test analysis:
No test script or test files exist in the package.

suggested regression test:
A test that runs `web:deploy:dev`'s STAGE_SUFFIX derivation with representative usernames and asserts the output equals the stage name used by `deploy:dev` (same as the regression test for the stage-derivation finding).

minimum fix scope:
infra/alchemy/package.json (add test script and tests)

## low: No tests cover fetch failure paths (search errors, default-list errors, address 404)

id: fnd_sig-feat-ui-flow-cfc2470a11-9a5e_50921910c7
category: test-gap
confidence: high
triage: test-gap
status: open
feature: React component TokenSearch (feat_ui-flow_cfc2470a11)

evidence:
- apps/web/test/components/TokenSearch.test.tsx:43-60 (mockTokensApi)
- apps/web/src/components/TokenSearch.tsx:114-116
- apps/web/src/components/TokenSearch.tsx:138-140

The test mock always returns ok:true/200 (or 404 only for unknown addresses with a well-formed token body), so the catch branches in the defaults loader (lines 114-116) and searchTokens (lines 138-140), the spinner reset in finally, the 'No tokens found' state for a pasted-but-unknown valid address, and the deliberate retry-on-reopen behavior after a default-list failure are all untested. A regression that, e.g., left isSearching stuck true on error or stopped retrying the default list would pass CI.

recommendation:
Add tests: fetch rejecting for /tokens; non-ok statuses; a 404 for a valid pasted address asserting 'No tokens found' and spinner cleared; and a default-list failure followed by reopen asserting the list is fetched again (retry) and eventually rendered.

test analysis:
This is the gap itself: mockTokensApi never rejects or returns error statuses, and none of the existing cases exercise the catch/finally branches.

suggested regression test:
Stub fetch to reject for the first /tokens?limit=100 call, open the dropdown (assert no crash, empty default list), close, restore fetch to success, reopen, and assert default tokens appear; plus a test where fetch rejects for a search query and asserts results are cleared and the spinner disappears.

minimum fix scope:
apps/web/test/components/TokenSearch.test.tsx

## low: No tests exist for either token service

id: fnd_sig-feat-library-4a1871bbb1-6aa5_0adf0b70ae
category: test-gap
confidence: high
triage: test-gap
status: open
feature: Node source apps/api/src/services/:token (feat_library_4a1871bbb1)

evidence:
- apps/api/src/services/token.service.ts:71-176 (makeTokenService)
- apps/api/src/services/token-list.service.ts:116-240 (makeTokenListService)

The feature metadata lists tests: [] and no test files were included. Both services contain substantial branch logic — limit clamping, verified/query branch selection, the KV → fetch → D1 fallback chain, best-effort error swallowing, and chain scoping — with zero regression coverage. The concrete defects above (negative/NaN limit, silent upsert failure, case-sensitive address lookup, unbounded D1 fallback content) are all direct consequences of untested branches, and both services are already dependency-injected (SqlClient, TokenListFetcher, KV) precisely so they can be unit-tested.

recommendation:
Add unit tests with injected SqlClient/fetcher mocks covering: limit edge cases (-1, NaN, 0, >500), upsert failure propagation, case-insensitive address lookup, chain scoping, and the full cache-fallback chain (KV hit, KV miss + fetch success, fetch failure + D1 fallback, all-miss).

test analysis:
No tests exist in this feature (tests: []), so there is nothing to contradict or cover the behaviors described.

suggested regression test:
A vitest suite using @effect/vitest with mocked SqlClient and TokenListFetcher exercising each resolveTokens branch and the listTokens/getToken edge cases above.

minimum fix scope:
New test files under apps/api/test/ for both services

## low: No tests for invalid stored theme value or storage failure branches

id: fnd_sig-feat-ui-flow-62776b9e70-8d3e_91fb7cf9ec
category: test-gap
confidence: high
triage: test-gap
status: open
feature: React component ThemeToggle (feat_ui-flow_62776b9e70)

evidence:
- apps/web/test/components/ThemeToggle.test.tsx:42-68
- apps/web/src/components/ThemeToggle.tsx:12-17 (ThemeToggle)

The else branch (lines 15-17) that handles an absent or invalid stored value — the fallback to 'aetherdex' — is never tested: existing tests only cover valid stored values ('aetherdex' default at line 29, 'light' at lines 51 and 65) and toggling. The value-validation guard at line 12 is behavior worth pinning: e.g., a stored 'dark' (a plausible future theme) silently falls back, and a regression that removes the guard would crash the app on arbitrary stored strings. Tests also never exercise throwing storage (see the storage-exception finding), leaving the component's failure mode unspecified.

recommendation:
Add tests: (1) seed 'aetherdex-theme' with an invalid value like 'dark' and assert data-theme becomes 'aetherdex' without error; (2) seed with a JSON string or empty value and assert fallback; (3) a throwing-storage test as described in the storage-exception finding.

test analysis:
All existing tests seed either no value or the valid 'light' value, so the else branch and the validation guard are unreached.

suggested regression test:
mockStorage.setItem('aetherdex-theme', 'dark'); render(<ThemeToggle />); expect(document.documentElement.getAttribute('data-theme')).toBe('aetherdex').

minimum fix scope:
apps/web/test/components/ThemeToggle.test.tsx only.

repro:
None needed; this is a coverage observation.

## low: No unit tests cover the Input component

id: fnd_sig-feat-ui-flow-8f3d4647c6-f5bf_9be33d9fb0
category: test-gap
confidence: high
triage: test-gap
status: open
feature: React component Input (feat_ui-flow_8f3d4647c6)

evidence:
- apps/web/src/components/ui/Input.tsx:8-29 (Input)
- apps/web/package.json:11-13
- apps/web/package.json:49-51

The feature declares tests: [] for this component, yet the project has the full test stack configured (vitest, @testing-library/react, @testing-library/user-event, happy-dom) and a `test` script. The component contains non-trivial behavior worth locking down: conditional label/error rendering, error-driven class application, id fallback, and className merging with rest-prop forwarding. Untested UI primitives like this one tend to regress silently when shared by many forms (this app uses @tanstack/react-form).

recommendation:
Add apps/web/src/components/ui/Input.test.tsx covering: label rendering and htmlFor, error rendering and input-error class, className merge, id prop passthrough vs. generated fallback, and spread of native input props (type, value, onChange).

test analysis:
No test files exist for this component; the feature metadata lists an empty tests array.

suggested regression test:
A vitest + @testing-library/react suite rendering Input with label/error/className/id combinations and asserting the resulting DOM (label text, error text, classes, id attributes, forwarded props).

minimum fix scope:
Add a test file under apps/web/src/components/ui/.

## low: Package entrypoint is a Hello World stub and package metadata lacks main/exports

id: fnd_sig-feat-library-e6a0e61d33-daaa_ece30259eb
category: maintainability
confidence: high
triage: risk
status: open
feature: Node package @aetherdex/alchemy-infra (feat_library_e6a0e61d33)

evidence:
- infra/alchemy/package.json:3-5
- infra/alchemy/index.ts:1

The manifest declares `@aetherdex/alchemy-infra` with `"module": "index.ts"`, but index.ts is an untouched Bun scaffold that only calls `console.log("Hello via Bun!")` and exports nothing. Any consumer importing the package gets a console-log side effect and no API, while the real Alchemy stack the README describes is not reachable through package metadata. The package also has no `main` or `exports` fields, and Node ignores the non-standard `module` field, so the package is not importable by standard Node tooling (only Bun/bundlers that honor `module`). The stub entrypoint is leftover scaffold that misleads maintainers about where stack code lives.

recommendation:
Point `module`/`exports` at the real stack entrypoint, or drop the entrypoint fields entirely if this is purely a scripts package, and remove the scaffold `console.log` side effect.

test analysis:
No tests exist in the package, and nothing imports the package to trigger the side effect.

minimum fix scope:
infra/alchemy/package.json and infra/alchemy/index.ts

## low: Phase-2 keeper/auto-recenter paths are stubs that emit plausible-but-wrong results: constant-zero counters, unreachable failure branches, and current-range values labeled as rebalance targets

id: fnd_sig-feat-library-8f5d5fd534-48c4_5e92def3a4
category: maintainability
confidence: high
triage: risk
status: open
feature: Node source apps/api/src/services#1 (feat_library_8f5d5fd534)

evidence:
- apps/api/src/services/keeper.service.ts:243-304
- apps/api/src/services/auto-recenter.service.ts:135-162

KeeperService.tick returns KeeperTickResult where ordersTriggered and rebalancesQueued are const-0 (lines 246, 249) and can never change: the pending-order loop body is only a console.log inside a try whose catch increments ordersFailed — unreachable in practice — and the policy loop only runs evaluateAntiWhipsaw and logs, never queuing a rebalance. An operator monitoring ordersTriggered/rebalancesQueued/ordersFailed gets guaranteed-zero metrics that look like 'nothing happened' rather than 'not implemented'. Similarly, AutoRecenterService.getPendingRebalances returns rows whose targetTickLower/targetTickUpper are copied verbatim from the position's current tick_lower/tick_upper (lines 158-159), so any consumer treating the result as a queue of intended rebalances would emit no-op rebalances to the current range; computeOptimalRange/detectOutOfRangePositions are never wired into this path. Both services advertise Phase-2 behavior that is scaffolding.

recommendation:
Either implement the stubbed paths (evaluate TP/SL with real price reads, compute and persist optimal target ranges before queueing) or explicitly mark the methods/metrics as not-implemented: return distinct 'stub' markers, throw a typed not-implemented error, or omit the counters from KeeperTickResult so consumers cannot mistake them for real zeros.

test analysis:
No keeper.service or auto-recenter.service tests are included, and the stub behavior is only visible by executing the full D1-backed tick path.

suggested regression test:
Test that tick() on a policy that passes the anti-whipsaw check reports rebalancesQueued/ordersTriggered consistent with what was actually queued (0 until implementation), or fails explicitly instead of returning zeros.

minimum fix scope:
apps/api/src/services/keeper.service.ts and apps/api/src/services/auto-recenter.service.ts (implement or mark-stub)

## low: Pool detail page masks network/server failures as 'Pool not found' with no retry

id: fnd_sig-feat-library-410ea57829-e686_9ae3021537
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source apps/web/src/routes (feat_library_410ea57829)

evidence:
- apps/web/src/routes/pools.$poolId.tsx:88-119
- apps/web/src/routes/pools.$poolId.tsx:129-144

The pool fetch never checks response.ok and swallows all errors with an empty .catch(() => {}). A 500/502 response, an HTML error page (r.json() throws), or a network outage all end with pool === null, so the UI renders 'Pool not found.' — a factually wrong message that sends users away from a temporary outage, with no retry affordance (unlike the pools list page which has an explicit error state and Retry button).

recommendation:
Check response.ok, distinguish HTTP/network errors from a 404 (missing pool), surface an error state with a retry button, and only render 'Pool not found.' for genuine 404s.

test analysis:
No tests exist for PoolDetailPage or its data fetching; pools.test.tsx only covers the PoolsResults list component.

suggested regression test:
Render test that stubs a failed/500 fetch and asserts an error state with retry is shown rather than 'Pool not found.'

minimum fix scope:
apps/web/src/routes/pools.$poolId.tsx

repro:
Stop the API server and open /pools/<valid-pool-id>; the page shows 'Pool not found.' instead of an availability error.

## low: PoolStats assumes pairs is always an array; DexScreener returns pairs:null for unknown tokens

id: fnd_sig-feat-library-da89b4a88e-93f6_750e34a6a8
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node package @aetherdex/web (feat_library_da89b4a88e)

evidence:
- apps/web/src/components/PoolStats.tsx:42-59

For tokens with no pairs, api.dexscreener.com returns {"pairs":null}. The code types json.pairs as DexScreenerPair[] but at runtime it is null, so pairs.filter (when chainId is set) or pairs.sort throws a TypeError inside the queryFn. React Query converts this to an error state and by default retries the query, burning DexScreener rate-limit budget on permanently-unknown tokens. The UI message happens to be the same as the null-data branch, so the failure is masked as a generic error instead of the intended clean null result.

recommendation:
Normalize with `const pairs = json.pairs ?? []` before filtering/sorting, and consider retry:false for this third-party, rate-limited query.

test analysis:
No PoolStats test is among the included files; typical mocks return a pairs array, and the null-pairs shape of the real API is easy to miss.

suggested regression test:
Mock fetch returning {pairs:null}; assert the query resolves to null without error state and without retries.

minimum fix scope:
apps/web/src/components/PoolStats.tsx

repro:
Open PoolStats with any address that has no pairs on DexScreener; the queryFn throws and the query enters error state with retries.

## low: RangeSelector has no automated tests despite non-trivial tick clamping/snapping invariants

id: fnd_sig-feat-ui-flow-e6ed457e9a-eae3_e575d8bbbd
category: test-gap
confidence: high
triage: test-gap
status: open
feature: React component RangeSelector (feat_ui-flow_e6ed457e9a)

evidence:
- apps/web/src/components/RangeSelector.tsx:18-22 (RangeSelector)
- apps/web/src/components/RangeSelector.tsx:66-80 (RangeSelector)
- apps/web/src/components/RangeSelector.tsx:92-102 (snap)
- apps/web/package.json:11-13

The feature metadata lists zero tests and no test file was included. The component enforces several easy-to-break invariants: tick snapping to the spacing grid (snap), window derivation from currentTick (minimum/maximum), clamping lower into [minimum, maximum - spacing] and upper into [lower + spacing, maximum], and re-clamping in both onChange handlers with Math.min/Math.max. These invariants are duplicated in two places (derivation and handlers), so a regression in one path (e.g., inverted props lowerTick > upperTick, negative currentTick, or values far outside the window) would silently emit an invalid range. The repo has vitest, @testing-library/react, @testing-library/user-event, and happy-dom configured, so tests are feasible and cheap.

recommendation:
Add apps/web/src/components/RangeSelector.test.tsx covering: window centering for negative currentTick, snapping of off-grid props, inverted props (lowerTick > upperTick) being re-ordered via clamps, lower handle capped at upper - spacing, upper handle floored at lower + spacing, and onChange payloads always on the tick grid with lower < upper.

test analysis:
No test files exist for this component or its helpers; the feature's tests list is empty.

suggested regression test:
Render with currentTick=0, tickSpacing=60, lowerTick=upperTick=0; assert both handles render and onChange never produces lowerTick >= upperTick; repeat with lowerTick=100000, upperTick=-100000 and assert the emitted range is ordered and inside [minimum, maximum].

minimum fix scope:
Add a component test file exercising the derivation and onChange invariants.

## low: README documents outdated Vite version and wrong typecheck tool

id: fnd_sig-feat-library-da89b4a88e-f755_bb52004152
category: docs-gap
confidence: high
triage: docs-gap
status: open
feature: Node package @aetherdex/web (feat_library_da89b4a88e)

evidence:
- apps/web/README.md:7
- apps/web/README.md:24
- apps/web/package.json:16
- apps/web/package.json:64

README line 7 claims "Vite 7" while package.json declares vite ^8.1.5, and README line 24 annotates `bun run typecheck` as "tsgo --noEmit" while the script is `tsc --noEmit`. Anyone following the README gets incorrect expectations about the toolchain; the typecheck annotation could also mislead about which diagnostics the script produces.

recommendation:
Update README to Vite 8 and correct the typecheck annotation to tsc.

test analysis:
Not applicable; documentation accuracy is not covered by tests.

minimum fix scope:
apps/web/README.md

repro:
Read README.md, then compare with package.json scripts/dependencies.

## low: README/AGENTS.md toolchain claims contradict package.json (TypeScript, Biome, Vitest versions)

id: fnd_sig-feat-library-b4cb74367c-4613_1f1be198a0
category: docs-gap
confidence: high
triage: docs-gap
status: open
feature: Node package aetherdex (feat_library_b4cb74367c)

evidence:
- README.md:13
- AGENTS.md:59
- AGENTS.md:267
- package.json:31-35

README.md line 13 and AGENTS.md lines 59/267 state this branch pins typescript@7.0.1-rc + @typescript/native-preview (tsgo), Biome 1.9.4, and Vitest 4.1.9, while package.json declares typescript ^7.0.2, @biomejs/biome ^2.5.5, and vitest ^4.1.10 with no @typescript/native-preview dependency. This is precisely the "documentation that doesn't match code" anti-pattern AGENTS.md line 329 warns agents against; it misleads agents and reviewers about the actual toolchain state and makes the pre-/post-migration status (Workstream P) ambiguous.

recommendation:
Update README.md and AGENTS.md version inventories to match package.json (or pin the rc/native-preview toolchain if that is the intended state), and keep a single source of truth for toolchain versions.

test analysis:
Documentation drift is not exercised by tests.

minimum fix scope:
README.md, AGENTS.md

## low: Route handlers have no test coverage — only the price-guard pure helper is tested

id: fnd_sig-feat-library-09141f3ef9-4d41_c3752b8a5c
category: test-gap
confidence: high
triage: test-gap
status: open
feature: Node source apps/api/src/routes (feat_library_09141f3ef9)

evidence:
- apps/api/test/price-guard.test.ts:1-20
- apps/api/package.json:15

The single included test exercises only the pure evaluatePriceGuard helper (deviation math). None of the 8 route handlers are covered: auth gating (positions, swap/record, tp-sl), TP/SL on-chain receipt verification and event matching, V3/V4 reconcile ownership checks, quote parameter validation, and error mapping (422/503/502/403) are all untested. These are the highest-risk paths in the feature — ownership checks and on-chain verification gate real user data — and the review surfaced several concrete defects in exactly those paths (unvalidated slippage, ownership-mismatch 502, unverified swap records), consistent with the absence of route-level tests.

recommendation:
Add route-level tests with mocked D1/RPC (the repo already depends on @cloudflare/vitest-pool-workers and @effect/vitest) covering auth failures, TP/SL creation verification, reconcile ownership checks, and param validation for each route.

test analysis:
The existing test deliberately targets only the exported pure function and cannot exercise handlers, middleware, or on-chain verification.

suggested regression test:
A route-level suite parameterizing each endpoint with valid/invalid inputs, asserting status codes and that services are never called on validation failures.

minimum fix scope:
apps/api/test/ — new route test files.

## low: Short addresses render without mono font or full-address tooltip (inconsistent fallback branch)

id: fnd_sig-feat-ui-flow-458f3992b6-3ec9_3b298645a8
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component Address (feat_ui-flow_458f3992b6)

evidence:
- apps/web/src/components/Address.tsx:7-16 (Address)

The component has two rendering branches with different attributes. The truncated branch (lines 11-15) applies `font-mono text-sm` and a `title` tooltip with the full address, while the fallback branch (line 9) renders a plain span with only the caller's className and no title. Any address shorter than the threshold (including empty strings, which the code explicitly handles) renders in the default font and loses the hover tooltip, so the same component produces visually inconsistent output depending on input length. The `!address` guard shows the fallback path is expected to be exercised, making the attribute divergence a real (if minor) UI inconsistency rather than dead code.

recommendation:
Use a single span that always applies `font-mono text-sm` and `title={address}`, and only vary the child text between the truncated and full value, e.g. compute `display = address.length < length * 2 + 3 ? address : `${address.slice(0, 2 + length)}…${address.slice(-length)}`` and render one span with both branches' attributes.

test analysis:
No tests exist for this component (feature declares an empty tests array), so the attribute divergence between branches is unobserved.

suggested regression test:
Render with a short address (e.g. "0x1234") and assert the span has classes `font-mono text-sm` and a `title` attribute equal to the full address; render with a 42-char address and assert the text equals the truncated form while `title` still holds the full value.

minimum fix scope:
apps/web/src/components/Address.tsx

## low: Structured request log is skipped for requests whose handler throws (500s logged without request context)

id: fnd_sig-feat-library-e12da032c1-52e7_2916054bfd
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source apps/api/src (feat_library_e12da032c1)

evidence:
- apps/api/src/index.ts:104-125
- apps/api/src/index.ts:244-247 (app.onError)

The logging middleware logs only after `await next()` resolves. When any downstream handler throws, next() rejects, the lines after it (111-124) never execute, and the error propagates to app.onError, which only does `console.error("API error:", err)` — no method, path, status, duration, or env context. The result is that the requests this middleware was written to observe best (5xx failures) are exactly the ones missing from the structured JSON log, degrading the observability the handler is meant to provide.

recommendation:
Wrap the post-next logging in try/finally (or catch, log the 500 entry, and rethrow) so a structured log line with method, path, status 500, and duration is emitted for every request, including failures.

test analysis:
The linked tests do not exercise middleware behavior or logging at all.

suggested regression test:
Register a stub route that throws, spy on console.log/console.error, and assert a JSON log line containing method, path, and status 500 is emitted in addition to the onError output.

minimum fix scope:
apps/api/src/index.ts lines 104-125

## low: SwapService.buildCalldata converts every typed failure into an Effect defect via Effect.die

id: fnd_sig-feat-library-8f5d5fd534-7ba6_60365cfc8a
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: Node source apps/api/src/services#1 (feat_library_8f5d5fd534)

evidence:
- apps/api/src/services/swap.service.ts:319-365

buildCalldata internally fails with typed SwapQuoteError for ordinary request conditions — invalid poolId, invalid recipient, pool not found — but the final .pipe(Effect.catch((err) => Effect.die(err))) (line 365) erases the error channel, turning every one of those expected failures into a defect. Callers of the Effect (HTTP routes) cannot distinguish 'pool not found' from a genuine crash; a defect typically surfaces as an unhandled 500 rather than a 404/400, and 'Invalid recipient address' / 'Pool not found' become unrecoverable failures. The typed error class and its reasons are constructed and then immediately discarded.

recommendation:
Remove the Effect.die catch and let buildCalldata's typed SwapQuoteError propagate (change the return type to Effect.Effect<{to,data,value}, SwapQuoteError>), or at minimum only die on unexpected (non-SwapQuoteError) errors.

test analysis:
No swap.service tests are included; the included tests only cover quote-engine, chain-state-reader, and position.service.

suggested regression test:
Test buildCalldata with an unknown poolId resolves the failure as a typed SwapQuoteError with reason 'no_pool' (not a defect) when run via Effect.runPromise.

minimum fix scope:
apps/api/src/services/swap.service.ts (buildCalldata error handling)

## low: switchChain/disconnect failures are silently swallowed with no user feedback

id: fnd_sig-feat-ui-flow-ffdbfd5b3b-eb5c_fa37ceee12
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component WalletConnect (feat_ui-flow_ffdbfd5b3b)

evidence:
- apps/web/src/components/WalletConnect.tsx:30-46 (WalletConnect)

The dropdown's Switch Network and Disconnect buttons call switchChain({ chainId }) and disconnect() directly from the wagmi mutate functions, discarding the returned status/error. A rejected wallet request (user denies the switch, the connector does not support the target chain, or the RPC fails) produces no UI feedback — the dropdown shows nothing and the user cannot tell whether the action failed or is pending. This is a wallet-flow-critical interaction (a DEX's network selection), so silent failures can leave the user on an unintended chain. The active chain's button also remains clickable and issues a redundant wallet_switchEthereumChain call, which some wallets reject, compounding the silent failure. Evidence is the onClick handlers at lines 34 and 43 with no error state consumed from useSwitchChain/useDisconnect (line 12).

recommendation:
Consume the error/status returned by useSwitchChain and useDisconnect (e.g., via onError callbacks or the error state) and render an inline error message in the dropdown; also close the dropdown or show a pending state while switching. Disable or no-op the button for the currently active chain (chainId === chain.id).

test analysis:
No tests exist for this component (feature metadata lists tests: [] and no test file was included), so the absence of error handling has never been exercised.

suggested regression test:
Render WalletConnect with mocked wagmi hooks where switchChain rejects; assert an error message appears in the dropdown and that the active chain's button does not invoke switchChain.

minimum fix scope:
apps/web/src/components/WalletConnect.tsx

## low: Theme applied only after first paint, causing flash of default theme (FOUC) on reload

id: fnd_sig-feat-ui-flow-62776b9e70-d5e8_975936731a
category: bug
confidence: high
triage: confirmed-bug
status: open
feature: React component ThemeToggle (feat_ui-flow_62776b9e70)

evidence:
- apps/web/src/components/ThemeToggle.tsx:10-18 (ThemeToggle)

The data-theme attribute is only set inside a mount useEffect (lines 10-18), which runs after the browser paints the first frame. Since the initial state is hardcoded to 'aetherdex' (line 8) and no pre-paint script sets the attribute from localStorage, users who chose 'light' see the dark theme flash on every page load before the effect flips the attribute. In a Vite SPA this is a visible UX defect on every navigation/reload, and it also means the attribute briefly disagrees with the eventual theme.

recommendation:
Apply the stored theme before first paint: read localStorage in an inline module/script in the HTML entry (guarded by try/catch) that sets document.documentElement data-theme synchronously, and keep the component's effect as a fallback/initializer.

test analysis:
Testing-library render wraps effects in act() and flushes them synchronously, and tests assert the post-effect state (e.g., line 67), so the pre-paint gap is invisible to the current tests.

minimum fix scope:
Add a small inline script in the app's HTML entry (or an imported module executed before React mounts) that sets data-theme from localStorage; component logic itself can stay unchanged.

repro:
Set 'aetherdex-theme' to 'light' in localStorage, reload the app, and observe the dark theme applied for the first frame before switching to light.

## low: TP/SL order lifecycle service has no tests covering status transitions and error semantics

id: fnd_sig-feat-library-ad98bca978-f4df_8be9f18be7
category: test-gap
confidence: high
triage: test-gap
status: open
feature: Node source apps/api/src/services#2 (feat_library_ad98bca978)

evidence:
- apps/api/src/services/tp-sl.service.ts:164-391

The service implements the core order lifecycle (create/get/list/cancel/execute/expire) and keeper execution records against D1, and it gates fund-moving operations, yet the only tests included for this feature cover v3 log parsing and the position reducer. The issues identified above — not-pending vs not-found error conflation, non-atomic execute+record writes, and deadline-filtered pending queries — are all unguarded by tests.

recommendation:
Add a vitest suite for tp-sl.service.ts using @effect/sql-d1 against an in-memory/seeded D1 covering create/get/list, every status transition including double-transition errors, and keeper execution recording.

test analysis:
No test file for tp-sl.service.ts is included in the feature; existing tests cover only v3-liquidity-events and v3-position-reducer.

minimum fix scope:
Add apps/api/test/services/tp-sl.service.test.ts

## low: Unpinned/never-verified third-party tooling installs (slither-analyzer, solc-select, echidna binary)

id: fnd_sig-feat-config-902602e3e1-7c4a9_f88e6bba70
category: security
confidence: high
triage: confirmed-bug
status: open
feature: Shell/workflow config ci.yml (feat_config_902602e3e1)

evidence:
- .github/workflows/ci.yml:250-255
- .github/workflows/ci.yml:508-520

The contracts job installs slither-analyzer and solc-select with `pip3 install --no-cache-dir` and no version pins on every run, and the echidna job downloads the echidna release tarball over HTTPS with no checksum verification, extracts it, and installs it to /usr/local/bin via sudo, plus re-installs solc-select unpinned. Everything else in this workflow is deliberately pinned (Foundry v1.7.1 via env, all actions by commit SHA, forge-install revisions pinned by commit, ECHIDNA_VERSION v2.3.2), so these install steps are the verification gaps: unpinned PyPI packages can silently change behavior or break the Slither gate (which is a mandatory job gated by ci-status) at any time, making CI non-reproducible, and the echidna binary is trusted without integrity verification despite being executed with elevated privileges.

recommendation:
Pin exact versions for pip installs (e.g., `pip3 install slither-analyzer==0.10.4 solc-select==1.0.4` or a requirements file with hashes) and pin/verify a SHA-256 digest of the echidna tarball before extraction (download, `sha256sum`, compare against a committed digest, then extract). Consider caching the installed tools so they are not re-downloaded every run.

test analysis:
Workflow install steps execute directly on runners; the repository's test suites (vitest/forge/playwright) do not exercise CI provisioning, so nothing validates version reproducibility or integrity.

suggested regression test:
A small smoke step or script that asserts the resolved tool versions match the pins (e.g., `slither --version`, `solc-select versions`) and that the echidna tarball digest matches a committed value.

minimum fix scope:
Add version pins/hashes to the pip and curl install steps in .github/workflows/ci.yml.

## low: useWebSocket reconnect, message parsing, and url-change paths have no test coverage

id: fnd_sig-feat-library-67e36e39d1-23ce_6e6fe40925
category: test-gap
confidence: high
triage: test-gap
status: open
feature: Node source apps/web/src/hooks (feat_library_67e36e39d1)

evidence:
- apps/web/test/hooks/useWebSocket.test.ts:12-19
- apps/web/test/hooks/useWebSocket.test.ts:29-93

The suite covers initial state, open, onOpen, constructor error, unmount cleanup, and custom reconnect settings, but none of the core behaviors: onclose-triggered reconnection with exponential backoff, reconnect attempt exhaustion, onMessage JSON parsing and non-JSON message ignoring, onError, and remount/url-change behavior. Because MockWebSocket.close never fires onclose, the entire reconnect code path (lines 95-109) is dead code under test — which is exactly why the stale-close race goes undetected.

recommendation:
Add tests that fire onclose/onmessage/onerror events on MockWebSocket instances (e.g., a static helper to emit events), covering reconnect scheduling with fake timers, attempt cap, backoff values, JSON and non-JSON messages, and url-change remounts.

test analysis:
The existing tests assert only the happy-path open and cleanup behavior; the mock's close() never triggers onclose, so reconnect logic has zero coverage.

suggested regression test:
Emit onclose on the mock instance and assert a new WebSocket instance is created after reconnectInterval with reconnectCount incremented, and that after reconnectAttempts closes no further instances are created.

minimum fix scope:
apps/web/test/hooks/useWebSocket.test.ts

## low: V4 position reconcile maps ownership mismatch to 502 'Unable to read v4 position state'

id: fnd_sig-feat-library-09141f3ef9-0a88_2fe753fa29
category: api-contract
confidence: high
triage: contract-mismatch
status: open
feature: Node source apps/api/src/routes (feat_library_09141f3ef9)

evidence:
- apps/api/src/routes/positions.ts:178-180
- apps/api/src/routes/positions.ts:199-201
- apps/api/src/routes/positions.ts:134-136

The V3 reconcile path returns 403 with 'Position is not owned by the authenticated wallet' on ownership mismatch (lines 134-136), but the V4 path deliberately raises V4PositionReadError for the same condition, which the catch block maps to 502 Bad Gateway with the misleading message 'Unable to read v4 position state'. A 502 signals an upstream failure and invites retries, and the message misleads clients into thinking the chain reader is broken. The ownership check is a client authorization failure and should be a 403.

recommendation:
Use a dedicated error (or a tag on V4PositionReadError) for ownership mismatch and return 403 with the same message as the V3 path; reserve 502 for actual RPC/read failures.

test analysis:
No positions route tests exist in the included scope.

suggested regression test:
Test that reconciling a tokenId owned by a different wallet returns 403, while an RPC failure returns 502.

minimum fix scope:
apps/api/src/routes/positions.ts V4 reconcile handler and its error mapping.

repro:
POST /api/v1/positions/v4/:tokenId/reconcile for a tokenId owned by another wallet returns 502 instead of 403.

## low: WebSocket error handlers send internal exception details to untrusted clients

id: fnd_sig-feat-library-53a6b417c0-3079_7e54547e87
category: security
confidence: high
triage: confirmed-bug
status: open
feature: Node source apps/api/src/durable-objects (feat_library_53a6b417c0)

evidence:
- apps/api/src/durable-objects/order-book-do.ts:111-113
- apps/api/src/durable-objects/websocket-hub-do.ts:136-138

Both OrderBookDO and WebSocketHubDO catch all errors in webSocketMessage and echo the raw error to the socket as 'Invalid message: ${err}'. The catch also traps non-parse errors (bugs in the handler itself), so internal error objects/stack traces can be disclosed to any connected client, and genuine handler bugs are masked as 'invalid message'. VolumeAlertHubDO (lines 98-100) correctly swallows instead, showing the intended pattern.

recommendation:
Send a fixed generic message (e.g. { type: 'error', message: 'Invalid message' }) to the client and console.error the full error server-side; narrow the catch to JSON.parse only.

test analysis:
No tests exercise malformed-message handling on either DO.

suggested regression test:
Send a malformed frame (e.g. invalid JSON or a frame that throws in the handler) and assert the client receives a sanitized error without embedded exception text.

minimum fix scope:
apps/api/src/durable-objects/order-book-do.ts and websocket-hub-do.ts

## low: Active network button remains clickable and issues a redundant switchChain call

id: fnd_sig-feat-ui-flow-ffdbfd5b3b-a3e8_40c949a028
category: bug
confidence: medium
triage: risk
status: open
feature: React component WalletConnect (feat_ui-flow_ffdbfd5b3b)

evidence:
- apps/web/src/components/WalletConnect.tsx:30-40 (WalletConnect)

The map over chains marks the current chain with the 'active' class but keeps its button enabled, so clicking the chain the user is already on calls switchChain({ chainId: chain.id }) with the current chainId (line 34). This sends a wallet_switchEthereumChain RPC for the already-active chain, which some wallets reject with an error; combined with the missing error handling, this can surface a confusing wallet error for a no-op action.

recommendation:
Skip the switchChain call when chainId === chain.id, or render the active chain's entry as a disabled/non-interactive item (aria-current, disabled attribute).

test analysis:
No tests exist for this component, so the always-clickable active chain entry has not been asserted.

suggested regression test:
Test that clicking the chain whose id equals the current chainId does not invoke switchChain, or that the button is disabled.

minimum fix scope:
apps/web/src/components/WalletConnect.tsx lines 30-40

## low: Address truncation is wrong when length is 0

id: fnd_sig-feat-library-d9ae9adbfb-ae7d_7c40b67fee
category: bug
confidence: medium
triage: risk
status: open
feature: Node source apps/web/src/components (feat_library_d9ae9adbfb)

evidence:
- apps/web/src/components/Address.tsx:7-11 (Address)

The truncation is `${address.slice(0, 2 + length)}…${address.slice(-length)}`. With length = 0, slice(-0) is slice(0), i.e., the whole address, so a 42-char address renders as '0x' + ellipsis + the full 42-char address — longer than the untruncated input and clearly not a shortened form. The guard at line 8 (address.length < length * 2 + 3) does not catch this case since 42 >= 3. The prop is optional with default 4, so this only triggers when a caller passes length={0}, but the component's contract (truncate when possible) is silently violated rather than falling back to the full address.

recommendation:
Guard the truncation branch: only truncate when length > 0 (or when the computed result is shorter than the original), e.g., if (length <= 0 || address.length < length * 2 + 3) return the full address.

test analysis:
No tests exist for Address.tsx, and the default (length=4) path is the only one that would be exercised incidentally.

suggested regression test:
A parameterized test rendering Address with lengths 0, 1, 4 and asserting the rendered text length is strictly less than the input length whenever the input is long enough to truncate.

minimum fix scope:
apps/web/src/components/Address.tsx

repro:
Render <Address address={'0x1234567890abcdef1234567890abcdef12345678'} length={0} /> and observe output longer than the input with a spurious ellipsis.

## low: Alert rules config has no tests validating threshold/severity/message invariants

id: fnd_sig-feat-library-75f5288ce0-0793_cb05cf5e89
category: test-gap
confidence: medium
triage: test-gap
status: open
feature: Node source apps/api/src/monitoring (feat_library_75f5288ce0)

evidence:
- apps/api/src/monitoring/alerts.ts:1-35 (ALERT_RULES)

ALERT_RULES is the single source of truth for alerting behavior, but no test exists (feature tests: []), and the project's test script (`vitest run`) would not catch drift in this config. Concretely, nothing verifies that every rule carries the required fields, that thresholds/windowMinutes are positive, that severities are valid, or that human-facing messages stay consistent with numeric values — e.g., highLatency's message asserts "p95 latency > 1s" while no percentile field exists in the rule, so the message can silently disagree with whatever the evaluator computes. Because this file is pure data with no executable logic, most runtime bug categories do not apply, but a config regression (a rule missing windowMinutes, a threshold flipped to 0, a severity typo) would ship silently since nothing consumes the shape at compile time beyond inference.

recommendation:
Add a small vitest unit test that iterates over ALERT_RULES and asserts: each rule has non-empty metric and message strings, threshold > 0, windowMinutes > 0, severity is one of "warn" | "critical", and optionally that message/percentage pairs are mutually consistent (0.01 ↔ "1%"). Also assert all rules share the same field set or that field differences (filter, ratio) are intentional.

test analysis:
No test files exist for this module; package.json's test setup (vitest run with @cloudflare/vitest-pool-workers) has no test targeting monitoring config.

suggested regression test:
A vitest test that imports ALERT_RULES and, for each rule key, asserts typeof rule.threshold === "number" && rule.threshold > 0, rule.windowMinutes > 0, rule.severity is "warn" | "critical", and rule.message.trim().length > 0.

minimum fix scope:
Add apps/api/test/monitoring/alerts.test.ts (or equivalent) without changing alerts.ts.

## low: AlertSeverity type is hand-maintained and can drift from severities actually used in ALERT_RULES

id: fnd_sig-feat-library-75f5288ce0-b8bc_1a42e19d02
category: maintainability
confidence: medium
triage: risk
status: open
feature: Node source apps/api/src/monitoring (feat_library_75f5288ce0)

evidence:
- apps/api/src/monitoring/alerts.ts:1-35 (ALERT_RULES)
- apps/api/src/monitoring/alerts.ts:37-38 (AlertSeverity)

AlertSeverity ("warn" | "critical") is declared independently of ALERT_RULES, and the rule objects are not annotated with a shared interface or constrained via `satisfies`. A future rule added with severity "info" would typecheck fine, while consumers that exhaustively switch on AlertSeverity would silently miss it. Additionally, ALERT_RULES objects have no declared shape, so fields like `filter` (errorRate) and `ratio` (highLatency) exist on only some members; AlertRule is therefore a union requiring narrowing for every consumer, and a typo such as a missing windowMinutes or a string threshold would only be caught by downstream inference, not at the config definition site. This is a latent contract risk rather than an active bug — the current four rules are internally consistent (e.g., threshold 25ms with a 30ms limit message, 0.01 with a 1% message).

recommendation:
Define a shared AlertRuleConfig interface (metric, threshold, windowMinutes, severity, message, plus optional filter/ratio) and annotate the map with it, e.g. `const ALERT_RULES = {...} satisfies Record<string, AlertRuleConfig>`. Derive the severity type from the config instead of hand-writing it, e.g. `type AlertSeverity = (typeof ALERT_RULES)[keyof typeof ALERT_RULES]["severity"]`, so any new severity value is either accepted everywhere or rejected at compile time.

test analysis:
The feature has no tests (tests: []), and this is a type-level contract issue that no runtime test currently exercises; the file is only covered by tsc --noEmit, which cannot detect drift between the hand-written AlertSeverity union and rule severities because both are inferred independently.

suggested regression test:
A type-level test asserting `type Severities = (typeof ALERT_RULES)[keyof typeof ALERT_RULES]["severity"]` is assignable to AlertSeverity and that every rule satisfies a common AlertRuleConfig shape (e.g., using a `satisfies` check or an expect-type assertion that each rule has metric, threshold, windowMinutes, severity, and message).

minimum fix scope:
apps/api/src/monitoring/alerts.ts only.

## low: Beta dependency and unstable API surface (effect/unstable/rpc) with no upgrade guard

id: fnd_sig-feat-library-dab264ab2a-7ad7_4dbfc8325e
category: build-release
confidence: medium
triage: risk
status: open
feature: Node source packages/shared/src (feat_library_dab264ab2a)

evidence:
- packages/shared/src/rpc.ts:2
- packages/shared/package.json:17

The package depends on effect 4.0.0-beta.100 (an exact beta pin) and imports Rpc/RpcGroup from effect/unstable/rpc, an explicitly unstable subpath whose API can change between beta releases. The exact pin makes today's builds reproducible, but any deliberate upgrade (even a patch-level beta) can break Rpc.make/RpcGroup.make signatures without a type-level signal at the usage site, and there are no tests to catch such breakage. This is the sole RPC contract source for the project, so the blast radius of a silent API change is wide.

recommendation:
Keep the exact beta pin deliberately (document why in the manifest), and add a contract test that constructs the RpcGroup and decodes a sample payload so an upgrade that changes the unstable API fails CI instead of production.

test analysis:
No tests exist in this feature, so the RPC definitions' validity against the unstable API is never exercised.

suggested regression test:
A test that calls RpcGroup.make(ListPools) and decodes an example payload through the RPC's payload schema, run after any dependency bump.

minimum fix scope:
Add RPC-definition smoke test in packages/shared; no production change required beyond the existing pin.

## low: build dry-run validates only the default environment; staging/production config is never checked before release

id: fnd_sig-feat-release-accf8dfaca-86ef_ad71ae5b6f
category: build-release
confidence: medium
triage: risk
status: open
feature: Package script build (@aetherdex/api) (feat_release_accf8dfaca)

evidence:
- apps/api/package.json:9 (build)
- apps/api/package.json:11-12

The build script runs `wrangler deploy --dry-run --outdir=dist` with no `--env` flag, so it only resolves and validates the top-level (default) Worker configuration. The same file defines `deploy:staging` and `deploy:production` scripts (lines 11-12) that pass `--env staging`/`--env production`, confirming environment-specific config exists. Any binding, queue, KV, D1, or var misconfiguration scoped to those envs (e.g., a typo in a queue name in wrangler.jsonc's staging section) will pass `bun run build` in CI and only fail at actual deploy time, turning a release-blocking error into a mid-release failure.

recommendation:
Add per-environment dry-run validation, e.g. `build:staging`/`build:production` scripts running `wrangler deploy --dry-run --env staging` and `--env production`, and have CI execute all three (default, staging, production) before tagging a release.

test analysis:
No tests are linked to this feature, and vitest does not exercise package scripts or wrangler configuration validation.

suggested regression test:
A CI step that runs `bun run build` plus `wrangler deploy --dry-run --env staging` and `wrangler deploy --dry-run --env production` and asserts exit code 0 for each.

minimum fix scope:
apps/api/package.json

## low: build emits to dist/ without cleaning the directory, risking stale bundles being treated as the artifact

id: fnd_sig-feat-release-accf8dfaca-5872_bf31b21abc
category: build-release
confidence: medium
triage: risk
status: open
feature: Package script build (@aetherdex/api) (feat_release_accf8dfaca)

evidence:
- apps/api/package.json:9 (build)

`wrangler deploy --dry-run --outdir=dist` writes the bundled worker into `dist/` but does not clear the directory first. If the Worker's code or configuration changes (entry renamed, modules removed, bindings altered), previous bundle files remain in `dist/`, so a CI pipeline that archives or publishes the contents of `dist/` can ship a mixed or stale artifact. There is no `clean` script or `rm -rf dist` step visible in this file to guarantee the output matches the current source.

recommendation:
Remove the output directory before building (e.g., `rm -rf dist && wrangler deploy --dry-run --outdir=dist`, or a `clean` script invoked before `build` in CI) so `dist/` always reflects the current source.

test analysis:
No tests are linked to this feature; nothing asserts the contents or freshness of the `dist/` output.

suggested regression test:
A CI check that runs `bun run build`, then asserts `dist/` contains exactly the expected bundle file(s) for the current entry point and no orphaned files from a previous build.

minimum fix scope:
apps/api/package.json

## low: Build toolchain pinned to `bun@canary`, making `build` non-reproducible

id: fnd_sig-feat-release-51170e0f9c-d838_cef720f169
category: build-release
confidence: medium
triage: risk
status: open
feature: Package script build (feat_release_51170e0f9c)

evidence:
- package.json:40 (packageManager)
- package.json:36-39 (engines)

`packageManager: "bun@canary"` pins the runner of the release `build` script to a moving canary release. Canary builds are unstable by definition (they can be yanked, regress, or change `--filter` semantics without notice), so the same `bun run --filter '*' build` can behave differently across environments and over time, breaking or silently altering the release build. The `engines` floor (`>=1.4.0`) is a minimum, not a pin, so it does not restore reproducibility.

recommendation:
Pin a stable, released bun version (e.g., `bun@1.2.x`) in `packageManager` and align `engines` with it; if canary is truly required, pin a specific canary build identifier.

test analysis:
No tests are included for this feature, and toolchain version pinning is an environment concern outside the vitest suite.

minimum fix scope:
package.json line 40 (packageManager) and optionally engines.

## low: Button applies daisyUI loading state twice (btn loading class plus a second spinner span)

id: fnd_sig-feat-library-d06274bfb5-96d8_1b7232cdb1
category: bug
confidence: medium
triage: risk
status: open
feature: Node source apps/web/src/components/ui (feat_library_d06274bfb5)

evidence:
- apps/web/src/components/ui/Button.tsx:27-35 (Button)

When `loading` is true, the component adds the daisyUI `loading` class to the button (line 27, which renders a spinner via the button's pseudo-element) AND additionally renders a `<span className="loading loading-spinner loading-sm">` (line 35). daisyUI's `.loading` class on any element renders a spinner, so the button will display two spinners simultaneously, and the duplicate decoration is redundant. The `loading` class on the button also relies on being a `btn` modifier while the span uses the standalone spinner form, doubling the visual noise. Confidence is medium because the exact rendered output depends on daisyUI 5's stylesheet, which is not in the excerpt.

recommendation:
Pick one mechanism: either keep the `loading` class on the button (and drop the inner span, letting the `btn loading` modifier render the spinner) or drop the class and keep the span. Also consider aria-busy for accessibility.

test analysis:
No test imports or renders Button, and the smoke test asserts only vitest globals and window/document existence.

suggested regression test:
Render <Button loading> and assert exactly one element with the daisyUI loading spinner classes is present.

minimum fix scope:
apps/web/src/components/ui/Button.tsx

repro:
Render <Button loading> with daisyUI styles applied; two spinner indicators appear inside the button.

## low: ChainStateReader tick scan issues up to 1025 parallel RPC readContract calls per getPoolState

id: fnd_sig-feat-library-8f5d5fd534-85df_8d5d21820f
category: performance
confidence: medium
triage: risk
status: open
feature: Node source apps/api/src/services#1 (feat_library_8f5d5fd534)

evidence:
- apps/api/src/services/chain-state-reader.ts:251-262
- apps/api/src/services/chain-state-reader.ts:157

The windowed tick scan fires Promise.all over 2*scan+1 getTickLiquidity calls (line 259), where scan is config-driven but capped at MAX_SCAN_EACH_SIDE = 512 — i.e., up to 1025 concurrent JSON-RPC requests per getPoolState, each an HTTP readContract. At any non-trivial scan setting this will trip public RPC rate limits (typically 100s-1000s req/min per key), making the whole Promise.all fail with rpc_error. Because the swap service only rolls back to legacy for reason 'not_configured' (swap.service.ts line 244), a rate-limited scan causes the quote to fail with no_pool rather than degrade, so a misconfigured scan size directly breaks quoting under load.

recommendation:
Lower the practical cap, make the scan size conservative by default, batch the probes (multicall3 or eth_call aggregation), or bound concurrency with a semaphore so a rate-limit failure is distinguishable and recoverable.

test analysis:
The included chain-state-reader tests use tickScanEachSide: 1 with a mock client, so the live fan-out and rate-limit behavior are never exercised.

suggested regression test:
Test makeStateViewReaderLayer with tickScanEachSide = 512 asserts the client receives no more than a configured concurrency bound (or fails with a typed error rather than an unhandled burst).

minimum fix scope:
apps/api/src/services/chain-state-reader.ts (scan cap / batched probes)

## low: CORS default allowlist includes http://localhost:3000 and is inherited by any environment that omits CORS_ORIGINS

id: fnd_sig-feat-library-e12da032c1-60b3_3255a3d185
category: security
confidence: medium
triage: risk
status: open
feature: Node source apps/api/src (feat_library_e12da032c1)

evidence:
- apps/api/src/index.ts:86-100 (cors origin callback)

The origin callback falls back to `"http://localhost:3000,https://aetherdex.io"` when CORS_ORIGINS is unset, in every environment. A production or staging deployment that does not explicitly set CORS_ORIGINS would therefore accept credentialed cross-origin requests (credentials: true, line 98) from any page served at http://localhost:3000 on a user's machine — e.g. a compromised or malicious local dev server (a very common port for dev tooling) could issue authenticated API calls as the logged-in user. The dev-origin default should not silently leak into production.

recommendation:
Remove localhost from the fallback default (use only the production origin) and require CORS_ORIGINS to be set explicitly per environment, or gate the localhost entry on c.env.ENVIRONMENT being a dev value.

test analysis:
No CORS tests exist in the linked suite; the placeholder tests never construct requests with an Origin header.

suggested regression test:
Call the origin callback (or app.request with an Origin header) with ENVIRONMENT=production and no CORS_ORIGINS set, asserting that http://localhost:3000 is not allowed.

minimum fix scope:
apps/api/src/index.ts lines 86-100

## low: D1 fallback serves arbitrary verified rows and truncates the canonical list at 500

id: fnd_sig-feat-library-4a1871bbb1-bfa5_bc93e9cf2f
category: bug
confidence: medium
triage: risk
status: open
feature: Node source apps/api/src/services/:token (feat_library_4a1871bbb1)

evidence:
- apps/api/src/services/token-list.service.ts:188-197 (readD1Cache)
- apps/api/src/services/token-list.service.ts:209-224 (resolveTokens)
- apps/api/src/services/token-list.service.ts:4-7

readD1Cache returns any row with is_verified = 1 for the chain, ordered by symbol, capped at 500. Rows written by token.service.upsertToken (is_verified may be 1) are indistinguishable from canonical-list rows because writeThroughD1 stores no source marker, so the fallback can serve tokens that are not in the canonical list — contradicting the file header's contract that D1 is 'strictly a write-through CACHE of that list — never a separately curated source' (lines 4-7). Also, if the canonical list or table exceeds 500 rows, ORDER BY symbol + LIMIT 500 drops rows arbitrarily, and getToken can return null for a token that exists in D1 whenever KV is empty and the upstream fetch fails (the exact scenario resolveTokens routes to this fallback).

recommendation:
Add a source/canonical marker column (e.g., source = 'token-list') set by writeThroughD1 and filter on it in readD1Cache, and remove or raise the arbitrary 500 cap for getToken lookups (e.g., lookup by address directly from D1 instead of materializing a capped list).

test analysis:
No tests are included, and this path only activates when KV misses and the upstream fetch fails, so it is easy to miss in integration testing.

suggested regression test:
Seed D1 with 500+ verified rows (including a canonical row beyond the 500th by symbol order), simulate a fetch failure with empty KV, and assert getToken still finds the canonical token.

minimum fix scope:
token-list.service.ts readD1Cache (lines 188-197) and writeThroughD1 (lines 134-155)

## low: deploy script can publish stale or missing build output (no predeploy build hook)

id: fnd_sig-feat-release-fa18bd5381-bf27_4606f5649c
category: build-release
confidence: medium
triage: risk
status: open
feature: Package script build (@aetherdex/web) (feat_release_fa18bd5381)

evidence:
- apps/web/package.json:10 (deploy)

The `deploy` script (`wrangler pages deploy dist --project-name aether-dex`) consumes the artifact produced by the `build` feature but does not build first. If a developer or CI runs `bun run deploy` without first running `bun run build`, wrangler publishes whatever `dist/` currently contains — a stale build from an older commit, or fails if `dist/` is absent (e.g., clean checkout). Since this is a release feature, the deploy path is the consumer of the build output, and the two scripts are not coupled.

recommendation:
Rename the current script to `deploy:only` and add `"deploy": "bun run build && bun run deploy:only"` (or use a `predeploy` hook) so deploys always build from the current source.

test analysis:
No tests cover the deploy script, and deploy is a manual/CI command with no automated invocation in the included files.

suggested regression test:
A CI deploy job that verifies `dist/` is regenerated (e.g., by running build inside the deploy job) rather than reusing a cached artifact.

minimum fix scope:
apps/web/package.json (deploy script composition)

## low: DexScreener returns `pairs: null` for tokens without pools; queryFn throws TypeError and retries instead of returning an empty state

id: fnd_sig-feat-ui-flow-96f77c54e9-eb6f_bc442a083a
category: api-contract
confidence: medium
triage: contract-mismatch
status: open
feature: React component PoolStats (feat_ui-flow_96f77c54e9)

evidence:
- apps/web/src/components/PoolStats.tsx:44-59 (PoolStats)

The DexScreener GET /latest/dex/tokens/{address} endpoint returns a body with `pairs: null` (not `[]`) when no pairs exist for a token, but line 44 casts `json.pairs` to `DexScreenerPair[]` with no null guard. With a `chainId` prop set, `pairs.filter` (line 55) throws TypeError; without it, `pairs.sort` (line 59) throws. React Query catches the exception, so the component still renders its 'No pool data available' fallback, but a perfectly normal API response becomes an error: the query retries the default 3 times (extra API calls against a rate-limited endpoint), logs a confusing TypeError, and any genuine network/HTTP failure is indistinguishable from 'no data'. The code already guards optional fields with `?? 0` elsewhere (lines 104, 108, 114, 117), showing the missing guard on `pairs` is an oversight, not a contract the code intends to rely on.

recommendation:
Normalize the response defensively: `const pairs = json.pairs ?? []` before filtering/sorting, and optionally validate the shape at runtime instead of a bare type assertion. Also consider distinguishing 'no pool data' from transport errors in the UI, since both currently render the same message.

test analysis:
No tests exist for this component (feature metadata reports tests: [] and no test files were included), so the null-pairs contract is untested.

suggested regression test:
Unit test mocking fetch to resolve `{ schemaVersion: '1.0.0', pairs: null }` (and a 429 response) and asserting the component renders the empty-state card with no retry loop and no uncaught error.

minimum fix scope:
One line in the queryFn (`const pairs = json.pairs ?? []`) plus a test; no API or component contract change.

repro:
Mount PoolStats with a tokenAddress that has no DexScreener pairs and chainId=8453; observe the TypeError thrown inside queryFn before the empty-state path, followed by default react-query retries.

## low: Error state is not exposed to assistive technology (missing aria-invalid / aria-describedby)

id: fnd_sig-feat-ui-flow-8f3d4647c6-bf7b_27d36ca211
category: api-contract
confidence: medium
triage: contract-mismatch
status: open
feature: React component Input (feat_ui-flow_8f3d4647c6)

evidence:
- apps/web/src/components/ui/Input.tsx:18-22 (Input)
- apps/web/src/components/ui/Input.tsx:23-27 (Input)

The component's public API exposes an `error` prop, but the input element never receives aria-invalid or an aria-describedby link to the error message. The error is rendered as a <label htmlFor={inputId}>, which does give some screen-reader association when the input receives focus, but it does not communicate the invalid state, and the error text is not announced as a description distinct from the label. For a form-control component advertised as handling errors, this is an accessibility contract gap; it also breaks the common pattern where callers expect the error to be discoverable via aria-describedby queries in tests/automation.

recommendation:
Set aria-invalid={error ? true : undefined} on the input and wire the error message with aria-describedby (give the error element an id derived from inputId, e.g. `${inputId}-error`). Keep the label association or drop it in favor of the describedby pattern.

test analysis:
No tests exist for this component (tests: []), and no a11y assertions are present anywhere in the included files.

suggested regression test:
Render Input with an error, then assert the input has aria-invalid="true" and that aria-describedby references the element containing the error text.

minimum fix scope:
Update apps/web/src/components/ui/Input.tsx to set aria-invalid and aria-describedby when error is present.

## low: fetchTokenPrice ignores the chain id and hardcodes the Ethereum CoinGecko endpoint; price KV keys are chain-agnostic

id: fnd_sig-feat-library-c77821ce5c-3282_0c86ed99bf
category: bug
confidence: medium
triage: risk
status: open
feature: Node source apps/api/src/workers (feat_library_c77821ce5c)

evidence:
- apps/api/src/workers/queue-handler.ts:711-715 (fetchTokenPrice)
- apps/api/src/workers/queue-handler.ts:613-615 (handlePriceRefresh)
- apps/api/src/workers/cron-handler.ts:326-327 (refreshTopPools)

`fetchTokenPrice` receives `_chainId` but hardcodes `ethereum` in the CoinGecko URL, and prices are cached under `price:${token}` with no chain component, then consumed chain-agnostically by `refreshTopPools` and the websocket hub. On any non-Ethereum chain (the codebase supports Sepolia and V3/V4 multi-chain configs), this stores wrong-chain or missing prices under keys that collide across chains. Confidence is medium because the current deployment may be Ethereum-only, but the API contract clearly intends per-chain behavior.

recommendation:
Map CHAIN_ID to the CoinGecko platform (e.g., 'ethereum', 'base', 'arbitrum-one') and namespace KV keys by chain, or restrict price refresh to the configured chain explicitly.

test analysis:
No tests cover fetchTokenPrice or KV key scoping.

suggested regression test:
Unit test fetchTokenPrice with a non-Ethereum chain id asserting the correct platform in the request URL, and that price keys include the chain.

minimum fix scope:
apps/api/src/workers/queue-handler.ts

## low: Floating dependency specs ("latest" and ">=" ranges) make installs non-reproducible

id: fnd_sig-feat-library-e6a0e61d33-bc20_969fbc0bd1
category: build-release
confidence: medium
triage: risk
status: open
feature: Node package @aetherdex/alchemy-infra (feat_library_e6a0e61d33)

evidence:
- infra/alchemy/package.json:18-20
- infra/alchemy/package.json:24-29

`@types/bun` is specified as `latest` and `effect`/`@effect/*` use open-ended ranges (`>=4.0.0-beta.100 || >=4.0.0`, where the second clause makes the range effectively `>=4.0.0-beta.100`, permitting beta resolution); only `alchemy` is exact-pinned. Fresh installs or lockfile regeneration can resolve different versions across machines and CI, so `bun run typecheck` results and deploy behavior can drift (e.g., a new @types/bun or effect beta introducing type errors or runtime changes). For an infrastructure package whose scripts gate deploys, this is a reproducibility hazard.

recommendation:
Pin exact versions or narrow ranges, commit the lockfile, and add a CI step that verifies `bun install --frozen-lockfile` succeeds.

test analysis:
No CI or install-verification logic exists in the reviewed files.

minimum fix scope:
infra/alchemy/package.json (dependencies/devDependencies)

## low: formatAmount decimal 'trim' is a no-op: slice never truncates and the 'at least 2 decimals' guarantee is not implemented

id: fnd_sig-feat-library-410ea57829-4d51_852a709db1
category: bug
confidence: medium
triage: risk
status: open
feature: Node source apps/web/src/routes (feat_library_410ea57829)

evidence:
- apps/web/src/routes/swap.tsx:389-408 (formatAmount)

Line 401-402: trimmed.slice(0, Math.max(trimmed.length, 2)) — Math.max(trimmed.length, 2) is always >= trimmed.length, so slice always returns the entire string. The comment claims a cap/keep-at-least-2-decimals policy, but in practice every fractional digit is displayed (a 1-digit fraction renders '1.5', not '1.50', and an 18-decimal amount renders all 18 digits). For small or high-precision quote amounts this produces very long strings that overflow the fixed-width swap card layout.

recommendation:
Decide on the intended policy and implement it explicitly, e.g. cap fraction at 6 digits with trailing-zero trim: fracPart.replace(/0+$/, '').slice(0, 6) || '0', and pad to 2 when shorter if 'at least 2 decimals' is truly desired.

test analysis:
formatAmount is module-private and the included tests never call it; swap coverage is limited to e2e rendering assertions.

suggested regression test:
Unit test formatAmount for cases like '1500000000000000000'/18 (expect '1.5'), a tiny amount, and a zero-decimal token.

minimum fix scope:
apps/web/src/routes/swap.tsx

repro:
Quote an amount whose formatted output has many fractional digits (e.g., 18-decimal token amounts) and observe the full un-capped fraction rendered in the 'You receive' area.

## low: GET /api/v1/pools accepts unvalidated sortBy/sortDirection/filterToken query params

id: fnd_sig-feat-library-09141f3ef9-f371_68acacbc26
category: api-contract
confidence: medium
triage: contract-mismatch
status: open
feature: Node source apps/api/src/routes (feat_library_09141f3ef9)

evidence:
- apps/api/src/routes/pools.ts:42-46

sortBy and sortDirection are cast from raw query strings to SortField/SortDirection without any whitelist check, and filterToken is passed through without format validation. The documented enum contract is unenforced: an arbitrary sortBy value is forwarded to PoolService.listPools, so invalid input either produces unspecified sorting behavior or a 500 (from the catch-all) instead of a 400. Every other route in this feature validates its params at the handler; this one should validate the enum values and the token address format up front.

recommendation:
Validate sortBy against ['tvl','volume','fees','created'], sortDirection against ['asc','desc'], and filterToken against /^0x[a-fA-F0-9]{40}$/ when provided; return 400 on violation.

test analysis:
No pools route tests exist in the included scope.

suggested regression test:
Route test asserting invalid sortBy/sortDirection/filterToken values return 400 and valid values pass through to the service.

minimum fix scope:
apps/api/src/routes/pools.ts GET / handler param validation.

repro:
GET /api/v1/pools?sortBy=INJECTED returns 500 or unspecified ordering instead of 400.

## low: Hand-rolled SIWE message omits EIP-4361 Issued At and leaves nonce replay window unbounded

id: fnd_sig-feat-library-da89b4a88e-2c4d_8615d39aca
category: api-contract
confidence: medium
triage: contract-mismatch
status: open
feature: Node package @aetherdex/web (feat_library_da89b4a88e)

evidence:
- apps/web/src/hooks/useSiweAuth.ts:38-48
- apps/web/src/hooks/useSiweAuth.ts:33-35

The sign-in message is assembled by string concatenation with only domain/address/statement/URI/Version/Chain ID/Nonce. EIP-4361 (the standard this flow claims to implement) requires an Issued At field; a standards-compliant verifier (siwe package) will reject this message outright, and the absence of issued-at/expiry means nonce freshness depends entirely on opaque server state. The nonce fetched at lines 33-35 is also not bound to any client session here, so if the server does not track single-use nonces the signature can be replayed.

recommendation:
Build the message with the `siwe` package (or at minimum append an Issued At line) and keep the nonce server-issued, single-use, and expiry-bound.

test analysis:
No useSiweAuth test is among the included files; the handshake is only exercised against the live backend, so message-format conformance is never asserted.

suggested regression test:
Unit test that the constructed message round-trips through siwe.Message parsing and includes issuedAt.

minimum fix scope:
apps/web/src/hooks/useSiweAuth.ts

repro:
Attempt verification of the generated message with a siwe-compliant parser: parsing/verification fails on missing issuedAt.

## low: Inconsistent handling of invalid sessions in authMiddleware: malformed JSON is never deleted and kv.delete is unguarded

id: fnd_sig-feat-library-bd573b816b-ce57_315c131d55
category: bug
confidence: medium
triage: risk
status: open
feature: Node source apps/api/src/auth (feat_library_bd573b816b)

evidence:
- apps/api/src/auth/middleware.ts:48-69

Two inconsistencies in the same validation block: (1) when the session fails structural validation (lines 50-64) the code deletes the session from KV, but when JSON.parse throws (lines 67-69) the catch swallows the error and leaves the malformed entry in KV, so every subsequent request re-reads and re-parses the dead entry until the 24-hour TTL expires; (2) the kv.delete at line 61 is outside any try/catch, so a transient KV delete failure throws out of the middleware and turns an otherwise-pass-through request into a 500. Both are minor robustness issues with concrete (if small) impact: stale KV entries and request failures on a non-destructive middleware path.

recommendation:
Delete the session key in the catch block as well (best-effort, wrapped in try/catch), and wrap the validation-failure kv.delete in try/catch so middleware failures never 500 the request.

test analysis:
No tests exist for this source group, and malformed-session cleanup is an edge path unlikely to be exercised manually.

suggested regression test:
Insert a session key with invalid JSON into KV, make a request with that Bearer token, and assert the middleware passes through and the key is deleted.

minimum fix scope:
apps/api/src/auth/middleware.ts

## low: Inconsistent silent chain-id fallbacks: keeper tick defaults to 11155111 and price enqueue to 1 when CHAIN_ID is invalid

id: fnd_sig-feat-library-c77821ce5c-a4ef_6255f77210
category: bug
confidence: medium
triage: risk
status: open
feature: Node source apps/api/src/workers (feat_library_c77821ce5c)

evidence:
- apps/api/src/workers/cron-handler.ts:177 (runKeeperTick)
- apps/api/src/workers/cron-handler.ts:359-361 (enqueuePriceRefresh)

`runKeeperTick` silently operates on chain 11155111 when CHAIN_ID is unparsable (`parseInt(...) || 11155111`), while `enqueuePriceRefresh` silently defaults to chain 1 (`Number.isNaN(chainId) ? 1 : chainId`), and the other ticks (`runV3LiquidityIndexer`, `runPhase3Indexer`, `runVolumeAlerts`) no-op on invalid CHAIN_ID via `parseChainId`. A misconfigured or missing CHAIN_ID therefore makes the keeper evaluate/expire orders and the price enqueuer query tokens on two different, silently chosen chains, while indexers do nothing — divergent behavior that is hard to diagnose in production.

recommendation:
Use `parseChainId` consistently in all ticks and skip (log) on invalid CHAIN_ID instead of falling back to a hardcoded chain.

test analysis:
No tests cover cron-handler tick behavior with invalid CHAIN_ID.

suggested regression test:
Call runKeeperTick and enqueuePriceRefresh with CHAIN_ID='not-a-chain' and assert no queries/enqueues occur.

minimum fix scope:
apps/api/src/workers/cron-handler.ts

## low: Input generates non-deterministic DOM ids with Math.random() instead of useId()

id: fnd_sig-feat-library-d06274bfb5-62d0_3d419eda88
category: maintainability
confidence: medium
triage: risk
status: open
feature: Node source apps/web/src/components/ui (feat_library_d06274bfb5)

evidence:
- apps/web/src/components/ui/Input.tsx:9 (Input)

When no `id` prop is supplied, Input derives its id from Math.random().toString(36). This makes the rendered markup non-deterministic across renders: any prerendering/SSR pass (React 19 officially warns against Math.random()-based ids) would bake a different id into static HTML than the client hydration render, breaking the label/input association and producing hydration mismatches. React provides useId() precisely for this case. Within a single client-only render the label htmlFor and input id stay consistent, so impact is limited today (Vite SPA), which keeps severity low.

recommendation:
Replace Math.random() with React's useId() (const inputId = id ?? useId()), which is stable across hydration and collision-free.

test analysis:
No included test imports or renders Input, so id generation behavior is entirely untested.

suggested regression test:
Render <Input label="x" />, re-render, and assert the id attribute is stable across renders; also assert the label's htmlFor matches the input's id.

minimum fix scope:
apps/web/src/components/ui/Input.tsx

repro:
Render <Input label="X" /> twice without an id; the id attributes differ between renders, and a hydrated/prerendered page would mismatch the client-generated id.

## low: insertTransaction writes the same (chain_id, tx_hash) key space as recordSwap but without conflict handling

id: fnd_sig-feat-service-1e40670be0-3ea9_ff54602d8d
category: api-contract
confidence: medium
triage: contract-mismatch
status: open
feature: Node source apps/api/src/db (feat_service_1e40670be0)

evidence:
- apps/api/src/db/queries.ts:103-110
- apps/api/src/db/queries.ts:150-159

recordSwap inserts into transactions with ON CONFLICT(chain_id, tx_hash) DO NOTHING, implying a unique constraint exists on (chain_id, tx_hash). insertTransaction inserts into the same table with the same key columns and no conflict clause. If a transaction is recorded by both the indexer (recordSwap) and the API (insertTransaction), or if insertTransaction is retried after a partial failure, the second insert raises a constraint violation and the whole Effect fails. There is also no path here to transition a pending row to confirmed/failed, so the two write paths can collide on the same row with different statuses.

recommendation:
Add ON CONFLICT(chain_id, tx_hash) DO NOTHING (or DO UPDATE for status transitions) to insertTransaction, matching recordSwap's semantics, and document which writer owns which status.

test analysis:
No tests are included for the module, and the collision only occurs across two different functions, which a single-function test would not exercise.

suggested regression test:
Insert the same (chain_id, tx_hash) twice via insertTransaction and assert the second call succeeds as a no-op rather than throwing.

minimum fix scope:
apps/api/src/db/queries.ts (insertTransaction)

repro:
Call insertTransaction with a txHash already present in transactions (inserted via recordSwap or a prior insertTransaction call); the query throws a UNIQUE constraint error.

## low: Integer-only fields typed as Schema.Number accept fractional values

id: fnd_sig-feat-library-b3899aac05-0169_879b858a0e
category: api-contract
confidence: medium
triage: contract-mismatch
status: open
feature: Node package @aetherdex/shared (feat_library_b3899aac05)

evidence:
- packages/shared/src/schema.ts:3-19 (PoolSchema)
- packages/shared/src/schema.ts:42-54 (TokenSchema)
- packages/shared/src/schema.ts:58-61 (PoolListResponseSchema)

Effect's Schema.Number accepts any finite JSON number, so fields that are semantically integral — fee (Uniswap fee tiers like 3000), tickSpacing, currentTick, chainId, decimals, and response count — will validate fractional values such as fee: 2999.5 or decimals: 17.5. These values flow through the shared contract into downstream tick math and display logic, which assume integers; the schema's stated purpose is to be the 'typed API contract', so it should enforce integrality.

recommendation:
Use Schema.Int (or more specific refinements like Schema.NonNegativeInt / Schema.PositiveInt) for fee, tickSpacing, currentTick, chainId, decimals, and count fields.

test analysis:
There are no tests for the schemas, so the absence of integrality enforcement is unobserved.

suggested regression test:
A vitest test asserting that decoding { fee: 3000.5, ... } with PoolSchema fails with a parse error while { fee: 3000 } succeeds.

minimum fix scope:
packages/shared/src/schema.ts

## low: lint script coverage misses e2e test files and root configs

id: fnd_sig-feat-release-2c926a7be1-6ba6_20c6a62c21
category: maintainability
confidence: medium
triage: risk
status: open
feature: Package script lint (@aetherdex/web) (feat_release_2c926a7be1)

evidence:
- apps/web/package.json:17 (lint)
- apps/web/package.json:14-15 (test:e2e)

The lint script is 'biome check src/ test/', which restricts Biome's check to the src/ and test/ directories. The same package.json defines test:e2e and test:e2e:ui (Playwright) scripts, so e2e test files necessarily exist somewhere outside src/ and test/ (conventionally an e2e/ directory), and they will never be linted. Root-level config files that this package depends on (vite.config.*, playwright.config.*, biome.json, tsconfig.*) are also excluded from the lint scope. As a result, the lint gate can pass while e2e specs and configs contain lint errors or unformatted code, and the separate format script ('biome format --write src/ test/') has the same coverage blind spot, so formatting drift in those files is never detected. This is a coverage/consistency gap rather than a functional bug in the script itself; biome check on the given paths behaves correctly.

recommendation:
Either expand the paths in scripts.lint (and lint:fix/format) to cover all project source, e.g. 'biome check src/ test/ e2e/' plus explicit root config files, or run 'biome check .' (with ignores for dist/ and node_modules) so e2e tests and configs are included. Verify the e2e test directory name in the repo before choosing paths.

test analysis:
No tests are included for this feature, and package.json script scope is not exercised by the vitest test suite; lint coverage is only observable when running the lint script against the full repo.

minimum fix scope:
apps/web/package.json scripts.lint (and lint:fix, format) path arguments

## low: lint script does not fail on Biome warnings, so the CI lint gate can pass with outstanding diagnostics

id: fnd_sig-feat-release-4862937c51-77a0_69a1141bd7
category: build-release
confidence: medium
triage: risk
status: open
feature: Package script lint (feat_release_4862937c51)

evidence:
- package.json:12 (lint)

`biome check .` exits non-zero only for error-level diagnostics; warning-level diagnostics do not change the exit code unless `--error-on-warnings` is passed (or the dedicated `biome ci` command is used). As the monorepo's lint gate, this script can therefore report success in CI while warnings accumulate silently, and since fixes require the separate `lint:fix`/`format` write commands, nothing forces cleanup. Whether this actually bites depends on the severity configuration in biome.json, which is not included, so confidence is medium.

recommendation:
Change the script to `biome check --error-on-warnings .` (or use `biome ci .` for CI semantics) so warning-level diagnostics fail the lint gate, or explicitly configure warning severities in biome.json.

test analysis:
The feature declares no tests; Biome's exit-code semantics are only exercised when CI runs the script, and a pass-with-warnings state produces no failure that a test would observe.

suggested regression test:
A CI step that seeds a warning-level diagnostic in a fixture file and asserts `bun run lint` exits non-zero, or an assertion that the exact command executed contains `--error-on-warnings`/`ci`.

minimum fix scope:
Single-line change to package.json line 12.

## low: lint script only checks src/, leaving package-level files outside verification

id: fnd_sig-feat-release-3c1de179c9-7eda_118c473bf3
category: maintainability
confidence: medium
triage: risk
status: open
feature: Package script lint (@aetherdex/shared) (feat_release_3c1de179c9)

evidence:
- packages/shared/package.json:13 (lint)
- packages/shared/package.json:14 (lint:fix)

The lint script is hard-coded to 'biome check src/', so only files under src/ are linted and format-checked by this package script. Biome is capable of checking JSON and other config files, but package.json itself, tsconfig.json, any biome config, and any test fixtures/scripts that live outside src/ are never verified by 'bun run lint' for this package. CI that gates on this script can pass while out-of-scope files drift out of lint/format compliance, and the effective coverage silently changes whenever files are added or moved outside src/.

recommendation:
Either widen the script to cover the whole package (e.g. 'biome check .') or list the extra files explicitly (e.g. 'biome check src/ package.json tsconfig.json'), and ensure the monorepo-root lint/CI job covers whatever this per-package script does not.

test analysis:
This feature ships no tests and script scope is a configuration property; no included test exercises which files the lint command inspects.

suggested regression test:
A CI check that places a file with a deliberate formatting/lint violation outside src/ (e.g. at the package root), runs 'bun run lint', and asserts a non-zero exit — proving out-of-scope files are covered.

minimum fix scope:
packages/shared/package.json (scripts.lint and scripts.lint:fix)

## low: lint script only covers src/ and test/, excluding package config files (wrangler.toml, biome.json, vitest config, migrations)

id: fnd_sig-feat-release-9a65e9eca0-f094_43031a1a8f
category: maintainability
confidence: medium
triage: risk
status: open
feature: Package script lint (@aetherdex/api) (feat_release_9a65e9eca0)

evidence:
- apps/api/package.json:19 (lint)
- apps/api/package.json:20-21

The lint script runs `biome check src/ test/`, which restricts Biome to the source and test directories. This package is a Cloudflare Worker (per the wrangler scripts at lines 8-14, 22-37) and therefore almost certainly contains `wrangler.toml`, a `biome.json` (referenced indirectly by the `@biomejs/biome` devDependency), a vitest config, and D1 migration files (SQL), none of which are covered by the lint/format/lint:fix scripts since Biome 2 can check TOML/JSON files. A misconfigured `wrangler.toml` (e.g., wrong D1 binding, missing compatibility_date) or formatting drift in config files will not be caught by `bun run lint`, so the lint gate gives a false sense of full coverage while only `src/` and `test/` are protected. This is a coverage gap rather than a functional defect in the script itself, and the review mode forbids inspecting beyond the shown excerpt, so existence of the config files is inferred from the package's own scripts rather than verified.

recommendation:
Run `biome check` without restricting to subdirectories (or explicitly include config files, e.g. `biome check src/ test/ wrangler.toml biome.json vitest.config.ts migrations/`), so config files that affect the deployed worker are linted too. Alternatively, if full-package linting is intended, use `biome check .` with appropriate `files.includes`/`files.ignore` rules in biome.json.

test analysis:
Package.json scripts are not executed by vitest tests; the test script (`vitest run`) never invokes the lint script, and there are no tests listed for this feature to assert script path coverage.

minimum fix scope:
apps/api/package.json (extend the lint, lint:fix, and format scripts to cover config files or use a non-path-restricted biome invocation)

## low: liquidityDistribution heights are treated as raw percentages and silently clamped

id: fnd_sig-feat-ui-flow-e6ed457e9a-0be7_8fce7de5b2
category: api-contract
confidence: medium
triage: contract-mismatch
status: open
feature: React component RangeSelector (feat_ui-flow_e6ed457e9a)

evidence:
- apps/web/src/components/RangeSelector.tsx:31-43 (RangeSelector)
- apps/web/src/components/RangeSelector.tsx:96-98 (clamp)

Each distribution value is used directly as a CSS height percentage with clamp(height, 0, 100). The prop name and the component contain no contract stating values must be pre-normalized to 0-100. A caller passing raw pool liquidity (e.g., 1e18-scale token amounts, which is the natural output of an on-chain liquidity query in a DEX) gets a flat full-height bar chart with no error or warning, silently misrepresenting the depth curve. Conversely, negative values are clipped to 0. The silent clamping hides data problems and makes the visualization depend on an undocumented normalization convention.

recommendation:
Either normalize inside the component (height = value / max * 100 with max>0 guard), or validate/throw on out-of-range values, and document the 0-100 contract on the prop (e.g., via JSDoc or a branded type).

test analysis:
No tests exist for this component; the normalization contract is undocumented and unasserted.

suggested regression test:
Render with a distribution containing values above 100 and assert bars are scaled relative to the maximum rather than all pinned at 100%.

minimum fix scope:
Add normalization (divide by max) or a documented validation in RangeSelector.tsx.

repro:
Pass liquidityDistribution={[1e18, 2e18, 1e18]}; all bars render at 100% height.

## low: List-pools response has two competing shapes: bare array in RPC vs unused PoolListResponseSchema wrapper

id: fnd_sig-feat-library-dab264ab2a-fceb_1401500bf2
category: api-contract
confidence: medium
triage: contract-mismatch
status: open
feature: Node source packages/shared/src (feat_library_dab264ab2a)

evidence:
- packages/shared/src/rpc.ts:7 (ListPools)
- packages/shared/src/schema.ts:30-33 (PoolListResponseSchema)

ListPools declares its success schema as Schema.Array(PoolSchema), while schema.ts defines PoolListResponseSchema ({pools, count}) that is never referenced by the RPC (nor by the token-list equivalents, which are exported but unused here). Two parallel definitions of the same list-pools response can drift; if the server encodes the wrapper shape or any future consumer decodes it against the RPC's bare-array schema, decoding fails at runtime. The TokenSchema comment (lines 37-41) indicates an HTTP API also consumes these shapes, so the ambiguity is real.

recommendation:
Pick one contract: either set the RPC success schema to PoolListResponseSchema or delete the unused wrapper schemas (and align TokenListResponseSchema/TokenResponseSchema usage) so the shared package exposes a single shape per operation.

test analysis:
No tests exist, and the server implementation is outside this feature's files, so nothing detects the shape mismatch between the two definitions.

suggested regression test:
Assert that the ListPools RPC success schema is Schema.Array(PoolSchema) (or the wrapper, per chosen contract) and that PoolListResponseSchema is referenced somewhere or removed.

minimum fix scope:
Align rpc.ts success schema with the response schema (or remove the unused wrapper) in packages/shared/src.

## low: Long-lived write-scoped PAT available to scheduled job that rewrites workflow files

id: fnd_sig-feat-config-ee313a6930-ee055_5344d4f236
category: security
confidence: medium
triage: risk
status: open
feature: Shell/workflow config renovate.yml (feat_config_ee313a6930)

evidence:
- .github/workflows/renovate.yml:44-57

The job injects secrets.RENOVATE_TOKEN, a long-lived fine-grained PAT with Contents, Pull requests, and Workflows read/write scopes (per the comments at lines 44-49), into a scheduled job running the Renovate container. The Workflows write scope exists specifically so the github-actions manager can rewrite .github/workflows/*.yml. Consequently, any malicious or compromised update that lands via a merged Renovate PR (e.g., a supply-chain-compromised dependency whose update PR includes a workflow rewrite, or a tampered renovate.json) executes on the next scheduled run with the PAT present in the environment, enabling CI tampering and token exfiltration. Pinned action/container SHAs and required human PR review mitigate but do not eliminate this risk; a rotated or more narrowly scoped credential would reduce the blast radius.

recommendation:
Rotate RENOVATE_TOKEN regularly and scope it to the minimum (Contents and Pull requests write); consider dropping the Workflows write scope by disabling or narrowly constraining the github-actions manager, or use a GitHub App installation token with expiring, per-repo credentials; keep postUpgradeTasks disabled in renovate.json; treat any Renovate PR touching .github/ as high-risk and review diffs carefully.

test analysis:
No tests exist for this workflow's secret handling; this is a configuration-level security posture issue that CI tests cannot exercise without the real PAT.

minimum fix scope:
.github/workflows/renovate.yml (and renovate.json if the github-actions manager scope is reduced)

## low: MEV_PROTECTION_MODE=private with any non-empty PRIVATE_TX_RELAY_URL claims private routing that the middleware cannot provide

id: fnd_sig-feat-library-7f7e3c5382-14b2_24e507d795
category: security
confidence: medium
triage: risk
status: open
feature: Node source apps/api/src/middleware (feat_library_7f7e3c5382)

evidence:
- apps/api/src/middleware/mev-protection.ts:60-66
- apps/api/src/middleware/mev-protection.ts:77-80

The docstring states a server-side signing key / relayer does not exist yet and that this middleware is the future wiring point ('Until a server-side signing key / relayer exists this mode DEGRADES to client'). The degrade guard, however, only checks whether PRIVATE_TX_RELAY_URL is null — it does not verify any relayer capability. If an operator sets the env var to any non-empty value (placeholder, dead endpoint, generic relay), the middleware reports X-MEV-Protection: private and X-MEV-Relay: configured on responses while no private submission can occur, producing a false security assurance (transactions may still be broadcast publicly, defeating sandwich protection) and a misleading audit signal. The included test 'reports a configured private relay' codifies the overclaim by asserting the header, so the gap is in the config guard, not the header logic.

recommendation:
Gate private mode on an actual relayer capability (e.g., a signing key binding or a health-checked relay client); degrade to client with a warning unless the relayer is confirmed available, and only emit the private/configured headers when submission through the relay is actually performed.

test analysis:
mev-protection.test.ts asserts the current intended behavior (headers claim private/configured when the URL is set, lines 82-92) and does not verify that any private submission occurs or that the URL is usable.

suggested regression test:
Configure MEV_PROTECTION_MODE=private with a placeholder/unreachable relay URL and assert the effective mode degrades to client (no X-MEV-Relay header) until relayer capability is confirmed.

minimum fix scope:
apps/api/src/middleware/mev-protection.ts private-mode config gating (lines 60-66)

repro:
Set MEV_PROTECTION_MODE=private and PRIVATE_TX_RELAY_URL to any non-empty string, issue a /build request, and observe X-MEV-Protection: private / X-MEV-Relay: configured with no relay submission code in the middleware.

## low: No automated verification that the build script produces a valid dist artifact

id: fnd_sig-feat-release-fa18bd5381-29cc_0c2ecb1f0c
category: test-gap
confidence: medium
triage: test-gap
status: open
feature: Package script build (@aetherdex/web) (feat_release_fa18bd5381)

evidence:
- apps/web/package.json:8 (build)

The feature declares `tests: []`. The build script chains two external CLIs (`tsr generate` from @tanstack/router-cli and `vite build`) whose success depends on configuration files (tsr config, vite config, plugin wiring) not visible here. Nothing in the owned file or test configuration guarantees the route tree is generated or that `dist/` is emitted; a regression such as a missing tsr config or an incompatible router-cli version would only surface when a human runs the script manually.

recommendation:
Add a CI job (or a vitest test spawning the script) that runs `bun run build` and asserts the output artifact exists (`dist/index.html`, generated route tree file), so the release feature is exercised on every change.

test analysis:
The test scripts (lines 11-15) run vitest/playwright unit and e2e suites, which do not execute the build script or check its output artifact.

suggested regression test:
A test/CI step that runs `bun run build` and asserts `dist/index.html` exists and the generated route tree file is present after `tsr generate`.

minimum fix scope:
CI configuration or a new test file invoking the build script

## low: No automated verification that the typecheck script executes successfully

id: fnd_sig-feat-release-a235aa99b1-5f53_916f0a20bf
category: test-gap
confidence: medium
triage: test-gap
status: open
feature: Package script typecheck (feat_release_a235aa99b1)

evidence:
- package.json:15 (scripts.typecheck)

The typecheck script depends on the `tsc` binary resolving through node_modules/.bin (devDependency typescript ^7.0.2) and on a root tsconfig.json existing at the repository root, but nothing in the reviewed file set executes or asserts the script. A broken invocation (missing tsconfig, TypeScript 7 CLI incompatibility, PATH resolution failure) would surface only when a human runs the command, and the feature ships with an empty tests list.

recommendation:
Add a CI step or test that runs `bun run typecheck` on a clean tree and asserts exit code 0, so regressions in the script itself (not just in the code it checks) are caught automatically.

test analysis:
feature.tests is empty and no CI configuration is included in the reviewed files; the script's own executability is currently unverified.

suggested regression test:
A vitest test that spawns `bun run typecheck` (cwd = repo root) and asserts exit code 0 on a clean tree and non-zero when a temp file with a type error is added to the tsconfig include set.

minimum fix scope:
package.json

## low: No CI validation of workflow YAML/expressions; breakage surfaces only at the weekly scheduled run

id: fnd_sig-feat-config-ee313a6930-a190d_4052e3eab0
category: test-gap
confidence: medium
triage: test-gap
status: open
feature: Shell/workflow config renovate.yml (feat_config_ee313a6930)

evidence:
- .github/workflows/renovate.yml:6-8
- .github/workflows/renovate.yml:35-61

This workflow is triggered only by schedule (weekly, line 8) and manual dispatch, and no failure notification is configured. The project's lint/typecheck/test commands (bun/eslint/vitest) do not cover GitHub Actions YAML, so a syntax error, invalid expression, or a typo in the workflow or in the referenced renovate.json would go undetected for up to a week and be noticed only if a human tracks the Monday run. An actionlint (or YAML-parse) step in CI would catch most of these at PR time.

recommendation:
Add an actionlint check for .github/workflows/*.yml to CI (or extend the lint command), and configure a notification (status badge, scheduled-failure issue, or workflow dispatch fallback) so a missing weekly run is surfaced promptly.

test analysis:
The existing typecheck/lint/format/test commands are JavaScript-oriented and do not parse GitHub Actions YAML, and the workflow itself has no self-validation step.

suggested regression test:
CI step running actionlint on .github/workflows/renovate.yml for PRs touching .github/

minimum fix scope:
CI configuration (outside included files)

## low: No job-level timeouts: hung or unbounded steps can block the required ci-status gate for up to 6 hours

id: fnd_sig-feat-config-902602e3e1-a40dd_5bd1745852
category: maintainability
confidence: medium
triage: risk
status: open
feature: Shell/workflow config ci.yml (feat_config_902602e3e1)

evidence:
- .github/workflows/ci.yml:441-443
- .github/workflows/ci.yml:535-539

No job sets timeout-minutes, so every job inherits GitHub's 360-minute default. The weekly scheduled echidna fuzzing job (line 441) is effectively unbounded (corpus dir is /tmp, so each run starts fresh; fuzzing has no workflow-level bound), and the required ci-status job (line 535) waits for all needed jobs with `always()`. A hung pip/forge/echidna step burns runner minutes and delays the required status gate for PRs/merges with no upper bound, and a stuck scheduled fuzz run holds a runner for hours.

recommendation:
Set timeout-minutes per job (e.g., 15-30 min for quality/backend/frontend, 45-60 min for contracts and e2e, 90-120 min for echidna) and enforce fuzzing limits via the echidna.yaml config (testLimit/timeout) as well.

test analysis:
Job timing is static workflow YAML and is not exercised by any test suite; there is no CI-level check that jobs declare timeouts.

suggested regression test:
A lint-style check (e.g., a small script) that parses the workflow and fails if any job lacks timeout-minutes.

minimum fix scope:
Add timeout-minutes to each job in .github/workflows/ci.yml.

## low: No test coverage for the db query/schema module despite full vitest infrastructure

id: fnd_sig-feat-service-1e40670be0-97ba_a6f98ca79f
category: test-gap
confidence: medium
triage: test-gap
status: open
feature: Node source apps/api/src/db (feat_service_1e40670be0)

evidence:
- apps/api/src/db/queries.ts:1-255
- apps/api/package.json:15-21

The feature reports tests: [] and no test files are included for apps/api/src/db. The project wires vitest with @cloudflare/vitest-pool-workers and @effect/vitest (apps/api/package.json devDependencies), but the query helpers and row converters are entirely unexercised. The nonce-persistence defect in upsertUser and the non-monotonic cursor write in setIndexerCursor would both be caught by basic unit tests, and the rowTo* converters cast untrusted SQL values (e.g. Boolean(row.is_verified), row.protocol === 'v3' ? 'v3' : 'v4') with no tests pinning their behavior.

recommendation:
Add unit tests using @cloudflare/vitest-pool-workers with an in-memory D1 (or a mocked SqlClient) covering upsertUser, setIndexerCursor, insertTransaction vs recordSwap conflict behavior, the updateLiquidityPosition miss path, and the rowTo* converters' handling of null/0/1 values.

test analysis:
This is the gap itself: no tests exist for this module, so every finding above is unguarded.

suggested regression test:
A vitest suite that applies the D1 migration to an in-memory database and runs each exported query helper twice (second run exercising conflict/upsert paths) with assertions on returned and persisted state.

minimum fix scope:
New test file under apps/api/test covering apps/api/src/db

## low: No tests cover app bootstrap, env validation, or wallet-provider wiring

id: fnd_sig-feat-library-782a776077-c94e_6f48f0a2be
category: test-gap
confidence: medium
triage: test-gap
status: open
feature: Node source apps/web/src (feat_library_782a776077)

evidence:
- apps/web/src/wagmi.tsx:8-11
- apps/web/src/main.tsx:29-36
- apps/web/package.json:11

The feature owns the entire app entry path — env validation, Wagmi/AppKit adapter construction, QueryClient defaults, and the root render — yet links no tests (tests: []) and none of the included files reference test modules. These are the highest-blast-radius lines in the app: a regression here (e.g., a provider mis-ordering or a removed env check) blanks the whole UI. Note also that `vitest run` is configured (package.json line 11) and happy-dom is present, so the bootstrap is testable; wagmi.tsx's module-scope side effects and throw make it awkward to test, which likely explains the gap.

recommendation:
Add a render test asserting AppKitProvider/QueryClientProvider/RouterProvider mount without crashing (with VITE_REOWN_PROJECT_ID stubbed), and a config test asserting the queryClient defaults (staleTime 60000, refetchOnWindowFocus false) and the env-var guard behavior.

test analysis:
The feature metadata lists no tests, and the module-scope throw in wagmi.tsx actively discourages importing it in test setups without env setup, so the entry path is untested.

suggested regression test:
A vitest + testing-library test that stubs import.meta.env.VITE_REOWN_PROJECT_ID, renders <AppKitProvider>, and asserts the provider tree mounts and exposes a wagmi config.

minimum fix scope:
apps/web/src (add test files; no production code change required)

## low: No tests exist for the Button component

id: fnd_sig-feat-ui-flow-be6bf02bc2-5c60_ade41f4720
category: test-gap
confidence: medium
triage: test-gap
status: open
feature: React component Button (feat_ui-flow_be6bf02bc2)

evidence:
- apps/web/src/components/ui/Button.tsx:1-39 (Button)
- apps/web/package.json:11-13
- apps/web/package.json:49-51

The component implements non-trivial behavior: variant/size class mapping, fullWidth, a loading state that both disables the button and renders a spinner, and className merging. The feature metadata lists zero tests, and the included files contain no test suite for this component, even though the workspace is fully equipped for it (vitest run script at package.json lines 11-13, @testing-library/react, @testing-library/jest-dom, and @testing-library/user-event in devDependencies at lines 49-51). Without tests, regressions such as the loading state failing to disable clicks or variant classes being dropped are unguarded.

recommendation:
Add a Vitest + Testing Library suite for Button covering: default variant/size classes, className merge, fullWidth adding w-full, loading rendering the spinner and setting disabled, and click not firing while loading.

test analysis:
No test files for Button exist in the repository's included evidence; the tests array in the feature metadata is empty.

suggested regression test:
A test asserting that when loading=true the rendered button has the disabled attribute and its onClick handler is not invoked, plus a test asserting the default className contains btn btn-primary btn-md.

minimum fix scope:
apps/web/src/components/ui/Button.tsx

## low: No unit tests for the Card component family

id: fnd_sig-feat-ui-flow-f49a6c4ae7-e297_d7dc0c91c5
category: test-gap
confidence: medium
triage: test-gap
status: open
feature: React component Card (feat_ui-flow_f49a6c4ae7)

evidence:
- apps/web/src/components/ui/Card.tsx:9-54 (Card)
- apps/web/package.json:11-13

The feature metadata reports tests: [] and no test files were included for these components, even though the workspace is fully equipped with vitest and @testing-library/react (package.json lines 11-13 and 49-51). The components encode non-trivial styling contracts — class composition order, default `bordered=true`, variant handling, and className merging with `.trim()` — that can regress silently. The dead "bordered" variant described above is a concrete example of a defect that a component test would have caught.

recommendation:
Add a vitest + @testing-library/react test file (e.g., apps/web/src/components/ui/Card.test.tsx) covering: base class emission ("card bg-base-200"), border class toggling via the `bordered` prop, variant class emission, custom className merging/appending, and HTML attribute passthrough via ...rest for Card, CardBody, CardTitle, and CardActions.

test analysis:
No tests exist for this feature — the feature metadata lists tests: [] and none of the included files reference a Card test.

suggested regression test:
Render <Card bordered={false} variant="compact" className="custom" data-testid="card" /> and assert the rendered div has class "card bg-base-200 card-compact custom" and the data-testid attribute is passed through.

minimum fix scope:
New test file only; no production code changes required.

## low: Non-reproducible bun canary dist-tag in packageManager

id: fnd_sig-feat-library-f8bf0b65a1-2feb_b5b8453948
category: build-release
confidence: medium
triage: risk
status: open
feature: Node source src (feat_library_f8bf0b65a1)

evidence:
- package.json:40

package.json pins "packageManager": "bun@canary", which references a mutable dist-tag rather than an exact version. Canary releases change over time, so bun install, CI, and local environments can resolve different bun versions across runs, making builds non-reproducible and allowing toolchain drift to break scripts (dev/build/test/typecheck) without any dependency change. A non-semver dist-tag is also not a valid packageManager value for corepack-compatible tooling, which expects an exact version like bun@1.4.0, so version managers may reject or ignore the field. The engines.bun constraint (>=1.4.0, line 37) does not pin a specific version either, so it does not mitigate the drift. No other issues were found: src/index.ts is a two-line placeholder with no logic, and the package.json scripts contain no captured-output/fallback shell patterns of the kind flagged in the workflow rules.

recommendation:
Pin the package manager to a stable exact version, e.g. "packageManager": "bun@1.4.0" (matching engines.bun), or if canary is genuinely required, pin a specific canary version/commit so resolution is deterministic. Optionally add a CI check that verifies the packageManager field matches /^bun@\d+\.\d+\.\d+$/.

test analysis:
There are no tests for this feature (the owned file is a placeholder), and unit tests would not exercise package manager version resolution; only a CI/version-manager step would.

suggested regression test:
A CI step asserting the packageManager field in package.json matches an exact semver (e.g. bun@<version>) rather than a dist-tag, failing on mutable tags like canary.

minimum fix scope:
package.json line 40

## low: Package exports raw TypeScript source with no build step

id: fnd_sig-feat-library-b3899aac05-8905_71d32496fb
category: build-release
confidence: medium
triage: risk
status: open
feature: Node package @aetherdex/shared (feat_library_b3899aac05)

evidence:
- packages/shared/package.json:6-10

main and exports both resolve to the raw TypeScript file src/index.ts, and the package has no build/compile script or dist output. This works only because the package is private and consumed by workspace tooling plus runtimes that strip types (bun, node >= 24 per engines), but any consumer that resolves the package without TS support (plain Node < 24, packaging tools that read main) will fail at import time; it is also a latent hazard if private is ever removed for publication.

recommendation:
Either keep private:true and document the workspace-only TS-source contract explicitly, or add a build step that emits dist/ with proper exports/types conditions (with a files allowlist) before any publication is considered.

test analysis:
This is a packaging/tooling hazard not exercised by the current lint/typecheck scripts, and there are no tests or CI packaging steps in the package.

minimum fix scope:
packages/shared/package.json

## low: packageManager pinned to bun@canary undermines reproducibility of all scripts

id: fnd_sig-feat-release-a235aa99b1-d5a0_96c17bce0b
category: build-release
confidence: medium
triage: risk
status: open
feature: Package script typecheck (feat_release_a235aa99b1)

evidence:
- package.json:40 (packageManager)

`packageManager: "bun@canary"` tracks a moving canary channel rather than a stable release. Every `bun run` invocation — including typecheck, dev, build, test, and the deploy scripts — can silently execute on a different runtime version over time, producing non-reproducible typecheck results and deployment artifacts. Canary builds are by definition pre-stable, so a canary regression can break the typecheck (or deploy) pipeline with no change to the repo.

recommendation:
Pin packageManager to a stable bun release (e.g., `bun@1.x.y`) that satisfies the engines.bun `>=1.4.0` constraint, and reserve canary for CI jobs that explicitly test new features.

test analysis:
No tests or CI files in the reviewed set verify the resolved toolchain version or its stability.

suggested regression test:
A CI check that runs `bun --version` and asserts it matches the pinned packageManager version string.

minimum fix scope:
package.json

## low: packages/shared defines no test script even though it hosts the shared API contract

id: fnd_sig-feat-release-d0eb442a0a-1b8f_e8ba33cd22
category: test-gap
confidence: medium
triage: test-gap
status: open
feature: Package script typecheck (@aetherdex/shared) (feat_release_d0eb442a0a)

evidence:
- packages/shared/package.json:11-15

The scripts block defines only typecheck, lint, and lint:fix; there is no `test` script and no test-runner devDependency (e.g., vitest) in this package, despite the package description identifying it as the 'Shared typed API contract (RpcGroup + Schemas)' and the project detecting vitest as a framework. If the project-level `bun run test` aggregates workspaces, this package either fails the aggregation or is silently skipped, leaving the API contract (the most cross-cutting, bug-prone code) with no executable test entry point.

recommendation:
Add a `test` script (e.g., `"test": "vitest run"`) with vitest in devDependencies, add at least smoke/round-trip tests for the exported RpcGroup and schemas, and confirm the root test command covers this workspace.

test analysis:
The feature's tests array is empty and the owned file contains no test script or test dependencies, so nothing currently exercises this package's behavior.

suggested regression test:
A vitest smoke test that imports the package entrypoint (src/index.ts) and asserts the exported RpcGroup/schemas are constructible and serializable per their declared contracts.

minimum fix scope:
packages/shared/package.json (add test script and vitest devDependency)

## low: passWithNoTests: true can silently mask zero executed tests in CI

id: fnd_sig-feat-config-57f59ddd1e-e5e6d_4f9a121ec6
category: test-gap
confidence: medium
triage: test-gap
status: open
feature: Project config vitest.config.ts (feat_config_57f59ddd1e)

evidence:
- vitest.config.ts:5-6

The config sets passWithNoTests: true while restricting execution to a single projects entry ("./apps/web"). If the project directory ever contains no matching test files — e.g., tests are accidentally deleted, the path is later renamed, or new packages are added without tests — vitest exits 0 with zero tests executed and CI reports green. This masks regressions where the suite stops running entirely, making the test gate unreliable. The risk is compounded by the hardcoded single-project list, which gives no coverage of any other test locations in the repo. This is a deliberate config choice rather than a defect, so confidence is medium and severity is low, but the CI impact (green build with no tests) is concrete for a quality-gate workflow.

recommendation:
Remove passWithNoTests from the shared config, or scope it to local development only (e.g., set it conditionally via an environment variable such as NODE_ENV !== 'production' or via a separate dev-only config override). Additionally, consider a CI assertion that the run executed at least one test (e.g., parse vitest's JSON reporter output and fail if numTotalTests === 0).

test analysis:
vitest.config.ts is the test runner's own configuration; the repository has no test that executes the config and asserts how many tests the suite actually runs, so nothing guards against a silent zero-test pass.

suggested regression test:
A script or CI step that runs `vitest run --reporter=json` and fails if the reported total test count is 0, ensuring the projects entry always resolves to runnable tests.

minimum fix scope:
Remove or conditionally disable the passWithNoTests option in vitest.config.ts.

## low: Pools filter input desynchronizes from the URL filterToken on navigation

id: fnd_sig-feat-library-410ea57829-4fb4_4c8f3cfced
category: bug
confidence: medium
triage: risk
status: open
feature: Node source apps/web/src/routes (feat_library_410ea57829)

evidence:
- apps/web/src/routes/pools.tsx:45-49
- apps/web/src/routes/pools.tsx:71-74
- apps/web/src/routes/__root.tsx:22-28

search is initialized once via useState(filterToken) and never re-synced when the URL search changes. The header 'Pools' link and the 'Back to pools' links navigate with filterToken: '' while the input keeps showing the previously typed token, so the displayed list (unfiltered) contradicts the input value; submitting then silently re-applies the stale filter. Any programmatic navigation to /pools with a different filterToken exhibits the same drift.

recommendation:
Derive the input value from Route.useSearch().filterToken (and update on navigation), or add an effect syncing search state when the URL value changes.

test analysis:
pools.test.tsx tests only the PoolsResults presentational component with static props; no test mounts PoolsIndexPage with router search state.

suggested regression test:
Router-level test: navigate to /pools?filterToken=X, then to /pools, and assert the input clears to match the URL.

minimum fix scope:
apps/web/src/routes/pools.tsx

repro:
Type a token into the filter, click the header 'Pools' link (resets filterToken to ''); the list is unfiltered but the input still shows the old token.

## low: Portfolio fetch race: aborted request's finally clears the pending state and stale cross-account positions remain visible

id: fnd_sig-feat-library-410ea57829-0ff1_044c80eab8
category: concurrency
confidence: medium
triage: risk
status: open
feature: Node source apps/web/src/routes (feat_library_410ea57829)

evidence:
- apps/web/src/routes/portfolio.tsx:80-114
- apps/web/src/routes/positions.tsx:96-137

In PortfolioPage the effect aborts the previous fetch on cleanup but the .finally(() => setIsPending(false)) runs unconditionally for the aborted request. On account switch or refresh, the cleanup abort resolves as a microtask after the new effect has already set isPending(true), so the aborted request's finally flips isPending back to false while the newer request is still in flight. The UI then renders 'ready' with the previous account's positions (or 'empty') until the new response lands. positions.tsx fixed the same pattern with an explicit `active` flag guarding every state write; portfolio.tsx did not. Display-only impact, but it can briefly show one account's positions under another account's session and suppress the loading spinner.

recommendation:
Mirror positions.tsx: add an `active`/`cancelled` flag, guard setPositions/setIsPending in then/catch/finally with it, and clear positions when starting a new request.

test analysis:
The portfolio tests cover only pure helpers (getPortfolioStatus, formatPositionValue) and static render states; the fetch effect with abort semantics is untested.

suggested regression test:
Component test that starts a fetch, unmounts/refetches with a pending promise, resolves the first request after abort, and asserts isPending stays true and positions are not clobbered.

minimum fix scope:
apps/web/src/routes/portfolio.tsx

repro:
Start a slow /users/:address/positions request, switch wallet accounts before it resolves; the spinner disappears and the previous account's positions render until the second request completes.

## low: Post-swap /record request is fire-and-forget: index sync failures are silent and the swap is reported as fully successful

id: fnd_sig-feat-library-410ea57829-23af_d3dd45ae69
category: data-loss
confidence: medium
triage: risk
status: open
feature: Node source apps/web/src/routes (feat_library_410ea57829)

evidence:
- apps/web/src/routes/swap.tsx:150-182

After confirmation the UI flips to 'Swap Confirmed' and the /record POST is sent with only .catch(console.error) — no retry, no user-visible failure, and it is skipped entirely if authToken is missing. Since the portfolio/positions pages source data from this index, a failed or dropped record means a completed on-chain swap never appears in the user's portfolio with no indication anywhere in the UI.

recommendation:
Surface record failures (retry with backoff, or show a non-blocking 'index sync pending' notice with a manual retry), and/or have the indexer reconcile from chain events as a backstop.

test analysis:
No tests exercise the post-confirmation record flow; swap.spec.ts covers only initial page rendering.

suggested regression test:
Unit test the confirmation effect: assert /record is called with the quote payload, and that a failed response triggers a visible retry path rather than silent swallow.

minimum fix scope:
apps/web/src/routes/swap.tsx

repro:
Block the /record endpoint (or expire the auth token) and complete a swap; the page shows 'Swap Confirmed' and resets after 3 seconds, and the swap is absent from the index.

## low: Price-refresh consumer performs unbounded sequential HTTP fetches with no timeout

id: fnd_sig-feat-library-c77821ce5c-72c1_22df6a7253
category: performance
confidence: medium
triage: risk
status: open
feature: Node source apps/api/src/workers (feat_library_c77821ce5c)

evidence:
- apps/api/src/workers/cron-handler.ts:313-318 (refreshTopPools)
- apps/api/src/workers/queue-handler.ts:606-633 (handlePriceRefresh)
- apps/api/src/workers/queue-handler.ts:711-729 (fetchTokenPrice)

`refreshTopPools` sends up to ~100 unique token addresses in a single price-refresh message, and `enqueuePriceRefresh` sends batches of 50; `handlePriceRefresh` then awaits a CoinGecko fetch per token sequentially (plus a hub.fetch per token). With no AbortSignal timeout on the fetch, a slow upstream can push a single message past the worker/queue-consumer time budget, causing the whole batch to fail and retry, compounding the backlog.

recommendation:
Add an AbortSignal timeout to fetchTokenPrice, cap per-message token count, and/or process tokens with bounded concurrency (e.g., batches of 5-10).

test analysis:
No tests cover handlePriceRefresh or fetchTokenPrice.

suggested regression test:
Mock a hanging fetch and assert fetchTokenPrice aborts within a bounded time and handlePriceRefresh continues to the next token.

minimum fix scope:
apps/api/src/workers/queue-handler.ts

## low: PriceService.readD1Price returns updatedAt double-converted to ms for millisecond-stored rows

id: fnd_sig-feat-library-8f5d5fd534-6a76_ecf5f1111f
category: bug
confidence: medium
triage: risk
status: open
feature: Node source apps/api/src/services#1 (feat_library_8f5d5fd534)

evidence:
- apps/api/src/services/price.service.ts:140-148

readD1Price explicitly supports two storage formats: row.updated_at > 1e12 is treated as epoch milliseconds, otherwise seconds (line 140), and the freshness check uses the correctly converted rowUpdatedAtMs. But the PriceData returned on line 147 always sets updatedAt: row.updated_at * 1000. For a row stored in milliseconds this multiplies an ms timestamp by 1000, producing a value ~55,000 years in the future (e.g., 1.7e15 → year 55714). Consumers of PriceData.updatedAt (staleness displays, cache decisions) get a garbage timestamp for ms-stored rows even though the code clearly anticipates that format. Self-written rows use seconds (writeD1Price line 157), so the bug only manifests for rows written by other paths, but the read path explicitly claims to support them.

recommendation:
Return updatedAt: rowUpdatedAtMs (the same normalized value used for the freshness check) instead of row.updated_at * 1000.

test analysis:
No price.service tests are included, and the included tests never construct D1 rows with millisecond timestamps.

suggested regression test:
Test readD1Price with a stub D1 returning updated_at = 1719715200000 (ms) and assert the returned PriceData.updatedAt equals 1719715200000; repeat with a seconds value.

minimum fix scope:
apps/api/src/services/price.service.ts (readD1Price: one-line fix)

## low: PriceTicker crashes on WebSocket frames without tokenAddress

id: fnd_sig-feat-library-d9ae9adbfb-3841_a0d1b91e52
category: bug
confidence: medium
triage: risk
status: open
feature: Node source apps/web/src/components (feat_library_d9ae9adbfb)

evidence:
- apps/web/src/components/PriceTicker.tsx:67-76

The envelope-filtering effect guards payload and typeof payload.price === 'number' but then calls payload.tokenAddress.toLowerCase() unconditionally. The PriceEnvelope/PricePayload types declare data and tokenAddress as optional (lines 6-18), and the component deliberately processes every frame the hub broadcasts (the comment at lines 64-65 says the hub is a shared instance broadcasting all token prices), so a frame lacking tokenAddress — e.g., a future message variant or a partial payload — throws a TypeError inside the effect, which React does not catch and which propagates to the nearest error boundary (there is no evidence of one), unmounting the subtree. The guard exists precisely to tolerate heterogeneous frames, so the missing null check is an oversight.

recommendation:
Add a typeof payload.tokenAddress === 'string' condition to the existing guard (or use optional chaining: payload.tokenAddress?.toLowerCase() === tokenAddress.toLowerCase()) before setData.

test analysis:
There are no PriceTicker tests in the included test files, and the useWebSocket hook is not stubbed anywhere, so the frame-filtering path is entirely untested.

suggested regression test:
Render PriceTicker with a mocked useWebSocket that first emits { type:'price', data:{ price: 1 } } (no tokenAddress) and assert the component does not throw and keeps showing the placeholder price.

minimum fix scope:
apps/web/src/components/PriceTicker.tsx (effect guard, lines 67-76)

repro:
Feed the useWebSocket hook an envelope of the form { type: 'price', data: { price: 1.23 } } (no tokenAddress) and observe an uncaught TypeError in the effect.

## low: Production web app (Pages) deployment is not smoke-tested

id: fnd_sig-feat-config-3a72a27053-fd122_4c18a37f0b
category: test-gap
confidence: medium
triage: test-gap
status: open
feature: Shell/workflow config release.yml (feat_config_3a72a27053)

evidence:
- .github/workflows/release.yml:119-126

The workflow deploys the web app via `bun run web:deploy:production` (lines 119-121) and then smoke-tests only the API (lines 123-126). A Pages deployment that builds but serves a broken app (runtime JS errors, bad env-derived config, wrong asset paths) passes the deploy step and ships to production with no verification that the served origin responds. The smoke tests give zero coverage of the web deployment or of the SIWE_URI origin the app is configured for, so a regression in the web app would only surface to users, after the GitHub release has been created.

recommendation:
After web:deploy:production, add a smoke check that curls the production web origin (e.g., the Pages URL or SIWE_URI) with --fail and asserts a 200 response with expected content, or verify the Pages deployment status via the Cloudflare API before the github-release job runs.

test analysis:
The workflow has a smoke-test step but it is limited to API endpoints; no test file is included for this feature.

suggested regression test:
A workflow step that runs `curl --fail --max-time 30 "$WEB_ORIGIN"` (with the origin derived from the deployed Pages URL or SIWE_URI) and asserts an expected HTTP status/marker after the web deploy step.

minimum fix scope:
Extend the smoke-test step (lines 123-126) to include the web origin, or add a step between the web deploy and github-release jobs.

## low: Protected RPC broadcast has no timeout or abort path; non-JSON 200 bodies throw a raw SyntaxError

id: fnd_sig-feat-library-9f563d7b60-c1e3_6ac007e682
category: bug
confidence: medium
triage: risk
status: open
feature: Node source apps/web/src/lib (feat_library_9f563d7b60)

evidence:
- apps/web/src/lib/protected-submission.ts:9-25 (submitProtectedRawTransaction)

submitProtectedRawTransaction issues fetch with no AbortSignal and no timeout, and the signature offers no way to cancel. If the private RPC accepts the connection but stalls (a common failure mode for private/MEV RPCs under load), the promise never settles: the UI shows a permanently pending broadcast, and any manual retry re-broadcasts blind. Separately, response.json() on a 200 response with a non-JSON body throws an unmapped SyntaxError, unlike the descriptive HTTP-status errors handled on the lines above it.

recommendation:
Wire an abort path (accept an AbortSignal and/or apply AbortSignal.timeout) and convert AbortError into a descriptive error; wrap response.json() so a malformed 200 body yields a clear 'invalid RPC response' error instead of a raw SyntaxError.

test analysis:
protected-submission.test.ts only covers the HTTPS rejection and a single happy-path broadcast returning a JSON result; no stalled-response, abort, or malformed-body cases are tested.

suggested regression test:
Stub fetch with a never-resolving promise and assert the call rejects within a bounded timeout with a descriptive error; also stub a 200 non-JSON body and assert a descriptive parse error rather than SyntaxError.

minimum fix scope:
apps/web/src/lib/protected-submission.ts only.

repro:
Stub fetch to return a promise that never resolves; await submitProtectedRawTransaction(...) — the call hangs indefinitely with no way to abort.

## low: Public quote endpoint fans out to an external RPC with no rate limiting or caching

id: fnd_sig-feat-route-552aaeecba-7afb4f_2b367388f6
category: performance
confidence: medium
triage: risk
status: open
feature: Hono route GET /v3/quote (feat_route_552aaeecba)

evidence:
- apps/api/src/routes/v3-quote.ts:18-23
- apps/api/src/routes/v3-quote.ts:44-58

The handler is fully unauthenticated and contains no rate limiting, per-IP throttling, or caching, and every request constructs a live RPC-backed Effect layer and executes an on-chain quote against the external RPC_URL. Identical quote requests (same tokens/amount/fee) re-hit the RPC on each call. An attacker (or a buggy client retry loop) can trivially amplify load against the configured RPC provider, incurring unbounded provider cost and latency for all users, and can exhaust the Worker's CPU/time limits under sustained traffic since each request performs network I/O plus the quote-engine computation. The trust-boundary metadata itself marks this endpoint as user-input/network-facing.

recommendation:
Add rate limiting (Cloudflare Rate Limiting binding or a Durable Object/KV-based limiter) on this route, and add a short-TTL cache keyed by (tokenIn, tokenOut, amountIn, fee, slippage) so repeated identical quotes are served without RPC fan-out; also consider a maximum URL/query length guard before BigInt parsing.

test analysis:
No tests exist for the route, and rate limiting is an operational property that the included test configuration does not exercise.

suggested regression test:
A test asserting that two consecutive identical requests only invoke the quote service once when a cache is present, and that requests beyond a configured per-IP budget receive 429.

minimum fix scope:
Add a rate-limit binding/check at the top of the handler and a short-TTL cache layer around the service call.

## low: Public submission signs transactions without an explicit chainId (chain: null), losing EIP-155 replay protection

id: fnd_sig-feat-library-b8af523b91-6a09_b36ba96a45
category: security
confidence: medium
triage: risk
status: open
feature: Node source apps/api/src/lib (feat_library_b8af523b91)

evidence:
- apps/api/src/lib/keeper-signer.ts:536-560
- apps/api/src/lib/keeper-signer.ts:455-463

The public-submission path creates the wallet client without a chain (line 536-540) and then calls sendTransaction with chain: null (line 553), with a comment claiming the tx is sent 'on the wallet client's default chain' — but no default chain exists on the client, so the transaction request carries no chainId. With gasPrice supplied (line 559), viem serializes a legacy transaction; a legacy transaction signed without chainId is not EIP-155 protected and is replayable on any chain where the account nonce matches. The private-relay path explicitly signs with the configured chainId (line 456), so the same relayer produces replay-protected txs on one channel and unprotected txs on the other. The existing test (lines 397-412) only asserts the mock receives chain: null and never inspects the chainId of the signed transaction, so this is not covered. Exploitability is limited (replay needs a matching nonce on the target chain), but for a wallet that signs unattended financial transactions the missing replay protection is a real gap.

recommendation:
Create the wallet client with the configured chain (e.g. define a viem chain with the keeper's chainId) or pass chainId explicitly in the sendTransaction call so the signature includes EIP-155 chainId, mirroring the private-relay path (line 456).

test analysis:
The public-submission tests (keeper-signer.test.ts lines 384-443) use a stubbed walletClient that returns a hash without performing real signing, and assert only that chain: null is passed; no test verifies the chainId embedded in the signed transaction.

suggested regression test:
Use a real local account with the public path against a stubbed transport capturing the serialized transaction and assert the raw tx contains the EIP-155 chainId (e.g. re-derive the v value / inspect the serialized fields for the configured chain).

minimum fix scope:
apps/api/src/lib/keeper-signer.ts (supply chainId in public submission) + signing-level regression test

repro:
With KEEPER_ALLOW_PUBLIC_SUBMISSION=true on an EIP-155 chain, walletClient.sendTransaction is called with chain: null and no chainId; the resulting legacy signature omits the EIP-155 chainId.

## low: Redundant coverage providers installed without an explicit provider in test:coverage

id: fnd_sig-feat-test-suite-fba3efc44a-f_4ce361b038
category: maintainability
confidence: medium
triage: risk
status: open
feature: Package script test (@aetherdex/web) (feat_test-suite_fba3efc44a)

evidence:
- apps/web/package.json:13 (test:coverage)
- apps/web/package.json:56-57

devDependencies install both @vitest/coverage-istanbul and @vitest/coverage-v8, while the test:coverage script runs `vitest run --coverage` with no explicit provider and no vitest config file is included. Vitest 4 resolves the provider by installed-package precedence (v8 wins when both are present), so behavior is deterministic today but depends on implicit defaults: a future Vitest version changing default precedence, or a contributor assuming istanbul is used (e.g., for its different instrumentation semantics), would silently change coverage output. The istanbul dependency is also dead weight if v8 is the intended provider. The `test` script itself (line 11) is correct; this is the only ambiguity in the suite's script surface.

recommendation:
Pick one coverage provider, remove the other from devDependencies, and pin it explicitly, e.g. `"test:coverage": "vitest run --coverage.provider=v8"` or declare `coverage.provider` in a vitest config.

test analysis:
This is a package-script/dependency configuration concern; unit tests do not exercise script flags or devDependency resolution.

minimum fix scope:
apps/web/package.json (and optionally a vitest config)

## low: Release version guard relies on a hardcoded package list that can silently drift

id: fnd_sig-feat-config-3a72a27053-746b4_ee982d5663
category: maintainability
confidence: medium
triage: risk
status: open
feature: Shell/workflow config release.yml (feat_config_3a72a27053)

evidence:
- .github/workflows/release.yml:49-54

The version guard's inline Node script hardcodes the four packages whose package.json versions must equal the release tag (lines 49-54). When a new workspace package (apps/ or packages/) is added to the monorepo, it is automatically excluded from the check: the release proceeds even if that package's version mismatches the tag, silently weakening the 'matching package versions' contract enforced by the 'Require a main branch tag with matching package versions' step. Nothing derives the list from the workspace manifest, so the guard's coverage only shrinks as the repo grows.

recommendation:
Derive the package list from the workspace (e.g., enumerate package.json files under apps/ and packages/, or use `bun pm ls`/workspace metadata), or add a CI check that fails when a package.json exists that is not covered by the hardcoded list.

test analysis:
The check runs inline in the workflow and no tests are included for this feature; the drift only manifests at the moment a new package is added, with no test or automation forcing list updates.

suggested regression test:
A test that enumerates all package.json files under apps/ and packages/ and asserts each one appears in the version guard's file list.

minimum fix scope:
Replace the hardcoded array in the inline Node script (lines 49-54) with a workspace-derived list, or add a drift-checking job/step.

## low: renovate-version container pin can silently drift from the action SHA pin

id: fnd_sig-feat-config-ee313a6930-bde45_4cbc0a3c4a
category: maintainability
confidence: medium
triage: risk
status: open
feature: Shell/workflow config renovate.yml (feat_config_ee313a6930)

evidence:
- .github/workflows/renovate.yml:50-56

The wrapper action SHA (line 51) and the container version (line 56) are pinned to the same release (46.1.20) today, but the github-actions manager auto-bumps the action SHA on its own while the separate renovate-version: 46.1.20-full value only moves if renovate.json contains a packageRule with the renovateVersion option. renovate.json is not among the included files, so that rule cannot be verified; if it is absent, wrapper and container versions will skew over time, producing subtle wrapper/container behavior mismatches that are hard to diagnose because both pins look intentional.

recommendation:
Add a packageRule in renovate.json matching renovatebot/github-action with the renovateVersion option so renovate-version tracks the action version in lockstep (verify the rule exists before assuming drift is handled); otherwise document a manual bump procedure for both pins.

test analysis:
No tests cover synchronization between the action SHA and the renovate-version input; drift is only observable at the next scheduled run.

minimum fix scope:
renovate.json (add renovateVersion packageRule) - outside included files, so verify current contents first

## low: Root typecheck excludes apps/** so the documented typecheck gate does not validate application code

id: fnd_sig-feat-library-b4cb74367c-6d35_6a262b8880
category: test-gap
confidence: medium
triage: test-gap
status: open
feature: Node package aetherdex (feat_library_b4cb74367c)

evidence:
- tsconfig.json:29
- package.json:15
- AGENTS.md:138

`bun run typecheck` runs `tsc --noEmit -p tsconfig.json`, and tsconfig.json excludes apps/** (line 29) with no include list, so the gate validates only root-level files (src/index.ts placeholder and config files). apps/web and apps/api — the bulk of the codebase — are outside this tsconfig's scope, and package.json exposes no per-workspace typecheck script. Unless CI separately invokes per-app tsc (not visible in the reviewed files), type errors in application code escape the documented typecheck gate that AGENTS.md line 138 presents as the quality command.

recommendation:
Compose per-workspace typecheck into the root script (e.g., `typecheck`: `bun run --filter '*' typecheck` with per-app typecheck scripts, or explicit `tsc -p apps/web` / `tsc -p apps/api` invocations), or wire tsconfig project references so the root gate covers all workspaces.

test analysis:
Typechecking is a build-time gate, not covered by unit tests; the gap only manifests as uncaught type errors in workspace code.

minimum fix scope:
package.json (plus per-workspace tsconfig wiring)

## low: Scheduled CodeQL runs share the concurrency group with push runs and can be cancelled mid-analysis

id: fnd_sig-feat-config-ac74680d99-0bf8f_d2979db294
category: concurrency
confidence: medium
triage: risk
status: open
feature: Shell/workflow config codeql.yml (feat_config_ac74680d99)

evidence:
- .github/workflows/codeql.yml:11-13

For `schedule` events, `github.ref` resolves to the default branch (refs/heads/main), so the concurrency group `CodeQL-refs/heads/main` is identical for the weekly scheduled run and for any push to main. With `cancel-in-progress: true`, a push to main while the Monday 6am scheduled run is in progress cancels the scheduled run before its SARIF results are uploaded, and overlapping scheduled runs cancel each other as well. Impact is limited because push runs re-analyze main, but the weekly schedule's purpose (a reliable, recurring scan independent of push activity) can be silently defeated on active days, and a cancelled run never uploads its results.

recommendation:
Include the event type in the concurrency group key so schedule and push runs do not cancel each other, e.g. `group: ${{ github.workflow }}-${{ github.event_name }}-${{ github.ref }}`, or set `cancel-in-progress: false` (or drop the concurrency block) for the schedule trigger.

test analysis:
The feature declares no tests (tests: []), and GitHub Actions concurrency semantics cannot be exercised by the project's bun-based test/lint commands; this behavior is only observable in live workflow runs.

minimum fix scope:
.github/workflows/codeql.yml lines 11-13 (concurrency group key)

## low: Search query sent to the API untrimmed while the emptiness guard uses trim()

id: fnd_sig-feat-ui-flow-cfc2470a11-3ffa_d6e4d93399
category: bug
confidence: medium
triage: risk
status: open
feature: React component TokenSearch (feat_ui-flow_cfc2470a11)

evidence:
- apps/web/src/components/TokenSearch.tsx:122-127
- apps/web/src/components/TokenSearch.tsx:136

The guard checks searchQuery.trim() (line 123) but the raw searchQuery is passed to isValidAddress (line 131) and to fetchTokens({ query: searchQuery, ... }) (line 136), which serializes it verbatim into the search URL param. Inputs like ' WETH' or 'WETH ' pass the trim guard but fail substring matching on the server (the test mock at lines 55-57 confirms the search is matched raw), so users see a false 'No tokens found' instead of results.

recommendation:
Normalize once: const q = searchQuery.trim() and use q for the emptiness check, isValidAddress, and fetchTokens.

test analysis:
All search tests (lines 98-131, 156-165) type queries without leading/trailing whitespace.

suggested regression test:
Type ' WETH' with a leading space and assert the WETH row appears; repeat with a trailing space.

minimum fix scope:
apps/web/src/components/TokenSearch.tsx

repro:
Open the dropdown and type ' WETH' (leading space) or 'WETH ' (trailing space); the request is sent with the whitespace and returns no matches.

## low: Selected-token logo rendered without the host allowlist check applied to list items

id: fnd_sig-feat-ui-flow-cfc2470a11-5ea2_56806aa997
category: security
confidence: medium
triage: risk
status: open
feature: React component TokenSearch (feat_ui-flow_cfc2470a11)

evidence:
- apps/web/src/components/TokenSearch.tsx:171-177
- apps/web/src/components/TokenSearch.tsx:38-46 (isSafeImageUrl)
- apps/web/src/components/TokenSearch.tsx:54-55

The component deliberately gates list-item logos behind isSafeImageUrl (line 54), which restricts image loads to a small set of https hosts. However, the selected-token button (lines 173-175) renders <img src={selectedToken.logoURI}> with no validation. selectedToken is a parent-supplied prop; a parent persisting a previously selected token (e.g., from storage or route state derived from user input) can carry an arbitrary logoURI, causing the browser to issue a request to an attacker-controlled host (IP disclosure / user fingerprinting) — exactly what the allowlist on list items is meant to prevent.

recommendation:
Apply isSafeImageUrl to selectedToken.logoURI before rendering (fall back to the placeholder/avatar or omit the img), matching the list-item behavior.

test analysis:
The only selected-token test (lines 145-154) uses a token without logoURI, so the unvalidated-img branch is never exercised.

suggested regression test:
Render TokenSearch with a selectedToken whose logoURI points to a disallowed host; assert no <img> element is rendered; assert the img renders for an allowlisted host.

minimum fix scope:
apps/web/src/components/TokenSearch.tsx

repro:
Render <TokenSearch selectedToken={{address:'0x...', symbol:'X', name:'X', decimals:18, logoURI:'https://evil.example/tracker.png'}} /> — the img tag is emitted and fetched without any host check.

## low: Selected-token logo renders without the image-host allowlist used in the results list

id: fnd_sig-feat-library-d9ae9adbfb-173d_92fb073111
category: security
confidence: medium
triage: risk
status: open
feature: Node source apps/web/src/components (feat_library_d9ae9adbfb)

evidence:
- apps/web/src/components/TokenSearch.tsx:171-177
- apps/web/src/components/TokenSearch.tsx:50-62 (TokenListItem)
- apps/web/src/components/TokenSearch.tsx:31-46 (isSafeImageUrl)

TokenListItem guards logo rendering with isSafeImageUrl (lines 54-62), enforcing an https + allowlisted-host policy, and isSafeImageUrl itself rejects anything not in ALLOWED_IMAGE_HOSTS. However, the selected-token summary in the toggle button (lines 173-175) renders token.logoURI directly with no check. A token whose logoURI points at a non-allowlisted host therefore shows the placeholder in the list but fires a request to the arbitrary host once selected (e.g., a tracking beacon). TokenChip.tsx has the same pattern (line 20), so the allowlist is only partially enforced across the picker. Impact is limited to an outbound image request (no script execution), hence low severity.

recommendation:
Render the selected-token logo only when isSafeImageUrl(token.logoURI) is true, mirroring TokenListItem, and apply the same guard in TokenChip.tsx. Consider centralizing logo rendering in a single shared component.

test analysis:
TokenSearch.test.tsx fixtures all use logoUrl: null, so no test exercises a logoURI value, let alone one from a disallowed host.

suggested regression test:
Select a token whose logoURI is 'https://untrusted.example/x.png' and assert the button contains no img element (and that a disallowed-host token still renders the symbol text).

minimum fix scope:
apps/web/src/components/TokenSearch.tsx (button logo) and apps/web/src/components/TokenChip.tsx

repro:
Mock /tokens to return a token with logoURI 'https://evil.example/pixel.png'; open the picker (placeholder shows, no img), select the token, and observe an <img src="https://evil.example/pixel.png"> in the button.

## low: Selection highlight overlay is misaligned with the actual slider track

id: fnd_sig-feat-ui-flow-e6ed457e9a-89c8_d3215deb49
category: bug
confidence: medium
triage: risk
status: open
feature: React component RangeSelector (feat_ui-flow_e6ed457e9a)

evidence:
- apps/web/src/components/RangeSelector.tsx:50-57 (RangeSelector)
- apps/web/src/components/RangeSelector.tsx:58-81 (RangeSelector)
- apps/web/src/components/RangeSelector.tsx:100-102 (percentage)

The highlight overlay is positioned with left/right as percentages of the full container width (percentage() over [minimum, maximum], lines 53-54, 100-102), while both range inputs are inset by 0.5rem on each side (inset-x-2, lines 60 and 72) and the depth bars use inset-x-3. Because the draggable track spans only [8px, W-8px] but the overlay spans [0, W], the highlight extends beyond the thumb travel range at both window extremes (about 0.5rem plus half the thumb width on each side) and its mapping is offset from the handle positions. The range of motion is 48 spacing steps wide, so the visual discrepancy is small but visible when the selected range sits near the window edges.

recommendation:
Compute the overlay geometry over the track width, e.g. left: calc(0.5rem + <pct> * (100% - 1rem)) and right: calc(0.5rem + (100 - <pct>) * (100% - 1rem)), or apply the same inset-x-2 to the overlay and keep percentages relative to the inset box.

test analysis:
No tests exist for this component, and the geometry is only visible in rendered styles, which no included test asserts.

suggested regression test:
Render with known props and assert the overlay's style.left/right match the input's inset offset at the minimum/maximum handle positions (e.g., overlay left edge equals the input track's left edge when lower === minimum).

minimum fix scope:
Adjust the overlay's left/right style computation in RangeSelector.tsx to account for the input inset.

repro:
Set currentTick such that lowerTick snaps to minimum and upperTick to maximum; the highlight fills the container edge-to-edge while the thumbs stop ~8px inside each edge.

## low: Shared contract built on exact-pinned beta and unstable API surface

id: fnd_sig-feat-library-b3899aac05-8083_3003b67d26
category: maintainability
confidence: medium
triage: risk
status: open
feature: Node package @aetherdex/shared (feat_library_b3899aac05)

evidence:
- packages/shared/package.json:16-18
- packages/shared/src/rpc.ts:1-10 (PoolsRpcGroup)

The package depends on effect pinned to the exact beta 4.0.0-beta.100 and imports Rpc/RpcGroup from the explicitly unstable 'effect/unstable/rpc' module. Since this package defines the cross-service RPC contract, a beta bump that changes the RPC API shape (RpcGroup/Rpc.make signatures or schema encodings) can break every consumer with no guard, and the exact pin gives false confidence of stability.

recommendation:
Track effect releases deliberately (upgrade in a dedicated commit, run full-workspace typecheck and decode smoke tests), and consider moving to stable Effect APIs once available; at minimum add a smoke test that constructs the RPC group and round-trips a payload to catch upstream churn.

test analysis:
No tests exist, so upstream beta API changes would only surface via typecheck of downstream packages at upgrade time.

suggested regression test:
A smoke test that builds PoolsRpcGroup and round-trips a ListPools payload through the RPC schema encoders/decoders.

minimum fix scope:
packages/shared (dependency upgrade policy + smoke test)

## low: Silent failure when reconnect attempts are exhausted without an error event

id: fnd_sig-feat-ui-flow-48e197d8fd-11b1_a49dcedb97
category: bug
confidence: medium
triage: risk
status: open
feature: React component PriceTicker (feat_ui-flow_48e197d8fd)

evidence:
- apps/web/src/hooks/useWebSocket.ts:95-110
- apps/web/src/components/PriceTicker.tsx:93-100

state.error is only set in onerror; onclose schedules reconnects without setting any error. If the connection closes cleanly (e.g., server restart or idle close) and attempts run out, error stays undefined, isConnected stays false, and PriceTicker permanently renders "—" with a warning dot — its error branch (line 93) never triggers. The failure is invisible to the user.

recommendation:
Set an error in onclose when reconnectCountRef reaches reconnectAttempts (e.g., "connection lost, max reconnects reached"), and/or expose reconnectCount so consumers can render an exhausted-state message.

test analysis:
No hook or component tests exist; the exhausted-without-error path is untested.

suggested regression test:
Hook test: with reconnectAttempts small and clean closes, assert state.error is set once attempts are exhausted; component test asserting the error UI renders.

minimum fix scope:
apps/web/src/hooks/useWebSocket.ts

repro:
Open the hook with an unreachable-but-cleanly-closing endpoint; after reconnectAttempts closes, state.error is undefined and the component shows a silent dash.

## low: simulatePriceScenarios reports feePercent validation errors under the currentPrice field key

id: fnd_sig-feat-library-9f563d7b60-30b8_97fd272be6
category: bug
confidence: medium
triage: risk
status: open
feature: Node source apps/web/src/lib (feat_library_9f563d7b60)

evidence:
- apps/web/src/lib/playground.ts:217-219 (simulatePriceScenarios)

When feePercent is non-finite or negative, the error 'Fee percent must be zero or positive.' is written into errors.currentPrice. PlaygroundErrors is keyed by PlaygroundField, which has no feePercent key (lines 13-14), so this is the only place the message can be stored — but a UI that renders errors per input will show the fee error under the current-price input while the fee input itself gets no inline error. Every other validation error in the module is stored under the field it describes, so this is an inconsistency; the `??` guard only prevents overwriting a genuine price error, not the misplacement.

recommendation:
Add a dedicated error key for the fee input (e.g., extend PlaygroundField with a feePercent key, or define a separate fee error channel) so the message renders under the fee field; if the field-set limitation is intentional, document the currentPrice attachment and surface the message generically.

test analysis:
playground.test.ts covers invalid ranges and empty positions (lines 186-193) but never passes a negative/non-finite feePercent, so the misattributed error key is unexercised.

suggested regression test:
Call simulatePriceScenarios with feePercent: -1 and assert the returned errors are keyed by a feePercent-dedicated field (once added) rather than currentPrice.

minimum fix scope:
apps/web/src/lib/playground.ts only.

repro:
simulatePriceScenarios({ currentPrice: 2000, lowerPrice: 1500, upperPrice: 2500, amount0: 1, amount1: 1, priceChangesPercent: [0], feePercent: -1 }) returns errors.currentPrice === 'Fee percent must be zero or positive.'.

## low: SIWE auth token persisted in localStorage, readable by any script and never expired client-side

id: fnd_sig-feat-library-67e36e39d1-7eeb_ea85245e93
category: security
confidence: medium
triage: risk
status: open
feature: Node source apps/web/src/hooks (feat_library_67e36e39d1)

evidence:
- apps/web/src/hooks/useSiweAuth.ts:76
- apps/web/src/hooks/useSiweAuth.ts:85
- apps/web/src/hooks/useSiweAuth.ts:96

The verify response token is written to localStorage (line 76) and read back on signOut (line 85). localStorage is accessible to any script running in the page origin, so a single XSS (e.g., via rendered error strings or third-party script) exfiltrates the bearer token; it also survives tab close with no client-side expiry handling, so a leaked token remains usable until server-side invalidation. This is a recognized tradeoff for dapps, but storing in an httpOnly cookie (or sessionStorage with an expiry) would reduce exposure; at minimum the token should carry an expiration checked on read.

recommendation:
Prefer an httpOnly SameSite cookie set by the /auth/verify endpoint; otherwise store the token in sessionStorage with an expiry timestamp and validate it on read, and ensure the server enforces short-lived tokens with refresh/revocation.

test analysis:
No test file exists for useSiweAuth in the included set, and storage behavior is not asserted anywhere.

suggested regression test:
Mock localStorage and assert the token is not readable from localStorage when cookie mode is enabled (or that an expired stored token is treated as unauthenticated).

minimum fix scope:
apps/web/src/hooks/useSiweAuth.ts

## low: SiweNonceDO issue() is not atomic with consume(): a concurrent issue can have its fresh record deleted by an in-flight consume

id: fnd_sig-feat-library-53a6b417c0-33a0_338b8a56dd
category: concurrency
confidence: medium
triage: risk
status: open
feature: Node source apps/api/src/durable-objects (feat_library_53a6b417c0)

evidence:
- apps/api/src/durable-objects/siwe-nonce-do.ts:31-35
- apps/api/src/durable-objects/siwe-nonce-do.ts:37-50

consume() correctly serializes its read-delete-check inside blockConcurrencyWhile (lines 38-48), but issue() (lines 31-35) performs storage.put and setAlarm outside any concurrency block. Because storage operations await, an interleaving is possible: issue's put resolves, then consume's blockConcurrencyWhile runs to completion deleting the record and returning true, then issue's setAlarm resumes — leaving the newly issued nonce deleted (client received 201 with a nonce that can no longer be consumed) and an orphaned alarm. Conversely, a consume that observed 'no record' can race a concurrent issue so the client's consume fails spuriously. The existing tests only cover 8 concurrent consume() calls on a pre-issued nonce, not issue racing consume.

recommendation:
Wrap the issue() body (or at least the put/deleteAlarm/setAlarm sequence) in this.ctx.blockConcurrencyWhile so issue and consume serialize on the same lock, or run consume's block inside blockConcurrencyWhile that also covers setAlarm ordering.

test analysis:
siwe-nonce-do.test.ts tests concurrent consume-only traffic (lines 5-23) and expiry paths, but no test interleaves issue() with consume().

suggested regression test:
Fire issue() and consume() concurrently against the same named instance many times and assert every 201-issued nonce is consumable exactly once.

minimum fix scope:
apps/api/src/durable-objects/siwe-nonce-do.ts

## low: Stat component has no unit tests despite complete Vitest/Testing Library infrastructure

id: fnd_sig-feat-ui-flow-07f3e47ecf-1910_fed0967e15
category: test-gap
confidence: medium
triage: test-gap
status: open
feature: React component Stat (feat_ui-flow_07f3e47ecf)

evidence:
- apps/web/package.json:11-15

The workspace provides vitest, @testing-library/react, happy-dom, and test scripts (package.json lines 11-15), yet the feature's tests array is empty and no test file for Stat.tsx is included. The component encodes non-trivial presentational logic: conditional desc rendering, trend-to-color mapping (text-success/text-error), and className trimming. None of this behavior is pinned by tests, so a future refactor (e.g., changing the daisyUI class names or the trend semantics) could silently regress the UI. Severity is low because the component is small and purely presentational, with no data or security impact.

recommendation:
Add apps/web/src/components/ui/Stat.test.tsx covering: label and value rendering, conditional desc rendering (absent vs present), trend class mapping for up/down/undefined, and default render without trend.

test analysis:
No test file for Stat exists in the included files, and the feature metadata lists zero tests; the package.json test scripts only define how tests would run, not tests for this component.

suggested regression test:
vitest + Testing Library test asserting container.className includes 'stat', value node class toggles between 'text-success' and 'text-error' for trend up/down and is absent otherwise, and desc is not rendered when the prop is omitted.

minimum fix scope:
apps/web/src/components/ui/Stat.tsx

## low: Stat renders label, value, and description as unlabeled sibling divs with no ARIA grouping or association

id: fnd_sig-feat-ui-flow-07f3e47ecf-3c44_d6c325aa2e
category: bug
confidence: medium
triage: risk
status: open
feature: React component Stat (feat_ui-flow_07f3e47ecf)

evidence:
- apps/web/src/components/ui/Stat.tsx:13-17 (Stat)

The component outputs three sibling <div> elements (stat-title, stat-value, stat-desc) with no role, aria-label, or semantic container. The label-to-value association exists only visually via daisyUI classes, so assistive technology announces disconnected text fragments; a screen-reader user cannot tell which value belongs to which label, and trend state is conveyed only via color (text-success/text-error) with no textual or aria indication. The value is also a generic ReactNode with no aria-live, so dynamically updated stats are not announced. This is a concrete, user-facing defect for assistive-technology users, though severity is limited because content is still readable in sequence.

recommendation:
Wrap the content in a container with role="group" and aria-label={label} (or use dl/dt/dd semantics), and add an aria-live region or visually-hidden trend text (e.g., aria-label including 'trending up/down') so the trend is not conveyed by color alone.

test analysis:
No test files exist for this component (feature tests list is empty), and the included code contains no accessibility assertions; only the rendering logic is exercised, if at all.

suggested regression test:
A Testing Library test asserting the stat renders within a role="group" element with an accessible name equal to the label, and that a trend="down" stat includes a non-color-based announcement (aria-label or hidden text).

minimum fix scope:
apps/web/src/components/ui/Stat.tsx

repro:
Render <Stat label="TVL" value="$1.2M" trend="down" /> and inspect the accessibility tree: three bare divs with no grouping, no accessible name, and no announcement of the downward trend.

## low: test:coverage script references a coverage provider not declared in devDependencies

id: fnd_sig-feat-config-7528cb5b98-d8a57_5f15dffaff
category: build-release
confidence: medium
triage: risk
status: open
feature: Project config package.json (feat_config_7528cb5b98)

evidence:
- package.json:11
- package.json:31-35

`vitest run --coverage` in vitest 4 requires a coverage provider package (`@vitest/coverage-v8` or `@vitest/coverage-istanbul`) to be installed. The root devDependencies (lines 31-35) list only `vitest`, `typescript`, and `@biomejs/biome`. When run from the repo root, vitest resolves the provider from the root, so `bun run test:coverage` will exit with a missing-provider error unless a workspace happens to hoist the provider into root node_modules. This breaks a quality-gate command that CI would rely on.

recommendation:
Add `@vitest/coverage-v8` (matching the vitest 4 major) to the root devDependencies.

test analysis:
No tests are included for this feature, and the failure occurs at script-invocation time, outside the coverage suite itself (the coverage run never starts).

suggested regression test:
A config-validation test asserting that when a `test:coverage` script exists, a matching `@vitest/coverage-*` provider is present in devDependencies.

minimum fix scope:
package.json devDependencies

## low: ThemeToggle reads/writes localStorage unguarded and applies stored theme only after first paint

id: fnd_sig-feat-library-d9ae9adbfb-56ca_feee8f963e
category: bug
confidence: medium
triage: risk
status: open
feature: Node source apps/web/src/components (feat_library_d9ae9adbfb)

evidence:
- apps/web/src/components/ThemeToggle.tsx:8-25

Two issues in one small component: (1) The initial state is hardcoded to 'aetherdex' and the stored theme is applied in a passive useEffect, so a user whose stored theme is 'light' sees a flash of the dark theme on every page load (FOUC). (2) localStorage.getItem (line 11) and localStorage.setItem (line 24) are not wrapped in try/catch; in browsers where storage is blocked (Safari private mode, storage-disabled contexts), the getItem call throws SecurityError/QuotaExceededError from inside the effect, which crashes the React tree if no error boundary exists. The tests always stub localStorage with a working mock, so neither failure mode is exercised.

recommendation:
Read the stored theme synchronously in the useState initializer (with try/catch around getItem) and apply the data-theme attribute in the same render, or use useLayoutEffect; wrap both getItem and setItem in try/catch with a sensible fallback so storage failures degrade gracefully instead of crashing.

test analysis:
ThemeToggle.test.tsx stubs localStorage with a permissive Map-based mock (lines 8-23) and asserts post-mount behavior only; it never simulates storage throwing and cannot observe pre-effect paint.

suggested regression test:
A test where the localStorage mock's getItem throws, asserting the component still renders with data-theme='aetherdex'; plus a test asserting data-theme equals the stored value on the very first render (initializer-based, no effect).

minimum fix scope:
apps/web/src/components/ThemeToggle.tsx

repro:
Set localStorage['aetherdex-theme']='light', reload the page: first paint is 'aetherdex' before flipping to 'light'. Alternatively, make localStorage.getItem throw and observe the effect error propagate.

## low: tokenAddress and theme are interpolated into the iframe src without validation or URL encoding

id: fnd_sig-feat-ui-flow-5e1863c145-56e3_96e35ba4b4
category: security
confidence: medium
triage: risk
status: open
feature: React component DexScreenerChart (feat_ui-flow_5e1863c145)

evidence:
- apps/web/src/components/DexScreenerChart.tsx:28 (DexScreenerChart)
- apps/web/src/components/DexScreenerChart.tsx:34 (DexScreenerChart)

The iframe src is built with a raw template literal: tokenAddress (a caller-supplied value under the user-input trust boundary) and theme (a runtime-unchecked string despite the TS union) are embedded without encodeURIComponent or any address-shape validation. A tokenAddress containing characters like ?, #, &, or / can inject query parameters or alter the path of the dexscreener.com URL, and a non-address string renders a broken embed. The impact is confined to the third-party iframe URL and the escaped title attribute (no parent-origin script execution), so this is low severity, but it makes the embed contract fragile and trivially misusable — e.g., a caller passing an already-encoded address or a non-EVM identifier gets a silently broken chart.

recommendation:
Validate tokenAddress as an EVM address (all mapped chains are EVM; e.g., /^0x[a-fA-F0-9]{40}$/) and encode interpolated values with encodeURIComponent, or reject invalid input by rendering an error state instead of an iframe.

test analysis:
No tests exist for this component (tests array is empty), so URL construction with adversarial or malformed inputs is never exercised.

suggested regression test:
Render with tokenAddress containing '?', '#', '&', and '/' characters and assert the iframe src is either rejected (error state) or properly encoded so no parameter injection occurs.

minimum fix scope:
apps/web/src/components/DexScreenerChart.tsx

repro:
Render <DexScreenerChart tokenAddress="0xabc?embed=0&theme=light" /> and observe the generated src contains injected query parameters that override the component's own embed/theme params.

## low: tokenAddress interpolated into fetch URL without encoding or validation

id: fnd_sig-feat-ui-flow-96f77c54e9-5629_fd2108b273
category: security
confidence: medium
triage: risk
status: open
feature: React component PoolStats (feat_ui-flow_96f77c54e9)

evidence:
- apps/web/src/components/PoolStats.tsx:42 (PoolStats)
- apps/web/src/lib/address.ts:8-14 (isValidAddress)

The queryFn builds the DexScreener URL by template-interpolating `tokenAddress` (line 42). The component never validates the prop, even though `isValidAddress` is available in apps/web/src/lib/address.ts and the feature's declared trust boundaries include user-input. A non-address value containing `/`, `?`, `#`, or `%` (e.g., from a user-supplied search field upstream) alters the request path or query against the API, producing malformed requests and confusing error states. The host is fixed so impact is limited to request-shaping rather than SSRF or data exfiltration, but encoding the input is the standard defense and also guards against accidental breakage from input with special characters.

recommendation:
Encode the address with encodeURIComponent(tokenAddress) when building the URL, and/or gate the query with `enabled: isValidAddress(tokenAddress)` (or reject invalid addresses in the parent) so malformed input never reaches the network layer.

test analysis:
No component tests exist; the URL construction path is untested.

suggested regression test:
Test that a tokenAddress containing URL-special characters is percent-encoded in the fetch call (assert on the requested URL via a stubbed fetch).

minimum fix scope:
Wrap tokenAddress in encodeURIComponent at line 42, or add an `enabled` guard to the useQuery call.

repro:
Render PoolStats with tokenAddress='0xabc/def?x=1'; the fetch hits a different endpoint than intended and the component shows the empty state.

## low: TP/SL order id parsing via Number.parseInt accepts malformed ids and loses precision for large uint256 order ids

id: fnd_sig-feat-library-09141f3ef9-cb39_b6dc8e5f62
category: bug
confidence: medium
triage: risk
status: open
feature: Node source apps/api/src/routes (feat_library_09141f3ef9)

evidence:
- apps/api/src/routes/tp-sl.ts:262-265
- apps/api/src/routes/tp-sl.ts:288-291

GET /orders/:id and DELETE /orders/:id parse the path param with Number.parseInt, which (a) silently accepts trailing garbage (id=12abc resolves order 12) and (b) loses precision for values above 2^53. Order ids originate on-chain as uint256 (eventArgs.orderId) and are stored as strings (onchainOrderId), so an order whose id exceeds Number.MAX_SAFE_INTEGER cannot be fetched or cancelled reliably because the numeric id resolves to a different row. The route already has strict digit-only patterns (uintPattern) available for validation.

recommendation:
Validate the param with /^[0-9]+$/ and keep the id as a decimal string (or BigInt) end-to-end instead of converting through Number.

test analysis:
No TP/SL route tests exist; only the price-guard helper is tested.

suggested regression test:
Test that /orders/12abc returns 400 and that an id > 2^53 round-trips through getOrder/cancelOrder without precision loss.

minimum fix scope:
apps/api/src/routes/tp-sl.ts GET /orders/:id and DELETE /orders/:id handlers.

repro:
DELETE /api/v1/tp-sl/orders/12abc deletes order 12 instead of rejecting; an order with id 9007199254740993 resolves to 9007199254740992.

## low: Type-unsafe casts mask a @wagmi/core v2/v3 adapter mismatch, defeating typecheck coverage

id: fnd_sig-feat-library-782a776077-928b_9cde6d15b7
category: maintainability
confidence: medium
triage: risk
status: open
feature: Node source apps/web/src (feat_library_782a776077)

evidence:
- apps/web/src/wagmi.tsx:25-27
- apps/web/src/wagmi.tsx:31-32
- apps/web/package.json:23-24
- apps/web/package.json:34
- apps/web/package.json:42

The project depends on wagmi ^3.7.3 and @wagmi/core ^3.6.3, while @reown/appkit-adapter-wagmi ^1.8.22 is (per the code comment) compiled against @wagmi/core v2 types. `wagmiAdapter.wagmiConfig as unknown as Config` and `adapters: [wagmiAdapter as any]` (with a biome-ignore) deliberately erase all type information at the exact seam where a v2/v3 API mismatch would surface. The comment asserts runtime compatibility, so this is not a proven bug, but the casts mean `bun run typecheck` cannot detect a future breaking change in either package's major-version API, and the same pattern is repeated for the `networks` tuple cast (lines 13-16). When either dependency is upgraded, the mismatch will fail at runtime instead of at typecheck.

recommendation:
Prefer depending on an @reown/appkit-adapter-wagmi version built against @wagmi/core v3 (or pin @wagmi/core to the adapter's expected major) so the casts can be removed; if the casts must stay, isolate them in one typed wrapper module with a comment and a smoke test that constructs the adapter and config.

test analysis:
No tests exist for this feature, and unit tests using happy-dom would not exercise the adapter's real runtime integration with wagmi v3; the mismatch is only detectable in a browser E2E test.

suggested regression test:
A Playwright smoke test that mounts AppKitProvider and asserts the WagmiProvider renders and `config` exposes the expected chain/account state, catching a v2/v3 runtime contract break.

minimum fix scope:
apps/web/src/wagmi.tsx (align dependency majors or centralize the casts)

## low: Typecheck types against @types/node 26 while engines allow Node 24, so the gate can pass code that crashes on the minimum supported runtime

id: fnd_sig-feat-release-a568f2a731-433e_af1fbc7337
category: maintainability
confidence: medium
triage: risk
status: open
feature: Package script typecheck (@aetherdex/web) (feat_release_a568f2a731)

evidence:
- apps/web/package.json:52
- apps/web/package.json:68-71

The engines field (lines 68-71) declares `node >=24.0.0`, meaning Node 24 is a supported minimum runtime, but devDependencies pin `@types/node: ^26.1.1` (line 52). The typecheck script (line 16) therefore validates code against Node 26 API surface: code using Node 25/26-only globals or APIs typechecks cleanly yet fails or behaves differently on Node 24. The typecheck gate silently overstates the compatibility it guarantees for the declared runtime floor.

recommendation:
Align @types/node with the minimum declared engine (e.g. `@types/node: ^24` if Node 24 is the floor) or raise the engines minimum to Node 26; optionally add a CI job that runs typecheck on the lowest supported Node version.

test analysis:
No tests are included for this feature, and unit tests run under the developer's local Node version, so the mismatch between the type-level Node version and the engines floor is never exercised.

suggested regression test:
A CI job running `bun run typecheck` (and `bun run test`) on Node 24.x with the current @types/node 26 would not fail deterministically without a Node 26-only API usage; more directly, a script asserting `@types/node` major matches the engines minimum.

minimum fix scope:
apps/web/package.json: change @types/node to the major of the engines minimum (^24) or update engines.

repro:
Add code calling a Node 26-only API (e.g. a recently added global) in apps/web source; `bun run typecheck` passes on a Node 24 environment despite engines claiming Node 24 support.

## low: Unauthenticated endpoint accepts arbitrary token addresses and triggers two price refreshes per request with no rate limiting

id: fnd_sig-feat-route-bd11a92fe4-b39bba_8badc56b1c
category: security
confidence: medium
triage: risk
status: open
feature: Hono route GET /price-guard (feat_route_bd11a92fe4)

evidence:
- apps/api/src/routes/price-guard.ts:62-72
- apps/api/src/routes/price-guard.ts:98-101

The handler performs no authentication and no rate limiting, and token validation is only a syntactic 0x-40-hex check (line 13, 72) — any syntactically valid address is accepted. Every request then invokes refreshPrice for both tokens (lines 98-101). For arbitrary/unprimed addresses these refreshes will miss the KV cache and drive upstream network/RPC calls and KV writes per request, so an unauthenticated caller can amplify upstream requests and cause cache churn at will. While the endpoint is plausibly public by design (frontend pre-trade guard), the absence of any throttling or known-token pre-filter on a request that triggers external work is an abuse vector worth addressing.

recommendation:
Add per-client rate limiting (e.g., token bucket backed by KV/Durable Object), validate tokens against a known token list before refreshing, and/or short-circuit with a cached guard result when available.

test analysis:
No route-level tests exist, and the pure-function tests never touch the refresh path or the unauthenticated request surface.

suggested regression test:
Route test asserting that addresses not in the known token list return 400/404 without invoking refreshPrice (pre-refresh validation), plus a throttle test if rate limiting is added.

minimum fix scope:
apps/api/src/routes/price-guard.ts (token whitelist/rate-limit check before layer construction).

repro:
Repeatedly call GET /price-guard with random valid-format token addresses; each request issues two refreshPrice calls for addresses absent from the cache.

## low: Unauthenticated, unthrottled /api/v1/auth/nonce creates one persistent Durable Object instance per nonce — unbounded instance growth

id: fnd_sig-feat-library-a50e9b911f-0d44_62a4908f53
category: maintainability
confidence: medium
triage: risk
status: open
feature: Node package @aetherdex/api (feat_library_a50e9b911f)

evidence:
- apps/api/src/auth/siwe.ts:45-51
- apps/api/src/auth/routes.ts:17-27
- apps/api/src/durable-objects/siwe-nonce-do.ts:31-34

issueNonce() maps every nonce to a fresh DO via idFromName(nonce), and POST /api/v1/auth/nonce is public (authMiddleware is non-destructive; rateLimit() is documented as mounted only on high-value mutation routes like swap/positions, not on auth). Durable Object instances created by name are never deleted — the alarm only clears the storage record — so every nonce issue permanently consumes an instance slot. An attacker can drive unbounded instance creation (and a storage write + alarm per request) with no per-caller limiting, and organic traffic accumulates one instance per login attempt over time. The single-use guarantee could be preserved with far less growth.

recommendation:
Rate-limit the nonce endpoint (mount rateLimit() or a dedicated nonce limiter) and/or replace per-nonce DO instances with a small fixed set of DOs storing records keyed by nonce, consumed under blockConcurrencyWhile — or accept the tradeoff explicitly with instance-growth monitoring.

test analysis:
Tests verify issue/consume semantics for a single nonce; instance-count growth over many issuances is not asserted and the resource cost is invisible in the test pool.

minimum fix scope:
apps/api/src/auth/routes.ts (rate limit on /nonce) and/or apps/api/src/auth/siwe.ts + apps/api/src/durable-objects/siwe-nonce-do.ts (bounded nonce storage design).

repro:
Repeatedly POST /api/v1/auth/nonce; observe a distinct DO instance created per request with no deletion mechanism (only the record expires via alarm).

## low: Unbounded grossAmount digit strings allow CPU-exhaustion amplification and accept amounts outside the router's uint256 range

id: fnd_sig-feat-route-c733a805a5-cf4d98_fd877300a9
category: security
confidence: medium
triage: risk
status: open
feature: Hono route POST /deposit-estimate (feat_route_c733a805a5)

evidence:
- apps/api/src/routes/liquidity.ts:24
- apps/api/src/routes/liquidity.ts:57-65
- apps/api/src/routes/liquidity.ts:43-45

UINT_RE (/^\d+$/) places no upper bound on digit count, and BigInt(grossAmount) then parses arbitrarily long decimal strings (up to request-body size, with up to MAX_INPUTS=8 entries per request). V8's decimal-string BigInt conversion is super-linear in the number of digits, so a single request carrying one or more multi-megabyte digit strings can consume far more CPU than the bytes uploaded (amplification), on an unauthenticated, public endpoint. Additionally, amounts beyond 2^256-1 (78 digits) are accepted even though the AetherRouter EVM contract can never process them, so the endpoint can return estimates for inputs the router would reject — an API contract mismatch with the documented 'must match AetherRouter' semantics (lines 9-15).

recommendation:
Reject grossAmount strings longer than 78 digits (uint256 max) with a 400 before calling BigInt (e.g. extend the UINT_RE check with a length guard), which both bounds parse cost and enforces the on-chain amount range. Optionally add per-route rate limiting since the endpoint is unauthenticated.

test analysis:
No tests exist for this route, and even a naive test with a short overflow string (79+ digits) would not expose the CPU-cost dimension of unbounded lengths; the length cap would need an explicit boundary test.

suggested regression test:
Assert 400 for grossAmount with 79 digits ('9'.repeat(79)) and confirm a 78-digit value is accepted, ensuring the digit-length cap matches uint256.

minimum fix scope:
Add a digit-length cap (<= 78) in parseInputs before BigInt conversion.

repro:
curl -X POST https://<worker>/api/v1/liquidity/deposit-estimate -H 'content-type: application/json' -d '{"amounts":[{"grossAmount":"'$(python3 -c 'print("9"*2000000)')'"}]}' — the BigInt parse of the 2M-digit string dominates request CPU time; 8 such entries amplify further.

## low: Unguarded JSON.parse of KV payload aborts the entire pool refresh

id: fnd_sig-feat-library-c77821ce5c-81f9_f4731b6ac9
category: bug
confidence: medium
triage: risk
status: open
feature: Node source apps/api/src/workers (feat_library_c77821ce5c)

evidence:
- apps/api/src/workers/cron-handler.ts:320-331 (refreshTopPools)

The per-pool write loop is wrapped in try/catch, but the read loop that parses `price:<address>` KV payloads (line 327) is not. A single malformed or partially-written KV value rejects the whole Promise.all batch, and because the error propagates out of `refreshTopPools` to the outer Effect.tryPromise catch in `handleScheduled`, none of the 50 pools get their poolSpot updated in that tick even though the price queue was already sent.

recommendation:
Wrap the JSON.parse per address (or per batch) so a corrupt entry degrades to null for that token only, matching the per-pool try/catch already used in the write loop.

test analysis:
No tests cover refreshTopPools behavior with malformed cache entries.

suggested regression test:
Seed one corrupt `price:` KV value among valid ones and assert the remaining pools still receive poolSpot writes.

minimum fix scope:
apps/api/src/workers/cron-handler.ts

## low: Unmapped chainId silently falls back to filtering as 'ethereum', hiding valid pools

id: fnd_sig-feat-ui-flow-96f77c54e9-07de_2c59c47f1c
category: bug
confidence: medium
triage: risk
status: open
feature: React component PoolStats (feat_ui-flow_96f77c54e9)

evidence:
- apps/web/src/components/PoolStats.tsx:47-55 (PoolStats)

chainMap covers only 1, 8453, 11155111, and 84532, but the component accepts an arbitrary `chainId?: number`. Any other chain (e.g., 137 polygon, 42161 arbitrum, 10 optimism, 56 bsc) hits `chainMap[chainId] ?? 'ethereum'` (line 54) and filters pairs to chainId 'ethereum', which almost always yields an empty list, rendering 'No pool data available' for tokens that do have pools on the requested chain. The result is a silent wrong outcome: the UI reports absence of data when the data exists but was filtered out. If unsupported chains are intended, that state should be explicit rather than masquerading as 'no pools'.

recommendation:
When the chainId is not in the map, either skip chain filtering entirely (matching the chainId-undefined behavior) or render a distinct 'unsupported chain' message; also keep the fallback out of the data path by handling the unknown case before filtering.

test analysis:
No tests exist for the component, so the unknown-chainId path is unexercised.

suggested regression test:
Test rendering with chainId=137 and a fetch response containing an ethereum pair plus a polygon pair; assert the polygon pair is displayed (or that the empty state is only shown when genuinely no pairs match).

minimum fix scope:
Adjust the chainId branch in the queryFn (lines 47-56) to skip filtering for unmapped chainIds.

repro:
Pass chainId=137 for a token with polygon pairs; the component shows the empty-state message instead of the token's polygon pool.

## low: Unvalidated `length` prop: zero or negative values produce degenerate or expanding output

id: fnd_sig-feat-ui-flow-458f3992b6-8b2f_a3ec550fdf
category: bug
confidence: medium
triage: risk
status: open
feature: React component Address (feat_ui-flow_458f3992b6)

evidence:
- apps/web/src/components/Address.tsx:7-11 (Address)

The guard `address.length < length * 2 + 3` assumes a positive integer `length`. With `length={0}` the threshold is 3, so any real address (e.g. 42 chars) is truncated to `slice(0, 2)` + ellipsis + `slice(0)`, rendering as "0x…" with only 2 visible characters. With a negative `length` such as -1, the threshold is 1 and `slice(-length)` becomes `slice(1)`, producing e.g. "0…xabcdef" for "0xabcdef" — output longer than the input, defeating the truncation contract. Non-integer values (e.g. 2.5) also pass through to `slice` with float semantics. The component neither clamps nor validates the prop, and the default of 4 only protects the common path.

recommendation:
Clamp or validate `length`, e.g. `const n = Math.max(1, Math.floor(length ?? 4))`, or fall back to rendering the full address when `length < 1`; add a dev-time guard if stricter behavior is desired.

test analysis:
No tests exist for this component, and the default positive `length` path hides these edge cases from normal usage.

suggested regression test:
Parameterized test asserting that `length={0}`, `length={-1}`, and `length={2.5}` either render the full address or produce output no longer than the input and never shorter than the prefix+ellipsis+suffix structure.

minimum fix scope:
apps/web/src/components/Address.tsx

repro:
Render `<Address address="0xabcdef" length={-1} />` → "0…xabcdef" (longer than input); `<Address address="0x1234567890abcdef1234567890abcdef12345678" length={0} />` → "0x…".

## low: Unvalidated remote logoURI rendered as img src (privacy/referrer leak, no https guarantee)

id: fnd_sig-feat-ui-flow-902c997d16-24dd_a9f447ba27
category: security
confidence: medium
triage: risk
status: open
feature: React component TokenChip (feat_ui-flow_902c997d16)

evidence:
- apps/web/src/components/TokenChip.tsx:20 (TokenChip)

TokenChip renders token.logoURI directly as an <img> src. Token objects (address, symbol, logoURI) cross the user-input and network trust boundaries (they come from user-supplied/network-fetched token lists), yet the URL is used with no scheme validation, no host allowlist, and no referrerPolicy. Consequences: (1) the app's referrer and the user's IP are sent to whatever third-party host the logo URI points at, enabling tracking/fingerprinting; (2) an http:// logo URI silently breaks on an https page due to mixed-content blocking, degrading the UI; (3) any URL scheme accepted by the browser for images is passed through. Script execution inside SVG-in-<img> is blocked by browsers, so this is not XSS, hence low severity.

recommendation:
Validate logoURI before rendering (require https: or data: from a trusted issuer, or resolve through an allowlisted gateway), add referrerPolicy="no-referrer" to the img, and consider a generic fallback monogram instead of the raw URL.

test analysis:
No tests exist for TokenChip (feature tests list is empty and no test file is included), so URL handling and attributes are unverified.

suggested regression test:
Render TokenChip with an http:// and a non-http(s) logoURI and assert the img is not rendered (or is sanitized) and that referrerPolicy="no-referrer" is set for allowed URLs.

minimum fix scope:
apps/web/src/components/TokenChip.tsx (guard/validate logoURI; add referrerPolicy)

## low: V3 calldata builders accept non-positive deadlines while the V4 path rejects them

id: fnd_sig-feat-library-9f563d7b60-6b05_173015cd8c
category: bug
confidence: medium
triage: risk
status: open
feature: Node source apps/web/src/lib (feat_library_9f563d7b60)

evidence:
- apps/web/src/lib/v3-liquidity.ts:155-159 (buildV3MintCall)
- apps/web/src/lib/v3-liquidity.ts:305-306 (buildV3SingleSidedZapCall)
- apps/web/src/lib/v4-liquidity.ts:230 (validateInput)

v4's validateInput rejects deadline <= 0n ('V4 deadline must be positive'), but the v3 builders pass deadline straight into the encoded calldata without any check: buildV3MintCall (deadline passed to addCallParameters) and buildV3SingleSidedZapCall (deadline passed into the zap params). A deadline of 0 — or any timestamp already in the past — is a guaranteed on-chain revert for the NFPM-based mint and for the zap executor, so the user signs and pays for a transaction that always fails. The v3 path carefully validates tick ranges, slippage (toSlippage), executor, token, and amounts, so the missing deadline check is a validation inconsistency with a concrete failure mode; the same gap applies to buildV3RebalancePlan, which forwards the deadline into both removeCallParameters and the remint.

recommendation:
Add a deadline > 0n validation in buildV3MintCall and buildV3SingleSidedZapCall (and, for symmetry, buildV3RebalancePlan), mirroring v4's validateInput check, or validate at the shared entry point before calldata construction.

test analysis:
v3-liquidity.test.ts always passes future deadlines (2_000_000_000n and 123n); no test exercises a zero or past deadline for the v3 builders, so the divergence from the v4 path is untested.

suggested regression test:
Assert buildV3MintCall and buildV3SingleSidedZapCall throw on deadline 0n (mirroring the existing v4 deadline rejection test coverage).

minimum fix scope:
apps/web/src/lib/v3-liquidity.ts only.

## low: V3QuoteService never verifies the RPC chain, unlike every other chain-bound reader in this feature

id: fnd_sig-feat-library-ad98bca978-713e_b4ca47ed6c
category: security
confidence: medium
triage: risk
status: open
feature: Node source apps/api/src/services#2 (feat_library_ad98bca978)

evidence:
- apps/api/src/services/v3-quote.service.ts:81-134

makeV3QuoteService creates a public client and immediately serves quotes; V3QuoteServiceDeps contains no chainId and quote() never calls getChainId. Every sibling chain-bound component verifies the RPC chain (v3-position-reader.service.ts line 40, v4-position-reader.service.ts lines 90-97, v3-liquidity-indexer.service.ts lines 43-56). A misconfigured RPC (e.g., mainnet RPC with Sepolia factory/quoter addresses) therefore silently returns quotes from the wrong chain, which downstream order/execution logic would consume as valid.

recommendation:
Add chainId to V3QuoteServiceDeps and verify it (with caching) before quoting, mirroring the pattern in v4-position-reader.service.ts.

test analysis:
No test file for v3-quote.service.ts is included in this feature, and the chain check is absent, so nothing asserts it.

minimum fix scope:
apps/api/src/services/v3-quote.service.ts (deps + quote)

## low: VITE_WS_URL is sourced from secrets but omitted from the Validate deployment inputs check, so a missing/empty websocket secret deploys a broken canary silently

id: fnd_sig-feat-config-991500c02e-c47df_4b41cb9247
category: bug
confidence: medium
triage: risk
status: open
feature: Shell/workflow config staging-deploy.yml (feat_config_991500c02e)

evidence:
- .github/workflows/staging-deploy.yml:39
- .github/workflows/staging-deploy.yml:58-63

Every other secrets-backed environment variable set in the job env (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, CHAIN_ID, RPC_URL, STATE_VIEW_ADDRESS, V4_POOL_MANAGER_ADDRESS, AETHERDEX_HOOK, AETHERDEX_TREASURY, AETHERDEX_ROUTER, AETHERDEX_FACTORY, AETHERDEX_POSITION_MANAGER, AETHERDEX_POOL_MANAGER, VITE_REOWN_PROJECT_ID, VITE_API_URL) appears in the validation loop at lines 61-62, but VITE_WS_URL (line 39) does not. If the secret is unset or empty, the canary is deployed with an empty websocket URL; the smoke test (lines 95-98) only exercises HTTP endpoints (`/ping`, `/health`), so the breakage ships to staging undetected by any step in the workflow.

recommendation:
Add VITE_WS_URL to the name list in the Validate deployment inputs loop (line 61), or explicitly document it as optional and add a smoke-test assertion for it if the app can run without websockets.

test analysis:
No tests exist for this workflow (tests: []), and the omission is invisible to CI since the validation step only fails on variables that are listed.

suggested regression test:
A small script that parses the workflow YAML and asserts every env var whose value is `${{ secrets.* }}` appears in the Validate deployment inputs loop's name list; wire it into CI so future secret additions cannot be missed.

minimum fix scope:
.github/workflows/staging-deploy.yml — add `VITE_WS_URL` to the for-loop list at line 61.

repro:
Delete or empty the VITE_WS_URL secret, push to main; the deploy job passes all validation and smoke tests while the deployed frontend receives an empty websocket URL.

## low: Volume-alert cooldown is a check-then-act race that can emit duplicate alerts

id: fnd_sig-feat-library-ad98bca978-f0a0_8752754405
category: concurrency
confidence: medium
triage: risk
status: open
feature: Node source apps/api/src/services#2 (feat_library_ad98bca978)

evidence:
- apps/api/src/services/volume-alerts.service.ts:254-261

runVolumeAlertsTick checks isInCooldown (a KV get) and only afterwards writes the cooldown key via markCooldown. Two overlapping ticks (cron overlap, retries, or concurrent isolates) can both observe no cooldown key for the same pool and both broadcast the alert. KV get/put is not atomic, so the documented 'announced once per cooldown' guarantee is best-effort and can be violated under concurrent execution.

recommendation:
Accept and document the duplicate risk, or make the guard atomic — e.g., use an insert with a unique constraint keyed on (chainId, poolId, window) in D1, or deduplicate by envelope identity in the hub.

test analysis:
No test file for volume-alerts.service.ts is included in this feature, and the race only manifests with concurrent tick invocations, which the included tests never exercise.

minimum fix scope:
apps/api/src/services/volume-alerts.service.ts (runVolumeAlertsTick cooldown guard)

## low: Workflow shell logic (secret validation, retry loop, smoke-test URL derivation) has no automated coverage and is not linted

id: fnd_sig-feat-config-991500c02e-b0b68_cc7b22c3f7
category: test-gap
confidence: medium
triage: test-gap
status: open
feature: Shell/workflow config staging-deploy.yml (feat_config_991500c02e)

evidence:
- .github/workflows/staging-deploy.yml:58-98

The workflow contains non-trivial shell logic — indirect-expansion secret validation (lines 58-63), a 3-attempt retry loop with backoff (lines 76-89), and a smoke test whose health URL is derived by `${VITE_API_URL%/api/v1}/health` (line 98) — yet the feature ships with no tests (tests: []) and there is no actionlint or equivalent workflow linting mentioned in the project commands. The URL derivation is fragile: it silently assumes VITE_API_URL ends exactly with `/api/v1`; a trailing slash (common in env configs) prevents the pattern from matching and produces `.../api/v1//health`, and a different base path produces a wrong endpoint, causing a spurious deploy failure (or a health check that validates the wrong URL). The retry loop's `exit 0`/`exit 1` control flow is also untested.

recommendation:
Add actionlint (or a YAML+shell lint step) to CI for `.github/workflows/*`, and add a unit test for the health-URL derivation covering: exact `/api/v1` suffix, trailing slash, and non-`/api/v1` base URLs. Prefer deriving the health URL from an explicit base secret or a dedicated `HEALTH_URL` rather than suffix manipulation.

test analysis:
The project's test command targets the TypeScript codebase; GitHub Actions YAML and inline shell blocks are outside its coverage, and no workflow-level test harness exists.

suggested regression test:
A shell test that runs the derivation expression against sample VITE_API_URL values (with and without trailing slash, with and without `/api/v1`) and asserts the expected health URL, plus an actionlint step in CI.

minimum fix scope:
.github/workflows/staging-deploy.yml — make the health URL derivation explicit/robust; optionally add actionlint to the repo's CI.

## low: `format` (and `lint`) bypass the workspace delegation used by sibling scripts, leaving non-Biome sources unformatted and generated files exposed to rewriting

id: fnd_sig-feat-release-734b842583-b273_4535740a2c
category: maintainability
confidence: low
triage: risk
status: open
feature: Package script format (feat_release_734b842583)

evidence:
- package.json:8-10
- package.json:14 (format)

Sibling scripts `dev`, `build`, and `test` delegate to every workspace via `bun run --filter '*'`, but `format` runs only the root script against `.`. Consequences: (1) a developer mirroring the sibling pattern with `bun run --filter '*' format` gets failures in any workspace lacking its own `format` script; (2) sources that Biome cannot process — this repo includes `packages/contracts` with Solidity per the `contracts:*` scripts (lines 16-19) — are never formatted by `bun run format` (Biome skips `.sol` during traversal), so the repo-wide 'format' contract is incomplete; (3) the `--write .` traversal also reaches generated JSON under workspaces (e.g., Foundry artifacts) unless biome.json ignores them, producing churn and merge noise. Confidence is low because biome.json and the concrete workspace layout are not included for verification.

recommendation:
Decide on a single convention: either keep root-level `biome format --write .` and add explicit coverage for Solidity (e.g., a `format` script that also runs `forge fmt` in packages/contracts), or delegate via `bun run --filter '*' format` with per-workspace scripts; ensure biome.json ignores generated/artifact directories before running `--write .` repo-wide.

test analysis:
No tests or CI definitions are included, so the workspace-delegation inconsistency and the Solidity/artifact coverage gaps are not exercised anywhere.

minimum fix scope:
package.json scripts (and per-workspace format scripts and/or biome.json ignores, depending on the chosen convention).

## low: Caret range on @biomejs/biome allows non-reproducible lint results

id: fnd_sig-feat-release-3c1de179c9-9279_3c9a305f59
category: build-release
confidence: low
triage: risk
status: open
feature: Package script lint (@aetherdex/shared) (feat_release_3c1de179c9)

evidence:
- packages/shared/package.json:20 (@biomejs/biome)

The lint tooling is declared as '^2.5.5', so any fresh install or lockfile regeneration can resolve a newer Biome minor version with different rules, changed defaults, or different exit behavior. For a release-kind feature this can flip the lint script's result (and 'lint:fix' --write output) without any source change, making CI non-reproducible. Confidence is low because a committed bun.lock with frozen installs in CI would pin the version in practice, and the exact lockfile/CI policy is not visible in the included evidence.

recommendation:
Pin the exact Biome version (e.g. '2.5.5' without the caret) or rely strictly on a committed lockfile with 'bun install --frozen-lockfile' in CI so lint results are deterministic.

test analysis:
No tests are included for this feature, and dependency-version drift is not exercised by unit tests; it is a release-process concern.

minimum fix scope:
packages/shared/package.json (devDependencies.@biomejs/biome) and/or CI install policy

## low: Caret range on TypeScript 7 (native compiler) leaves typecheck behavior floating

id: fnd_sig-feat-release-a235aa99b1-725e_e468562cba
category: build-release
confidence: low
triage: risk
status: open
feature: Package script typecheck (feat_release_a235aa99b1)

evidence:
- package.json:33 (devDependencies.typescript)

typescript is declared as `^7.0.2`, which is the new native (Go-based) compiler line whose `tsc` CLI and tsconfig option support differ from the 5.x line; the caret range also permits automatic minor updates that can change diagnostics. The root tsconfig.json is not included in the reviewed file set, so compatibility of its compiler options with TypeScript 7's native compiler cannot be confirmed. If the 7.x line drops or changes behavior for an option the project relies on, `bun run typecheck` results could silently drift without a source change.

recommendation:
Pin the exact TypeScript version (or a tightly bounded range), verify the root tsconfig's compiler options are supported by TypeScript 7's native tsc, and lock the dependency via the lockfile so typecheck behavior is deterministic.

test analysis:
No tests are included for this feature, and nothing asserts the number or content of typecheck diagnostics, so compiler-version drift is undetectable.

suggested regression test:
A CI step that installs with the locked typescript version, runs `bun run typecheck`, and asserts zero diagnostics.

minimum fix scope:
package.json

## low: format and lint scripts only cover src/ and test/, omitting package-root config files

id: fnd_sig-feat-release-854b75ccaa-3fc3_7785cd89ae
category: maintainability
confidence: low
triage: risk
status: open
feature: Package script format (@aetherdex/web) (feat_release_854b75ccaa)

evidence:
- apps/web/package.json:19 (format)

The format script hardcodes `src/ test/`, covering application and test sources but not the package-root config files conventionally required by the tooling declared in devDependencies: vite.config.*, playwright.config.*, tailwind.config.*, postcss.config.*, biome.json, and wrangler.toml. After running `bun run format`, these root-level files can remain unformatted, and `bun run lint` (line 17) uses the same `src/ test/` scope so it will not catch them either, leaving the tree dirty despite a green local format/lint run. This assumes the conventional layout of configs at the apps/web root; the config files themselves were not included in this review, hence low confidence.

recommendation:
Scope the format/lint scripts to the package root (e.g. `biome check --write .` with a biome.json `files.ignore` for dist/generated output) or explicitly list root-level config files so format and lint cover the whole package consistently.

test analysis:
No tests cover the script scope; the feature metadata lists no tests and package.json has no test entries for the format script.

suggested regression test:
A CI step that runs biome in check mode across the package root (including config files) and fails on any unformatted file, proving the format script's scope is complete.

minimum fix scope:
Update the path arguments of the format (and lint) scripts in apps/web/package.json to include package-root config files or the package root with proper ignores.

## low: format script uses deprecated `biome format` command, inconsistent with `biome check`-based lint

id: fnd_sig-feat-release-854b75ccaa-ebf8_03010774fd
category: maintainability
confidence: low
triage: risk
status: open
feature: Package script format (@aetherdex/web) (feat_release_854b75ccaa)

evidence:
- apps/web/package.json:17-19 (format)

The lint (line 17) and lint:fix (line 18) scripts use `biome check`, which in Biome already includes formatting verification, while format (line 19) invokes the standalone `biome format` subcommand. In Biome 2.x (devDependency `@biomejs/biome` ^2.5.5, line 45) the `biome format` and `biome lint` subcommands are deprecated in favor of `biome check` and are slated for removal in a future major release, so a future Biome upgrade will break `bun run format`. The script also has no check-only variant (e.g. format:check), so CI must rely on `lint` to enforce formatting, and there is nothing preventing format and lint from drifting apart. The command works today, so this is a forward-looking hazard rather than a current breakage.

recommendation:
Align format with lint by using `biome check --write src/ test/` (or add a `format:check` script such as `biome check src/ test/` for CI), so formatting and linting share one command family and survive a Biome major upgrade.

test analysis:
The feature lists no tests, and package.json contains no test entries that exercise script definitions; script behavior is only verified manually or in CI pipelines not included in this review.

suggested regression test:
A repo-level test (or CI step) that parses apps/web/package.json and asserts the format and lint scripts use the same biome subcommand family, plus a smoke check that a formatted tree passes `biome check` in dry-run mode.

minimum fix scope:
Edit the format script in apps/web/package.json to use `biome check --write` and add a format:check script for CI.

## low: Hand-rolled forge coverage summary parser can silently mis-gate if the summary column layout changes

id: fnd_sig-feat-config-902602e3e1-3a41e_ec95aa7e94
category: test-gap
confidence: low
triage: test-gap
status: open
feature: Shell/workflow config ci.yml (feat_config_902602e3e1)

evidence:
- .github/workflows/ci.yml:205-248

The contracts coverage gate parses `forge coverage` summary output by taking cells[1:5] (the first four cells after 'Total') and reading the first number in each, then gates lines/statements/functions at 90%. The parser fail-closes only when fewer than 4 numeric cells are found; if a future Foundry release inserts or reorders a summary column (e.g., an instructions metric), the positional mapping silently shifts and the gate would evaluate the wrong metrics — potentially passing coverage that is actually below 90% (fail-open) or false-failing. The parser lives inline in a run block with no tests, unlike the rest of the repo's quality gates.

recommendation:
Validate column semantics instead of position (e.g., match the header row '| File | % Lines | % Statements | % Branches | % Funcs |' before parsing and index by header), or compute the gate from the lcov.info report (already generated on line 204) rather than the human summary; add a unit test for the parser fed with captured forge output.

test analysis:
The parser is embedded in a YAML run block and is not covered by the repository's vitest/forge test suites; only real Foundry output would exercise it.

suggested regression test:
A small script/test that feeds a sample summary including the header row and a 'Total' row into the parsing logic and asserts the extracted lines/statements/functions values match expectations.

minimum fix scope:
Harden the coverage step's parser (header validation or lcov-based computation) in .github/workflows/ci.yml.

## low: HTTP status mapping depends on a hardcoded literal reason string; every non-'no_pool' failure is reported as 503

id: fnd_sig-feat-route-552aaeecba-1c101d_544d6b2266
category: api-contract
confidence: low
triage: contract-mismatch
status: open
feature: Hono route GET /v3/quote (feat_route_552aaeecba)

evidence:
- apps/api/src/routes/v3-quote.ts:70-72

The catch handler maps the HTTP status purely by comparing error.reason against the string literal "no_pool"; every other V3QuoteError reason (and every unexpected error) is flattened to 503 Service Unavailable. Because the route's own validation admits fee values outside the canonical V3 fee tiers (any integer 1..1_000_000 passes, lines 27-33) and only checks address shape, client-correctable conditions surfaced by the service (unsupported fee tier, unsupported/illiquid pair, quote failure) would be reported as server errors, which misleads clients into retrying permanent failures and misclassifies the failure domain. The coupling between the service's reason taxonomy and this literal is also fragile: renaming the reason in the service silently converts 404s into 503s with no compile-time check. Confidence is limited because the service file (v3-quote.service.ts) is not included, so the full set of reason values is unverifiable.

recommendation:
Carry structured error information from the service (e.g., a clientError/status field on V3QuoteError or a discriminated union) and map status from that field; treat only genuinely transient/server-side reasons as 503, and validate fee against the canonical V3 fee tiers (100/500/3000/10000) at the route boundary to reject unsupported tiers with a 400.

test analysis:
No tests exist for the route, and the mapping behavior depends on the service's reason taxonomy which is not exercised anywhere in the included files.

suggested regression test:
A test that throws V3QuoteError with each known reason and asserts the expected status per reason, plus a test asserting fee values outside the canonical tier set return 400.

minimum fix scope:
Replace the literal comparison with a structured status field on V3QuoteError and tighten the fee validation in the route.

## low: No automated coverage guards the build script's non-deploying dry-run behavior

id: fnd_sig-feat-release-accf8dfaca-c80a_e5661668e7
category: test-gap
confidence: low
triage: test-gap
status: open
feature: Package script build (@aetherdex/api) (feat_release_accf8dfaca)

evidence:
- apps/api/package.json:9 (build)

The feature's only artifact is the `build` script, and no tests are linked. The script's key safety property is that it uses `--dry-run` so building never triggers an actual deployment; a future edit that drops `--dry-run` (or `--outdir`) would silently turn `bun run build` into a real deploy with no test or CI gate catching the change. Since the release pipeline presumably gates on `bun run build` passing, this property deserves a cheap automated check. Confidence is low because no CI configuration is included to confirm build is actually wired into the release path.

recommendation:
Add a CI step that runs `bun run build` and fails the pipeline if the output indicates a real deploy (e.g., assert the command exits 0 with dry-run output and that no `dist` upload/deploy step follows), or at minimum a lint-style check that the build script contains `--dry-run`.

test analysis:
The linked test suite is empty for this feature, and vitest only covers `src/` and `test/` per the `lint` script; package scripts are not exercised by any included test.

suggested regression test:
A CI job that runs `bun run build` and asserts the command output contains dry-run markers and that no deploy is triggered (e.g., `wrangler deploy --dry-run` exits 0 without authentication).

minimum fix scope:
apps/api/package.json

## low: No CI validation covers the CodeQL workflow YAML or its referenced config file

id: fnd_sig-feat-config-ac74680d99-aabf0_31b26a6515
category: test-gap
confidence: low
triage: test-gap
status: open
feature: Shell/workflow config codeql.yml (feat_config_ac74680d99)

evidence:
- .github/workflows/codeql.yml:39-44

The workflow depends on `./.github/codeql-config.yml` (line 44), but that file is not among the owned/context files and the project's detected commands (typecheck, lint, format, test) give no indication that GitHub Actions YAML or the referenced config are validated (e.g., via actionlint or a yaml-parse step). A malformed workflow, a mistyped/missing config file path, or a broken action pin would fail every CodeQL run at CI time and silently disable security scanning without any local or PR-time check catching it.

recommendation:
Add an actionlint (or at minimum a YAML syntax) check to the lint/test pipeline for .github/workflows and verify that the referenced ./.github/codeql-config.yml exists and is valid, so workflow breakage is caught in PR CI rather than only in live GitHub Actions runs.

test analysis:
No tests are associated with this feature (tests: []), and none of the detected project commands target GitHub Actions workflow files.

minimum fix scope:
Add a workflow-YAML lint step (e.g., actionlint) to CI and a check that ./.github/codeql-config.yml exists

## low: No include field and broad excludes make root typecheck coverage implicit and silently partial

id: fnd_sig-feat-config-0c1c23856a-e7b6b_042745e171
category: build-release
confidence: low
triage: risk
status: open
feature: Project config tsconfig.json (feat_config_0c1c23856a)

evidence:
- tsconfig.json:29

The config has no include field, so the program is implicitly all .ts files under rootDir minus exclude, and exclude drops apps/** and **/lib/** (line 29) without any project references declared. If apps/ contains application code that is only typechecked by the root command, type errors there are silently invisible to `bun run typecheck`; conversely, any stray .ts file (scratch, generated) anywhere in the tree is pulled into the program, so the typechecked surface is implicit and drifts as files are added. The impact depends on the repo layout, which is not visible in the provided files, so confidence is low, but for a config whose stated purpose is build/quality gating, the implicit scope is a concrete risk.

recommendation:
Add an explicit include listing the source directories that must be typechecked, and either declare references to app tsconfigs or verify each app has its own typecheck script wired into the root `bun run typecheck` command so no tree is skipped silently.

test analysis:
No tests exist for this feature (tests: []), and vitest does not assert the file-list scope of the root typecheck program.

suggested regression test:
A script/test that builds the root program (e.g., via typescript API or `tsc --listFiles`) and asserts expected source dirs are covered and that each app in apps/ participates in the root typecheck (directly or via an invoked per-app config).

minimum fix scope:
tsconfig.json: add include and references (or wire per-app typecheck into the root command).

## low: No tests for the WorkerEnv tag and layer factory

id: fnd_sig-feat-library-36b3e24e1a-7423_cd0ec23ea7
category: test-gap
confidence: low
triage: test-gap
status: open
feature: Node source apps/api/src/layers (feat_library_36b3e24e1a)

evidence:
- apps/api/src/layers/WorkerEnv.ts:13-15 (makeWorkerEnvLayer)

The feature owns no test files even though vitest and @effect/vitest are configured (package.json lines 15-17, 55). The exported surface — the tag identity string and the layer that succeeds with the provided env — is the single seam through which all runtime bindings (DB, CACHE, STORAGE, DO namespaces) enter the application. A regression here (e.g., wrong tag id, layer succeeding with a different value) would surface only at runtime in production.

recommendation:
Add a small unit test (e.g., apps/api/src/layers/WorkerEnv.test.ts) using @effect/vitest that builds the layer and asserts the provided env is retrievable via Effect.service(WorkerEnv), and that the tag id is '@aetherdex/WorkerEnv'.

test analysis:
No test files are associated with this feature; the feature metadata lists an empty tests array and none of the included files reference a test.

suggested regression test:
`const env = { DB: {} as D1Database, ... }; const result = await Effect.runPromise(Effect.provide(makeWorkerEnvLayer(env), Effect.service(WorkerEnv))); expect(result).toEqual(env)` plus an assertion on the tag's service id.

minimum fix scope:
apps/api/src/layers/WorkerEnv.test.ts (new file).

## low: poolId accepts mixed-case hex but is not normalized before lookup

id: fnd_sig-feat-route-8a6337af57-f37c4d_0352b52470
category: api-contract
confidence: low
triage: contract-mismatch
status: open
feature: Hono route GET /:poolId (feat_route_8a6337af57)

evidence:
- apps/api/src/routes/pools.ts:65

The regex /^0x[a-fA-F0-9]{64}$/ accepts both letter cases, and the raw param is passed to poolService.getPool without normalization. D1/SQLite string comparisons are case-sensitive, and on-chain-derived identifiers are conventionally stored lowercase, so a request for 0xABC... (uppercase) can pass validation yet return 404 while the lowercase form succeeds — an inconsistent API contract for the same logical pool. Confidence is low because the storage normalization in PoolService is not included in this review.

recommendation:
Normalize with poolId = poolId.toLowerCase() after the regex check (or make the regex lowercase-only) so the accepted input space matches the lookup space.

test analysis:
No tests exist for this route, so the mixed-case acceptance path is untested.

suggested regression test:
Seed a pool with a lowercase id, then request it with the same id in uppercase and assert it returns the same 200 result (or a documented 400 if uppercase is intentionally rejected).

minimum fix scope:
Add toLowerCase() normalization after validation in the GET /:poolId handler.

## low: Root dev/build scripts use --filter '*' and fail if any workspace lacks the script

id: fnd_sig-feat-config-7528cb5b98-69f08_7a22d0f09a
category: maintainability
confidence: low
triage: risk
status: open
feature: Project config package.json (feat_config_7528cb5b98)

evidence:
- package.json:8-9
- package.json:26-30

`bun run --filter '*' dev` (and `build`) executes the script in every workspace under apps/*, packages/*, and infra/*. Bun fails the whole command if any matched workspace does not define that script. One infra or package workspace without a `dev`/`build` script (e.g., a pure-config or shared-library package) breaks the single root entrypoint for all workspaces. The workspace contents are not visible in this excerpt, so confidence is low, but the script pattern is the risk carrier.

recommendation:
Ensure every workspace declares `dev` and `build` (even as no-ops), or drop the all-workspace filter and drive each app via the dedicated api:dev/web:dev scripts; add a CI check that lists workspaces and verifies script symmetry.

test analysis:
No tests are included for this feature; the failure happens when running the root scripts, before any vitest suite executes.

suggested regression test:
A config-validation test that enumerates workspaces and asserts each one declares the scripts referenced by root `--filter '*'` commands.

minimum fix scope:
package.json scripts (lines 8-9) plus workspace package.json updates

## low: test script hard-fails on an empty test suite (no --passWithNoTests)

id: fnd_sig-feat-test-suite-78d951fc31-b_a96cb655c4
category: build-release
confidence: low
triage: risk
status: open
feature: Package script test (@aetherdex/api) (feat_test-suite_78d951fc31)

evidence:
- apps/api/package.json:15 (test)

The 'test' script is a bare 'vitest run'. Vitest exits with status 1 when no test files are found unless --passWithNoTests (or config passWithNoTests: true) is set. This package is version 0.1.0/private and the feature metadata lists no linked tests (tests: []), so on a fresh checkout or CI run before any test files land, 'bun run test' would fail the pipeline with a misleading 'No test files found' error rather than a green no-op. Confidence is low because the lint script references a test/ directory, suggesting tests may already exist and would make this a non-issue in practice; the finding is a robustness hazard for an early-stage package rather than a confirmed defect.

recommendation:
Add '--passWithNoTests' to the test script (or set passWithNoTests: true in the vitest config) so an empty suite is treated as a pass until tests exist. Once real tests are committed, the flag is harmless since it only affects the no-tests-found case.

test analysis:
The feature has no linked tests and this is a package-script behavior issue; test files, if any, would not exercise the script's exit-code behavior on an empty suite.

minimum fix scope:
apps/api/package.json line 15: change "test": "vitest run" to "test": "vitest run --passWithNoTests"

## low: test:e2e assumes Playwright browsers are already installed with no install step in scripts

id: fnd_sig-feat-test-suite-fba3efc44a-5_48dcff235d
category: build-release
confidence: low
triage: risk
status: open
feature: Package script test (@aetherdex/web) (feat_test-suite_fba3efc44a)

evidence:
- apps/web/package.json:14 (test:e2e)

The test:e2e script runs `playwright test` directly. @playwright/test is declared in devDependencies, but Playwright browser binaries are downloaded separately (normally `playwright install`, often via a CI setup step or postinstall). On a fresh checkout or CI image that only runs `bun install` followed by the package scripts, `bun run test:e2e` will fail with a browser-not-found error. Whether this bites depends on CI configuration, which is not included in the review scope, so confidence is low; the script surface itself provides no fallback or install step.

recommendation:
Either add a `pretest:e2e`/`postinstall` step that runs `playwright install --with-deps` (or a dedicated `test:e2e:install` script wired into CI), or document the required bootstrap step.

test analysis:
Browser provisioning happens outside the test suite itself; unit tests cannot detect a missing browser install step.

minimum fix scope:
apps/web/package.json scripts (add browser install step) or CI workflow documentation

## low: Typecheck gate relies on tsconfig discovery and stale wrangler-generated bindings

id: fnd_sig-feat-release-98203099b0-2a73_56a4730bf6
category: build-release
confidence: low
triage: risk
status: open
feature: Package script typecheck (@aetherdex/api) (feat_release_98203099b0)

evidence:
- apps/api/package.json:18 (typecheck)
- apps/api/package.json:14 (types)

The typecheck script runs bare `tsc --noEmit` with no `-p` flag and no dependency on the `types` script (`wrangler types`), which generates the Cloudflare bindings typings (e.g., worker-configuration.d.ts). In a bun workspace package (see `workspace:*` dependency on line 40), tsc resolves tsconfig.json by walking up the directory tree, so this script may silently typecheck against the wrong (root) tsconfig or fail if none exists at the package root. It also never regenerates wrangler bindings before typechecking, so a fresh checkout without a committed generated bindings file fails the gate, while a stale committed file lets the gate pass against outdated bindings. Impact is conditional on repo layout and CI, but the script as written leaves the release gate's inputs (tsconfig resolution, generated bindings) implicit and unverified.

recommendation:
Pin the config with `tsc --noEmit -p tsconfig.json` and either commit the generated bindings file and add a `pretypecheck` hook running `wrangler types`, or chain the scripts as `"typecheck": "wrangler types && tsc --noEmit"` so the gate always validates current bindings.

test analysis:
This feature has no linked tests, and package-script execution order/environment is not exercised by the vitest suite.

suggested regression test:
CI smoke check: run `rm -f worker-configuration.d.ts && bun run typecheck` in a fresh checkout and assert it still succeeds, proving binding regeneration is part of the gate.

minimum fix scope:
apps/api/package.json (scripts: types/typecheck)

## low: Typecheck scope may exclude test/ files that lint and format already cover

id: fnd_sig-feat-release-98203099b0-4798_a5be08e9d2
category: test-gap
confidence: low
triage: test-gap
status: open
feature: Package script typecheck (@aetherdex/api) (feat_release_98203099b0)

evidence:
- apps/api/package.json:18 (typecheck)
- apps/api/package.json:19-21 (lint)

The lint and format scripts explicitly target `src/ test/` (lines 19-21), confirming the package has a test directory that is part of the quality gate. The typecheck script, by contrast, runs bare `tsc --noEmit` and covers only whatever the resolved tsconfig includes. If that tsconfig excludes test files (a common setup for worker projects using @cloudflare/vitest-pool-workers), type errors in tests pass the release gate while lint/format still enforce the same directory — an inconsistent coverage contract between sibling scripts. The mismatch is visible in this file; whether it materializes depends on the unseen tsconfig.

recommendation:
Make test type coverage explicit: either include test/ in the tsconfig used by the typecheck script, or add a `tsconfig.test.json` plus a `typecheck:test` script and include both in the root `typecheck` command so the script's scope matches lint/format.

test analysis:
No tests are linked to this feature, and the gap only manifests at the script/tsconfig level, outside the vitest suite.

suggested regression test:
CI check that injects a deliberate type error into a test/ fixture, runs the typecheck command, and asserts it fails; remove the error afterwards.

minimum fix scope:
apps/api/package.json scripts plus the package tsconfig include list

## low: typecheck script depends on an implicit tsconfig.json that is not declared or visible in scope

id: fnd_sig-feat-release-d0eb442a0a-f2b9_788f01667b
category: build-release
confidence: low
triage: risk
status: open
feature: Package script typecheck (@aetherdex/shared) (feat_release_d0eb442a0a)

evidence:
- packages/shared/package.json:12 (typecheck)
- packages/shared/package.json:7-10

The 'typecheck' script runs bare `tsc --noEmit` with no --project/--noEmit config file argument, so tsc resolves an implicit tsconfig.json from the package directory. The review scope contains only package.json (omittedFiles is empty), so the existence, include set, and strictness of that config cannot be verified. If packages/shared/tsconfig.json is absent, tsc fails with TS5083 ('Cannot read file tsconfig.json') and the gate breaks; if it exists with a loose or empty include set, the gate can pass while checking little or nothing. Additionally, because tsc only compiles what the implicit config includes, the script gives no guarantee that the declared entrypoint (main/exports point at ./src/index.ts) type-checks.

recommendation:
Make the config explicit and self-contained: change the script to `tsc --noEmit -p tsconfig.json` and commit a packages/shared/tsconfig.json that includes src/**/*.ts with strict: true (ideally extending a shared base config). Consider `--pretty false` for CI log stability, and add a CI step that actually executes `bun run typecheck` inside packages/shared so the gate is proven to work end-to-end.

test analysis:
The feature lists no tests, and a missing/broken compiler config only surfaces when the command is executed by a developer or CI; there is no automated check exercising the script itself.

minimum fix scope:
packages/shared/package.json plus a committed packages/shared/tsconfig.json (if one is not already present)

## low: typecheck script does not pin a tsconfig, so tsc scope depends on ambient filesystem state

id: fnd_sig-feat-release-a33c784326-9874_884c1a2b9d
category: build-release
confidence: low
triage: risk
status: open
feature: Package script typecheck (@aetherdex/alchemy-infra) (feat_release_a33c784326)

evidence:
- infra/alchemy/package.json:7 (typecheck)

`tsc --noEmit` with no `-p`/`--project` flag resolves tsconfig.json from the script's cwd, walking up parent directories if not found. If infra/alchemy lacks its own tsconfig.json, tsc silently adopts a parent (repo root) tsconfig — typechecking the wrong file scope with settings that don't match this `"type": "module"` package using effect/alchemy — or, with no config anywhere, fails with a confusing 'no inputs' error. Nothing in the package.json verifies the tsconfig exists or that the script's scope is this package. This makes the feature's success/failure depend on files outside the package. Evidence is limited to package.json, so whether infra/alchemy/tsconfig.json exists cannot be confirmed from the included files.

recommendation:
Pin the project explicitly: `"typecheck": "tsc --noEmit -p tsconfig.json"` and ensure infra/alchemy/tsconfig.json is committed; optionally add a pre-script check that the file exists.

test analysis:
No tests are attached to this feature, and script behavior under missing/ambient tsconfig files is not exercised by the vitest suite.

suggested regression test:
A CI check that runs `bun run typecheck` in infra/alchemy and asserts tsc used the package-local tsconfig (e.g., by comparing `--showConfig` output against the committed tsconfig) or fails if tsconfig.json is missing.

minimum fix scope:
infra/alchemy/package.json: add `-p tsconfig.json` to the typecheck script (and commit the tsconfig).

repro:
From a checkout where infra/alchemy/tsconfig.json is absent but a root tsconfig.json exists, `bun run typecheck` compiles per the root config instead of failing or checking this package's intended settings.

## low: typescript@^7.0.2 may not exist on npm or may change tsc CLI behavior

id: fnd_sig-feat-config-7528cb5b98-c1182_26d0108eed
category: build-release
confidence: low
triage: risk
status: open
feature: Project config package.json (feat_config_7528cb5b98)

evidence:
- package.json:33
- package.json:15

TypeScript 7 is the native (typescript-go) compiler line. If `7.0.2` is not yet published as a stable release, `bun install` fails for the entire repository. If it is published, the major-version native rewrite could change CLI behavior for `tsc --noEmit -p tsconfig.json` (line 15) or differ from the toolchain assumptions in workspace packages. The version and the typecheck script should be verified together; this cannot be confirmed from the excerpt alone, hence low confidence.

recommendation:
Confirm `typescript@7.0.2` resolves on the registry and that `bun run typecheck` passes across all workspaces; otherwise pin a released major (e.g. 6.x/5.x) known to work with the workspace tsconfigs.

test analysis:
No tests are included for this feature; an install-time failure would prevent the test suite from running at all.

suggested regression test:
A CI smoke step running `bun install --frozen-lockfile` and `bun run typecheck` to catch unresolvable or incompatible toolchain versions.

minimum fix scope:
package.json line 33 (and verify line 15 script)

## low: updateLiquidityPosition/updateV4LiquidityPosition silently drop updates when the position row does not exist

id: fnd_sig-feat-service-1e40670be0-85df_3276dae1bf
category: data-loss
confidence: low
triage: risk
status: open
feature: Node source apps/api/src/db (feat_service_1e40670be0)

evidence:
- apps/api/src/db/queries.ts:208-234
- apps/api/src/db/queries.ts:236-255

Both functions run UPDATE ... RETURNING id and return null when no row matches; the module contains no INSERT path for liquidity_positions. If an indexer delivers a liquidity event before the position row is created (or the row's token_id is NULL, since SQL NULL never satisfies token_id = value), the update silently affects zero rows and returns null, indistinguishable to the caller from a successful update of an id-less row. The LiquidityPosition type declares tokenId as string | null (schema.ts line 75), while both WHERE clauses filter token_id = ${input.tokenId}, so the null-tokenId case can never match.

recommendation:
Upsert instead of bare UPDATE (INSERT ... ON CONFLICT DO UPDATE), or insert-on-miss when RETURNING yields no row, and return a signal that the row was created vs updated.

test analysis:
No tests are included for the module, and the silent null return only shows up when the position row is absent, which requires a two-table setup to observe.

suggested regression test:
Call updateLiquidityPosition for a non-existent tokenId and assert either an insert happens or the function returns an explicit failure instead of a silent null.

minimum fix scope:
apps/api/src/db/queries.ts (updateLiquidityPosition/updateV4LiquidityPosition)

repro:
Call updateLiquidityPosition with a tokenId that has no row in liquidity_positions; the function returns null with no error and no row created.

## low: Version skew across @tanstack/router runtime, CLI, plugin, and devtools packages

id: fnd_sig-feat-release-fa18bd5381-de5f_45493c7bd8
category: maintainability
confidence: low
triage: risk
status: open
feature: Package script build (@aetherdex/web) (feat_release_fa18bd5381)

evidence:
- apps/web/package.json:27 (@tanstack/react-router)
- apps/web/package.json:30 (@tanstack/router-devtools)
- apps/web/package.json:47 (@tanstack/router-cli)
- apps/web/package.json:48 (@tanstack/router-plugin)

The TanStack Router toolchain is declared at divergent minor versions: runtime `^1.170.18` (line 27), devtools `^1.167.0` (line 30), router-cli `^1.167.21` (line 47), router-plugin `^1.168.23` (line 48). The build feature runs `tsr generate` from router-cli, whose generated route tree must match the runtime router's expectations. Caret ranges normally converge on the latest 1.x at install time, so the risk is limited to stale lockfiles or intentionally pinned resolutions, but the manifest itself does not document or enforce alignment, making codegen/runtime incompatibility possible and hard to diagnose. Confidence is low because resolution behavior depends on the lockfile, which is not in scope.

recommendation:
Align the four @tanstack/router packages on the same minor version (or a shared `@tanstack/router-core`-style exact version) and verify the generated route tree compiles with `tsc --noEmit` after `tsr generate`.

test analysis:
Unit/e2e tests exercise app behavior, not the compatibility of generated route-tree code with the router runtime; a version-skew failure would surface only at codegen/build time.

suggested regression test:
A CI step that runs `tsr generate && tsc --noEmit` and fails on any diff or type error, pinning the toolchain to a known-good combination.

minimum fix scope:
apps/web/package.json (dependency version alignment)

