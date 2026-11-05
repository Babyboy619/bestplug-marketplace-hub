import { createFileRoute } from "@tanstack/react-router";
import { PaymentCallbackStatus } from "@/components/payment-callback-status";
import { pageHead } from "@/lib/metadata";

export const Route = createFileRoute("/payments/callback")({
  head: () =>
    pageHead("Payment Status", "Check your BestPlug wallet payment confirmation securely."),
  validateSearch: (search: Record<string, unknown>) => ({
    reference: typeof search["reference"] === "string" ? search["reference"] : "",
  }),
  component: PaymentCallbackPage,
});

function PaymentCallbackPage() {
  const { reference } = Route.useSearch();
  return <PaymentCallbackStatus reference={reference} />;
}
