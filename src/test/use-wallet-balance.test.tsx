import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWalletBalance } from "@/hooks/use-wallet-balance";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  eq: vi.fn(),
  wallet: { user_id: "user-1", balance: 15000 },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: mocks.rpc,
    from: mocks.from,
  },
}));

function BalanceProbe() {
  const { balance, balanceLoading, balanceError } = useWalletBalance("user-1");
  return (
    <div>
      <output>{balanceLoading && balance === null ? "Loading balance" : balanceError ?? balance}</output>
    </div>
  );
}

describe("authenticated wallet balance", () => {
  beforeEach(() => {
    mocks.rpc.mockReset().mockResolvedValue({ data: [{ balance: 15000 }], error: null });
    mocks.eq.mockReset().mockResolvedValue({ data: mocks.wallet, error: null });
    mocks.from.mockReset().mockImplementation((table: string) => {
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn((column: string, value: string) => {
          mocks.eq(column, value);
          return builder;
        }),
        maybeSingle: vi.fn(() => mocks.eq.mock.results.at(-1)?.value),
      };
      if (table !== "wallets") throw new Error(`Unexpected table ${table}`);
      return builder;
    });
  });

  it("shows loading instead of zero and reads the signed-in user's actual wallet", async () => {
    let resolveWallet: ((value: { data: typeof mocks.wallet; error: null }) => void) | undefined;
    mocks.eq.mockImplementationOnce(
      () => new Promise((resolve) => (resolveWallet = resolve)),
    );
    render(<BalanceProbe />);

    expect(screen.getByText("Loading balance")).toBeInTheDocument();
    await waitFor(() => expect(mocks.from).toHaveBeenCalledWith("wallets"));
    expect(mocks.eq).toHaveBeenCalledWith("user_id", "user-1");
    resolveWallet?.({ data: mocks.wallet, error: null });
    expect(await screen.findByText("15000")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("refreshes the authoritative balance after a wallet update event", async () => {
    render(<BalanceProbe />);
    expect(await screen.findByText("15000")).toBeInTheDocument();
    mocks.eq.mockResolvedValueOnce({ data: { ...mocks.wallet, balance: 15500 }, error: null });

    fireEvent(window, new Event("bestplug-wallet-updated"));

    expect(await screen.findByText("15500")).toBeInTheDocument();
  });

  it("shows an error instead of a false zero when the database read fails", async () => {
    mocks.eq.mockResolvedValueOnce({ data: null, error: { message: "RLS denied" } });
    render(<BalanceProbe />);

    expect(await screen.findByText("Your wallet balance could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
