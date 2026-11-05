import { supabase } from "@/integrations/supabase/client";

const DEFAULT_GATEWAY = "https://bestplug-marketplace-hub.lovable.app";
const gatewayOrigin = import.meta.env["VITE_PAYMENT_GATEWAY_URL"] || DEFAULT_GATEWAY;

function getGatewayUrl() {
  const url = new URL(gatewayOrigin);
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Payment gateway configuration is invalid.");
  }
  return new URL("/api/public/wallet-payments", url).toString();
}

async function requestGateway<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (error || !token) throw new Error("Sign in again before starting or checking a payment.");

  const endpoint = getGatewayUrl();
  const action = typeof body["action"] === "string" ? body["action"] : "unknown";
  console.info("[wallet-payments] request", { endpoint, action });

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error("[wallet-payments] network failure", {
      endpoint,
      action,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    throw new Error("The payment service could not be reached. Please try again shortly.");
  }
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok || typeof result !== "object" || result === null) {
    const message =
      typeof result === "object" &&
      result !== null &&
      "error" in result &&
      typeof result.error === "string"
        ? result.error
        : "Payment request failed. Please try again.";
    console.error("[wallet-payments] gateway response error", {
      endpoint,
      action,
      status: response.status,
      errorCode: response.status === 401 ? "unauthorized" : "gateway_rejected",
    });
    throw new Error(message);
  }
  return result as T;
}

export type TopupStart = { reference: string; authorizationUrl: string; amount: number };
export type TopupVerification = {
  status: string;
  amount: number;
  alreadyCredited?: boolean;
  error?: string;
};

export function startWalletTopup(amount: number) {
  return requestGateway<TopupStart>({ action: "initialize", amount });
}

export function verifyWalletTopup(reference: string) {
  return requestGateway<TopupVerification>({ action: "verify", reference });
}
