import { createServerFn } from "@tanstack/react-start";
import { requireActiveAccount } from "@/lib/active-account.middleware";
import { z } from "zod";
import { nameSchema, passwordSchema } from "./paystack-validation";
const displayNameSchema = z.object({ displayName: nameSchema });
const emailSchema = z.object({ email: z.string().trim().email().max(254) });
export const accountData = createServerFn({ method: "POST" })
  .middleware([requireActiveAccount])
  .handler(async ({ context }) => {
    await context.supabase.rpc("ensure_user_wallet");
    const [profile, role, wallet] = await Promise.all([
      context.supabase
        .from("profiles")
        .select("display_name,avatar_url,email")
        .eq("id", context.userId)
        .single(),
      context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
      context.supabase.from("wallets").select("balance").eq("user_id", context.userId).single(),
    ]);
    if (role.error) {
      console.error("Administrator role verification failed:", role.error);
      throw new Error(
        `Administrator verification failed with database error ${role.error.code ?? "unknown"}.`,
      );
    }
    return {
      profile: profile.data,
      isAdmin: role.data === true,
      balance: Number(wallet.data?.balance ?? 0),
    };
  });
export const updateName = createServerFn({ method: "POST" })
  .middleware([requireActiveAccount])
  .inputValidator((v) => z.object({ name: nameSchema }).parse(v))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update({ display_name: data.name })
      .eq("id", context.userId);
    if (error) throw new Error("Could not save your profile");
    return { success: true };
  });

const passwordChangeSchema = z
  .object({
    password: z.string().min(8, "Use at least 8 characters for your new password.").max(128),
    confirmation: z.string(),
  })
  .refine((value) => value.password === value.confirmation, {
    message: "The new password and confirmation do not match.",
    path: ["confirmation"],
  });

export const saveProfileName = createServerFn({ method: "POST" })
  .middleware([requireActiveAccount])
  .inputValidator((input) => displayNameSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update({ display_name: data.displayName })
      .eq("id", context.userId);
    if (error) throw new Error("Profile name could not be saved.");
    return { displayName: data.displayName };
  });

export const validateAccountEmail = createServerFn({ method: "POST" })
  .middleware([requireActiveAccount])
  .inputValidator((input) => emailSchema.parse(input))
  .handler(({ data }) => ({ email: data.email.toLowerCase() }));

export const validateAccountPassword = createServerFn({ method: "POST" })
  .middleware([requireActiveAccount])
  .inputValidator((input) => passwordChangeSchema.parse(input))
  .handler(() => ({ valid: true }));

export const updateEmail = createServerFn({ method: "POST" })
  .middleware([requireActiveAccount])
  .inputValidator((v) =>
    z.object({ email: z.string().email().max(254), current: z.string().min(1) }).parse(v),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: user } = await supabaseAdmin.auth.admin.getUserById(context.userId);
    if (!user.user?.email) throw new Error("Account email unavailable");
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(
      process.env["SUPABASE_URL"] ?? "",
      process.env["SUPABASE_PUBLISHABLE_KEY"] ?? "",
      { auth: { persistSession: false } },
    );
    const check = await client.auth.signInWithPassword({
      email: user.user.email,
      password: data.current,
    });
    if (check.error) throw new Error("Current password is incorrect");
    await client.auth.signOut();
    const result = await context.supabase.auth.updateUser({ email: data.email });
    if (result.error) throw new Error("Email could not be updated; it may already be registered.");
    return { success: true };
  });
export const changePassword = createServerFn({ method: "POST" })
  .middleware([requireActiveAccount])
  .inputValidator((v) => passwordSchema.parse(v))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.auth.updateUser({
      password: data.password,
      current_password: data.current,
    });
    if (result.error)
      throw new Error(
        "Password update failed. Check your current password and password requirements.",
      );
    return { success: true };
  });
export const adminData = createServerFn({ method: "POST" })
  .middleware([requireActiveAccount])
  .handler(async ({ context }) => {
    const { data: allowed, error } = await context.supabase.rpc("is_active_admin", {
      _user_id: context.userId,
    });
    if (error) {
      console.error("Administrator authorization check failed:", error);
      throw new Error(
        `Administrator authorization could not be checked (database error ${error.code ?? "unknown"}).`,
      );
    }
    if (allowed !== true) throw new Error("Forbidden: administrator access required");
    const [products, orders, profiles] = await Promise.all([
      context.supabase
        .from("products")
        .select("id,title,price,stock,published")
        .order("created_at", { ascending: false }),
      context.supabase
        .from("orders")
        .select("id,total,status,created_at")
        .order("created_at", { ascending: false })
        .limit(50),
      context.supabase
        .from("profiles")
        .select("id,display_name,created_at")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    const dataError = products.error ?? orders.error ?? profiles.error;
    if (dataError) {
      console.error("Administrator dashboard query failed:", dataError);
      throw new Error("Administrator dashboard data could not be loaded. Please try again.");
    }
    return {
      products: products.data ?? [],
      orders: orders.data ?? [],
      profiles: profiles.data ?? [],
    };
  });
export const uploadPhoto = createServerFn({ method: "POST" })
  .middleware([requireActiveAccount])
  .inputValidator((v) =>
    z
      .object({
        base64: z.string().max(2800000),
        type: z.enum(["image/jpeg", "image/png", "image/webp"]),
      })
      .parse(v),
  )
  .handler(async ({ data, context }) => {
    const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
    if (bytes.length > 2 * 1024 * 1024) throw new Error("Photo must be 2 MB or smaller");
    const valid =
      (data.type === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ||
      (data.type === "image/png" &&
        bytes[0] === 137 &&
        bytes[1] === 80 &&
        bytes[2] === 78 &&
        bytes[3] === 71) ||
      (data.type === "image/webp" &&
        new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
        new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP");
    if (!valid) throw new Error("Unsupported image contents");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const path = `${context.userId}/${crypto.randomUUID()}`;
    const result = await supabaseAdmin.storage
      .from("profile-photos")
      .upload(path, bytes, { contentType: data.type });
    if (result.error) throw new Error("Photo upload failed");
    const { error } = await context.supabase
      .from("profiles")
      .update({ avatar_url: path })
      .eq("id", context.userId);
    if (error) throw new Error("Could not save photo");
    return { success: true };
  });
export const photoUrl = createServerFn({ method: "POST" })
  .middleware([requireActiveAccount])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("profiles")
      .select("avatar_url")
      .eq("id", context.userId)
      .single();
    if (!data?.avatar_url) return null;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return (
      (await supabaseAdmin.storage.from("profile-photos").createSignedUrl(data.avatar_url, 3600))
        .data?.signedUrl ?? null
    );
  });
