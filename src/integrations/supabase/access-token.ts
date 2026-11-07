import { supabase } from "./client";

const REFRESH_BEFORE_EXPIRY_SECONDS = 60;

export async function getCurrentAccessToken(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  const session = data.session;
  if (!session) return null;

  if (
    session.expires_at !== undefined &&
    session.expires_at <= Math.floor(Date.now() / 1000) + REFRESH_BEFORE_EXPIRY_SECONDS
  ) {
    const refreshed = await supabase.auth.refreshSession();
    if (refreshed.error) throw refreshed.error;
    return refreshed.data.session?.access_token ?? null;
  }

  return session.access_token;
}
