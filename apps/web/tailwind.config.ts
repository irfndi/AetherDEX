import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        aether: 'hsl(200 100% 50%)',
        'aether-foreground': 'hsl(0 0% 100%)',
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
export default config
