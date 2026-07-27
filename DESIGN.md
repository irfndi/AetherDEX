# AetherDEX Design System

## 0. Research Log

- Direction: modern black-first product UI for an autonomous concentrated-liquidity platform.
- References shortlisted from the local design library: Linear, Vercel, and Uber.
- Selected references: `minimalist-skill.md` for restraint, hierarchy, and tonal surfaces; `linear.app.md` for a near-black canvas, indigo interaction color, quiet borders, and compact product density.
- The user preference is the governing decision: black is the default, with no light-first palette and no decorative gradients.
- External image search and image generation were not used. This redesign is a product-system change, and the embedded reference guidance already supplied the needed palette and layout principles.

## 1. Atmosphere & Identity

AetherDEX should feel like a calm professional command center for liquidity decisions: dark, precise, dense where data matters, and generous around the primary action. The signature is tonal black surfaces with a restrained indigo action line. DeFi state colors are reserved for status, not branding.

## 2. Color

The semantic theme is implemented through DaisyUI tokens so every route inherits the same visual language.

| Token | Value | Use |
| --- | --- | --- |
| `base-100` | `#08090a` | application canvas |
| `base-200` | `#0f1011` | cards and navigation |
| `base-300` | `#191a1b` | elevated controls and borders |
| `base-content` | `#f7f8f8` | primary text |
| secondary text | `#d0d6e0` | supporting copy |
| muted text | `#8a8f98` | labels and metadata |
| subtle text | `#62666d` | hints and disabled copy |
| primary | `#a5b4fc` | focused actions and selected state |
| success | `#22c55e` | healthy/confirmed state |
| warning | `#f59e0b` | attention state |
| error | `#ef4444` | rejected/failed state |

Borders are low-contrast white overlays. Shadows are used sparingly; hierarchy comes from tonal elevation. Accent color is never used as a page wash. Primary controls use near-black text on the lifted indigo to preserve normal-text contrast.

## 3. Typography

Use `Inter` when available, then the system sans stack: `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. Numeric values and transaction identifiers use a system monospace stack. The scale favors compact product UI: 12px metadata, 14px body/control text, 16px card titles, 20–28px page titles. Use regular, medium, and semibold weights only.

## 4. Spacing & Layout

Use a 4px base rhythm with 8px as the common control gap. The application content is capped near 1200px and remains fluid below that width. Responsive grids use `minmax(min(16rem, 100%), 1fr)` or explicit mobile stacks. Every route must fit a 375px viewport without horizontal scrolling. Navigation wraps deliberately rather than shrinking controls below usable tap targets.

## 5. Components

- **App shell:** black canvas, quiet navigation surface, visible focus states, and a compact wallet action.
- **Card:** `base-200` tonal surface with a whisper border; compact variants reduce padding without changing hierarchy.
- **Button:** indigo for the single primary action, neutral/ghost for secondary actions, and explicit disabled/loading states.
- **Input:** full-width, black elevated field with a visible indigo focus ring and error text below the control.
- **Token search:** searchable field and selection trigger are separate controls with distinct labels.
- **Status panel:** loading, empty, success, and error states always include text, not color alone.
- **Segmented control:** separate buttons with visible gaps; selected state uses primary, unselected state uses neutral/ghost.

## 6. Motion

Motion is functional only: 120–200ms opacity and transform transitions for menus, selection, and route changes. Avoid continuous glow, floating, or pulse effects. Respect `prefers-reduced-motion`.

## 7. Depth & Surface Treatment

The depth stack is `base-100 → base-200 → base-300`. Use borders and small tonal shifts before shadows. Avoid glassmorphism, large blur fields, triple radial gradients, and identical “glow card” treatments across the product.

## 8. Accessibility & Accepted Debt

Target WCAG 2.2 AA contrast, keyboard-complete controls, visible focus, semantic labels, and touch targets of at least 40px. Loading and validation states must be announced or text-described. Accepted debt for this pass: wallet-provider warnings in local fallback mode and live Cloudflare/private-RPC validation remain infrastructure work, not visual-system work.
