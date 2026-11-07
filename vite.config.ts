// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { loadEnv } from "vite";

const mode = process.argv.includes("build") ? "production" : "development";
const fileEnv = loadEnv(mode, process.cwd(), [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_PAYMENT_GATEWAY_URL",
]);
const publicSupabaseUrl =
  process.env["SUPABASE_URL"] ||
  fileEnv["SUPABASE_URL"] ||
  process.env["VITE_SUPABASE_URL"] ||
  fileEnv["VITE_SUPABASE_URL"] ||
  "";
const publicSupabaseKey =
  process.env["SUPABASE_PUBLISHABLE_KEY"] ||
  fileEnv["SUPABASE_PUBLISHABLE_KEY"] ||
  process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
  fileEnv["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
  "";
const paymentGatewayUrl =
  process.env["VITE_PAYMENT_GATEWAY_URL"] ||
  fileEnv["VITE_PAYMENT_GATEWAY_URL"] ||
  "https://bestplugmarketplace.shop";

if (mode === "production" && (!publicSupabaseUrl || !publicSupabaseKey)) {
  throw new Error(
    "Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in the Cloudflare build environment before building.",
  );
}

export default defineConfig({
  // The wrapper's VITE_* loader and Vite's default env prefix can expose
  // secrets accidentally. Only the explicitly listed public values are defined.
  envDefine: false,
  vite: {
    envPrefix: [],
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(publicSupabaseUrl),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(publicSupabaseKey),
      "import.meta.env.VITE_PAYMENT_GATEWAY_URL": JSON.stringify(paymentGatewayUrl),
    },
  },
  tanstackStart: {
    server: { entry: "server" },
  },
});
