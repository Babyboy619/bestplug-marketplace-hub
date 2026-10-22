import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CatalogProductCard } from "@/components/catalog-product-card";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: React.PropsWithChildren) => <a>{children}</a>,
}));
vi.mock("@/components/buy-now-button", () => ({
  BuyNowButton: ({ available }: { available: boolean }) => (
    <button type="button" disabled={!available}>
      {available ? "Buy Now" : "Out of stock"}
    </button>
  ),
}));

const product = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Starter account",
  slug: "starter-account",
  description: "A ready-to-use account.",
  price: 2500,
  currency: "NGN",
  stock: 2,
  product_status: "published" as const,
};

describe("catalog product card purchase action", () => {
  it("shows Buy Now instead of wishlist or cart actions", () => {
    render(<CatalogProductCard product={product} categoryName="Instagram" />);

    expect(screen.getByRole("button", { name: "Buy Now" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /wishlist|cart/i })).not.toBeInTheDocument();
    expect(screen.getByText("Starter account")).toBeInTheDocument();
    expect(screen.getByText("Instagram")).toBeInTheDocument();
    expect(screen.getByText("2 available")).toBeInTheDocument();
  });

  it("disables buying when there is no stock", () => {
    render(<CatalogProductCard product={{ ...product, stock: 0 }} />);

    expect(screen.getByRole("button", { name: "Out of stock" })).toBeDisabled();
  });
});
