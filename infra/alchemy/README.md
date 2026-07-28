# AetherDEX Alchemy infrastructure

This Alchemy Stack is the source of truth for the AetherDEX Cloudflare runtime:
the API Worker, D1, KV, R2, Durable Objects, Queues, and queue consumers. It
uses explicit physical names matching the Wrangler environments so an existing
resource can be imported with Alchemy's adoption flow.

Install dependencies:

```bash
bun install
```

Validate the Stack locally:

```bash
bunx tsc --noEmit
```

Preview the development stage without changing Cloudflare:

```bash
bun run plan:dev
```

Adopt the existing development resources and deploy the Worker:

```bash
bun run deploy:dev
```

The same flow applies to staging:

```bash
bun run deploy:staging
```

For the current account, the dev deployment uses the existing
`aetherdexcloudflare-tradehistory-dev-irfandi-nfwtu3epiocsqpii` bucket by
setting `STORAGE_BUCKET_NAME` in the shell or `.env`. Other AetherDEX resources
are created with environment-specific names because no matching D1, KV, Queue,
Durable Object, or Worker resources existed to adopt. Do not adopt unrelated
Cloudflare resources that happen to have similar binding types.

`--adopt` is intentional: it lets Alchemy take ownership of pre-existing
Cloudflare resources instead of failing on a name collision. Review the plan
before deploying. It does not discover unrelated resources by type; names must
match the desired AetherDEX resource.

Inspect the deployed resource:

```bash
bun alchemy state get \
  --stack AetherDEXCloudflare \
  --stage dev_$USER \
  --fqn TradeHistory
```

The first deployment may require Alchemy authentication. Use `alchemy login` or
the configured profile before deploying. RPC endpoints and contract addresses
are supplied through an uncommitted `infra/alchemy/.env` file; Alchemy manages
Cloudflare, while the RPC provider remains a separate network dependency.

After deployment, Alchemy prints the Worker URL. A successful smoke test should
return JSON from `/health` and `/api/v1/ping`; a Cloudflare `404 Not Found`
without a corresponding Worker tail event means the request did not reach the
Worker and is a workers.dev routing/deployment problem, not an API route error.
