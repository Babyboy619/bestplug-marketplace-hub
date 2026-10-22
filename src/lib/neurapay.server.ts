export const NEURAPAY_BASE_URL = "https://neurapay.com.ng/api/v1";
const PAID_STATES = new Set(["success", "successful", "paid", "completed", "confirmed"]);

export interface NeuraPayConfig {
  baseUrl: string;
  secretKey: string;
  businessId: string;
  webhookSecret: string;
}

export interface NeuraPayResult {
  ok: boolean;
  status: number;
  json: Record<string, unknown> | null;
}

export function makeNeuraPayConfig(
  secretKey: string,
  businessId: string,
  webhookSecret: string,
  baseUrl?: string,
): NeuraPayConfig {
  return {
    baseUrl: (baseUrl || NEURAPAY_BASE_URL).replace(/\/+$/, ""),
    secretKey,
    businessId,
    webhookSecret,
  };
}

export async function neuraPayRequest(
  config: NeuraPayConfig,
  path: string,
  method: "GET" | "POST",
  body?: Record<string, unknown>,
): Promise<NeuraPayResult> {
  try {
    const response = await fetch(`${config.baseUrl}/${path.replace(/^\/+/, "")}`, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.secretKey}`,
        "x-api-key": config.secretKey,
        "X-Business-Id": config.businessId,
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    const json = await response.json().catch(() => null);
    return {
      ok: response.ok,
      status: response.status,
      json: isRecord(json) ? json : null,
    };
  } catch (error) {
    console.error(
      "NeuraPay request failed",
      error instanceof Error ? error.message : "network error",
    );
    return { ok: false, status: 0, json: null };
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function findNeuraPayField(value: unknown, keys: string[]): unknown {
  if (!isRecord(value)) return undefined;
  for (const key of keys) {
    const found = value[key];
    if (found !== undefined && found !== null && found !== "") return found;
  }
  for (const child of Object.values(value)) {
    if (isRecord(child)) {
      const found = findNeuraPayField(child, keys);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

export function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function transactionPayload(value: Record<string, unknown> | null): Record<string, unknown> {
  if (!value) return {};
  return isRecord(value["data"]) ? value["data"] : value;
}

export interface VerifiedTransaction {
  confirmed: boolean;
  status: string;
  reason: string | null;
  providerReference: string | null;
  payload: Record<string, unknown>;
}

export async function verifyNeuraPayTransaction(
  config: NeuraPayConfig,
  reference: string,
  expectedAmount: number,
): Promise<VerifiedTransaction> {
  const result = await neuraPayRequest(
    config,
    `transactions/${encodeURIComponent(reference)}`,
    "GET",
  );
  if (result.status === 404) {
    return {
      confirmed: false,
      status: "pending",
      reason: "pending",
      providerReference: null,
      payload: {},
    };
  }
  if (!result.ok) {
    return {
      confirmed: false,
      status: "pending",
      reason: "unavailable",
      providerReference: null,
      payload: {},
    };
  }

  const payload = transactionPayload(result.json);
  const status = String(
    findNeuraPayField(payload, [
      "status",
      "payment_status",
      "paymentStatus",
      "transactionStatus",
    ]) ?? "",
  ).toLowerCase();
  if (!PAID_STATES.has(status)) {
    const terminal = [
      "failed",
      "cancelled",
      "canceled",
      "declined",
      "reversed",
      "expired",
    ].includes(status);
    return {
      confirmed: false,
      status: terminal ? status : "pending",
      reason: terminal ? "not_paid" : "pending",
      providerReference: null,
      payload,
    };
  }

  const paidAmount = findNeuraPayField(payload, [
    "amountPaid",
    "amount_paid",
    "settledAmount",
    "amount",
    "value",
  ]);
  const numericPaid = Number(paidAmount);
  if (
    paidAmount === undefined ||
    !Number.isFinite(numericPaid) ||
    Math.abs(numericPaid - expectedAmount) > 0.01
  ) {
    return {
      confirmed: false,
      status: "failed",
      reason: "amount_mismatch",
      providerReference: null,
      payload,
    };
  }

  const currency = findNeuraPayField(payload, ["currency", "currency_code"]);
  if (typeof currency !== "string" || currency.toUpperCase() !== "NGN") {
    return {
      confirmed: false,
      status: "failed",
      reason: "currency_mismatch",
      providerReference: null,
      payload,
    };
  }

  const providerReference = findNeuraPayField(payload, [
    "transactionId",
    "transaction_id",
    "transactionReference",
    "transaction_reference",
    "id",
  ]);
  return {
    confirmed: true,
    status,
    reason: null,
    providerReference: providerReference === undefined ? null : String(providerReference),
    payload,
  };
}

export async function verifyNeuraPayWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
): Promise<boolean> {
  const candidate = signatureHeader
    .replace(/^sha256=/i, "")
    .trim()
    .toLowerCase();
  if (!candidate || !/^[a-f0-9]{64}$/.test(candidate) || !secret) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)),
  );
  let difference = 0;
  for (let index = 0; index < signature.length; index += 1) {
    difference |=
      (signature[index] ?? 0) ^ Number.parseInt(candidate.slice(index * 2, index * 2 + 2), 16);
  }
  return difference === 0;
}
