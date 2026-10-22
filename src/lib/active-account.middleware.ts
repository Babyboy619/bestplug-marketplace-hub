import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const requireActiveAccount = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const account = await context.supabase
      .from("profiles")
      .select("id,suspended,deleted_at")
      .eq("id", context.userId)
      .maybeSingle();
    let data: { id: string; suspended: boolean; deleted_at?: string | null } | null = account.data;
    let error = account.error;
    if (error?.code === "PGRST204" || error?.code === "42703") {
      const fallback = await context.supabase
        .from("profiles")
        .select("id,suspended")
        .eq("id", context.userId)
        .maybeSingle();
      data = fallback.data;
      error = fallback.error;
    }
    if (error) {
      console.error("Account status verification failed:", error);
      throw new Error("Account status could not be verified.");
    }
    if (!data || data.suspended || ("deleted_at" in data && data.deleted_at)) {
      throw new Error("This account is suspended or deactivated.");
    }
    return next();
  });
