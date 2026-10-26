// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// The deploy snapshot excludes .env (gitignored), so the published build must not
// depend on it. These values are public client-side constants (project URL +
// publishable key), safe to inline. Platform-injected env always wins.
const cloudEnv = {
  VITE_SUPABASE_PROJECT_ID: "nsijvmigmnlmvubtfwff",
  VITE_SUPABASE_URL: "https://c--713e53d8-f294-43e9-a8ee-6aa6655a9809-prod.lovable.cloud",
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_QbfkiRKCgLrXBS51H42_nA_egMArRVM",
} as const;
for (const [key, value] of Object.entries(cloudEnv)) {
  if (!process.env[key]) process.env[key] = value;
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
