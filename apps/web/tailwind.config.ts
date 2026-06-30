import type { Config } from "tailwindcss"
import daisyui from "daisyui"

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./src/routeTree.gen.ts",
  ],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [daisyui],
  daisyui: {
    themes: [
      {
        aetherdex: {
          primary: "#0EA5E9",
          "primary-content": "#FFFFFF",
          secondary: "#A855F7",
          accent: "#10B981",
          neutral: "#1F2937",
          "base-100": "#0A0A0B",
          "base-200": "#131316",
          "base-300": "#1F1F23",
          "base-content": "#F5F5F7",
          info: "#0EA5E9",
          success: "#10B981",
          warning: "#F59E0B",
          error: "#EF4444",
        },
      },
    ],
  },
} satisfies Config
