import { afterEach, describe, expect, it, vi } from "vitest";
import { getServerEnv, supabaseConfigMatchesBuild } from "@/lib/runtime-env.server";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Cloudflare runtime environment", () => {
  it("detects when browser and runtime Supabase settings point to different projects", () => {
    expect(
      supabaseConfigMatchesBuild(
        "https://runtime.example.test",
        "runtime-publishable-key",
        "https://browser.example.test",
        "runtime-publishable-key",
      ),
    ).toBe(false);
    expect(
      supabaseConfigMatchesBuild(
        "https://runtime.example.test",
        "runtime-publishable-key",
        "https://runtime.example.test/",
        "runtime-publishable-key",
      ),
    ).toBe(true);
    expect(
      supabaseConfigMatchesBuild(
        "https://runtime.example.test",
        "runtime-publishable-key",
        "https://runtime.example.test",
        "wrong-publishable-key",
      ),
    ).toBe(false);
  });

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
