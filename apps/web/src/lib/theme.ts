export type Theme = "aetherdex" | "light"

export const STORAGE_KEY = "aetherdex-theme"

const isTheme = (value: unknown): value is Theme => value === "aetherdex" || value === "light"

/**
 * Read the persisted theme. Returns null when unset, invalid, or storage is
 * unavailable (private mode, sandboxed iframe) so callers fall back gracefully.
 */
export function getStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isTheme(stored) ? stored : null
  } catch {
    return null
  }
}

/**
 * Persist the theme. Silently no-ops when storage is unavailable so the UI
 * still flips the theme for the current session.
 */
export function persistTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // storage blocked — theme still applies for this session
  }
}

/**
 * Apply the stored theme to <html data-theme>. Called at module evaluation in
 * main.tsx, before React mounts, to prevent a flash of the default theme.
 */
export function applyStoredTheme(): void {
  document.documentElement.setAttribute("data-theme", getStoredTheme() ?? "aetherdex")
}
