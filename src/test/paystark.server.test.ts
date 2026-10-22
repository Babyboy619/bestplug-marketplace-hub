import { afterEach, describe, expect, it, vi } from "vitest";
import {
  initializePaystarkTransaction,
  verifyPaystarkTransaction,
  verifyPaystarkWebhookSignature,
  type PaystarkConfig,
} from "@/lib/paystark.server";

const config: PaystarkConfig = {
  secretKey: "test_secret_key",
  baseUrl: "https://api.paystack.co",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Paystack server adapter", () => {
  it("initializes a checkout with server-side authorization and minor-unit amount", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: true,
          data: {
            authorization_url: "https://checkout.paystack.com/test_access_code",
            access_code: "test_access_code",
            reference: "ps-test-reference",
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await initializePaystarkTransaction(config, {
      email: "customer@example.test",
      amountMinor: 12500,
      reference: "ps-test-reference",
      callbackUrl: "https://market.example.test/payments/callback",
    });

    expect(result.authorizationUrl).toBe("https://checkout.paystack.com/test_access_code");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.paystack.co/transaction/initialize",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test_secret_key" }),
        body: expect.stringContaining('"amount":12500'),
      }),
    );
  });

  it("confirms only the expected successful reference, amount, and currency", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: true,
            data: {
              status: "success",
              reference: "ps-test-reference",
              amount: 12500,
              currency: "NGN",
              id: 9,
            },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      verifyPaystarkTransaction(config, "ps-test-reference", 12500),
    ).resolves.toMatchObject({
      confirmed: true,
      pending: false,
      amountMinor: 12500,
      currency: "NGN",
      providerReference: "9",
    });
    await expect(
      verifyPaystarkTransaction(config, "ps-test-reference", 12501),
    ).resolves.toMatchObject({
      confirmed: false,
    });
  });

  it.each([
    {
      name: "failed payments",
      data: {
        status: "failed",
        reference: "ps-test-reference",
        amount: 12500,
        currency: "NGN",
      },
      pending: false,
    },
    {
      name: "pending payments",
      data: {
        status: "pending",
        reference: "ps-test-reference",
        amount: 12500,
        currency: "NGN",
      },
      pending: true,
    },
    {
      name: "a mismatched transaction reference",
      data: {
        status: "success",
        reference: "another-reference",
        amount: 12500,
        currency: "NGN",
      },
      pending: false,
    },
    {
      name: "a mismatched currency",
      data: {
        status: "success",
        reference: "ps-test-reference",
        amount: 12500,
        currency: "USD",
      },
      pending: false,
    },
  ])("does not confirm $name", async ({ data, pending }) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ status: true, data }), { status: 200 })),
    );

    await expect(
      verifyPaystarkTransaction(config, "ps-test-reference", 12500),
    ).resolves.toMatchObject({ confirmed: false, pending });
  });

  it("rejects a provider not-found response for an invalid reference", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ status: false, message: "Transaction reference not found." }),
            { status: 404 },
          ),
        ),
    );

    await expect(verifyPaystarkTransaction(config, "invalid-reference", 12500)).rejects.toThrow(
      "Paystack could not process the request",
    );
  });

  it("validates the provider webhook HMAC with SHA-512", async () => {
    const rawBody = JSON.stringify({ event: "charge.success" });
    const secret = "test_webhook_secret";
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-512" },
      false,
      ["sign"],
    );
    const signature = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)),
    );
    const signatureHex = Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );

    await expect(verifyPaystarkWebhookSignature(rawBody, signatureHex, secret)).resolves.toBe(true);
    await expect(
      verifyPaystarkWebhookSignature(rawBody, signatureHex, "wrong_secret"),
    ).resolves.toBe(false);
  });
});
