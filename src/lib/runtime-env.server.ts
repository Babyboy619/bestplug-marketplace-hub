import { getRequest } from "@tanstack/react-start/server";

type CloudflareRequestRuntime = {
  cloudflare?: {
    env?: Record<string, unknown>;
  };
};

function getCurrentRequest(): Request | undefined {
  try {
    return getRequest();
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("No StartEvent found in AsyncLocalStorage.")
    ) {
      return undefined;
    }
    throw error;
  }
}

export function getServerEnv(name: string, request?: Request): string | undefined {
  const activeRequest = request ?? getCurrentRequest();
  if (activeRequest) {
    const runtime = (activeRequest as Request & { runtime?: CloudflareRequestRuntime }).runtime;
    if (runtime?.cloudflare) {
      const value = runtime.cloudflare.env?.[name];
      return typeof value === "string" ? value : undefined;
    }
  }

  return process.env[name];
}

export function supabaseConfigMatchesBuild(
  runtimeUrl: string | undefined,
  runtimePublishableKey: string | undefined,
  buildUrl = import.meta.env["VITE_SUPABASE_URL"],
  buildPublishableKey = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"],
): boolean {
  if (!runtimeUrl || !runtimePublishableKey) return false;
  const normalizeUrl = (value: string) => value.replace(/\/+$/, "");
  return (
    (!buildUrl || normalizeUrl(buildUrl) === normalizeUrl(runtimeUrl)) &&
    (!buildPublishableKey || buildPublishableKey === runtimePublishableKey)
  );
}

export function getSupabaseRuntimeConfig(request?: Request) {
  const url = getServerEnv("SUPABASE_URL", request);
  const publishableKey = getServerEnv("SUPABASE_PUBLISHABLE_KEY", request);
  if (!url || !publishableKey) {
    const missing = [
      ...(!url ? ["SUPABASE_URL"] : []),
      ...(!publishableKey ? ["SUPABASE_PUBLISHABLE_KEY"] : []),
    ];
    throw new Error(`Missing Supabase environment variable(s): ${missing.join(", ")}.`);
  }
  if (!supabaseConfigMatchesBuild(url, publishableKey)) {
    throw new Error(
      "The browser and server Supabase configuration does not match. Set the same project URL and publishable key at build time and in Cloudflare bindings.",
    );
  }
  return { url, publishableKey };
}
