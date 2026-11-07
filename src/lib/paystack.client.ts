import { getCurrentAccessToken } from "@/integrations/supabase/access-token";

const DEFAULT_GATEWAY = "https://bestplugmarketplace.shop";
const gatewayOrigin = import.meta.env["VITE_PAYMENT_GATEWAY_URL"] || DEFAULT_GATEWAY;

function getGatewayUrl() {
  const url = new URL(gatewayOrigin);
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Payment gateway configuration is invalid.");
  }
  return new URL("/api/public/wallet-payments", url).toString();
}

async function requestGateway<T>(body: Record<string, unknown>): Promise<T> {
  const token = await getCurrentAccessToken();
  if (!token) throw new Error("Sign in again before starting or checking a payment.");

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
    throw new Error("The wallet payment backend could not be reached. Please try again shortly.");
  }

  const result: unknown = await response.json().catch(() => null);
  if (!response.ok || typeof result !== "object" || result === null) {
    const fallbackMessage =
      response.status === 404
        ? "The wallet payment API is missing from the configured backend. Please contact support."
        : response.status === 401
          ? "Your session is invalid or has expired. Please sign in again."
          : response.status === 403
            ? "This payment request is blocked by the site’s security settings."
            : response.status >= 500
              ? "Wallet payments are temporarily unavailable. Please try again later."
              : "Payment request failed. Please try again.";

    const message =
      typeof result === "object" &&
      result !== null &&
      "error" in result &&
      typeof result.error === "string"
        ? result.error
        : fallbackMessage;

    console.error("[wallet-payments] gateway response error", {
      endpoint,
      action,
      status: response.status,
      responseBody: result,
      message,
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
  return requestGateway<unknown>({ action: "initialize", amount }).then((result) => {
    if (
      typeof result !== "object" ||
      result === null ||
      !("reference" in result) ||
      typeof result.reference !== "string" ||
      !("authorizationUrl" in result) ||
      typeof result.authorizationUrl !== "string" ||
      !("amount" in result) ||
      typeof result.amount !== "number" ||
      !Number.isFinite(result.amount)
    ) {
      throw new Error("The payment backend returned an invalid checkout response.");
    }
    let checkoutUrl: URL;
    try {
      checkoutUrl = new URL(result.authorizationUrl);
    } catch {
      throw new Error("The payment backend returned an invalid checkout URL.");
    }
    if (checkoutUrl.protocol !== "https:" || checkoutUrl.hostname !== "checkout.paystack.com") {
      throw new Error("The payment backend returned an unsupported checkout URL.");
    }
    return {
      reference: result.reference,
      authorizationUrl: checkoutUrl.toString(),
      amount: result.amount,
    };
  });
}

export function verifyWalletTopup(reference: string) {
  return requestGateway<unknown>({ action: "verify", reference }).then((result) => {
    if (
      typeof result !== "object" ||
      result === null ||
      !("status" in result) ||
      typeof result.status !== "string" ||
      !("amount" in result) ||
      typeof result.amount !== "number" ||
      !Number.isFinite(result.amount)
    ) {
      throw new Error("The payment backend returned an invalid verification response.");
    }
    return result as TopupVerification;
  });
}
