import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/hooks/use-auth-user";
import { AuthPage } from "@/routes/auth";

const mocks = vi.hoisted(() => ({
  authCallbacks: [] as Array<(event: AuthChangeEvent, session: Session | null) => void>,
  rpc: vi.fn(),
  signIn: vi.fn(),
  signUp: vi.fn(),
  reset: vi.fn(),
  navigate: vi.fn(),
  searchMode: undefined as "signin" | "signup" | "reset" | undefined,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useSearch: () => ({ mode: mocks.searchMode }),
  }),
  Link: ({
    to,
    search,
    children,
    className,
  }: {
    to: string;
    search?: { mode?: string };
    children: ReactNode;
    className?: string;
  }) => (
    <a href={`${to}${search?.mode ? `?mode=${search.mode}` : ""}`} className={className}>
      {children}
    </a>
  ),
  useNavigate: () => mocks.navigate,
}));

vi.mock("@/components/site-frame", () => ({
  SiteFrame: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (callback: (event: AuthChangeEvent, session: Session | null) => void) => {
        mocks.authCallbacks.push(callback);
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      signInWithPassword: mocks.signIn,
      signUp: mocks.signUp,
      resetPasswordForEmail: mocks.reset,
    },
    rpc: mocks.rpc,
  },
}));

function renderAuth(mode: "signin" | "signup" | "reset" | undefined = undefined) {
  mocks.searchMode = mode;
  return render(
    <AuthProvider>
      <AuthPage />
    </AuthProvider>,
  );
}

describe("authentication form", () => {
  beforeEach(() => {
    mocks.authCallbacks = [];
    mocks.rpc.mockReset().mockResolvedValue({ data: false, error: null });
    mocks.signIn.mockReset();
    mocks.signUp.mockReset();
    mocks.reset.mockReset();
    mocks.navigate.mockReset();
  });

  it("signs in with email and password, reveals the password, and redirects", async () => {
    mocks.signIn.mockImplementation(async () => {
      const callback = mocks.authCallbacks[0];
      if (callback) {
        act(() =>
          callback("SIGNED_IN", {
            user: { id: "signed-in-user", email: "buyer@example.com" },
          } as Session),
        );
      }
      return { data: { user: { id: "signed-in-user" }, session: {} }, error: null };
    });

    renderAuth();

    expect(screen.queryByText(/continue with google/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/continue with lovable/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    const email = screen.getByLabelText("Email");
    const password = screen.getByLabelText("Password");
    expect(document.querySelectorAll("form input")).toHaveLength(2);
    expect(password).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(password).toHaveAttribute("type", "text");
    fireEvent.change(email, { target: { value: "buyer@example.com" } });
    fireEvent.change(password, { target: { value: "correct-password" } });
    fireEvent.submit(screen.getByRole("button", { name: "Sign in" }).closest("form")!);

    await waitFor(() =>
      expect(mocks.signIn).toHaveBeenCalledWith({
        email: "buyer@example.com",
        password: "correct-password",
      }),
    );
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ to: "/wallet" }));
  });

  it("shows a useful error when credentials are rejected", async () => {
    mocks.signIn.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    renderAuth();

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "buyer@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong-password" } });
    fireEvent.submit(screen.getByRole("button", { name: "Sign in" }).closest("form")!);

    expect(await screen.findByRole("alert")).toHaveTextContent("Email or password is incorrect.");
  });

  it("registers with a full name, email, and password using profile metadata", async () => {
    mocks.signUp.mockResolvedValue({ error: null, data: { user: null, session: null } });
    renderAuth("signup");

    expect(screen.queryByText(/continue with google/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/continue with lovable/i)).not.toBeInTheDocument();
    expect(document.querySelectorAll("form input")).toHaveLength(3);
    fireEvent.change(screen.getByLabelText("Full Name"), { target: { value: "Ada Example" } });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "ADA@example.com " },
    });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secure-pass-123" } });
    fireEvent.submit(screen.getByRole("button", { name: "Create account" }).closest("form")!);

    await waitFor(() =>
      expect(mocks.signUp).toHaveBeenCalledWith({
        email: "ada@example.com",
        password: "secure-pass-123",
        options: {
          data: { display_name: "Ada Example" },
          emailRedirectTo: `${window.location.origin}/auth`,
        },
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Check your email to verify your account, then sign in.",
    );
  });

  it("reports duplicate registration addresses clearly", async () => {
    mocks.signUp.mockResolvedValue({
      error: { code: "user_already_exists", message: "User already registered" },
    });
    renderAuth("signup");

    fireEvent.change(screen.getByLabelText("Full Name"), { target: { value: "Ada Example" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secure-pass-123" } });
    fireEvent.submit(screen.getByRole("button", { name: "Create account" }).closest("form")!);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "An account with this email already exists.",
    );
  });

  it("validates email and full name before calling Supabase", async () => {
    const { unmount } = renderAuth();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "not-an-email" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.submit(screen.getByRole("button", { name: "Sign in" }).closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a valid email address.");
    expect(mocks.signIn).not.toHaveBeenCalled();

    unmount();
    renderAuth("signup");
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "secure-pass-123" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Create account" }).closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter your full name using 2 to 80 characters.",
    );
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("provides registration and password recovery links", () => {
    const { unmount } = renderAuth();
    expect(screen.getByRole("link", { name: "Create an account" })).toHaveAttribute(
      "href",
      "/auth?mode=signup",
    );
    expect(screen.getByRole("link", { name: "Forgot password?" })).toHaveAttribute(
      "href",
      "/auth?mode=reset",
    );

    unmount();
    renderAuth("reset");
    expect(document.querySelectorAll("form input")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute(
      "href",
      "/auth?mode=signin",
    );
  });

  it("continues to send password recovery emails", async () => {
    mocks.reset.mockResolvedValue({ data: {}, error: null });
    renderAuth("reset");

    expect(
      screen.queryByText(/continue with google|continue with lovable/i),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "buyer@example.com" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Send reset link" }).closest("form")!);

    await waitFor(() =>
      expect(mocks.reset).toHaveBeenCalledWith("buyer@example.com", {
        redirectTo: `${window.location.origin}/reset-password`,
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Check your email for a password reset link.",
    );
  });
});
