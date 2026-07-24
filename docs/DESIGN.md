# AetherDEX frontend design contract

This document records the visual language already present in `apps/web/`. New UI should extend
these primitives instead of introducing a parallel system.

## Tokens

- **Surface:** DaisyUI `base-100` page background, `base-200` cards/header, `base-300` borders.
- **Accent:** DaisyUI `primary` for wallet actions, selected controls, links, and the main CTA.
- **Status:** `success` for confirmed local state, `warning` for configuration caveats, `error` for
  validation and connection failures.
- **Type:** system sans for readable UI; `font-mono text-xs` for addresses, ticks, and raw values.
- **Shape:** DaisyUI defaults; cards use bordered `bg-base-200`, controls use `input-bordered` and
  compact `btn` variants.
- **Spacing:** Tailwind's 4px scale, with `gap-4`/`gap-6` for layout grouping and `mb-4`/`mb-6`
  for section rhythm.

## Primitives and states

- `Card`/`CardBody`: grouped content and form sections; bordered by default.
- `Button`: `primary` for the main action, `ghost`/`outline` for secondary controls; `loading`
  disables the button and shows a spinner.
- `Input`: always labeled; `error` renders inline validation text and `input-error` styling.
- Segmented choices use a DaisyUI `join`, with `btn-primary` for the selected option.
- Forms must show disconnected, invalid, pending/protected, and unavailable/not-configured states.

## Accessibility and responsive rules

- Every field has a visible label and a stable `id`; validation is associated with the field.
- Buttons remain keyboard reachable with visible DaisyUI focus styles.
- Form layouts collapse to one column below `md`; actions span the available width on small screens.
- On-chain actions must describe what is and is not wired. Never show a successful transaction state
  without a submitted transaction hash or receipt.
