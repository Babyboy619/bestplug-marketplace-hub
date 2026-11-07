import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  refreshSession: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
      refreshSession: mocks.refreshSession,
    },
  },
}));

import { getCurrentAccessToken } from "@/integrations/supabase/access-token";

afterEach(() => {
  vi.clearAllMocks();
});

describe("current Supabase access token", () => {
  it("uses the current token when it is not near expiry", async () => {
    mocks.getSession.mockResolvedValue({
      data: {
        session: {
          access_token: "current-token",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      },
      error: null,
    });

    await expect(getCurrentAccessToken()).resolves.toBe("current-token");
    expect(mocks.refreshSession).not.toHaveBeenCalled();
  });

  it("refreshes the session before attaching a nearly expired token", async () => {
    mocks.getSession.mockResolvedValue({
      data: {
        session: { access_token: "expired-soon", expires_at: Math.floor(Date.now() / 1000) + 30 },
      },
      error: null,
    });
    mocks.refreshSession.mockResolvedValue({
      data: { session: { access_token: "refreshed-token" } },
      error: null,
    });

    await expect(getCurrentAccessToken()).resolves.toBe("refreshed-token");
  });

  it("returns null when the user has no session", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });

    await expect(getCurrentAccessToken()).resolves.toBeNull();
    expect(mocks.refreshSession).not.toHaveBeenCalled();
  });

  it("surfaces session and refresh failures", async () => {
    mocks.getSession.mockResolvedValue({
      data: { session: null },
      error: new Error("Session read failed"),
    });
    await expect(getCurrentAccessToken()).rejects.toThrow("Session read failed");

    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: "expired", expires_at: 1 } },
      error: null,
    });
    mocks.refreshSession.mockResolvedValue({
      data: { session: null },
      error: new Error("Session refresh failed"),
    });
    await expect(getCurrentAccessToken()).rejects.toThrow("Session refresh failed");
  });
});
