import { afterEach, describe, expect, it, vi } from "vitest";
import { getServerEnv } from "@/lib/runtime-env.server";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Cloudflare runtime environment", () => {
  it("prefers request bindings over process environment", () => {
    vi.stubEnv("SUPABASE_URL", "https://build-time.example.test");
    const request = new Request("https://bestplugmarketplace.shop");
    Object.defineProperty(request, "runtime", {
      value: {
        name: "cloudflare",
        cloudflare: { env: { SUPABASE_URL: "https://runtime.example.test" } },
      },
    });

    expect(getServerEnv("SUPABASE_URL", request)).toBe("https://runtime.example.test");
  });

  it("does not fall back to process environment when a Cloudflare binding is absent", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "build-time-secret");
    const request = new Request("https://bestplugmarketplace.shop");
    Object.defineProperty(request, "runtime", {
      value: { name: "cloudflare", cloudflare: { env: {} } },
    });

    expect(getServerEnv("SUPABASE_SERVICE_ROLE_KEY", request)).toBeUndefined();
  });
});
