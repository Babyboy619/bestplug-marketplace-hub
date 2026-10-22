import type { ComponentType } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "@/routes/wallet";

const order = {
  id: "00000000-0000-4000-8000-000000000010",
  user_id: "00000000-0000-4000-8000-000000000009",
  total: 2500,
  currency: "NGN",
  status: "completed" as const,
  wallet_tx_id: null,
  request_key: "00000000-0000-4000-8000-000000000012",
  payment_reference: null,
  created_at: "2026-01-01T00:00:00.000Z",
};

const item = {
  id: "00000000-0000-4000-8000-000000000011",
  order_id: order.id,
  product_id: "00000000-0000-4000-8000-000000000001",
  title: "Starter account",
  unit_price: 2500,
  quantity: 1,
  delivered_payload: "ID: example-user\nPassword: pass-123",
  platform: "Instagram",
  delivered_specifications: { Region: "West Africa" },
  delivery_instructions: "Sign in before use.",
  created_at: order.created_at,
};

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  user: { id: "00000000-0000-4000-8000-000000000009", email: "buyer@example.test" },
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: mocks }));
vi.mock("@/hooks/use-auth-user", () => ({
  useAuthUser: () => ({ user: mocks.user, loading: false }),
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => vi.fn() }));
vi.mock("@/lib/paystark.functions", () => ({
  startPaystarkTopup: vi.fn(),
  verifyPaystarkTopup: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useRouterState: () => ({ pathname: "/wallet", hash: "#orders" }),
}));

function query(data: unknown) {
  const current = {
    select: () => current,
    order: () => current,
    limit: () => current,
    eq: () => current,
    in: () => current,
    maybeSingle: async () => ({ data, error: null }),
    then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
      Promise.resolve({ data, error: null }).then(resolve),
  };
  return current;
}

describe("customer wallet orders", () => {
  beforeEach(() => {
    mocks.rpc.mockReset().mockResolvedValue({
      data: [{ id: "wallet", balance: 7500, currency: "NGN", updated_at: order.created_at }],
      error: null,
    });
    mocks.from.mockReset().mockImplementation((table: string) => {
      if (table === "wallets") return query({ user_id: mocks.user.id, balance: 7500 });
      if (table === "wallet_transactions") return query([]);
      if (table === "orders") return query([order]);
      if (table === "order_items") return query([item]);
      if (table === "payment_intents") return query(null);
      throw new Error(`Unexpected table ${table}`);
    });
  });

  it("renders order status, saved delivery details, and exact specifications", async () => {
    const WalletPage = Route.options.component as ComponentType;
    render(<WalletPage />);

    expect(await screen.findByText("Starter account")).toBeInTheDocument();
    expect(screen.getByText("Instagram")).toBeInTheDocument();
    expect(screen.getByText(order.id)).toBeInTheDocument();
    expect(screen.getByText("Payment completed")).toBeInTheDocument();
    expect(screen.getByText("Delivered")).toBeInTheDocument();
    expect(screen.getByText("Region")).toBeInTheDocument();
    expect(screen.getByText("West Africa")).toBeInTheDocument();
    expect(screen.getByText("Sign in before use.")).toBeInTheDocument();
  });
});
