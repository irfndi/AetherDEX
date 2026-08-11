import { defineConfig } from "react-doctor/api"

/**
 * React Doctor configuration for @aetherdex/web.
 *
 * Two intentional, documented exception groups:
 *
 * 1. `@tanstack/react-form`, `@tanstack/react-table`, `@tanstack/react-virtual`
 *    are flagged as unused dependencies, but they are part of the "full TanStack
 *    Suite" stack that AGENTS.md mandates adopting (TanStack Form for forms,
 *    Table for tables, Virtual for long lists). They are kept as planned deps
 *    and adopted where the UI needs them, not removed.
 *
 * 2. Route files export `Route` (the standard TanStack Router file-based route
 *    object) plus small pure helpers that are imported by unit tests. The
 *    `Route` export is the idiomatic pattern; the helpers are exported for test
 *    coverage, so the Fast-Refresh "only-export-components" and
 *    "unused-export" warnings are spurious for these files.
 */
export default defineConfig({
  ignore: {
    overrides: [
      {
        files: ["package.json"],
        rules: ["deslop/unused-dependency"],
      },
      {
        files: ["src/routes/**", "src/components/PriceTicker.tsx"],
        rules: ["react-doctor/only-export-components"],
      },
      {
        files: ["src/lib/liquidity.ts", "src/lib/playground.ts"],
        rules: ["deslop/unused-export"],
      },
      {
        // `no-noninteractive-tabindex`: DaisyUI's dropdown component relies on
        // `tabIndex={0}` on the `<ul>` for keyboard navigation. This is the
        // documented DaisyUI pattern (already biome-ignored at the call site).
        files: ["src/routes/swap.tsx"],
        rules: ["react-doctor/no-noninteractive-tabindex"],
      },
      {
        // `use-lazy-motion`: swap.tsx imports the full `framer-motion` barrel.
        // The route is code-split by TanStack Router, so the full import is
        // already isolated to the on-demand chunk; splitting it further adds
        // no real loading benefit on an already-lazy route.
        files: ["src/routes/swap.tsx"],
        rules: ["react-doctor/use-lazy-motion"],
      },
    ],
  },
})
