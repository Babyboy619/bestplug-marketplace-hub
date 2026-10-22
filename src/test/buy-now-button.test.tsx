import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BuyNowButton } from "@/components/buy-now-button";

const mocks = vi.hoisted(() => ({
  purchase: vi.fn(),
  navigate: vi.fn(),
  user: { id: "00000000-0000-4000-8000-000000000009" } as { id: string } | null,
}));

vi.mock("@tanstack/react-start", () => ({ useServerFn: () => mocks.purchase }));
vi.mock("@/lib/purchase.functions", () => ({ purchaseProduct: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, hash, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <a href={`${String(to)}${typeof hash === "string" ? hash : ""}`} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => mocks.navigate,
}));
vi.mock("@/hooks/use-auth-user", () => ({
  useAuthUser: () => ({ user: mocks.user, loading: false }),
}));

const purchased = {
  ok: true as const,
  orderId: "00000000-0000-4000-8000-000000000010",
  orderReference: "00000000-0000-4000-8000-000000000010",
  orderItemId: "00000000-0000-4000-8000-000000000011",
  title: "Starter account",
  platform: "Instagram",
  unitPrice: 2500,
  createdAt: "2026-01-01T00:00:00.000Z",
  paymentStatus: "completed",
  deliveryStatus: "delivered",
  deliveredPayload: "ID: example-user\nPassword: line1\nline2!",
  specifications: { Region: "West Africa" },
  deliveryInstructions: "Sign in before use.",
  availableStock: 0,
};

describe("Buy Now", () => {
  beforeEach(() => {
    mocks.purchase.mockReset().mockResolvedValue(purchased);
    mocks.navigate.mockReset();
    mocks.user = { id: "00000000-0000-4000-8000-000000000009" };
  });

  it("shows the insufficient balance message and wallet funding link", async () => {
    mocks.purchase.mockRejectedValueOnce(new Error("Insufficient wallet balance"));
    render(
      <BuyNowButton
        productId="00000000-0000-4000-8000-000000000001"
        title="Starter account"
        available
        published
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Buy Now" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Insufficient wallet balance. Please fund your wallet to purchase this product.",
    );
    expect(screen.getByRole("link", { name: "Fund Wallet" })).toHaveAttribute("href", "/wallet");
  });

  it("displays and preserves exact delivered credentials and instructions", async () => {
    const onPurchased = vi.fn();
    render(
      <BuyNowButton
        productId="00000000-0000-4000-8000-000000000001"
        title="Starter account"
        available
        published
        onPurchased={onPurchased}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Buy Now" }));

    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "Purchase successful! Your product details are available in Orders.",
    );
    expect(screen.getByRole("dialog").querySelector("pre")?.textContent).toBe(
      "ID: example-user\nPassword: line1\nline2!",
    );
    expect(screen.getByText("Sign in before use.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View Order" })).toHaveAttribute(
      "href",
      "/wallet#orders",
    );
    expect(onPurchased).toHaveBeenCalledWith(0);
    expect(mocks.purchase.mock.calls[0]?.[0].data).toMatchObject({
      productId: "00000000-0000-4000-8000-000000000001",
      request: expect.any(String),
    });
  });

  it("reuses the same idempotency key when Buy Now is tapped repeatedly", async () => {
    let resolvePurchase: ((value: typeof purchased) => void) | undefined;
    mocks.purchase.mockImplementationOnce(
      () => new Promise((resolve) => (resolvePurchase = resolve)),
    );
    render(
      <BuyNowButton
        productId="00000000-0000-4000-8000-000000000001"
        title="Starter account"
        available
        published
      />,
    );
    const button = screen.getByRole("button", { name: "Buy Now" });
    fireEvent.click(button);
    expect(button).toBeDisabled();
    resolvePurchase?.(purchased);
    await screen.findByRole("dialog");
    expect(mocks.purchase).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toHaveTextContent("Purchase successful!"),
    );
  });

  it("reuses the same request key after a transient network failure", async () => {
    mocks.purchase
      .mockRejectedValueOnce(new Error("Network request failed"))
      .mockResolvedValueOnce(purchased);
    render(
      <BuyNowButton
        productId="00000000-0000-4000-8000-000000000001"
        title="Starter account"
        available
        published
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Buy Now" }));
    await screen.findByRole("alert");
    const firstRequest = mocks.purchase.mock.calls[0]?.[0].data.request;
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]!);
    await waitFor(() => expect(screen.getByRole("button", { name: "Buy Now" })).toBeVisible());
    fireEvent.click(screen.getByRole("button", { name: "Buy Now" }));
    await screen.findByRole("dialog");

    expect(mocks.purchase).toHaveBeenCalledTimes(2);
    expect(mocks.purchase.mock.calls[1]?.[0].data.request).toBe(firstRequest);
  });

  it("requires authentication before checkout", async () => {
    mocks.user = null;
    render(
      <BuyNowButton
        productId="00000000-0000-4000-8000-000000000001"
        title="Starter account"
        available
        published
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Buy Now" }));

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ to: "/auth" }));
    expect(mocks.purchase).not.toHaveBeenCalled();
  });

  it("does not show a prior product's delivery after navigating while a purchase is pending", async () => {
    let resolvePurchase: ((value: typeof purchased) => void) | undefined;
    mocks.purchase.mockImplementationOnce(
      () => new Promise((resolve) => (resolvePurchase = resolve)),
    );
    const props = {
      title: "Starter account",
      available: true,
      published: true,
    };
    const { rerender } = render(
      <BuyNowButton productId="00000000-0000-4000-8000-000000000001" {...props} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Buy Now" }));
    rerender(<BuyNowButton productId="00000000-0000-4000-8000-000000000002" {...props} />);
    resolvePurchase?.(purchased);

    await waitFor(() => expect(screen.getByRole("button", { name: "Buy Now" })).toBeEnabled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("ID: example-user")).not.toBeInTheDocument();
  });
});
