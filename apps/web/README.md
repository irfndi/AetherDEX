# AetherDEX Frontend

Vite + React 19 + TanStack Router lean spot DEX UI.

## Stack

- **Vite 7** + **React 19** + **TypeScript 7.0**
- **TanStack Router** — file-based routing with type safety
- **TanStack Query** — server state management
- **Wagmi v3** + **Viem v2** — wallet integration
- **Reown AppKit** — multi-wallet connection UI
- **DaisyUI 5** — Tailwind component library
- **Framer Motion** — micro-interactions

## Development

```bash
bun install
bun run dev          # Vite dev server (port 3000)
bun run build        # Production build (dist/)
bun run preview      # Preview production build
bun run test         # Vitest unit tests
bun run test:e2e     # Playwright E2E tests
bun run typecheck    # tsgo --noEmit
bun run lint         # Biome check
```

## Deployment

Deployed to Cloudflare Pages:

```bash
bun run deploy
```

## Architecture

See `/Users/irfandi/Coding/2025/AetherDEX/AGENTS.md` for full architecture overview.
