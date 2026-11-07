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
