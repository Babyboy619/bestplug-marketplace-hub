import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  ArrowUpRight,
  Crown,
  Search,
  ShieldCheck,
  ShoppingBag,
  UserRound,
  Wallet,
} from "lucide-react";
import { useEffect, useState } from "react";
import logo from "@/assets/bestplug-logo.jpg.asset.json";
import { SiteFrame } from "@/components/site-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuthUser } from "@/hooks/use-auth-user";
import { useWalletBalance } from "@/hooks/use-wallet-balance";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BESTPLUG MARKETPLACE | Social Media Accounts" },
      {
        name: "description",
        content: "Discover social media account listings at BESTPLUG MARKETPLACE.",
      },
      { property: "og:title", content: "BESTPLUG MARKETPLACE | Social Media Accounts" },
      {
        property: "og:description",
        content: "Your plug for social media accounts. Browse platforms and shop with your wallet.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  const { user } = useAuthUser();
  const { balance, balanceLoading, balanceError } = useWalletBalance(user?.id);
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [categories, setCategories] = useState<
    { id: string; name: string; slug: string; image_url: string | null }[]
  >([]);
  const [categoriesUnavailable, setCategoriesUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    void supabase
      .from("product_categories")
      .select("id,name,slug,image_url")
      .order("display_order")
      .order("name")
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          console.error("Marketplace categories could not be loaded:", error);
          setCategoriesUnavailable(true);
        } else {
          setCategories(data ?? []);
          setCategoriesUnavailable(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setDisplayName("");
      setAvatarUrl("");
      return;
    }

    let active = true;
    void supabase
      .from("profiles")
      .select("display_name,avatar_url")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data: profile }) => {
        if (!active) return;
        setDisplayName(profile?.display_name?.trim() ?? "");
        setAvatarUrl(profile?.avatar_url ?? "");
      });

    return () => {
      active = false;
    };
  }, [user]);

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void navigate({ to: "/products", search: { q: search.trim(), category: "" } });
  }

  return (
    <SiteFrame>
      <main>
        <section className="market-hero">
          <div className="hero-inner">
            <img className="hero-logo" src={logo.url} alt="BestPlug gold crown and plug logo" />
            <div className="hero-copy">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase text-primary">
                <Crown className="size-4" />
                Your next move starts here
              </p>
              <h1 className="brand-title hero-title">
                BESTPLUG
                <br />
                <span className="text-primary">MARKETPLACE.</span>
              </h1>
              <p className="mt-5 max-w-md text-base leading-7 text-muted-foreground">
                Social media accounts for your next big idea.
                <br className="hidden sm:block" /> Find the right platform. Get plugged in.
              </p>
              <form className="mt-7 flex max-w-md gap-2" role="search" onSubmit={submitSearch}>
                <div className="relative min-w-0 flex-1">
                  <Search className="absolute left-3 top-4 size-4 text-muted-foreground" />
                  <Input
                    className="h-12 bg-card pl-9"
                    placeholder="Search accounts & platforms"
                    aria-label="Search accounts"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
                <Button className="h-12" aria-label="Search marketplace">
                  <ArrowRight className="size-5" />
                </Button>
              </form>
              <div className="mt-5 flex flex-wrap gap-5 text-xs text-muted-foreground">
                <span className="flex items-center gap-2">
                  <ShieldCheck className="size-4 text-primary" />
                  Secure checkout
                </span>
                <span className="flex items-center gap-2">
                  <Wallet className="size-4 text-primary" />
                  Wallet payments
                </span>
              </div>
            </div>
          </div>
        </section>

        {user && (
          <section className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
            <div className="mb-5 flex items-center gap-3">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt=""
                  className="size-10 rounded-full border border-border object-cover"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex size-10 items-center justify-center rounded-full border border-border bg-secondary"
                >
                  <UserRound className="size-5 text-muted-foreground" />
                </span>
              )}
              <h2 className="text-2xl font-bold">
                Welcome back{displayName ? `, ${displayName}` : ""}
              </h2>
            </div>
            <div className="flex flex-col gap-4 rounded-xl border border-orange-200 bg-orange-50 p-5 text-slate-900 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold">Wallet Balance</p>
                <p className="mt-2 text-3xl font-bold tabular-nums">
                  {balanceLoading
                    ? "Loading…"
                    : balanceError
                      ? "Balance unavailable"
                      : balance === null
                        ? "Unavailable"
                        : `₦${balance.toLocaleString("en-NG", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}`}
                </p>
              </div>
              <Button
                asChild
                className="w-full bg-orange-500 text-white hover:bg-orange-600 sm:w-auto"
              >
                <Link to="/wallet">
                  Fund Wallet <Wallet aria-hidden="true" />
                </Link>
              </Button>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button asChild variant="outline">
                <Link to="/account-settings">Account settings</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/how-it-works">How it works</Link>
              </Button>
            </div>
          </section>
        )}

        <section className="border-b border-border">
          <div className="mx-auto max-w-7xl px-5 py-9 sm:px-8">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase text-primary">Find your platform</p>
                <h2 className="section-heading mt-2">Get connected.</h2>
              </div>
              <Button variant="ghost" asChild>
                <Link to="/products">
                  All accounts <ArrowUpRight className="size-4" />
                </Link>
              </Button>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              {categories.map((category) => (
                <Link
                  className="platform-tile"
                  key={category.id}
                  to="/products"
                  search={{ category: category.slug, q: "" }}
                >
                  <div>
                    {category.image_url ? (
                      <img
                        className="size-9 rounded object-cover"
                        src={category.image_url}
                        alt=""
                      />
                    ) : (
                      <span
                        className="brand-title block text-2xl font-bold text-primary"
                        aria-hidden="true"
                      >
                        {category.name.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                    <span className="mt-2 block text-xs font-medium">{category.name}</span>
                  </div>
                  <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              ))}
            </div>
            {!categories.length && (
              <p className="mt-5 text-sm text-muted-foreground">
                {categoriesUnavailable
                  ? "Categories could not be loaded right now."
                  : "No marketplace categories are active yet."}
              </p>
            )}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 py-10 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase text-primary">The marketplace</p>
              <h2 className="section-heading mt-2">Find your next account.</h2>
            </div>
            <Button asChild>
              <Link to="/products">
                Browse listings <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
          <div className="mt-7 flex items-center gap-4 border-y border-border py-6">
            <ShoppingBag className="size-8 shrink-0 text-primary" />
            <p className="text-sm leading-6 text-muted-foreground">
              Explore accounts by platform, availability, and price.
              <br />
              Your purchases and delivered details stay in your account.
            </p>
          </div>
        </section>
      </main>
    </SiteFrame>
  );
}
