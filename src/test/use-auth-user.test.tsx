import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuthUser } from "@/hooks/use-auth-user";

const mocks = vi.hoisted(() => ({
  authCallbacks: [] as Array<(event: AuthChangeEvent, session: Session | null) => void>,
  rpc: vi.fn(),
  profile: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (callback: (event: AuthChangeEvent, session: Session | null) => void) => {
        mocks.authCallbacks.push(callback);
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
    rpc: mocks.rpc,
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: mocks.profile })),
      })),
    })),
  },
}));

function AuthStatus() {
  const { user, loading, isAdmin, roleLoading, roleError, retryAdminVerification } = useAuthUser();

  return (
    <>
      <output data-testid="auth">{loading ? "loading" : (user?.id ?? "signed-out")}</output>
      <output data-testid="role">
        {roleLoading ? "checking" : roleError ? "error" : isAdmin ? "admin" : "not-admin"}
      </output>
      <output data-testid="roleError">{roleError}</output>
      <button onClick={retryAdminVerification}>Retry</button>
    </>
  );
}

describe("AuthProvider administrator verification", () => {
  beforeEach(() => {
    mocks.authCallbacks = [];
    mocks.rpc.mockReset();
    mocks.profile.mockReset();
  });

  it("waits for the restored session, checks its UUID, and allows retry after an error", async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: null,
        error: { code: "PGRST202", message: "function unavailable" },
      })
      .mockResolvedValueOnce({ data: true, error: null });
    mocks.profile.mockResolvedValue({
      data: { id: "actual-auth-user-uuid", suspended: false },
      error: null,
    });

    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>,
    );

    expect(screen.getByTestId("auth")).toHaveTextContent("loading");
    expect(mocks.rpc).not.toHaveBeenCalled();

    const session = {
      user: { id: "actual-auth-user-uuid" },
    } as Session;
    const initializeSession = mocks.authCallbacks[0];
    if (!initializeSession) throw new Error("Auth state subscription was not registered.");
    act(() => initializeSession("INITIAL_SESSION", session));

    await waitFor(() => expect(screen.getByTestId("role")).toHaveTextContent("error"));
    expect(screen.getByTestId("roleError")).toHaveTextContent("database error PGRST202");
    expect(screen.getByTestId("auth")).toHaveTextContent("actual-auth-user-uuid");
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "has_role", {
      _user_id: "actual-auth-user-uuid",
      _role: "admin",
    });

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByTestId("role")).toHaveTextContent("admin"));
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it("does not authorize a regular user and clears access after sign-out", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    mocks.profile.mockResolvedValue({
      data: { id: "regular-user-uuid", suspended: false },
      error: null,
    });

    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>,
    );

    const initializeSession = mocks.authCallbacks[0];
    if (!initializeSession) throw new Error("Auth state subscription was not registered.");
    act(() =>
      initializeSession("INITIAL_SESSION", { user: { id: "regular-user-uuid" } } as Session),
    );

    await waitFor(() => expect(screen.getByTestId("role")).toHaveTextContent("not-admin"));
    expect(mocks.rpc).toHaveBeenCalledWith("has_role", {
      _user_id: "regular-user-uuid",
      _role: "admin",
    });

    act(() => initializeSession("SIGNED_OUT", null));
    await waitFor(() => {
      expect(screen.getByTestId("auth")).toHaveTextContent("signed-out");
      expect(screen.getByTestId("role")).toHaveTextContent("not-admin");
    });
  });
  it("denies administrator access when the database reports an inactive administrator", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.profile.mockResolvedValue({
      data: { id: "suspended-admin", suspended: true },
      error: null,
    });
    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>,
    );
    const callback = mocks.authCallbacks[0];
    if (!callback) throw new Error("Auth subscription missing");
    act(() => callback("INITIAL_SESSION", { user: { id: "suspended-admin" } } as Session));
    await waitFor(() => expect(screen.getByTestId("role")).toHaveTextContent("not-admin"));
    expect(mocks.rpc).toHaveBeenCalledWith("has_role", {
      _user_id: "suspended-admin",
      _role: "admin",
    });
    expect(screen.getByTestId("role")).toHaveTextContent("not-admin");
  });
});
