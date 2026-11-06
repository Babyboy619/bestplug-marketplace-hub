import { beforeEach, describe, expect, it, vi } from "vitest";
import { settleVerified } from "@/lib/paystack.server";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  getPaystarkConfig: vi.fn(),
  initializePaystarkTransaction: vi.fn(),
  verifyPaystarkTransaction: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: mocks.from, rpc: mocks.rpc },
}));

vi.mock("@/lib/paystark.server", () => ({
  getPaystarkConfig: mocks.getPaystarkConfig,
  initializePaystarkTransaction: mocks.initializePaystarkTransaction,
  verifyPaystarkTransaction: mocks.verifyPaystarkTransaction,
}));

import { initializeWalletTopup, verifyWalletTopup } from "@/lib/paystark.payment.server";

const config = { secretKey: "test_secret_key", baseUrl: "https://api.paystack.co" };
const intent = {
  reference: "ps-test-reference",
  amount: 1000,
  status: "pending",
  currency: "NGN",
};

function makeQuery(data: unknown = { reference: intent.reference }) {
  const query = {
    insert: vi.fn().mockResolvedValue({ error: null }),
    update: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  };
  query.update.mockReturnValue(query);
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return query;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPaystarkConfig.mockReturnValue(config);
  mocks.initializePaystarkTransaction.mockResolvedValue({
    authorizationUrl: "https://checkout.paystack.com/test-code",
    accessCode: "test-code",
    reference: intent.reference,
  });
  mocks.verifyPaystarkTransaction.mockResolvedValue({
    confirmed: true,
    pending: false,
    amountMinor: 100000,
    currency: "NGN",
    providerReference: "12345",
    payload: {},
  });
  mocks.rpc.mockResolvedValue({ data: null, error: null });
});

describe("wallet Paystack payment service", () => {
  it("creates a pending intent, converts naira to kobo, and saves checkout details", async () => {
    const query = makeQuery();
    mocks.from.mockReturnValue(query);

    const result = await initializeWalletTopup({
      userId: "user-1",
      email: "customer@example.test",
      amount: 1000,
      callbackUrl: "https://bestplugmarketplace.shop/payments/callback",
    });

    expect(result).toMatchObject({
      reference: expect.stringMatching(/^ps-/),
      authorizationUrl: "https://checkout.paystack.com/test-code",
      amount: 1000,
    });
    expect(query.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        provider: "paystack",
        amount: 1000,
        currency: "NGN",
        status: "pending",
      }),
    );
    expect(mocks.initializePaystarkTransaction).toHaveBeenCalledWith(
      config,
      expect.objectContaining({ email: "customer@example.test", amountMinor: 100000 }),
    );
    expect(query.update).toHaveBeenCalledWith(
      expect.objectContaining({
        provider_reference: "test-code",
        raw: expect.objectContaining({
          authorization_url: "https://checkout.paystack.com/test-code",
        }),
      }),
    );
  });

  it("marks an intent failed when Paystack initialization fails", async () => {
    const query = makeQuery();
    mocks.from.mockReturnValue(query);
    mocks.initializePaystarkTransaction.mockRejectedValue(new Error("invalid credentials"));

    await expect(
      initializeWalletTopup({
        userId: "user-1",
        email: "customer@example.test",
        amount: 1000,
        callbackUrl: "https://bestplugmarketplace.shop/payments/callback",
      }),
    ).rejects.toThrow("invalid credentials");

    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });

  it("rejects excessive decimal precision and malformed references before database access", async () => {
    await expect(
      initializeWalletTopup({
        userId: "user-1",
        email: "customer@example.test",
        amount: 100.001,
        callbackUrl: "https://bestplugmarketplace.shop/payments/callback",
      }),
    ).rejects.toThrow("Use at most two decimal places.");
    await expect(verifyWalletTopup("bad", "user-1")).rejects.toThrow();

    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("verifies a successful payment and calls the atomic wallet settlement RPC", async () => {
    const query = makeQuery(intent);
    mocks.from.mockReturnValue(query);

    await expect(verifyWalletTopup(intent.reference, "user-1")).resolves.toMatchObject({
      status: "success",
      amount: 1000,
      alreadyCredited: false,
    });
    expect(mocks.verifyPaystarkTransaction).toHaveBeenCalledWith(config, intent.reference, 100000);
    expect(mocks.rpc).toHaveBeenCalledWith("settle_paystack", {
      _reference: intent.reference,
      _amount: 1000,
      _currency: "NGN",
      _provider_id: "12345",
    });
  });

  it("does not settle a previously credited intent again", async () => {
    const query = makeQuery(intent);
    query.maybeSingle
      .mockResolvedValueOnce({ data: intent, error: null })
      .mockResolvedValueOnce({ data: { ...intent, status: "success" }, error: null });
    mocks.from.mockReturnValue(query);

    await verifyWalletTopup(intent.reference, "user-1");
    await expect(verifyWalletTopup(intent.reference, "user-1")).resolves.toMatchObject({
      status: "success",
      amount: 1000,
      alreadyCredited: true,
    });

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.verifyPaystarkTransaction).toHaveBeenCalledTimes(1);
  });

  it("acknowledges duplicate webhook delivery for an already successful intent", async () => {
    const query = makeQuery({ ...intent, status: "success", order_id: null });
    mocks.from.mockReturnValue(query);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      settleVerified(intent.reference, "test_secret_key", "https://api.paystack.co"),
    ).resolves.toMatchObject({ success: true, status: "success" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects malformed webhook references before querying the database", async () => {
    await expect(
      settleVerified("bad", "test_secret_key", "https://api.paystack.co"),
    ).rejects.toThrow();
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
