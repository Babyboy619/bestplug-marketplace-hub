import { getServerEnv } from "@/lib/runtime-env.server";
import { paymentReferenceSchema } from "./payment-validation";

const PAYSTACK_BASE_URL = "https://api.paystack.co";

export type PaystackConfig = {
  secretKey: string;
  baseUrl: string;
};

export type PaystackVerification = {
  confirmed: boolean;
  pending: boolean;
  amountMinor: number | null;
  currency: string | null;
  providerReference: string | null;
  payload: Record<string, unknown>;
};

function getPaystackEnv(name: string, legacyName: string, request?: Request) {
  return (
    getServerEnv(name, request)?.trim() || getServerEnv(legacyName, request)?.trim() || undefined
  );
}

export function getPaystackConfigStatus(request?: Request) {
  const secretConfigured = Boolean(
    getPaystackEnv("PAYSTACK_SECRET_KEY", "PAYSTARK_SECRET_KEY", request),
  );
  const publicConfigured = Boolean(
    getPaystackEnv("PAYSTACK_PUBLIC_KEY", "PAYSTARK_PUBLIC_KEY", request),
  );
  const configuredBase =
    getPaystackEnv("PAYSTACK_BASE_URL", "PAYSTARK_BASE_URL", request) || PAYSTACK_BASE_URL;
  let apiUrlConfigured = false;
  try {
    const baseUrl = new URL(configuredBase);
    apiUrlConfigured =
      baseUrl.href === `${PAYSTACK_BASE_URL}/` && !baseUrl.username && !baseUrl.password;
  } catch {
    apiUrlConfigured = false;
  }
  return {
    secretConfigured,
    publicConfigured,
    apiUrlConfigured,
    configured: secretConfigured && apiUrlConfigured,
  };
}

export function getPaystackConfig(request?: Request): PaystackConfig {
  const status = getPaystackConfigStatus(request);
  const secretKey = getPaystackEnv("PAYSTACK_SECRET_KEY", "PAYSTARK_SECRET_KEY", request);
  if (!status.secretConfigured || !secretKey) {
    throw new Error("Paystack server credentials are missing. Configure PAYSTACK_SECRET_KEY.");
  }
  if (!status.apiUrlConfigured) {
    throw new Error(
      "Paystack API URL is invalid. Configure PAYSTACK_BASE_URL as https://api.paystack.co.",
    );
  }
  return { secretKey, baseUrl: PAYSTACK_BASE_URL };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function paystackRequest(
  config: PaystackConfig,
  path: string,
  method: "GET" | "POST",
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const operation = path.startsWith("transaction/initialize") ? "initialize" : "verify";
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/${path.replace(/^\/+/, "")}`, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.secretKey}`,
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    console.error("[paystack] provider connection failed", {
      operation,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    throw new Error("Paystack could not be reached. Please try again shortly.");
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !isRecord(payload) || payload["status"] !== true) {
    console.error("[paystack] provider rejected request", { operation, status: response.status });
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        "Paystack rejected the configured server credentials. Check PAYSTACK_SECRET_KEY.",
      );
    }
    throw new Error("Paystack could not process the request. Please try again shortly.");
  }
  const data = payload["data"];
  if (!isRecord(data)) throw new Error("Paystack returned an invalid response.");
  return data;
}

export async function initializePaystackTransaction(
  config: PaystackConfig,
  input: {
    email: string;
    amountMinor: number;
    reference: string;
    callbackUrl: string;
  },
): Promise<{ authorizationUrl: string; accessCode: string; reference: string }> {
  const data = await paystackRequest(config, "transaction/initialize", "POST", {
    email: input.email,
    amount: input.amountMinor,
    currency: "NGN",
    reference: input.reference,
    callback_url: input.callbackUrl,
  });
  const authorizationUrl = data["authorization_url"];
  const accessCode = data["access_code"];
  const reference = data["reference"];
  if (
    typeof authorizationUrl !== "string" ||
    typeof accessCode !== "string" ||
    reference !== input.reference
  ) {
    throw new Error("Paystack returned an invalid checkout response.");
  }
  let checkoutUrl: URL;
  try {
    checkoutUrl = new URL(authorizationUrl);
  } catch {
    throw new Error("Paystack returned an invalid checkout URL.");
  }
  if (checkoutUrl.protocol !== "https:" || checkoutUrl.hostname !== "checkout.paystack.com") {
    throw new Error("Paystack returned an unsupported checkout URL.");
  }
  return { authorizationUrl: checkoutUrl.toString(), accessCode, reference };
}

export async function verifyPaystackTransaction(
  config: PaystackConfig,
  reference: string,
  expectedAmountMinor: number,
): Promise<PaystackVerification> {
  const data = await paystackRequest(
    config,
    `transaction/verify/${encodeURIComponent(reference)}`,
    "GET",
  );
  const verifiedReference = data["reference"];
  const amountMinor = typeof data["amount"] === "number" ? data["amount"] : null;
  const currency = typeof data["currency"] === "string" ? data["currency"].toUpperCase() : null;
  const status = data["status"];
  const providerId = data["id"];
  const providerReference =
    typeof providerId === "number" || typeof providerId === "string" ? String(providerId) : null;
  return {
    confirmed:
      status === "success" &&
      verifiedReference === reference &&
      amountMinor === expectedAmountMinor &&
      currency === "NGN" &&
      providerReference !== null,
    pending: status === "pending" || status === "ongoing" || status === "processing",
    amountMinor,
    currency,
    providerReference,
    payload: data,
  };
}

export async function verifyPaystackWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
): Promise<boolean> {
  if (!signatureHeader || !/^[a-f0-9]{128}$/i.test(signatureHeader) || !secret) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)),
  );
  let difference = 0;
  for (let index = 0; index < signature.length; index += 1) {
    difference |=
      (signature[index] ?? 0) ^
      Number.parseInt(signatureHeader.slice(index * 2, index * 2 + 2), 16);
  }
  return difference === 0;
}

export async function settleVerified(reference: string, config: PaystackConfig) {
  reference = paymentReferenceSchema.parse(reference);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: intent, error } = await supabaseAdmin
    .from("payment_intents")
    .select("*")
    .eq("reference", reference)
    .eq("provider", "paystack")
    .maybeSingle();
  if (error || !intent) throw new Error("Payment reference not found");
  if (intent.status === "success")
    return { success: true, status: "success", orderId: intent.order_id };
  if (intent.status !== "pending")
    return { success: false, status: String(intent.status), orderId: intent.order_id };

  const checked = await verifyPaystackTransaction(
    config,
    reference,
    Math.round(Number(intent.amount) * 100),
  );
  if (!checked.confirmed || !checked.providerReference) {
    if (!checked.pending) {
      const { error: failError } = await supabaseAdmin.rpc("fail_paystack", {
        _reference: reference,
      });
      if (failError) throw new Error("Payment status could not be updated. Please check again.");
    }
    return {
      success: false,
      status: String(checked.payload["status"] ?? "pending"),
      orderId: intent.order_id,
    };
  }

  if (intent.currency !== "NGN") throw new Error("Payment currency did not match.");
  const { data: orderId, error: settlement } = await supabaseAdmin.rpc("settle_paystack", {
    _reference: reference,
    _amount: Number(intent.amount),
    _currency: intent.currency,
    _provider_id: checked.providerReference,
  });
  if (settlement)
    throw new Error("Payment confirmed; settlement needs another verification. Please retry.");
  return { success: true, status: "success", orderId };
}
