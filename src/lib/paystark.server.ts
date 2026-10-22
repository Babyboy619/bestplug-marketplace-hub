type ProviderEnvelope = {
  status?: boolean;
  message?: string;
  data?: Record<string, unknown>;
};

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

export function getPaystarkConfig(): PaystarkConfig {
  const secretKey = process.env["PAYSTARK_SECRET_KEY"];
  const configuredBase = process.env["PAYSTARK_BASE_URL"] || "https://api.paystack.co";
  let baseUrl: URL;
  try {
    baseUrl = new URL(configuredBase);
  } catch {
    throw new Error("Paystack payment configuration is invalid.");
  }
  if (
    !secretKey ||
    baseUrl.protocol !== "https:" ||
    baseUrl.hostname !== "api.paystack.co" ||
    baseUrl.pathname !== "/"
  ) {
    throw new Error("Paystack payments are not configured.");
  }
  return { secretKey, baseUrl: baseUrl.origin };
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
  } catch {
    throw new Error("Paystack could not be reached. Please try again shortly.");
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !isRecord(payload) || payload["status"] !== true) {
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
