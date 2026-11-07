import { createFileRoute } from "@tanstack/react-router";
import { getPaystarkConfig } from "@/lib/paystark.server";

const MAX_BODY_BYTES = 262_144;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const Route = createFileRoute("/api/public/paystack-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let config: ReturnType<typeof getPaystarkConfig>;
        try {
          config = getPaystarkConfig(request);
        } catch (error) {
          console.error("[paystack-webhook] configuration unavailable", {
            errorName: error instanceof Error ? error.name : "UnknownError",
          });
          return new Response("Unavailable", { status: 503 });
        }

        const contentLength = request.headers.get("content-length");
        if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
          return new Response("Too large", { status: 413 });
        }

        const body = await request.text();
        if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
          return new Response("Too large", { status: 413 });
        }

        const { validSignature, settleVerified } = await import("@/lib/paystack.server");
        const signature = request.headers.get("x-paystack-signature") ?? "";
        if (!(await validSignature(body, signature, config.secretKey))) {
          return new Response("Invalid signature", { status: 401 });
        }

        let event: unknown;
        try {
          event = JSON.parse(body);
        } catch {
          return new Response("Invalid event", { status: 400 });
        }

        if (!isRecord(event)) return new Response("Invalid event", { status: 400 });

        if (event["event"] !== "charge.success") return new Response("OK");

        const data = event["data"];
        if (!isRecord(data)) return new Response("Invalid payment event", { status: 400 });

        const reference = data["reference"];
        if (typeof reference !== "string" || reference.length === 0) {
          return new Response("Invalid payment reference", { status: 400 });
        }

        try {
          await settleVerified(reference, config.secretKey, config.baseUrl);
          return new Response("OK");
        } catch (error) {
          console.error("[paystack-webhook] settlement failed", {
            reference,
            errorName: error instanceof Error ? error.name : "UnknownError",
          });
          return new Response("Verification failed", { status: 503 });
        }
      },
    },
  },
});
