import {
  getPaystackConfig,
  isRecord,
  settleVerified,
  verifyPaystackWebhookSignature,
} from "./paystack.server";

const MAX_BODY_BYTES = 262_144;

export async function handlePaystackWebhook(request: Request) {
  let config: ReturnType<typeof getPaystackConfig>;
  try {
    config = getPaystackConfig(request);
  } catch (error) {
    console.error("[paystack-webhook] configuration unavailable", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return Response.json({ error: "Webhook is not configured." }, { status: 503 });
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
    return Response.json({ error: "Request is too large." }, { status: 413 });
  }
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return Response.json({ error: "Request is too large." }, { status: 413 });
  }

  const signature = request.headers.get("x-paystack-signature") ?? "";
  if (!(await verifyPaystackWebhookSignature(rawBody, signature, config.secretKey))) {
    return Response.json({ error: "Invalid signature." }, { status: 401 });
  }

  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid event." }, { status: 400 });
  }
  if (!isRecord(event)) return Response.json({ error: "Invalid event." }, { status: 400 });
  if (event["event"] !== "charge.success") {
    return Response.json({ received: true, credited: false });
  }

  const data = event["data"];
  if (!isRecord(data) || typeof data["reference"] !== "string" || !data["reference"]) {
    return Response.json({ error: "Invalid payment reference." }, { status: 400 });
  }

  try {
    const settlement = await settleVerified(data["reference"], config);
    return Response.json({ received: true, credited: settlement.success });
  } catch (error) {
    console.error("[paystack-webhook] settlement failed", {
      reference: data["reference"],
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return Response.json({ error: "Settlement could not be completed." }, { status: 503 });
  }
}
