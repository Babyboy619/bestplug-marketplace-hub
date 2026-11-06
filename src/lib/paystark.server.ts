type ProviderEnvelope = {
  status?: boolean;
  message?: string;
  data?: Record<string, unknown>;
};

const DEFAULT_PAYSTACK_BASE_URL = "https://api.paystack.co";

export type PaystarkConfig = {
  secretKey: string;
  baseUrl: string;
};

export type PaystarkVerification = {
  confirmed: boolean;
  pending: boolean;
  amountMinor: number | null;
  currency: string | null;
  providerReference: string | null;
  payload: Record<string, unknown>;
};

export function getPaystarkConfigStatus() {
  const secretConfigured = Boolean(process.env["PAYSTARK_SECRET_KEY"]?.trim());
  const configuredBase = process.env["PAYSTARK_BASE_URL"]?.trim() || DEFAULT_PAYSTACK_BASE_URL;
  let apiUrlConfigured = false;
  try {
    const baseUrl = new URL(configuredBase);
    apiUrlConfigured =
      baseUrl.href === `${DEFAULT_PAYSTACK_BASE_URL}/` && !baseUrl.username && !baseUrl.password;
  } catch {
    apiUrlConfigured = false;
  }
  return { secretConfigured, apiUrlConfigured, configured: secretConfigured && apiUrlConfigured };
}

export function getPaystarkConfig(): PaystarkConfig {
  const status = getPaystarkConfigStatus();
  const secretKey = process.env["PAYSTARK_SECRET_KEY"]?.trim();
  if (!status.secretConfigured || !secretKey) {
    throw new Error("Paystack server credentials are missing. Configure PAYSTARK_SECRET_KEY.");
  }
  if (!status.apiUrlConfigured) {
    throw new Error(
      "Paystack API URL is invalid. Configure PAYSTARK_BASE_URL as https://api.paystack.co.",
    );
  }
  return { secretKey, baseUrl: DEFAULT_PAYSTACK_BASE_URL };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function paystarkRequest(
  config: PaystarkConfig,
  path: string,
  method: "GET" | "POST",
  body?: Record<string, unknown>,
): Promise<ProviderEnvelope> {
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
        "Paystack rejected the configured server credentials. Check PAYSTARK_SECRET_KEY.",
      );
    }
    throw new Error("Paystack could not process the request. Please try again shortly.");
  }
  return payload as ProviderEnvelope;
}

export async function initializePaystarkTransaction(
  config: PaystarkConfig,
  input: {
    email: string;
    amountMinor: number;
    reference: string;
    callbackUrl: string;
  },
): Promise<{ authorizationUrl: string; accessCode: string; reference: string }> {
  const response = await paystarkRequest(config, "transaction/initialize", "POST", {
    email: input.email,
    amount: input.amountMinor,
    currency: "NGN",
    reference: input.reference,
    callback_url: input.callbackUrl,
  });
  const data = response.data;
  const authorizationUrl = data?.["authorization_url"];
  const accessCode = data?.["access_code"];
  const reference = data?.["reference"];
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

export async function verifyPaystarkTransaction(
  config: PaystarkConfig,
  reference: string,
  expectedAmountMinor: number,
): Promise<PaystarkVerification> {
  const response = await paystarkRequest(
    config,
    `transaction/verify/${encodeURIComponent(reference)}`,
    "GET",
  );
  const data = response.data ?? {};
  const verifiedReference = data["reference"];
  const amountMinor = typeof data["amount"] === "number" ? data["amount"] : null;
  const currency = typeof data["currency"] === "string" ? data["currency"].toUpperCase() : null;
  const status = data["status"];
  const confirmed =
    status === "success" &&
    verifiedReference === reference &&
    amountMinor === expectedAmountMinor &&
    currency === "NGN";
  return {
    confirmed,
    pending: status === "pending" || status === "ongoing" || status === "processing",
    amountMinor,
    currency,
    providerReference:
      typeof data["id"] === "number" || typeof data["id"] === "string" ? String(data["id"]) : null,
    payload: data,
  };
}

export async function verifyPaystarkWebhookSignature(
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
  const candidate = signatureHeader.toLowerCase();
  let difference = 0;
  for (let index = 0; index < signature.length; index += 1) {
    difference |=
      (signature[index] ?? 0) ^ Number.parseInt(candidate.slice(index * 2, index * 2 + 2), 16);
  }
  return difference === 0;
}
