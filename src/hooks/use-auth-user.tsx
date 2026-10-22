import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AuthState = {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  roleLoading: boolean;
  roleError: string | null;
  retryAdminVerification: () => void;
};

function verificationErrorMessage(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : null;

  return code
    ? `Administrator verification could not be completed (database error ${code}). Retry or contact support if the problem continues.`
    : "Administrator verification failed because the server could not check this session. Retry or contact support if the problem continues.";
}

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  isAdmin: false,
  roleLoading: true,
  roleError: null,
  retryAdminVerification: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [roleLoading, setRoleLoading] = useState(true);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [roleRetry, setRoleRetry] = useState(0);
  const currentUserId = useRef<string | null>(null);
  const retryAdminVerification = useCallback(() => setRoleRetry((attempt) => attempt + 1), []);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (
        !["INITIAL_SESSION", "SIGNED_IN", "SIGNED_OUT", "TOKEN_REFRESHED", "USER_UPDATED"].includes(
          event,
        )
      ) {
        return;
      }
      const nextUser = session?.user ?? null;
      if (currentUserId.current !== (nextUser?.id ?? null)) {
        currentUserId.current = nextUser?.id ?? null;
        setIsAdmin(false);
        setRoleLoading(Boolean(nextUser));
        setRoleError(null);
      }
      setUser(nextUser);
      setLoading(false);
    });
    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  const userId = user?.id;

  useEffect(() => {
    if (loading) return;
    let active = true;

    if (!userId) {
      setIsAdmin(false);
      setRoleLoading(false);
      setRoleError(null);
      return () => {
        active = false;
      };
    }

    setIsAdmin(false);
    setRoleLoading(true);
    setRoleError(null);
    void (async () => {
      try {
        const [roleResult, profileResult] = await Promise.all([
          supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
          supabase.from("profiles").select("id,suspended").eq("id", userId).maybeSingle(),
        ]);
        if (!active) return;
        const error = roleResult.error ?? profileResult.error;
        if (error) {
          console.error("Administrator role verification failed:", error);
          setRoleError(verificationErrorMessage(error));
          setIsAdmin(false);
        } else {
          setIsAdmin(
            roleResult.data === true &&
              profileResult.data !== null &&
              !profileResult.data.suspended,
          );
        }
      } catch (error) {
        if (!active) return;
        console.error("Administrator role verification failed:", error);
        setRoleError(verificationErrorMessage(error));
        setIsAdmin(false);
      } finally {
        if (active) setRoleLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [userId, loading, roleRetry]);

  return (
    <AuthContext.Provider
      value={{ user, loading, isAdmin, roleLoading, roleError, retryAdminVerification }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuthUser = () => useContext(AuthContext);
