import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyNeuraPayTransaction, type NeuraPayConfig } from "@/lib/neurapay.server";

const config: NeuraPayConfig = {
  baseUrl: "https://neurapay.example.test/api/v1",
  secretKey: "test_secret",
  businessId: "test_business",
  webhookSecret: "test_webhook_secret",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("NeuraPay transaction verification", () => {
  it("confirms a paid transaction only when its amount and currency match", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: "success",
            amount: 1000,
            currency: "ngn",
            transaction_id: "provider-transaction",
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(
      verifyNeuraPayTransaction(config, "merchant-reference", 1000),
    ).resolves.toMatchObject({
      confirmed: true,
      status: "success",
      providerReference: "provider-transaction",
    });
  });

  it.each([
    { name: "a missing currency", currency: undefined },
    { name: "a different currency", currency: "USD" },
  ])("does not confirm a paid transaction with $name", async ({ currency }) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: "success",
            amount: 1000,
            ...(currency ? { currency } : {}),
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(
      verifyNeuraPayTransaction(config, "merchant-reference", 1000),
    ).resolves.toMatchObject({
      confirmed: false,
      status: "failed",
      reason: "currency_mismatch",
    });
  });

  it("does not confirm a paid transaction with a different amount", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: "paid", amount: 999, currency: "NGN" }), {
          status: 200,
        }),
      ),
    );

    await expect(
      verifyNeuraPayTransaction(config, "merchant-reference", 1000),
    ).resolves.toMatchObject({
      confirmed: false,
      status: "failed",
      reason: "amount_mismatch",
    });
  });
});
