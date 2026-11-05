import { Link } from "@tanstack/react-router";
import { createClientOnlyFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { CheckCircle2, Clock3, XCircle } from "lucide-react";
import { SiteFrame } from "@/components/site-frame";
import { Button } from "@/components/ui/button";
import { useAuthUser } from "@/hooks/use-auth-user";
import { useWalletBalance } from "@/hooks/use-wallet-balance";

const verifyWalletTopup = createClientOnlyFn(async (reference: string) => {
  const { verifyWalletTopup: verify } = await import("@/lib/paystark.client");
  return verify(reference);
});

export function PaymentCallbackStatus({ reference }: { reference: string }) {
  const { user, loading: authLoading } = useAuthUser();
  const { balance, refresh: refreshBalance } = useWalletBalance(user?.id);
  const [status, setStatus] = useState<"checking" | "success" | "pending" | "failed">("checking");
  const [message, setMessage] = useState("Checking payment with Paystack…");

  useEffect(() => {
    if (authLoading || !user || !reference) return;
    let active = true;
    void verifyWalletTopup(reference)
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
          void refreshBalance();
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
  }, [authLoading, reference, user, refreshBalance]);

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
          {status === "success" && balance !== null && (
            <p className="mt-3 text-sm font-medium">
              Updated wallet balance: ₦
              {balance.toLocaleString("en-NG", { minimumFractionDigits: 2 })}
            </p>
          )}
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
