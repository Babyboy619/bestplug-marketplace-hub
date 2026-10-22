import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { BuyNowButton } from "@/components/buy-now-button";
import type { CatalogProduct } from "@/lib/catalog.types";

export function CatalogProductCard({
  product,
  categoryName,
}: {
  product: CatalogProduct;
  categoryName?: string;
}) {
  const [stock, setStock] = useState(product.stock);

  useEffect(() => setStock(product.stock), [product.stock]);

  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-1 flex-col p-4">
        <div className="min-w-0">
          <h2 className="line-clamp-2 font-semibold">{product.title}</h2>
          {categoryName && (
            <p className="mt-1 text-xs font-medium text-primary" aria-label="Platform">
              {categoryName}
            </p>
          )}
        </div>
        {product.description && (
          <p className="mt-2 line-clamp-2 text-sm leading-5 text-muted-foreground">
            {product.description}
          </p>
        )}
        <div className="mt-auto flex items-end justify-between gap-3 pt-4">
          <div>
            <p className="font-semibold">
              {new Intl.NumberFormat("en-NG", {
                style: "currency",
                currency: product.currency || "NGN",
                maximumFractionDigits: 2,
              }).format(Number(product.price))}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {product.product_status !== "published"
                ? "Unavailable"
                : stock > 0
                  ? `${stock} available`
                  : "Out of stock"}
            </p>
          </div>
        </div>
        <BuyNowButton
          productId={product.id}
          title={product.title}
          available={stock > 0}
          published={product.product_status === "published"}
          onPurchased={setStock}
          fullWidth
          className="mt-3"
        />
        <Button asChild variant="ghost" className="mt-2 justify-between px-0">
          <Link to="/products/$slug" params={{ slug: product.slug }}>
            View product <span aria-hidden="true">→</span>
          </Link>
        </Button>
      </div>
    </article>
  );
}
