import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Search, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SiteFrame } from "@/components/site-frame";
import { CatalogProductCard } from "@/components/catalog-product-card";
import { supabase } from "@/integrations/supabase/client";
import type { CatalogListingProduct } from "@/lib/catalog.types";

type Category = { id: string; name: string; slug: string };

export const Route = createFileRoute("/products")({
  validateSearch: (search: Record<string, unknown>): { category?: string; q?: string } => ({
    category: typeof search["category"] === "string" ? search["category"] : "",
    q: typeof search["q"] === "string" ? search["q"] : "",
  }),
  head: () => ({
    meta: [
      { title: "Browse Social Account Listings | BESTPLUG MARKETPLACE" },
      {
        name: "description",
        content: "Browse available social account listings by platform at BESTPLUG MARKETPLACE.",
      },
      { property: "og:title", content: "Browse Social Account Listings | BESTPLUG MARKETPLACE" },
      {
        property: "og:description",
        content: "Browse available account listings by social platform.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ProductListingPage,
});

function ProductListingPage() {
  const { category: initialCategory, q: initialQuery } = Route.useSearch();
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<CatalogListingProduct[]>([]);
  const [category, setCategory] = useState(initialCategory ?? "");
  const [query, setQuery] = useState(initialQuery ?? "");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([
      supabase
        .from("product_categories")
        .select("id,name,slug,image_url,description,display_order")
        .order("display_order")
        .order("name"),
      supabase
        .from("products")
        .select("id,category_id,title,slug,description,price,currency,stock,product_status")
        .eq("published", true)
        .order("created_at", { ascending: false }),
    ]).then(([categoryResult, productResult]) => {
      if (!active) return;
      if (categoryResult.error || productResult.error) {
        setLoadError(true);
      } else {
        setCategories(categoryResult.data ?? []);
        setProducts(productResult.data ?? []);
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const categorySlugs = useMemo(
    () => new Map(categories.map((item) => [item.id, item.slug])),
    [categories],
  );
  const matchingProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return products.filter((product) => {
      const matchesCategory =
        !category || categorySlugs.get(product.category_id ?? "") === category;
      const matchesQuery =
        !normalizedQuery ||
        `${product.title} ${product.description ?? ""}`.toLowerCase().includes(normalizedQuery);
      return matchesCategory && matchesQuery;
    });
  }, [category, categorySlugs, products, query]);

  return (
    <SiteFrame>
      <main className="mx-auto min-h-[62vh] max-w-7xl px-4 py-9 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-5 border-b border-border pb-6">
          <div>
            <p className="text-xs font-semibold uppercase text-primary">BESTPLUG MARKETPLACE</p>
            <h1 className="mt-2 text-3xl font-bold">Social account listings</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              Filter real listings by platform or search the catalog.
            </p>
          </div>
          <form
            role="search"
            onSubmit={(event) => event.preventDefault()}
            className="flex w-full max-w-sm gap-2"
          >
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search listings"
                placeholder="Search listings"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="rounded-md pl-9"
              />
            </div>
            <Button
              type="submit"
              variant="outline"
              aria-label="Search listings"
              className="rounded-md"
            >
              <Search className="size-4" />
            </Button>
          </form>
        </div>

        <div
          className="mt-6 flex gap-2 overflow-x-auto pb-1"
          aria-label="Filter by social platform"
        >
          <Button
            type="button"
            size="sm"
            variant={!category ? "default" : "outline"}
            onClick={() => setCategory("")}
            className="shrink-0 rounded-md"
          >
            All platforms
          </Button>
          {categories.map((item) => (
            <Button
              key={item.id}
              type="button"
              size="sm"
              variant={category === item.slug ? "default" : "outline"}
              onClick={() => setCategory(item.slug)}
              className="shrink-0 rounded-md"
            >
              {item.name}
            </Button>
          ))}
        </div>

        <div className="mt-7 flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">
            {category
              ? (categories.find((item) => item.slug === category)?.name ?? "Filtered")
              : "All listings"}
          </h2>
          {!loading && (
            <p className="text-xs text-muted-foreground">
              {matchingProducts.length} {matchingProducts.length === 1 ? "listing" : "listings"}
            </p>
          )}
        </div>

        {loading ? (
          <div
            className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
            aria-label="Loading listings"
          >
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="h-48 animate-pulse border border-border bg-secondary" />
            ))}
          </div>
        ) : loadError ? (
          <div
            role="status"
            className="mt-6 border-l-2 border-destructive bg-secondary/50 px-5 py-4 text-sm"
          >
            Listings could not be loaded just now. Please refresh to try again.
          </div>
        ) : matchingProducts.length > 0 ? (
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {matchingProducts.map((product) => {
              const categoryName = categories.find((item) => item.id === product.category_id)?.name;
              return (
                <CatalogProductCard
                  key={product.id}
                  product={product}
                  {...(categoryName ? { categoryName } : {})}
                />
              );
            })}
          </div>
        ) : (
          <div className="mt-6 border-y border-border py-12 text-center">
            <ShoppingBag className="mx-auto size-8 text-muted-foreground" />
            <h2 className="mt-4 text-lg font-semibold">No listings available yet</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              {query.trim() || category
                ? "Try another search or platform."
                : "New account listings will appear here when the shop catalog is stocked."}
            </p>
            {(category || query.trim()) && (
              <Button
                type="button"
                variant="outline"
                className="mt-4 rounded-md"
                onClick={() => {
                  setCategory("");
                  setQuery("");
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
        )}
      </main>
    </SiteFrame>
  );
}
