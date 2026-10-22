import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, Clock3, XCircle } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { SiteFrame } from "@/components/site-frame";
import { Button } from "@/components/ui/button";
import { useAuthUser } from "@/hooks/use-auth-user";
import { verifyPaystarkTopup } from "@/lib/paystark.functions";
import { pageHead } from "@/lib/metadata";

export const Route = createFileRoute("/payments/callback")({
  head: () => pageHead("Payment Status", "Check your BestPlug wallet payment confirmation securely."),
  validateSearch: (search: Record<string, unknown>) => ({
    reference: typeof search["reference"] === "string" ? search["reference"] : "",
  }),
  component: PaymentCallbackPage,
});

function PaymentCallbackPage() {
  const { reference } = Route.useSearch();
  const { user, loading: authLoading } = useAuthUser();
  const verify = useServerFn(verifyPaystarkTopup);
  const [status, setStatus] = useState<"checking" | "success" | "pending" | "failed">("checking");
  const [message, setMessage] = useState("Checking payment with Paystack…");

  useEffect(() => {
    if (authLoading || !user || !reference) return;
    let active = true;
    void verify({ data: { reference } })
      .then((result) => {
        if (!active) return;
        setStatus(
          result.status === "success"
            ? "success"
            : result.status === "pending"
              ? "pending"
              : "failed",
        );
        setMessage(
          result.error ??
            (result.status === "success"
              ? "Your wallet has been updated."
              : "Payment has not been confirmed."),
        );
        if (result.status === "success") {
          window.dispatchEvent(new Event("bestplug-wallet-updated"));
        }
      })
      .catch(() => {
        if (!active) return;
        setStatus("pending");
        setMessage("We could not verify payment yet. Check again shortly.");
      });
    return () => {
      active = false;
    };
  }, [authLoading, reference, user, verify]);

  const Icon = status === "success" ? CheckCircle2 : status === "failed" ? XCircle : Clock3;
  return (
    <SiteFrame>
      <main className="mx-auto flex min-h-[65vh] max-w-xl items-center px-5 py-10">
        <section className="w-full rounded-xl border border-border bg-card p-6">
          <Icon aria-hidden="true" className="size-8 text-primary" />
          <h1 className="mt-4 text-xl font-semibold">
            {status === "success"
              ? "Payment confirmed"
              : status === "failed"
                ? "Payment not completed"
                : "Payment status"}
          </h1>
          <p role="status" className="mt-2 text-sm leading-6 text-muted-foreground">
            {authLoading
              ? "Loading your account…"
              : !user
                ? "Sign in to verify this payment."
                : message}
          </p>
          <div className="mt-5 flex gap-3">
            {!user && (
              <Button asChild>
                <Link to="/auth">Sign in</Link>
              </Button>
            )}
            <Button asChild variant="outline">
              <Link to="/wallet">Wallet & orders</Link>
            </Button>
          </div>
        </section>
      </main>
    </SiteFrame>
  );
}
