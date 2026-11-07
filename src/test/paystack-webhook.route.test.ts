import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPaystackConfig: vi.fn(),
  verifyPaystackWebhookSignature: vi.fn(),
  settleVerified: vi.fn(),
}));

vi.mock("@/lib/paystack.server", () => ({
  getPaystackConfig: mocks.getPaystackConfig,
  verifyPaystackWebhookSignature: mocks.verifyPaystackWebhookSignature,
  settleVerified: mocks.settleVerified,
  isRecord: (value: unknown) =>
    typeof value === "object" && value !== null && !Array.isArray(value),
}));

import { Route } from "@/routes/api/public/paystack-webhook";

type Handler = (context: { request: Request }) => Promise<Response>;
const post = (Route as unknown as { options: { server: { handlers: { POST: Handler } } } }).options
  .server.handlers.POST;
const config = { secretKey: "test-secret", baseUrl: "https://api.paystack.co" };
const event = {
  event: "charge.success",
  data: { reference: "ps-test-reference" },
};

function request(signature = "test-signature") {
  return new Request("https://bestplugmarketplace.shop/api/public/paystack-webhook", {
    method: "POST",
    headers: { "x-paystack-signature": signature },
    body: JSON.stringify(event),
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("Paystack webhook", () => {
  it("rejects an invalid signature without attempting settlement", async () => {
    mocks.getPaystackConfig.mockReturnValue(config);
    mocks.verifyPaystackWebhookSignature.mockResolvedValue(false);

    const response = await post({ request: request("invalid") });

    expect(response.status).toBe(401);
    expect(mocks.settleVerified).not.toHaveBeenCalled();
  });

  it("routes duplicate webhook deliveries through verified settlement", async () => {
    mocks.getPaystackConfig.mockReturnValue(config);
    mocks.verifyPaystackWebhookSignature.mockResolvedValue(true);
    mocks.settleVerified.mockResolvedValue({ success: true });

    const first = await post({ request: request() });
    const duplicate = await post({ request: request() });

    expect(first.status).toBe(200);
    expect(duplicate.status).toBe(200);
    expect(mocks.settleVerified).toHaveBeenCalledTimes(2);
    expect(mocks.settleVerified).toHaveBeenNthCalledWith(1, event.data.reference, config);
    expect(mocks.settleVerified).toHaveBeenNthCalledWith(2, event.data.reference, config);
  });
});
