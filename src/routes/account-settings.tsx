import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { LogOut, Save, Upload, UserRound } from "lucide-react";
import { SiteFrame } from "@/components/site-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuthUser } from "@/hooks/use-auth-user";
import { supabase } from "@/integrations/supabase/client";
import { pageHead } from "@/lib/metadata";
import {
  saveProfileName,
  validateAccountEmail,
  validateAccountPassword,
} from "@/lib/account.functions";

export const Route = createFileRoute("/account-settings")({
  head: () => pageHead("Account Settings", "Manage your profile and account security."),
  component: AccountSettingsPage,
});

function AccountSettingsPage() {
  const { user, loading } = useAuthUser();
  const navigate = useNavigate();
  const saveName = useServerFn(saveProfileName);
  const validateEmail = useServerFn(validateAccountEmail);
  const validatePassword = useServerFn(validateAccountPassword);
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!user) return;
    setEmail(user.email ?? "");
    let active = true;
    void supabase
      .from("profiles")
      .select("display_name,avatar_url")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        setDisplayName(data?.display_name ?? "");
        setAvatarUrl(data?.avatar_url ?? "");
      });
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!photo) {
      setPhotoPreview("");
      return;
    }
    const preview = URL.createObjectURL(photo);
    setPhotoPreview(preview);
    return () => URL.revokeObjectURL(preview);
  }, [photo]);

  async function saveNameChange(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError(false);
    try {
      const result = await saveName({ data: { displayName } });
      setDisplayName(result.displayName);
      setMessage("Profile name saved.");
    } catch (cause) {
      setError(true);
      setMessage(cause instanceof Error ? cause.message : "Profile name could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function saveEmailChange(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError(false);
    try {
      const validated = await validateEmail({ data: { email } });
      const { error: updateError } = await supabase.auth.updateUser({ email: validated.email });
      if (updateError) throw updateError;
      setMessage(
        "Check your email to confirm the address change. Your account email updates after verification.",
      );
    } catch (cause) {
      setError(true);
      setMessage(cause instanceof Error ? cause.message : "Email could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  async function savePasswordChange(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user?.email) return;
    setBusy(true);
    setMessage("");
    setError(false);
    try {
      await validatePassword({ data: { password: newPassword, confirmation: confirmPassword } });
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });
      if (reauthError) throw new Error("Current password is incorrect.");
      const { error: passwordError } = await supabase.auth.updateUser({ password: newPassword });
      if (passwordError) throw passwordError;
      const { error: signOutError } = await supabase.auth.signOut({ scope: "others" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage(
        signOutError
          ? "Password updated, but other sessions could not be signed out."
          : "Password updated. Other sessions have been signed out.",
      );
    } catch (cause) {
      setError(true);
      setMessage(cause instanceof Error ? cause.message : "Password could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadPhoto() {
    if (!photo) return;
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setError(true);
      setMessage("Your session has expired. Sign in again.");
      return;
    }
    setBusy(true);
    setMessage("");
    setError(false);
    const formData = new FormData();
    formData.set("avatar", photo);
    try {
      const response = await fetch("/api/profile-avatar", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const result = (await response.json()) as { avatarUrl?: string; error?: string };
      if (!response.ok || !result.avatarUrl)
        throw new Error(result.error ?? "Photo upload failed.");
      setAvatarUrl(result.avatarUrl);
      setPhoto(null);
      setMessage("Profile photo updated.");
    } catch (cause) {
      setError(true);
      setMessage(cause instanceof Error ? cause.message : "Photo upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    const { error: signOutError } = await supabase.auth.signOut();
    setBusy(false);
    if (signOutError) {
      setError(true);
      setMessage("You could not be signed out. Please try again.");
      return;
    }
    await navigate({ to: "/" });
  }

  if (loading) {
    return (
      <SiteFrame>
        <main className="mx-auto max-w-3xl px-5 py-10">Loading account…</main>
      </SiteFrame>
    );
  }
  if (!user) {
    return (
      <SiteFrame>
        <main className="mx-auto max-w-3xl px-5 py-10">
          <h1 className="section-heading">Account Settings</h1>
          <p className="mt-3 text-sm text-muted-foreground">Sign in to manage your account.</p>
          <Button asChild className="mt-5">
            <Link to="/auth">Sign in</Link>
          </Button>
        </main>
      </SiteFrame>
    );
  }

  return (
    <SiteFrame>
      <main className="mx-auto min-h-[65vh] max-w-3xl px-4 py-8 sm:px-8">
        <p className="text-xs font-semibold uppercase text-primary">Your account</p>
        <h1 className="section-heading mt-2">Account Settings</h1>
        {message && (
          <p
            role={error ? "alert" : "status"}
            className={`mt-5 text-sm ${error ? "text-destructive" : "text-primary"}`}
          >
            {message}
          </p>
        )}

        <section className="mt-7 border-y border-border py-6">
          <h2 className="text-lg font-semibold">Profile Information</h2>
          <form
            className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={saveNameChange}
          >
            <label className="flex-1 text-sm">
              Profile name
              <Input
                className="mt-2"
                required
                maxLength={80}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
            <Button type="submit" disabled={busy}>
              <Save aria-hidden="true" /> Save name
            </Button>
          </form>
        </section>

        <section className="border-b border-border py-6">
          <h2 className="text-lg font-semibold">Profile Photo</h2>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            {photoPreview || avatarUrl ? (
              <img
                src={photoPreview || avatarUrl}
                alt="Profile preview"
                className="size-20 rounded-full border border-border object-cover"
              />
            ) : (
              <span className="flex size-20 items-center justify-center rounded-full bg-secondary">
                <UserRound aria-hidden="true" className="size-8 text-muted-foreground" />
              </span>
            )}
            <div className="flex flex-wrap gap-3">
              <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-border px-4 text-sm font-medium hover:bg-accent">
                <Upload aria-hidden="true" /> Choose photo
                <input
                  className="sr-only"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    if (file && file.size > 5 * 1024 * 1024) {
                      setError(true);
                      setMessage("Choose an image no larger than 5 MB.");
                      event.target.value = "";
                      return;
                    }
                    setPhoto(file);
                  }}
                />
              </label>
              {photo && (
                <Button type="button" disabled={busy} onClick={() => void uploadPhoto()}>
                  Save photo
                </Button>
              )}
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">JPEG, PNG, or WebP. Maximum 5 MB.</p>
        </section>

        <section className="border-b border-border py-6">
          <h2 className="text-lg font-semibold">Email Address</h2>
          <form
            className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={saveEmailChange}
          >
            <label className="flex-1 text-sm">
              Email address
              <Input
                className="mt-2"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <Button
              type="submit"
              variant="outline"
              disabled={busy || email.toLowerCase() === (user.email ?? "").toLowerCase()}
            >
              Update email
            </Button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">
            Supabase will request email confirmation before applying the change.
          </p>
        </section>

        <section className="border-b border-border py-6">
          <h2 className="text-lg font-semibold">Change Password</h2>
          <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={savePasswordChange}>
            <label className="text-sm sm:col-span-2">
              Current password
              <Input
                className="mt-2"
                type="password"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </label>
            <label className="text-sm">
              New password
              <Input
                className="mt-2"
                type="password"
                minLength={8}
                autoComplete="new-password"
                required
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
            <label className="text-sm">
              Confirm new password
              <Input
                className="mt-2"
                type="password"
                minLength={8}
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>
            <div className="sm:col-span-2">
              <Button type="submit" variant="outline" disabled={busy}>
                Update password
              </Button>
            </div>
          </form>
        </section>

        <section className="py-6">
          <h2 className="text-lg font-semibold">Logout</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign out of this account on this device.
          </p>
          <Button
            type="button"
            variant="destructive"
            className="mt-4"
            disabled={busy}
            onClick={() => void logout()}
          >
            <LogOut aria-hidden="true" /> Log out
          </Button>
        </section>
      </main>
    </SiteFrame>
  );
}
