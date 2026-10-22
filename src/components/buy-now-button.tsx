import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuthUser } from "@/hooks/use-auth-user";
import { purchaseProduct } from "@/lib/purchase.functions";
import type { ProductPurchaseResult } from "@/lib/purchase.types";

type BuyNowButtonProps = {
  productId: string;
  title: string;
  available: boolean;
  published: boolean;
  onPurchased?: (availableStock: number) => void;
  className?: string;
  fullWidth?: boolean;
};

export function BuyNowButton({
  productId,
  title,
  available,
  published,
  onPurchased,
  className,
  fullWidth = false,
}: BuyNowButtonProps) {
  const { user } = useAuthUser();
  const navigate = useNavigate();
  const purchase = useServerFn(purchaseProduct);
  const requestRef = useRef<string | null>(null);
  const productIdRef = useRef(productId);
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [result, setResult] = useState<ProductPurchaseResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    productIdRef.current = productId;
    requestRef.current = null;
    setBusy(false);
    setResult(null);
    setError(null);
    setDialogOpen(false);
  }, [productId]);

  async function buyNow() {
    if (!user) {
      await navigate({ to: "/auth" });
      return;
    }
    if (!requestRef.current) requestRef.current = crypto.randomUUID();
    const requestedProductId = productId;
    const request = requestRef.current;
    setBusy(true);
    setError(null);
    try {
      const response = await purchase({
        data: { productId: requestedProductId, request },
      });
      if (productIdRef.current !== requestedProductId) return;
      setResult(response);
      setDialogOpen(true);
      toast.success("Purchase successful! Your product details are available in Orders.");
      onPurchased?.(response.availableStock);
      window.dispatchEvent(new Event("bestplug-orders-updated"));
      window.dispatchEvent(new Event("bestplug-wallet-updated"));
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "The purchase could not be completed.";
      if (productIdRef.current !== requestedProductId) return;
      if (message.toLowerCase().includes("insufficient wallet balance")) {
        setError("Insufficient wallet balance. Please fund your wallet to purchase this product.");
      } else if (
        message.toLowerCase().includes("out of stock") ||
        message.toLowerCase().includes("just sold out") ||
        message.toLowerCase().includes("unavailable")
      ) {
        setError("This product is no longer available. Please choose another listing.");
        onPurchased?.(0);
      } else {
        setError(message);
      }
      setDialogOpen(true);
    } finally {
      setBusy(false);
    }
  }

  async function copyDelivery() {
    if (!result) return;
    const delivery = [result.deliveredPayload, result.deliveryInstructions]
      .filter(Boolean)
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(delivery);
      toast.success("Product details copied.");
    } catch {
      toast.error("Details could not be copied. Select and copy them manually.");
    }
  }

  return (
    <>
      <Button
        type="button"
        className={`${fullWidth ? "w-full" : ""} ${className ?? ""}`.trim()}
        disabled={busy || Boolean(result) || !available || !published}
        onClick={() => void buyNow()}
      >
        {busy
          ? "Processing…"
          : result
            ? "Purchased"
            : !published
              ? "Unavailable"
              : !available
                ? "Out of stock"
                : "Buy Now"}
      </Button>
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!busy) setDialogOpen(open);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {result ? "Purchase successful" : "Purchase could not be completed"}
            </DialogTitle>
            <DialogDescription>
              {result
                ? "Purchase successful! Your product details are available in Orders."
                : error}
            </DialogDescription>
          </DialogHeader>
          {result ? (
            <div className="space-y-4 text-sm">
              <dl className="grid gap-2 border-b border-border pb-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">Product</dt>
                  <dd className="font-medium">{result.title || title}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Platform</dt>
                  <dd>{result.platform}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Order reference</dt>
                  <dd className="break-all">{result.orderReference}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Price paid</dt>
                  <dd>
                    {new Intl.NumberFormat("en-NG", {
                      style: "currency",
                      currency: "NGN",
                    }).format(result.unitPrice)}
                  </dd>
                </div>
              </dl>
              <div>
                <h3 className="font-semibold">Your delivered details</h3>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-3 font-mono text-sm">
                  {result.deliveredPayload}
                </pre>
              </div>
              {result.deliveryInstructions && (
                <div>
                  <h3 className="font-semibold">Delivery instructions</h3>
                  <p className="mt-2 whitespace-pre-wrap rounded-md border border-border p-3">
                    {result.deliveryInstructions}
                  </p>
                </div>
              )}
              <Button type="button" variant="outline" onClick={() => void copyDelivery()}>
                <Copy aria-hidden="true" /> Copy details
              </Button>
            </div>
          ) : error?.startsWith("Insufficient wallet balance") ? (
            <p role="alert" className="rounded-md border border-destructive p-3 text-sm">
              {error}
            </p>
          ) : error ? (
            <p role="alert" className="rounded-md border border-destructive p-3 text-sm">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            {!result && error?.startsWith("Insufficient wallet balance") && (
              <Button asChild>
                <Link to="/wallet">Fund Wallet</Link>
              </Button>
            )}
            {result && (
              <Button asChild>
                <Link to="/wallet" hash="#orders">
                  View Order
                </Link>
              </Button>
            )}
            {!result && !error?.startsWith("Insufficient wallet balance") && (
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Close
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
