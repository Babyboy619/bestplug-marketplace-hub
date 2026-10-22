import { createFileRoute } from "@tanstack/react-router";

const MAX_BODY_BYTES = 262_144;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const Route = createFileRoute("/api/public/paystark-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["PAYSTARK_SECRET_KEY"];
        if (!secret) return Response.json({ error: "Webhook is not configured." }, { status: 503 });

        const contentLength = request.headers.get("content-length");
        if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
          return Response.json({ error: "Request is too large." }, { status: 413 });
        }

        const rawBody = await request.text();
        if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
          return Response.json({ error: "Request is too large." }, { status: 413 });
        }

        const { validSignature, settleVerified } = await import("@/lib/paystack.server");
        const signature = request.headers.get("x-paystack-signature") ?? "";
        if (!(await validSignature(rawBody, signature, secret))) {
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
          await settleVerified(
            data["reference"],
            secret,
            process.env["PAYSTARK_BASE_URL"] ?? "https://api.paystack.co",
          );
        } catch {
          return Response.json({ error: "Settlement could not be completed." }, { status: 503 });
        }
        return Response.json({ received: true, credited: true });
      },
    },
  },
});
