import { createFileRoute } from "@tanstack/react-router";
import { handlePaystackWebhook } from "@/lib/paystack-webhook.server";

export const Route = createFileRoute("/api/public/paystark-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => handlePaystackWebhook(request),
    },
  },
});
