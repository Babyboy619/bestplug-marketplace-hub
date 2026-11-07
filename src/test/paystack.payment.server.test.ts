import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settleVerified } from "@/lib/paystack.server";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  getPaystackConfig: vi.fn(),
  initializePaystackTransaction: vi.fn(),
  verifyPaystackTransaction: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: mocks.from, rpc: mocks.rpc },
}));

vi.mock("@/lib/paystack.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paystack.server")>();
  return {
    ...actual,
    getPaystackConfig: mocks.getPaystackConfig,
    initializePaystackTransaction: mocks.initializePaystackTransaction,
    verifyPaystackTransaction: mocks.verifyPaystackTransaction,
  };
});

import { initializeWalletTopup, verifyWalletTopup } from "@/lib/paystack.payment.server";

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
  mocks.getPaystackConfig.mockReturnValue(config);
  mocks.initializePaystackTransaction.mockResolvedValue({
    authorizationUrl: "https://checkout.paystack.com/test-code",
    accessCode: "test-code",
    reference: intent.reference,
  });
  mocks.verifyPaystackTransaction.mockResolvedValue({
    confirmed: true,
    pending: false,
    amountMinor: 100000,
    currency: "NGN",
    providerReference: "12345",
    payload: {},
  });
  mocks.rpc.mockResolvedValue({ data: null, error: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
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
    expect(mocks.initializePaystackTransaction).toHaveBeenCalledWith(
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
    mocks.initializePaystackTransaction.mockRejectedValue(new Error("invalid credentials"));

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

  it("logs database diagnostics privately when intent insertion fails", async () => {
    const query = makeQuery();
    const databaseError = {
      code: "23503",
      message: "insert or update violates foreign key constraint",
      details: "Key (user_id) is not present in table profiles.",
      hint: "Check the profile record.",
    };
    query.insert.mockResolvedValue({ error: databaseError });
    mocks.from.mockReturnValue(query);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      initializeWalletTopup({
        userId: "user-1",
        email: "customer@example.test",
        amount: 1000,
        callbackUrl: "https://bestplugmarketplace.shop/payments/callback",
      }),
    ).rejects.toThrow("Your payment could not be recorded. Please try again.");

    expect(errorLog).toHaveBeenCalledWith(
      "[wallet-payments] database operation failed",
      expect.objectContaining({
        operationStage: "intent_insert",
        code: "23503",
        message: databaseError.message,
        details: databaseError.details,
        hint: databaseError.hint,
      }),
    );
    expect(errorLog.mock.calls[0]?.[1]).toHaveProperty("reference", expect.stringMatching(/^ps-/));
    errorLog.mockRestore();
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
    expect(mocks.verifyPaystackTransaction).toHaveBeenCalledWith(config, intent.reference, 100000);
    expect(mocks.rpc).toHaveBeenCalledWith("settle_paystack", {
      _reference: intent.reference,
      _amount: 1000,
      _currency: "NGN",
      _provider_id: "12345",
    });
  });

  it.each([
    {
      name: "failed transaction",
      checked: { confirmed: false, pending: false, amountMinor: 100000, currency: "NGN" },
      error: "Payment was not confirmed.",
    },
    {
      name: "wrong payment amount",
      checked: { confirmed: false, pending: false, amountMinor: 99999, currency: "NGN" },
      error: "Payment amount did not match.",
    },
    {
      name: "wrong payment currency",
      checked: { confirmed: false, pending: false, amountMinor: 100000, currency: "USD" },
      error: "Payment currency did not match.",
    },
    {
      name: "wrong payment reference",
      checked: { confirmed: false, pending: false, amountMinor: 100000, currency: "NGN" },
      error: "Payment was not confirmed.",
    },
  ])("does not credit a wallet for $name", async ({ checked, error }) => {
    const query = makeQuery(intent);
    query.maybeSingle
      .mockResolvedValueOnce({ data: intent, error: null })
      .mockResolvedValueOnce({ data: { ...intent, status: "failed" }, error: null });
    mocks.from.mockReturnValue(query);
    mocks.verifyPaystackTransaction.mockResolvedValue({
      ...checked,
      providerReference: "12345",
      payload: {},
    });

    await expect(verifyWalletTopup(intent.reference, "user-1")).resolves.toMatchObject({
      status: "failed",
      error,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("fail_paystack", { _reference: intent.reference });
    expect(mocks.rpc).not.toHaveBeenCalledWith("settle_paystack", expect.anything());
  });

  it("credits the wallet exactly once when callback verification repeats", async () => {
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
    expect(mocks.verifyPaystackTransaction).toHaveBeenCalledTimes(1);
  });

  it("acknowledges duplicate webhook delivery for an already successful intent", async () => {
    const query = makeQuery({ ...intent, status: "success", order_id: null });
    mocks.from.mockReturnValue(query);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(settleVerified(intent.reference, config)).resolves.toMatchObject({
      success: true,
      status: "success",
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("settles duplicate webhook verification only once", async () => {
    const query = makeQuery(intent);
    query.maybeSingle
      .mockResolvedValueOnce({ data: { ...intent, order_id: null }, error: null })
      .mockResolvedValueOnce({
        data: { ...intent, status: "success", order_id: null },
        error: null,
      });
    mocks.from.mockReturnValue(query);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: true,
          data: {
            status: "success",
            reference: intent.reference,
            amount: 100000,
            currency: "NGN",
            id: 12345,
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(settleVerified(intent.reference, config)).resolves.toMatchObject({
      success: true,
    });
    await expect(settleVerified(intent.reference, config)).resolves.toMatchObject({
      success: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("settle_paystack", {
      _reference: intent.reference,
      _amount: 1000,
      _currency: "NGN",
      _provider_id: "12345",
    });
  });

  it("rejects malformed webhook references before querying the database", async () => {
    await expect(settleVerified("bad", config)).rejects.toThrow();
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
