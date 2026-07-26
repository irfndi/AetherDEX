import daisyui from "daisyui"
import type { Config } from "tailwindcss"

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}", "./src/routeTree.gen.ts"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
      },
    },
  },
  plugins: [daisyui],
  daisyui: {
    themes: [
      {
        aetherdex: {
          "color-scheme": "dark",
          "--color-primary": "#7170FF",
          "--color-primary-content": "#FFFFFF",
          "--color-secondary": "#191A1B",
          "--color-accent": "#7170FF",
          "--color-neutral": "#191A1B",
          "--color-neutral-content": "#F7F8F8",
          "--color-base-100": "#08090A",
          "--color-base-200": "#0F1011",
          "--color-base-300": "#191A1B",
          "--color-base-content": "#F7F8F8",
          "--color-info": "#7170FF",
          "--color-success": "#22C55E",
          "--color-warning": "#F59E0B",
          "--color-error": "#EF4444",
        },
        light: {
          "color-scheme": "light",
          "--color-primary": "#4F46E5",
          "--color-primary-content": "#FFFFFF",
          "--color-secondary": "#E5E7EB",
          "--color-accent": "#4F46E5",
          "--color-neutral": "#111827",
          "--color-neutral-content": "#FFFFFF",
          "--color-base-100": "#F8FAFC",
          "--color-base-200": "#F1F5F9",
          "--color-base-300": "#E2E8F0",
          "--color-base-content": "#111827",
          "--color-info": "#4F46E5",
          "--color-success": "#16A34A",
          "--color-warning": "#D97706",
          "--color-error": "#DC2626",
        },
      },
    ],
  },
} satisfies Config
