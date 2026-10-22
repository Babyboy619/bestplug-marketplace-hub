import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Clock3, Heart } from "lucide-react";
import { CatalogProductCard } from "@/components/catalog-product-card";
import { SiteFrame } from "@/components/site-frame";
import { Button } from "@/components/ui/button";
import { useAuthUser } from "@/hooks/use-auth-user";
import { supabase } from "@/integrations/supabase/client";
import type { CatalogProduct } from "@/lib/catalog.types";
type Mode = "wishlist" | "recentlyViewed";

export function SavedProductsPage({ mode }: { mode: Mode }) {
  const { user, loading: authLoading } = useAuthUser();
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const isWishlist = mode === "wishlist";

  const loadProducts = useCallback(async () => {
    if (!user) {
      setProducts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const savedRows = isWishlist
      ? await supabase
          .from("wishlist_items")
          .select("product_id,created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
      : await supabase
          .from("recently_viewed")
          .select("product_id,viewed_at")
          .eq("user_id", user.id)
          .order("viewed_at", { ascending: false });
    if (savedRows.error) {
      setError(true);
      setLoading(false);
      return;
    }
    const ids = (savedRows.data ?? []).map((row) => row.product_id);
    if (!ids.length) {
      setProducts([]);
      setLoading(false);
      return;
    }
    const { data, error: productError } = await supabase
      .from("products")
      .select("id,title,slug,description,price,currency,stock,product_status")
      .in("id", ids)
      .eq("published", true);
    if (productError) {
      setError(true);
      setLoading(false);
      return;
    }
    const productsById = new Map((data ?? []).map((product) => [product.id, product]));
    setProducts(ids.flatMap((id) => (productsById.has(id) ? [productsById.get(id)!] : [])));
    setLoading(false);
  }, [isWishlist, user]);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  const Icon = isWishlist ? Heart : Clock3;
  const title = isWishlist ? "Wishlist" : "Recently Viewed";
  return (
    <SiteFrame>
      <main className="mx-auto min-h-[65vh] max-w-7xl px-4 py-8 sm:px-8">
        <p className="text-xs font-semibold uppercase text-primary">Your account</p>
        <h1 className="section-heading mt-2">{title}</h1>
        {authLoading || loading ? (
          <p className="mt-8 text-sm text-muted-foreground">Loading products…</p>
        ) : !user ? (
          <div className="mt-8 border-y border-border py-10 text-center">
            <Icon className="mx-auto size-8 text-muted-foreground" />
            <h2 className="mt-4 font-semibold">
              Sign in to view your {isWishlist ? "wishlist" : "recently viewed products"}
            </h2>
            <Button asChild className="mt-5">
              <Link to="/auth">Sign in</Link>
            </Button>
          </div>
        ) : error ? (
          <p role="alert" className="mt-8 text-sm text-destructive">
            Saved products could not be loaded. Please try again.
          </p>
        ) : products.length === 0 ? (
          <div className="mt-8 border-y border-border py-10 text-center">
            <Icon className="mx-auto size-8 text-muted-foreground" />
            <h2 className="mt-4 font-semibold">
              {isWishlist ? "Your wishlist is empty." : "You haven't viewed any products yet."}
            </h2>
            <Button asChild className="mt-5">
              <Link to="/products">
                {isWishlist ? "Browse Products" : "Buy Account"} <ArrowRight />
              </Link>
            </Button>
          </div>
        ) : (
          <div className="mt-7 grid grid-cols-1 gap-4 min-[360px]:grid-cols-2 lg:grid-cols-3">
            {products.map((product) => (
              <CatalogProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </main>
    </SiteFrame>
  );
}
