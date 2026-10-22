import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SiteFrame } from "@/components/site-frame";
import { Button } from "@/components/ui/button";
import { ShoppingCart } from "lucide-react";
import { useAuthUser } from "@/hooks/use-auth-user";
import { supabase } from "@/integrations/supabase/client";
import { addCartItem } from "@/lib/cart";
import { BuyNowButton } from "@/components/buy-now-button";
import type { CatalogProduct } from "@/lib/catalog.types";
import { pageHead } from "@/lib/metadata";
import type { Database } from "@/integrations/supabase/types";
type Product = CatalogProduct & Pick<Database["public"]["Tables"]["products"]["Row"], "metadata">;
export const Route = createFileRoute("/products/$slug")({
  head: () =>
    pageHead(
      "Account details",
      "View account details, stock and wallet checkout at BESTPLUG MARKETPLACE.",
    ),
  component: Details,
});
function Details() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const { user } = useAuthUser();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [cartBusy, setCartBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setMessage("");
    void supabase
      .from("products")
      .select("id,title,slug,description,price,currency,stock,product_status,metadata")
      .eq("slug", slug)
      .eq("published", true)
      .is("archived_at", null)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        setProduct(data);
        setLoading(false);
        if (error) setMessage(error.message);
      });
    return () => {
      active = false;
    };
  }, [slug]);
  useEffect(() => {
    if (!user || !product) return;
    void supabase.from("recently_viewed").upsert(
      {
        user_id: user.id,
        product_id: product.id,
        viewed_at: new Date().toISOString(),
      },
      { onConflict: "user_id,product_id" },
    );
  }, [product, user]);
  return (
    <SiteFrame>
      <main className="mx-auto min-h-[65vh] max-w-4xl px-5 py-10">
        <Link className="text-sm text-primary" to="/products">
          ← Marketplace
        </Link>
        {loading ? (
          <p className="mt-8">Loading account…</p>
        ) : !product ? (
          <div className="py-12">
            <h1 className="section-heading">Account unavailable</h1>
            <p className="mt-3 text-muted-foreground">This listing is not available.</p>
          </div>
        ) : (
          <div className="mt-8">
            <div>
              <p className="text-xs uppercase text-primary">BESTPLUG MARKETPLACE</p>
              <h1 className="section-heading mt-3">{product.title}</h1>
              <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">
                {product.description}
              </p>
              <p className="brand-title mt-6 text-3xl text-primary">
                {new Intl.NumberFormat("en-NG", {
                  style: "currency",
                  currency: product.currency,
                }).format(Number(product.price))}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {product.product_status !== "published"
                  ? "Unavailable"
                  : product.stock > 0
                    ? `${product.stock} available`
                    : "Out of stock"}
              </p>
              {product.metadata &&
                typeof product.metadata === "object" &&
                !Array.isArray(product.metadata) &&
                product.metadata["specifications"] &&
                typeof product.metadata["specifications"] === "object" &&
                !Array.isArray(product.metadata["specifications"]) && (
                  <dl className="mt-5 grid gap-2 border-t border-border pt-4 text-sm sm:grid-cols-2">
                    {Object.entries(product.metadata["specifications"]).map(([label, value]) =>
                      typeof value === "string" ? (
                        <div key={label}>
                          <dt className="text-xs text-muted-foreground">{label}</dt>
                          <dd>{value}</dd>
                        </div>
                      ) : null,
                    )}
                  </dl>
                )}
              {product.metadata &&
                typeof product.metadata === "object" &&
                !Array.isArray(product.metadata) &&
                typeof product.metadata["delivery_instructions"] === "string" &&
                product.metadata["delivery_instructions"] && (
                  <p className="mt-4 whitespace-pre-wrap rounded-md border border-border p-3 text-sm">
                    {product.metadata["delivery_instructions"]}
                  </p>
                )}
              <Button
                type="button"
                variant="outline"
                className="mt-5"
                disabled={cartBusy || product.stock === 0 || product.product_status !== "published"}
                onClick={async () => {
                  if (!user) {
                    await navigate({ to: "/auth" });
                    return;
                  }
                  setCartBusy(true);
                  try {
                    await addCartItem(user.id, product.id);
                    window.dispatchEvent(new Event("bestplug-cart-updated"));
                    setMessage("Added to cart.");
                  } catch (error) {
                    setMessage(
                      error instanceof Error
                        ? error.message
                        : "This product could not be added to your cart.",
                    );
                  } finally {
                    setCartBusy(false);
                  }
                }}
              >
                <ShoppingCart aria-hidden="true" /> {cartBusy ? "Adding…" : "Add to Cart"}
              </Button>
              <BuyNowButton
                productId={product.id}
                title={product.title}
                available={product.stock > 0}
                published={product.product_status === "published"}
                onPurchased={(availableStock) =>
                  setProduct((current) =>
                    current
                      ? {
                          ...current,
                          stock: availableStock,
                          product_status:
                            availableStock === 0 ? "unavailable" : current.product_status,
                        }
                      : current,
                  )
                }
                className="mt-6"
              />
            </div>
          </div>
        )}
        {message && (
          <p role="status" className="mt-5 text-sm text-primary">
            {message}
          </p>
        )}
      </main>
    </SiteFrame>
  );
}
