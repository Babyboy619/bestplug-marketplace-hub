import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Check, Search, Wallet } from "lucide-react";
import { SiteFrame } from "@/components/site-frame";
import { Button } from "@/components/ui/button";
import { pageHead } from "@/lib/metadata";

export const Route = createFileRoute("/how-it-works")({
  head: () => pageHead("How It Works", "Browse BestPlug listings, fund your wallet, and find your account delivery."),
  component: HowItWorksPage,
});

const steps = [
  {
    title: "Browse listings",
    detail: "Explore published accounts and filter by the categories in the catalog.",
    icon: Search,
  },
  {
    title: "Review the listing",
    detail: "Check its description, current price, and stock before choosing a quantity.",
    icon: Check,
  },
  {
    title: "Pay with your wallet",
    detail:
      "Sign in and confirm a purchase using your wallet. The server validates stock, price, and funds atomically.",
    icon: Wallet,
  },
  {
    title: "View your delivery",
    detail: "Completed orders and delivered details appear in Wallet & orders.",
    icon: ArrowRight,
  },
];

function HowItWorksPage() {
  return (
    <SiteFrame>
      <main className="mx-auto min-h-[65vh] max-w-4xl px-5 py-10 sm:px-8">
        <p className="text-xs font-semibold uppercase text-primary">A quick guide</p>
        <h1 className="mt-2 text-3xl font-bold">How It Works</h1>
        <ol className="mt-7 divide-y divide-border border-y border-border">
          {steps.map(({ title, detail, icon: Icon }, index) => (
            <li key={title} className="flex gap-4 py-5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
                <Icon aria-hidden="true" className="size-5" />
              </span>
              <div>
                <p className="text-xs font-semibold text-muted-foreground">STEP {index + 1}</p>
                <h2 className="mt-1 font-semibold">{title}</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{detail}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-5 text-sm leading-6 text-muted-foreground">
          Fund your wallet through Paystack. Payments are checked with the provider before your
          balance is updated.
        </p>
        <Button asChild className="mt-5">
          <Link to="/products">
            Browse accounts <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </main>
    </SiteFrame>
  );
}
