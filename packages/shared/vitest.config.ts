import { defineConfig } from "vitest/config"

// Local config so `vitest run` from this package does not pick up the root
// config, whose `projects` list resolves `./apps/web` against the caller's
// CWD and breaks from a package directory.
export default defineConfig({})
