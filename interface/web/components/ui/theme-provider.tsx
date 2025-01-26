import type * as React from "react" // Changed import to import type
import { ThemeProvider as NextThemesProvider } from "next-themes";

interface ThemeProviderProps extends React.ComponentProps<typeof NextThemesProvider> { 
  children: React.ReactNode
}

const ThemeProvider = ({ children, ...props }: ThemeProviderProps) => {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>
}

export { ThemeProvider }
