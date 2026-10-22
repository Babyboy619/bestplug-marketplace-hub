import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUpRight, Copy, Wallet } from "lucide-react";
import { SiteFrame } from "@/components/site-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuthUser } from "@/hooks/use-auth-user";
import { useWalletBalance } from "@/hooks/use-wallet-balance";
import { supabase } from "@/integrations/supabase/client";
import { pageHead } from "@/lib/metadata";
import { siteConfig } from "@/lib/site-config";
import { startPaystarkTopup, verifyPaystarkTopup } from "@/lib/paystark.functions";
import type { Database } from "@/integrations/supabase/types";

type Tx = Database["public"]["Tables"]["wallet_transactions"]["Row"];
type Order = Database["public"]["Tables"]["order_items"]["Row"];
type ParentOrder = Database["public"]["Tables"]["orders"]["Row"];
type OrderView = { item: Order; order: ParentOrder };
type PendingPayment = { reference: string; amount: number; authorizationUrl?: string };

export const Route = createFileRoute("/wallet")({
  head: () =>
    pageHead(
      "Wallet & orders",
      "Manage your BestPlug wallet, transaction history, and delivered purchases.",
    ),
  component: WalletPage,
});

function WalletPage() {
  const { user, loading } = useAuthUser();
  const { balance, balanceLoading, balanceError, refresh: refreshBalance } = useWalletBalance(
    user?.id,
  );
  const [transactions, setTransactions] = useState<Tx[]>([]);
  const [orders, setOrders] = useState<OrderView[]>([]);
  const [message, setMessage] = useState("");
  const [amount, setAmount] = useState("1000");
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(null);
  const startTopup = useServerFn(startPaystarkTopup);
  const verifyTopup = useServerFn(verifyPaystarkTopup);

  async function refresh() {
    const currentBalance = await refreshBalance();
    if (currentBalance === null) {
      setMessage("Your wallet balance could not be loaded. Please try again.");
      return;
    }
    const [tx, parentOrders] = await Promise.all([
      supabase
        .from("wallet_transactions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(30),
      supabase.from("orders").select("*").order("created_at", { ascending: false }).limit(30),
    ]);
    setTransactions(tx.data ?? []);
    if (parentOrders.error) {
      setMessage("Your orders could not be loaded. Please try again.");
      setOrders([]);
    } else if (parentOrders.data?.length) {
      const orderIds = parentOrders.data.map((order) => order.id);
      const { data: items, error: itemError } = await supabase
        .from("order_items")
        .select("*")
        .in("order_id", orderIds)
        .order("created_at", { ascending: false });
      if (itemError) {
        setMessage("Your order details could not be loaded. Please try again.");
        setOrders([]);
      } else {
        const ordersById = new Map(parentOrders.data.map((order) => [order.id, order]));
        setOrders(
          (items ?? []).flatMap((item) => {
            const order = ordersById.get(item.order_id);
            return order ? [{ item, order }] : [];
          }),
        );
      }
    } else {
      setOrders([]);
    }
    const { data: pending } = await supabase
      .from("payment_intents")
      .select("reference,amount,raw")
      .eq("provider", "paystack")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setPendingPayment(
      pending
        ? {
            reference: pending.reference,
            amount: Number(pending.amount),
            ...(typeof pending.raw === "object" &&
            pending.raw !== null &&
            "authorization_url" in pending.raw &&
            typeof pending.raw["authorization_url"] === "string"
              ? { authorizationUrl: pending.raw["authorization_url"] }
              : {}),
          }
        : null,
    );
  }

  useEffect(() => {
    if (!user) {
      setOrders([]);
      setTransactions([]);
      return;
    }
    void refresh();
    const handlePurchase = () => void refresh();
    window.addEventListener("bestplug-orders-updated", handlePurchase);
    return () => window.removeEventListener("bestplug-orders-updated", handlePurchase);
  }, [user]);

  return (
    <SiteFrame>
      <main className="mx-auto min-h-[65vh] max-w-7xl px-5 py-10 sm:px-8">
        <p className="text-xs uppercase text-primary">Your account</p>
        <h1 className="section-heading mt-2">Wallet & orders</h1>
        {loading ? (
          <p className="mt-8 text-muted-foreground">Loading your account…</p>
        ) : !user ? (
          <div className="mt-8 border-y border-border py-10">
            <Wallet className="size-8 text-primary" />
            <h2 className="mt-4 text-xl font-semibold">Your wallet is waiting.</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Sign in to see your balance and purchases.
            </p>
            <Button asChild className="mt-5">
              <Link to="/auth">
                Sign in
                <ArrowUpRight />
              </Link>
            </Button>
          </div>
        ) : (
          <>
            <div className="mt-7 grid gap-8 border-y border-border py-7 md:grid-cols-2">
              <div>
                <p className="text-sm text-muted-foreground">Available balance</p>
                <p
                  className="brand-title mt-3 text-4xl font-semibold text-primary"
                  aria-live="polite"
                >
                  {balanceLoading
                    ? "Loading…"
                    : balanceError || balance === null
                      ? "Balance unavailable"
                      : `₦${balance.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                </p>
                <p className="mt-3 text-xs text-muted-foreground">{user.email}</p>
              </div>
              <div className="self-center border-l-2 border-primary pl-5">
                <form
                  className="space-y-3"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    setPaymentBusy(true);
                    setMessage("");
                    try {
                      const started = await startTopup({ data: { amount: Number(amount) } });
                      setPendingPayment(started);
                      setMessage("Payment started. Complete checkout, then check its status here.");
                    } catch (error) {
                      setMessage(
                        error instanceof Error ? error.message : "Payment could not be started.",
                      );
                    } finally {
                      setPaymentBusy(false);
                    }
                  }}
                >
                  <label className="block text-sm font-semibold" htmlFor="funding-amount">
                    Fund Wallet (NGN)
                    <Input
                      id="funding-amount"
                      className="mt-2 max-w-48"
                      type="number"
                      min="100"
                      max="1000000"
                      step="0.01"
                      required
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      disabled={paymentBusy || Boolean(pendingPayment)}
                    />
                  </label>
                  <Button type="submit" disabled={paymentBusy || Boolean(pendingPayment)}>
                    {paymentBusy ? "Starting…" : "Continue to Paystack"}
                  </Button>
                </form>
              </div>
            </div>
            {pendingPayment && (
              <div className="mt-5 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4">
                <p className="min-w-0 flex-1 text-sm">
                  {siteConfig.paymentProviderName} payment of ₦
                  {pendingPayment.amount.toLocaleString()} is pending.
                </p>
                {pendingPayment.authorizationUrl && (
                  <Button asChild variant="outline">
                    <a
                      href={pendingPayment.authorizationUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open checkout <ArrowUpRight />
                    </a>
                  </Button>
                )}
                <Button
                  variant="outline"
                  disabled={paymentBusy}
                  onClick={async () => {
                    setPaymentBusy(true);
                    setMessage("");
                    try {
                      const result = await verifyTopup({
                        data: { reference: pendingPayment.reference },
                      });
                      setMessage(
                        result.error ??
                          (result.status === "success"
                            ? "Payment confirmed. Your wallet is updated."
                            : "Payment is still pending."),
                      );
                      if (result.status === "success" || result.status === "failed") {
                        setPendingPayment(null);
                        await refresh();
                      }
                    } catch (error) {
                      setMessage(
                        error instanceof Error
                          ? error.message
                          : "Payment status could not be checked.",
                      );
                    } finally {
                      setPaymentBusy(false);
                    }
                  }}
                >
                  Check payment
                </Button>
              </div>
            )}
            {message && (
              <p role="status" className="mt-4 text-sm text-primary">
                {message}
              </p>
            )}
            <section id="transactions" className="scroll-mt-24 py-8">
              <h2 className="text-xl font-semibold">Transaction history</h2>
              {transactions.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">No transactions yet.</p>
              ) : (
                transactions.map((tx) => (
                  <div
                    key={tx.id}
                    className="mt-4 flex justify-between gap-3 border-b border-border pb-4 text-sm"
                  >
                    <div>
                      <p>
                        {tx.description?.replace(/PayStark/gi, "Paystack") ?? "Wallet transaction"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {new Date(tx.created_at).toLocaleDateString()} · {tx.status}
                      </p>
                    </div>
                    <p className="shrink-0 text-primary">
                      {tx.type === "credit" ? "+" : "−"}₦{Number(tx.amount).toLocaleString()}
                    </p>
                  </div>
                ))
              )}
            </section>
            <section id="orders" className="scroll-mt-24 pb-8">
              <h2 className="text-xl font-semibold">Your purchases</h2>
              {orders.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">No purchases yet.</p>
              ) : (
                orders.map(({ item, order }) => {
                  const specifications =
                    typeof item.delivered_specifications === "object" &&
                    item.delivered_specifications !== null &&
                    !Array.isArray(item.delivered_specifications)
                      ? Object.entries(item.delivered_specifications)
                      : [];
                  return (
                    <article key={item.id} className="mt-4 border border-border p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="font-semibold">{item.title}</h3>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {item.platform ?? "Marketplace"}
                          </p>
                        </div>
                        <span className="text-xs capitalize text-primary">
                          Payment {order.status.replaceAll("_", " ")}
                        </span>
                      </div>
                      <dl className="mt-4 grid gap-3 border-y border-border py-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                        <div>
                          <dt className="text-xs text-muted-foreground">Order reference</dt>
                          <dd className="break-all">{order.id}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">Purchase price</dt>
                          <dd>
                            ₦
                            {Number(item.unit_price).toLocaleString("en-NG", {
                              minimumFractionDigits: 2,
                            })}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">Quantity</dt>
                          <dd>{item.quantity}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">Purchase date</dt>
                          <dd>{new Date(order.created_at).toLocaleString()}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">Delivery status</dt>
                          <dd>{item.delivered_payload ? "Delivered" : "Pending"}</dd>
                        </div>
                      </dl>
                      <details className="mt-3">
                        <summary className="cursor-pointer text-sm font-medium text-primary">
                          View delivered product details
                        </summary>
                        {specifications.length > 0 && (
                          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                            {specifications.map(([key, value]) => (
                              <div key={key}>
                                <dt className="text-xs text-muted-foreground">{key}</dt>
                                <dd className="whitespace-pre-wrap break-words">{String(value)}</dd>
                              </div>
                            ))}
                          </dl>
                        )}
                        <pre className="mt-3 whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-3 font-mono text-sm">
                          {item.delivered_payload ?? "Delivery pending"}
                        </pre>
                        {item.delivery_instructions && (
                          <p className="mt-3 whitespace-pre-wrap rounded-md border border-border p-3 text-sm">
                            {item.delivery_instructions}
                          </p>
                        )}
                        {item.delivered_payload && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mt-3"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(
                                  [item.delivered_payload, item.delivery_instructions]
                                    .filter(Boolean)
                                    .join("\n\n"),
                                );
                                setMessage("Order details copied.");
                              } catch {
                                setMessage(
                                  "Details could not be copied. Select and copy them manually.",
                                );
                              }
                            }}
                          >
                            <Copy aria-hidden="true" /> Copy details
                          </Button>
                        )}
                      </details>
                    </article>
                  );
                })
              )}
            </section>
          </>
        )}
      </main>
    </SiteFrame>
  );
}
