# AetherDEX Alchemy infrastructure

This isolated Alchemy Stack currently provisions the first Cloudflare resource
for the AetherDEX migration: one R2 bucket for trade-history storage. It does
not add an application Worker.

Install dependencies:

```bash
bun install
```

Validate the Stack locally:

```bash
bunx tsc --noEmit
```

Deploy the development stage. Alchemy stores Cloudflare credentials in its
profile and prompts for OAuth on the first deploy:

```bash
bun alchemy deploy
```

Inspect the deployed resource:

```bash
bun alchemy state get \
  --stack AetherDEXCloudflare \
  --stage dev_$USER \
  --fqn TradeHistory
```

The application Worker and additional Cloudflare resources should be added
only after the desired product surface is selected.
