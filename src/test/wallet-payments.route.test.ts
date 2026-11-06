import { afterEach, describe, expect, it, vi } from "vitest";
import { Route as PaymentHealthRoute } from "@/routes/api/public/payment-health";
import { Route as WalletPaymentsRoute } from "@/routes/api/public/wallet-payments";

type Handler = (context: { request: Request }) => Promise<Response>;
type RouteHandlers = Record<string, Handler>;

function handlers(route: unknown): RouteHandlers {
  return (route as { options: { server: { handlers: RouteHandlers } } }).options.server.handlers;
}

function handler(route: unknown, method: string): Handler {
  const found = handlers(route)[method];
  if (!found) throw new Error(`Missing ${method} handler.`);
  return found;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("wallet payment production routes", () => {
  it("allows preflight from the custom domain and denies unknown origins", async () => {
    const options = handler(WalletPaymentsRoute, "OPTIONS");
    const allowed = await options({
      request: new Request("https://bestplugmarketplace.shop/api/public/wallet-payments", {
        method: "OPTIONS",
        headers: {
          Origin: "https://bestplugmarketplace.shop",
          "Access-Control-Request-Method": "POST",
        },
      }),
    });
    const denied = await options({
      request: new Request("https://bestplugmarketplace.shop/api/public/wallet-payments", {
        method: "OPTIONS",
        headers: { Origin: "https://untrusted.example" },
      }),
    });

    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://bestplugmarketplace.shop",
    );
    expect(denied.status).toBe(403);
  });

  it("rejects an unauthenticated initialization request with JSON", async () => {
    const post = handler(WalletPaymentsRoute, "POST");
    const response = await post({
      request: new Request("https://bestplugmarketplace.shop/api/public/wallet-payments", {
        method: "POST",
        headers: {
          Origin: "https://bestplugmarketplace.shop",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "initialize", amount: 1000 }),
      }),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://bestplugmarketplace.shop",
    );
    await expect(response.json()).resolves.toMatchObject({
      error: "Your session is invalid. Sign in again.",
    });
  });

  it("reports missing server credentials without returning secret values", async () => {
    vi.stubEnv("PAYSTARK_SECRET_KEY", "");
    vi.stubEnv("PAYSTARK_BASE_URL", "https://api.paystack.co");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");

    const get = handler(PaymentHealthRoute, "GET");
    const response = await get({
      request: new Request("https://bestplugmarketplace.shop/api/public/payment-health", {
        headers: { Origin: "https://bestplugmarketplace.shop" },
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toMatchObject({
      status: "degraded",
      paymentInitializationRoute: "available",
      paymentVerificationRoute: "available",
      paystackSecretConfigured: false,
      paystackApiUrlConfigured: true,
      databaseUrlConfigured: false,
      databaseServiceRoleConfigured: false,
    });
    expect(JSON.stringify(body)).not.toContain("test_secret_key");
  });
});
