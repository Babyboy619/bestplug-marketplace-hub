import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/hooks/use-auth-user";
import { SiteFrame } from "@/components/site-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { pageHead } from "@/lib/metadata";
import { nameSchema } from "@/lib/paystack-validation";
import { Eye, EyeOff } from "lucide-react";
import { z } from "zod";
export const Route = createFileRoute("/auth")({
  validateSearch: z.object({ mode: z.enum(["signin", "signup", "reset"]).optional() }),
  head: () => pageHead("Your account", "Sign in or create your BESTPLUG MARKETPLACE account."),
  component: AuthPage,
});
export function AuthPage() {
  const { mode: requestedMode } = Route.useSearch();
  const [mode, setMode] = useState<"signin" | "signup" | "reset">(requestedMode ?? "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"error" | "success" | null>(null);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const { user, loading, isAdmin, roleLoading } = useAuthUser();
  const navigate = useNavigate();
  useEffect(() => {
    setMode(requestedMode ?? "signin");
  }, [requestedMode]);
  useEffect(() => {
    if (!loading && user && !roleLoading) {
      void navigate({ to: isAdmin ? "/admin" : "/wallet" });
    }
  }, [user, loading, isAdmin, roleLoading, navigate]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setMessageKind(null);
    const parsedEmail = z
      .string()
      .trim()
      .email("Enter a valid email address.")
      .max(254)
      .safeParse(email);
    if (!parsedEmail.success) {
      setMessage(parsedEmail.error.issues[0]?.message ?? "Enter a valid email address.");
      setMessageKind("error");
      return;
    }
    const cleanEmail = parsedEmail.data.toLowerCase();
    if (mode === "signup") {
      const parsedName = nameSchema.safeParse(name);
      if (!parsedName.success) {
        setMessage("Enter your full name using 2 to 80 characters.");
        setMessageKind("error");
        return;
      }
    }
    if (mode !== "reset") {
      const passwordValidation = mode === "signup" ? z.string().min(8).max(128) : z.string().min(1);
      if (!passwordValidation.safeParse(password).success) {
        setMessage(
          mode === "signup"
            ? "Password must be between 8 and 128 characters."
            : "Enter your password.",
        );
        setMessageKind("error");
        return;
      }
    }
    setBusy(true);
    try {
      const result =
        mode === "signin"
          ? await supabase.auth.signInWithPassword({ email: cleanEmail, password })
          : mode === "signup"
            ? await supabase.auth.signUp({
                email: cleanEmail,
                password,
                options: {
                  data: { display_name: name.trim() },
                  emailRedirectTo: window.location.origin + "/auth",
                },
              })
            : await supabase.auth.resetPasswordForEmail(cleanEmail, {
                redirectTo: window.location.origin + "/reset-password",
              });
      if (result.error) {
        const reason = result.error.message.toLowerCase();
        if (mode === "signin" && reason.includes("invalid login credentials")) {
          throw new Error("Email or password is incorrect.");
        }
        if (
          mode === "signup" &&
          (reason.includes("already registered") || result.error.code === "user_already_exists")
        ) {
          throw new Error(
            "An account with this email already exists. Sign in or reset your password.",
          );
        }
        throw result.error;
      }
      if (mode === "signup") {
        setMessage("Check your email to verify your account, then sign in.");
        setMessageKind("success");
      }
      if (mode === "reset") {
        setMessage("Check your email for a password reset link.");
        setMessageKind("success");
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Please try again.");
      setMessageKind("error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <SiteFrame>
      <main className="min-h-[65vh]">
        <div className="auth-panel">
          <p className="text-xs uppercase text-primary">BESTPLUG MARKETPLACE</p>
          <h1 className="section-heading mt-3">
            {mode === "signup"
              ? "Get plugged in."
              : mode === "reset"
                ? "Reset your password."
                : "Welcome back."}
          </h1>
          <form className="mt-6 space-y-4" noValidate onSubmit={submit}>
            {mode === "signup" && (
              <label className="block text-sm">
                Full Name
                <Input
                  className="mt-2"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  minLength={2}
                  maxLength={80}
                  autoComplete="name"
                />
              </label>
            )}
            <label className="block text-sm">
              Email
              <Input
                className="mt-2"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                maxLength={254}
                autoComplete="email"
              />
            </label>
            {mode !== "reset" && (
              <label className="block text-sm">
                Password
                <span className="relative mt-2 block">
                  <Input
                    className="pr-12"
                    type={passwordVisible ? "text" : "password"}
                    minLength={mode === "signup" ? 8 : undefined}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 size-9 -translate-y-1/2"
                    aria-label={passwordVisible ? "Hide password" : "Show password"}
                    aria-pressed={passwordVisible}
                    onClick={() => setPasswordVisible((visible) => !visible)}
                  >
                    {passwordVisible ? <EyeOff /> : <Eye />}
                  </Button>
                </span>
              </label>
            )}
            <Button className="w-full" disabled={busy}>
              {busy
                ? "Please wait…"
                : mode === "signin"
                  ? "Sign in"
                  : mode === "signup"
                    ? "Create account"
                    : "Send reset link"}
            </Button>
          </form>
          {message && (
            <p
              role={messageKind === "error" ? "alert" : "status"}
              aria-live={messageKind === "error" ? "assertive" : "polite"}
              className={`mt-4 text-sm leading-6 ${messageKind === "error" ? "text-destructive" : "text-primary"}`}
            >
              {message}
            </p>
          )}
          <div className="mt-5 flex flex-wrap justify-between gap-2">
            {mode === "signin" ? (
              <Link
                to="/auth"
                search={{ mode: "signup" }}
                className="text-xs text-primary underline-offset-4 hover:underline"
              >
                Create an account
              </Link>
            ) : (
              <Link
                to="/auth"
                search={{ mode: "signin" }}
                className="text-xs text-primary underline-offset-4 hover:underline"
              >
                Back to sign in
              </Link>
            )}
            {mode === "signin" && (
              <Link
                to="/auth"
                search={{ mode: "reset" }}
                className="text-xs text-primary underline-offset-4 hover:underline"
              >
                Forgot password?
              </Link>
            )}
          </div>
          <Link to="/products" className="mt-5 block text-center text-xs text-muted-foreground">
            Back to marketplace
          </Link>
        </div>
      </main>
    </SiteFrame>
  );
}
