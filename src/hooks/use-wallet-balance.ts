import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export async function readWalletBalance(userId: string): Promise<number> {
  const initialized = await supabase.rpc("ensure_user_wallet");
  if (initialized.error) throw new Error("Your wallet could not be initialized.");

  const { data, error } = await supabase
    .from("wallets")
    .select("user_id,balance")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("Your wallet balance could not be loaded.");
  if (!data || data.user_id !== userId) throw new Error("Your wallet record is unavailable.");

  const balance = Number(data.balance);
  if (!Number.isFinite(balance) || balance < 0) {
    throw new Error("Your wallet returned an invalid balance.");
  }
  return balance;
}

export function useWalletBalance(userId: string | undefined) {
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceOwner, setBalanceOwner] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(Boolean(userId));
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const requestGeneration = useRef(0);

  const refresh = useCallback(async () => {
    if (!userId) return null;
    const generation = ++requestGeneration.current;
    setBalanceLoading(true);
    setBalanceError(null);
    try {
      const nextBalance = await readWalletBalance(userId);
      if (generation === requestGeneration.current) {
        setBalance(nextBalance);
        setBalanceOwner(userId);
      }
      return nextBalance;
    } catch (cause) {
      if (generation === requestGeneration.current) {
        setBalance(null);
        setBalanceOwner(userId);
        setBalanceError(
          cause instanceof Error ? cause.message : "Your wallet balance could not be loaded.",
        );
      }
      return null;
    } finally {
      if (generation === requestGeneration.current) setBalanceLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      requestGeneration.current += 1;
      setBalance(null);
      setBalanceOwner(null);
      setBalanceLoading(false);
      setBalanceError(null);
      return;
    }

    const refreshAfterWalletChange = () => void refresh();
    void refresh();
    window.addEventListener("bestplug-wallet-updated", refreshAfterWalletChange);
    window.addEventListener("bestplug-orders-updated", refreshAfterWalletChange);
    return () => {
      requestGeneration.current += 1;
      window.removeEventListener("bestplug-wallet-updated", refreshAfterWalletChange);
      window.removeEventListener("bestplug-orders-updated", refreshAfterWalletChange);
    };
  }, [refresh, userId]);

  const balanceMatchesUser = Boolean(userId && balanceOwner === userId);
  return {
    balance: balanceMatchesUser ? balance : null,
    balanceLoading:
      Boolean(userId) && (!balanceMatchesUser || balanceLoading) && !balanceError,
    balanceError: balanceMatchesUser ? balanceError : null,
    refresh,
  };
}
